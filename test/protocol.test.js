import assert from "node:assert/strict";
import test from "node:test";
import {
  createToolCallResponse,
  normalizeProtocolResponse,
  parseProtocolText
} from "../src/core/protocol.js";

test("parseProtocolText parses fenced assistant JSON", () => {
  const result = parseProtocolText(`\`\`\`json
{"protocolVersion":1,"type":"assistant","message":"hello"}
\`\`\``);

  assert.equal(result.type, "assistant");
  assert.equal(result.message, "hello");
});

test("normalizeProtocolResponse accepts shorthand tool call shape", () => {
  const result = normalizeProtocolResponse({
    tool: "read_file",
    input: {
      path: "README.md"
    },
    reason: "Need context"
  });

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.name, "read_file");
  assert.deepEqual(result.toolCall.input, { path: "README.md" });
  assert.equal(result.toolCall.reason, "Need context");
});

test("parseProtocolText falls back to assistant for plain text", () => {
  const result = parseProtocolText("plain text response");

  assert.equal(result.type, "assistant");
  assert.equal(result.message, "plain text response");
});

test("createToolCallResponse keeps explicit call id", () => {
  const result = createToolCallResponse(
    "list_files",
    { path: "src", depth: 2 },
    "Inspect tree",
    "call-fixed"
  );

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.id, "call-fixed");
  assert.equal(result.toolCall.name, "list_files");
});
