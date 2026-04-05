export const PERMISSION_MODES = ["ask", "accept-edits", "read-only", "yolo"];

function normalizeInteractiveDecision(decision) {
  if (typeof decision === "boolean") {
    return {
      allowed: decision,
      persist: ""
    };
  }

  if (!decision || typeof decision !== "object") {
    return {
      allowed: false,
      persist: ""
    };
  }

  const persist = ["tool-session", "group-session"].includes(decision.persist)
    ? decision.persist
    : "";

  return {
    allowed: decision.allowed === true,
    persist
  };
}

function withRecordedDecision(approvalState, entry, result) {
  approvalState?.record?.({
    ...entry,
    allowed: result.allowed,
    reason: result.reason,
    source: result.source || "",
    persistedScope: result.persistedScope || ""
  });

  return result;
}

export function normalizePermissionMode(mode) {
  const normalized = String(mode || "ask").trim().toLowerCase();

  if (!PERMISSION_MODES.includes(normalized)) {
    throw new Error(
      `Unknown permission mode: ${mode}. Expected one of: ${PERMISSION_MODES.join(", ")}`
    );
  }

  return normalized;
}

export function describePermissionMode(mode) {
  switch (normalizePermissionMode(mode)) {
    case "ask":
      return "Ask before dangerous tools when interactive; otherwise deny.";
    case "accept-edits":
      return "Auto-allow edit tools, but require approval for shell commands.";
    case "read-only":
      return "Block all dangerous tools.";
    case "yolo":
      return "Allow all dangerous tools without confirmation.";
    default:
      return "";
  }
}

export async function evaluateToolPermission({ mode, tool, input, confirmToolCall, approvalState }) {
  const normalizedMode = normalizePermissionMode(mode);
  const permissionGroup = tool.permissionGroup || "dangerous";
  const entry = {
    toolName: tool.name,
    permissionGroup,
    mode: normalizedMode,
    input
  };

  if (!tool.dangerous) {
    return {
      allowed: true,
      reason: "Safe tool.",
      source: "safe"
    };
  }

  if (normalizedMode === "yolo") {
    return withRecordedDecision(approvalState, entry, {
      allowed: true,
      reason: "Permission mode yolo auto-allows dangerous tools.",
      source: "mode"
    });
  }

  if (normalizedMode === "read-only") {
    return withRecordedDecision(approvalState, entry, {
      allowed: false,
      reason: "Permission mode read-only blocks dangerous tools.",
      source: "mode"
    });
  }

  if (normalizedMode === "accept-edits" && permissionGroup === "edit") {
    return withRecordedDecision(approvalState, entry, {
      allowed: true,
      reason: "Permission mode accept-edits auto-allows edit tools.",
      source: "mode"
    });
  }

  const remembered = approvalState?.lookup?.(tool, {
    permissionGroup,
    mode: normalizedMode,
    input
  });

  if (remembered?.allowed) {
    return withRecordedDecision(approvalState, entry, remembered);
  }

  if (confirmToolCall) {
    const decision = normalizeInteractiveDecision(
      await confirmToolCall(tool, input, {
        mode: normalizedMode,
        permissionGroup
      })
    );
    const persistedScope = decision.allowed
      ? approvalState?.remember?.(
          tool,
          {
            permissionGroup,
            mode: normalizedMode,
            input
          },
          decision.persist
        ) || ""
      : "";

    return withRecordedDecision(approvalState, entry, {
      allowed: decision.allowed,
      reason: decision.allowed
        ? persistedScope === "tool"
          ? `Approved interactively for ${tool.name} and remembered for this Water Code run.`
          : persistedScope === "group"
            ? `Approved interactively for ${tool.name} and remembered for ${permissionGroup} tools this run.`
            : `Approved interactively for ${tool.name}.`
        : `Interactive approval denied for ${tool.name}.`,
      source: "interactive",
      persistedScope
    });
  }

  if (normalizedMode === "accept-edits") {
    return withRecordedDecision(approvalState, entry, {
      allowed: false,
      reason: `Permission mode accept-edits requires interactive approval for ${permissionGroup} tools.`,
      source: "mode"
    });
  }

  return withRecordedDecision(approvalState, entry, {
    allowed: false,
    reason: "Permission mode ask requires interactive approval for dangerous tools.",
    source: "mode"
  });
}
