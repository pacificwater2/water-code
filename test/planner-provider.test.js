import assert from "node:assert/strict";
import test from "node:test";
import { PlannerProvider } from "../src/provider/planner-provider.js";

const provider = new PlannerProvider();
const tools = [
  { name: "read_file" },
  { name: "list_background_tasks" },
  { name: "start_background_task" },
  { name: "get_background_task" }
];

async function generateFromUser(content) {
  return provider.generate({
    tools,
    messages: [
      {
        role: "user",
        content
      }
    ]
  });
}

test("planner maps file listing prompt to list_files tool", async () => {
  const result = await generateFromUser("list files in src depth 3");

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.name, "list_files");
  assert.deepEqual(result.toolCall.input, {
    path: "src",
    depth: 3
  });
});

test("planner maps background task listing prompt before generic show/read handling", async () => {
  const result = await generateFromUser("show background task wctask-123");

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.name, "get_background_task");
  assert.equal(result.toolCall.input.taskId, "wctask-123");
});

test("planner maps start background task prompt", async () => {
  const result = await generateFromUser("start background task ::: read README.md");

  assert.equal(result.type, "tool_call");
  assert.equal(result.toolCall.name, "start_background_task");
  assert.equal(result.toolCall.input.prompt, "read README.md");
});

test("planner responds to tool results with assistant message", async () => {
  const result = await provider.generate({
    tools,
    messages: [
      {
        role: "tool",
        content: "OK Read file README.md"
      }
    ]
  });

  assert.equal(result.type, "assistant");
  assert.match(result.message, /Tool result received:/);
});
