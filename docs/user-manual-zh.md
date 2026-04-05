# Water Code 使用说明书

`Water Code` 是一个终端里的 coding agent，支持本地命令行、交互式 REPL、HTTP bridge、adapter 协议和最小 VS Code shim。

这份说明书面向“真正开始使用”的场景，不只是列参数，而是告诉你怎么安装、怎么进入项目、怎么安全修改代码、怎么切 session、怎么接 VS Code 和 bridge。

## 1. 安装方式

### 1.1 从源码目录直接运行

适合开发和调试：

```bash
cd /Users/waterzhou/Codex\ \ projects/Claude\ Code/water-code
npm start
```

### 1.2 本地全局安装

适合你自己长期使用：

```bash
cd /Users/waterzhou/Codex\ \ projects/Claude\ Code/water-code
npm link
water-code --version
```

### 1.3 从打包产物安装

当前打包产物在：

`/Users/waterzhou/Codex  projects/Claude Code/water-code/dist/water-code-0.1.0.tgz`

安装命令：

```bash
npm install -g /Users/waterzhou/Codex\ \ projects/Claude\ Code/water-code/dist/water-code-0.1.0.tgz
```

安装后建议先跑：

```bash
water-code --version
water-code --doctor
```

## 2. 最常见的启动方式

### 2.1 进入交互模式

```bash
water-code --cwd /path/to/project
```

如果不传 `--cwd`，默认使用当前目录。

### 2.2 单次执行一个 prompt

```bash
water-code --cwd /path/to/project -p "read README.md"
```

### 2.3 单次执行一个 slash command

```bash
water-code --cwd /path/to/project -p "/help"
water-code --cwd /path/to/project -p "/project"
water-code --cwd /path/to/project -p "/git"
```

### 2.4 JSON / adapter 风格输出

适合脚本、编辑器、外部集成：

```bash
water-code --cwd /path/to/project --json --doctor
water-code --cwd /path/to/project --json -p "read README.md"
water-code --cwd /path/to/project adapter state
water-code --cwd /path/to/project adapter prompt --input "read README.md"
```

## 3. 第一次进入一个项目应该怎么做

推荐顺序：

```bash
water-code --cwd /path/to/project --doctor
water-code --cwd /path/to/project --onboard
water-code --cwd /path/to/project --init
```

含义分别是：

- `--doctor`：检查当前 Node、provider、工作目录、状态目录、上下文加载是否正常
- `--onboard`：告诉你当前项目下一步最该做什么
- `--init`：把 Water Code 项目模板写进目标仓库

`--init` 会创建：

- `WATER.md`
- `.water-code/commands/readme-snapshot.md`
- `.water-code/agents/reviewer.md`
- `.water-code/skills/repo-cartographer.md`
- `.water-code/plugins/workspace-tools.js`
- `.water-code/mcp.json`

如果这些文件已经存在，默认不覆盖。需要覆盖时使用：

```bash
water-code --cwd /path/to/project --init --force
```

## 4. 两种主要工作模式

### 4.1 One-shot 模式

适合：

- 看一个文件
- 跑一次命令
- 查一次项目状态
- 给脚本或编辑器调用

例子：

```bash
water-code --cwd /path/to/project -p "git status"
water-code --cwd /path/to/project -p "read src/main.js"
water-code --cwd /path/to/project -p "/worktrees"
```

### 4.2 REPL 模式

适合：

- 连续处理多个问题
- 保留 session
- 多次调用工具
- 逐步修改项目

启动：

```bash
water-code --cwd /path/to/project
```

进入后常用命令：

```text
/help
/context
/project
/git
/worktrees
/permissions
/approvals
/sessions
/session new
```

## 5. 权限与审批流

Water Code 默认不是无限制执行危险操作的。它有 4 种权限模式：

- `ask`
- `accept-edits`
- `read-only`
- `yolo`

### 5.1 启动时指定权限模式

```bash
water-code --cwd /path/to/project --permission-mode ask
water-code --cwd /path/to/project --permission-mode accept-edits
water-code --cwd /path/to/project --permission-mode read-only
water-code --cwd /path/to/project --yolo
```

### 5.2 REPL 内切换

```text
/permissions
/permissions ask
/permissions accept-edits
/permissions read-only
/permissions yolo
```

### 5.3 各模式的含义

