import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

function createJsonRpcRequest(id, method, params) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

function createJsonRpcNotification(method, params) {
  return {
    jsonrpc: "2.0",
    method,
    params
  };
}

function formatErrorPayload(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  if (error.message) {
    return String(error.message);
  }

  return JSON.stringify(error);
}

export class McpStdioClient {
  constructor({ name, command, args = [], env = {}, cwd }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrLines = [];
    this.serverInfo = null;
    this.capabilities = {};
    this.instructions = "";
  }

  async start() {
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutReader = readline.createInterface({
      input: this.child.stdout
    });

    stdoutReader.on("line", line => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch (error) {
        this.rejectAll(new Error(`Invalid MCP message from ${this.name}: ${trimmed}`));
      }
    });

    this.child.stderr.on("data", chunk => {
      const lines = String(chunk)
        .split(/\r?\n/g)
        .map(line => line.trim())
        .filter(Boolean);

      this.stderrLines.push(...lines);
      if (this.stderrLines.length > 20) {
        this.stderrLines = this.stderrLines.slice(-20);
      }
    });

    this.child.on("error", error => {
      this.rejectAll(error);
    });

    this.child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `MCP server ${this.name} exited${code !== null ? ` with code ${code}` : ""}${signal ? ` via ${signal}` : ""}`
        )
      );
    });

    const init = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "water-code",
        version: "0.1.0"
      }
    });

    this.serverInfo = init.serverInfo || null;
    this.capabilities = init.capabilities || {};
    this.instructions = init.instructions || "";

    this.notify("notifications/initialized");
  }

  handleMessage(message) {
    if (typeof message.id !== "undefined") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(formatErrorPayload(message.error)));
        return;
      }

      pending.resolve(message.result);
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(payload) {
    if (!this.child?.stdin) {
      throw new Error(`MCP server ${this.name} is not running`);
    }

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(createJsonRpcRequest(id, method, params));
    });
  }

  notify(method, params = {}) {
    this.send(createJsonRpcNotification(method, params));
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args = {}) {
    return this.request("tools/call", {
      name,
      arguments: args
    });
  }

  async close() {
    if (!this.child) {
      return;
    }

    this.child.kill();
    this.child = null;
  }
}
