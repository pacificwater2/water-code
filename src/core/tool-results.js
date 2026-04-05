function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeSection(section) {
  if (!section || typeof section !== "object") {
    return null;
  }

  const label = cleanText(section.label);
  const body = String(section.body ?? "").trim();

  if (!label || !body) {
    return null;
  }

  return { label, body };
}

export function createToolResult({
  ok = true,
  title = "",
  summary = "",
  sections = [],
  data = null,
  content = ""
}) {
  return {
    ok,
    title,
    summary,
    sections,
    data,
    content
  };
}

export function renderToolResult(result) {
  const lines = [];
  const status = result.ok ? "OK" : "ERROR";
  const title = cleanText(result.title);
  const summary = cleanText(result.summary);
  const sections = (Array.isArray(result.sections) ? result.sections : [])
    .map(normalizeSection)
    .filter(Boolean);
  const legacyContent = String(result.content ?? "").trim();

  lines.push(title ? `${status} ${title}` : status);

  if (summary) {
    lines.push("", summary);
  }

  if (sections.length > 0) {
    for (const section of sections) {
      lines.push("", `${section.label}:`, section.body);
    }
  } else if (legacyContent) {
    lines.push("", legacyContent);
  }

  return lines.join("\n");
}

export function normalizeToolResult(result, context = {}) {
  const toolName = context.toolName || "tool";

  if (!result || typeof result !== "object") {
    return {
      ok: false,
      title: `${toolName} failed`,
      summary: String(result),
      sections: [],
      data: null,
      content: String(result),
      rendered: renderToolResult({
        ok: false,
        title: `${toolName} failed`,
        summary: String(result),
        sections: [],
        content: String(result)
      })
    };
  }

  const normalized = {
    ok: !!result.ok,
    title: cleanText(result.title) || `${toolName}${result.ok ? " completed" : " failed"}`,
    summary: cleanText(result.summary),
    sections: Array.isArray(result.sections)
      ? result.sections.map(normalizeSection).filter(Boolean)
      : [],
    data: result.data ?? null,
    content: typeof result.content === "string" ? result.content : ""
  };

  if (!normalized.summary && normalized.sections.length === 0 && normalized.content) {
    normalized.summary = normalized.content;
    normalized.content = "";
  }

  return {
    ...normalized,
    rendered: renderToolResult(normalized)
  };
}
