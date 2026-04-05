import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createNpmEnv, createPackageTarball } from "./package.js";

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
const { tarballPath } = await createPackageTarball({
  cwd: repoRoot
});
const prefix = await mkdtemp(path.join(os.tmpdir(), "water-code-install-"));
const cacheDir = path.join(prefix, ".npm-cache");
const initRoot = await mkdtemp(path.join(os.tmpdir(), "water-code-package-init-"));

try {
  run("npm", ["install", "--prefix", prefix, tarballPath], {
    cwd: repoRoot,
    env: createNpmEnv(cacheDir)
  });

  const installedEntry = path.join(prefix, "node_modules", "water-code", "bin", "water-code.js");

  const versionOutput = run(process.execPath, [installedEntry, "--version"], {
    cwd: repoRoot
  });
  assertIncludes(versionOutput, "0.1.0", "installed --version");
  console.log("PASS package-version");

  const helpOutput = run(process.execPath, [installedEntry, "--help"], {
    cwd: repoRoot
  });
  assertIncludes(helpOutput, "Water Code v0.1.0", "installed --help");
  assertIncludes(helpOutput, "--bridge", "installed --help");
  assertIncludes(helpOutput, "--remote-url", "installed --help");
  console.log("PASS package-help");

  const doctorOutput = run(process.execPath, [installedEntry, "--cwd", repoRoot, "--doctor"], {
    cwd: repoRoot
  });
  assertIncludes(doctorOutput, "Water Code Doctor", "installed --doctor");
  assertIncludes(doctorOutput, "Overall: OK", "installed --doctor");
  console.log("PASS package-doctor");

  const doctorJson = JSON.parse(
    run(process.execPath, [installedEntry, "--cwd", repoRoot, "--json", "--doctor"], {
      cwd: repoRoot
    })
  );
  assertIncludes(doctorJson.steps?.[0]?.operation, "doctor", "installed --json --doctor");
  assertIncludes(doctorJson.steps?.[0]?.report?.provider, "planner", "installed --json --doctor");
  console.log("PASS package-doctor-json");

  const promptStreamJson = run(process.execPath, [
    installedEntry,
    "--cwd",
    repoRoot,
    "--json",
    "--stream",
    "--provider",
    "planner",
    "-p",
    "read README.md"
  ], {
    cwd: repoRoot
  })
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assertIncludes(
    promptStreamJson.map(item => item.event?.type).join(","),
    "completed",
    "installed --json --stream"
  );
  console.log("PASS package-prompt-stream");

  const onboardOutput = run(process.execPath, [installedEntry, "--cwd", repoRoot, "--onboard"], {
    cwd: repoRoot
  });
  assertIncludes(onboardOutput, "Water Code Onboarding", "installed --onboard");
  assertIncludes(onboardOutput, "Recommended next steps:", "installed --onboard");
  console.log("PASS package-onboard");

  const initOutput = run(process.execPath, [installedEntry, "--cwd", initRoot, "--init"], {
    cwd: repoRoot
  });
  assertIncludes(initOutput, "Initialized Water Code scaffolding", "installed --init");
  assertIncludes(initOutput, "WATER.md", "installed --init");
  console.log("PASS package-init");

  const slashOutput = run(process.execPath, [installedEntry, "--cwd", repoRoot, "-p", "/help"], {
    cwd: repoRoot
  });
  assertIncludes(slashOutput, "/context", "installed slash help");
  assertIncludes(slashOutput, "/instructions", "installed slash help");
  console.log("PASS package-run");

  const projectOutput = run(process.execPath, [installedEntry, "--cwd", repoRoot, "-p", "/project"], {
    cwd: repoRoot
  });
  assertIncludes(projectOutput, "Project root:", "installed /project");
  console.log("PASS package-project");

  const adapterState = JSON.parse(
    run(process.execPath, [installedEntry, "--cwd", repoRoot, "--provider", "planner", "adapter", "state"], {
      cwd: repoRoot
    })
  );
  assertIncludes(adapterState.steps?.[0]?.state?.provider, "planner", "installed adapter state");

  const adapterProject = JSON.parse(
    run(process.execPath, [installedEntry, "--cwd", repoRoot, "adapter", "project", "--input", "."], {
      cwd: repoRoot
    })
  );
  assertIncludes(adapterProject.steps?.[0]?.report?.toCwd, repoRoot, "installed adapter project");

  const adapterPromptStream = run(process.execPath, [
    installedEntry,
    "--cwd",
    repoRoot,
    "adapter",
    "prompt",
    "--provider",
    "planner",
    "--stream",
    "--input",
    "read README.md"
  ], {
    cwd: repoRoot
  })
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assertIncludes(
    adapterPromptStream.map(item => item.event?.type).join(","),
    "completed",
    "installed adapter stream"
  );
  console.log("PASS package-adapter");

  console.log("\nPackage smoke checks passed.");
} finally {
  await rm(prefix, { recursive: true, force: true });
  await rm(initRoot, { recursive: true, force: true });
}
