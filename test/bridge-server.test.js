import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { buildStatePayload, routeRequest } from "../src/bridge/server.js";

function createRuntimeStub(overrides = {}) {
  return {
    cwd: "/tmp/project",
    providerName: "planner",
    sessionId: "wc-session-1",
    permissionMode: "accept-edits",
    getApprovalState() {
      return {
        allowedTools: ["bash"],
        allowedGroups: ["shell"],
        recent: []
      };
    },
    async listSessions() {
      return [
        {
          id: "wc-session-1",
          updatedAt: "2026-04-04T00:00:00.000Z",
          messageCount: 4,
          lastRole: "assistant",
          lastMessage: "reply"
        }
      ];
    },
    async getSession(sessionId) {
      return {
        id: sessionId,
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        messages: [
          {
            role: "user",
            content: "read README.md"
          }
        ]
      };
    },
    async createSession() {
      return {
        id: "wc-session-new",
        messages: []
      };
    },
    async setSession(sessionId) {
      return {
        id: sessionId,
        messages: []
      };
    },
    async switchProject(cwd) {
      this.cwd = cwd;
      return {
        changed: true,
        fromCwd: "/tmp/project",
        toCwd: cwd,
        activeSessionId: "",
        git: this.getGitState(),
        matchedWorktree: null
      };
    },
    async switchToWorktree(worktree) {
      return {
        changed: true,
        fromCwd: "/tmp/project",
        toCwd: `/tmp/${worktree}`,
        activeSessionId: "",
        git: this.getGitState(),
        matchedWorktree: {
          path: `/tmp/${worktree}`,
          branch: worktree
        }
      };
    },
    async scaffoldProject() {
      return {
        cwd: "/tmp/project",
        createdDirectories: [".water-code", ".water-code/commands"],
        createdFiles: ["WATER.md"],
        overwrittenFiles: [],
        skippedFiles: []
      };
    },
    resetSession() {
      this.sessionId = "";
    },
    getActiveAgent() {
      return {
        name: "reviewer"
      };
    },
    getActiveSkills() {
      return [
        {
          name: "repo-cartographer"
        }
      ];
    },
    getGitState() {
      return {
        detected: true,
        available: true,
        root: "/tmp/project",
        branch: "main",
        tracking: "origin/main",
        detached: false,
        clean: false,
        ahead: 1,
        behind: 0,
        staged: 1,
        unstaged: 1,
        untracked: 0,
        conflicts: 0,
        worktrees: [
          {
            path: "/tmp/project",
            branch: "main",
            detached: false,
            current: true
          }
        ],
        summary: "Git main | 1 staged, 1 unstaged | ahead 1 | 1 worktree"
      };
    },
    getProjectPlugins() {
      return [
        {
          name: "workspace-tools",
          description: "Adds workspace helpers",
          commands: [{ name: "plugin-status" }],
          tools: [{ name: "plugin_extension_summary" }]
        }
      ];
    },
    getProjectInstructions() {
      return {
        sourcePath: "/tmp/project/WATER.md",
        preview: "# Water Instructions\nPrefer small patches."
      };
    },
    getProjectContext() {
      return {
        summary: "Project root: /tmp/project",
        keyFiles: ["README.md"]
      };
    },
    describeTools() {
      return [
        {
          name: "read_file",
          description: "Read file"
        }
      ];
    },
    getCustomCommands() {
      return [
        {
          name: "readme-snapshot",
          description: "Summarize README"
        }
      ];
    },
    getCustomAgents() {
      return [
        {
          name: "reviewer",
          description: "Review carefully"
        }
      ];
    },
    async listBackgroundTasks() {
      return [
        {
          id: "wctask-123",
          status: "queued"
        }
      ];
    },
    getProjectSkills() {
      return [
        {
          name: "repo-cartographer",
          description: "Map repo",
          whenToUse: "Before editing"
        }
      ];
    },
    getMcpServers() {
      return [
        {
          name: "local_echo",
          status: "ready",
          tools: [{ name: "echo_note" }]
        }
      ];
    },
    async runPrompt(prompt, options = {}) {
      return {
        sessionId: options.sessionId || "wc-session-2",
        turns: 2,
        output: `prompt:${prompt}`
      };
    },
    async runTool(name, input) {
      return {
        ok: true,
        rendered: `tool:${name}:${JSON.stringify(input)}`,
        input
      };
    },
    ...overrides
  };
}

