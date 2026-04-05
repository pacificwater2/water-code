import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        ...options,
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve(String(stdout || ""));
      }
    );
  });
}

async function fileExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveGitDir(cwd) {
  const dotGitPath = path.join(cwd, ".git");

  try {
    const stats = await stat(dotGitPath);
    if (stats.isDirectory()) {
      return dotGitPath;
    }

    if (stats.isFile()) {
      const payload = await readFile(dotGitPath, "utf8");
      const match = payload.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        return path.resolve(cwd, match[1].trim());
      }
    }
  } catch {
    return "";
  }

  return "";
}

async function readHeadRef(cwd) {
  const gitDir = await resolveGitDir(cwd);
  if (!gitDir) {
    return "";
  }

  try {
    return String(await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
  } catch {
    return "";
  }
}

function createEmptyGitState(cwd, overrides = {}) {
  return {
    detected: false,
    available: false,
    root: "",
    branch: "",
    tracking: "",
    detached: false,
    clean: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    worktrees: [],
    summary: "No Git repository detected.",
    cwd: path.resolve(cwd),
    ...overrides
  };
}

function parseAheadBehind(raw = "") {
  const values = {
    ahead: 0,
    behind: 0
  };

  for (const part of String(raw || "").split(",")) {
    const trimmed = part.trim();
    const aheadMatch = trimmed.match(/^ahead\s+(\d+)$/i);
    const behindMatch = trimmed.match(/^behind\s+(\d+)$/i);

    if (aheadMatch) {
      values.ahead = Number(aheadMatch[1]);
    } else if (behindMatch) {
      values.behind = Number(behindMatch[1]);
    }
  }

  return values;
}

function parseBranchHeadline(rawHeadline) {
  const headline = String(rawHeadline || "").replace(/^##\s*/, "").trim();
  const state = {
    branch: "",
    tracking: "",
    detached: false,
    ahead: 0,
    behind: 0
  };

  if (!headline) {
    return state;
  }

  if (headline.startsWith("No commits yet on ")) {
    state.branch = headline.slice("No commits yet on ".length).trim();
    return state;
  }

  if (headline.startsWith("HEAD ")) {
    state.detached = true;
    const detachedMatch = headline.match(/\(detached (?:at|from) ([^)]+)\)/i);
    state.branch = detachedMatch?.[1] || "HEAD";
    return state;
  }

  let relation = headline;
  let syncState = "";
  const syncIndex = headline.indexOf(" [");
  if (syncIndex !== -1 && headline.endsWith("]")) {
    relation = headline.slice(0, syncIndex);
    syncState = headline.slice(syncIndex + 2, -1);
  }

  const [branchPart, trackingPart = ""] = relation.split("...", 2);
  state.branch = String(branchPart || "").trim();
  state.tracking = String(trackingPart || "").trim();

  if (syncState) {
    const parsed = parseAheadBehind(syncState);
    state.ahead = parsed.ahead;
    state.behind = parsed.behind;
  }

  return state;
}

function parseStatusCounts(lines) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicts = 0;

  for (const line of lines) {
    if (!line || line.length < 2) {
      continue;
    }

    const status = line.slice(0, 2);
    if (status === "??") {
      untracked += 1;
      continue;
    }

    if (status === "!!") {
      continue;
    }

    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)) {
      conflicts += 1;
      continue;
    }

    const stagedCode = status[0];
    const unstagedCode = status[1];

    if (stagedCode && stagedCode !== " " && stagedCode !== "?") {
      staged += 1;
    }

    if (unstagedCode && unstagedCode !== " " && unstagedCode !== "?") {
      unstaged += 1;
    }
  }

  return {
    staged,
    unstaged,
    untracked,
    conflicts
  };
}

export function parseGitStatus(rawStatus) {
  const lines = String(rawStatus || "")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);

  const headline = lines[0] || "";
  const branchState = parseBranchHeadline(headline);
  const counts = parseStatusCounts(lines.slice(headline ? 1 : 0));

  return {
    branch: branchState.branch,
    tracking: branchState.tracking,
    detached: branchState.detached,
    ahead: branchState.ahead,
    behind: branchState.behind,
    staged: counts.staged,
    unstaged: counts.unstaged,
    untracked: counts.untracked,
    conflicts: counts.conflicts,
    clean:
      counts.staged === 0 &&
      counts.unstaged === 0 &&
      counts.untracked === 0 &&
      counts.conflicts === 0
  };
}

export function parseGitWorktrees(rawWorktrees, cwd = "") {
  const resolvedCwd = path.resolve(cwd || ".");
  const worktrees = [];
  let current = null;

  const commitCurrent = () => {
    if (!current?.path) {
      current = null;
      return;
    }

    const resolvedPath = path.resolve(current.path);
    worktrees.push({
      path: resolvedPath,
      branch: current.branch || "",
      head: current.head || "",
      bare: current.bare === true,
      detached: current.detached === true,
      locked: current.locked || "",
      prunable: current.prunable || "",
      current:
        resolvedCwd === resolvedPath ||
        resolvedCwd.startsWith(`${resolvedPath}${path.sep}`)
    });
    current = null;
  };

  for (const line of String(rawWorktrees || "").split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      commitCurrent();
      continue;
    }

    const separator = trimmed.indexOf(" ");
    const key = separator === -1 ? trimmed : trimmed.slice(0, separator);
    const value = separator === -1 ? "" : trimmed.slice(separator + 1).trim();

    if (key === "worktree") {
      commitCurrent();
      current = {
        path: value
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "bare") {
      current.bare = true;
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "locked") {
      current.locked = value || "locked";
    } else if (key === "prunable") {
      current.prunable = value || "prunable";
    }
  }

  commitCurrent();
  return worktrees;
}

