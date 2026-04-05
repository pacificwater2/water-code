import { readdir, stat } from "node:fs/promises";
import { createToolResult } from "../core/tool-results.js";
import { toProjectRelative, resolveProjectPath } from "../utils/path.js";

const IGNORED_DIRS = new Set([".git", "node_modules", ".water-code", "dist", "build"]);

async function walk(absPath, cwd, depth, lines, level = 0) {
  const info = await stat(absPath);
  const relative = toProjectRelative(cwd, absPath);

  if (info.isFile()) {
    lines.push(relative);
    return;
  }

  if (level > 0) {
    lines.push(`${relative}/`);
  }

  if (level >= depth) {
    return;
  }

  const entries = await readdir(absPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    await walk(`${absPath}/${entry.name}`, cwd, depth, lines, level + 1);
  }
}

export const listFilesTool = {
  name: "list_files",
  description: "List files under a project-relative directory.",
  inputHint: "{ path?: string, depth?: number }",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative path to inspect." },
      depth: { type: "integer", description: "Max directory recursion depth." }
    },
    additionalProperties: false
  },
  async execute(input, { cwd }) {
    const target = resolveProjectPath(cwd, input?.path || ".");
    const depth = Math.max(0, Math.min(Number(input?.depth || 2), 6));
    const lines = [];
    const relativePath = toProjectRelative(cwd, target);

    await walk(target, cwd, depth, lines);

    return createToolResult({
      ok: true,
      title: `Listed files in ${relativePath}`,
      summary: `${lines.length} entr${lines.length === 1 ? "y" : "ies"} shown at depth ${depth}.`,
      sections: [
        {
          label: "Tree",
          body: lines.length > 0 ? lines.join("\n") : "(empty directory)"
        }
      ],
      data: {
        path: relativePath,
        depth,
        entryCount: lines.length
      }
    });
  }
};
