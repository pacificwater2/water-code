const cp = require("node:child_process");
const vscode = require("vscode");
const {
  buildAdapterArgs,
  buildSelectionRewritePrompt,
  normalizeReplacementText,
  parseJsonLines,
  summarizePromptEnvelope,
  summarizePromptEvents,
  summarizeProjectEnvelope,
  summarizeStateEnvelope
} = require("./lib/cli.js");
const path = require("node:path");

function getConfig() {
  return vscode.workspace.getConfiguration("waterCode");
}

function getWorkspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri?.fsPath || "";
}

function createCommandOptions(operation, extra = {}) {
  const config = getConfig();
  return {
    operation,
    provider: config.get("provider") || "planner",
    remoteUrl: config.get("remoteUrl") || "",
    cwd: config.get("useWorkspaceRoot") ? getWorkspaceRoot() : "",
    ...extra
  };
}

function runCli(cliPath, args) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(cliPath, args, {
      cwd: getWorkspaceRoot() || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });

    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
        return;
      }

      reject(new Error(stderr || stdout || `Water Code exited with code ${code}`));
    });
  });
}

function streamCli(cliPath, args, onEvent) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(cliPath, args, {
      cwd: getWorkspaceRoot() || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let buffer = "";
    const events = [];

    child.stdout.on("data", chunk => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const event = JSON.parse(trimmed);
        events.push(event);
        onEvent(event);
      }
    });

    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", code => {
      if (buffer.trim()) {
        const event = JSON.parse(buffer.trim());
        events.push(event);
        onEvent(event);
      }

      if (code === 0) {
        resolve(events);
        return;
      }

      reject(new Error(stderr || `Water Code exited with code ${code}`));
    });
  });
}

function showEnvelope(output, envelope) {
  output.appendLine(JSON.stringify(envelope, null, 2));
  output.show(true);
}

async function fetchAdapterEnvelope(operation, extra = {}) {
  const config = getConfig();
  const cliPath = config.get("cliPath") || "water-code";
  const args = buildAdapterArgs(createCommandOptions(operation, extra));
  const result = await runCli(cliPath, args);
  return JSON.parse(result.stdout);
}

async function runAdapterEnvelope(output, operation, extra = {}, { revealOutput = true } = {}) {
  const envelope = await fetchAdapterEnvelope(operation, extra);
  if (revealOutput) {
    showEnvelope(output, envelope);
  }
  return envelope;
}

async function runAdapterPrompt(output, prompt) {
  const config = getConfig();
  const cliPath = config.get("cliPath") || "water-code";
  const streamPrompts = config.get("streamPrompts") !== false;
  const options = createCommandOptions("prompt", {
    input: prompt,
    stream: streamPrompts
  });
  const args = buildAdapterArgs(options);

  output.appendLine(`> water-code ${args.join(" ")}`);

  if (!streamPrompts) {
    const result = await runCli(cliPath, args);
    const envelope = JSON.parse(result.stdout);
    showEnvelope(output, envelope);
    const summary = summarizePromptEnvelope(envelope);
    vscode.window.showInformationMessage("Water Code prompt completed.");
    return {
      mode: "envelope",
      envelope,
      summary
    };
  }

  const events = await streamCli(cliPath, args, event => {
    const payload = event?.event || {};
    const label = payload.type || "event";
    output.appendLine(`[${label}] ${JSON.stringify(payload)}`);
  });

  output.show(true);
  const summary = summarizePromptEvents(events);
  const detail = summary.toolCalls.length > 0
    ? `Tools: ${summary.toolCalls.join(", ")}`
    : "No tool calls.";
  vscode.window.showInformationMessage(`Water Code prompt completed. ${detail}`);
  return {
    mode: "stream",
    events,
    summary
  };
}

async function promptForInput(placeHolder) {
  return vscode.window.showInputBox({
    prompt: "Ask Water Code",
    placeHolder
  });
}

