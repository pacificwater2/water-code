import assert from "node:assert/strict";
import test from "node:test";
import { parseGitStatus, parseGitWorktrees, summarizeGitState } from "../src/core/git-state.js";

test("parseGitStatus extracts branch sync and change counts", () => {
  const state = parseGitStatus(
    [
      "## feature/water...origin/feature/water [ahead 2, behind 1]",
      "M  src/core/runtime.js",
      " M README.md",
      "?? notes.txt",
      "UU conflicted.txt"
    ].join("\n")
  );

  assert.equal(state.branch, "feature/water");
  assert.equal(state.tracking, "origin/feature/water");
  assert.equal(state.ahead, 2);
  assert.equal(state.behind, 1);
  assert.equal(state.staged, 1);
  assert.equal(state.unstaged, 1);
  assert.equal(state.untracked, 1);
  assert.equal(state.conflicts, 1);
  assert.equal(state.clean, false);
});

test("parseGitWorktrees extracts current and detached worktrees", () => {
  const worktrees = parseGitWorktrees(
    [
      "worktree /tmp/project",
      "HEAD 1111111",
      "branch refs/heads/main",
      "",
      "worktree /tmp/project-review",
      "HEAD 2222222",
      "detached",
      ""
    ].join("\n"),
    "/tmp/project/src"
  );

  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[0].current, true);
  assert.equal(worktrees[0].branch, "main");
  assert.equal(worktrees[1].detached, true);
  assert.equal(worktrees[1].current, false);
});

test("summarizeGitState reports unavailable and clean states", () => {
  assert.match(
    summarizeGitState({
      detected: true,
      available: false,
      branch: "main"
    }),
    /main/
  );

  assert.match(
    summarizeGitState({
      detected: true,
      available: true,
      branch: "main",
      detached: false,
      clean: true,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicts: 0,
      worktrees: [{ path: "/tmp/project", current: true }]
    }),
    /clean/
  );
});
