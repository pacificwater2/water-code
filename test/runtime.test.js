import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRuntime } from "../src/core/runtime.js";

async function createTempProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "water-code-runtime-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function seedProject(
  root,
  {
    name = "runtime-fixture",
    readmeTitle = "Demo Project",
    readmeBody = "A small fixture repo for runtime tests.",
    withExtensions = true
  } = {}
) {
  await mkdir(path.join(root, ".git"), { recursive: true });

  if (withExtensions) {
    await mkdir(path.join(root, ".water-code", "commands"), { recursive: true });
    await mkdir(path.join(root, ".water-code", "agents"), { recursive: true });
    await mkdir(path.join(root, ".water-code", "skills"), { recursive: true });
    await mkdir(path.join(root, ".water-code", "plugins"), { recursive: true });
  }

  await writeFile(
    path.join(root, "README.md"),
    `# ${readmeTitle}\n\n${readmeBody}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "WATER.md"),
    [
      "# Water Instructions",
      "",
      "- Prefer reviewable patches.",
      "- Read before editing."
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name,
        type: "module",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  if (withExtensions) {
    await writeFile(
      path.join(root, ".water-code", "commands", "readme-snapshot.md"),
      [
        "---",
        "description: Snapshot the project readme",
        "argumentHint: [focus]",
        "---",
        "Read the repository README and summarize it.",
        "",
        "Focus:",
        "{{args}}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(root, ".water-code", "agents", "reviewer.md"),
      [
        "---",
        "description: Review code changes carefully",
        "---",
        "Review the project with extra care for regressions in {{cwd}}."
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(root, ".water-code", "skills", "repo-cartographer.md"),
      [
        "---",
        "description: Map the project before editing",
        "whenToUse: When the task needs architectural orientation first",
        "---",
        "Before changing code, map the repository using {{project_summary}}."
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(root, ".water-code", "plugins", "workspace-tools.js"),
      [
        "export default {",
        "  name: \"workspace-tools\",",
        "  description: \"Adds workspace-specific helpers\",",
        "  prompt: \"Plugin loaded for {{cwd}}\",",
        "  commands: [",
        "    {",
        "      name: \"plugin-status\",",
        "      description: \"Show plugin status\",",
        "      async execute() {",
        "        return { output: \"plugin ready\\n\" };",
        "      }",
        "    }",
        "  ],",
        "  tools: [",
        "    {",
        "      name: \"plugin_extension_summary\",",
        "      description: \"Summarize plugin state\",",
        "      inputHint: \"{}\",",
        "      inputSchema: {",
        "        type: \"object\",",
        "        additionalProperties: false",
        "      },",
        "      async execute(input, context) {",
        "        return {",
        "          ok: true,",
        "          title: \"Plugin extension summary\",",
        "          summary: `Plugin active in ${context.cwd}`",
        "        };",
        "      }",
        "    }",
        "  ]",
        "};"
      ].join("\n"),
      "utf8"
    );
  }
}

test("createRuntime loads project extensions and plugin tools", async t => {
  const root = await createTempProject(t);
  await seedProject(root);

  const runtime = await createRuntime({
    cwd: root,
    provider: "planner",
    permissionMode: "accept-edits",
    maxTurns: 4,
    agent: "reviewer",
    skills: ["repo-cartographer"]
  });

  t.after(async () => {
    await runtime.close();
  });

  assert.equal(runtime.providerName, "planner");
  assert.equal(runtime.getActiveAgent()?.name, "reviewer");
  assert.deepEqual(runtime.getActiveSkills().map(skill => skill.name), ["repo-cartographer"]);
  assert.equal(runtime.getCustomCommands()[0]?.name, "readme-snapshot");
  assert.equal(runtime.getProjectPlugins()[0]?.name, "workspace-tools");
  assert.equal(runtime.getPluginCommands()[0]?.name, "plugin-status");
  assert.match(runtime.getProjectContext().summary, /README preview:/);
  assert.match(runtime.getProjectContext().summary, /package\.json: name=runtime-fixture/);
  assert.equal(runtime.getProjectInstructions()?.sourcePath, path.join(root, "WATER.md"));
  assert.match(runtime.getProjectInstructions()?.content || "", /Prefer reviewable patches/);
  assert.equal(runtime.getGitState().detected, true);
  assert.ok(
    runtime.describeTools().some(tool => tool.name === "plugin_extension_summary"),
    "plugin tool should be registered in runtime tool registry"
  );

  const pluginToolResult = await runtime.runTool("plugin_extension_summary", {});
  assert.equal(pluginToolResult.ok, true);
  assert.match(pluginToolResult.rendered, /Plugin active in/);
});

test("runtime refresh methods reload custom commands and clear missing active skills", async t => {
  const root = await createTempProject(t);
  await seedProject(root);

  const runtime = await createRuntime({
    cwd: root,
    provider: "planner",
    permissionMode: "ask",
    maxTurns: 4,
    skills: ["repo-cartographer"]
  });

  t.after(async () => {
    await runtime.close();
  });

  await writeFile(
    path.join(root, ".water-code", "commands", "repo-brief.md"),
    [
      "---",
      "description: Produce a repo brief",
      "---",
      "Summarize the repository at {{cwd}}."
    ].join("\n"),
    "utf8"
  );

  const refreshedCommands = await runtime.refreshCustomCommands();
  assert.deepEqual(
    refreshedCommands.map(command => command.name),
    ["readme-snapshot", "repo-brief"]
  );

  await rm(path.join(root, ".water-code", "skills", "repo-cartographer.md"));
  const refreshedSkills = await runtime.refreshProjectSkills();
  assert.deepEqual(refreshedSkills, []);
  assert.deepEqual(runtime.getActiveSkills(), []);

  await rm(path.join(root, "WATER.md"));
  const refreshedInstructions = await runtime.refreshProjectInstructions();
  assert.equal(refreshedInstructions, null);
  assert.equal(runtime.getProjectInstructions(), null);

  const packageJsonPath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.scripts.verify = "node ./scripts/verify.js";
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

  const refreshedContext = await runtime.refreshProjectContext();
  assert.match(refreshedContext.summary, /scripts=test,verify/);
  assert.match(refreshedContext.summary, /Key files: package\.json, README\.md/);
});

test("runtime can list, create, switch, and inspect sessions", async t => {
  const root = await createTempProject(t);
  await seedProject(root);

  const runtime = await createRuntime({
    cwd: root,
    provider: "mock",
    permissionMode: "ask",
    maxTurns: 2
  });

  t.after(async () => {
    await runtime.close();
  });

  const first = await runtime.runPrompt("hello from session one");
  assert.match(first.sessionId, /^wc-/);
  assert.equal(runtime.sessionId, first.sessionId);

  const firstSession = await runtime.getSession(first.sessionId, {
    messages: 10
  });
  assert.equal(firstSession.messages.length, 2);
  assert.equal(firstSession.messages[0].role, "user");

  const listed = await runtime.listSessions(10);
  assert.equal(listed[0].id, first.sessionId);
  assert.equal(listed[0].messageCount, 2);

  const created = await runtime.createSession();
  assert.match(created.id, /^wc-/);
  assert.notEqual(created.id, first.sessionId);
  assert.equal(runtime.sessionId, created.id);

  const isolated = await runtime.runPrompt("stay isolated", {
    sessionId: first.sessionId,
    updateCurrentSession: false
  });
  assert.equal(isolated.sessionId, first.sessionId);
  assert.equal(runtime.sessionId, created.id);

  const switched = await runtime.setSession(first.sessionId);
  assert.equal(switched.id, first.sessionId);
  assert.equal(runtime.sessionId, first.sessionId);
});

test("runtime scaffoldProject creates starter Water Code files and refreshes runtime state", async t => {
  const root = await createTempProject(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "scaffold-fixture",
      type: "module"
    }, null, 2),
    "utf8"
  );

  const runtime = await createRuntime({
    cwd: root,
    provider: "planner",
    permissionMode: "ask",
    maxTurns: 4
  });

  t.after(async () => {
    await runtime.close();
  });

  const report = await runtime.scaffoldProject();
  assert.ok(report.createdFiles.includes("WATER.md"));
  assert.ok(runtime.getProjectInstructions());
  assert.ok(runtime.getCustomCommands().some(command => command.name === "readme-snapshot"));
  assert.ok(runtime.getCustomAgents().some(agent => agent.name === "reviewer"));
  assert.ok(runtime.getProjectSkills().some(skill => skill.name === "repo-cartographer"));
  assert.ok(runtime.getProjectPlugins().some(plugin => plugin.name === "workspace-tools"));
  assert.ok(runtime.getMcpServers().length === 0);
});

test("runtime can switch project roots and clear unavailable project-specific state", async t => {
  const rootA = await createTempProject(t);
  const rootB = await createTempProject(t);
  await seedProject(rootA);
  await seedProject(rootB, {
    name: "runtime-fixture-alt",
    readmeTitle: "Alternate Project",
    readmeBody: "A second fixture repo for runtime switching tests.",
    withExtensions: false
  });

  const runtime = await createRuntime({
    cwd: rootA,
    provider: "mock",
    permissionMode: "ask",
    maxTurns: 2,
    agent: "reviewer",
    skills: ["repo-cartographer"]
  });

  t.after(async () => {
    await runtime.close();
  });

  const promptResult = await runtime.runPrompt("hello before switching");
  assert.match(promptResult.sessionId, /^wc-/);

  const report = await runtime.switchProject(rootB);
  assert.equal(report.fromCwd, rootA);
  assert.equal(report.toCwd, rootB);
  assert.equal(report.previousSessionId, promptResult.sessionId);
  assert.equal(runtime.cwd, rootB);
  assert.equal(runtime.sessionId, "");
  assert.equal(runtime.getActiveAgent(), null);
  assert.deepEqual(runtime.getActiveSkills(), []);
  assert.deepEqual(runtime.getCustomCommands(), []);
  assert.deepEqual(runtime.getProjectPlugins(), []);
  assert.match(runtime.getProjectContext().summary, /runtime-fixture-alt/);
  assert.match(runtime.getProjectContext().summary, /Alternate Project/);
  assert.equal(runtime.getGitState().detected, true);
});

test("runtime runPrompt emits prompt lifecycle events", async t => {
  const root = await createTempProject(t);
  await seedProject(root);

  const runtime = await createRuntime({
    cwd: root,
    provider: "planner",
    permissionMode: "ask",
    maxTurns: 4
  });

  t.after(async () => {
    await runtime.close();
  });

  const events = [];
  const result = await runtime.runPrompt("read README.md", {
    onEvent(event) {
      events.push(event);
    }
  });

  assert.match(result.sessionId, /^wc-/);
  assert.deepEqual(
    events.map(event => event.type),
    ["session.started", "turn.started", "tool.call", "tool.result", "turn.started", "assistant.message", "completed"]
  );
  assert.equal(events.at(-1)?.sessionId, result.sessionId);
  assert.match(events.at(-1)?.output || "", /OK Read file README\.md/);
});