async function promptForRewriteInstruction() {
  return vscode.window.showInputBox({
    prompt: "Describe how Water Code should rewrite the selected text",
    placeHolder: "Refactor for clarity, keep behavior the same"
  });
}

async function promptForProjectPath() {
  return vscode.window.showInputBox({
    prompt: "Switch Water Code to project root",
    placeHolder: "../other-project"
  });
}

async function promptForWorktree() {
  return vscode.window.showInputBox({
    prompt: "Switch Water Code to worktree",
    placeHolder: "feature/review or ../path-to-worktree"
  });
}

async function runProjectSwitch(output, mode) {
  const rawInput =
    mode === "worktree" ? await promptForWorktree() : await promptForProjectPath();

  if (!rawInput) {
    return;
  }

  const input =
    mode === "worktree" ? `worktree:${String(rawInput).trim()}` : String(rawInput).trim();

  const envelope = await runAdapterEnvelope(output, "project", {
    input
  });
  const summary = summarizeProjectEnvelope(envelope);
  const detail = summary.matchedWorktree?.branch
    ? ` (${summary.matchedWorktree.branch})`
    : "";

  vscode.window.showInformationMessage(
    `Water Code switched to ${summary.toCwd}${detail}.`
  );
}

function createLeaf(label, description, options = {}) {
  return {
    type: "leaf",
    label,
    description,
    icon: options.icon || "circle-outline",
    tooltip:
      options.tooltip ||
      [label, description].filter(Boolean).join(": "),
    command: options.command,
    contextValue: options.contextValue || ""
  };
}

function createSection(label, children, options = {}) {
  return {
    type: "section",
    label,
    description: options.description || "",
    icon: options.icon || "folder-library",
    children
  };
}

function buildPanelNodes(envelope) {
  const summary = summarizeStateEnvelope(envelope);
  const projectChildren = [
    createLeaf("Root", summary.cwd || "(not set)", {
      icon: "folder"
    }),
    createLeaf("Provider", summary.provider || "(unknown)", {
      icon: "hubot"
    }),
    createLeaf("Permission", summary.permissionMode || "(unknown)", {
      icon: "shield"
    }),
    createLeaf("Agent", summary.activeAgent || "none", {
      icon: "account"
    }),
    createLeaf(
      "Skills",
      summary.activeSkills.length > 0 ? summary.activeSkills.join(", ") : "none",
      {
        icon: "symbol-key"
      }
    )
  ];

  if (summary.projectInstructions?.sourcePath) {
    projectChildren.push(
      createLeaf("Instructions", summary.projectInstructions.sourcePath, {
        icon: "book"
      })
    );
  }

  const gitChildren = [
    createLeaf("Summary", summary.gitSummary || "No Git repository detected.", {
      icon: "source-control"
    }),
    createLeaf(
      "Worktrees",
      String(summary.worktrees.length),
      {
        icon: "git-branch"
      }
    )
  ];

  const sessionChildren = [
    createLeaf("Active", summary.sessionId || "(new session on next prompt)", {
      icon: "comment-discussion"
    }),
    createLeaf("New Session", "Create and activate a fresh session", {
      icon: "add",
      command: {
        command: "waterCode.newSession",
        title: "New Water Code Session"
      },
      contextValue: "action"
    }),
    createLeaf("Clear Session", "Detach the active session", {
      icon: "close",
      command: {
        command: "waterCode.clearSession",
        title: "Clear Water Code Session"
      },
      contextValue: "action"
    })
  ];

  if (summary.recentSessions.length === 0) {
    sessionChildren.push(
      createLeaf("Recent Sessions", "none", {
        icon: "history"
      })
    );
  } else {
    for (const session of summary.recentSessions.slice(0, 5)) {
      const parts = [];
      if (Number.isInteger(session.messageCount)) {
        parts.push(`${session.messageCount} msgs`);
      }
      if (session.updatedAt) {
        parts.push(session.updatedAt);
      }

      sessionChildren.push(
        createLeaf(session.id, parts.join(" | "), {
          icon: session.id === summary.sessionId ? "check" : "history",
          command: {
            command: "waterCode.resumeSession",
            title: "Resume Water Code Session",
            arguments: [session.id]
          },
          contextValue: "session",
          tooltip: session.lastMessage
            ? `${session.id}\n${session.lastMessage}`
            : session.id
        })
      );
    }
  }

  const extensionChildren = [
    createLeaf(
      "Custom Commands",
      String(summary.customCommands.length),
      {
        icon: "terminal"
      }
    ),
    createLeaf(
      "Custom Agents",
      String(summary.customAgents.length),
      {
        icon: "organization"
      }
    ),
    createLeaf(
      "Plugins",
      String(summary.projectPlugins.length),
      {
        icon: "extensions"
      }
    ),
    createLeaf(
      "Skills",
      String(summary.projectSkills.length),
      {
        icon: "library"
      }
    ),
    createLeaf(
      "MCP Servers",
      summary.mcpServers.length > 0
        ? summary.mcpServers
            .map(server => `${server.name}:${server.status}`)
            .join(", ")
        : "none",
      {
        icon: "plug"
      }
    )
  ];

  const runtimeChildren = [
    createLeaf("Tools", String(summary.tools.length), {
      icon: "tools"
    }),
    createLeaf("Background Tasks", String(summary.backgroundTasks.length), {
      icon: "loading"
    })
  ];

  return [
    createSection("Project", projectChildren, {
      icon: "folder-opened",
      description: summary.cwd || ""
    }),
    createSection("Git", gitChildren, {
      icon: "source-control",
      description: summary.gitSummary || "No Git repository detected."
    }),
    createSection("Sessions", sessionChildren, {
      icon: "comment-discussion",
      description: summary.sessionId || "new on next prompt"
    }),
    createSection("Extensions", extensionChildren, {
      icon: "extensions"
    }),
    createSection("Runtime", runtimeChildren, {
      icon: "server-process"
    })
  ];
}

