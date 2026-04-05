function truncateText(value, limit = 160) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

export function summarizeApprovalInput(input) {
  if (input === undefined) {
    return "(no input)";
  }

  try {
    return truncateText(JSON.stringify(input));
  } catch {
    return truncateText(String(input));
  }
}

export function createApprovalStateManager(options = {}) {
  const historyLimit = Math.max(1, Number(options.historyLimit) || 40);
  const allowedTools = new Set();
  const allowedGroups = new Set();
  const recent = [];

  function record(entry = {}) {
    recent.unshift({
      createdAt: new Date().toISOString(),
      toolName: String(entry.toolName || ""),
      permissionGroup: String(entry.permissionGroup || ""),
      mode: String(entry.mode || "ask"),
      allowed: entry.allowed !== false,
      source: String(entry.source || "unknown"),
      reason: String(entry.reason || ""),
      persistedScope: String(entry.persistedScope || ""),
      inputPreview: summarizeApprovalInput(entry.input)
    });

    if (recent.length > historyLimit) {
      recent.length = historyLimit;
    }
  }

  return {
    lookup(tool, metadata = {}) {
      const permissionGroup = String(metadata.permissionGroup || tool.permissionGroup || "dangerous");

      if (allowedTools.has(tool.name)) {
        return {
          allowed: true,
          source: "policy",
          persistedScope: "tool",
          reason: `Previously approved ${tool.name} for this Water Code run.`
        };
      }

      if (allowedGroups.has(permissionGroup)) {
        return {
          allowed: true,
          source: "policy",
          persistedScope: "group",
          reason: `Previously approved ${permissionGroup} tools for this Water Code run.`
        };
      }

      return null;
    },
    remember(tool, metadata = {}, persist = "") {
      if (persist === "tool-session") {
        allowedTools.add(tool.name);
        return "tool";
      }

      if (persist === "group-session") {
        allowedGroups.add(String(metadata.permissionGroup || tool.permissionGroup || "dangerous"));
        return "group";
      }

      return "";
    },
    record,
    getSnapshot() {
      return {
        allowedTools: Array.from(allowedTools.values()).sort(),
        allowedGroups: Array.from(allowedGroups.values()).sort(),
        recent: recent.slice()
      };
    },
    clearHistory() {
      recent.length = 0;
    },
    clearPolicies() {
      allowedTools.clear();
      allowedGroups.clear();
    },
    reset() {
      this.clearHistory();
      this.clearPolicies();
    }
  };
}
