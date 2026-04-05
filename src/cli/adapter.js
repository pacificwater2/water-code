import { createBridgeClient } from "../bridge/client.js";
import { buildStatePayload } from "../bridge/server.js";
import { SlashCommandRegistry } from "../commands/index.js";
import { buildDoctorReport, renderDoctorReport } from "../core/doctor.js";
import { buildOnboardingReport, renderOnboardingReport } from "../core/onboarding.js";
import { renderScaffoldReport } from "../core/project-scaffold.js";
import { createRuntime } from "../core/runtime.js";
import { getPackageMetadata } from "./meta.js";
import { createJsonEnvelope, createJsonStep, writeJsonEnvelope, writeJsonEvent } from "./output.js";

const SUPPORTED_OPERATIONS = new Set([
  "version",
  "state",
  "project",
  "doctor",
  "onboard",
  "init",
  "prompt",
  "command"
]);

function normalizeOperation(rawOperation) {
  const operation = String(rawOperation || "").trim().toLowerCase();

  if (!operation) {
    throw new Error(
      "Adapter mode requires an operation: version | state | project | doctor | onboard | init | prompt | command."
    );
  }

  if (!SUPPORTED_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported adapter operation: ${operation}`);
  }

  return operation;
}

function buildAdapterEnvelope(options, operation, transport, remoteUrl = null) {
  return {
    ...createJsonEnvelope({
      transport,
      cwd: options.cwd,
      remoteUrl
    }),
    adapter: true,
    operation
  };
}

function writeAdapterEvent(options, operation, transport, remoteUrl, event) {
  writeJsonEvent({
    ok: true,
    adapter: true,
    operation,
    transport,
    cwd: options.cwd,
    remoteUrl,
    event
  });
}

function resolveOperationInput(options, operation) {
  const input = String(options.adapterInput || options.printPrompt || "").trim();

  if (!input) {
    throw new Error(`Adapter ${operation} requires input via --input or trailing text.`);
  }

  return input;
}

function parseProjectSwitchInput(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) {
    throw new Error("Adapter project requires input via --input or trailing text.");
  }

  if (input.startsWith("worktree:")) {
    return {
      kind: "worktree",
      value: input.slice("worktree:".length).trim()
    };
  }

  return {
    kind: "cwd",
    value: input
  };
}

async function runRemoteAdapter(options, operation) {
  const client = createBridgeClient(options.remoteUrl);

  if (options.stream && operation !== "prompt") {
    throw new Error("Adapter stream mode currently only supports the prompt operation.");
  }

  if (operation === "prompt" && options.stream) {
    const input = resolveOperationInput(options, operation);
    const events = await client.promptStream(input, {
      sessionId: options.sessionId,
      activate: true
    });

    for await (const event of events) {
      writeAdapterEvent(options, operation, "remote", client.baseUrl, event);
    }
    return;
  }

  const envelope = buildAdapterEnvelope(options, operation, "remote", client.baseUrl);

  switch (operation) {
    case "version": {
      const metadata = await getPackageMetadata();
      envelope.steps.push(
        createJsonStep("version", {
          name: metadata.name,
          version: metadata.version
        })
      );
      break;
    }
    case "state": {
      const payload = await client.state();
      envelope.steps.push(
        createJsonStep("state", {
          state: payload.state
        })
      );
      break;
    }
    case "project": {
      const target = parseProjectSwitchInput(resolveOperationInput(options, operation));
      const payload =
        target.kind === "worktree"
          ? await client.useWorktree(target.value)
          : await client.switchProject(target.value);
      envelope.cwd = payload.state?.cwd || envelope.cwd;
      envelope.steps.push(
        createJsonStep("project", {
          target,
          report: payload.report,
          state: payload.state
        })
      );
      break;
    }
    case "doctor": {
      const report = await client.doctor();
      envelope.steps.push(
        createJsonStep("doctor", {
          report,
          rendered: renderDoctorReport(report)
        })
      );
      break;
    }
    case "onboard": {
      const report = await client.onboard();
      envelope.steps.push(
        createJsonStep("onboard", {
          report,
          rendered: renderOnboardingReport(report)
        })
      );
      break;
    }
    case "init": {
      const report = await client.init({
        force: options.force
      });
      envelope.steps.push(
        createJsonStep("init", {
          report,
          rendered: renderScaffoldReport(report)
        })
      );
      break;
    }
    case "command": {
      const command = resolveOperationInput(options, operation);
      if (!command.startsWith("/")) {
        throw new Error("Adapter command input must be a slash command.");
      }
      const result = await client.command(command);
      envelope.steps.push(
        createJsonStep("command", {
          command,
          output: result.output || "",
          shouldContinue: result.shouldContinue !== false
        })
      );
      break;
    }
    case "prompt": {
      const prompt = resolveOperationInput(options, operation);
      const result = await client.prompt(prompt, {
        sessionId: options.sessionId,
        activate: true
      });
      envelope.steps.push(
        createJsonStep("prompt", {
          prompt,
          sessionId: result.sessionId || "",
          activeSessionId: result.activeSessionId || "",
          turns: result.turns || 0,
          output: result.output || ""
        })
      );
      break;
    }
    default:
      throw new Error(`Unhandled adapter operation: ${operation}`);
  }

  writeJsonEnvelope(envelope);
}

async function runLocalAdapter(options, operation) {
  if (options.stream && operation !== "prompt") {
    throw new Error("Adapter stream mode currently only supports the prompt operation.");
  }

  if (operation === "version") {
    const metadata = await getPackageMetadata();
    writeJsonEnvelope({
      ...buildAdapterEnvelope(options, operation, "local", null),
      steps: [
        createJsonStep("version", {
          name: metadata.name,
          version: metadata.version
        })
      ]
    });
    return;
  }

  const runtime = await createRuntime(options);

  try {
    if (operation === "prompt" && options.stream) {
      const prompt = resolveOperationInput(options, operation);
      await runtime.runPrompt(prompt, {
        sessionId: options.sessionId,
        onEvent(event) {
          writeAdapterEvent(options, operation, "local", null, event);
        }
      });
      return;
    }

    const envelope = buildAdapterEnvelope(options, operation, "local", null);

    switch (operation) {
      case "state": {
        const payload = await buildStatePayload(runtime);
        envelope.steps.push(
          createJsonStep("state", {
            state: payload.state
          })
        );
        break;
      }
      case "project": {
        const target = parseProjectSwitchInput(resolveOperationInput(options, operation));
        const report =
          target.kind === "worktree"
            ? await runtime.switchToWorktree(target.value)
            : await runtime.switchProject(target.value);
        envelope.cwd = runtime.cwd;
        envelope.steps.push(
          createJsonStep("project", {
            target,
            report,
            state: (await buildStatePayload(runtime)).state
          })
        );
        break;
      }
      case "doctor": {
        const report = await buildDoctorReport(runtime);
        envelope.steps.push(
          createJsonStep("doctor", {
            report,
            rendered: renderDoctorReport(report)
          })
        );
        break;
      }
      case "onboard": {
        const report = await buildOnboardingReport(runtime);
        envelope.steps.push(
          createJsonStep("onboard", {
            report,
            rendered: renderOnboardingReport(report)
          })
        );
        break;
      }
      case "init": {
        const report = await runtime.scaffoldProject({
          force: options.force
        });
        envelope.steps.push(
          createJsonStep("init", {
            report,
            rendered: renderScaffoldReport(report)
          })
        );
        break;
      }
      case "command": {
        const command = resolveOperationInput(options, operation);
        if (!command.startsWith("/")) {
          throw new Error("Adapter command input must be a slash command.");
        }
        const commands = new SlashCommandRegistry();
        const result = await commands.execute(command, runtime);
        envelope.steps.push(
          createJsonStep("command", {
            command,
            output: result.output || "",
            shouldContinue: result.shouldContinue !== false
          })
        );
        break;
      }
      case "prompt": {
        const prompt = resolveOperationInput(options, operation);
        const result = await runtime.runPrompt(prompt, {
          sessionId: options.sessionId
        });
        envelope.steps.push(
          createJsonStep("prompt", {
            prompt,
            sessionId: result.sessionId || "",
            activeSessionId: runtime.sessionId || "",
            turns: result.turns || 0,
            output: result.output || ""
          })
        );
        break;
      }
      default:
        throw new Error(`Unhandled adapter operation: ${operation}`);
    }

    writeJsonEnvelope(envelope);
  } finally {
    await runtime.close();
  }
}

export async function runAdapter(options) {
  const operation = normalizeOperation(options.adapterOperation);

  if (options.remoteUrl) {
    await runRemoteAdapter(options, operation);
    return;
  }

  await runLocalAdapter(options, operation);
}
