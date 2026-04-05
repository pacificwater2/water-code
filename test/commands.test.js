import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SlashCommandRegistry } from "../src/commands/index.js";

function createRuntimeStub(overrides = {}) {
  const state = {
    activeSkills: [],
    activeAgent: null
  };

  return {
    cwd: "/tmp/project",
    providerName: "planner",
    permissionMode: "ask",
    sessionId: "",
    describePermissionMode() {
      return "Ask before dangerous tools when interactive; otherwise deny.";
    },
    getApprovalState() {
      return {
        allowedTools: [],
        allowedGroups: [],
        recent: []
      };
    },
    clearApprovalHistory() {
      return this.getApprovalState();
    },
    resetApprovalPolicies() {
      return this.getApprovalState();
    },
    resetApprovals() {
      return this.getApprovalState();
    },
    describeTools() {
      return [];
    },
    getProjectContext() {
      return {
        summary: "Project root: /tmp/project"
      };
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
    getProjectInstructions() {
      return null;
    },
    getCustomCommands() {
      return [];
    },
    getCustomCommand() {
      return null;
    },
    getPluginCommands() {
      return [];
    },
    getPluginCommand() {
      return null;
    },
    getProjectPlugins() {
      return [];
    },
    getProjectSkills() {
      return [];
    },
    getActiveSkills() {
      return state.activeSkills;
    },
    setActiveSkills(nextSkills) {
      state.activeSkills = Array.isArray(nextSkills) ? nextSkills : [];
      return state.activeSkills;
    },
    getCustomAgents() {
      return [];
    },
    getActiveAgent() {
      return state.activeAgent;
    },
    setActiveAgent() {
      return null;
    },
    getMcpServers() {
      return [];
    },
    async refreshProjectPlugins() {
      return [];
    },
    async refreshGitState() {
      return this.getGitState();
    },
    async listSessions() {
      return [];
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
    async switchProject(targetPath) {
      return {
        changed: true,
        fromCwd: "/tmp/project",
        toCwd: path.resolve("/tmp/project", targetPath),
        activeSessionId: "",
        git: this.getGitState(),
        matchedWorktree: null
      };
    },
    async switchToWorktree(target) {
      return {
        changed: true,
        fromCwd: "/tmp/project",
        toCwd: `/tmp/${target}`,
        activeSessionId: "",
        git: this.getGitState(),
        matchedWorktree: {
          path: `/tmp/${target}`,
          branch: target
        }
      };
    },
    async refreshProjectInstructions() {
      return null;
    },
    async refreshProjectSkills() {
      return [];
    },
    async refreshMcp() {
      return [];
    },
    async refreshCustomAgents() {
      return [];
    },
    async refreshCustomCommands() {
      return [];
    },
    async runTool() {
      return {
        rendered: "OK tool result"
      };
    },
    async listBackgroundTasks() {
      return [];
    },
    async launchBackgroundTask() {
      return {
        id: "wctask-123",
        label: "demo task",
        status: "queued",
        provider: "planner",
        agent: "",
        skills: []
      };
    },
    async getBackgroundTask() {
      return null;
    },
    async cancelBackgroundTask(taskId) {
      return {
        id: taskId,
        label: "demo task",
        status: "cancelling"
      };
    },
    ...overrides
  };
}

test("help includes plugin command source information", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    getPluginCommand(name) {
      if (name !== "plugin-status") {
        return null;
      }

      return {
        name: "plugin-status",
        description: "Show plugin status",
        usage: "/plugin-status",
        sourcePath: "/tmp/project/.water-code/plugins/workspace-tools.js",
        async execute() {
          return { output: "ok\n" };
        }
      };
    }
  });

  const result = await registry.execute("/help plugin-status", runtime);
  assert.match(result.output, /\/plugin-status/);
  assert.match(result.output, /Source: \/tmp\/project\/\.water-code\/plugins\/workspace-tools\.js/);
});

test("task-run parses label, agent, skills, and prompt correctly", async () => {
  const registry = new SlashCommandRegistry();
  let received = null;
  const runtime = createRuntimeStub({
    async launchBackgroundTask(input) {
      received = input;
      return {
        id: "wctask-123",
        label: input.label,
        status: "queued",
        provider: "planner",
        agent: input.agentName || "",
        skills: input.skills || []
      };
    }
  });

  const result = await registry.execute(
    "/task-run --label nightly --agent reviewer --skills repo-cartographer,safe-editor ::: read README.md",
    runtime
  );

  assert.deepEqual(received, {
    prompt: "read README.md",
    label: "nightly",
    agentName: "reviewer",
    skills: ["repo-cartographer", "safe-editor"]
  });
  assert.match(result.output, /Started background task wctask-123/);
});

