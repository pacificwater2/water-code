# Water Code

Water Code is a clean-room terminal coding agent project built from architecture research on Claude Code, but intentionally re-designed as a simpler, zero-dependency Node MVP.

Detailed Chinese usage guide:

- `docs/user-manual-zh.md`
- `docs/github-publish-guide.md`
- `docs/github-release-v0.1.0.md`

The first version focuses on the core loop:

- CLI entrypoint
- interactive REPL
- session persistence
- agent loop
- tool registry
- pluggable providers
- explicit permission handling for dangerous tools

This repo does **not** try to clone every advanced subsystem on day one. It starts with a practical minimal core that can grow into a larger product.

## Why this exists

The research showed that the most durable Claude Code idea is not any single hidden feature. It is the product skeleton:

`main -> commands/tools -> REPL -> query loop -> state/extensions`

Water Code uses that skeleton as inspiration while keeping the first implementation much smaller and easier to evolve.

## MVP scope

Current MVP includes:

- one-shot or interactive CLI
- first-class slash commands
- project context loading
- git-aware project state and worktree awareness
- formal JSON tool-calling protocol
- diff preview and exact patch editing
- structured tool result rendering
- richer permission modes
- approval history and remembered approvals for dangerous tools
- project custom commands
- project custom agents
- project skills
- project plugins
- project-level `WATER.md` instructions
- local MCP server loading
- sequential multi-agent orchestration
- background tasks
- local HTTP bridge surface
- bridge request timeouts and stream heartbeats
- provider abstraction
- planner provider for local testing
- optional Anthropic-backed provider via environment variables
- tools:
  - `list_files`
  - `read_file`
  - `git_status`
  - `git_worktrees`
  - `preview_diff`
  - `patch_file`
  - `write_file`
  - `list_background_tasks`
  - `get_background_task`
  - `start_background_task`
  - `cancel_background_task`
  - `bash`
- session storage in `.water-code/sessions`

## Quick start

```bash
cd water-code
npm start
```

Install / package options:

```bash
npm link
water-code --version
water-code --init
water-code --onboard
water-code --doctor
water-code --json --doctor
water-code --json --stream -p "read README.md"
water-code adapter state
water-code adapter project --input ../other-project
water-code adapter prompt --input "read README.md"

npm run package
npm install -g ./dist/water-code-0.1.0.tgz
npm run real-world-smoke
npm run release-check
npm run ship-check
```

If you want to verify the packaged tarball really installs and runs:

```bash
npm run package-smoke
```

To bootstrap Water Code into a project:

```bash
water-code --cwd /path/to/project --init
water-code --cwd /path/to/project --init --force
water-code --cwd /path/to/project --onboard
```

One-shot examples:

```bash
node ./bin/water-code.js --provider planner -p "list files in src"
node ./bin/water-code.js --provider planner -p "git status"
node ./bin/water-code.js --provider planner -p "read README.md"
node ./bin/water-code.js --permission-mode accept-edits -p "/patch README.md ::: old >>> new"
node ./bin/water-code.js --yolo --provider planner -p "run pwd"
node ./bin/water-code.js --bridge --provider planner --bridge-port 8765
node ./bin/water-code.js --remote-url http://127.0.0.1:8765 --doctor
node ./bin/water-code.js --json --provider planner -p "read README.md"
node ./bin/water-code.js --json --stream --provider planner -p "read README.md"
node ./bin/water-code.js adapter state
node ./bin/water-code.js adapter prompt --provider planner --stream --input "read README.md"
```

Interactive slash command examples:

```text
/help
/mcp
/mcp-call local_echo echo_note ::: {"note":"hi"}
/commands
/readme-snapshot
/plugins
/plugin-status
/skills
/skill repo-cartographer,safe-editor
/agents
/agent reviewer
/delegate reviewer ::: read README.md
/swarm reviewer,architect ::: read README.md
/tasks
/task-run "repo scan" ::: read README.md
/task-show wctask-...
/permissions
/approvals
/onboard
/doctor
/init
/sessions
/session new
/project
/project ../other-project
/worktree-use feature/review
/git
/worktrees
/context
/instructions
/ls src --depth 1
/read README.md --lines 60
/diff README.md ::: # Water Code\n\nA smaller terminal agent.
/patch README.md ::: Water Code >>> Water Code MVP
/run pwd
/write notes.txt ::: first draft
```

