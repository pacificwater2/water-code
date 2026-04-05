import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../src/core/system-prompt.js";
import { AnthropicProvider } from "../src/provider/anthropic-provider.js";

function createResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

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

function createSystemPrompt() {
  return buildSystemPrompt({
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
}

test("anthropic provider emits native tool definitions and parses tool_use", async t => {
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    model: "test-model"
  });
  const originalFetch = global.fetch;
  const systemPrompt = createSystemPrompt();

  t.after(() => {
    global.fetch = originalFetch;
  });

  assert.ok(!systemPrompt.includes("You must return strict JSON only"));

  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);

    assert.ok(Array.isArray(requestBody.tools));
    assert.equal(requestBody.tool_choice?.disable_parallel_tool_use, true);
    assert.equal(requestBody.messages[0].role, "user");
    assert.equal(requestBody.messages[0].content, "read README.md");

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

  const result = await provider.generate({
    systemPrompt,
    messages: [
      {
        role: "user",
        content: "read README.md"
      }
    ],
    tools
  });

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.id, "toolu_123");
  assert.equal(result.toolCall.name, "read_file");
  assert.deepEqual(result.toolCall.input, { path: "README.md" });
});

test("anthropic provider converts assistant tool history and tool_result blocks", async t => {
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    model: "test-model"
  });
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    const assistantMessage = requestBody.messages[1];
    const toolResultMessage = requestBody.messages[2];

    assert.equal(assistantMessage.role, "assistant");
    assert.ok(Array.isArray(assistantMessage.content));
    assert.ok(assistantMessage.content.some(block => block.type === "tool_use"));
    assert.equal(toolResultMessage.role, "user");
    assert.ok(Array.isArray(toolResultMessage.content));
    assert.equal(toolResultMessage.content[0].type, "tool_result");
    assert.equal(toolResultMessage.content[0].tool_use_id, "toolu_123");

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

  const result = await provider.generate({
    systemPrompt: createSystemPrompt(),
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
        content: "OK Read file README.md",
        toolResult: {
          ok: true
        }
      }
    ],
    tools
  });

  assert.equal(result.type, "assistant");
  assert.equal(result.message, "Here is what I found.");
});
