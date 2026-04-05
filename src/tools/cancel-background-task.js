import { createToolResult } from "../core/tool-results.js";

export const cancelBackgroundTaskTool = {
  name: "cancel_background_task",
  description: "Cancel a running background task.",
  inputHint: "{ taskId: string }",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Background task id." }
    },
    required: ["taskId"],
    additionalProperties: false
  },
  dangerous: true,
  permissionGroup: "background",
  async execute(input, context) {
    const runtime = context.runtime;
    if (!runtime?.cancelBackgroundTask) {
      throw new Error("Background task runtime is unavailable");
    }

    const taskId = String(input?.taskId || input?.id || "").trim();
    if (!taskId) {
      throw new Error("cancel_background_task requires a taskId");
    }

    const task = await runtime.cancelBackgroundTask(taskId);

    return createToolResult({
      ok: true,
      title: `Updated background task ${task.id}`,
      summary: `Task is now ${task.status}.`,
      sections: [
        {
          label: "Task",
          body: [
            `id: ${task.id}`,
            `status: ${task.status}`,
            `label: ${task.label}`
          ].join("\n")
        }
      ],
      data: {
        taskId: task.id,
        status: task.status
      }
    });
  }
};
