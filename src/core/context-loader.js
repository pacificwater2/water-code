import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_NAMES = new Set([".git", "node_modules", ".water-code", "dist", "build"]);

const MANIFEST_SPECS = [
  { file: "package.json", hint: "Node.js" },
  { file: "pyproject.toml", hint: "Python" },
  { file: "requirements.txt", hint: "Python" },
  { file: "Cargo.toml", hint: "Rust" },
  { file: "go.mod", hint: "Go" },
  { file: "pom.xml", hint: "Java" },
  { file: "build.gradle", hint: "Java" },
  { file: "Makefile", hint: "Make" }
];

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clampText(text, maxLength = 1200) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function firstUsefulLines(text, maxLines = 12) {
  return text
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(0, maxLines)
    .join("\n");
}

async function safeReadText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectManifestNotes(cwd) {
  const notes = [];

  const packageJsonPath = path.join(cwd, "package.json");
  if (await fileExists(packageJsonPath)) {
    try {
      const payload = JSON.parse(await readFile(packageJsonPath, "utf8"));
      const scripts = Object.keys(payload.scripts || {});
      notes.push(
        `package.json: name=${payload.name || "(unknown)"}${
          scripts.length > 0 ? ` scripts=${scripts.slice(0, 8).join(",")}` : ""
        }`
      );
    } catch {
      notes.push("package.json: present but could not be parsed as JSON");
    }
  }

  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (await fileExists(pyprojectPath)) {
    const text = await safeReadText(pyprojectPath);
    const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    notes.push(`pyproject.toml: name=${nameMatch?.[1] || "(unknown)"}`);
  }

  const cargoPath = path.join(cwd, "Cargo.toml");
  if (await fileExists(cargoPath)) {
    const text = await safeReadText(cargoPath);
    const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    notes.push(`Cargo.toml: crate=${nameMatch?.[1] || "(unknown)"}`);
  }

  const goModPath = path.join(cwd, "go.mod");
  if (await fileExists(goModPath)) {
    const text = await safeReadText(goModPath);
    const moduleMatch = text.match(/^\s*module\s+(.+)$/m);
    notes.push(`go.mod: module=${moduleMatch?.[1]?.trim() || "(unknown)"}`);
  }

  return notes;
}

function formatProjectContext(context) {
  const sections = [
    `Project root: ${context.cwd}`,
    `Git repo: ${context.hasGit ? "yes" : "no"}`,
    `Language hints: ${context.languageHints.length > 0 ? context.languageHints.join(", ") : "(none detected)"}`,
    `Key files: ${context.keyFiles.length > 0 ? context.keyFiles.join(", ") : "(none detected)"}`,
    `Top directories: ${context.topDirectories.length > 0 ? context.topDirectories.join(", ") : "(none)"}`,
    `Top files: ${context.topFiles.length > 0 ? context.topFiles.join(", ") : "(none)"}`
  ];

  if (context.manifestNotes.length > 0) {
    sections.push(`Manifest notes:\n- ${context.manifestNotes.join("\n- ")}`);
  }

  if (context.readmePreview) {
    sections.push(`README preview:\n${context.readmePreview}`);
  }

  return sections.join("\n\n");
}

export async function loadProjectContext(cwd) {
  const rootEntries = await readdir(cwd, { withFileTypes: true });
  rootEntries.sort((left, right) => left.name.localeCompare(right.name));

  const visibleEntries = rootEntries.filter(entry => !IGNORED_NAMES.has(entry.name));
  const topDirectories = visibleEntries
    .filter(entry => entry.isDirectory())
    .map(entry => `${entry.name}/`)
    .slice(0, 12);
  const topFiles = visibleEntries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .slice(0, 12);

  const keyFiles = [];
  const languageHints = [];

  for (const spec of MANIFEST_SPECS) {
    if (await fileExists(path.join(cwd, spec.file))) {
      keyFiles.push(spec.file);
      languageHints.push(spec.hint);
    }
  }

  for (const file of ["README.md", "README", "WATER.md", ".gitignore", ".env.example"]) {
    if (await fileExists(path.join(cwd, file))) {
      keyFiles.push(file);
    }
  }

  const readmePath = ["README.md", "README"]
    .map(file => path.join(cwd, file))
    .find(Boolean);

  let readmePreview = "";
  if (readmePath && (await fileExists(readmePath))) {
    const text = await safeReadText(readmePath);
    readmePreview = clampText(firstUsefulLines(text));
  }

  const manifestNotes = await collectManifestNotes(cwd);
  const hasGit = await fileExists(path.join(cwd, ".git"));

  const context = {
    cwd,
    hasGit,
    languageHints: unique(languageHints),
    keyFiles: unique(keyFiles),
    topDirectories,
    topFiles,
    manifestNotes,
    readmePreview
  };

  return {
    ...context,
    summary: formatProjectContext(context)
  };
}
