import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const shimCli = require("../editor/vscode-water-code/lib/cli.js");

test("VS Code shim builds adapter args with local and remote options", () => {
  const args = shimCli.buildAdapterArgs({
    cwd: "/tmp/project",
    provider: "planner",
    remoteUrl: "http://127.0.0.1:8765",
    operation: "prompt",
    stream: true,
    input: "read README.md"
  });

  assert.deepEqual(args, [
    "--cwd",
    path.resolve("/tmp/project"),
    "--provider",
    "planner",
    "--remote-url",
    "http://127.0.0.1:8765",
    "adapter",
    "prompt",
    "--stream",
    "--input",
    "read README.md"
  ]);
});

test("VS Code shim parses JSON lines and summarizes prompt events", () => {
  const events = shimCli.parseJsonLines([
    '{"event":{"type":"tool.call","toolCall":{"name":"read_file"}}}',
    '{"event":{"type":"completed","output":"done"}}'
  ].join("\n"));

  const summary = shimCli.summarizePromptEvents(events);
  assert.deepEqual(summary.toolCalls, ["read_file"]);
  assert.equal(summary.finalOutput, "done");
});

test("VS Code shim summarizes project switch envelopes", () => {
  const summary = shimCli.summarizeProjectEnvelope({
    cwd: "/tmp/next-project",
    steps: [
      {
        operation: "project",
        report: {
          fromCwd: "/tmp/project",
          toCwd: "/tmp/next-project",
          changed: true,
          matchedWorktree: {
            branch: "feature/review"
          }
        }
      }
    ]
  });

  assert.equal(summary.fromCwd, "/tmp/project");
  assert.equal(summary.toCwd, "/tmp/next-project");
  assert.equal(summary.changed, true);
  assert.equal(summary.matchedWorktree?.branch, "feature/review");
});

test("VS Code shim summarizes adapter state envelopes for the panel", () => {
  const summary = shimCli.summarizeStateEnvelope({
    state: {
      cwd: "/tmp/project",
      provider: "planner",
      sessionId: "wc-session-1",
      permissionMode: {
        mode: "accept-edits"
      },
      activeAgent: "reviewer",
      activeSkills: ["repo-cartographer"],
      git: {
        summary: "Git main | clean | 2 worktrees",
        worktrees: [{ path: "/tmp/project", current: true }]
      },
      projectPlugins: [{ name: "workspace-tools" }],
      customCommands: [{ name: "readme-snapshot" }],
      customAgents: [{ name: "reviewer" }],
      recentSessions: [{ id: "wc-session-1" }],
      backgroundTasks: [{ id: "wctask-1" }],
      projectSkills: [{ name: "repo-cartographer" }],
      mcpServers: [{ name: "local_echo", status: "ready" }],
      tools: [{ name: "read_file" }]
    }
  });

  assert.equal(summary.cwd, "/tmp/project");
  assert.equal(summary.provider, "planner");
  assert.equal(summary.permissionMode, "accept-edits");
  assert.equal(summary.activeAgent, "reviewer");
  assert.equal(summary.activeSkills[0], "repo-cartographer");
  assert.equal(summary.gitSummary, "Git main | clean | 2 worktrees");
  assert.equal(summary.worktrees.length, 1);
  assert.equal(summary.projectPlugins.length, 1);
  assert.equal(summary.recentSessions[0].id, "wc-session-1");
  assert.equal(summary.mcpServers[0].name, "local_echo");
});

test("VS Code shim summarizes prompt envelopes and normalizes replacement text", () => {
  const promptSummary = shimCli.summarizePromptEnvelope({
    steps: [
      {
        operation: "prompt",
        output: "```js\nconst next = value + 1;\n```",
        sessionId: "wc-session-2",
        activeSessionId: "wc-session-2"
      }
    ]
  });

  assert.equal(promptSummary.output.includes("const next"), true);
  assert.equal(promptSummary.sessionId, "wc-session-2");
  assert.equal(
    shimCli.normalizeReplacementText(promptSummary.output),
    "const next = value + 1;"
  );
});

test("VS Code shim builds a rewrite-selection prompt", () => {
  const prompt = shimCli.buildSelectionRewritePrompt({
    filePath: "/tmp/project/src/app.js",
    languageId: "javascript",
    instruction: "Rename the variable and keep behavior the same.",
    selectionText: "const x = value + 1;"
  });

  assert.match(prompt, /File: \/tmp\/project\/src\/app\.js/);
  assert.match(prompt, /Language: javascript/);
  assert.match(prompt, /Rename the variable/);
  assert.match(prompt, /Selected text:/);
  assert.match(prompt, /const x = value \+ 1;/);
});
