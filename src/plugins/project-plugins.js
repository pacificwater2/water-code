import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN_ROOT = path.join(".water-code", "plugins");
const SUPPORTED_EXTENSIONS = new Set([".js", ".mjs"]);

function interpolateTemplate(template, values) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? "");
    }
    return "";
  });
}

function normalizePluginCommand(command, plugin, sourcePath) {
  if (!command || typeof command !== "object") {
    throw new Error(`Plugin ${plugin.name} exported an invalid command.`);
  }

  if (!command.name || typeof command.name !== "string") {
    throw new Error(`Plugin ${plugin.name} has a command without a valid name.`);
  }

  if (typeof command.execute !== "function") {
    throw new Error(`Plugin command ${command.name} must define execute().`);
  }

  return {
    ...command,
    kind: "plugin",
    pluginName: plugin.name,
    sourcePath
  };
}

function normalizePluginTool(tool, plugin) {
  if (!tool || typeof tool !== "object") {
    throw new Error(`Plugin ${plugin.name} exported an invalid tool.`);
  }

  if (!tool.name || typeof tool.name !== "string") {
    throw new Error(`Plugin ${plugin.name} has a tool without a valid name.`);
  }

  if (typeof tool.execute !== "function") {
    throw new Error(`Plugin tool ${tool.name} must define execute().`);
  }

  return {
    description: "Plugin tool",
    inputHint: "{}",
    inputSchema: {
      type: "object",
      additionalProperties: true
    },
    ...tool,
    pluginName: plugin.name
  };
}

function normalizePluginDefinition(moduleValue, fileName, sourcePath) {
  const exported = moduleValue?.default || moduleValue?.plugin || moduleValue;
  if (!exported || typeof exported !== "object") {
    throw new Error(`Plugin ${fileName} did not export a plugin object.`);
  }

  const name = String(exported.name || path.basename(fileName, path.extname(fileName))).trim();
  if (!name) {
    throw new Error(`Plugin ${fileName} is missing a valid name.`);
  }

  const plugin = {
    name,
    description: String(exported.description || "Project plugin").trim(),
    prompt: exported.prompt || "",
    sourcePath
  };

  plugin.commands = Array.isArray(exported.commands)
    ? exported.commands.map(command => normalizePluginCommand(command, plugin, sourcePath))
    : [];
  plugin.tools = Array.isArray(exported.tools)
    ? exported.tools.map(tool => normalizePluginTool(tool, plugin))
    : [];

  return plugin;
}

export async function loadProjectPlugins(cwd) {
  const root = path.join(cwd, PLUGIN_ROOT);
  let entries = [];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const plugins = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      continue;
    }

    const sourcePath = path.join(root, entry.name);
    const moduleUrl = `${pathToFileURL(sourcePath).href}?t=${Date.now()}`;
    const imported = await import(moduleUrl);
    plugins.push(normalizePluginDefinition(imported, entry.name, sourcePath));
  }

  return plugins;
}

export function renderProjectPluginPrompt(plugin, runtime) {
  if (typeof plugin.prompt === "function") {
    const rendered = plugin.prompt(runtime);
    return String(rendered ?? "").trim();
  }

  return interpolateTemplate(plugin.prompt || "", {
    cwd: runtime.cwd,
    project_summary: runtime.getProjectContext().summary,
    projectSummary: runtime.getProjectContext().summary,
    permission_mode: runtime.permissionMode,
    permissionMode: runtime.permissionMode,
    active_agent: runtime.getActiveAgent?.()?.name || "none",
    activeAgent: runtime.getActiveAgent?.()?.name || "none",
    active_skills: runtime.getActiveSkills?.().map(skill => skill.name).join(", ") || "",
    activeSkills: runtime.getActiveSkills?.().map(skill => skill.name).join(", ") || "",
    plugin_name: plugin.name,
    pluginName: plugin.name
  }).trim();
}
