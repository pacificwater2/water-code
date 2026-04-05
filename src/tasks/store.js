import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TASK_ROOT = path.join(".water-code", "tasks");
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const ENTRYPOINT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "bin",
  "water-code.js"
);

function nowIso() {
  return new Date().toISOString();
}

function createTaskId() {
  return `wctask-${randomUUID()}`;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const payload = await readFile(filePath, "utf8");
  return JSON.parse(payload);
}

async function readTail(filePath, lines = 40) {
  try {
    const payload = await readFile(filePath, "utf8");
    const allLines = payload.split("\n");
    return allLines.slice(Math.max(0, allLines.length - lines)).join("\n").trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function summarizeTask(task) {
  return {
    id: task.id,
    label: task.label,
    status: task.status,
    provider: task.provider,
    agent: task.agent || "",
    skills: task.skills || [],
    pid: task.pid || null,
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    sessionId: task.sessionId || "",
    outputPreview: task.outputPreview || ""
  };
}

export class BackgroundTaskStore {
  constructor(cwd) {
    this.cwd = path.resolve(cwd);
    this.baseDir = path.join(this.cwd, TASK_ROOT);
  }

  async listTasks(limit = 20) {
    await mkdir(this.baseDir, { recursive: true });
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const tasks = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const task = await this.#refreshTask(await readJson(path.join(this.baseDir, entry.name)));
      tasks.push(task);
    }

    tasks.sort((left, right) => {
      return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    });

    return tasks.slice(0, limit).map(summarizeTask);
  }

  async getTask(taskId) {
    const task = await this.#loadTask(taskId);
    if (!task) {
      return null;
    }
    return this.#refreshTask(task);
  }

  async getTaskReport(taskId, { lines = 40 } = {}) {
    const task = await this.getTask(taskId);
    if (!task) {
      return null;
    }

    return {
      task,
      stdout: await readTail(task.outputPath, lines),
      stderr: await readTail(task.errorPath, lines)
    };
  }

  async launchTask({
    label,
    prompt,
    provider,
    agent = "",
    skills = [],
    permissionMode,
    maxTurns,
    metadata = {}
  }) {
    await mkdir(this.baseDir, { recursive: true });

    const id = createTaskId();
    const createdAt = nowIso();
    const task = {
      id,
      label: String(label || "").trim() || String(prompt || "").trim().slice(0, 80),
      prompt: String(prompt || ""),
      provider: String(provider || "planner"),
      agent: String(agent || ""),
      skills: Array.isArray(skills) ? skills : [],
      permissionMode: String(permissionMode || "ask"),
      maxTurns: Number(maxTurns || 6),
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      cwd: this.cwd,
      outputPath: this.#outputPath(id),
      errorPath: this.#errorPath(id),
      ...metadata
    };

    await this.#writeTask(task);

    const outFd = openSync(task.outputPath, "a");
    const errFd = openSync(task.errorPath, "a");

    try {
      const child = spawn(
        process.execPath,
        [
          ENTRYPOINT_PATH,
          "--task-worker",
          "--task-id",
          task.id,
          "--cwd",
          this.cwd
        ],
        {
          cwd: this.cwd,
          detached: true,
          stdio: ["ignore", outFd, errFd]
        }
      );

      child.unref();

      return this.#updateTask(task.id, current => ({
        ...current,
        pid: child.pid,
        updatedAt: nowIso()
      }));
    } catch (error) {
      await this.#updateTask(task.id, current => ({
        ...current,
        status: "failed",
        finishedAt: nowIso(),
        updatedAt: nowIso(),
        error: error instanceof Error ? error.message : String(error)
      }));
      throw error;
    } finally {
      closeSync(outFd);
      closeSync(errFd);
    }
  }

  async cancelTask(taskId) {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Unknown background task: ${taskId}`);
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      return task;
    }

    if (isProcessAlive(task.pid)) {
      process.kill(task.pid, "SIGTERM");
      return this.#updateTask(task.id, current => ({
        ...current,
        status: "cancelling",
        cancelRequestedAt: nowIso(),
        updatedAt: nowIso()
      }));
    }

    return this.#refreshTask(task);
  }

  async markRunning(taskId, patch = {}) {
    return this.#updateTask(taskId, current => ({
      ...current,
      status: "running",
      startedAt: current.startedAt || nowIso(),
      updatedAt: nowIso(),
      ...patch
    }));
  }

  async markSucceeded(taskId, patch = {}) {
    return this.#updateTask(taskId, current => ({
      ...current,
      status: "succeeded",
      finishedAt: nowIso(),
      updatedAt: nowIso(),
      ...patch
    }));
  }

  async markFailed(taskId, error, patch = {}) {
    return this.#updateTask(taskId, current => ({
      ...current,
      status: "failed",
      finishedAt: nowIso(),
      updatedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error),
      ...patch
    }));
  }

  async markCancelled(taskId, patch = {}) {
    return this.#updateTask(taskId, current => ({
      ...current,
      status: "cancelled",
      finishedAt: nowIso(),
      updatedAt: nowIso(),
      ...patch
    }));
  }

  async #loadTask(taskId) {
    try {
      return await readJson(this.#taskPath(taskId));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async #refreshTask(task) {
    if (!task || TERMINAL_STATUSES.has(task.status)) {
      return task;
    }

    if (!isProcessAlive(task.pid)) {
      return this.#updateTask(task.id, current => ({
        ...current,
        status: current.status === "cancelling" ? "cancelled" : "failed",
        finishedAt: current.finishedAt || nowIso(),
        updatedAt: nowIso(),
        error:
          current.error ||
          (current.status === "cancelling"
            ? "Task cancelled."
            : "Task process exited without writing a final status.")
      }));
    }

    return task;
  }

  async #updateTask(taskId, updater) {
    const current = await this.#loadTask(taskId);
    if (!current) {
      throw new Error(`Unknown background task: ${taskId}`);
    }

    const next = updater(current);
    await this.#writeTask(next);
    return next;
  }

  async #writeTask(task) {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.#taskPath(task.id), JSON.stringify(task, null, 2), "utf8");
  }

  #taskPath(taskId) {
    return path.join(this.baseDir, `${taskId}.json`);
  }

  #outputPath(taskId) {
    return path.join(this.baseDir, `${taskId}.out.log`);
  }

  #errorPath(taskId) {
    return path.join(this.baseDir, `${taskId}.err.log`);
  }
}
