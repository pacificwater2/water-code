import { loadGitState, renderGitWorktrees } from "../core/git-state.js";
import { createToolResult } from "../core/tool-results.js";

export const gitWorktreesTool = {
  name: "git_worktrees",
  description: "List Git worktrees known to the current repository",
  inputHint: "{}",
  inputSchema: {
    type: "object",
    additionalProperties: false
  },
  async execute(_input, context) {
    const state = context.runtime?.refreshGitState
      ? await context.runtime.refreshGitState()
      : await loadGitState(context.cwd);

    return createToolResult({
      ok: true,
      title: "Git worktrees",
      summary: state.detected
        ? `${state.worktrees.length} worktree${state.worktrees.length === 1 ? "" : "s"} discovered.`
        : "No Git repository detected.",
      sections: [
        {
          label: "Details",
          body: renderGitWorktrees(state).trim()
        }
      ],
      data: {
        detected: state.detected,
        available: state.available,
        root: state.root,
        worktrees: state.worktrees
      }
    });
  }
};