function createRequest({ method = "GET", url = "/", body = "" } = {}) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;

  queueMicrotask(() => {
    if (body) {
      request.emit("data", body);
    }
    request.emit("end");
  });

  return request;
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk = "") {
      this.body += String(chunk);
    },
    end(chunk = "") {
      this.body += String(chunk);
    }
  };
}

test("buildStatePayload includes extensions, tasks, and MCP details", async () => {
  const payload = await buildStatePayload(createRuntimeStub());
  assert.equal(payload.ok, true);
  assert.equal(payload.state.activeAgent, "reviewer");
  assert.deepEqual(payload.state.activeSkills, ["repo-cartographer"]);
  assert.equal(payload.state.git?.branch, "main");
  assert.equal(Array.isArray(payload.state.approvals?.recent), true);
  assert.equal(payload.state.projectPlugins[0]?.name, "workspace-tools");
  assert.equal(payload.state.projectInstructions?.sourcePath, "/tmp/project/WATER.md");
  assert.equal(payload.state.customCommands[0]?.name, "readme-snapshot");
  assert.equal(payload.state.customAgents[0]?.active, true);
  assert.equal(payload.state.recentSessions[0]?.id, "wc-session-1");
  assert.equal(payload.state.projectSkills[0]?.active, true);
  assert.equal(payload.state.mcpServers[0]?.tools[0], "echo_note");
  assert.equal(payload.state.backgroundTasks[0]?.id, "wctask-123");
});

test("routeRequest serves health and state payloads", async () => {
  const runtime = createRuntimeStub();

  const healthResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/health"
  }), healthResponse);

  assert.equal(healthResponse.statusCode, 200);
  const health = JSON.parse(healthResponse.body);
  assert.equal(health.service, "water-code-bridge");
  assert.equal(health.requestTimeoutMs, 30000);
  assert.equal(health.streamHeartbeatMs, 5000);

  const stateResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/state"
  }), stateResponse);

  assert.equal(stateResponse.statusCode, 200);
  assert.equal(JSON.parse(stateResponse.body).state.activeAgent, "reviewer");

  const projectResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/project"
  }), projectResponse);

  assert.equal(projectResponse.statusCode, 200);
  assert.equal(JSON.parse(projectResponse.body).project.cwd, "/tmp/project");

  const doctorResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/doctor"
  }), doctorResponse);

  assert.equal(doctorResponse.statusCode, 200);
  assert.equal(JSON.parse(doctorResponse.body).report.provider, "planner");

  const gitResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/git"
  }), gitResponse);

  assert.equal(gitResponse.statusCode, 200);
  assert.equal(JSON.parse(gitResponse.body).git.branch, "main");

  const worktreesResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/worktrees"
  }), worktreesResponse);

  assert.equal(worktreesResponse.statusCode, 200);
  assert.equal(JSON.parse(worktreesResponse.body).worktrees[0].path, "/tmp/project");

  const onboardResponse = createResponse();
  await routeRequest(runtime, { execute: async () => ({}) }, createRequest({
    method: "GET",
    url: "/onboard"
  }), onboardResponse);

  assert.equal(onboardResponse.statusCode, 200);
  assert.match(JSON.parse(onboardResponse.body).report.headline, /Water Code-ready|initialized/i);
});

