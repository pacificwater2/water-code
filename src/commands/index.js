import { tokenize } from "./tokenize.js";
import { createCustomCommand } from "./custom-commands.js";
import { buildDoctorReport, renderDoctorReport } from "../core/doctor.js";
import { renderGitStatus, renderGitWorktrees } from "../core/git-state.js";
import { buildOnboardingReport, renderOnboardingReport } from "../core/onboarding.js";
import { renderScaffoldReport } from "../core/project-scaffold.js";
import { buildMcpToolName } from "../mcp/index.js";

function parseSlashInput(input) {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    throw new Error(`Slash commands must start with "/": ${input}`);
  }

  const content = trimmed.slice(1).trim();
  if (!content) {
    return {
      name: "help",
      args: "",
      tokens: []
    };
  }

  const firstWhitespace = content.search(/\s/);
  if (firstWhitespace === -1) {
    return {
      name: content,
      args: "",
      tokens: []
    };
  }

  const name = content.slice(0, firstWhitespace);
  const args = content.slice(firstWhitespace + 1).trim();

  return {
    name,
    args,
    tokens: tokenize(args)
  };
}

function splitWriteArgs(rawArgs) {
  const marker = ":::";
  const index = rawArgs.indexOf(marker);

  if (index === -1) {
    return {
      left: rawArgs.trim(),
      right: ""
    };
  }

  return {
    left: rawArgs.slice(0, index).trim(),
    right: rawArgs.slice(index + marker.length)
  };
}

function splitCsvList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function splitPatchArgs(rawArgs) {
  const { left, right } = splitWriteArgs(rawArgs);
  const marker = ">>>";
  const index = right.indexOf(marker);

  if (index === -1) {
    return {
      left,
      oldText: "",
      newText: ""
    };
  }

  return {
    left,
    oldText: right.slice(0, index).trim(),
    newText: right.slice(index + marker.length).trim()
  };
}

function parseIntegerOption(tokens, flag, fallback) {
  const index = tokens.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  const value = Number(tokens[index + 1]);
  if (!Number.isInteger(value)) {
    throw new Error(`${flag} expects an integer`);
  }

  return value;
}

function parseJsonObject(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const value = JSON.parse(trimmed);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }

  return value;
}

function parseStringOption(tokens, flag, fallback = "") {
  const index = tokens.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  return String(tokens[index + 1] || fallback);
}

function formatToolList(runtime) {
  return runtime
    .describeTools()
    .map(
      tool =>
        `- ${tool.name}${tool.dangerous ? ` [dangerous:${tool.permissionGroup || "dangerous"}]` : ""}: ${tool.description}`
    )
    .join("\n");
}

function formatProjectContext(runtime) {
  return runtime.getProjectContext().summary;
}

function formatProjectInstructions(runtime) {
  const instructions = runtime.getProjectInstructions?.();

  if (!instructions) {
    return [
      "No project instructions found.",
      "",
      `Create ${runtime.cwd}/WATER.md or ${runtime.cwd}/.water-code/WATER.md`
    ].join("\n");
  }

  return [
    `Source: ${instructions.sourcePath}`,
    "",
    instructions.content
  ].join("\n");
}

function formatCommandResult(result) {
  const output = result.rendered || result.content || "";
  return output.endsWith("\n") ? output : `${output}\n`;
}

function formatPermissions(runtime) {
  return [
    `Permission mode: ${runtime.permissionMode}`,
    "",
    runtime.describePermissionMode()
  ].join("\n");
}

