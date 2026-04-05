import { loadGitState, renderGitStatus } from "../core/git-state.js";
import { createToolResult } from "../core/tool-results.js";

export const gitStatusTool = {
  name: "git_status",
  description: "Inspect Git branch, dirty state, and synchronization details for the current project",
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
      title: "Git status",
      summary: state.summary,
      sections: [
        {
          label: "Details",
          body: renderGitStatus(state).trim()
        }
      ],
      data: state
    });
  }
};
