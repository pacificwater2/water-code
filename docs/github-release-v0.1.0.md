# Water Code v0.1.0

## English

Water Code is a clean-room terminal coding agent inspired by Claude Code architecture research, but rebuilt as a smaller, explicit, zero-dependency Node product skeleton.

Highlights in `v0.1.0`:

- CLI, REPL, sessions, tools, providers, and JSON adapter contract
- project-aware context loading, Git/worktree awareness, and `WATER.md` instructions
- custom commands, agents, skills, plugins, MCP, and background tasks
- HTTP bridge server/client, streamed prompt events, and remote session management
- VS Code shim with project panel, session controls, and selection rewrite preview
- approval history, remembered dangerous-tool approvals, and richer permission modes
- package/install smoke coverage plus release and real-world workflow validation

Install from the release asset:

```bash
npm install -g ./water-code-0.1.0.tgz
water-code --version
water-code --doctor
```

Recommended next step:

```bash
water-code --cwd /path/to/project --onboard
```

## 中文

Water Code 是一个 clean-room 风格的终端 coding agent，参考了 Claude Code 的架构骨架，但用更小、更显式、零运行时依赖的 Node 方式重新实现。

`v0.1.0` 这一版的重点包括：

- CLI、REPL、session、tools、provider 和 JSON adapter 协议
- 项目上下文加载、Git/worktree 感知和 `WATER.md` 指令文件
- custom commands、agents、skills、plugins、MCP、background tasks
- HTTP bridge server/client、流式 prompt 事件、远程 session 管理
- 带项目面板、session 控制和 selection rewrite preview 的 VS Code shim
- 审批历史、remembered approvals 和更丰富的权限模式
- package/install smoke、release 检查和真实 Git 工作流验证

从 release 附件安装：

```bash
npm install -g ./water-code-0.1.0.tgz
water-code --version
water-code --doctor
```

建议安装后先运行：

```bash
water-code --cwd /path/to/project --onboard
```
