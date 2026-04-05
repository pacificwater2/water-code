import http from "node:http";
import { URL } from "node:url";
import { SlashCommandRegistry } from "../commands/index.js";
import { buildDoctorReport } from "../core/doctor.js";
import { buildOnboardingReport } from "../core/onboarding.js";
import { isValidSessionId } from "../session/store.js";

export const DEFAULT_BRIDGE_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_BRIDGE_STREAM_HEARTBEAT_MS = 5_000;
export const DEFAULT_BRIDGE_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const DEFAULT_BRIDGE_HEADERS_TIMEOUT_MS = 60_000;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, {
    ok: false,
    error: message
  });
}

function startEventStream(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
}

function writeEvent(response, payload) {
  response.write(`event: water-code\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createBridgeSettings(options = {}) {
  const requestTimeoutMs = Math.max(
    1_000,
    Number(options.requestTimeoutMs) || DEFAULT_BRIDGE_REQUEST_TIMEOUT_MS
  );
  const streamHeartbeatMs = Math.max(
    1_000,
    Number(options.streamHeartbeatMs) || DEFAULT_BRIDGE_STREAM_HEARTBEAT_MS
  );
  const keepAliveTimeoutMs = Math.max(
    1_000,
    Number(options.keepAliveTimeoutMs) || DEFAULT_BRIDGE_KEEP_ALIVE_TIMEOUT_MS
  );
  const headersTimeoutMs = Math.max(
    keepAliveTimeoutMs + 1_000,
    Number(options.headersTimeoutMs) || DEFAULT_BRIDGE_HEADERS_TIMEOUT_MS
  );

  return {
    requestTimeoutMs,
    streamHeartbeatMs,
    keepAliveTimeoutMs,
    headersTimeoutMs
  };
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", chunk => {
      body += String(chunk);
      if (body.length > 1024 * 1024) {
        reject(new Error("Bridge request body too large"));
      }
    });

    request.on("end", () => {
      resolve(body);
    });

    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const body = await collectRequestBody(request);

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function createBadRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeSessionId(rawValue, { required = false } = {}) {
  const sessionId = String(rawValue || "").trim();

  if (!sessionId) {
    if (required) {
      throw createBadRequest("sessionId is required");
    }
    return "";
  }

  if (!isValidSessionId(sessionId)) {
    throw createBadRequest(`Invalid session id: ${sessionId}`);
  }

  return sessionId;
}

export async function buildStatePayload(runtime) {
  return {
    ok: true,
    state: {
      cwd: runtime.cwd,
      provider: runtime.providerName,
      sessionId: runtime.sessionId,
      permissionMode: runtime.permissionMode,
      activeAgent: runtime.getActiveAgent()?.name || null,
      activeSkills: runtime.getActiveSkills().map(skill => skill.name),
      git: runtime.getGitState?.() || null,
      approvals: runtime.getApprovalState?.() || null,
      projectPlugins: runtime.getProjectPlugins().map(plugin => ({
        name: plugin.name,
        description: plugin.description,
        commands: (plugin.commands || []).map(command => command.name),
        tools: (plugin.tools || []).map(tool => tool.name)
      })),
      projectInstructions: runtime.getProjectInstructions()
        ? {
            sourcePath: runtime.getProjectInstructions().sourcePath,
            preview: runtime.getProjectInstructions().preview
          }
        : null,
      tools: runtime.describeTools(),
      customCommands: runtime.getCustomCommands().map(command => ({
        name: command.name,
        description: command.description
      })),
      customAgents: runtime.getCustomAgents().map(agent => ({
        name: agent.name,
        description: agent.description,
        active: runtime.getActiveAgent()?.name === agent.name
      })),
      recentSessions: await runtime.listSessions(10),
      backgroundTasks: await runtime.listBackgroundTasks(10),
      projectSkills: runtime.getProjectSkills().map(skill => ({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        active: runtime.getActiveSkills().some(active => active.name === skill.name)
      })),
      mcpServers: runtime.getMcpServers().map(server => ({
        name: server.name,
        status: server.status,
        tools: server.tools?.map(tool => tool.name) || []
      }))
    }
  };
}

function buildProjectPayload(runtime) {
  return {
    ok: true,
    project: {
      cwd: runtime.cwd,
      sessionId: runtime.sessionId,
      git: runtime.getGitState?.() || null,
      contextSummary: runtime.getProjectContext?.()?.summary || "",
      instructions: runtime.getProjectInstructions()
        ? {
            sourcePath: runtime.getProjectInstructions().sourcePath,
            preview: runtime.getProjectInstructions().preview
          }
        : null
    }
  };
}

async function handlePrompt(runtime, request, response) {
  const payload = await readJsonBody(request);
  const prompt = String(payload.prompt || "").trim();

  if (!prompt) {
    sendError(response, 400, 'prompt endpoint requires "prompt"');
    return;
  }

  const sessionId = normalizeSessionId(payload.sessionId);
  const result = await runtime.runPrompt(prompt, {
    sessionId,
    updateCurrentSession: payload.activate !== false
  });
  sendJson(response, 200, {
    ok: true,
    sessionId: result.sessionId,
    activeSessionId: runtime.sessionId,
    turns: result.turns,
    output: result.output
  });
}

function canWriteToResponse(response) {
  return !response.writableEnded && !response.destroyed;
}

function startStreamHeartbeat(response, intervalMs) {
  return setInterval(() => {
    if (!canWriteToResponse(response)) {
      return;
    }

    writeEvent(response, {
      type: "stream.heartbeat",
      createdAt: new Date().toISOString()
    });
  }, intervalMs);
}

async function handlePromptStream(runtime, request, response, settings) {
  const payload = await readJsonBody(request);
  const prompt = String(payload.prompt || "").trim();

  if (!prompt) {
    sendError(response, 400, 'prompt stream endpoint requires "prompt"');
    return;
  }

  const sessionId = normalizeSessionId(payload.sessionId);
  startEventStream(response);
  let streamClosed = false;
  const heartbeat = startStreamHeartbeat(response, settings.streamHeartbeatMs);
  request.once?.("close", () => {
    streamClosed = true;
    clearInterval(heartbeat);
  });
  writeEvent(response, {
    type: "stream.started",
    createdAt: new Date().toISOString(),
    heartbeatMs: settings.streamHeartbeatMs
  });
  writeEvent(response, {
    type: "stream.heartbeat",
    createdAt: new Date().toISOString()
  });

  try {
    await runtime.runPrompt(prompt, {
      sessionId,
      updateCurrentSession: payload.activate !== false,
      onEvent(event) {
        if (!streamClosed && canWriteToResponse(response)) {
          writeEvent(response, event);
        }
      }
    });
  } catch (error) {
    if (!streamClosed && canWriteToResponse(response)) {
      writeEvent(response, {
        type: "error",
        createdAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!streamClosed && canWriteToResponse(response)) {
      writeEvent(response, {
        type: "stream.finished",
        createdAt: new Date().toISOString()
      });
      response.end();
    }
  }
}

async function handleListSessions(runtime, url, response) {
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 20);
  sendJson(response, 200, {
    ok: true,
    activeSessionId: runtime.sessionId,
    sessions: await runtime.listSessions(limit)
  });
}

async function handleGetSession(runtime, sessionId, url, response) {
  const normalizedSessionId = normalizeSessionId(sessionId, {
    required: true
  });
  const messages = parsePositiveInteger(url.searchParams.get("messages"), 50);
  const session = await runtime.getSession(normalizedSessionId, {
    messages
  });

  if (!session) {
    sendError(response, 404, `Unknown session: ${normalizedSessionId}`);
    return;
  }

  sendJson(response, 200, {
    ok: true,
    activeSessionId: runtime.sessionId,
    session
  });
}

async function handleSessions(runtime, request, response) {
  const payload = await readJsonBody(request);

  if (payload.clear === true || /^(none|off|clear)$/i.test(String(payload.sessionId || ""))) {
    runtime.resetSession();
    sendJson(response, 200, {
      ok: true,
      activeSessionId: runtime.sessionId,
      session: null
    });
    return;
  }

  if (payload.create === true || !String(payload.sessionId || "").trim()) {
    const session = await runtime.createSession();
    sendJson(response, 200, {
      ok: true,
      activeSessionId: runtime.sessionId,
      session
    });
    return;
  }

  const session = await runtime.setSession(
    normalizeSessionId(payload.sessionId, {
      required: true
    })
  );
  sendJson(response, 200, {
    ok: true,
    activeSessionId: runtime.sessionId,
    session
  });
}

async function handleInit(runtime, request, response) {
  const payload = await readJsonBody(request);
  const report = await runtime.scaffoldProject({
    force: payload.force === true
  });

  sendJson(response, 200, {
    ok: true,
    report
  });
}

async function handleProjectSwitch(runtime, request, response) {
  const payload = await readJsonBody(request);
  const worktree = String(payload.worktree || "").trim();
  const cwd = String(payload.cwd || payload.path || "").trim();

  if (!cwd && !worktree) {
    sendError(response, 400, 'project endpoint requires "cwd", "path", or "worktree"');
    return;
  }

  const report = worktree
    ? await runtime.switchToWorktree(worktree)
    : await runtime.switchProject(cwd);

  sendJson(response, 200, {
    ok: true,
    report,
    state: (await buildStatePayload(runtime)).state
  });
}

async function handleCommand(runtime, commands, request, response) {
  const payload = await readJsonBody(request);
  const command = String(payload.command || "").trim();

  if (!command.startsWith("/")) {
    sendError(response, 400, 'command endpoint requires a slash command in "command"');
    return;
  }

  const result = await commands.execute(command, runtime);
  sendJson(response, 200, {
    ok: true,
    shouldContinue: result.shouldContinue,
    output: result.output
  });
}

async function handleTool(runtime, request, response) {
  const payload = await readJsonBody(request);
  const name = String(payload.name || "").trim();

  if (!name) {
    sendError(response, 400, 'tool endpoint requires "name"');
    return;
  }

  const result = await runtime.runTool(name, payload.input || {});
  sendJson(response, 200, {
    ok: true,
    result
  });
}

export async function routeRequest(runtime, commands, request, response, settings = createBridgeSettings()) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "water-code-bridge",
      uptimeMs: runtime.getUptimeMs?.() || 0,
      requestTimeoutMs: settings.requestTimeoutMs,
      streamHeartbeatMs: settings.streamHeartbeatMs,
      keepAliveTimeoutMs: settings.keepAliveTimeoutMs,
      headersTimeoutMs: settings.headersTimeoutMs
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/state") {
    sendJson(response, 200, await buildStatePayload(runtime));
    return;
  }

  if (request.method === "GET" && url.pathname === "/project") {
    sendJson(response, 200, buildProjectPayload(runtime));
    return;
  }

  if (request.method === "GET" && url.pathname === "/doctor") {
    sendJson(response, 200, {
      ok: true,
      report: await buildDoctorReport(runtime)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/git") {
    sendJson(response, 200, {
      ok: true,
      git: runtime.getGitState?.() || null
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/worktrees") {
    const git = runtime.getGitState?.() || null;
    sendJson(response, 200, {
      ok: true,
      git,
      worktrees: git?.worktrees || []
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/onboard") {
    sendJson(response, 200, {
      ok: true,
      report: await buildOnboardingReport(runtime)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/sessions") {
    await handleListSessions(runtime, url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/sessions") {
    await handleSessions(runtime, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/init") {
    await handleInit(runtime, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/project") {
    await handleProjectSwitch(runtime, request, response);
    return;
  }

  if (request.method === "GET" && sessionMatch) {
    await handleGetSession(runtime, decodeURIComponent(sessionMatch[1]), url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/prompt") {
    await handlePrompt(runtime, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/prompt/stream") {
    await handlePromptStream(runtime, request, response, settings);
    return;
  }

  if (request.method === "POST" && url.pathname === "/command") {
    await handleCommand(runtime, commands, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/tool") {
    await handleTool(runtime, request, response);
    return;
  }

  sendError(response, 404, `Unknown route: ${request.method} ${url.pathname}`);
}

export async function startBridgeServer(runtime, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 8765);
  const commands = new SlashCommandRegistry();
  const settings = createBridgeSettings(options);

  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(runtime, commands, request, response, settings);
    } catch (error) {
      sendError(
        response,
        error?.statusCode || 500,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  server.requestTimeout = settings.requestTimeoutMs;
  server.keepAliveTimeout = settings.keepAliveTimeoutMs;
  server.headersTimeout = settings.headersTimeoutMs;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    host,
    port,
    settings,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}
