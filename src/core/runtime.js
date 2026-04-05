import { stat } from "node:fs/promises";
import path from "node:path";
import { loadCustomAgents, renderCustomAgentPrompt } from "../agents/custom-agents.js";
import { AgentLoop } from "./agent-loop.js";
import { loadProjectContext } from "./context-loader.js";
import { loadGitState } from "./git-state.js";
import { scaffoldProject as scaffoldProjectFiles } from "./project-scaffold.js";
import { loadProjectInstructions } from "./project-instructions.js";
import { closeMcpServers, connectMcpServers, createMcpTools } from "../mcp/index.js";
import { describePermissionMode, normalizePermissionMode } from "./permissions.js";
import { loadProjectPlugins, renderProjectPluginPrompt } from "../plugins/project-plugins.js";
import { loadProjectSkills, renderProjectSkillPrompt } from "../skills/project-skills.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { BackgroundTaskStore } from "../tasks/store.js";
import { createApprovalStateManager } from "./approval-state.js";
import { createToolResult, normalizeToolResult } from "./tool-results.js";
import { loadCustomCommands } from "../commands/custom-commands.js";
import { createProvider } from "../provider/index.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import { SessionStore } from "../session/store.js";

export async function createRuntime(options) {
  const startedAt = Date.now();
  let currentCwd = path.resolve(options.cwd);
  const provider = createProvider(options.provider);
  const tools = createDefaultToolRegistry();
  let sessionStore = new SessionStore(path.join(currentCwd, ".water-code", "sessions"));
  let backgroundTasks = new BackgroundTaskStore(currentCwd);
  let permissionMode = normalizePermissionMode(options.permissionMode);
  let projectContext = await loadProjectContext(currentCwd);
  let gitState = await loadGitState(currentCwd);
  let projectInstructions = await loadProjectInstructions(currentCwd);
  let mcpServers = await connectMcpServers(currentCwd);
  let customAgents = await loadCustomAgents(currentCwd);
  let customCommands = await loadCustomCommands(currentCwd);
  let projectPlugins = await loadProjectPlugins(currentCwd);
  let projectSkills = await loadProjectSkills(currentCwd);
  const approvalState = createApprovalStateManager();
  let activeAgent = null;
  let activeSkills = [];
  let systemPrompt = "";
  let confirmToolCall = null;

  const agentLoop = new AgentLoop({
    provider,
    tools,
    sessionStore,
    cwd: currentCwd,
    systemPrompt: "",
    maxTurns: options.maxTurns,
    permissionMode
  });

  let currentSessionId = options.sessionId || "";

  function resolveAgent(name) {
    return customAgents.find(agent => agent.name === name) || null;
  }

  function resolveSkills(names) {
    const requested = Array.from(
      new Set(
        (Array.isArray(names) ? names : [names])
          .flatMap(name => String(name || "").split(","))
          .map(name => name.trim())
          .filter(Boolean)
      )
    );

    return requested.map(name => {
      const skill = projectSkills.find(item => item.name === name);
      if (!skill) {
        throw new Error(`Unknown project skill: ${name}`);
      }
      return skill;
    });
  }

  function buildTaskLabel(prompt, label = "") {
    const explicit = String(label || "").trim();
    if (explicit) {
      return explicit;
    }

    return String(prompt || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
  }

  function createPromptRenderContext(selectedAgent, selectedSkills) {
    return {
      cwd: currentCwd,
      permissionMode,
      getProjectContext() {
        return projectContext;
      },
      getGitState() {
        return gitState;
      },
      getProjectInstructions() {
        return projectInstructions;
      },
      getActiveAgent() {
        return selectedAgent;
      },
      getActiveSkills() {
        return selectedSkills;
      }
    };
  }

  function composeSystemPrompt(selectedAgent = activeAgent, selectedSkills = activeSkills) {
    const activeAgentPrompt = selectedAgent
      ? renderCustomAgentPrompt(
          selectedAgent,
          createPromptRenderContext(selectedAgent, selectedSkills)
        )
      : "";
    const activeSkillPrompts = selectedSkills.map(skill => ({
      skill,
      prompt: renderProjectSkillPrompt(
        skill,
        createPromptRenderContext(selectedAgent, selectedSkills)
      )
    }));
    const activePluginPrompts = projectPlugins
      .map(plugin => ({
        plugin,
        prompt: renderProjectPluginPrompt(
          plugin,
          createPromptRenderContext(selectedAgent, selectedSkills)
        )
      }))
      .filter(item => item.prompt);

    return buildSystemPrompt({
      productName: "Water Code",
      cwd: currentCwd,
      tools: tools.describe(),
      responseStyle: provider.nativeToolUse ? "native-tools" : "json-protocol",
      projectContext,
      gitState,
      projectInstructions,
      permissionMode,
      permissionSummary: describePermissionMode(permissionMode),
      activeAgent: selectedAgent,
      activeAgentPrompt,
      activeSkills: selectedSkills,
      activeSkillPrompts,
      activePlugins: projectPlugins,
      activePluginPrompts
    });
  }

  function rebuildSystemPrompt() {
    tools.setGroup("mcp", createMcpTools(mcpServers));
    tools.setGroup(
      "plugins",
      projectPlugins.flatMap(plugin => plugin.tools || [])
    );

    systemPrompt = composeSystemPrompt(activeAgent);
    agentLoop.setCwd(currentCwd);
    agentLoop.setSessionStore(sessionStore);
    agentLoop.setSystemPrompt(systemPrompt);
    agentLoop.setPermissionMode(permissionMode);
    agentLoop.setConfirmToolCall(confirmToolCall);
  }

  function createIsolatedAgentLoop(selectedAgent) {
    const loop = new AgentLoop({
      provider,
      tools,
      sessionStore,
      cwd: currentCwd,
      systemPrompt: composeSystemPrompt(selectedAgent),
      maxTurns: options.maxTurns,
      permissionMode
    });
    loop.setConfirmToolCall(confirmToolCall);
    loop.setToolContextProvider(() => ({ runtime: api }));
    return loop;
  }

  async function ensureProjectDirectory(targetCwd) {
    const stats = await stat(targetCwd);
    if (!stats.isDirectory()) {
      throw new Error(`Project root is not a directory: ${targetCwd}`);
    }
  }

  function reconcileSelections() {
    if (activeAgent) {
      activeAgent = resolveAgent(activeAgent.name);
    }

    activeSkills = activeSkills
      .map(skill => projectSkills.find(item => item.name === skill.name))
      .filter(Boolean);
  }

  if (options.agent) {
    activeAgent = resolveAgent(options.agent);
    if (!activeAgent) {
      throw new Error(`Unknown custom agent: ${options.agent}`);
    }
  }

  if (options.skills?.length) {
    activeSkills = resolveSkills(options.skills);
  }

  rebuildSystemPrompt();

  async function refreshProjectContext() {
    projectContext = await loadProjectContext(currentCwd);
    rebuildSystemPrompt();
    return projectContext;
  }

  async function refreshProjectInstructions() {
    projectInstructions = await loadProjectInstructions(currentCwd);
    rebuildSystemPrompt();
    return projectInstructions;
  }

  async function switchProjectRoot(targetPath, { matchedWorktree = null } = {}) {
    const nextCwd = path.resolve(currentCwd, String(targetPath || "").trim() || ".");
    await ensureProjectDirectory(nextCwd);

    const previousCwd = currentCwd;
    const previousSessionId = currentSessionId;

    if (nextCwd === previousCwd) {
      await refreshProjectContext();
      await api.refreshGitState();
      await refreshProjectInstructions();
      await api.refreshCustomCommands();
      await api.refreshCustomAgents();
      await api.refreshProjectSkills();
      await api.refreshProjectPlugins();
      await api.refreshMcp();
    } else {
      await closeMcpServers(mcpServers);
      currentCwd = nextCwd;
      sessionStore = new SessionStore(path.join(currentCwd, ".water-code", "sessions"));
      backgroundTasks = new BackgroundTaskStore(currentCwd);
      projectContext = await loadProjectContext(currentCwd);
      gitState = await loadGitState(currentCwd);
      projectInstructions = await loadProjectInstructions(currentCwd);
      mcpServers = await connectMcpServers(currentCwd);
      customAgents = await loadCustomAgents(currentCwd);
      customCommands = await loadCustomCommands(currentCwd);
      projectPlugins = await loadProjectPlugins(currentCwd);
      projectSkills = await loadProjectSkills(currentCwd);
      approvalState.reset();
      reconcileSelections();
      currentSessionId = "";
      rebuildSystemPrompt();
    }

    return {
      fromCwd: previousCwd,
      toCwd: currentCwd,
      changed: nextCwd !== previousCwd,
      previousSessionId,
      activeSessionId: currentSessionId,
      activeAgent: activeAgent?.name || "",
      activeSkills: activeSkills.map(skill => skill.name),
      matchedWorktree,
      git: gitState,
      projectSummary: projectContext.summary
    };
  }

  function findWorktree(target) {
    const rawTarget = String(target || "").trim();
    if (!rawTarget) {
      throw new Error("A worktree path or branch name is required.");
    }

    const resolvedTargetPath = path.resolve(currentCwd, rawTarget);

    const match = gitState.worktrees.find(worktree => {
      return (
        worktree.path === rawTarget ||
        worktree.path === resolvedTargetPath ||
        path.basename(worktree.path) === rawTarget ||
        worktree.branch === rawTarget
      );
    });

    if (!match) {
      throw new Error(`No worktree matched: ${rawTarget}`);
    }

    return match;
  }

  const api = {
    get cwd() {
      return currentCwd;
    },
    providerName: provider.name,
    getUptimeMs() {
      return Math.max(0, Date.now() - startedAt);
    },
    get permissionMode() {
      return permissionMode;
    },
    get sessionId() {
      return currentSessionId;
    },
    describeTools() {
      return tools.describe();
    },
    getApprovalStateManager() {
      return approvalState;
    },
    getApprovalState() {
      return approvalState.getSnapshot();
    },
    getMcpServers() {
      return mcpServers;
    },
    getActiveAgent() {
      return activeAgent;
    },
    getCustomAgents() {
      return customAgents;
    },
    getCustomAgent(name) {
      return resolveAgent(name);
    },
    getCustomCommands() {
      return customCommands;
    },
    getCustomCommand(name) {
      return customCommands.find(command => command.name === name) || null;
    },
    getProjectPlugins() {
      return projectPlugins;
    },
    getProjectPlugin(name) {
      return projectPlugins.find(plugin => plugin.name === name) || null;
    },
    getPluginCommands() {
      return projectPlugins.flatMap(plugin => plugin.commands || []);
    },
    getPluginCommand(name) {
      return (
        this.getPluginCommands().find(
          command => command.name === name || (command.aliases || []).includes(name)
        ) || null
      );
    },
    getProjectSkills() {
      return projectSkills;
    },
    getProjectSkill(name) {
      return projectSkills.find(skill => skill.name === name) || null;
    },
    getActiveSkills() {
      return activeSkills;
    },
    describePermissionMode() {
      return describePermissionMode(permissionMode);
    },
    getProjectContext() {
      return projectContext;
    },
    getGitState() {
      return gitState;
    },
    getProjectInstructions() {
      return projectInstructions;
    },
    async refreshProjectContext() {
      return refreshProjectContext();
    },
    async refreshGitState() {
      gitState = await loadGitState(currentCwd);
      rebuildSystemPrompt();
      return gitState;
    },
    async refreshProjectInstructions() {
      return refreshProjectInstructions();
    },
    async refreshMcp() {
      await closeMcpServers(mcpServers);
      mcpServers = await connectMcpServers(currentCwd);
      rebuildSystemPrompt();
      return mcpServers;
    },
    async refreshCustomAgents() {
      customAgents = await loadCustomAgents(currentCwd);
      reconcileSelections();
      rebuildSystemPrompt();
      return customAgents;
    },
    async refreshCustomCommands() {
      customCommands = await loadCustomCommands(currentCwd);
      return customCommands;
    },
    async refreshProjectPlugins() {
      projectPlugins = await loadProjectPlugins(currentCwd);
      rebuildSystemPrompt();
      return projectPlugins;
    },
    async refreshProjectSkills() {
      projectSkills = await loadProjectSkills(currentCwd);
      reconcileSelections();
      rebuildSystemPrompt();
      return projectSkills;
    },
    async scaffoldProject(options = {}) {
      const report = await scaffoldProjectFiles(currentCwd, options);
      await refreshProjectContext();
      await this.refreshGitState();
      await refreshProjectInstructions();
      await this.refreshCustomCommands();
      await this.refreshCustomAgents();
      await this.refreshProjectSkills();
      await this.refreshProjectPlugins();
      await this.refreshMcp();
      return report;
    },
    async listBackgroundTasks(limit = 20) {
      return backgroundTasks.listTasks(limit);
    },
    async listSessions(limit = 20) {
      return sessionStore.list(limit);
    },
    async getSession(sessionId, options = {}) {
      return sessionStore.get(sessionId, options);
    },
    async createSession() {
      const session = await sessionStore.create();
      currentSessionId = session.id;
      return sessionStore.get(session.id, {
        messages: 20
      });
    },
    async setSession(sessionId) {
      if (!sessionId) {
        currentSessionId = "";
        return null;
      }

      const session = await sessionStore.ensure(sessionId);
      currentSessionId = session.id;
      return sessionStore.get(session.id, {
        messages: 20
      });
    },
    async getBackgroundTask(taskId, taskOptions = {}) {
      return backgroundTasks.getTaskReport(taskId, taskOptions);
    },
    async switchProject(targetPath) {
      return switchProjectRoot(targetPath);
    },
    async switchToWorktree(target) {
      const worktree = findWorktree(target);
      return switchProjectRoot(worktree.path, {
        matchedWorktree: worktree
      });
    },
    async launchBackgroundTask({
      label = "",
      prompt,
      agentName = "",
      skills = [],
      providerName = "",
      taskPermissionMode = "",
      maxTurns = 0
    }) {
      const selectedAgent = agentName ? resolveAgent(agentName) : activeAgent;
      if (agentName && !selectedAgent) {
        throw new Error(`Unknown custom agent: ${agentName}`);
      }

      const selectedSkills =
        Array.isArray(skills) && skills.length > 0 ? resolveSkills(skills) : activeSkills;

      return backgroundTasks.launchTask({
        label: buildTaskLabel(prompt, label),
        prompt,
        provider: providerName || provider.name,
        agent: selectedAgent?.name || "",
        skills: selectedSkills.map(skill => skill.name),
        permissionMode: taskPermissionMode || permissionMode,
        maxTurns: maxTurns || options.maxTurns || 6,
        metadata: {
          parentSessionId: currentSessionId || ""
        }
      });
    },
    async cancelBackgroundTask(taskId) {
      return backgroundTasks.cancelTask(taskId);
    },
    async runPromptWithAgent(prompt, agentName, { sessionId = "" } = {}) {
      const selectedAgent = resolveAgent(agentName);
      if (!selectedAgent) {
        throw new Error(`Unknown custom agent: ${agentName}`);
      }

      const loop = createIsolatedAgentLoop(selectedAgent);
      const result = await loop.run(prompt, {
        sessionId
      });

      return {
        agent: selectedAgent,
        ...result
      };
    },
    async runSwarm(prompt, agentNames) {
      const names = Array.from(
        new Set(
          agentNames
            .map(name => String(name || "").trim())
            .filter(Boolean)
        )
      );

      if (names.length === 0) {
        throw new Error("runSwarm requires at least one agent");
      }

      const sections = [];
      const data = [];
      let ok = true;

      for (const name of names) {
        try {
          const result = await this.runPromptWithAgent(prompt, name);
          data.push({
            agent: name,
            ok: true,
            sessionId: result.sessionId
          });
          sections.push({
            label: `${name} (${result.sessionId})`,
            body: result.output
          });
        } catch (error) {
          ok = false;
          const message = error instanceof Error ? error.message : String(error);
          data.push({
            agent: name,
            ok: false,
            error: message
          });
          sections.push({
            label: `${name} (error)`,
            body: message
          });
        }
      }

      return normalizeToolResult(
        createToolResult({
          ok,
          title: `Swarm run across ${names.length} agent${names.length === 1 ? "" : "s"}`,
          summary: ok
            ? "All agent delegates completed."
            : "One or more agent delegates failed.",
          sections,
          data
        }),
        { toolName: "swarm" }
      );
    },
    setActiveAgent(name) {
      if (!name || name === "none" || name === "off") {
        activeAgent = null;
      } else {
        const next = resolveAgent(name);
        if (!next) {
          throw new Error(`Unknown custom agent: ${name}`);
        }
        activeAgent = next;
      }
      rebuildSystemPrompt();
      return activeAgent;
    },
    setActiveSkills(nextSkills) {
      if (
        !nextSkills ||
        (Array.isArray(nextSkills) && nextSkills.length === 0) ||
        nextSkills === "none" ||
        nextSkills === "off"
      ) {
        activeSkills = [];
      } else {
        activeSkills = resolveSkills(nextSkills);
      }
      rebuildSystemPrompt();
      return activeSkills;
    },
    setPermissionMode(nextMode) {
      permissionMode = normalizePermissionMode(nextMode);
      rebuildSystemPrompt();
      return {
        mode: permissionMode,
        summary: describePermissionMode(permissionMode)
      };
    },
    clearApprovalHistory() {
      approvalState.clearHistory();
      return approvalState.getSnapshot();
    },
    resetApprovalPolicies() {
      approvalState.clearPolicies();
      return approvalState.getSnapshot();
    },
    resetApprovals() {
      approvalState.reset();
      return approvalState.getSnapshot();
    },
    async runTool(name, input) {
      return tools.execute(name, input, {
        cwd: currentCwd,
        permissionMode,
        confirmToolCall,
        runtime: api
      });
    },
    resetSession() {
      currentSessionId = "";
    },
    setConfirmToolCall(nextConfirmToolCall) {
      confirmToolCall = nextConfirmToolCall || null;
      agentLoop.setConfirmToolCall(confirmToolCall);
    },
    async runPrompt(prompt, options = {}) {
      const result = await agentLoop.run(prompt, {
        sessionId: options.sessionId || currentSessionId,
        onEvent: options.onEvent
      });
      if (options.updateCurrentSession !== false) {
        currentSessionId = result.sessionId;
      }
      if (typeof options.onEvent === "function") {
        await options.onEvent({
          type: "completed",
          createdAt: new Date().toISOString(),
          sessionId: result.sessionId,
          activeSessionId: currentSessionId,
          turns: result.turns,
          output: result.output
        });
      }
      return result;
    },
    async close() {
      await closeMcpServers(mcpServers);
    }
  };

  agentLoop.setToolContextProvider(() => ({ runtime: api }));
  return api;
}
