#!/usr/bin/env node

import { main } from "../src/cli/main.js";
import { writeJsonError } from "../src/cli/output.js";

main().catch(error => {
  if (process.argv.includes("--json")) {
    writeJsonError(error, {
      transport: process.argv.includes("--remote-url") ? "remote" : "local"
    });
    process.exit(1);
  }

  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