Use Anthropic if you have credentials:

```bash
export ANTHROPIC_API_KEY=...
export WATER_CODE_ANTHROPIC_MODEL=...
node ./bin/water-code.js --provider anthropic
```

The Anthropic provider now uses native Claude tool use instead of forcing the JSON protocol path, so the same Water Code tools are exposed as first-class Claude tools when credentials are present.

Smoke check:

```bash
npm test
npm run verify
npm run package
npm run package-smoke
npm run smoke
npm run bridge-smoke
npm run provider-smoke
npm run vscode-shim-smoke
```

`npm run verify` covers `npm test`, `npm run smoke`, `npm run provider-smoke`, and `npm run vscode-shim-smoke`. Add `-- --bridge` when you also want the localhost bridge smoke run.

The bridge now reports timeout metadata on `/health`, emits `stream.heartbeat` events during streamed prompts, and exposes explicit remote session recovery surfaces through `/sessions`.

For final release readiness:

- `npm run package-smoke`: validate install-from-tarball behavior
- `npm run real-world-smoke`: validate Water Code against a temporary Git repo and worktree workflow
- `npm run release-check`: validate release docs, versioning, and packaged file contents
- `npm run ship-check`: run the recommended release gate end-to-end

## Repo layout

- `docs/water-code-blueprint.md`: product blueprint and architecture roadmap
- `docs/release-playbook.md`: release checklist and shipping guidance
- `docs/github-publish-guide.md`: step-by-step GitHub publishing guide
- `docs/github-release-v0.1.0.md`: GitHub Release notes template for v0.1.0
- `docs/user-manual-zh.md`: detailed Chinese user manual
- `CHANGELOG.md`: shipped release notes
- `LICENSE`: MIT license for source distribution
- `.water-code/commands/`: project custom command templates
- `.water-code/agents/`: project custom agent templates
- `.water-code/skills/`: project skill templates
- `.water-code/plugins/`: project plugin modules
- `WATER.md`: optional project-level instructions loaded into the system prompt
- `.water-code/tasks/`: background task metadata and logs
- `.water-code/mcp.json`: project MCP server config
- `src/cli/`: argument parsing and REPL
- `src/commands/`: slash command layer
- `src/core/`: agent loop and runtime assembly
- `src/core/git-state.js`: Git branch, dirty state, and worktree inspection
- `src/bridge/`: local HTTP bridge server
- `editor/vscode-water-code/`: minimal VS Code shim built on the adapter contract
- `src/plugins/`: project plugin loading and prompt rendering
- `src/skills/`: project skill loading and prompt rendering
- `src/tasks/`: background task store and worker
- `src/provider/`: provider adapters
- `src/tools/`: local tool implementations
- `src/session/`: session persistence
- `scripts/smoke.js`: local regression smoke checks
- `scripts/bridge-smoke.js`: bridge regression smoke checks
- `scripts/verify.js`: combined verification entrypoint
- `scripts/package.js`: create an installable tarball in `dist/`
- `scripts/package-smoke.js`: install the tarball into a temp prefix and verify the CLI starts
- `scripts/real-world-smoke.js`: validate Water Code against a temporary Git-backed project
- `scripts/release-check.js`: validate release metadata, docs, and tarball contents
- `scripts/ship-check.js`: run the full release-readiness gate

Tool results are now normalized into `title + summary + sections` before rendering, so direct commands and model-driven tool loops share the same terminal presentation.

## VS Code shim

Water Code now includes a minimal VS Code integration shim in [editor/vscode-water-code](/Users/waterzhou/Codex%20%20projects/Claude%20Code/water-code/editor/vscode-water-code).

It intentionally stays thin:

