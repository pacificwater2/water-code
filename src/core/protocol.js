import { randomUUID } from "node:crypto";

export const PROTOCOL_VERSION = 1;

function defaultCallId() {
  return `call-${randomUUID()}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pickText(payload) {
  if (typeof payload?.message === "string") {
    return payload.message;
  }

  if (typeof payload?.content === "string") {
    return payload.content;
  }

  return "";
}

function normalizeAssistant(payload) {
  const message = pickText(payload).trim();

  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "assistant",
    message: message || "No response returned by provider."
  };
}

function normalizeToolCall(payload) {
  const toolCall = asObject(payload.toolCall);
  const name = toolCall?.name || payload.tool || payload.name;
  const input = toolCall?.input ?? payload.input ?? {};
  const reason = toolCall?.reason || payload.reason || "";
  const id = toolCall?.id || payload.id || defaultCallId();

  if (!name || typeof name !== "string") {
    throw new Error("Tool call response must include a tool name");
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    toolCall: {
      id,
      name,
      input: asObject(input) || {},
      reason: typeof reason === "string" ? reason : ""
    }
  };
}

export function createAssistantResponse(message) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "assistant",
    message
  };
}

export function createToolCallResponse(name, input = {}, reason = "", id = defaultCallId()) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    toolCall: {
      id,
      name,
      input,
      reason
    }
  };
}

export function normalizeProtocolResponse(payload) {
  const object = asObject(payload);

  if (!object) {
    return createAssistantResponse("Provider returned a non-object response.");
  }

  if (object.type === "assistant") {
    return normalizeAssistant(object);
  }

  if (object.type === "tool_call") {
    return normalizeToolCall(object);
  }

  if (object.toolCall || object.tool || object.input) {
    return normalizeToolCall({
      ...object,
      type: "tool_call"
    });
  }

  return normalizeAssistant(object);
}

export function extractJsonPayload(text) {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export function parseProtocolText(text) {
  const raw = extractJsonPayload(text);

  try {
    const parsed = JSON.parse(raw);
    return normalizeProtocolResponse(parsed);
  } catch {
    return createAssistantResponse(text.trim() || "No response returned by provider.");
  }
}
