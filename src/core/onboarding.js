function hasReadme(runtime) {
  const keyFiles = runtime.getProjectContext()?.keyFiles || [];
  return keyFiles.includes("README.md") || keyFiles.includes("README");
}

function isProjectInitialized(runtime) {
  return (
    !!runtime.getProjectInstructions() ||
    runtime.getCustomCommands().length > 0 ||
    runtime.getCustomAgents().length > 0 ||
    runtime.getProjectSkills().length > 0 ||
    runtime.getProjectPlugins().length > 0 ||
    runtime.getMcpServers().length > 0
  );
}

function buildAction(command, reason) {
  return {
    command,
    reason
  };
}

export async function buildOnboardingReport(runtime) {
  const sessions = await runtime.listSessions(5);
  const initialized = isProjectInitialized(runtime);
  const readmePresent = hasReadme(runtime);
  const actions = [];

  if (!initialized) {
    actions.push(
      buildAction("water-code --init", "Scaffold starter Water Code files for this project.")
    );
  } else {
    actions.push(
      buildAction("/doctor", "Verify provider, state directory, and extension health.")
    );
  }

  actions.push(
    buildAction("/context", "Inspect Water Code's current project snapshot before editing.")
  );

  if (readmePresent) {
    actions.push(
      buildAction("/readme-snapshot", "Use the starter command to get a quick README-based project summary.")
    );
  } else {
    actions.push(
      buildAction("Create README.md", "A README improves project context and onboarding quality.")
    );
  }

  if (sessions.length > 0) {
    actions.push(
      buildAction("/sessions", "Resume a recent conversation instead of starting from scratch.")
    );
  } else {
    actions.push(
      buildAction("Ask your first prompt", "The first conversation will create a session automatically.")
    );
  }

  const headline = initialized
    ? sessions.length > 0
      ? "Project is Water Code-ready, and recent sessions are available."
      : "Project is Water Code-ready. Start with health/context, then open a first session."
    : "Project is not initialized for Water Code yet.";

  return {
    cwd: runtime.cwd,
    initialized,
    readmePresent,
    provider: runtime.providerName,
    activeSessionId: runtime.sessionId || "",
    recentSessionCount: sessions.length,
    headline,
    actions,
    shouldShowHint: !initialized || sessions.length === 0
  };
}

export function renderOnboardingReport(report) {
  const lines = [
    "Water Code Onboarding",
    `CWD: ${report.cwd}`,
    `Provider: ${report.provider}`,
    `Initialized: ${report.initialized ? "yes" : "no"}`,
    `README: ${report.readmePresent ? "yes" : "no"}`,
    `Recent sessions: ${report.recentSessionCount}`,
    "",
    report.headline
  ];

  if (report.actions.length > 0) {
    lines.push("", "Recommended next steps:");
    report.actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.command}`);
      lines.push(`   ${action.reason}`);
    });
  }

  return `${lines.join("\n")}\n`;
}