- VS Code commands shell out to `water-code adapter ...`
- streamed prompts use the adapter's line-delimited JSON event mode
- local or remote runtimes are chosen by normal Water Code settings, not a separate editor-only protocol

The shim exposes these commands:

- `Water Code` explorer panel with project, git, session, extension, and runtime state
- `Water Code: Refresh Panel`
- `Water Code: Project State`
- `Water Code: Doctor`
- `Water Code: Onboard`
- `Water Code: Rewrite Selection`
- `Water Code: Resume Session`
- `Water Code: New Session`
- `Water Code: Clear Session`
- `Water Code: Prompt Selection`
- `Water Code: Prompt Input`
- `Water Code: Open Output`

## Safer editing flow

For content changes, the safer path is now:

1. `/read` to inspect the file
2. `/diff` to preview a full replacement
3. `/patch` for an exact snippet replacement
4. `/write` only when you truly want a direct overwrite

## Permission modes

- `ask`: prompt before dangerous tools when interactive; deny them in one-shot mode
- `accept-edits`: auto-allow edit tools like `write_file` and `patch_file`, but still gate shell commands
- `read-only`: block all dangerous tools
- `yolo`: allow all dangerous tools without confirmation

Use `/permissions` in the REPL to inspect or change the current mode, or start directly with `--permission-mode`.

## Custom commands

Water Code now loads project command templates from `.water-code/commands/`.

Commands are loaded from the active project root, so `cd water-code` first or pass `--cwd water-code` if you launch from a parent directory.

- each `.md` or `.txt` file becomes a slash command named after the filename
- optional frontmatter keys:
  - `description`
  - `argumentHint`
- template placeholders:
  - `{{args}}`
  - `{{cwd}}`
  - `{{project_summary}}`
  - `{{permission_mode}}`

Built-ins:

- `/commands`: list loaded custom commands
- `/refresh-commands`: reload them from disk

Example:

```md
---
description: Review the current project with an optional focus.
argumentHint: [focus]
---
Summarize this repository for an engineer joining the project.
Project context:
{{project_summary}}

Extra focus:
{{args}}
```

That file saved as `.water-code/commands/project-brief.md` becomes `/project-brief`.

## Custom agents

Water Code also loads reusable project personas from `.water-code/agents/`.

- each `.md` or `.txt` file becomes an agent named after the filename
- the file body is injected into the system prompt when that agent is active
- placeholders supported in agent files:
  - `{{cwd}}`
  - `{{project_summary}}`
  - `{{permission_mode}}`

Built-ins:

- `/agents`: list loaded agents
- `/agent [name|none]`: show or switch the active agent
- `/refresh-agents`: reload them from disk

You can also start directly with `--agent reviewer`.

## Skills

Water Code now loads project skills from `.water-code/skills/`.

- skills are reusable instruction blocks that can be activated together
- active skills are injected into the system prompt alongside the current agent
- each `.md` or `.txt` file becomes a skill named after the filename
- optional frontmatter keys:
  - `description`
  - `whenToUse`
- placeholders supported in skill files:
  - `{{cwd}}`
  - `{{project_summary}}`
  - `{{permission_mode}}`
  - `{{active_agent}}`
  - `{{active_skills}}`

Built-ins:

- `/skills`: list loaded skills
- `/skill [name[,name2,...]|none]`: show or switch the active skill set
- `/refresh-skills`: reload them from disk

CLI:

```bash
node ./bin/water-code.js --skill repo-cartographer --skill safe-editor
```

## Project instructions

Water Code now loads `WATER.md` from the project root, or `.water-code/WATER.md` as a fallback.

- project instructions are injected into the system prompt before tool use
- `/instructions` shows the currently loaded file
- `/refresh-instructions` reloads it from disk
- `WATER.md` is also surfaced through the bridge state payload

## Plugins

Water Code now loads project plugins from `.water-code/plugins/`.

- plugins are JavaScript modules that can extend Water Code with commands, tools, and prompt blocks
- loaded plugins are active immediately for the current project root
- plugin commands appear in `/help` alongside built-ins and custom commands
- plugin tools are bridged into the normal tool registry

Built-ins:

