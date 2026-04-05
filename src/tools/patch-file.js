import { readFile, writeFile } from "node:fs/promises";
import { createToolResult } from "../core/tool-results.js";
import { resolveProjectPath, toProjectRelative } from "../utils/path.js";
import { buildUnifiedDiff } from "../utils/unified-diff.js";

function countOccurrences(text, snippet) {
  let count = 0;
  let offset = 0;

  while (offset <= text.length) {
    const index = text.indexOf(snippet, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + snippet.length;
  }

  return count;
}

function replaceFirst(text, search, replacement) {
  const index = text.indexOf(search);
  if (index === -1) {
    return text;
  }

  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

export const patchFileTool = {
  name: "patch_file",
  description: "Apply an exact text replacement patch to a UTF-8 file.",
  inputHint: "{ path: string, oldText: string, newText: string, replaceAll?: boolean }",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative file path." },
      oldText: { type: "string", description: "Exact snippet to replace." },
      newText: { type: "string", description: "Replacement snippet." },
      replaceAll: { type: "boolean", description: "Replace every occurrence instead of the first." }
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false
  },
  dangerous: true,
  permissionGroup: "edit",
  async execute(input, { cwd }) {
    if (!input?.path) {
      throw new Error("patch_file requires a path");
    }

    if (typeof input.oldText !== "string" || input.oldText.length === 0) {
      throw new Error("patch_file requires a non-empty oldText snippet");
    }

    if (typeof input.newText !== "string") {
      throw new Error("patch_file requires newText");
    }

    const target = resolveProjectPath(cwd, input.path);
    const current = await readFile(target, "utf8");
    const occurrences = countOccurrences(current, input.oldText);

    if (occurrences === 0) {
      throw new Error("patch_file could not find oldText in the target file");
    }

    if (occurrences > 1 && !input.replaceAll) {
      throw new Error(
        `patch_file found ${occurrences} matches; pass replaceAll=true or use a more specific oldText`
      );
    }

    const next = input.replaceAll
      ? current.split(input.oldText).join(input.newText)
      : replaceFirst(current, input.oldText, input.newText);

    if (next === current) {
      return createToolResult({
        ok: true,
        title: `Patch skipped for ${toProjectRelative(cwd, target)}`,
        summary: "The requested replacement did not change the file."
      });
    }

    await writeFile(target, next, "utf8");

    const relativePath = toProjectRelative(cwd, target);
    const diff = buildUnifiedDiff({
      oldText: current,
      newText: next,
      path: relativePath
    });

    return createToolResult({
      ok: true,
      title: `Applied patch to ${relativePath}`,
      summary:
        `${occurrences} match${occurrences === 1 ? "" : "es"} found; ` +
        `${input.replaceAll ? "all replaced" : "first replaced"}.`,
      sections: [
        {
          label: "Diff",
          body: diff
        }
      ],
      data: {
        path: relativePath,
        occurrences,
        replaceAll: !!input.replaceAll
      }
    });
  }
};
