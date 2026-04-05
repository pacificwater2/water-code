import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd());
const entry = path.join(repoRoot, "bin", "water-code.js");
const smokePatchPath = path.join(repoRoot, ".water-code-smoke.txt");

function runCase(name, args, expectedSnippets) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.status !== 0) {
    throw new Error(
      `${name} exited with code ${result.status}\nstdout:\n${stdout}\nstderr:\n${stderr}`.trim(),
    );
  }

  for (const snippet of expectedSnippets) {
    if (!stdout.includes(snippet)) {
      throw new Error(
        `${name} did not include expected snippet: ${JSON.stringify(snippet)}\nstdout:\n${stdout}\nstderr:\n${stderr}`.trim(),
      );
    }
  }

  console.log(`PASS ${name}`);
}

function runRaw(args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `raw run failed with code ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`.trim(),
    );
  }

  return result.stdout ?? "";
}

function runJsonCase(name, args, assertPayload) {
  const stdout = runRaw(args);
  let payload = null;

  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name} did not emit valid JSON.\nstdout:\n${stdout}`);
  }

  assertPayload(payload);
  console.log(`PASS ${name}`);
}

function runJsonLinesCase(name, args, assertEvents) {
  const stdout = runRaw(args);
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const events = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${name} emitted non-JSON line: ${line}\nstdout:\n${stdout}`);
    }
  });

  assertEvents(events);
  console.log(`PASS ${name}`);
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