- `/plugins`: list loaded plugins
- `/refresh-plugins`: reload them from disk

The repo includes a working sample in [workspace-tools.js](/Users/waterzhou/Codex%20%20projects/Claude%20Code/water-code/.water-code/plugins/workspace-tools.js).

## Background tasks

Water Code can now run prompts and slash commands as detached background jobs.

- tasks are stored under `.water-code/tasks/`
- each task keeps JSON metadata plus stdout and stderr logs
- tasks run through the normal Water Code runtime, so they still use the selected provider, agent, skills, permissions, tools, plugins, and MCP setup
- task control is available both through slash commands and through model-driven tool calls

Built-ins:

- `/tasks`: list recent tasks
- `/task-run [label] [--agent name] [--skills a,b] ::: <prompt>`: start a detached task
- `/task-show <id> [--lines N]`: inspect one task and tail its logs
- `/task-cancel <id>`: stop a running task

Planner examples:

```bash
node ./bin/water-code.js --provider planner -p "list background tasks"
node ./bin/water-code.js --provider planner --yolo -p "start background task ::: read README.md"
node ./bin/water-code.js --provider planner -p "show background task wctask-..."
```

## Multi-agent orchestration

Water Code can now run prompts through multiple custom agents without changing the main active agent.

- `/delegate <agent> ::: <prompt>` runs one isolated delegated turn
- `/swarm <agent1,agent2,...> ::: <prompt>` runs the same prompt through multiple agents in sequence and collects their outputs
- each delegated run gets its own session id, which is included in the output

This is intentionally a small sequential orchestration layer, but it already supports real reviewer/architect style workflows.

## MCP

Water Code now loads local stdio MCP servers from `.water-code/mcp.json`.

- the active project root decides which MCP config is loaded
- config is project-scoped, just like custom commands and agents
- discovered MCP tools are bridged into the normal Water Code tool registry
- built-ins:
  - `/mcp`: list configured servers and discovered tools
  - `/refresh-mcp`: reconnect servers and reload tools
  - `/mcp-call <server> <tool> ::: <json>`: call a discovered MCP tool directly

The repo includes a working sample in [example-mcp-server.js](/Users/waterzhou/Codex%20%20projects/Claude%20Code/water-code/scripts/example-mcp-server.js) and config in [.water-code/mcp.json](/Users/waterzhou/Codex%20%20projects/Claude%20Code/water-code/.water-code/mcp.json).

## Bridge

Water Code now exposes a small local HTTP bridge for remote control and editor integration.

- start it with `node ./bin/water-code.js --bridge`
- it binds to `127.0.0.1` by default
- use `--bridge-host` and `--bridge-port` to change the listen address
- the bridge shares the same runtime, tools, MCP connections, custom commands, custom agents, skills, plugins, and background task state as the terminal session

Current endpoints:

- `GET /health`: simple liveness check
- `GET /state`: runtime snapshot including tools, agents, skills, plugins, commands, background tasks, and MCP servers
- `GET /project`: concise project snapshot with cwd, git, and instruction preview
- `GET /doctor`: structured self-check report for the active runtime and project
- `GET /git`: current Git branch, dirty state, and sync summary
- `GET /worktrees`: known Git worktrees for the current repository
- `GET /onboard`: recommended next steps for the current project and runtime state
- `GET /sessions`: list saved sessions with recent summaries
- `POST /sessions`: create a new active session, switch the active session, or clear it
- `GET /sessions/:id`: inspect one saved session and return a tail of its transcript
- `POST /init`: create Water Code starter files in the active project root
- `POST /project`: switch the active project root by `cwd/path`, or by `worktree`
- `POST /prompt`: run a normal user prompt through the agent loop
- `POST /prompt/stream`: stream prompt lifecycle events over SSE
- `POST /command`: execute a slash command
- `POST /tool`: call a tool directly

Remote client notes:

