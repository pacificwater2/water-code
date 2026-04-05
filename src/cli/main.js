import path from "node:path";
import process from "node:process";
import { createBridgeClient } from "../bridge/client.js";
import { startBridgeServer } from "../bridge/server.js";
import { runBackgroundTaskWorker } from "../tasks/worker.js";
import { runAdapter } from "./adapter.js";
import { startRepl } from "./repl.js";
import { SlashCommandRegistry } from "../commands/index.js";
import { buildDoctorReport, renderDoctorReport } from "../core/doctor.js";
import { buildOnboardingReport, renderOnboardingReport } from "../core/onboarding.js";
import { getPackageMetadata } from "./meta.js";
import { createJsonEnvelope, createJsonStep, writeJsonEnvelope, writeJsonEvent } from "./output.js";
import { renderScaffoldReport } from "../core/project-scaffold.js";
import { createRuntime } from "../core/runtime.js";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.version) {
    const metadata = await getPackageMetadata();
    if (options.json) {
      writeJsonEnvelope({
        ok: true,
        transport: options.remoteUrl ? "remote" : "local",
        cwd: options.cwd,
        remoteUrl: options.remoteUrl || null,
        steps: [
          createJsonStep("version", {
            name: metadata.name,
            version: metadata.version
          })
        ]
      });
      return;
    }

    process.stdout.write(`${metadata.version}\n`);
    return;
  }

  if (options.help) {
    await printHelp();
    return;
  }

  if (options.taskWorker) {
    await runBackgroundTaskWorker(options);
    return;
  }

  if (options.adapter) {
    await runAdapter(options);
    return;
  }

  if (options.remoteUrl) {
    await runRemote(options);
    return;
  }

  if (options.json && options.bridge) {
    throw new Error("--json cannot be combined with --bridge");
  }

  if (options.stream && (!options.json || !options.printPrompt || options.printPrompt.trim().startsWith("/"))) {
    throw new Error("--stream currently requires --json and a normal prompt passed with -p/--print.");
  }

  if (options.stream && (options.doctor || options.onboard || options.init)) {
    throw new Error("--stream only supports prompt runs today, not --doctor, --onboard, or --init.");
  }

  const runtime = await createRuntime(options);
  const envelope = maybeCreateEnvelope(options);
  try {
    if (options.init) {
      const report = await runtime.scaffoldProject({
        force: options.force
      });
      const rendered = renderScaffoldReport(report);
      emitRenderedOrCollect(envelope, "init", rendered, {
        report
      });

      if (!options.doctor && !options.onboard && !options.bridge && !options.printPrompt) {
        if (envelope) {
          writeJsonEnvelope(envelope);
        }
        return;
      }

      if (!envelope) {
        process.stdout.write("\n");
      }
    }

    if (options.onboard) {
      const report = await buildOnboardingReport(runtime);
      const rendered = renderOnboardingReport(report);
      emitRenderedOrCollect(envelope, "onboard", rendered, {
        report
      });

      if (!options.doctor && !options.bridge && !options.printPrompt) {
        if (envelope) {
          writeJsonEnvelope(envelope);
        }
        return;
      }

      if (!envelope) {
        process.stdout.write("\n");
      }
    }

    if (options.doctor) {
      const report = await buildDoctorReport(runtime);
      const rendered = renderDoctorReport(report);
      emitRenderedOrCollect(envelope, "doctor", rendered, {
        report
      });
      if (envelope) {
        writeJsonEnvelope(envelope);
      }
      return;
    }

    if (options.bridge) {
      const bridge = await startBridgeServer(runtime, {
        host: options.bridgeHost,
        port: options.bridgePort
      });
      process.stdout.write(
        `Water Code bridge listening on http://${bridge.host}:${bridge.port}\n`
      );

      const shutdown = async () => {
        await bridge.close();
        await runtime.close();
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      await new Promise(() => {});
    }

    if (options.printPrompt) {
      if (options.printPrompt.trim().startsWith("/")) {
        const commands = new SlashCommandRegistry();
        const result = await commands.execute(options.printPrompt, runtime);
        if (envelope) {
          envelope.steps.push(
            createJsonStep("command", {
              command: options.printPrompt,
              output: result.output || "",
              shouldContinue: result.shouldContinue !== false
            })
          );
          writeJsonEnvelope(envelope);
        } else if (result.output) {
          process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
        }
        return;
      }

      if (options.stream) {
        await runtime.runPrompt(options.printPrompt, {
          onEvent(event) {
            writeJsonEvent({
              ok: true,
              transport: "local",
              cwd: options.cwd,
              remoteUrl: null,
              event
            });
          }
        });
        return;
      }

      const result = await runtime.runPrompt(options.printPrompt);
      if (envelope) {
        envelope.steps.push(
          createJsonStep("prompt", {
            prompt: options.printPrompt,
            sessionId: result.sessionId || "",
            activeSessionId: runtime.sessionId || "",
            turns: result.turns || 0,
            output: result.output || ""
          })
        );
        writeJsonEnvelope(envelope);
      } else {
        process.stdout.write(`${result.output}\n`);
      }
      return;
    }

    if (envelope) {
      throw new Error(
        "--json requires a one-shot operation such as --doctor, --onboard, --init, or -p/--print."
      );
    }

    await startRepl(runtime);
  } finally {
    await runtime.close();
  }
}

