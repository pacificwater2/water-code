import process from "node:process";
import { buildSystemPrompt } from "../src/core/system-prompt.js";
import { AnthropicProvider } from "../src/provider/anthropic-provider.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

const provider = new AnthropicProvider({
  apiKey: "test-key",
  model: "test-model"
});

const tools = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file.",
    inputHint: "{ path: string }",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"],
      additionalProperties: false
    }
  }
];

const systemPrompt = buildSystemPrompt({
  productName: "Water Code",
  cwd: "/tmp/project",
  tools,
  responseStyle: "native-tools",
  projectContext: { summary: "Project root: /tmp/project" },
  permissionMode: "ask",
  permissionSummary: "Ask before dangerous tools.",
  activeAgent: null,
  activeAgentPrompt: "",
  activeSkills: [],
  activeSkillPrompts: [],
  activePlugins: [],
  activePluginPrompts: []
});

assert(!systemPrompt.includes("You must return strict JSON only"), "native-tools system prompt should not require strict JSON");

const originalFetch = global.fetch;

try {
  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    assert(Array.isArray(requestBody.tools), "Anthropic request should include tool definitions");
    assert(requestBody.tool_choice?.disable_parallel_tool_use === true, "Anthropic request should disable parallel tool use");
    assert(requestBody.messages[0].role === "user", "First request message should be user");
    assert(requestBody.messages[0].content === "read README.md", "First request should preserve user content");

    return createResponse({
      id: "msg_1",
      type: "message",
      role: "assistant",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Need to inspect the file first."
        },
        {
          type: "tool_use",
          id: "toolu_123",
          name: "read_file",
          input: {
            path: "README.md"
          }
        }
      ]
    });
  };

  const toolCall = await provider.generate({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: "read README.md"
      }
    ],
    tools
  });

  assert(toolCall.type === "tool_call", "Anthropic tool-use response should normalize to tool_call");
  assert(toolCall.toolCall.id === "toolu_123", "Tool call id should be preserved");
  assert(toolCall.toolCall.name === "read_file", "Tool call name should be preserved");
  assert(toolCall.toolCall.input.path === "README.md", "Tool call input should be preserved");
  console.log("PASS anthropic-tool-call");

  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    const assistantMessage = requestBody.messages[1];
    const toolResultMessage = requestBody.messages[2];

    assert(assistantMessage.role === "assistant", "Assistant tool call should stay assistant role");
    assert(Array.isArray(assistantMessage.content), "Assistant tool call should be block content");
    assert(assistantMessage.content.some(block => block.type === "tool_use"), "Assistant history should include tool_use block");
    assert(toolResultMessage.role === "user", "Tool result should map to user role");
    assert(Array.isArray(toolResultMessage.content), "Tool result should be block content");
    assert(toolResultMessage.content[0].type === "tool_result", "Tool result block should be first");
    assert(toolResultMessage.content[0].tool_use_id === "toolu_123", "tool_result should reference tool_use id");

    return createResponse({
      id: "msg_2",
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Here is what I found."
        }
      ]
    });
  };

  const assistant = await provider.generate({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: "read README.md"
      },
      {
        role: "assistant",
        content: "Tool call: read_file",
        toolCall: {
          id: "toolu_123",
          name: "read_file",
          input: {
            path: "README.md"
          },
          reason: "Need to inspect the file first."
        }
      },
      {
        role: "tool",
        name: "read_file",
        toolCallId: "toolu_123",
        content: "OK Read file README.md\n\nContents:\n# README.md",
        toolResult: {
          ok: true
        }
      }
    ],
    tools
  });

  assert(assistant.type === "assistant", "Anthropic text response should normalize to assistant");
  assert(assistant.message === "Here is what I found.", "Assistant text should be preserved");
  console.log("PASS anthropic-tool-history");
} finally {
  global.fetch = originalFetch;
}

console.log("\nProvider smoke checks passed.");