function formatChangeSummary(state) {
  const parts = [];

  if (state.conflicts > 0) {
    parts.push(`${state.conflicts} conflict${state.conflicts === 1 ? "" : "s"}`);
  }
  if (state.staged > 0) {
    parts.push(`${state.staged} staged`);
  }
  if (state.unstaged > 0) {
    parts.push(`${state.unstaged} unstaged`);
  }
  if (state.untracked > 0) {
    parts.push(`${state.untracked} untracked`);
  }

  return parts.length > 0 ? parts.join(", ") : "clean";
}

export function summarizeGitState(state) {
  if (!state?.detected) {
    return "No Git repository detected.";
  }

  if (!state.available) {
    return state.branch
      ? `Git metadata detected on ${state.branch}, but live status is unavailable.`
      : "Git metadata detected, but live status is unavailable.";
  }

  const branchLabel = state.detached
    ? `detached at ${state.branch || state.head || "HEAD"}`
    : state.branch || "(unknown branch)";
  const parts = [branchLabel, formatChangeSummary(state)];

  if (state.ahead > 0 || state.behind > 0) {
    const syncParts = [];
    if (state.ahead > 0) {
      syncParts.push(`ahead ${state.ahead}`);
    }
    if (state.behind > 0) {
      syncParts.push(`behind ${state.behind}`);
    }
    parts.push(syncParts.join(", "));
  }

  if (state.worktrees.length > 0) {
    parts.push(
      `${state.worktrees.length} worktree${state.worktrees.length === 1 ? "" : "s"}`
    );
  }

  return `Git ${parts.join(" | ")}`;
}

export function renderGitStatus(state) {
  if (!state.detected) {
    return "No Git repository detected.\n";
  }

  const lines = [
    state.summary,
    "",
    `Repository root: ${state.root || state.cwd}`,
    `Branch: ${
      state.detached ? `detached at ${state.branch || state.head || "HEAD"}` : state.branch || "(unknown)"
    }`,
    `Tracking: ${state.tracking || "(none)"}`,
    `Workspace state: ${
      state.clean === true ? "clean" : state.clean === false ? formatChangeSummary(state) : "unknown"
    }`
  ];

  if (state.ahead > 0 || state.behind > 0) {
    lines.push(`Sync: ahead ${state.ahead} / behind ${state.behind}`);
  }

  if (state.worktrees.length > 0) {
    const current = state.worktrees.find(worktree => worktree.current);
    lines.push(
      `Current worktree: ${current ? current.path : "(not matched)"}`,
      `Known worktrees: ${state.worktrees.length}`
    );
  }

  if (!state.available) {
    lines.push("", "Live Git status is unavailable in this workspace snapshot.");
  }

  return `${lines.join("\n")}\n`;
}

export function renderGitWorktrees(state) {
  if (!state.detected) {
    return "No Git repository detected.\n";
  }

  if (state.worktrees.length === 0) {
    return "No Git worktrees discovered.\n";
  }

  const lines = [
    `Git worktrees (${state.worktrees.length})`,
    ""
  ];

  for (const worktree of state.worktrees) {
    const details = [
      worktree.current ? "current" : "",
      worktree.branch ? `branch=${worktree.branch}` : "",
      worktree.detached ? "detached" : "",
      worktree.bare ? "bare" : "",
      worktree.locked ? "locked" : "",
      worktree.prunable ? "prunable" : ""
    ]
      .filter(Boolean)
      .join(" | ");

    lines.push(`- ${worktree.path}${details ? ` | ${details}` : ""}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function loadGitState(cwd) {
  const resolvedCwd = path.resolve(cwd);
  const headRef = await readHeadRef(resolvedCwd);
  const detected = !!headRef || (await fileExists(path.join(resolvedCwd, ".git")));

  if (!detected) {
    return createEmptyGitState(resolvedCwd);
  }

  const fallbackBranch = headRef.startsWith("ref:")
    ? path.basename(headRef.replace(/^ref:\s*/, ""))
    : headRef
      ? "HEAD"
      : "";

  try {
    const root = (await execFileText("git", ["-C", resolvedCwd, "rev-parse", "--show-toplevel"]))
      .trim();
    const statusOutput = await execFileText("git", [
      "-C",
      resolvedCwd,
      "status",
      "--short",
      "--branch"
    ]);
    const parsedStatus = parseGitStatus(statusOutput);

    let worktrees = [];
    try {
      const rawWorktrees = await execFileText("git", [
        "-C",
        resolvedCwd,
        "worktree",
        "list",
        "--porcelain"
      ]);
      worktrees = parseGitWorktrees(rawWorktrees, resolvedCwd);
    } catch {
      worktrees = [];
    }

    if (worktrees.length === 0) {
      worktrees = [
        {
          path: root,
          branch: parsedStatus.branch,
          head: "",
          bare: false,
          detached: parsedStatus.detached,
          locked: "",
          prunable: "",
          current: true
        }
      ];
    }

    const state = {
      ...createEmptyGitState(resolvedCwd),
      detected: true,
      available: true,
      root,
      branch: parsedStatus.branch || fallbackBranch,
      tracking: parsedStatus.tracking,
      detached: parsedStatus.detached,
      clean: parsedStatus.clean,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      staged: parsedStatus.staged,
      unstaged: parsedStatus.unstaged,
      untracked: parsedStatus.untracked,
      conflicts: parsedStatus.conflicts,
      worktrees
    };

    return {
      ...state,
      summary: summarizeGitState(state)
    };
  } catch {
    const state = createEmptyGitState(resolvedCwd, {
      detected: true,
      available: false,
      branch: fallbackBranch,
      detached: fallbackBranch === "HEAD"
    });

    return {
      ...state,
      summary: summarizeGitState(state)
    };
  }
}
