import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createToolResult } from "../core/tool-results.js";
import { resolveProjectPath, toProjectRelative } from "../utils/path.js";

export const writeFileTool = {
  name: "write_file",
  description: "Write or append UTF-8 text to a project-relative file.",
  inputHint: "{ path: string, content: string, append?: boolean }",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative file path." },
      content: { type: "string", description: "Text to write." },
      append: { type: "boolean", description: "Append instead of overwrite." }
    },
    required: ["path", "content"],
    additionalProperties: false
  },
  dangerous: true,
  permissionGroup: "edit",
  async execute(input, { cwd }) {
    if (!input?.path) {
      throw new Error("write_file requires a path");
    }

    const target = resolveProjectPath(cwd, input.path);
    const content = String(input.content || "");
    await mkdir(path.dirname(target), { recursive: true });

    if (input.append) {
      await appendFile(target, content, "utf8");
    } else {
      await writeFile(target, content, "utf8");
    }

    return createToolResult({
      ok: true,
      title: `${input.append ? "Appended file" : "Wrote file"} ${toProjectRelative(cwd, target)}`,
      summary: `${content.length} bytes ${input.append ? "appended" : "written"}.`,
      data: {
        path: toProjectRelative(cwd, target),
        bytes: content.length,
        append: !!input.append
      }
    });
  }
};