- `water-code --remote-url http://127.0.0.1:8765 --doctor` runs the same report through an existing bridge
- `water-code --remote-url http://127.0.0.1:8765 --onboard` prints project onboarding from the remote runtime
- `water-code --remote-url http://127.0.0.1:8765 --init` triggers scaffold creation remotely
- `water-code --remote-url http://127.0.0.1:8765 -p "/project"` shows the remote runtime's current project root
- `water-code --remote-url http://127.0.0.1:8765 -p "/plugins"` runs a slash command against the bridge
- `water-code --remote-url http://127.0.0.1:8765 -p "read README.md"` sends a normal prompt to the remote runtime
- add `--json` to any of those one-shot calls for a machine-readable envelope that editors can parse directly
- add `--stream` with `--json` and a normal prompt to receive line-delimited prompt events for adapter use

Adapter notes:

- `water-code adapter state` returns the current runtime snapshot as JSON
- `water-code adapter project --input ../other-project` switches the active runtime project and returns the new state
- `water-code adapter doctor` returns the doctor report as JSON
- `water-code adapter onboard` returns onboarding guidance as JSON
- `water-code adapter init --force` runs scaffold creation and returns the report as JSON
- `water-code adapter prompt --input "read README.md"` runs one prompt and returns a single JSON envelope
- `water-code adapter prompt --stream --input "read README.md"` emits line-delimited JSON events for editor integrations
- add `--remote-url http://127.0.0.1:8765` to point the same adapter contract at an existing bridge runtime

Bridge session notes:

- `POST /prompt` accepts an optional `sessionId`
- set `"activate": false` to run against that session without changing the bridge runtime's current active session
- bridge state now includes `recentSessions` and `git` so an editor or client can resume prior conversations with repository context

Example:

```bash
node ./bin/water-code.js --bridge --provider planner --bridge-port 8765
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/doctor
curl http://127.0.0.1:8765/onboard
curl http://127.0.0.1:8765/state
curl http://127.0.0.1:8765/project
curl http://127.0.0.1:8765/sessions
curl -X POST http://127.0.0.1:8765/project -H 'content-type: application/json' -d '{"cwd":"."}'
curl -X POST http://127.0.0.1:8765/prompt/stream -H 'content-type: application/json' -d '{"prompt":"read README.md"}'
curl -X POST http://127.0.0.1:8765/sessions -H 'content-type: application/json' -d '{"create":true}'
curl -X POST http://127.0.0.1:8765/command \
  -H 'content-type: application/json' \
  -d '{"command":"/commands"}'
```

## Design stance

- zero external runtime dependencies for the first working version
- honest permission model
- explicit provider boundary
- small tool surface first
- architecture that can later support commands, extensions, and agents
- a project context snapshot available to both runtime and slash commands

## Doctor

Water Code now includes a built-in self-check surface:

- `water-code --doctor`: run a one-shot environment and project diagnostic
- `/doctor`: inspect the current runtime from inside REPL or one-shot slash mode
- `GET /doctor`: retrieve the same report over the bridge

The report currently checks:

- Node version against the package engine
- project-root read/write access
- `.water-code` state-dir readiness
- provider readiness
- extension and MCP loading
- recent session visibility
- whether `WATER.md` instructions are present

## Onboarding

Water Code now includes a built-in onboarding surface:

- `water-code --onboard`: print recommended first steps for the current project
- `/onboard`: show the same guidance from REPL or one-shot slash mode
- `GET /onboard`: retrieve onboarding guidance over the bridge

The onboarding report currently highlights:

- whether the project is already initialized for Water Code
- whether README context is available
- whether recent sessions can be resumed
- which next command is most useful right now

## Init

Water Code now includes a starter scaffold flow:

- `water-code --init`: create starter Water Code files in the current project
- `water-code --init --force`: overwrite the starter files Water Code manages
- `/init`: run the same scaffold flow from inside the REPL or one-shot slash mode
- `POST /init`: trigger scaffold creation over the bridge

The scaffold currently creates:

- `WATER.md`
- `.water-code/commands/readme-snapshot.md`
- `.water-code/agents/reviewer.md`
- `.water-code/skills/repo-cartographer.md`
- `.water-code/plugins/workspace-tools.js`
- `.water-code/mcp.json`
