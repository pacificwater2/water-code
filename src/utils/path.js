import path from "node:path";

export function resolveProjectPath(cwd, rawPath = ".") {
  const projectRoot = path.resolve(cwd);
  const resolved = path.resolve(projectRoot, rawPath);

  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Path escapes project root: ${rawPath}`);
  }

  return resolved;
}

export function toProjectRelative(cwd, absPath) {
  const relative = path.relative(path.resolve(cwd), path.resolve(absPath));
  return relative || ".";
}