test("routeRequest handles command and unknown route responses", async () => {
  const runtime = createRuntimeStub();
  let receivedCommand = "";
  let promptCall = null;
  const commands = {
    async execute(command) {
      receivedCommand = command;
      return {
        shouldContinue: true,
        output: "command ok\n"
      };
    }
  };

  const commandResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "POST",
    url: "/command",
    body: JSON.stringify({
      command: "/help"
    })
  }), commandResponse);

  assert.equal(receivedCommand, "/help");
  assert.equal(commandResponse.statusCode, 200);
  assert.equal(JSON.parse(commandResponse.body).output, "command ok\n");

  const sessionsResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "GET",
    url: "/sessions?limit=5"
  }), sessionsResponse);

  assert.equal(sessionsResponse.statusCode, 200);
  assert.equal(JSON.parse(sessionsResponse.body).sessions[0].id, "wc-session-1");

  const sessionDetailResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "GET",
    url: "/sessions/wc-session-1?messages=10"
  }), sessionDetailResponse);

  assert.equal(sessionDetailResponse.statusCode, 200);
  assert.equal(JSON.parse(sessionDetailResponse.body).session.id, "wc-session-1");

  const promptRuntime = createRuntimeStub({
    async runPrompt(prompt, options = {}) {
      promptCall = {
        prompt,
        options
      };
      return {
        sessionId: options.sessionId || "wc-session-2",
        turns: 2,
        output: `prompt:${prompt}`
      };
    }
  });

  const promptResponse = createResponse();
  await routeRequest(promptRuntime, commands, createRequest({
    method: "POST",
    url: "/prompt",
    body: JSON.stringify({
      prompt: "read README.md",
      sessionId: "wc-session-99",
      activate: false
    })
  }), promptResponse);

  assert.deepEqual(promptCall, {
    prompt: "read README.md",
    options: {
      sessionId: "wc-session-99",
      updateCurrentSession: false
    }
  });
  assert.equal(promptResponse.statusCode, 200);
  assert.equal(JSON.parse(promptResponse.body).sessionId, "wc-session-99");

  const setSessionResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "POST",
    url: "/sessions",
    body: JSON.stringify({
      sessionId: "wc-session-77"
    })
  }), setSessionResponse);

  assert.equal(setSessionResponse.statusCode, 200);
  assert.equal(JSON.parse(setSessionResponse.body).session.id, "wc-session-77");

  const streamRuntime = createRuntimeStub({
    async runPrompt(prompt, options = {}) {
      await options.onEvent?.({
        type: "session.started",
        sessionId: "wc-session-stream",
        prompt
      });
      await options.onEvent?.({
        type: "completed",
        sessionId: "wc-session-stream",
        activeSessionId: "wc-session-stream",
        turns: 1,
        output: "prompt:read README.md"
      });
      return {
        sessionId: "wc-session-stream",
        turns: 1,
        output: "prompt:read README.md"
      };
    }
  });

  const streamResponse = createResponse();
  await routeRequest(streamRuntime, commands, createRequest({
    method: "POST",
    url: "/prompt/stream",
    body: JSON.stringify({
      prompt: "read README.md"
    })
  }), streamResponse);

  assert.equal(streamResponse.statusCode, 200);
  assert.match(streamResponse.headers["content-type"], /text\/event-stream/);
  assert.match(streamResponse.body, /"type":"stream.started"/);
  assert.match(streamResponse.body, /"type":"stream.heartbeat"/);
  assert.match(streamResponse.body, /"type":"completed"/);
  assert.match(streamResponse.body, /"type":"stream.finished"/);

  const initResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "POST",
    url: "/init",
    body: JSON.stringify({})
  }), initResponse);

  assert.equal(initResponse.statusCode, 200);
  assert.equal(JSON.parse(initResponse.body).report.createdFiles[0], "WATER.md");

  const switchProjectResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "POST",
    url: "/project",
    body: JSON.stringify({
      cwd: "/tmp/next-project"
    })
  }), switchProjectResponse);

  assert.equal(switchProjectResponse.statusCode, 200);
  assert.equal(JSON.parse(switchProjectResponse.body).report.toCwd, "/tmp/next-project");

  const missingResponse = createResponse();
  await routeRequest(runtime, commands, createRequest({
    method: "GET",
    url: "/missing"
  }), missingResponse);

  assert.equal(missingResponse.statusCode, 404);
  assert.match(JSON.parse(missingResponse.body).error, /Unknown route/);
});
