import readline from "node:readline/promises";
import process from "node:process";
import { SlashCommandRegistry } from "../commands/index.js";
import { summarizeApprovalInput } from "../core/approval-state.js";
import { buildOnboardingReport } from "../core/onboarding.js";

export async function startRepl(runtime) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const commands = new SlashCommandRegistry();

  runtime.setConfirmToolCall(async (tool, input, meta = {}) => {
    const group = tool.permissionGroup || "dangerous";
    const preview = summarizeApprovalInput(input);
    const answer = await rl.question(
      [
        "",
        "Approval requested",
        `Tool: ${tool.name}`,
        `Group: ${group}`,
        `Mode: ${meta.mode || runtime.permissionMode}`,
        `Input: ${preview}`,
        "Choices: [y] allow once, [a] allow tool for this run, [g] allow group for this run, [n] deny",
        "Decision: "
      ].join("\n")
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "a" || normalized === "always") {
      return {
        allowed: true,
        persist: "tool-session"
      };
    }
    if (normalized === "g" || normalized === "group") {
      return {
        allowed: true,
        persist: "group-session"
      };
    }
    if (/^y(es)?$/i.test(normalized)) {
      return {
        allowed: true,
        persist: ""
      };
    }
    return {
      allowed: false,
      persist: ""
    };
  });

  process.stdout.write(
      `Water Code interactive mode\n` +
      `provider=${runtime.providerName} cwd=${runtime.cwd} permissions=${runtime.permissionMode} agent=${runtime.getActiveAgent()?.name || "(none)"} skills=${runtime.getActiveSkills().map(skill => skill.name).join(",") || "(none)"} plugins=${runtime.getProjectPlugins().map(plugin => plugin.name).join(",") || "(none)"}\n` +
      `Type /help for commands. Use /approvals to inspect remembered approvals and recent decisions.\n\n`
  );

  const onboarding = await buildOnboardingReport(runtime);
  if (onboarding.shouldShowHint) {
    process.stdout.write(
      `Onboarding: ${onboarding.headline}\n` +
        `Run /onboard for recommended next steps.\n\n`
    );
  }

  while (true) {
    const line = await rl.question(`water-code> `);
    const input = line.trim();

    if (!input) {
      continue;
    }

    if (input.startsWith("/")) {
      const result = await commands.execute(input, runtime);
      if (result.output) {
        process.stdout.write(result.output.endsWith("\n\n") ? result.output : `${result.output}\n`);
      }
      if (!result.shouldContinue) {
        break;
      }
      continue;
    }

    const result = await runtime.runPrompt(input);
    process.stdout.write(`\n${result.output}\n\n`);
  }

  rl.close();
}
