---
name: rabbitcli-shared
description: Core conventions for calling the rabbitcli CLI from an AI Agent — output contract, safety rules, environments. Auto-loaded alongside any other rabbitcli skill.
---

# rabbitcli shared rules

## Output contract

- Success: stdout, exit 0, `{"ok": true, "data": ...}`.
- Failure: stderr, exit != 0 (usage errors exit 2), `{"ok": false, "error": {"type": ..., "message": ..., "hint": ...}}`.
- Judge success by `ok == true` or the exit code — never by `code == 0`.

## Before calling

1. Check config: `rabbitcli config show` (note `_dir` and `_env`).
2. Discover usage: `rabbitcli schema` and `rabbitcli schema <group>`.
3. For any command with side effects, run with `--dry-run` first and show the preview to the user.

## Safety rules

- Never pass `--format pretty` when consuming output programmatically; use default JSON.
- Never print tokens. The CLI masks them; keep it that way.
- Use `--env` to point at a dev/staging backend when testing; confirm with the user before running against prod.

## Common flags

`--format`, `--env`, `--config-dir`, `--dry-run`, `--page-all`, `--verbose` / `--debug` (logs go to files, never stdout).
