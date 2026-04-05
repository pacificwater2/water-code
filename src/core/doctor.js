import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { getPackageMetadata } from "../cli/meta.js";

function parseVersionParts(value) {
  return String(value || "")
    .replace(/^[^\d]*/, "")
    .split(".")
    .map(part => Number.parseInt(part, 10))
    .filter(Number.isFinite);
}

function compareVersions(left, right) {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function evaluateNodeVersion(range, actualVersion) {
  const match = String(range || "").match(/>=\s*([0-9]+(?:\.[0-9]+){0,2})/);
  if (!match) {
    return {
      status: "warn",
      summary: `Could not evaluate Node engine range ${range || "(missing)"}`
    };
  }

  const minimum = match[1];
  const actualParts = parseVersionParts(actualVersion);
  const minimumParts = parseVersionParts(minimum);

  if (compareVersions(actualParts, minimumParts) >= 0) {
    return {
      status: "ok",
      summary: `Node ${actualVersion} satisfies ${range}`
    };
  }

  return {
    status: "fail",
    summary: `Node ${actualVersion} does not satisfy ${range}`
  };
}

function createCheck(id, status, summary) {
  return {
    id,
    status,
    summary
  };
}

function renderCheck(check) {
  const label =
    check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "ERROR";

  return `[${label}] ${check.id}: ${check.summary}`;
}

function summarizeProvider(runtime) {
  if (runtime.providerName === "planner") {
    return createCheck("provider", "ok", "Planner provider ready for local tool-loop testing.");
  }

  if (runtime.providerName === "mock") {
    return createCheck(
      "provider",
      "warn",
      "Mock provider is active; useful for diagnostics, not real coding assistance."
    );
  }

  if (runtime.providerName === "anthropic") {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const hasModel = !!process.env.WATER_CODE_ANTHROPIC_MODEL;

    if (hasKey && hasModel) {
      return createCheck(
        "provider",
        "ok",
        `Anthropic provider configured with model ${process.env.WATER_CODE_ANTHROPIC_MODEL}.`
      );
    }

    return createCheck(
      "provider",
      "fail",
      "Anthropic provider selected but ANTHROPIC_API_KEY or WATER_CODE_ANTHROPIC_MODEL is missing."
    );
  }

  return createCheck("provider", "warn", `Unknown provider ${runtime.providerName}.`);
}

function summarizeExtensions(runtime) {
  const commands = runtime.getCustomCommands().length;
  const agents = runtime.getCustomAgents().length;
  const skills = runtime.getProjectSkills().length;
  const plugins = runtime.getProjectPlugins().length;
  const mcpServers = runtime.getMcpServers().length;
  const instructions = runtime.getProjectInstructions() ? "yes" : "no";

  return createCheck(
    "extensions",
    "ok",
    `commands=${commands} agents=${agents} skills=${skills} plugins=${plugins} mcp=${mcpServers} instructions=${instructions}`
  );
}

function summarizeMcp(runtime) {
  const servers = runtime.getMcpServers();

  if (servers.length === 0) {
    return createCheck("mcp", "ok", "No MCP servers configured.");
  }

  const unhealthy = servers.filter(server => server.status === "error");
  if (unhealthy.length > 0) {
    return createCheck(
      "mcp",
      "warn",
      `Some MCP servers failed: ${unhealthy.map(server => server.name).join(", ")}`
    );
  }

  return createCheck(
    "mcp",
    "ok",
    `All ${servers.length} MCP server${servers.length === 1 ? "" : "s"} connected.`
  );
}

function summarizeGit(runtime) {
  const git = runtime.getGitState?.();

  if (!git?.detected) {
    return createCheck("git", "warn", "No Git repository detected for this project root.");
  }

  if (!git.available) {
    return createCheck("git", "warn", git.summary);
  }

  return createCheck("git", "ok", git.summary);
}

export async function buildDoctorReport(runtime) {
  const metadata = await getPackageMetadata();
  const checks = [];
  const stateDir = path.join(runtime.cwd, ".water-code");

  checks.push(
    createCheck("package", "ok", `Water Code v${metadata.version} in ${runtime.cwd}`)
  );

  checks.push(
    createCheck("permission-mode", "ok", `Current mode is ${runtime.permissionMode}.`)
  );

  checks.push(
    createCheck(
      "active-session",
      "ok",
      runtime.sessionId
        ? `Active session is ${runtime.sessionId}.`
        : "No active session yet; a new one will be created on first prompt."
    )
  );

  checks.push((() => {
    const result = evaluateNodeVersion(metadata.engines?.node || "", process.version);
    return createCheck("node", result.status, result.summary);
  })());

  try {
    await access(runtime.cwd, constants.R_OK | constants.W_OK);
    checks.push(
      createCheck("project-root", "ok", "Project root is readable and writable.")
    );
  } catch (error) {
    checks.push(
      createCheck(
        "project-root",
        "fail",
        `Project root is not fully accessible: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  try {
    await mkdir(stateDir, { recursive: true });
    await access(stateDir, constants.R_OK | constants.W_OK);
    checks.push(
      createCheck("state-dir", "ok", `${stateDir} is ready for sessions and task metadata.`)
    );
  } catch (error) {
    checks.push(
      createCheck(
        "state-dir",
        "fail",
        `State directory is not writable: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  checks.push(summarizeProvider(runtime));
  checks.push(summarizeGit(runtime));
  checks.push(summarizeExtensions(runtime));
  checks.push(summarizeMcp(runtime));

  const sessions = await runtime.listSessions(5);
  checks.push(
    createCheck(
      "sessions",
      "ok",
      sessions.length > 0
        ? `Found ${sessions.length} recent session${sessions.length === 1 ? "" : "s"}.`
        : "No saved sessions yet."
    )
  );

  checks.push(
    runtime.getProjectInstructions()
      ? createCheck(
          "instructions",
          "ok",
          `Loaded project instructions from ${runtime.getProjectInstructions().sourcePath}.`
        )
      : createCheck(
          "instructions",
          "warn",
          "No WATER.md instructions loaded for this project."
        )
  );

  return {
    ok: checks.every(check => check.status !== "fail"),
    version: metadata.version,
    provider: runtime.providerName,
    cwd: runtime.cwd,
    permissionMode: runtime.permissionMode,
    checks
  };
}

export function renderDoctorReport(report) {
  const lines = [
    `Water Code Doctor v${report.version}`,
    `CWD: ${report.cwd}`,
    `Provider: ${report.provider}`,
    `Permission mode: ${report.permissionMode}`,
    `Overall: ${report.ok ? "OK" : "ERROR"}`
  ];

  for (const check of report.checks) {
    lines.push("", renderCheck(check));
  }

  return `${lines.join("\n")}\n`;
}
