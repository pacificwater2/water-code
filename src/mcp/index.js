import { readFile } from "node:fs/promises";
import path from "node:path";
import { createToolResult } from "../core/tool-results.js";
import { McpStdioClient } from "./client.js";

const MCP_CONFIG_PATH = path.join(".water-code", "mcp.json");

function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object" };
  }

  return schema;
}

function buildInputHint(schema) {
  return JSON.stringify(normalizeInputSchema(schema));
}

function extractTextFromContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    return "(empty)";
  }

  return content
    .map(item => {
      if (item?.type === "text") {
        return item.text || "";
      }

      return JSON.stringify(item, null, 2);
    })
    .join("\n\n")
    .trim();
}

export function buildMcpToolName(serverName, toolName) {
  return `mcp.${serverName}.${toolName}`;
}

export async function loadMcpConfig(cwd) {
  const target = path.join(cwd, MCP_CONFIG_PATH);
  let raw = "";

  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsed = JSON.parse(raw);
  const servers = parsed?.servers;

  if (!servers || typeof servers !== "object") {
    return [];
  }

  return Object.entries(servers).map(([name, config]) => ({
    name,
    command: config?.command || "",
    args: Array.isArray(config?.args) ? config.args : [],
    env: config?.env && typeof config.env === "object" ? config.env : {},
    dangerous: config?.dangerous !== false
  }));
}

async function startConfiguredServer(cwd, config) {
  const client = new McpStdioClient({
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
    cwd
  });

  await client.start();
  const tools = await client.listTools();

  return {
    name: config.name,
    status: "connected",
    dangerous: config.dangerous,
    command: config.command,
    args: config.args,
    client,
    tools,
    serverInfo: client.serverInfo,
    instructions: client.instructions,
    stderrLines: client.stderrLines
  };
}

export async function connectMcpServers(cwd) {
  const configs = await loadMcpConfig(cwd);
  const servers = [];

  for (const config of configs) {
    try {
      const connected = await startConfiguredServer(cwd, config);
      servers.push(connected);
    } catch (error) {
      servers.push({
        name: config.name,
        status: "error",
        dangerous: config.dangerous,
        command: config.command,
        args: config.args,
        client: null,
        tools: [],
        serverInfo: null,
        instructions: "",
        stderrLines: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return servers;
}

export async function closeMcpServers(servers = []) {
  await Promise.all(
    servers.map(server => server.client?.close?.()).filter(Boolean)
  );
}

export function createMcpTools(servers = []) {
  const tools = [];

  for (const server of servers) {
    if (server.status !== "connected" || !server.client) {
      continue;
    }

    for (const tool of server.tools) {
      tools.push({
        name: buildMcpToolName(server.name, tool.name),
        description: `[MCP ${server.name}] ${tool.description || tool.title || tool.name}`,
        inputHint: buildInputHint(tool.inputSchema),
        inputSchema: normalizeInputSchema(tool.inputSchema),
        dangerous: server.dangerous,
        permissionGroup: "mcp",
        async execute(input) {
          const result = await server.client.callTool(tool.name, input || {});
          const body = extractTextFromContent(result?.content);

          return createToolResult({
            ok: result?.isError !== true,
            title: `MCP ${server.name}.${tool.name}`,
            summary: result?.isError ? "Remote MCP tool reported an error." : "Remote MCP tool completed.",
            sections: [
              {
                label: "Content",
                body
              }
            ],
            data: {
              server: server.name,
              tool: tool.name
            }
          });
        }
      });
    }
  }

  return tools;
}