async function runRemote(options) {
  if (options.bridge) {
    throw new Error("--remote-url cannot be combined with --bridge");
  }

  if (options.stream && (!options.json || !options.printPrompt || options.printPrompt.trim().startsWith("/"))) {
    throw new Error("--stream remote mode currently requires --json and a normal prompt passed with -p/--print.");
  }

  if (options.stream && (options.doctor || options.onboard || options.init)) {
    throw new Error("--stream remote mode only supports prompt runs today.");
  }

  const client = createBridgeClient(options.remoteUrl);
  const envelope = options.json
    ? createJsonEnvelope({
        transport: "remote",
        cwd: options.cwd,
        remoteUrl: client.baseUrl
      })
    : null;

  if (options.init) {
    const report = await client.init({
      force: options.force
    });
    const rendered = renderScaffoldReport(report);
    if (envelope) {
      envelope.steps.push(
        createJsonStep("init", {
          report,
          rendered
        })
      );
    } else {
      process.stdout.write(rendered);
    }

    if (!options.doctor && !options.onboard && !options.printPrompt) {
      if (envelope) {
        writeJsonEnvelope(envelope);
      }
      return;
    }

    if (!envelope) {
      process.stdout.write("\n");
    }
  }

  if (options.onboard) {
    const report = await client.onboard();
    const rendered = renderOnboardingReport(report);
    if (envelope) {
      envelope.steps.push(
        createJsonStep("onboard", {
          report,
          rendered
        })
      );
    } else {
      process.stdout.write(rendered);
    }

    if (!options.doctor && !options.printPrompt) {
      if (envelope) {
        writeJsonEnvelope(envelope);
      }
      return;
    }

    if (!envelope) {
      process.stdout.write("\n");
    }
  }

  if (options.doctor) {
    const report = await client.doctor();
    const rendered = renderDoctorReport(report);
    if (envelope) {
      envelope.steps.push(
        createJsonStep("doctor", {
          report,
          rendered
        })
      );
    } else {
      process.stdout.write(rendered);
    }

    if (!options.printPrompt) {
      if (envelope) {
        writeJsonEnvelope(envelope);
      }
      return;
    }

    if (!envelope) {
      process.stdout.write("\n");
    }
  }

  if (options.printPrompt) {
    if (options.stream) {
      const events = await client.promptStream(options.printPrompt, {
        sessionId: options.sessionId,
        activate: true
      });

      for await (const event of events) {
        writeJsonEvent({
          ok: true,
          transport: "remote",
          cwd: options.cwd,
          remoteUrl: client.baseUrl,
          event
        });
      }
      return;
    }

    if (options.printPrompt.trim().startsWith("/")) {
      const result = await client.command(options.printPrompt);
      if (envelope) {
        envelope.steps.push(
          createJsonStep("command", {
            command: options.printPrompt,
            output: result.output || "",
            shouldContinue: result.shouldContinue !== false
          })
        );
        writeJsonEnvelope(envelope);
      } else if (result.output) {
        process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
      }
      return;
    }

    const result = await client.prompt(options.printPrompt, {
      sessionId: options.sessionId,
      activate: true
    });
    if (envelope) {
      envelope.steps.push(
        createJsonStep("prompt", {
          prompt: options.printPrompt,
          sessionId: result.sessionId || "",
          activeSessionId: result.activeSessionId || "",
          turns: result.turns || 0,
          output: result.output || ""
        })
      );
      writeJsonEnvelope(envelope);
    } else {
      process.stdout.write(`${result.output}\n`);
    }
    return;
  }

  if (envelope) {
    throw new Error(
      "--json remote mode requires --doctor, --onboard, --init, or -p/--print."
    );
  }

  throw new Error(
    "Remote mode currently supports --doctor, --onboard, --init, or -p/--print."
  );
}

