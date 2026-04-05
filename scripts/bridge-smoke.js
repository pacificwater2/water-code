import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const port = 8876;
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function fetchText(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }

  return text;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const payload = await fetchJson("/health");
      if (payload.ok) {
        return;
      }
    } catch (error) {
      await wait(100);
    }
  }

  throw new Error("Bridge server did not become healthy in time");
}

function assertIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${label} did not include ${JSON.stringify(needle)}\nReceived: ${haystack}`);
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, ["./bin/water-code.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(
      `remote cli ${args.join(" ")} failed with code ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`.trim()
    );
  }

  return result.stdout ?? "";
}

const child = spawn(process.execPath, [
  "./bin/water-code.js",
  "--bridge",
  "--bridge-port",
  String(port),
  "--provider",
  "planner"
], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";

child.stdout.on("data", chunk => {
  stdout += String(chunk);
});

child.stderr.on("data", chunk => {
  stderr += String(chunk);
});

try {
  await waitForHealth();

  const state = await fetchJson("/state");
  assertIncludes(JSON.stringify(state.state.customCommands), "readme-snapshot", "state.customCommands");
  assertIncludes(JSON.stringify(state.state.customAgents), "reviewer", "state.customAgents");
  assertIncludes(JSON.stringify(state.state.projectSkills), "repo-cartographer", "state.projectSkills");
  assertIncludes(JSON.stringify(state.state.projectPlugins), "workspace-tools", "state.projectPlugins");
  assertIncludes(JSON.stringify(state.state.projectInstructions), "WATER.md", "state.projectInstructions");
  assertIncludes(JSON.stringify(state.state.recentSessions), "wc-", "state.recentSessions");
  assertIncludes(JSON.stringify(state.state), "backgroundTasks", "state.backgroundTasks");
  assertIncludes(JSON.stringify(state.state.git), "\"summary\":\"No Git repository detected.\"", "state.git");

  const project = await fetchJson("/project");
  assertIncludes(project.project.cwd, process.cwd(), "project.cwd");

  const doctor = await fetchJson("/doctor");
  assertIncludes(doctor.report.provider, "planner", "doctor.provider");
  assertIncludes(JSON.stringify(doctor.report.checks), "\"provider\"", "doctor.checks");

  const git = await fetchJson("/git");
  assertIncludes(JSON.stringify(git.git), "\"summary\":\"No Git repository detected.\"", "git.summary");

  const health = await fetchJson("/health");
  assertIncludes(String(health.requestTimeoutMs), "30000", "health.requestTimeoutMs");
  assertIncludes(String(health.streamHeartbeatMs), "5000", "health.streamHeartbeatMs");

  const worktrees = await fetchJson("/worktrees");
  assertIncludes(JSON.stringify(worktrees.worktrees), "[]", "worktrees.empty");

  const onboard = await fetchJson("/onboard");
  assertIncludes(onboard.report.provider, "planner", "onboard.provider");
  assertIncludes(onboard.report.headline, "Water Code", "onboard.headline");

  const init = await fetchJson("/init", {
    method: "POST",
    body: JSON.stringify({})
  });
  const initFiles = JSON.stringify({
    createdFiles: init.report.createdFiles,
    overwrittenFiles: init.report.overwrittenFiles,
    skippedFiles: init.report.skippedFiles
  });
  assertIncludes(initFiles, "WATER.md", "init.report.files");

  const switchProject = await fetchJson("/project", {
    method: "POST",
    body: JSON.stringify({
      cwd: "."
    })
  });
  assertIncludes(switchProject.report.toCwd, process.cwd(), "switchProject.toCwd");

  const createdSession = await fetchJson("/sessions", {
    method: "POST",
    body: JSON.stringify({
      create: true
    })
  });
  assertIncludes(createdSession.session.id, "wc-", "session.create");

  const isolatedPrompt = await fetchJson("/prompt", {
    method: "POST",
    body: JSON.stringify({
      prompt: "read README.md",
      sessionId: "wc-bridge-isolated",
      activate: false
    })
  });
  assertIncludes(isolatedPrompt.sessionId, "wc-bridge-isolated", "prompt.sessionId");
  assertIncludes(isolatedPrompt.activeSessionId, createdSession.session.id, "prompt.activeSessionId");

  const isolatedSession = await fetchJson("/sessions/wc-bridge-isolated?messages=10");
  assertIncludes(JSON.stringify(isolatedSession.session.messages), "read README.md", "session.detail");

  const command = await fetchJson("/command", {
    method: "POST",
    body: JSON.stringify({
      command: "/plugins"
    })
  });
  assertIncludes(command.output, "workspace-tools", "command.output");

  const prompt = await fetchJson("/prompt", {
    method: "POST",
    body: JSON.stringify({
      prompt: "read README.md"
    })
  });
  assertIncludes(prompt.output, "Tool result received:", "prompt.output");
  assertIncludes(prompt.output, "OK Read file README.md", "prompt.output");

  const promptStream = await fetchText("/prompt/stream", {
    method: "POST",
    body: JSON.stringify({
      prompt: "read README.md"
    })
  });
  assertIncludes(promptStream, "\"type\":\"tool.call\"", "promptStream.body");
  assertIncludes(promptStream, "\"type\":\"stream.heartbeat\"", "promptStream.body");
  assertIncludes(promptStream, "\"type\":\"completed\"", "promptStream.body");

  const remoteDoctor = runCli(["--remote-url", baseUrl, "--doctor"]);
  assertIncludes(remoteDoctor, "Water Code Doctor", "remoteDoctor.output");

  const remoteOnboard = runCli(["--remote-url", baseUrl, "--onboard"]);
  assertIncludes(remoteOnboard, "Water Code Onboarding", "remoteOnboard.output");

  const remoteInit = runCli(["--remote-url", baseUrl, "--init"]);
  assertIncludes(remoteInit, "Initialized Water Code scaffolding", "remoteInit.output");

  const remoteCommand = runCli(["--remote-url", baseUrl, "-p", "/plugins"]);
  assertIncludes(remoteCommand, "workspace-tools", "remoteCommand.output");

  const remoteProject = runCli(["--remote-url", baseUrl, "-p", "/project"]);
  assertIncludes(remoteProject, "Project root:", "remoteProject.output");

  const remoteGitCommand = runCli(["--remote-url", baseUrl, "-p", "/git"]);
  assertIncludes(remoteGitCommand, "No Git repository detected.", "remoteGitCommand.output");

  const remotePrompt = runCli(["--remote-url", baseUrl, "-p", "read README.md"]);
  assertIncludes(remotePrompt, "Tool result received:", "remotePrompt.output");
  assertIncludes(remotePrompt, "OK Read file README.md", "remotePrompt.output");

  const remoteDoctorJson = JSON.parse(runCli(["--remote-url", baseUrl, "--json", "--doctor"]));
  assertIncludes(remoteDoctorJson.steps?.[0]?.operation, "doctor", "remoteDoctorJson.operation");
  assertIncludes(remoteDoctorJson.steps?.[0]?.report?.provider, "planner", "remoteDoctorJson.provider");

  const remotePromptJson = JSON.parse(runCli(["--remote-url", baseUrl, "--json", "-p", "read README.md"]));
  assertIncludes(remotePromptJson.steps?.[0]?.operation, "prompt", "remotePromptJson.operation");
  assertIncludes(remotePromptJson.steps?.[0]?.output, "OK Read file README.md", "remotePromptJson.output");

  const remotePromptStreamLines = runCli(["--remote-url", baseUrl, "--json", "--stream", "-p", "read README.md"])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assertIncludes(
    remotePromptStreamLines.map(item => item.event?.type).join(","),
    "completed",
    "remotePromptStreamLines.types"
  );

  const adapterState = JSON.parse(runCli(["adapter", "state", "--remote-url", baseUrl]));
  assertIncludes(adapterState.steps?.[0]?.state?.provider, "planner", "adapterState.provider");

  const adapterProject = JSON.parse(
    runCli(["adapter", "project", "--remote-url", baseUrl, "--input", "."])
  );
  assertIncludes(adapterProject.steps?.[0]?.report?.toCwd, process.cwd(), "adapterProject.toCwd");

  const adapterPrompt = JSON.parse(
    runCli(["adapter", "prompt", "--remote-url", baseUrl, "--input", "read README.md"])
  );
  assertIncludes(adapterPrompt.steps?.[0]?.output, "OK Read file README.md", "adapterPrompt.output");

  const adapterCommand = JSON.parse(
    runCli(["adapter", "command", "--remote-url", baseUrl, "--input", "/plugins"])
  );
  assertIncludes(adapterCommand.steps?.[0]?.output, "workspace-tools", "adapterCommand.output");

  const adapterPromptStream = runCli([
    "adapter",
    "prompt",
    "--remote-url",
    baseUrl,
    "--stream",
    "--input",
    "read README.md"
  ])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assertIncludes(
    adapterPromptStream.map(item => item.event?.type).join(","),
    "completed",
    "adapterPromptStream.types"
  );

  console.log("PASS bridge-health");
  console.log("PASS bridge-state");
  console.log("PASS bridge-doctor");
  console.log("PASS bridge-onboard");
  console.log("PASS bridge-git");
  console.log("PASS bridge-project");
  console.log("PASS bridge-init");
  console.log("PASS bridge-sessions");
  console.log("PASS bridge-command");
  console.log("PASS bridge-prompt");
  console.log("PASS bridge-prompt-stream");
  console.log("PASS bridge-remote-cli");
  console.log("PASS bridge-remote-json");
  console.log("PASS bridge-remote-stream");
  console.log("PASS bridge-adapter");
  console.log("\nBridge smoke checks passed.");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 1000);
  });
}
