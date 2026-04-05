const path = require("node:path");

function buildAdapterArgs(options = {}) {
  const args = [];

  if (options.cwd) {
    args.push("--cwd", path.resolve(options.cwd));
  }

  if (options.provider) {
    args.push("--provider", String(options.provider));
  }

  if (options.remoteUrl) {
    args.push("--remote-url", String(options.remoteUrl));
  }

  args.push("adapter", String(options.operation || ""));

  if (options.stream) {
    args.push("--stream");
  }

  if (options.force) {
    args.push("--force");
  }

  if (options.input) {
    args.push("--input", String(options.input));
  }

  return args;
}

function parseJsonLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function summarizePromptEvents(events = []) {
  const toolCalls = [];
  let finalOutput = "";

  for (const item of events) {
    const event = item?.event || item;
    if (!event || typeof event !== "object") {
      continue;
    }

    if (event.type === "tool.call" && event.toolCall?.name) {
      toolCalls.push(event.toolCall.name);
    }

    if (event.type === "completed" && event.output) {
      finalOutput = event.output;
    }
  }

  return {
    toolCalls,
    finalOutput
  };
}

function summarizePromptEnvelope(envelope = {}) {
  const step = Array.isArray(envelope.steps)
    ? envelope.steps.find(item => item?.operation === "prompt")
    : null;

  return {
    output: step?.output || "",
    sessionId: step?.sessionId || "",
    activeSessionId: step?.activeSessionId || ""
  };
}

function summarizeProjectEnvelope(envelope = {}) {
  const step = Array.isArray(envelope.steps)
    ? envelope.steps.find(item => item?.operation === "project")
    : null;
  const report = step?.report || {};

  return {
    fromCwd: report.fromCwd || "",
    toCwd: report.toCwd || envelope.cwd || "",
    changed: report.changed !== false,
    matchedWorktree: report.matchedWorktree || null
  };
}

function summarizeStateEnvelope(envelope = {}) {
  const state = envelope?.state || {};
  const git = state.git || {};

  return {
    cwd: state.cwd || envelope.cwd || "",
    provider: state.provider || "",
    sessionId: state.sessionId || "",
    permissionMode:
      typeof state.permissionMode === "string"
        ? state.permissionMode
        : state.permissionMode?.mode || "",
    activeAgent: state.activeAgent || "",
    activeSkills: Array.isArray(state.activeSkills) ? state.activeSkills : [],
    gitSummary: git.summary || "",
    worktrees: Array.isArray(git.worktrees) ? git.worktrees : [],
    projectPlugins: Array.isArray(state.projectPlugins) ? state.projectPlugins : [],
    projectInstructions: state.projectInstructions || null,
    tools: Array.isArray(state.tools) ? state.tools : [],
    customCommands: Array.isArray(state.customCommands) ? state.customCommands : [],
    customAgents: Array.isArray(state.customAgents) ? state.customAgents : [],
    recentSessions: Array.isArray(state.recentSessions) ? state.recentSessions : [],
    backgroundTasks: Array.isArray(state.backgroundTasks) ? state.backgroundTasks : [],
    projectSkills: Array.isArray(state.projectSkills) ? state.projectSkills : [],
    mcpServers: Array.isArray(state.mcpServers) ? state.mcpServers : []
  };
}

function normalizeReplacementText(text) {
  const value = String(text || "");
  const fenced = value.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fenced) {
    return fenced[1];
  }
  return value;
}

function buildSelectionRewritePrompt(options = {}) {
  const filePath = String(options.filePath || "(untitled)");
  const languageId = String(options.languageId || "text");
  const instruction = String(options.instruction || "").trim();
  const selectionText = String(options.selectionText || "");

  return [
    "You are editing code inside Water Code's VS Code integration.",
    `File: ${filePath}`,
    `Language: ${languageId}`,
    "",
    "Task:",
    instruction || "Improve the selected text.",
    "",
    "Return only the replacement text for the selected region.",
    "Do not add Markdown fences.",
    "Do not include commentary, bullets, or explanations.",
    "",
    "Selected text:",
    selectionText
  ].join("\n");
}

module.exports = {
  buildAdapterArgs,
  buildSelectionRewritePrompt,
  normalizeReplacementText,
  parseJsonLines,
  summarizePromptEnvelope,
  summarizePromptEvents,
  summarizeProjectEnvelope,
  summarizeStateEnvelope
};
