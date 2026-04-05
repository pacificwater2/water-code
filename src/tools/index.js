import { bashTool } from "./bash.js";
import { cancelBackgroundTaskTool } from "./cancel-background-task.js";
import { evaluateToolPermission } from "../core/permissions.js";
import { getBackgroundTaskTool } from "./get-background-task.js";
import { gitStatusTool } from "./git-status.js";
import { gitWorktreesTool } from "./git-worktrees.js";
import { listBackgroundTasksTool } from "./list-background-tasks.js";
import { normalizeToolResult } from "../core/tool-results.js";
import { listFilesTool } from "./list-files.js";
import { patchFileTool } from "./patch-file.js";
import { previewDiffTool } from "./preview-diff.js";
import { readFileTool } from "./read-file.js";
import { startBackgroundTaskTool } from "./start-background-task.js";
import { writeFileTool } from "./write-file.js";

export class ToolRegistry {
  constructor(tools) {
    this.tools = new Map();
    this.groups = new Map();
    this.setGroup("builtin", tools);
  }

  setGroup(name, tools) {
    const previous = this.groups.get(name) || [];
    for (const toolName of previous) {
      this.tools.delete(toolName);
    }

    const next = [];
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      next.push(tool.name);
    }

    this.groups.set(name, next);
  }

  describe() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      dangerous: !!tool.dangerous,
      permissionGroup: tool.permissionGroup || "",
      inputHint: tool.inputHint,
      inputSchema: tool.inputSchema || null
    }));
  }

  async execute(name, input, context) {
    const tool = this.tools.get(name);

    if (!tool) {
      return normalizeToolResult({
        ok: false,
        title: `Unknown tool ${name}`,
        summary: `No tool named ${name} is registered.`
      }, { toolName: name });
    }

    if (tool.dangerous) {
      const permission = await evaluateToolPermission({
        mode: context.permissionMode,
        tool,
        input,
        confirmToolCall: context.confirmToolCall,
        approvalState: context.runtime?.getApprovalStateManager?.()
      });

      if (!permission.allowed) {
        return normalizeToolResult({
          ok: false,
          title: `Permission denied for ${name}`,
          summary: permission.reason
        }, { toolName: name });
      }
    }

    try {
      return normalizeToolResult(await tool.execute(input, context), {
        toolName: name
      });
    } catch (error) {
      return normalizeToolResult({
        ok: false,
        title: `${name} failed`,
        summary: error instanceof Error ? error.message : String(error)
      }, { toolName: name });
    }
  }
}

export function createDefaultToolRegistry() {
  return new ToolRegistry([
    listFilesTool,
    readFileTool,
    gitStatusTool,
    gitWorktreesTool,
    previewDiffTool,
    patchFileTool,
    writeFileTool,
    listBackgroundTasksTool,
    getBackgroundTaskTool,
    startBackgroundTaskTool,
    cancelBackgroundTaskTool,
    bashTool
  ]);
}