class WaterCodePanelProvider {
  constructor() {
    this.currentEnvelope = null;
    this.currentError = "";
    this.eventEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.eventEmitter.event;
  }

  async refresh({ silent = false } = {}) {
    try {
      this.currentEnvelope = await fetchAdapterEnvelope("state");
      this.currentError = "";
    } catch (error) {
      this.currentError = error instanceof Error ? error.message : String(error);
      if (!silent) {
        vscode.window.showErrorMessage(`Water Code panel refresh failed: ${this.currentError}`);
      }
    }

    this.eventEmitter.fire();
  }

  getTreeItem(node) {
    const collapsibleState =
      node.type === "section"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.description = node.description || "";
    item.tooltip = node.tooltip || [node.label, node.description].filter(Boolean).join(": ");
    item.contextValue = node.contextValue || node.type;
    item.iconPath = new vscode.ThemeIcon(node.icon || "circle-outline");
    if (node.command) {
      item.command = node.command;
    }
    return item;
  }

  getChildren(node) {
    if (node?.type === "section") {
      return node.children || [];
    }

    if (this.currentError) {
      return [
        createLeaf("Panel error", this.currentError, {
          icon: "warning"
        })
      ];
    }

    if (!this.currentEnvelope) {
      return [
        createLeaf("Loading", "Run Water Code: Refresh Panel if this view stays empty.", {
          icon: "sync"
        })
      ];
    }

    return buildPanelNodes(this.currentEnvelope);
  }
}

async function runSessionCommand(output, slashCommand, successMessage) {
  await runAdapterEnvelope(output, "command", {
    input: slashCommand
  });
  vscode.window.showInformationMessage(successMessage);
}

function applyReplacementToDocument(documentText, selection, replacement, document) {
  const start = document.offsetAt(selection.start);
  const end = document.offsetAt(selection.end);
  return `${documentText.slice(0, start)}${replacement}${documentText.slice(end)}`;
}

