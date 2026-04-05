import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createToolResult } from "../core/tool-results.js";

const execFileAsync = promisify(execFile);

export const bashTool = {
  name: "bash",
  description: "Run a zsh command in the current project directory.",
  inputHint: "{ command: string, timeoutMs?: number }",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute with zsh -f -lc." },
      timeoutMs: { type: "integer", description: "Timeout in milliseconds." }
    },
    required: ["command"],
    additionalProperties: false
  },
  dangerous: true,
  permissionGroup: "shell",
  async execute(input, { cwd }) {
    const command = String(input?.command || "").trim();

    if (!command) {
      throw new Error("bash requires a command");
    }

    const timeout = Math.max(1000, Math.min(Number(input.timeoutMs || 10000), 120000));

    try {
      const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-f", "-lc", command], {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024
      });

      return createToolResult({
        ok: true,
        title: `Ran command`,
        summary: "Exit code 0.",
        sections: [
          {
            label: "Command",
            body: command
          },
          {
            label: "Stdout",
            body: stdout || "(empty)"
          },
          ...(stderr
            ? [
                {
                  label: "Stderr",
                  body: stderr
                }
              ]
            : [])
        ],
        data: {
          command,
          exitCode: 0
        }
      });
    } catch (error) {
      const stdout = error?.stdout || "";
      const stderr = error?.stderr || "";
      const message = error instanceof Error ? error.message : String(error);
      const exitCode = typeof error?.code === "number" ? error.code : null;
      const signal = error?.signal || "";

      return createToolResult({
        ok: false,
        title: "Command failed",
        summary: exitCode === null ? message : `Exit code ${exitCode}. ${message}`,
        sections: [
          {
            label: "Command",
            body: command
          },
          {
            label: "Stdout",
            body: stdout || "(empty)"
          },
          {
            label: "Stderr",
            body: stderr || "(empty)"
          },
          ...(signal
            ? [
                {
                  label: "Signal",
                  body: String(signal)
                }
              ]
            : [])
        ],
        data: {
          command,
          exitCode,
          signal: signal || null
        }
      });
    }
  }
};
