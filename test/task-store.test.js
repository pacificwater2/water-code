import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BackgroundTaskStore } from "../src/tasks/store.js";

async function createTempProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "water-code-task-store-"));
  t.after(async () => {
    await import("node:fs/promises").then(fs => fs.rm(root, { recursive: true, force: true }));
  });
  return root;
}

test("markRunning and markSucceeded update persisted task metadata", async t => {
  const root = await createTempProject(t);
  const store = new BackgroundTaskStore(root);
  const taskDir = path.join(root, ".water-code", "tasks");
  const taskId = "wctask-test-1";

  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(taskDir, `${taskId}.json`),
    JSON.stringify({
      id: taskId,
      label: "demo",
      prompt: "read README.md",
      provider: "planner",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd: root,
      outputPath: path.join(taskDir, `${taskId}.out.log`),
      errorPath: path.join(taskDir, `${taskId}.err.log`)
    }),
    "utf8"
  );

  const running = await store.markRunning(taskId, { pid: 1234 });
  assert.equal(running.status, "running");
  assert.equal(running.pid, 1234);
  assert.ok(running.startedAt);

  const succeeded = await store.markSucceeded(taskId, {
    sessionId: "wc-session",
    outputPreview: "done"
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.sessionId, "wc-session");
  assert.equal(succeeded.outputPreview, "done");
  assert.ok(succeeded.finishedAt);

  const persisted = JSON.parse(await readFile(path.join(taskDir, `${taskId}.json`), "utf8"));
  assert.equal(persisted.status, "succeeded");
  assert.equal(persisted.sessionId, "wc-session");
});

test("getTask refreshes dead running tasks into failed state", async t => {
  const root = await createTempProject(t);
  const store = new BackgroundTaskStore(root);
  const taskDir = path.join(root, ".water-code", "tasks");
  const taskId = "wctask-dead";

  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(taskDir, `${taskId}.json`),
    JSON.stringify({
      id: taskId,
      label: "dead task",
      prompt: "read README.md",
      provider: "planner",
      status: "running",
      pid: 999999,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd: root,
      outputPath: path.join(taskDir, `${taskId}.out.log`),
      errorPath: path.join(taskDir, `${taskId}.err.log`)
    }),
    "utf8"
  );

  const task = await store.getTask(taskId);
  assert.equal(task.status, "failed");
  assert.match(task.error, /exited without writing a final status/);
  assert.ok(task.finishedAt);
});

test("listTasks returns summarized tasks ordered newest first", async t => {
  const root = await createTempProject(t);
  const store = new BackgroundTaskStore(root);
  const taskDir = path.join(root, ".water-code", "tasks");

  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(taskDir, "wctask-old.json"),
    JSON.stringify({
      id: "wctask-old",
      label: "old",
      prompt: "old",
      provider: "planner",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      cwd: root,
      outputPath: path.join(taskDir, "wctask-old.out.log"),
      errorPath: path.join(taskDir, "wctask-old.err.log")
    }),
    "utf8"
  );
  await writeFile(
    path.join(taskDir, "wctask-new.json"),
    JSON.stringify({
      id: "wctask-new",
      label: "new",
      prompt: "new",
      provider: "planner",
      status: "queued",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      cwd: root,
      outputPath: path.join(taskDir, "wctask-new.out.log"),
      errorPath: path.join(taskDir, "wctask-new.err.log")
    }),
    "utf8"
  );

  const tasks = await store.listTasks(10);
  assert.equal(tasks[0].id, "wctask-new");
  assert.equal(tasks[1].id, "wctask-old");
  assert.deepEqual(Object.keys(tasks[0]).sort(), [
    "agent",
    "createdAt",
    "finishedAt",
    "id",
    "label",
    "outputPreview",
    "pid",
    "provider",
    "sessionId",
    "skills",
    "startedAt",
    "status"
  ]);
});
