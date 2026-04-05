import {
  createToolCallResponse,
  parseProtocolText
} from "../core/protocol.js";

function extractTextContent(payload) {
  if (!Array.isArray(payload?.content)) {
    return "";
  }

  return payload.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n")
    .trim();
}

function buildToolDescription(tool) {
  const parts = [tool.description || tool.name];

  if (tool.inputHint) {
    parts.push(`Input shape: ${tool.inputHint}`);
  }

  if (tool.dangerous) {
    parts.push(
      `Dangerous tool requiring permission group ${tool.permissionGroup || "dangerous"}.`
    );
  }

  return parts.join(" ");
}

function buildToolSchema(tool) {
  if (tool.inputSchema && typeof tool.inputSchema === "object") {
    return tool.inputSchema;
  }

  return {
    type: "object",
    additionalProperties: true
  };
}

function buildToolDefinitions(tools = []) {
  return tools.map(tool => ({
    name: tool.name,
    description: buildToolDescription(tool),
    input_schema: buildToolSchema(tool)
  }));
}

function convertAssistantMessage(message) {
  if (message.toolCall) {
    const content = [];

    if (message.toolCall.reason) {
      content.push({
        type: "text",
        text: message.toolCall.reason
      });
    }

    content.push({
      type: "tool_use",
      id: message.toolCall.id,
      name: message.toolCall.name,
      input: message.toolCall.input || {}
    });

    return {
      role: "assistant",
      content
    };
  }

  return {
    role: "assistant",
    content: String(message.content || "")
  };
}

function convertToolMessage(message) {
  if (message.toolCallId) {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: String(message.content || ""),
          ...(message.toolResult?.ok === false ? { is_error: true } : {})
        }
      ]
    };
  }

  return {
    role: "user",
    content: String(message.content || "")
  };
}

function convertMessages(messages = []) {
  return messages.map(message => {
    if (message.role === "assistant") {
      return convertAssistantMessage(message);
    }

    if (message.role === "tool") {
      return convertToolMessage(message);
    }

    return {
      role: "user",
      content: String(message.content || "")
    };
  });
}

function extractToolUse(payload) {
  if (!Array.isArray(payload?.content)) {
    return null;
  }

  const toolUseBlocks = payload.content.filter(block => block.type === "tool_use");
  if (toolUseBlocks.length === 0) {
    return null;
  }

  const first = toolUseBlocks[0];
  const reason = payload.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n")
    .trim();

  return createToolCallResponse(first.name, first.input || {}, reason, first.id);
}

export class AnthropicProvider {
  constructor({ apiKey, model }) {
    this.name = "anthropic";
    this.apiKey = apiKey;
    this.model = model;
    this.nativeToolUse = true;
  }

  async generate({ systemPrompt, messages, tools }) {
    const requestBody = {
      model: this.model,
      max_tokens: 1200,
      system: systemPrompt,
      messages: convertMessages(messages)
    };

    if (Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = buildToolDefinitions(tools);
      requestBody.tool_choice = {
        type: "auto",
        disable_parallel_tool_use: true
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic provider failed: ${response.status} ${body}`);
    }

    const payload = await response.json();
    const toolUse = extractToolUse(payload);

    if (toolUse) {
      return toolUse;
    }

    return parseProtocolText(extractTextContent(payload));
  }
}
