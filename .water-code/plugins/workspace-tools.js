export default {
  name: "workspace-tools",
  description: "Adds plugin-driven workspace inspection helpers.",
  prompt: `
Use the workspace-tools plugin for project extension inventory and configuration introspection when that would help.
Current project snapshot:
{{project_summary}}
  `.trim(),
  commands: [
    {
      name: "plugin-status",
      description: "Show loaded plugins and the commands/tools they contribute",
      usage: "/plugin-status",
      async execute({ runtime }) {
        const plugins = runtime.getProjectPlugins();

        if (plugins.length === 0) {
          return {
            output: "No project plugins loaded.\n"
          };
        }

        const lines = [];

        for (const plugin of plugins) {
          const commands = (plugin.commands || []).map(command => `/${command.name}`).join(", ") || "(none)";
          const tools = (plugin.tools || []).map(tool => tool.name).join(", ") || "(none)";
          lines.push(`- ${plugin.name}: ${plugin.description}`);
          lines.push(`  commands: ${commands}`);
          lines.push(`  tools: ${tools}`);
        }

        return {
          output: `${lines.join("\n")}\n`
        };
      }
    }
  ],
  tools: [
    {
      name: "plugin_extension_summary",
      description: "Summarize loaded project extensions",
      inputHint: "{}",
      async execute(_input, context) {
        const runtime = context.runtime;
        const plugins = runtime?.getProjectPlugins?.() || [];
        const skills = runtime?.getProjectSkills?.() || [];
        const agents = runtime?.getCustomAgents?.() || [];
        const commands = runtime?.getCustomCommands?.() || [];

        return {
          ok: true,
          title: "Project extension summary",
          summary: "Summarized currently loaded project extension surfaces.",
          sections: [
            {
              label: "Plugins",
              body: plugins.map(plugin => plugin.name).join("\n") || "(none)"
            },
            {
              label: "Skills",
              body: skills.map(skill => skill.name).join("\n") || "(none)"
            },
            {
              label: "Agents",
              body: agents.map(agent => agent.name).join("\n") || "(none)"
            },
            {
              label: "Custom commands",
              body: commands.map(command => `/${command.name}`).join("\n") || "(none)"
            }
          ],
          data: {
            plugins: plugins.map(plugin => plugin.name),
            skills: skills.map(skill => skill.name),
            agents: agents.map(agent => agent.name),
            commands: commands.map(command => command.name)
          }
        };
      }
    }
  ]
};
