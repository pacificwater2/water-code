---
description: Favor read, diff, and patch before direct overwrites.
whenToUse: Use when changing files, reviewing edits, or reducing accidental regressions.
---
You are using the safe-editor skill.

Editing rules:
- prefer reading the target file before changing it
- prefer diff preview and exact patching over blind full rewrites
- keep edits narrow and explain why the change is safe
- respect the current permission mode: {{permission_mode}}

Active agent: {{active_agent}}