- `ask`：危险工具都需要确认
- `accept-edits`：编辑类工具自动通过，但 shell 仍需确认
- `read-only`：禁止危险工具
- `yolo`：危险工具直接放行

### 5.4 新的审批交互

当需要审批时，REPL 会给你更明确的提示，并支持：

- `y`：只允许这一次
- `a`：允许这个 tool，并记住到本次 Water Code 运行结束
- `g`：允许这个 permission group，并记住到本次运行结束
- `n`：拒绝

### 5.5 查看审批历史

```text
/approvals
/approvals clear
/approvals reset
/approvals wipe
```

含义：

- `clear`：清空审批历史
- `reset`：清空 remembered approvals
- `wipe`：两者都清空

## 6. 文件阅读与修改

最安全的工作流是：

1. 先读
2. 再看 diff
3. 再 patch
4. 最后才是直接 write

### 6.1 读取文件

```text
/read README.md
/read src/app.js --lines 80
```

### 6.2 看替换预览

```text
/diff README.md ::: # Title\n\nnew content
```

### 6.3 精确片段替换

```text
/patch README.md ::: Old Name >>> New Name
```

### 6.4 直接覆盖写文件

```text
/write notes.txt ::: first draft
```

### 6.5 用 prompt 方式让 agent 改

```bash
water-code --cwd /path/to/project -p "read src/app.js"
water-code --cwd /path/to/project -p "list files in src"
```

如果使用 VS Code shim，还可以直接用 `Water Code: Rewrite Selection` 做“选中 -> 改写 -> diff 预览 -> 应用”。

## 7. Session 与多轮工作

Water Code 会把 session 持久化到：

`.water-code/sessions`

### 7.1 查看 session

```text
/sessions
/session
```

### 7.2 新建或切换 session

```text
/session new
/session wc-xxxx
/session none
```

### 7.3 什么情况下要新开 session

建议在这些情况下新开：

- 切到新的任务
- 切到新的仓库
- 之前上下文太乱
- 想让 agent 从干净状态重新理解问题

## 8. 项目上下文、Git 与 worktree

### 8.1 看当前项目

```text
/project
/context
/instructions
```

### 8.2 查看 Git 状态

```text
/git
/worktrees
/refresh-git
```

### 8.3 切到另一个项目目录

```text
/project ../other-project
```

### 8.4 切到某个 worktree

```text
/worktree-use feature/review
```

或者 adapter：

```bash
water-code adapter project --input worktree:feature/review
```

## 9. Background Tasks

适合长一些的任务，避免堵住当前交互。

### 9.1 启动后台任务

```text
/task-run "repo scan" ::: read README.md
```

### 9.2 查看和取消

```text
/tasks
/task-show wctask-...
/task-cancel wctask-...
```

## 10. 自定义扩展能力

Water Code 支持项目级扩展。

### 10.1 Custom commands

目录：

`.water-code/commands/`

每个 `.md` 或 `.txt` 文件都可以变成一个 slash command。

查看：

```text
/commands
```

### 10.2 Custom agents

目录：

`.water-code/agents/`

查看和切换：

```text
/agents
/agent reviewer
/agent none
```

### 10.3 Skills

目录：

`.water-code/skills/`

查看和切换：

```text
/skills
/skill repo-cartographer
/skill repo-cartographer,safe-editor
/skill none
```

### 10.4 Plugins

目录：

`.water-code/plugins/`

查看：

```text
/plugins
```

### 10.5 MCP

配置文件：

`.water-code/mcp.json`

查看和调用：

```text
/mcp
/refresh-mcp
/mcp-call local_echo echo_note ::: {"note":"hello"}
```

## 11. Bridge 与远程控制

### 11.1 启动本地 bridge server

```bash
water-code --cwd /path/to/project --bridge --bridge-port 8765
```

### 11.2 常用接口

- `GET /health`
- `GET /state`
- `GET /project`
- `GET /doctor`
- `GET /onboard`
- `GET /sessions`
- `POST /sessions`
- `POST /prompt`
- `POST /prompt/stream`
- `POST /command`
- `POST /tool`

### 11.3 用远程 bridge 调用

```bash
water-code --remote-url http://127.0.0.1:8765 --doctor
water-code --remote-url http://127.0.0.1:8765 -p "/plugins"
water-code --remote-url http://127.0.0.1:8765 --json -p "read README.md"
```

