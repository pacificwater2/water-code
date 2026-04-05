import process from "node:process";
import { SlashCommandRegistry } from "../commands/index.js";
import { createRuntime } from "../core/runtime.js";
import { BackgroundTaskStore } from "./store.js";

function nowIso() {
  return new Date().toISOString();
}

export async function runBackgroundTaskWorker(options) {
  if (!options.taskId) {
    throw new Error("Background task worker requires --task-id");
  }

  const store = new BackgroundTaskStore(options.cwd);
  const task = await store.getTask(options.taskId);

  if (!task) {
    throw new Error(`Unknown background task: ${options.taskId}`);
  }

  let runtime = null;

  const handleCancel = async () => {
    await store.markCancelled(task.id, {
      pid: process.pid,
      error: "Task cancelled by signal."
    });
    if (runtime) {
      await runtime.close();
    }
    process.exit(1);
  };

  process.once("SIGTERM", () => {
    void handleCancel();
  });
  process.once("SIGINT", () => {
    void handleCancel();
  });

  await store.markRunning(task.id, {
    pid: process.pid,
    startedAt: task.startedAt || nowIso()
  });

  try {
    runtime = await createRuntime({
      cwd: task.cwd,
      provider: task.provider,
      sessionId: "",
      agent: task.agent || "",
      skills: task.skills || [],
      maxTurns: task.maxTurns || 6,
      permissionMode: task.permissionMode || "ask"
    });

    let output = "";
    let sessionId = "";
    let turns = 0;

    if (String(task.prompt || "").trim().startsWith("/")) {
      const commands = new SlashCommandRegistry();
      const result = await commands.execute(task.prompt, runtime);
      output = result.output || "";
    } else {
      const result = await runtime.runPrompt(task.prompt);
      output = result.output || "";
      sessionId = result.sessionId || "";
      turns = result.turns || 0;
    }

    if (output) {
      process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    }

    await store.markSucceeded(task.id, {
      sessionId,
      turns,
      pid: process.pid,
      outputPreview: output.slice(0, 4000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    await store.markFailed(task.id, error, {
      pid: process.pid
    });
    process.exitCode = 1;
  } finally {
    if (runtime) {
      await runtime.close();
    }
  }
}
