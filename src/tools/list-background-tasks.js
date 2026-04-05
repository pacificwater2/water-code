import { createToolResult } from "../core/tool-results.js";

function formatTaskList(tasks) {
  if (tasks.length === 0) {
    return "(none)";
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

export const listBackgroundTasksTool = {
  name: "list_background_tasks",
  description: "List recent background tasks and their statuses.",
  inputHint: "{ limit?: number }",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Maximum number of tasks to list." }
    },
    additionalProperties: false
  },
  async execute(input, context) {
    const runtime = context.runtime;
    if (!runtime?.listBackgroundTasks) {
      throw new Error("Background task runtime is unavailable");
    }

    const limit = Math.max(1, Math.min(Number(input?.limit || 20), 100));
    const tasks = await runtime.listBackgroundTasks(limit);

    return createToolResult({
      ok: true,
      title: "Listed background tasks",
      summary:
        tasks.length === 0
          ? "No background tasks found."
          : `Showing ${tasks.length} background task${tasks.length === 1 ? "" : "s"}.`,
      sections: [
        {
          label: "Tasks",
          body: formatTaskList(tasks)
        }
      ],
      data: {
        tasks
      }
    });
  }
};