function parseArgs(argv) {
  const options = {
    help: false,
    version: false,
    doctor: false,
    onboard: false,
    init: false,
    force: false,
    bridge: false,
    bridgeHost: "127.0.0.1",
    bridgePort: 8765,
    remoteUrl: "",
    json: false,
    stream: false,
    adapter: false,
    adapterOperation: "",
    adapterInput: "",
    provider: "auto",
    printPrompt: "",
    sessionId: "",
    agent: "",
    skills: [],
    taskWorker: false,
    taskId: "",
    cwd: process.cwd(),
    maxTurns: 6,
    permissionMode: "ask"
  };

  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }

    if (arg === "--doctor") {
      options.doctor = true;
      continue;
    }

    if (arg === "--onboard") {
      options.onboard = true;
      continue;
    }

    if (arg === "--init") {
      options.init = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "-p" || arg === "--print") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} expects a prompt string`);
      }
      options.printPrompt = value;
      index += 1;
      continue;
    }

    if (arg === "--provider") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--provider expects a value");
      }
      options.provider = value;
      index += 1;
      continue;
    }

    if (arg === "--bridge") {
      options.bridge = true;
      continue;
    }

    if (arg === "--bridge-host") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--bridge-host expects a value");
      }
      options.bridgeHost = value;
      index += 1;
      continue;
    }

    if (arg === "--bridge-port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--bridge-port expects a positive integer");
      }
      options.bridgePort = value;
      index += 1;
      continue;
    }

    if (arg === "--remote-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--remote-url expects a value");
      }
      options.remoteUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stream") {
      options.stream = true;
      continue;
    }

    if (arg === "--input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--input expects a value");
      }
      options.adapterInput = value;
      index += 1;
      continue;
    }

    if (arg === "--session") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--session expects a value");
      }
      options.sessionId = value;
      index += 1;
      continue;
    }

    if (arg === "--agent") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--agent expects a value");
      }
      options.agent = value;
      index += 1;
      continue;
    }

    if (arg === "--skill" || arg === "--skills") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} expects a value`);
      }
      options.skills.push(
        ...value
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      );
      index += 1;
      continue;
    }

    if (arg === "--task-worker") {
      options.taskWorker = true;
      continue;
    }

    if (arg === "--task-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--task-id expects a value");
      }
      options.taskId = value;
      index += 1;
      continue;
    }

    if (arg === "--cwd") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cwd expects a path");
      }
      options.cwd = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--max-turns") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--max-turns expects a positive integer");
      }
      options.maxTurns = value;
      index += 1;
      continue;
    }

    if (arg === "--permission-mode") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--permission-mode expects a value");
      }
      options.permissionMode = value;
      index += 1;
      continue;
    }

    if (arg === "--yolo") {
      options.permissionMode = "yolo";
      continue;
    }

    positional.push(arg);
  }

  if (positional[0] === "adapter") {
    options.adapter = true;
    options.adapterOperation = positional[1] || "";
    if (!options.adapterInput && positional.length > 2) {
      options.adapterInput = positional.slice(2).join(" ");
    }
    return options;
  }

  if (!options.printPrompt && positional.length > 0) {
    options.printPrompt = positional.join(" ");
  }

  return options;
}

function maybeCreateEnvelope(options) {
  if (!options.json) {
    return null;
  }

  return createJsonEnvelope({
    transport: "local",
    cwd: options.cwd,
    remoteUrl: null
  });
}

function emitRenderedOrCollect(envelope, operation, rendered, payload = {}) {
  if (envelope) {
    envelope.steps.push(
      createJsonStep(operation, {
        ...payload,
        rendered
      })
    );
    return;
  }

  if (rendered) {
    process.stdout.write(rendered);
  }
}

async function printHelp() {
  const metadata = await getPackageMetadata();

  process.stdout.write(`Water Code v${metadata.version}

Usage:
  water-code
  water-code -p "your prompt"
  water-code --provider planner -p "list files in src"
  water-code -p "/commands"
  water-code --skill repo-cartographer -p "/skill"
  water-code --init
  water-code --init --force
  water-code --onboard
  water-code --doctor
  water-code --bridge --bridge-port 8765
  water-code --remote-url http://127.0.0.1:8765 --doctor
  water-code --json --doctor
  water-code --json --stream -p "read README.md"
  water-code adapter state
  water-code adapter project --input ../other-project
  water-code adapter prompt --input "read README.md"
  water-code adapter prompt --stream --input "read README.md"
  water-code adapter command --input "/plugins"

Options:
  -h, --help            Show help
  -v, --version         Show version
  --init                Create starter Water Code project files
  --force               Allow --init to overwrite starter files
  --onboard             Show recommended next steps for this project
  --doctor              Run a local environment and project self-check
  --bridge              Start the local HTTP bridge server
  --bridge-host <host>  Host for the bridge server
  --bridge-port <port>  Port for the bridge server
  --remote-url <url>    Use an existing Water Code bridge for one-shot requests
  --json                Emit machine-readable JSON for one-shot operations
  --stream              Emit line-delimited JSON prompt events for adapter use
  --input <text>        Input for adapter prompt/command operations
  -p, --print           Run one prompt and exit
  --provider <name>     auto | planner | mock | anthropic
  --session <id>        Reuse an existing session id
  --agent <name>        Activate a project custom agent by name
  --skill <name>        Activate one or more project skills
  --cwd <path>          Project root to operate in
  --max-turns <n>       Max tool / response turns per request
  --permission-mode <m> ask | accept-edits | read-only | yolo
  --yolo                Alias for --permission-mode yolo

Environment:
  ANTHROPIC_API_KEY
  WATER_CODE_ANTHROPIC_MODEL
`);
}
