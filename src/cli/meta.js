import { readFile } from "node:fs/promises";

let cachedMetadata = null;

export async function getPackageMetadata() {
  if (cachedMetadata) {
    return cachedMetadata;
  }

  const raw = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  cachedMetadata = JSON.parse(raw);
  return cachedMetadata;
}
