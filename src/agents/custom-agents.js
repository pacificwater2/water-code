import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const AGENT_ROOT = path.join(".water-code", "agents");
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

function stripFence(text) {
  return String(text ?? "").trim();
}

function parseFrontmatter(text) {
  const source = String(text ?? "");

  if (!source.startsWith("---\n")) {
    return {
      attributes: {},
      body: source
    };
  }

  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      attributes: {},
      body: source
    };
  }

  const rawAttributes = source.slice(4, end).split("\n");
  const attributes = {};

  for (const line of rawAttributes) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      attributes[key] = value;
    }
  }

  return {
    attributes,
    body: source.slice(end + 5)
  };
}

function inferDescription(body) {
  const lines = String(body ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "Custom project agent";
  }

  return lines[0].replace(/^#+\s*/, "").slice(0, 120);
}

function interpolateTemplate(template, values) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? "");
    }
    return "";
  });
}

export async function loadCustomAgents(cwd) {
  const root = path.join(cwd, AGENT_ROOT);
  let entries = [];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const agents = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      continue;
    }

    const sourcePath = path.join(root, entry.name);
    const raw = await readFile(sourcePath, "utf8");
    const { attributes, body } = parseFrontmatter(raw);
    const name = path.basename(entry.name, extension);
    const prompt = stripFence(body);

    if (!name || !prompt) {
      continue;
    }

    agents.push({
      name,
      description: attributes.description || inferDescription(body),
      prompt,
      sourcePath
    });
  }

  return agents;
}

export function renderCustomAgentPrompt(agent, runtime) {
  return interpolateTemplate(agent.prompt, {
    cwd: runtime.cwd,
    project_summary: runtime.getProjectContext().summary,
    projectSummary: runtime.getProjectContext().summary,
    permission_mode: runtime.permissionMode,
    permissionMode: runtime.permissionMode,
    agent_name: agent.name,
    agentName: agent.name
  }).trim();
}
