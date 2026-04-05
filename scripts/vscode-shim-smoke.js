import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const repoRoot = path.resolve(process.cwd());
const extensionRoot = path.join(repoRoot, "editor", "vscode-water-code");
const manifestPath = path.join(extensionRoot, "package.json");
const readmePath = path.join(extensionRoot, "README.md");
const require = createRequire(import.meta.url);
const shimCli = require("../editor/vscode-water-code/lib/cli.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const readme = await readFile(readmePath, "utf8");

assert(manifest.main === "./extension.js", "VS Code shim manifest must point to extension.js");
assert(Array.isArray(manifest.contributes?.commands), "VS Code shim manifest must contribute commands");
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.refreshPanel"),
  "VS Code shim must expose the refresh panel command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.promptInput"),
  "VS Code shim must expose the prompt input command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.rewriteSelection"),
  "VS Code shim must expose the rewrite selection command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.resumeSession"),
  "VS Code shim must expose the resume session command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.projectState"),
  "VS Code shim must expose the project state command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.switchProject"),
  "VS Code shim must expose the switch project command"
);
assert(
  manifest.contributes.commands.some(command => command.command === "waterCode.useWorktree"),
  "VS Code shim must expose the use worktree command"
);
assert(
  manifest.contributes?.views?.explorer?.some(view => view.id === "waterCode.panel"),
  "VS Code shim must contribute the Water Code explorer panel"
);
assert(
  manifest.contributes?.menus?.["editor/context"]?.some(
    item => item.command === "waterCode.rewriteSelection"
  ),
  "VS Code shim must expose rewrite selection in the editor context menu"
);
assert(
  typeof manifest.contributes?.configuration?.properties?.["waterCode.cliPath"] === "object",
  "VS Code shim must configure waterCode.cliPath"
);

const args = shimCli.buildAdapterArgs({
  provider: "planner",
  operation: "state"
});
assert(args.join(" ") === "--provider planner adapter state", "VS Code shim should build adapter state args");

const events = shimCli.parseJsonLines('{"event":{"type":"completed","output":"done"}}');
assert(events[0]?.event?.type === "completed", "VS Code shim should parse JSON lines");
const projectSummary = shimCli.summarizeProjectEnvelope({
  cwd: "/tmp/next-project",
  steps: [{ operation: "project", report: { toCwd: "/tmp/next-project" } }]
});
assert(projectSummary.toCwd === "/tmp/next-project", "VS Code shim should summarize project envelopes");
const stateSummary = shimCli.summarizeStateEnvelope({
  state: {
    cwd: "/tmp/project",
    provider: "planner",
    sessionId: "wc-session-1",
    activeSkills: ["repo-cartographer"],
    git: {
      summary: "Git main",
      worktrees: [{ path: "/tmp/project" }]
    }
  }
});
assert(stateSummary.cwd === "/tmp/project", "VS Code shim should summarize state envelopes");
assert(stateSummary.worktrees.length === 1, "VS Code shim should expose worktree count");
const promptSummary = shimCli.summarizePromptEnvelope({
  steps: [{ operation: "prompt", output: "```ts\nconst n = 1;\n```" }]
});
assert(promptSummary.output.includes("const n = 1;"), "VS Code shim should summarize prompt envelopes");
assert(
  shimCli.normalizeReplacementText(promptSummary.output) === "const n = 1;",
  "VS Code shim should normalize fenced replacements"
);
const rewritePrompt = shimCli.buildSelectionRewritePrompt({
  filePath: "/tmp/project/src/app.ts",
  languageId: "typescript",
  instruction: "Make the name clearer.",
  selectionText: "const x = 1;"
});
assert(rewritePrompt.includes("Return only the replacement text"), "VS Code shim should build rewrite prompts");
assert(readme.includes("Prompt Input"), "VS Code shim README should mention Prompt Input");
assert(readme.includes("Switch Project"), "VS Code shim README should mention Switch Project");
assert(readme.includes("Use Worktree"), "VS Code shim README should mention Use Worktree");
assert(readme.includes("Refresh Panel"), "VS Code shim README should mention Refresh Panel");
assert(readme.includes("Resume Session"), "VS Code shim README should mention Resume Session");
assert(readme.includes("Explorer"), "VS Code shim README should mention the explorer panel");
assert(readme.includes("Rewrite Selection"), "VS Code shim README should mention Rewrite Selection");

console.log("PASS vscode-shim-manifest");
console.log("PASS vscode-shim-helper");
console.log("PASS vscode-shim-readme");
console.log("\nVS Code shim smoke checks passed.");
