import { spawn } from "node:child_process";

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

const steps = [
  ["npm", ["run", "verify"]],
  ["npm", ["run", "package-smoke"]],
  ["npm", ["run", "real-world-smoke"]],
  ["npm", ["run", "release-check"]]
];

for (const [command, args] of steps) {
  console.log(`\n==> ${command} ${args.join(" ")}`);
  await runStep(command, args);
}

console.log("\nWater Code ship check completed.");
