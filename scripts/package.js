import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function createNpmEnv(cacheDir = path.join(os.tmpdir(), "water-code-npm-cache")) {
  return {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false"
  };
}

export async function createPackageTarball({
  cwd = process.cwd(),
  outDir = "dist",
  clean = true
} = {}) {
  const outputDir = path.resolve(cwd, outDir);
  const cacheDir = path.join(os.tmpdir(), "water-code-npm-cache");

  if (clean) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const result = spawnSync("npm", ["pack", "--json", "--pack-destination", outputDir], {
    cwd,
    encoding: "utf8",
    env: createNpmEnv(cacheDir)
  });

  if (result.status !== 0) {
    throw new Error(
      `npm pack failed with code ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`.trim()
    );
  }

  const payload = JSON.parse(String(result.stdout || "[]").trim());
  const packInfo = Array.isArray(payload) ? payload[0] : payload;

  if (!packInfo?.filename) {
    throw new Error(`npm pack did not return a filename.\nstdout:\n${result.stdout ?? ""}`.trim());
  }

  return {
    outputDir,
    filename: packInfo.filename,
    tarballPath: path.join(outputDir, packInfo.filename)
  };
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const packed = await createPackageTarball();

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(packed, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Created package tarball:\n${packed.tarballPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
