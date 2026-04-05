import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const COMMAND_ROOT = path.join(".water-code", "commands");
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
    return "Custom project command";
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

function createCustomCommandDefinition({ name, description, argumentHint, template, sourcePath }) {
  return {
    kind: "custom",
    name,
    description,
    usage: `/${name}${argumentHint ? ` ${argumentHint}` : " [args]"}`,
    template,
    sourcePath
  };
}

export async function loadCustomCommands(cwd) {
  const root = path.join(cwd, COMMAND_ROOT);
  let entries = [];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const commands = [];

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
    const template = stripFence(body);

    if (!name || !template) {
      continue;
    }

    commands.push(
      createCustomCommandDefinition({
        name,
        description: attributes.description || inferDescription(body),
        argumentHint: attributes.argumentHint || attributes.arguments || "",
        template,
        sourcePath
      })
    );
  }

  return commands;
}

export function formatCustomCommandPrompt(command, runtime, args) {
  return interpolateTemplate(command.template, {
    args,
    cwd: runtime.cwd,
    project_summary: runtime.getProjectContext().summary,
    projectSummary: runtime.getProjectContext().summary,
    permission_mode: runtime.permissionMode,
    permissionMode: runtime.permissionMode,
    agent_name: runtime.getActiveAgent()?.name || "",
    agentName: runtime.getActiveAgent()?.name || "",
    command_name: command.name,
    commandName: command.name
  }).trim();
}

export function createCustomCommand(command) {
  return {
    name: command.name,
    description: command.description,
    usage: command.usage,
    kind: "custom",
    sourcePath: command.sourcePath,
    async execute({ runtime, args }) {
      const prompt = formatCustomCommandPrompt(command, runtime, args);

      if (!prompt) {
        throw new Error(`Custom command /${command.name} produced an empty prompt`);
      }

      const result = await runtime.runPrompt(prompt);
      return {
        output: result.output.endsWith("\n") ? result.output : `${result.output}\n`
      };
    }
  };
}
