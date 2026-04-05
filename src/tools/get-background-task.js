import { createToolResult } from "../core/tool-results.js";

function formatTaskReport(report) {
  const { task, stdout, stderr } = report;
  const lines = [
    `id: ${task.id}`,
    `status: ${task.status}`,
    `label: ${task.label}`,
    `prompt: ${task.prompt}`,
    `provider: ${task.provider}`
  ];

  if (task.agent) {
    lines.push(`agent: ${task.agent}`);
  }

  if (task.skills?.length) {
    lines.push(`skills: ${task.skills.join(", ")}`);
  }

  if (task.sessionId) {
    lines.push(`session: ${task.sessionId}`);
  }

  if (task.error) {
    lines.push(`error: ${task.error}`);
  }

  return {
    taskBody: lines.join("\n"),
    stdout,
    stderr
  };
}

export const getBackgroundTaskTool = {
  name: "get_background_task",
  description: "Inspect one background task and recent log output.",
  inputHint: "{ taskId: string, lines?: number }",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Background task id." },
      lines: { type: "integer", description: "Number of log lines to tail." }
    },
    required: ["taskId"],
    additionalProperties: false
  },
  async execute(input, context) {
    const runtime = context.runtime;
    if (!runtime?.getBackgroundTask) {
      throw new Error("Background task runtime is unavailable");
    }

    const taskId = String(input?.taskId || input?.id || "").trim();
    if (!taskId) {
      throw new Error("get_background_task requires a taskId");
    }

    const lines = Math.max(1, Math.min(Number(input?.lines || 40), 200));
    const report = await runtime.getBackgroundTask(taskId, { lines });

    if (!report) {
      return createToolResult({
        ok: false,
        title: `Unknown background task ${taskId}`,
        summary: `No background task with id ${taskId} was found.`
      });
    }

    const formatted = formatTaskReport(report);

    return createToolResult({
      ok: true,
      title: `Background task ${report.task.id}`,
      summary: `Status: ${report.task.status}.`,
      sections: [
        {
          label: "Task",
          body: formatted.taskBody
        },
        ...(report.task.outputPreview
          ? [
              {
                label: "Output preview",
                body: report.task.outputPreview
              }
            ]
          : []),
        ...(formatted.stdout
          ? [
              {
                label: "Stdout tail",
                body: formatted.stdout
              }
            ]
          : []),
        ...(formatted.stderr
          ? [
              {
                label: "Stderr tail",
                body: formatted.stderr
              }
            ]
          : [])
      ],
      data: {
        task: report.task
      }
    });
  }
};