runCase("help", ["-p", "/help"], ["/context", "/quit"]);
runCase("version", ["--version"], ["0.1.0"]);
runCase("doctor", ["--doctor"], ["Water Code Doctor", "Overall: OK", "[OK] provider:"]);
runCase("onboard", ["--onboard"], ["Water Code Onboarding", "Recommended next steps:", "/context"]);
runJsonCase("doctor-json", ["--json", "--doctor"], payload => {
  if (payload.ok !== true || payload.transport !== "local") {
    throw new Error(`Unexpected doctor-json envelope: ${JSON.stringify(payload, null, 2)}`);
  }

  if (payload.steps[0]?.operation !== "doctor" || payload.steps[0]?.report?.provider !== "planner") {
    throw new Error(`doctor-json missing doctor report: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonCase("prompt-json", ["--json", "--provider", "planner", "-p", "read README.md"], payload => {
  if (payload.steps[0]?.operation !== "prompt") {
    throw new Error(`prompt-json missing prompt step: ${JSON.stringify(payload, null, 2)}`);
  }

  if (!String(payload.steps[0]?.output || "").includes("OK Read file README.md")) {
    throw new Error(`prompt-json missing read output: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonLinesCase("prompt-stream-json", ["--json", "--stream", "--provider", "planner", "-p", "read README.md"], events => {
  const types = events.map(event => event.event?.type);
  for (const required of ["session.started", "tool.call", "tool.result", "assistant.message", "completed"]) {
    if (!types.includes(required)) {
      throw new Error(`prompt-stream-json missing ${required}: ${JSON.stringify(events, null, 2)}`);
    }
  }
});
runJsonCase("adapter-state", ["adapter", "state", "--provider", "planner"], payload => {
  if (payload.adapter !== true || payload.operation !== "state") {
    throw new Error(`adapter-state missing adapter metadata: ${JSON.stringify(payload, null, 2)}`);
  }
  if (payload.steps[0]?.state?.provider !== "planner") {
    throw new Error(`adapter-state missing planner provider: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonCase("adapter-project", ["adapter", "project", "--input", "."], payload => {
  if (payload.adapter !== true || payload.operation !== "project") {
    throw new Error(`adapter-project missing adapter metadata: ${JSON.stringify(payload, null, 2)}`);
  }
  if (!String(payload.steps[0]?.report?.toCwd || "").includes(repoRoot)) {
    throw new Error(`adapter-project missing switched cwd: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonCase("adapter-prompt", ["adapter", "prompt", "--provider", "planner", "--input", "read README.md"], payload => {
  if (payload.steps[0]?.operation !== "prompt") {
    throw new Error(`adapter-prompt missing prompt step: ${JSON.stringify(payload, null, 2)}`);
  }
  if (!String(payload.steps[0]?.output || "").includes("OK Read file README.md")) {
    throw new Error(`adapter-prompt missing read output: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonCase("adapter-command", ["adapter", "command", "--input", "/plugins"], payload => {
  if (payload.steps[0]?.operation !== "command") {
    throw new Error(`adapter-command missing command step: ${JSON.stringify(payload, null, 2)}`);
  }
  if (!String(payload.steps[0]?.output || "").includes("workspace-tools")) {
    throw new Error(`adapter-command missing plugin output: ${JSON.stringify(payload, null, 2)}`);
  }
});
runJsonLinesCase("adapter-prompt-stream", ["adapter", "prompt", "--provider", "planner", "--stream", "--input", "read README.md"], events => {
  const types = events.map(event => event.event?.type);
  if (!types.includes("completed")) {
    throw new Error(`adapter-prompt-stream missing completion: ${JSON.stringify(events, null, 2)}`);
  }
});
runCase("mcp-list", ["-p", "/mcp"], [
  "local_echo [connected]",
  "echo_note",
]);
runCase("mcp-call", ["-p", "/mcp-call local_echo echo_note ::: {\"note\":\"hello from smoke\",\"uppercase\":true}"], [
  "OK MCP local_echo.echo_note",
  "Echo from local_echo: HELLO FROM SMOKE",
]);
runCase("commands-list", ["-p", "/commands"], [
  "/readme-snapshot",
  "Read the project README through the agent loop.",
]);
runCase("plugins-list", ["-p", "/plugins"], [
  "workspace-tools",
  "/plugin-status",
  "plugin_extension_summary",
]);
runCase("skills-list", ["-p", "/skills"], [
  "repo-cartographer",
  "safe-editor",
  "Use for unfamiliar repos",
]);
runCase("agents-list", ["-p", "/agents"], [
  "reviewer",
  "architect",
  "Review work with a bug-finding and regression-checking bias.",
]);
runCase("agent-help", ["-p", "/help agent"], [
  "/agent [name|none]",
  "Show or change the active project custom agent",
]);
runCase("agent-default", ["-p", "/agent"], [
  "Active agent: (none)",
]);
runCase("agent-set", ["-p", "/agent reviewer"], [
  "Active agent set to reviewer.",
  ".water-code/agents/reviewer.md",
]);
runCase("agent-via-cli", ["--agent", "reviewer", "-p", "/agent"], [
  "Active agent: reviewer",
  ".water-code/agents/reviewer.md",
]);
runCase("skill-default", ["-p", "/skill"], [
  "Active skills: (none)",
]);
runCase("skill-set", ["-p", "/skill repo-cartographer,safe-editor"], [
  "Active skills set to repo-cartographer, safe-editor.",
  ".water-code/skills/repo-cartographer.md",
  ".water-code/skills/safe-editor.md",
]);
runCase("skill-via-cli", ["--skill", "repo-cartographer", "-p", "/skill"], [
  "Active skills: repo-cartographer",
  ".water-code/skills/repo-cartographer.md",
]);
runCase("plugin-help", ["-p", "/help plugin-status"], [
  "/plugin-status",
  "Source:",
  ".water-code/plugins/workspace-tools.js",
]);
runCase("plugin-command", ["-p", "/plugin-status"], [
  "workspace-tools",
  "/plugin-status",
  "plugin_extension_summary",
]);
runCase("task-help", ["-p", "/help task-run"], [
  "/task-run [label] [--agent name] [--skills a,b] ::: <prompt>",
  "Start a background task for a prompt or slash command",
]);
runCase("delegate-reviewer", ["--provider", "planner", "-p", "/delegate reviewer ::: read README.md"], [
  "Delegated to reviewer.",
  "Tool result received:",
  "OK Read file README.md",
]);
runCase("swarm-reviewer-architect", ["--provider", "planner", "-p", "/swarm reviewer,architect ::: read README.md"], [
  "OK Swarm run across 2 agents",
  "reviewer (wc-",
  "architect (wc-",
  "Tool result received:",
]);
runCase("tools-include-mcp", ["-p", "/tools"], [
  "mcp.local_echo.echo_note",
  "[MCP local_echo]",
]);
runCase("tools-include-plugin", ["-p", "/tools"], [
  "plugin_extension_summary",
  "Summarize loaded project extensions",
]);
runCase("tools-include-background-tasks", ["-p", "/tools"], [
  "list_background_tasks",
  "get_background_task",
  "start_background_task",
  "cancel_background_task",
]);
runCase("custom-command-help", ["-p", "/help readme-snapshot"], [
  "/readme-snapshot [extra focus]",
  "Source:",
  ".water-code/commands/readme-snapshot.md",
]);
runCase("permissions-default", ["-p", "/permissions"], [
  "Permission mode: ask",
  "Ask before dangerous tools when interactive; otherwise deny.",
]);
runCase("context", ["-p", "/context"], ["Project root:", "Key files:"]);
runCase("project-current", ["-p", "/project"], ["Project root:", repoRoot]);
runCase("project-refresh", ["-p", "/project ."], [`Project root refreshed at ${repoRoot}.`]);
runCase("git-status", ["-p", "/git"], [
  "No Git repository detected.",
]);
runCase("git-worktrees", ["-p", "/worktrees"], [
  "No Git repository detected.",
]);
runCase("instructions", ["-p", "/instructions"], [
  "Source:",
  "WATER.md",
  "Keep changes small, explicit, and easy to review.",
]);
runCase("planner-assistant", ["--provider", "planner", "-p", "what project is this?"], [
  "I can already inspect and modify a project through a small agent loop.",
  "Available tools:",
]);
runCase("planner-read", ["--provider", "planner", "-p", "read README.md"], [
  "Tool result received:",
  "OK Read file README.md",
  "Contents:",
]);
runCase("planner-git-status", ["--provider", "planner", "-p", "git status"], [
  "Tool result received:",
  "OK Git status",
  "No Git repository detected.",
]);
runCase("custom-command-run", ["--provider", "planner", "-p", "/readme-snapshot"], [
  "Tool result received:",
  "OK Read file README.md",
]);
runCase("planner-list", ["--provider", "planner", "-p", "list files in src"], [
  "Tool result received:",
  "OK Listed files in src",
  "Tree:",
  "src/",
]);
runCase("planner-list-background-tasks", ["--provider", "planner", "-p", "list background tasks"], [
  "Tool result received:",
  "OK Listed background tasks",
]);
runCase("planner-bash-yolo", ["--provider", "planner", "--yolo", "-p", "run pwd"], [
  "Tool result received:",
  "OK Ran command",
  "Command:",
  "pwd",
  repoRoot,
]);
runCase("accept-edits-denies-shell", ["--permission-mode", "accept-edits", "-p", "/run pwd"], [
  "ERROR Permission denied for bash",
  "Permission mode accept-edits requires interactive approval for shell tools.",
]);

const initRoot = await mkdtemp(path.join(os.tmpdir(), "water-code-init-smoke-"));
try {
  runCase("init", ["--cwd", initRoot, "--init"], [
    "Initialized Water Code scaffolding",
    "Created files:",
    "WATER.md",
  ]);

  const initWater = await readFile(path.join(initRoot, "WATER.md"), "utf8");
  if (!initWater.includes("Water Code Instructions")) {
    throw new Error("init did not create WATER.md with expected contents");
  }
} finally {
  await rm(initRoot, { recursive: true, force: true });
}

await writeFile(smokePatchPath, "alpha\nbeta\ngamma\n", "utf8");

try {
  runCase("slash-diff", ["-p", "/diff .water-code-smoke.txt ::: alpha\nbeta updated\ngamma\n"], [
    "OK Diff preview for .water-code-smoke.txt",
    "Diff preview for .water-code-smoke.txt",
    "Diff:",
    "--- a/.water-code-smoke.txt",
    "+beta updated",
  ]);
  runCase("slash-patch", ["--permission-mode", "accept-edits", "-p", "/patch .water-code-smoke.txt ::: beta >>> beta updated"], [
    "OK Applied patch to .water-code-smoke.txt",
    "Applied patch to .water-code-smoke.txt",
    "Diff:",
    "--- a/.water-code-smoke.txt",
    "+beta updated",
  ]);

  const patched = await readFile(smokePatchPath, "utf8");
  if (!patched.includes("beta updated")) {
    throw new Error(`slash-patch did not update ${smokePatchPath}`);
  }
} finally {
  await unlink(smokePatchPath).catch(() => {});
}

const taskStartOutput = runRaw([
  "--provider",
  "planner",
  "-p",
  "/task-run --label \"smoke background task\" ::: read README.md",
]);
const taskIdMatch = taskStartOutput.match(/Started background task (wctask-[a-z0-9-]+)\./i);
if (!taskIdMatch) {
  throw new Error(`Could not parse background task id.\nOutput:\n${taskStartOutput}`);
}

const backgroundTaskId = taskIdMatch[1];
console.log("PASS task-run");

const tasksListOutput = runRaw(["-p", "/tasks"]);
if (!tasksListOutput.includes(backgroundTaskId)) {
  throw new Error(`tasks list did not include ${backgroundTaskId}\n${tasksListOutput}`);
}
console.log("PASS tasks-list");

let taskShowOutput = "";

for (let attempt = 0; attempt < 50; attempt += 1) {
  taskShowOutput = runRaw(["-p", `/task-show ${backgroundTaskId} --lines 20`]);

  if (taskShowOutput.includes("Status: succeeded")) {
    break;
  }

  if (taskShowOutput.includes("Status: failed") || taskShowOutput.includes("Status: cancelled")) {
    throw new Error(`Background task did not succeed.\n${taskShowOutput}`);
  }

  await wait(100);
}

if (!taskShowOutput.includes("Status: succeeded")) {
  throw new Error(`Background task did not finish in time.\n${taskShowOutput}`);
}

if (!taskShowOutput.includes("OK Read file README.md")) {
  throw new Error(`Background task output did not include README read result.\n${taskShowOutput}`);
}
console.log("PASS task-show");

const plannerTaskShowOutput = runRaw([
  "--provider",
  "planner",
  "-p",
  `show background task ${backgroundTaskId}`,
]);
if (!plannerTaskShowOutput.includes("Tool result received:") ||
    !plannerTaskShowOutput.includes(`Background task ${backgroundTaskId}`)) {
  throw new Error(`Planner task inspection did not include expected output.\n${plannerTaskShowOutput}`);
}
console.log("PASS planner-task-show");

const plannerTaskStartOutput = runRaw([
  "--provider",
  "planner",
  "--yolo",
  "-p",
  "start background task ::: read README.md",
]);
const plannerTaskIdMatch = plannerTaskStartOutput.match(/wctask-[a-z0-9-]+/i);
if (!plannerTaskIdMatch) {
  throw new Error(`Could not parse planner-started background task id.\n${plannerTaskStartOutput}`);
}

const plannerBackgroundTaskId = plannerTaskIdMatch[0];
console.log("PASS planner-task-start");

let plannerBackgroundTaskShowOutput = "";

for (let attempt = 0; attempt < 50; attempt += 1) {
  plannerBackgroundTaskShowOutput = runRaw([
    "--provider",
    "planner",
    "-p",
    `show background task ${plannerBackgroundTaskId}`
  ]);

  if (plannerBackgroundTaskShowOutput.includes("Status: succeeded.")) {
    break;
  }

  if (plannerBackgroundTaskShowOutput.includes("Status: failed.") ||
      plannerBackgroundTaskShowOutput.includes("Status: cancelled.")) {
    throw new Error(`Planner-started background task did not succeed.\n${plannerBackgroundTaskShowOutput}`);
  }

  await wait(100);
}

if (!plannerBackgroundTaskShowOutput.includes("Status: succeeded.")) {
  throw new Error(`Planner-started background task did not finish in time.\n${plannerBackgroundTaskShowOutput}`);
}
console.log("PASS planner-task-finish");

const taskMetaPath = path.join(repoRoot, ".water-code", "tasks", `${backgroundTaskId}.json`);
try {
  const taskMeta = JSON.parse(await readFile(taskMetaPath, "utf8"));
  await unlink(taskMetaPath).catch(() => {});
  await unlink(taskMeta.outputPath).catch(() => {});
  await unlink(taskMeta.errorPath).catch(() => {});
} catch {
  // best effort cleanup for smoke-created task artifacts
}

const plannerTaskMetaPath = path.join(repoRoot, ".water-code", "tasks", `${plannerBackgroundTaskId}.json`);
try {
  const taskMeta = JSON.parse(await readFile(plannerTaskMetaPath, "utf8"));
  await unlink(plannerTaskMetaPath).catch(() => {});
  await unlink(taskMeta.outputPath).catch(() => {});
  await unlink(taskMeta.errorPath).catch(() => {});
} catch {
  // best effort cleanup for smoke-created task artifacts
}

console.log("\nSmoke checks passed.");
