# Water Code Blueprint

Water Code is a terminal-first coding agent product derived from architecture research, not from direct source reuse.

## Product goal

Build a personal coding agent that feels like a serious terminal engineering assistant:

- understands a repository
- can inspect files and run commands
- can iteratively use tools
- keeps session state
- can later grow into commands, skills, extensions, agents, and remote workflows

## Product philosophy

The MVP should preserve the strongest ideas while avoiding premature complexity.

Keep:

- clear entrypoint
- REPL shell
- agent loop
- tool registry
- session state
- extension seam

Delay:

- complex UI
- feature-gate explosion
- plugin marketplace

## Architecture

### Layer 1: CLI and shell

- parse arguments
- choose provider
- start REPL or one-shot mode
- route slash commands

### Layer 2: runtime assembly

- select provider
- create session store
- register tools
- load project context
- create agent loop

### Layer 3: agent loop

- accept user prompt
- ask provider for either:
  - final assistant response
  - tool call
- execute tool
- append tool result to session
- continue until final response or max turns

### Layer 4: tools

MVP tool surface:

- `list_files`
- `read_file`
- `preview_diff`
- `patch_file`
- `write_file`
- `list_background_tasks`
- `get_background_task`
- `start_background_task`
- `cancel_background_task`
- `bash`

### Layer 5: extension seam

The current architecture already supports:

- project context loading
- custom commands
- custom agents
- skills
- plugins
- background tasks
- MCP
- remote bridge surfaces

The same seam should later support:

- skills or command packs

## MVP interaction contract

Provider returns one of:

1. final assistant message
2. a single tool call with structured input

Water Code executes one tool at a time and loops.

This keeps the first core simple and debuggable.

The protocol should be explicit and versioned so providers and the runtime share one normalization path.

The current protocol shape is:

- `assistant`: `{ protocolVersion, type: "assistant", message }`
- `tool_call`: `{ protocolVersion, type: "tool_call", toolCall: { id, name, input, reason } }`

Planner-style local providers use this JSON protocol directly. Native API providers may translate between this internal protocol and provider-native tool-use blocks.

## Project context

Water Code should know a lightweight snapshot of the current repository before it starts reasoning.

The first version of the context loader should collect:

- repository root
- git presence
- language hints from manifest files
- key files such as `README.md`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`
- top-level directories and files
- a short README preview

This context should be:

- visible through `/context`
- refreshable through `/refresh-context`
- injected into the system prompt

## Safety stance

- dangerous tools are explicit
- permission modes decide how dangerous tools are handled
- patches use exact text replacement instead of hidden edits
- diff preview is available before applying a change
- tool calls are visible in transcript

The current permission modes are:

- `ask`: interactive approval for dangerous tools
- `accept-edits`: auto-allow edit tools, gate shell tools
- `read-only`: deny dangerous tools
- `yolo`: allow dangerous tools

## Result rendering

Tool implementations should return structured result objects rather than hand-built terminal strings.

The runtime should normalize each tool result into:

- `title`
- `summary`
- `sections`
- optional structured `data`

Then the terminal layer renders those results consistently for:

- direct slash commands
- planner-driven tool loops
- future provider-backed sessions

## Custom command model

Project-specific workflows should be loadable from disk without changing application code.

The current shape is:

- command templates live in `.water-code/commands/`
- the active project root decides which command directory is loaded
- filename becomes slash command name
- Markdown frontmatter may describe the command
- template placeholders inject args, cwd, project summary, and permission mode
- execution routes through the normal agent loop instead of bypassing providers

## Custom agent model

Project-specific personas should also be loadable from disk.

The current shape is:

- agent profiles live in `.water-code/agents/`
- filename becomes the agent name
- body text becomes an extra system-prompt block when active
- placeholders inject cwd, project summary, and permission mode
- runtime can switch the active agent without restarting the app

## Skill model

Project-specific skills should be loadable from disk as reusable instruction packs.

The current shape is:

- skill files live in `.water-code/skills/`
- multiple skills may be active at the same time
- filename becomes the skill name
- body text becomes an extra system-prompt block when active
- frontmatter may describe the skill and when to use it
- placeholders inject cwd, project summary, permission mode, active agent, and active skills
- runtime can switch the active skill set without restarting the app

## Plugin model

Project-specific plugins should be loadable from disk as executable extension modules.

The current shape is:

- plugin files live in `.water-code/plugins/`
- plugins are JavaScript modules loaded from the active project root
- a plugin may contribute commands, tools, and prompt blocks
- plugin commands appear in the normal slash command registry
- plugin tools appear in the normal tool registry
- plugin prompt blocks are injected into the system prompt automatically
- runtime can reload plugins without restarting the app

## Background task model

The current background task layer should stay intentionally small:

- tasks are persisted in `.water-code/tasks/`
- starting a task spawns a detached Water Code worker process
- each task stores structured metadata plus stdout and stderr logs
- task workers reuse the normal runtime instead of inventing a second execution engine
- tasks may run prompts or slash commands
- task operations are also exposed as normal tools for model-driven sessions
- runtime and bridge surfaces can list, inspect, and cancel tasks

## Multi-agent orchestration model

The current orchestration layer should stay intentionally small:

- delegated runs reuse the same provider and tool registry
- each delegated run gets an isolated session
- orchestration runs selected agents sequentially
- outputs are collected into a single rendered result
- active agent selection and delegated agent selection remain separate concepts

## MCP model

The current MCP layer should stay small but real:

- server config lives in `.water-code/mcp.json`
- runtime connects to stdio MCP servers during startup
- discovered tools are bridged into the main tool registry
- MCP tools can be listed and called directly from slash commands
- the same discovered tools are also available to model-driven sessions through the normal tool list

## Bridge model

The current bridge layer should stay intentionally small:

- bridge mode starts a local HTTP server against the active runtime
- default binding is localhost rather than a public interface
- bridge endpoints expose health, state, prompt, slash command, and direct tool surfaces
- remote calls reuse the same provider, permission mode, custom commands, custom agents, skills, plugins, background tasks, and MCP registry
- the bridge is a control surface, not a second runtime implementation

## Why this blueprint is practical

It is small enough to run now, but already shaped like a real agent product. It leaves room for later features without forcing the MVP to imitate the entire Claude Code surface.

## Verification stance

Keep a lightweight local regression path in the repo so the product can evolve without losing the CLI, context loader, planner flow, or structured tool protocol.
