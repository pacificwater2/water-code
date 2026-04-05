import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const STARTER_FILES = {
  "WATER.md": `# Water Code Instructions

- Prefer reading and diff preview before patching or writing.
- Keep changes small, explicit, and easy to review.
- Reuse project commands, agents, skills, plugins, and MCP tools when they fit the task.
- Favor project-level workflows over one-off shell commands when both would work.
`,
  ".water-code/commands/readme-snapshot.md": `---
description: Read the project README through the agent loop.
argumentHint: [extra focus]
---
Read the repository README and summarize it for an engineer joining this project.

Project context:
{{project_summary}}

Extra focus:
{{args}}
`,
  ".water-code/agents/reviewer.md": `---
description: Review work with a bug-finding and regression-checking bias.
---
Act as a careful reviewer for this project.

- Look for behavioral regressions first.
- Prefer small, testable changes.
- Explain risks in plain language.
`,
  ".water-code/skills/repo-cartographer.md": `---
description: Use for unfamiliar repos that need quick architectural mapping.
whenToUse: When the task starts in an unfamiliar repository and you need orientation first.
---
Before proposing changes:

- identify the main entrypoint
- identify the runtime path
- identify the nearest tests
- summarize the smallest likely edit surface
`,
  ".water-code/plugins/workspace-tools.js": `export default {
  name: "workspace-tools",
  description: "Adds a simple workspace status command and summary tool.",
  commands: [
    {
      name: "plugin-status",
      description: "Show the example plugin status",
      async execute() {
        return {
          output: "workspace-tools plugin is active\\n"
        };
      }
    }
  ],
  tools: [
    {
      name: "plugin_extension_summary",
      description: "Summarize loaded workspace extensions",
      inputHint: "{}",
      inputSchema: {
        type: "object",
        additionalProperties: false
      },
      async execute(_input, context) {
        return {
          ok: true,
          title: "Plugin extension summary",
          summary: \`workspace-tools is active in \${context.cwd}\`
        };
      }
    }
  ]
};
`,
  ".water-code/mcp.json": `{
  "servers": {}
}
`
};

const STARTER_DIRECTORIES = [
  ".water-code",
  ".water-code/commands",
  ".water-code/agents",
  ".water-code/skills",
  ".water-code/plugins",
  ".water-code/sessions",
  ".water-code/tasks"
];

async function pathExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function scaffoldProject(cwd, { force = false } = {}) {
  const createdDirectories = [];
  const createdFiles = [];
  const overwrittenFiles = [];
  const skippedFiles = [];

  for (const relativePath of STARTER_DIRECTORIES) {
    const targetPath = path.join(cwd, relativePath);
    const existed = await pathExists(targetPath);
    await mkdir(targetPath, { recursive: true });
    if (!existed) {
      createdDirectories.push(relativePath);
    }
  }

  for (const [relativePath, content] of Object.entries(STARTER_FILES)) {
    const targetPath = path.join(cwd, relativePath);
    const existed = await pathExists(targetPath);

    if (existed && !force) {
      skippedFiles.push(relativePath);
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");

    if (existed) {
      overwrittenFiles.push(relativePath);
    } else {
      createdFiles.push(relativePath);
    }
  }

  return {
    cwd,
    force,
    createdDirectories,
    createdFiles,
    overwrittenFiles,
    skippedFiles
  };
}

export function renderScaffoldReport(report) {
  const lines = [
    `Initialized Water Code scaffolding in ${report.cwd}`,
    `Summary: directories=${report.createdDirectories.length} created=${report.createdFiles.length} overwritten=${report.overwrittenFiles.length} skipped=${report.skippedFiles.length}`
  ];

  if (report.createdDirectories.length > 0) {
    lines.push("", "Created directories:");
    for (const item of report.createdDirectories) {
      lines.push(`- ${item}`);
    }
  }

  if (report.createdFiles.length > 0) {
    lines.push("", "Created files:");
    for (const item of report.createdFiles) {
      lines.push(`- ${item}`);
    }
  }

  if (report.overwrittenFiles.length > 0) {
    lines.push("", "Overwritten files:");
    for (const item of report.overwrittenFiles) {
      lines.push(`- ${item}`);
    }
  }

  if (report.skippedFiles.length > 0) {
    lines.push("", "Skipped existing files:");
    for (const item of report.skippedFiles) {
      lines.push(`- ${item}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
