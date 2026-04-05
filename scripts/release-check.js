import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createPackageTarball } from "./package.js";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    fail(`${label} did not include ${JSON.stringify(needle)}.\nReceived:\n${haystack}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });

  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with code ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`.trim()
    );
  }

  return result.stdout ?? "";
}

const repoRoot = path.resolve(process.cwd());
const packageJsonPath = path.join(repoRoot, "package.json");
const licensePath = path.join(repoRoot, "LICENSE");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const releasePlaybookPath = path.join(repoRoot, "docs", "release-playbook.md");
const githubPublishGuidePath = path.join(repoRoot, "docs", "github-publish-guide.md");
const githubReleaseNotesPath = path.join(repoRoot, "docs", "github-release-v0.1.0.md");
const readmePath = path.join(repoRoot, "README.md");

const pkg = readJson(packageJsonPath);
const readme = readFileSync(readmePath, "utf8");

assert(pkg.name === "water-code", "package name must stay water-code");
assert(typeof pkg.version === "string" && /^\d+\.\d+\.\d+/.test(pkg.version), "package version must look like semver");
assert(pkg.private === true, "package.json should stay private until registry publishing is intentionally enabled");
assert(pkg.license === "MIT", "package.json license should be MIT");
assert(existsSync(licensePath), "LICENSE must exist");
assert(existsSync(changelogPath), "CHANGELOG.md must exist");
assert(existsSync(releasePlaybookPath), "docs/release-playbook.md must exist");
assert(existsSync(githubPublishGuidePath), "docs/github-publish-guide.md must exist");
assert(existsSync(githubReleaseNotesPath), "docs/github-release-v0.1.0.md must exist");

const changelog = readFileSync(changelogPath, "utf8");
const releasePlaybook = readFileSync(releasePlaybookPath, "utf8");
const githubPublishGuide = readFileSync(githubPublishGuidePath, "utf8");
const githubReleaseNotes = readFileSync(githubReleaseNotesPath, "utf8");
const license = readFileSync(licensePath, "utf8");

assertIncludes(license, "MIT License", "LICENSE");
assertIncludes(changelog, pkg.version, "CHANGELOG.md");
assertIncludes(releasePlaybook, "npm run ship-check", "release playbook");
assertIncludes(githubPublishGuide, "gh repo create", "GitHub publish guide");
assertIncludes(githubReleaseNotes, "Water Code v0.1.0", "GitHub release notes");
assertIncludes(readme, "npm run ship-check", "README");
assertIncludes(readme, "npm run real-world-smoke", "README");

const { tarballPath, filename } = await createPackageTarball({
  cwd: repoRoot
});
const tarList = run("tar", ["-tf", tarballPath], {
  cwd: repoRoot
});

assertIncludes(filename, pkg.version, "package tarball filename");
assertIncludes(tarList, "package/bin/water-code.js", "tarball contents");
assertIncludes(tarList, "package/src/cli/main.js", "tarball contents");
assertIncludes(tarList, "package/LICENSE", "tarball contents");
assertIncludes(tarList, "package/README.md", "tarball contents");
assertIncludes(tarList, "package/CHANGELOG.md", "tarball contents");
assertIncludes(tarList, "package/docs/release-playbook.md", "tarball contents");
assertIncludes(tarList, "package/docs/github-publish-guide.md", "tarball contents");
assertIncludes(tarList, "package/docs/github-release-v0.1.0.md", "tarball contents");
assertIncludes(tarList, "package/docs/user-manual-zh.md", "tarball contents");

console.log("PASS release-metadata");
console.log("PASS release-docs");
console.log("PASS release-tarball");
console.log("\nRelease readiness checks passed.");