async function previewAndMaybeApplyRewrite(editor, replacement) {
  const document = editor.document;
  const nextContent = applyReplacementToDocument(
    document.getText(),
    editor.selection,
    replacement,
    document
  );

  const previewDocument = await vscode.workspace.openTextDocument({
    language: document.languageId,
    content: nextContent
  });

  await vscode.commands.executeCommand(
    "vscode.diff",
    document.uri,
    previewDocument.uri,
    `Water Code Preview: ${path.basename(document.uri.fsPath || document.fileName || "selection")}`
  );

  const action = await vscode.window.showInformationMessage(
    "Water Code prepared an edit preview.",
    "Apply Selection Patch",
    "Keep Preview Only"
  );

  if (action !== "Apply Selection Patch") {
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, editor.selection, replacement);
  const applied = await vscode.workspace.applyEdit(edit);

  if (applied) {
    vscode.window.showInformationMessage("Water Code applied the selection patch.");
  } else {
    vscode.window.showWarningMessage("Water Code could not apply the selection patch.");
  }

  return applied;
}

async function rewriteSelection(output) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a text editor first.");
    return false;
  }

  if (editor.selection.isEmpty) {
    vscode.window.showWarningMessage("Select the text you want Water Code to rewrite.");
    return false;
  }

  const selectionText = editor.document.getText(editor.selection);
  if (!selectionText.trim()) {
    vscode.window.showWarningMessage("Select some non-empty text first.");
    return false;
  }

  const instruction = await promptForRewriteInstruction();
  if (!instruction) {
    return false;
  }

  const prompt = buildSelectionRewritePrompt({
    filePath: editor.document.uri.fsPath || editor.document.fileName || "(untitled)",
    languageId: editor.document.languageId,
    instruction,
    selectionText
  });

  const result = await runAdapterPrompt(output, prompt);
  const replacement = normalizeReplacementText(
    result?.summary?.finalOutput || result?.summary?.output || ""
  );

  if (!replacement.trim()) {
    vscode.window.showWarningMessage(
      "Water Code returned an empty edit. Try a more specific rewrite instruction."
    );
    return false;
  }

  return previewAndMaybeApplyRewrite(editor, replacement);
}

function activate(context) {
  const output = vscode.window.createOutputChannel("Water Code");
  const panelProvider = new WaterCodePanelProvider();
  const treeView = vscode.window.createTreeView("waterCode.panel", {
    treeDataProvider: panelProvider,
    showCollapseAll: false
  });

  context.subscriptions.push(output);
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.openOutput", () => {
      output.show(true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.refreshPanel", async () => {
      await panelProvider.refresh();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.projectState", async () => {
      await runAdapterEnvelope(output, "state");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.switchProject", async () => {
      await runProjectSwitch(output, "project");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.useWorktree", async () => {
      await runProjectSwitch(output, "worktree");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.resumeSession", async sessionId => {
      if (!sessionId) {
        return;
      }
      await runSessionCommand(output, `/session ${sessionId}`, `Water Code resumed ${sessionId}.`);
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.newSession", async () => {
      await runSessionCommand(output, "/session new", "Water Code started a new session.");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.clearSession", async () => {
      await runSessionCommand(output, "/session none", "Water Code cleared the active session.");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.doctor", async () => {
      await runAdapterEnvelope(output, "doctor");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.onboard", async () => {
      await runAdapterEnvelope(output, "onboard");
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.promptSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection || undefined).trim();
      if (!selected) {
        vscode.window.showWarningMessage("Select some text first, or use Water Code: Prompt Input.");
        return;
      }
      await runAdapterPrompt(output, selected);
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.promptInput", async () => {
      const input = await promptForInput("read README.md");
      if (!input) {
        return;
      }
      await runAdapterPrompt(output, input);
      await panelProvider.refresh({
        silent: true
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waterCode.rewriteSelection", async () => {
      const changed = await rewriteSelection(output);
      if (changed) {
        await panelProvider.refresh({
          silent: true
        });
      }
    })
  );

  panelProvider.refresh({
    silent: true
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
