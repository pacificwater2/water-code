import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with code ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`.trim()
    );
  }

  return result.stdout ?? "";
}

function assertIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${label} did not include ${JSON.stringify(needle)}.\nReceived:\n${haystack}`);
  }
}

const repoRoot = path.resolve(process.cwd());
const entry = path.join(repoRoot, "bin", "water-code.js");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "water-code-real-world-"));
const mainRepo = path.join(tempRoot, "app-main");
const reviewWorktree = path.join(tempRoot, "app-review");

try {
  await mkdir(path.join(mainRepo, "src"), {
    recursive: true
  });
  await writeFile(
    path.join(mainRepo, "README.md"),
    "# Real World Demo\n\nThis is a temporary repo for Water Code smoke coverage.\n",
    "utf8"
  );
  await writeFile(
    path.join(mainRepo, "src", "app.js"),
    "export function greet(name) {\n  return `hello ${name}`;\n}\n",
    "utf8"
  );

  run("git", ["init"], {
    cwd: mainRepo
  });
  run("git", ["config", "user.name", "Water Code Smoke"], {
    cwd: mainRepo
  });
  run("git", ["config", "user.email", "water-code-smoke@example.com"], {
    cwd: mainRepo
  });
  run("git", ["branch", "-M", "main"], {
    cwd: mainRepo
  });
  run("git", ["add", "."], {
    cwd: mainRepo
  });
  run("git", ["commit", "-m", "initial commit"], {
    cwd: mainRepo
  });
  run("git", ["branch", "feature/review"], {
    cwd: mainRepo
  });
  run("git", ["worktree", "add", reviewWorktree, "feature/review"], {
    cwd: mainRepo
  });

  const doctorOutput = run(process.execPath, [entry, "--cwd", mainRepo, "--doctor"], {
    cwd: repoRoot
  });
  assertIncludes(doctorOutput, "Water Code Doctor", "real-world doctor");
  assertIncludes(doctorOutput, "Overall: OK", "real-world doctor");
  console.log("PASS real-world-doctor");

  const gitOutput = run(process.execPath, [entry, "--cwd", mainRepo, "-p", "/git"], {
    cwd: repoRoot
  });
  assertIncludes(gitOutput, "Git main", "real-world /git");
  console.log("PASS real-world-git");

  const worktreesOutput = run(process.execPath, [entry, "--cwd", mainRepo, "-p", "/worktrees"], {
    cwd: repoRoot
  });
  assertIncludes(worktreesOutput, "feature/review", "real-world /worktrees");
  assertIncludes(worktreesOutput, reviewWorktree, "real-world /worktrees");
  console.log("PASS real-world-worktrees");

  const projectJson = JSON.parse(
    run(process.execPath, [entry, "--cwd", mainRepo, "adapter", "project", "--input", "worktree:feature/review"], {
      cwd: repoRoot
    })
  );
  assertIncludes(projectJson.steps?.[0]?.report?.toCwd, reviewWorktree, "real-world adapter project");
  console.log("PASS real-world-adapter-project");

  const stateJson = JSON.parse(
    run(process.execPath, [entry, "--cwd", mainRepo, "--provider", "planner", "adapter", "state"], {
      cwd: repoRoot
    })
  );
  assertIncludes(stateJson.steps?.[0]?.state?.git?.branch, "main", "real-world adapter state");
  console.log("PASS real-world-adapter-state");

  const plannerGitOutput = run(process.execPath, [entry, "--cwd", mainRepo, "--provider", "planner", "-p", "git status"], {
    cwd: repoRoot
  });
  assertIncludes(plannerGitOutput, "Tool result received:", "real-world planner git");
  assertIncludes(plannerGitOutput, "Git status", "real-world planner git");
  console.log("PASS real-world-planner-git");

  const readmeJson = JSON.parse(
    run(process.execPath, [entry, "--cwd", mainRepo, "--json", "--provider", "planner", "-p", "read README.md"], {
      cwd: repoRoot
    })
  );
  assertIncludes(readmeJson.steps?.[0]?.output, "Real World Demo", "real-world planner read");
  console.log("PASS real-world-readme");

  const initRoot = path.join(tempRoot, "blank-project");
  await mkdir(initRoot, {
    recursive: true
  });
  const initOutput = run(process.execPath, [entry, "--cwd", initRoot, "--init"], {
    cwd: repoRoot
  });
  assertIncludes(initOutput, "Initialized Water Code scaffolding", "real-world init");
  const instructions = await readFile(path.join(initRoot, "WATER.md"), "utf8");
  assertIncludes(instructions, "Water Code", "real-world WATER.md");
  console.log("PASS real-world-init");

  console.log("\nReal-world smoke checks passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
