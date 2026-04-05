import { readFile } from "node:fs/promises";
import { createToolResult } from "../core/tool-results.js";
import { resolveProjectPath, toProjectRelative } from "../utils/path.js";
import { buildUnifiedDiff } from "../utils/unified-diff.js";

export const previewDiffTool = {
  name: "preview_diff",
  description: "Preview a unified diff for replacing a file with new UTF-8 text.",
  inputHint: "{ path: string, content: string }",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative file path." },
      content: { type: "string", description: "Replacement file contents." }
    },
    required: ["path", "content"],
    additionalProperties: false
  },
  async execute(input, { cwd }) {
    if (!input?.path) {
      throw new Error("preview_diff requires a path");
    }

    const target = resolveProjectPath(cwd, input.path);
    let current = "";

    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const next = String(input.content ?? "");
    const relativePath = toProjectRelative(cwd, target);
    const diff = buildUnifiedDiff({
      oldText: current,
      newText: next,
      path: relativePath
    });

    return createToolResult({
      ok: true,
      title: `Diff preview for ${relativePath}`,
      summary: diff.includes("(no changes)") ? "No content changes." : "Previewing a full replacement.",
      sections: [
        {
          label: "Diff",
          body: diff
        }
      ],
      data: {
        path: relativePath
      }
    });
  }
};
