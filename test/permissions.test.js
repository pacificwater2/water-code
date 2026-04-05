import assert from "node:assert/strict";
import test from "node:test";
import {
  describePermissionMode,
  evaluateToolPermission,
  normalizePermissionMode
} from "../src/core/permissions.js";
import { createApprovalStateManager } from "../src/core/approval-state.js";

const safeTool = {
  name: "read_file",
  dangerous: false
};

const editTool = {
  name: "patch_file",
  dangerous: true,
  permissionGroup: "edit"
};

const shellTool = {
  name: "bash",
  dangerous: true,
  permissionGroup: "shell"
};

test("normalizePermissionMode validates supported modes", () => {
  assert.equal(normalizePermissionMode("YOLO"), "yolo");
  assert.throws(() => normalizePermissionMode("invalid"), /Unknown permission mode/);
});

test("describePermissionMode returns human-readable descriptions", () => {
  assert.match(describePermissionMode("ask"), /Ask before dangerous tools/);
  assert.match(describePermissionMode("accept-edits"), /Auto-allow edit tools/);
});

test("safe tools are always allowed", async () => {
  const result = await evaluateToolPermission({
    mode: "read-only",
    tool: safeTool,
    input: {},
    confirmToolCall: null
  });

  assert.equal(result.allowed, true);
  assert.match(result.reason, /Safe tool/);
});

test("accept-edits auto-allows edit tools but not shell tools", async () => {
  const editResult = await evaluateToolPermission({
    mode: "accept-edits",
    tool: editTool,
    input: {},
    confirmToolCall: null
  });
  const shellResult = await evaluateToolPermission({
    mode: "accept-edits",
    tool: shellTool,
    input: {},
    confirmToolCall: null
  });

  assert.equal(editResult.allowed, true);
  assert.equal(shellResult.allowed, false);
  assert.match(shellResult.reason, /requires interactive approval for shell tools/);
});

test("ask mode honors interactive approval callback", async () => {
  const approved = await evaluateToolPermission({
    mode: "ask",
    tool: shellTool,
    input: { command: "pwd" },
    confirmToolCall: async () => true
  });
  const denied = await evaluateToolPermission({
    mode: "ask",
    tool: shellTool,
    input: { command: "pwd" },
    confirmToolCall: async () => false
  });

  assert.equal(approved.allowed, true);
  assert.match(approved.reason, /Approved interactively/);
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /Interactive approval denied/);
});

test("interactive approval can remember tool or group for the current run", async () => {
  const approvalState = createApprovalStateManager();

  const rememberedTool = await evaluateToolPermission({
    mode: "ask",
    tool: shellTool,
    input: { command: "pwd" },
    approvalState,
    confirmToolCall: async () => ({
      allowed: true,
      persist: "tool-session"
    })
  });

  const rememberedAgain = await evaluateToolPermission({
    mode: "ask",
    tool: shellTool,
    input: { command: "pwd" },
    approvalState,
    confirmToolCall: async () => false
  });

  assert.equal(rememberedTool.allowed, true);
  assert.match(rememberedTool.reason, /remembered/);
  assert.equal(rememberedAgain.allowed, true);
  assert.match(rememberedAgain.reason, /Previously approved bash/);
  assert.equal(approvalState.getSnapshot().allowedTools[0], "bash");
});

test("read-only blocks dangerous tools and yolo allows them", async () => {
  const blocked = await evaluateToolPermission({
    mode: "read-only",
    tool: shellTool,
    input: {},
    confirmToolCall: null
  });
  const allowed = await evaluateToolPermission({
    mode: "yolo",
    tool: shellTool,
    input: {},
    confirmToolCall: null
  });

  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /read-only blocks dangerous tools/);
  assert.equal(allowed.allowed, true);
  assert.match(allowed.reason, /yolo auto-allows dangerous tools/);
});
