import { readFile } from "node:fs/promises";
import { createToolResult } from "../core/tool-results.js";
import { resolveProjectPath, toProjectRelative } from "../utils/path.js";

export const readFileTool = {
  name: "read_file",
  description: "Read a UTF-8 text file with line numbers.",
  inputHint: "{ path: string, start?: number, lines?: number }",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative file path." },
      start: { type: "integer", description: "1-based starting line number." },
      lines: { type: "integer", description: "Maximum number of lines to read." }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(input, { cwd }) {
    if (!input?.path) {
      throw new Error("read_file requires a path");
    }

    const target = resolveProjectPath(cwd, input.path);
    const start = Math.max(1, Number(input.start || 1));
    const count = Math.max(1, Math.min(Number(input.lines || 200), 500));
    const text = await readFile(target, "utf8");
    const allLines = text.split("\n");
    const slice = allLines.slice(start - 1, start - 1 + count);
    const width = String(start + slice.length).length;
    const relativePath = toProjectRelative(cwd, target);
    const end = slice.length > 0 ? start + slice.length - 1 : start;
    const numbered = slice
      .map((line, index) => `${String(start + index).padStart(width, " ")} | ${line}`)
      .join("\n");

    return createToolResult({
      ok: true,
      title: `Read file ${relativePath}`,
      summary: `Showing lines ${start}-${end} of ${Math.max(allLines.length, 1)}.`,
      sections: [
        {
          label: "Contents",
          body: `# ${relativePath}\n${numbered}`
        }
      ],
      data: {
        path: relativePath,
        start,
        end,
        totalLines: allLines.length
      }
    });
  }
};
