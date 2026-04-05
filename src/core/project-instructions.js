import { readFile } from "node:fs/promises";
import path from "node:path";

const CANDIDATE_PATHS = ["WATER.md", path.join(".water-code", "WATER.md")];

function clampText(text, maxLength = 4000) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function previewText(text, maxLines = 16, maxLength = 1200) {
  const lines = String(text || "")
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(0, maxLines)
    .join("\n");

  return clampText(lines, maxLength);
}

export async function loadProjectInstructions(cwd) {
  for (const relativePath of CANDIDATE_PATHS) {
    const sourcePath = path.join(cwd, relativePath);

    try {
      const raw = await readFile(sourcePath, "utf8");
      const content = clampText(raw, 4000);
      if (!content) {
        continue;
      }

      return {
        sourcePath,
        content,
        preview: previewText(raw)
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
}