function formatApprovals(runtime) {
  const snapshot = runtime.getApprovalState?.() || {
    allowedTools: [],
    allowedGroups: [],
    recent: []
  };
  const lines = [
    `Permission mode: ${runtime.permissionMode}`,
    runtime.describePermissionMode()
  ];

  lines.push("", "Remembered approvals:");
  if (snapshot.allowedTools.length === 0 && snapshot.allowedGroups.length === 0) {
    lines.push("- none");
  } else {
    for (const toolName of snapshot.allowedTools) {
      lines.push(`- tool:${toolName}`);
    }
    for (const group of snapshot.allowedGroups) {
      lines.push(`- group:${group}`);
    }
  }

  lines.push("", "Recent decisions:");
  if (snapshot.recent.length === 0) {
    lines.push("- none");
  } else {
    for (const item of snapshot.recent.slice(0, 8)) {
      const parts = [
        item.createdAt || "",
        item.allowed ? "allow" : "deny",
        item.source || "",
        item.toolName || "",
        item.permissionGroup ? `[${item.permissionGroup}]` : "",
        item.persistedScope ? `remember=${item.persistedScope}` : "",
        item.inputPreview ? `input=${item.inputPreview}` : ""
      ].filter(Boolean);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  lines.push(
    "",
    "Use /approvals clear to clear history, /approvals reset to clear remembered approvals, or /approvals wipe to clear both."
  );

  return lines.join("\n");
}

function formatProject(runtime) {
  return [
    `Project root: ${runtime.cwd}`,
    `Session: ${runtime.sessionId || "(new session on next prompt)"}`,
    `Git: ${runtime.getGitState()?.summary || "No Git repository detected."}`
  ].join("\n");
}

function formatProjectSwitchReport(report) {
  const lines = [
    report.changed
      ? `Switched project root to ${report.toCwd}.`
      : `Project root refreshed at ${report.toCwd}.`,
    `Previous root: ${report.fromCwd}`,
    `Session: ${report.activeSessionId || "(reset)"}`,
    `Git: ${report.git?.summary || "No Git repository detected."}`
  ];

  if (report.matchedWorktree) {
    lines.push(
      `Matched worktree: ${report.matchedWorktree.path}${
        report.matchedWorktree.branch ? ` | branch=${report.matchedWorktree.branch}` : ""
      }`
    );
  }

  return lines.join("\n");
}

function formatGit(runtime) {
  return renderGitStatus(runtime.getGitState());
}

function formatGitWorktrees(runtime) {
  return renderGitWorktrees(runtime.getGitState());
}

function formatSessionList(sessions) {
  if (sessions.length === 0) {
    return "No saved sessions found.";
  }

  return sessions
    .map(session => {
      const details = [
        session.updatedAt ? `updated=${session.updatedAt}` : "",
        Number.isInteger(session.messageCount) ? `messages=${session.messageCount}` : "",
        session.lastRole ? `last=${session.lastRole}` : ""
      ]
        .filter(Boolean)
        .join(" ");

      return `- ${session.id}${details ? ` | ${details}` : ""}${session.lastMessage ? ` | ${session.lastMessage}` : ""}`;
    })
    .join("\n");
}

function formatAgents(runtime) {
  const agents = runtime.getCustomAgents();

  if (agents.length === 0) {
    return [
      "No custom agents found.",
      "",
      `Create Markdown or text agent files in ${runtime.cwd}/.water-code/agents/`
    ].join("\n");
  }

  return agents
    .map(agent => {
      const active = runtime.getActiveAgent()?.name === agent.name ? " [active]" : "";
      return `- ${agent.name}${active}: ${agent.description}`;
    })
    .join("\n");
}

function formatSkills(runtime) {
  const skills = runtime.getProjectSkills();

  if (skills.length === 0) {
    return [
      "No project skills found.",
      "",
      `Create Markdown or text skill files in ${runtime.cwd}/.water-code/skills/`
    ].join("\n");
  }

  const activeNames = new Set(runtime.getActiveSkills().map(skill => skill.name));

  return skills
    .map(skill => {
      const active = activeNames.has(skill.name) ? " [active]" : "";
      const whenToUse = skill.whenToUse ? ` | when to use: ${skill.whenToUse}` : "";
      return `- ${skill.name}${active}: ${skill.description}${whenToUse}`;
    })
    .join("\n");
}

function formatPlugins(runtime) {
  const plugins = runtime.getProjectPlugins();

  if (plugins.length === 0) {
    return [
      "No project plugins found.",
      "",
      `Create JavaScript plugin files in ${runtime.cwd}/.water-code/plugins/`
    ].join("\n");
  }

  return plugins
    .map(plugin => {
      const commands = (plugin.commands || []).map(command => `/${command.name}`).join(", ") || "(none)";
      const tools = (plugin.tools || []).map(tool => tool.name).join(", ") || "(none)";
      return `- ${plugin.name}: ${plugin.description}\n  commands: ${commands}\n  tools: ${tools}`;
    })
    .join("\n");
}

function formatCustomCommandList(runtime) {
  const commands = runtime.getCustomCommands();

  if (commands.length === 0) {
    return [
      "No custom commands found.",
      "",
      `Create Markdown or text templates in ${runtime.cwd}/.water-code/commands/`
    ].join("\n");
  }

  return commands
    .map(command => `- /${command.name}: ${command.description}`)
    .join("\n");
}

function formatMcp(runtime) {
  const servers = runtime.getMcpServers();

  if (servers.length === 0) {
    return [
      "No MCP servers configured.",
      "",
      `Create ${runtime.cwd}/.water-code/mcp.json to register local MCP servers.`
    ].join("\n");
  }

  const lines = [];

  for (const server of servers) {
    const status = server.status === "connected" ? "connected" : "error";
    lines.push(`- ${server.name} [${status}]`);
    lines.push(`  command: ${server.command}${server.args?.length ? ` ${server.args.join(" ")}` : ""}`);
    if (server.status === "connected") {
      if (server.tools.length === 0) {
        lines.push("  tools: (none)");
      } else {
        lines.push(`  tools: ${server.tools.map(tool => tool.name).join(", ")}`);
      }
    } else {
      lines.push(`  error: ${server.error || "unknown error"}`);
    }
  }

  return lines.join("\n");
}

function formatTaskList(tasks) {
  if (tasks.length === 0) {
    return "No background tasks found.";
  }

  return tasks
    .map(task => {
      const extras = [
        task.provider ? `provider=${task.provider}` : "",
        task.agent ? `agent=${task.agent}` : "",
        task.skills?.length ? `skills=${task.skills.join(",")}` : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `- ${task.id} [${task.status}] ${task.label}${extras ? ` | ${extras}` : ""}`;
    })
    .join("\n");
}

function formatTaskReport(report) {
  const { task, stdout, stderr } = report;
  const lines = [
    `Task: ${task.id}`,
    `Status: ${task.status}`,
    `Label: ${task.label}`,
    `Prompt: ${task.prompt}`,
    `Provider: ${task.provider}`
  ];

  if (task.agent) {
    lines.push(`Agent: ${task.agent}`);
  }

  if (task.skills?.length) {
    lines.push(`Skills: ${task.skills.join(", ")}`);
  }

  lines.push(`Created: ${task.createdAt}`);
  if (task.startedAt) {
    lines.push(`Started: ${task.startedAt}`);
  }
  if (task.finishedAt) {
    lines.push(`Finished: ${task.finishedAt}`);
  }
  if (task.sessionId) {
    lines.push(`Session: ${task.sessionId}`);
  }
  if (task.pid) {
    lines.push(`PID: ${task.pid}`);
  }
  if (task.error) {
    lines.push(`Error: ${task.error}`);
  }
  lines.push(`Stdout log: ${task.outputPath}`);
  lines.push(`Stderr log: ${task.errorPath}`);

  if (task.outputPreview) {
    lines.push("", "Output preview:", task.outputPreview);
  }

  if (stdout) {
    lines.push("", "Stdout tail:", stdout);
  }

  if (stderr) {
    lines.push("", "Stderr tail:", stderr);
  }

  return lines.join("\n");
}

function parseTaskRunOptions(tokens, prompt) {
  const label = parseStringOption(tokens, "--label", "");
  const agentName = parseStringOption(tokens, "--agent", "");
  const skillValue = parseStringOption(tokens, "--skills", "");
  const cleaned = tokens.filter(
    (token, index) =>
      !["--label", "--agent", "--skills"].includes(token) &&
      !["--label", "--agent", "--skills"].includes(tokens[index - 1])
  );

  return {
    label: label || cleaned.join(" ").trim() || String(prompt || "").trim().slice(0, 80),
    agentName,
    skills: splitCsvList(skillValue)
  };
}

function createBuiltins() {
  return [
    {
      name: "help",
      description: "Show available slash commands",
      usage: "/help [command]",
      async execute({ registry, runtime, tokens }) {
        if (tokens.length === 0) {
          const lines = registry.describe(runtime).map(
            command => `${command.usage.padEnd(36, " ")} ${command.description}`
          );
          return {
            output: `${lines.join("\n")}\n`
          };
        }

        const command = registry.find(tokens[0], runtime);
        if (!command) {
          return {
            output: `Unknown slash command: ${tokens[0]}\n`
          };
        }

        const aliases =
          command.aliases && command.aliases.length > 0
            ? `\nAliases: ${command.aliases.map(alias => `/${alias}`).join(", ")}`
            : "";
        const source = command.sourcePath ? `\nSource: ${command.sourcePath}` : "";

        return {
          output: `${command.usage}\n${command.description}${aliases}${source}\n`
        };
      }
    },
    {
      name: "doctor",
      aliases: ["healthcheck"],
      description: "Run a local Water Code environment and project self-check",
      usage: "/doctor",
      async execute({ runtime }) {
        const report = await buildDoctorReport(runtime);
        return {
          output: renderDoctorReport(report)
        };
      }
    },
    {
      name: "onboard",
      aliases: ["onboarding"],
      description: "Show recommended next steps for getting started in this project",
      usage: "/onboard",
      async execute({ runtime }) {
        const report = await buildOnboardingReport(runtime);
        return {
          output: renderOnboardingReport(report)
        };
      }
    },
    {
      name: "init",
      aliases: ["scaffold"],
      description: "Create starter Water Code project files without overwriting existing files",
      usage: "/init [--force]",
      async execute({ runtime, tokens }) {
        const report = await runtime.scaffoldProject({
          force: tokens.includes("--force")
        });
        return {
          output: renderScaffoldReport(report)
        };
      }
    },
    {
      name: "sessions",
      aliases: ["session-list"],
      description: "List saved conversation sessions",
      usage: "/sessions [--limit N]",
      async execute({ runtime, tokens }) {
        const limit = parseIntegerOption(tokens, "--limit", 20);
        const sessions = await runtime.listSessions(limit);
        return {
          output: `${formatSessionList(sessions)}\n`
        };
      }
    },
    {
      name: "git",
      aliases: ["git-status"],
      description: "Show Git branch, dirty state, and synchronization details",
      usage: "/git",
      async execute({ runtime }) {
        await runtime.refreshGitState?.();
        return {
          output: formatGit(runtime)
        };
      }
    },
    {
      name: "worktrees",
      aliases: ["git-worktrees"],
      description: "List Git worktrees for the current repository",
      usage: "/worktrees",
      async execute({ runtime }) {
        await runtime.refreshGitState?.();
        return {
          output: formatGitWorktrees(runtime)
        };
      }
    },
    {
      name: "refresh-git",
      aliases: ["reload-git"],
      description: "Refresh Git branch and worktree state from disk",
      usage: "/refresh-git",
      async execute({ runtime }) {
        const git = await runtime.refreshGitState?.();
        return {
          output: `${git?.summary || "Git state refreshed."}\n`
        };
      }
    },
    {
      name: "tasks",
      aliases: ["background-tasks"],
      description: "List recent background tasks",
      usage: "/tasks [--limit N]",
      async execute({ runtime, tokens }) {
        const limit = parseIntegerOption(tokens, "--limit", 20);
        const tasks = await runtime.listBackgroundTasks(limit);
        return {
          output: `${formatTaskList(tasks)}\n`
        };
      }
    },
    {
      name: "task-run",
      aliases: ["task-start"],
      description: "Start a background task for a prompt or slash command",
      usage: "/task-run [label] [--agent name] [--skills a,b] ::: <prompt>",
      async execute({ runtime, args }) {
        const { left, right } = splitWriteArgs(args);
        const tokens = tokenize(left);
        const prompt = right.trim();

        if (!prompt) {
          throw new Error('/task-run expects prompt content after ":::"');
        }

        const task = await runtime.launchBackgroundTask({
          prompt,
          ...parseTaskRunOptions(tokens, prompt)
        });

        return {
          output:
            `Started background task ${task.id}.\n` +
            `Label: ${task.label}\n` +
            `Status: ${task.status}\n` +
            `Use /task-show ${task.id} to inspect progress.\n`
        };
      }
    },
    {
      name: "task-show",
      aliases: ["task"],
      description: "Show one background task with recent output",
      usage: "/task-show <id> [--lines N]",
      async execute({ runtime, tokens }) {
        if (tokens.length === 0) {
          throw new Error("/task-show expects a task id");
        }

        const lines = parseIntegerOption(tokens, "--lines", 40);
        const taskId = tokens.find(
          (token, index) => token !== "--lines" && tokens[index - 1] !== "--lines"
        );

        if (!taskId) {
          throw new Error("/task-show expects a task id");
        }

        const report = await runtime.getBackgroundTask(taskId, { lines });
        if (!report) {
          return {
            output: `Unknown background task: ${taskId}\n`
          };
        }

        return {
          output: `${formatTaskReport(report)}\n`
        };
      }
    },
    {
      name: "task-cancel",
      aliases: ["cancel-task"],
      description: "Cancel a running background task",
      usage: "/task-cancel <id>",
      async execute({ runtime, tokens }) {
        if (tokens.length === 0) {
          throw new Error("/task-cancel expects a task id");
        }

        const task = await runtime.cancelBackgroundTask(tokens[0]);
        return {
          output:
            `Background task ${task.id} is now ${task.status}.\n` +
            `Label: ${task.label}\n`
        };
      }
    },
    {
      name: "commands",
      aliases: ["custom-commands"],
      description: "List available project custom commands",
      usage: "/commands",
      async execute({ runtime }) {
        return {
          output: `${formatCustomCommandList(runtime)}\n`
        };
      }
    },
    {
      name: "plugins",
      aliases: ["project-plugins"],
      description: "List loaded project plugins",
      usage: "/plugins",
      async execute({ runtime }) {
        return {
          output: `${formatPlugins(runtime)}\n`
        };
      }
    },
    {
      name: "refresh-plugins",
      aliases: ["reload-plugins"],
      description: "Reload project plugins from disk",
      usage: "/refresh-plugins",
      async execute({ runtime }) {
        const plugins = await runtime.refreshProjectPlugins();
        return {
          output: `Reloaded ${plugins.length} project plugin${plugins.length === 1 ? "" : "s"}.\n`
        };
      }
    },
    {
      name: "skills",
      aliases: ["project-skills"],
      description: "List available project skills",
      usage: "/skills",
      async execute({ runtime }) {
        return {
          output: `${formatSkills(runtime)}\n`
        };
      }
    },
    {
      name: "refresh-skills",
      aliases: ["reload-skills"],
      description: "Reload project skills from disk",
      usage: "/refresh-skills",
      async execute({ runtime }) {
        const skills = await runtime.refreshProjectSkills();
        return {
          output: `Reloaded ${skills.length} project skill${skills.length === 1 ? "" : "s"}.\n`
        };
      }
    },
    {
      name: "mcp",
      aliases: ["mcp-servers"],
      description: "Show configured MCP servers and discovered tools",
      usage: "/mcp",
      async execute({ runtime }) {
        return {
          output: `${formatMcp(runtime)}\n`
        };
      }
    },
    {
      name: "refresh-mcp",
      aliases: ["reload-mcp"],
      description: "Reload MCP config, reconnect servers, and refresh tools",
      usage: "/refresh-mcp",
      async execute({ runtime }) {
        const servers = await runtime.refreshMcp();
        return {
          output: `Reloaded ${servers.length} MCP server${servers.length === 1 ? "" : "s"}.\n`
        };
      }
    },
    {
      name: "mcp-call",
      description: "Call a discovered MCP tool directly",
      usage: "/mcp-call <server> <tool> ::: <json object>",
      async execute({ runtime, args, tokens }) {
        if (tokens.length < 2) {
          throw new Error("/mcp-call expects <server> <tool> ::: <json object>");
        }

        const { right } = splitWriteArgs(args);
        const serverName = tokens[0];
        const toolName = tokens[1];
        const input = parseJsonObject(right);
        const result = await runtime.runTool(buildMcpToolName(serverName, toolName), input);

        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "agents",
      aliases: ["custom-agents"],
      description: "List available project custom agents",
      usage: "/agents",
      async execute({ runtime }) {
        return {
          output: `${formatAgents(runtime)}\n`
        };
      }
    },
    {
      name: "delegate",
      aliases: ["ask-agent"],
      description: "Run one prompt through a specific custom agent",
      usage: "/delegate <agent> ::: <prompt>",
      async execute({ runtime, args, tokens }) {
        if (tokens.length === 0) {
          throw new Error("/delegate expects <agent> ::: <prompt>");
        }

        const { right } = splitWriteArgs(args);
        const agentName = tokens[0];
        const prompt = right.trim();

        if (!prompt) {
          throw new Error('/delegate expects prompt content after ":::"');
        }

        const result = await runtime.runPromptWithAgent(prompt, agentName);
        return {
          output:
            `Delegated to ${result.agent.name}.\n` +
            `Session: ${result.sessionId}\n\n` +
            `${result.output.endsWith("\n") ? result.output : `${result.output}\n`}`
        };
      }
    },
    {
      name: "swarm",
      aliases: ["orchestrate"],
      description: "Run the same prompt through multiple custom agents and collect outputs",
      usage: "/swarm <agent1,agent2,...> ::: <prompt>",
      async execute({ runtime, args, tokens }) {
        if (tokens.length === 0) {
          throw new Error("/swarm expects <agent1,agent2,...> ::: <prompt>");
        }

        const { right } = splitWriteArgs(args);
        const agentNames = splitCsvList(tokens[0]);
        const prompt = right.trim();

        if (agentNames.length === 0) {
          throw new Error("/swarm expects at least one agent name");
        }

        if (!prompt) {
          throw new Error('/swarm expects prompt content after ":::"');
        }

        const result = await runtime.runSwarm(prompt, agentNames);
        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "refresh-agents",
      aliases: ["reload-agents"],
      description: "Reload project custom agents from disk",
      usage: "/refresh-agents",
      async execute({ runtime }) {
        const agents = await runtime.refreshCustomAgents();
        return {
          output: `Reloaded ${agents.length} custom agent${agents.length === 1 ? "" : "s"}.\n`
        };
      }
    },
    {
      name: "refresh-commands",
      aliases: ["reload-commands"],
      description: "Reload project custom commands from disk",
      usage: "/refresh-commands",
      async execute({ runtime }) {
        const commands = await runtime.refreshCustomCommands();
        return {
          output: `Reloaded ${commands.length} custom command${commands.length === 1 ? "" : "s"}.\n`
        };
      }
    },
    {
      name: "tools",
      description: "Show the tool registry",
      usage: "/tools",
      async execute({ runtime }) {
        return {
          output: `${formatToolList(runtime)}\n`
        };
      }
    },
    {
      name: "provider",
      description: "Show the active provider",
      usage: "/provider",
      async execute({ runtime }) {
        return {
          output: `${runtime.providerName}\n`
        };
      }
    },
    {
      name: "agent",
      aliases: ["use-agent"],
      description: "Show or change the active project custom agent",
      usage: "/agent [name|none]",
      async execute({ runtime, tokens }) {
        if (tokens.length === 0) {
          const active = runtime.getActiveAgent();
          if (!active) {
            return {
              output: "Active agent: (none)\n"
            };
          }

          return {
            output:
              `Active agent: ${active.name}\n` +
              `${active.description}\n` +
              `Source: ${active.sourcePath}\n`
          };
        }

        const next = runtime.setActiveAgent(tokens[0]);
        if (!next) {
          return {
            output: "Active agent cleared.\n"
          };
        }

        return {
          output:
            `Active agent set to ${next.name}.\n` +
            `${next.description}\n` +
            `Source: ${next.sourcePath}\n`
        };
      }
    },
    {
      name: "skill",
      aliases: ["use-skill"],
      description: "Show or change the active project skill set",
      usage: "/skill [name[,name2,...]|none]",
      async execute({ runtime, args }) {
        if (!args.trim()) {
          const active = runtime.getActiveSkills();
          if (active.length === 0) {
            return {
              output: "Active skills: (none)\n"
            };
          }

          return {
            output:
              `Active skills: ${active.map(skill => skill.name).join(", ")}\n` +
              active
                .map(
                  skill =>
                    `${skill.name}: ${skill.description}\nSource: ${skill.sourcePath}`
                )
                .join("\n\n") +
              "\n"
          };
        }

        const active = runtime.setActiveSkills(
          /^(none|off)$/i.test(args.trim()) ? [] : splitCsvList(args)
        );

        if (active.length === 0) {
          return {
            output: "Active skills cleared.\n"
          };
        }

        return {
          output:
            `Active skills set to ${active.map(skill => skill.name).join(", ")}.\n` +
            active
              .map(
                skill =>
                  `${skill.name}: ${skill.description}\nSource: ${skill.sourcePath}`
              )
              .join("\n\n") +
            "\n"
        };
      }
    },
    {
      name: "permissions",
      aliases: ["approval-mode"],
      description: "Show or update the dangerous-tool permission mode",
      usage: "/permissions [ask|accept-edits|read-only|yolo]",
      async execute({ runtime, tokens }) {
        if (tokens.length === 0) {
          return {
            output: `${formatPermissions(runtime)}\n`
          };
        }

        const next = runtime.setPermissionMode(tokens[0]);
        return {
          output: `Permission mode updated to ${next.mode}.\n\n${next.summary}\n`
        };
      }
    },
    {
      name: "approvals",
      aliases: ["approval-history"],
      description: "Inspect or clear recent dangerous-tool approval decisions",
      usage: "/approvals [clear|reset|wipe]",
      async execute({ runtime, tokens }) {
        const action = String(tokens[0] || "").trim().toLowerCase();

        if (!action) {
          return {
            output: `${formatApprovals(runtime)}\n`
          };
        }

        if (action === "clear") {
          runtime.clearApprovalHistory?.();
          return {
            output: "Approval history cleared.\n"
          };
        }

        if (action === "reset") {
          runtime.resetApprovalPolicies?.();
          return {
            output: "Remembered approvals cleared.\n"
          };
        }

        if (action === "wipe") {
          runtime.resetApprovals?.();
          return {
            output: "Approval history and remembered approvals cleared.\n"
          };
        }

        throw new Error("/approvals expects clear, reset, wipe, or no argument");
      }
    },
    {
      name: "session",
      description: "Show the active session id",
      usage: "/session [id|new|none]",
      async execute({ runtime, tokens }) {
        if (tokens[0] === "new") {
          const session = await runtime.createSession();
          return {
            output:
              `Created and activated session ${session.id}.\n` +
              `Messages: ${session.messages.length}\n`
          };
        }

        if (tokens[0] && /^(none|off|clear)$/i.test(tokens[0])) {
          runtime.resetSession();
          return {
            output: "Active session cleared.\n"
          };
        }

        if (tokens[0]) {
          const session = await runtime.setSession(tokens[0]);
          return {
            output:
              `Active session set to ${session.id}.\n` +
              `Messages: ${session.messages.length}\n`
          };
        }

        return {
          output: `${runtime.sessionId || "(new session on next prompt)"}\n`
        };
      }
    },
    {
      name: "project",
      aliases: ["workspace"],
      description: "Show the current project root or switch to a different project directory",
      usage: "/project [path]",
      async execute({ runtime, args }) {
        const target = args.trim();

        if (!target) {
          return {
            output: `${formatProject(runtime)}\n`
          };
        }

        const report = await runtime.switchProject(target);
        return {
          output: `${formatProjectSwitchReport(report)}\n`
        };
      }
    },
    {
      name: "worktree-use",
      aliases: ["use-worktree"],
      description: "Switch the active project root to a known Git worktree by branch or path",
      usage: "/worktree-use <branch|path>",
      async execute({ runtime, args }) {
        const target = args.trim();
        if (!target) {
          throw new Error("/worktree-use expects a branch name or worktree path");
        }

        const report = await runtime.switchToWorktree(target);
        return {
          output: `${formatProjectSwitchReport(report)}\n`
        };
      }
    },
    {
      name: "cwd",
      description: "Show the working directory",
      usage: "/cwd",
      async execute({ runtime }) {
        return {
          output: `${runtime.cwd}\n`
        };
      }
    },
    {
      name: "context",
      description: "Show the current project context snapshot",
      usage: "/context",
      async execute({ runtime }) {
        return {
          output: `${formatProjectContext(runtime)}\n`
        };
      }
    },
    {
      name: "instructions",
      aliases: ["project-instructions"],
      description: "Show the loaded WATER.md project instructions",
      usage: "/instructions",
      async execute({ runtime }) {
        return {
          output: `${formatProjectInstructions(runtime)}\n`
        };
      }
    },
    {
      name: "refresh-instructions",
      aliases: ["reload-instructions"],
      description: "Reload WATER.md project instructions from disk",
      usage: "/refresh-instructions",
      async execute({ runtime }) {
        const instructions = await runtime.refreshProjectInstructions();
        return {
          output: instructions
            ? `Reloaded project instructions from ${instructions.sourcePath}.\n`
            : "Project instructions cleared. No WATER.md file is currently loaded.\n"
        };
      }
    },
    {
      name: "refresh-context",
      aliases: ["reload-context"],
      description: "Re-scan the project and rebuild the context snapshot",
      usage: "/refresh-context",
      async execute({ runtime }) {
        const context = await runtime.refreshProjectContext();
        return {
          output: `Project context refreshed.\n\n${context.summary}\n`
        };
      }
    },
    {
      name: "reset",
      description: "Start a fresh session",
      usage: "/reset",
      async execute({ runtime }) {
        runtime.resetSession();
        return {
          output: "Session reset. A new session will be created on the next prompt.\n"
        };
      }
    },
    {
      name: "ls",
      aliases: ["files"],
      description: "List files directly without using the model",
      usage: "/ls [path] [--depth N]",
      async execute({ runtime, tokens }) {
        const depth = parseIntegerOption(tokens, "--depth", 2);
        const cleaned = tokens.filter(
          (token, index) =>
            token !== "--depth" && tokens[index - 1] !== "--depth"
        );
        const path = cleaned[0] || ".";
        const result = await runtime.runTool("list_files", {
          path,
          depth
        });
        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "read",
      aliases: ["open"],
      description: "Read a file directly without using the model",
      usage: "/read <path> [--start N] [--lines N]",
      async execute({ runtime, tokens }) {
        if (tokens.length === 0) {
          throw new Error("/read expects a file path");
        }

        const start = parseIntegerOption(tokens, "--start", 1);
        const lines = parseIntegerOption(tokens, "--lines", 200);
        const cleaned = tokens.filter(
          (token, index) =>
            !["--start", "--lines"].includes(token) &&
            !["--start", "--lines"].includes(tokens[index - 1])
        );
        const path = cleaned[0];
        if (!path) {
          throw new Error("/read expects a file path");
        }
        const result = await runtime.runTool("read_file", {
          path,
          start,
          lines
        });
        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "diff",
      description: "Preview a unified diff for replacing a file",
      usage: "/diff <path> ::: <content>",
      async execute({ runtime, args }) {
        const { left, right } = splitWriteArgs(args);
        const leftTokens = tokenize(left);

        if (leftTokens.length === 0) {
          throw new Error("/diff expects a file path");
        }

        const targetPath = leftTokens[0];
        if (!right.trim()) {
          throw new Error('/diff expects content after ":::"');
        }

        const result = await runtime.runTool("preview_diff", {
          path: targetPath,
          content: right
        });

        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "write",
      description: "Write a file directly using the write tool",
      usage: "/write <path> [--append] ::: <content>",
      async execute({ runtime, args }) {
        const { left, right } = splitWriteArgs(args);
        const leftTokens = tokenize(left);

        if (leftTokens.length === 0) {
          throw new Error("/write expects a file path");
        }

        const append = leftTokens.includes("--append");
        const path = leftTokens.find(token => token !== "--append");

        if (!path) {
          throw new Error("/write expects a file path");
        }

        if (!right.trim()) {
          throw new Error('/write expects content after ":::"');
        }

        const result = await runtime.runTool("write_file", {
          path,
          content: right,
          append
        });

        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "patch",
      aliases: ["replace"],
      description: "Apply an exact text replacement patch",
      usage: "/patch <path> [--all] ::: <old text> >>> <new text>",
      async execute({ runtime, args }) {
        const { left, oldText, newText } = splitPatchArgs(args);
        const leftTokens = tokenize(left);

        if (leftTokens.length === 0) {
          throw new Error("/patch expects a file path");
        }

        const replaceAll = leftTokens.includes("--all");
        const targetPath = leftTokens.find(token => token !== "--all");

        if (!targetPath) {
          throw new Error("/patch expects a file path");
        }

        if (!oldText) {
          throw new Error('/patch expects old text after ":::" and before ">>>"');
        }

        const result = await runtime.runTool("patch_file", {
          path: targetPath,
          oldText,
          newText,
          replaceAll
        });

        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "run",
      aliases: ["bash", "shell"],
      description: "Run a shell command directly using the bash tool",
      usage: "/run <command>",
      async execute({ runtime, args }) {
        if (!args.trim()) {
          throw new Error("/run expects a shell command");
        }

        const result = await runtime.runTool("bash", {
          command: args,
          timeoutMs: 10000
        });

        return {
          output: formatCommandResult(result)
        };
      }
    },
    {
      name: "quit",
      aliases: ["exit"],
      description: "Exit Water Code",
      usage: "/quit",
      async execute() {
        return {
          shouldContinue: false,
          output: ""
        };
      }
    }
  ];
}

export class SlashCommandRegistry {
  constructor(commands = createBuiltins()) {
    this.commands = commands;
    this.commandMap = new Map();

    for (const command of commands) {
      this.commandMap.set(command.name, command);
      for (const alias of command.aliases || []) {
        this.commandMap.set(alias, command);
      }
    }
  }

  find(name, runtime) {
    const builtIn = this.commandMap.get(name);
    if (builtIn) {
      return builtIn;
    }

    if (!runtime) {
      return undefined;
    }

    const custom = runtime.getCustomCommand(name);
    if (custom) {
      return createCustomCommand(custom);
    }

    return runtime.getPluginCommand(name) || undefined;
  }

  describe(runtime) {
    const unique = new Map();
    for (const command of this.commands) {
      unique.set(command.name, command);
    }

    if (runtime) {
      for (const command of runtime.getCustomCommands()) {
        unique.set(command.name, createCustomCommand(command));
      }
      for (const command of runtime.getPluginCommands()) {
        unique.set(command.name, command);
      }
    }

    return Array.from(unique.values());
  }

  async execute(input, runtime) {
    const parsed = parseSlashInput(input);
    const command = this.find(parsed.name, runtime);

    if (!command) {
      return {
        shouldContinue: true,
        output: `Unknown command: /${parsed.name}\nTry /help for available commands.\n`
      };
    }

    try {
      const result = await command.execute({
        runtime,
        registry: this,
        name: parsed.name,
        args: parsed.args,
        tokens: parsed.tokens
      });

      return {
        shouldContinue:
          typeof result?.shouldContinue === "boolean" ? result.shouldContinue : true,
        output: result?.output || ""
      };
    } catch (error) {
      return {
        shouldContinue: true,
        output: `${error instanceof Error ? error.message : String(error)}\n`
      };
    }
  }
}
