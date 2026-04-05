import { spawn } from "node:child_process";
import process from "node:process";

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main() {
  const includeBridge = process.argv.includes("--bridge");
  const steps = [
    ["npm", ["test"]],
    ["npm", ["run", "smoke"]],
    ["npm", ["run", "provider-smoke"]],
    ["npm", ["run", "vscode-shim-smoke"]]
  ];

  if (includeBridge) {
    steps.push(["npm", ["run", "bridge-smoke"]]);
  }

  for (const [command, args] of steps) {
    console.log(`\n==> ${command} ${args.join(" ")}`);
    await runStep(command, args);
  }

  if (!includeBridge) {
    console.log("\nSkipped bridge smoke. Run `npm run verify -- --bridge` when localhost bind is available.");
  }

  console.log("\nWater Code verification completed.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