test("approvals command renders and clears approval state", async () => {
  const registry = new SlashCommandRegistry();
  let cleared = "";
  const runtime = createRuntimeStub({
    getApprovalState() {
      return {
        allowedTools: ["bash"],
        allowedGroups: ["shell"],
        recent: [
          {
            createdAt: "2026-04-05T00:00:00.000Z",
            allowed: true,
            source: "interactive",
            toolName: "bash",
            permissionGroup: "shell",
            inputPreview: "{\"command\":\"pwd\"}"
          }
        ]
      };
    },
    clearApprovalHistory() {
      cleared = "history";
    },
    resetApprovalPolicies() {
      cleared = "policies";
    },
    resetApprovals() {
      cleared = "all";
    }
  });

  const shown = await registry.execute("/approvals", runtime);
  assert.match(shown.output, /Remembered approvals:/);
  assert.match(shown.output, /tool:bash/);
  assert.match(shown.output, /group:shell/);

  const clearedHistory = await registry.execute("/approvals clear", runtime);
  assert.equal(cleared, "history");
  assert.match(clearedHistory.output, /Approval history cleared/);

  const resetPolicies = await registry.execute("/approvals reset", runtime);
  assert.equal(cleared, "policies");
  assert.match(resetPolicies.output, /Remembered approvals cleared/);

  const wiped = await registry.execute("/approvals wipe", runtime);
  assert.equal(cleared, "all");
  assert.match(wiped.output, /cleared/);
});

test("task-show returns unknown message when report is missing", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    async getBackgroundTask() {
      return null;
    }
  });

  const result = await registry.execute("/task-show wctask-missing", runtime);
  assert.match(result.output, /Unknown background task: wctask-missing/);
});

test("skill command clears active skills with none", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    getActiveSkills() {
      return [{ name: "repo-cartographer", description: "Map repos", sourcePath: "/tmp/skill.md" }];
    },
    setActiveSkills(nextSkills) {
      assert.deepEqual(nextSkills, []);
      return [];
    }
  });

  const result = await registry.execute("/skill none", runtime);
  assert.match(result.output, /Active skills cleared/);
});

test("instructions command shows source path and content", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    getProjectInstructions() {
      return {
        sourcePath: "/tmp/project/WATER.md",
        content: "Prefer small, reviewable patches."
      };
    }
  });

  const result = await registry.execute("/instructions", runtime);
  assert.match(result.output, /Source: \/tmp\/project\/WATER\.md/);
  assert.match(result.output, /Prefer small, reviewable patches\./);
});

test("sessions command lists saved sessions", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
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
    }
  });

  const result = await registry.execute("/sessions --limit 5", runtime);
  assert.match(result.output, /wc-session-1/);
  assert.match(result.output, /messages=4/);
});

test("git and worktrees commands render runtime Git state", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub();

  const gitResult = await registry.execute("/git", runtime);
  assert.match(gitResult.output, /Branch: main/);
  assert.match(gitResult.output, /ahead 1/i);

  const worktreeResult = await registry.execute("/worktrees", runtime);
  assert.match(worktreeResult.output, /Git worktrees/);
  assert.match(worktreeResult.output, /\/tmp\/project/);
});

test("project and worktree-use commands call runtime switching helpers", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub();

  const projectResult = await registry.execute('/project "../next-project"', runtime);
  assert.match(projectResult.output, /Switched project root/);
  assert.match(projectResult.output, /next-project/);

  const worktreeResult = await registry.execute("/worktree-use feature-review", runtime);
  assert.match(worktreeResult.output, /Matched worktree/);
  assert.match(worktreeResult.output, /branch=feature-review/);
});

test("session command can create and activate a new session", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    async createSession() {
      return {
        id: "wc-session-new",
        messages: []
      };
    }
  });

  const result = await registry.execute("/session new", runtime);
  assert.match(result.output, /Created and activated session wc-session-new/);
});

test("doctor command renders a health report", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    async listSessions() {
      return [];
    },
    getProjectInstructions() {
      return {
        sourcePath: "/tmp/project/WATER.md",
        content: "Prefer small patches."
      };
    }
  });

  const result = await registry.execute("/doctor", runtime);
  assert.match(result.output, /Water Code Doctor/);
  assert.match(result.output, /Provider: planner/);
  assert.match(result.output, /\[OK\] provider:/);
});

test("onboard command renders recommended next steps", async () => {
  const registry = new SlashCommandRegistry();
  const runtime = createRuntimeStub({
    getProjectContext() {
      return {
        summary: "Project root: /tmp/project",
        keyFiles: ["README.md"]
      };
    },
    getProjectInstructions() {
      return {
        sourcePath: "/tmp/project/WATER.md",
        content: "Prefer small patches."
      };
    },
    getCustomCommands() {
      return [
        {
          name: "readme-snapshot",
          description: "Summarize the README"
        }
      ];
    },
    async listSessions() {
      return [
        {
          id: "wc-session-1",
          updatedAt: "2026-04-04T00:00:00.000Z",
          messageCount: 2
        }
      ];
    }
  });

  const result = await registry.execute("/onboard", runtime);
  assert.match(result.output, /Water Code Onboarding/);
  assert.match(result.output, /Initialized: yes/);
  assert.match(result.output, /README: yes/);
  assert.match(result.output, /\/doctor/);
  assert.match(result.output, /\/readme-snapshot/);
  assert.match(result.output, /\/sessions/);
});

test("init command scaffolds starter files", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "water-code-init-command-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const registry = new SlashCommandRegistry();
  let refreshCount = 0;
  const runtime = createRuntimeStub({
    cwd: root,
    async scaffoldProject() {
      const { scaffoldProject } = await import("../src/core/project-scaffold.js");
      refreshCount += 1;
      return scaffoldProject(root);
    }
  });

  const result = await registry.execute("/init", runtime);
  assert.match(result.output, /Initialized Water Code scaffolding/);
  assert.equal(refreshCount, 1);
  assert.match(await readFile(path.join(root, "WATER.md"), "utf8"), /Water Code Instructions/);
});
