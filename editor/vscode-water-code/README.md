# Water Code VS Code Shim

This folder contains a minimal VS Code extension that shells into the stable `water-code adapter ...` contract.

It is intentionally small:

- no custom webviews
- no extension-side model logic
- no extra protocol beyond the Water Code adapter surface

Supported commands:

- `Water Code` explorer panel with project, git, session, extension, and runtime state
- `Water Code: Refresh Panel`
- `Water Code: Project State`
- `Water Code: Switch Project`
- `Water Code: Use Worktree`
- `Water Code: Resume Session`
- `Water Code: New Session`
- `Water Code: Clear Session`
- `Water Code: Doctor`
- `Water Code: Onboard`
- `Water Code: Prompt Selection`
- `Water Code: Prompt Input`
- `Water Code: Rewrite Selection`
- `Water Code: Open Output`

Important settings:

- `waterCode.cliPath`
- `waterCode.provider`
- `waterCode.remoteUrl`
- `waterCode.useWorkspaceRoot`
- `waterCode.streamPrompts`

To try it in VS Code:

1. Open this `editor/vscode-water-code` folder as an extension project.
2. Press `F5` to launch the Extension Development Host.
3. In the new window, open a workspace and use the `Water Code` panel in the Explorer to inspect state or switch sessions.
4. Run the remaining commands from the Command Palette when you want prompt, doctor, onboard, project switch, worktree switch, or selection rewrite flows.

`Water Code: Rewrite Selection` is the first native edit loop:

1. Select code or text in the editor.
2. Describe the rewrite you want.
3. Water Code asks the runtime for replacement text only.
4. VS Code opens a native diff preview.
5. You choose whether to apply the patch back into the file.
