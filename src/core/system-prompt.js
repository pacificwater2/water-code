import { PROTOCOL_VERSION } from "./protocol.js";

export function buildSystemPrompt({
  productName,
  cwd,
  tools,
  responseStyle = "json-protocol",
  projectContext,
  gitState,
  projectInstructions,
  permissionMode,
  permissionSummary,
  activeAgent,
  activeAgentPrompt,
  activeSkills,
  activeSkillPrompts,
  activePlugins,
  activePluginPrompts
}) {
  const toolList = tools
    .map(
      tool =>
        `- ${tool.name}${tool.dangerous ? ` [dangerous:${tool.permissionGroup || "dangerous"}]` : ""}: ${tool.description} | input: ${tool.inputHint}`
    )
    .join("\n");
  const projectSummary = projectContext?.summary
    ? `\nProject context snapshot:\n${projectContext.summary}\n`
    : "";
  const gitSummary = gitState?.summary
    ? `\nGit snapshot:\n${gitState.summary}\n`
    : "";
  const projectInstructionSummary = projectInstructions?.content
    ? `\nProject instructions (${projectInstructions.sourcePath}):\n${projectInstructions.content}\n`
    : "";
  const agentSummary = activeAgent
    ? `\nActive custom agent:\n- name: ${activeAgent.name}\n- description: ${activeAgent.description}\n\nAgent instructions:\n${activeAgentPrompt}\n`
    : "";
  const skillSummary =
    activeSkills && activeSkills.length > 0
      ? `\nActive skills:\n${activeSkills
          .map(
            skill =>
              `- ${skill.name}: ${skill.description}${skill.whenToUse ? ` | when to use: ${skill.whenToUse}` : ""}`
          )
          .join("\n")}\n\nSkill instructions:\n${activeSkillPrompts
          .map(
            item => `[${item.skill.name}]\n${item.prompt}`
          )
          .join("\n\n")}\n`
      : "";
  const pluginSummary =
    activePlugins && activePlugins.length > 0
      ? `\nLoaded plugins:\n${activePlugins
          .map(
            plugin =>
              `- ${plugin.name}: ${plugin.description}`
          )
          .join("\n")}\n${
          activePluginPrompts.length > 0
            ? `\nPlugin instructions:\n${activePluginPrompts
                .map(item => `[${item.plugin.name}]\n${item.prompt}`)
                .join("\n\n")}\n`
            : ""
        }`
      : "";
  const behaviorSummary =
    responseStyle === "native-tools"
      ? `You may answer directly or use the provided native tool definitions.\nUse at most one tool at a time.\nWhen you have enough information, answer normally in plain text.`
      : `You may either:
1. answer directly
2. request exactly one tool call

You must return strict JSON only, using protocol_version ${PROTOCOL_VERSION}.

When you request a tool call, return:
{"protocolVersion":${PROTOCOL_VERSION},"type":"tool_call","toolCall":{"id":"call-1","name":"read_file","input":{"path":"README.md"},"reason":"Explain why you need it"}}

When you are ready to answer, return:
{"protocolVersion":${PROTOCOL_VERSION},"type":"assistant","message":"Your final response"}`;

  return `You are ${productName}, a terminal coding agent working inside ${cwd}.

${behaviorSummary}

Guidelines:
- Use one tool at a time.
- Prefer reading and diff preview before patching or writing.
- Be explicit and concise.
- Do not invent files or results.
- If a dangerous action would be needed, ask through a tool call and let the runtime decide.
${responseStyle === "json-protocol" ? "- Do not wrap your final output in prose outside the JSON object." : "- Use the provided tool definitions instead of inventing a JSON protocol."}

Permission mode:
- current mode: ${permissionMode}
- policy: ${permissionSummary}
${projectSummary}
${gitSummary}
${projectInstructionSummary}
${agentSummary}
${skillSummary}
${pluginSummary}

Available tools:
${toolList}`;
}