### 11.4 adapter 方式

```bash
water-code --remote-url http://127.0.0.1:8765 adapter state
water-code --remote-url http://127.0.0.1:8765 adapter prompt --input "read README.md"
water-code --remote-url http://127.0.0.1:8765 adapter project --input ../other-project
```

## 12. VS Code 使用方式

VS Code shim 在：

`editor/vscode-water-code`

可用命令包括：

- `Water Code: Project State`
- `Water Code: Refresh Panel`
- `Water Code: Doctor`
- `Water Code: Onboard`
- `Water Code: Prompt Selection`
- `Water Code: Prompt Input`
- `Water Code: Rewrite Selection`
- `Water Code: Switch Project`
- `Water Code: Use Worktree`
- `Water Code: Resume Session`
- `Water Code: New Session`
- `Water Code: Clear Session`

推荐工作流：

1. 在 VS Code 里打开项目
2. 用 Explorer 里的 `Water Code` panel 看状态
3. 用 `Prompt Input` 或 `Prompt Selection` 做分析
4. 用 `Rewrite Selection` 做局部改写
5. 复杂任务回到终端 REPL

## 13. Anthropic provider

如果你有 Anthropic API key，可以切到真实模型：

```bash
export ANTHROPIC_API_KEY=...
export WATER_CODE_ANTHROPIC_MODEL=...
water-code --provider anthropic
```

建议：

- 先用 `planner` 跑工作流
- 再切 `anthropic` 做真实模型验证

## 14. 推荐使用套路

### 14.1 看项目

```bash
water-code --cwd /path/to/project --doctor
water-code --cwd /path/to/project --onboard
water-code --cwd /path/to/project -p "/project"
water-code --cwd /path/to/project -p "/context"
water-code --cwd /path/to/project -p "/git"
```

### 14.2 安全改一个文件

```text
/read src/app.js
/diff src/app.js ::: ...
/patch src/app.js ::: old >>> new
```

### 14.3 做真实多轮任务

```bash
water-code --cwd /path/to/project
```

进入后：

```text
/session new
/permissions accept-edits
/agent reviewer
/skill repo-cartographer,safe-editor
```

然后开始提任务。

### 14.4 切项目或切 worktree

```text
/project ../repo-b
/worktree-use feature/review
```

## 15. 验证与发布相关命令

### 15.1 基础验证

```bash
npm test
npm run verify
```

### 15.2 打包与安装验证

```bash
npm run package
npm run package-smoke
```

### 15.3 真实项目验证

```bash
npm run real-world-smoke
```

### 15.4 发布前检查

```bash
npm run release-check
npm run ship-check
```

## 16. 常见问题

### 16.1 为什么 `/git` 显示没有 Git 仓库

因为当前 `cwd` 不在 Git 仓库里。  
先确认：

```bash
pwd
git status
```

再用 `--cwd` 指向正确项目。

### 16.2 为什么自定义 commands / agents / skills 没加载

因为它们是按当前项目根加载的。  
要么先 `cd` 到目标项目，要么显式传：

```bash
water-code --cwd /path/to/project
```

### 16.3 为什么 shell 命令被拒绝

因为当前权限模式不允许。先看：

```text
/permissions
/approvals
```

必要时切到：

```text
/permissions yolo
```

或者在审批提示里临时允许。

### 16.4 为什么 remote / bridge 不通

先确认 bridge 是否真的启动：

```bash
water-code --cwd /path/to/project --bridge --bridge-port 8765
curl http://127.0.0.1:8765/health
```

### 16.5 为什么 prompt stream 里会出现 `stream.heartbeat`

这是正常的桥接保活事件，用来帮助远程客户端判断流还活着，不是错误。

## 17. 你最应该记住的 10 个命令

```bash
water-code --doctor
water-code --onboard
water-code --init
water-code --cwd /path/to/project
water-code --cwd /path/to/project -p "/project"
water-code --cwd /path/to/project -p "/git"
water-code --cwd /path/to/project adapter state
water-code --cwd /path/to/project --bridge --bridge-port 8765
npm run package
npm run ship-check
```

如果你只想开始真正用它，最短路径是：

```bash
water-code --cwd /your/repo --doctor
water-code --cwd /your/repo --onboard
water-code --cwd /your/repo
```
