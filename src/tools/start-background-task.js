import { createToolResult } from "../core/tool-results.js";

function normalizeSkills(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

export const startBackgroundTaskTool = {
  name: "start_background_task",
  description: "Start a detached background task for a prompt or slash command.",
  inputHint: "{ prompt: string, label?: string, agent?: string, skills?: string[] }",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt or slash command to run in the background." },
      label: { type: "string", description: "Optional human-readable task label." },
      agent: { type: "string", description: "Optional custom agent to activate for the task." },
      skills: {
        oneOf: [
          {
            type: "array",
            items: { type: "string" }
          },
          {
            type: "string"
          }
        ],
        description: "Optional skills to activate."
      }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  dangerous: true,
  permissionGroup: "background",
  async execute(input, context) {
    const runtime = context.runtime;
    if (!runtime?.launchBackgroundTask) {
      throw new Error("Background task runtime is unavailable");
    }

    const prompt = String(input?.prompt || "").trim();
    if (!prompt) {
      throw new Error("start_background_task requires a prompt");
    }

    const task = await runtime.launchBackgroundTask({
      label: String(input?.label || "").trim(),
      prompt,
      agentName: String(input?.agent || "").trim(),
      skills: normalizeSkills(input?.skills)
    });

    return createToolResult({
      ok: true,
      title: `Started background task ${task.id}`,
      summary: `Queued detached task "${task.label}".`,
      sections: [
        {
          label: "Task",
          body: [
            `id: ${task.id}`,
            `status: ${task.status}`,
            `label: ${task.label}`,
            `provider: ${task.provider}`,
            task.agent ? `agent: ${task.agent}` : "",
            task.skills?.length ? `skills: ${task.skills.join(", ")}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        }
      ],
      data: {
        taskId: task.id,
        status: task.status,
        label: task.label,
        provider: task.provider,
        agent: task.agent || "",
        skills: task.skills || []
      }
    });
  }
};
