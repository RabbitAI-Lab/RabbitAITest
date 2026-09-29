---
name: rabbitcli-demo
description: Example service commands of rabbitcli — items list/get and the +hello shortcut. Replace with skills for your own service domains.
---

# rabbitcli demo service

## Commands

- `rabbitcli demo +hello` — smoke-test shortcut; no API call, safe to run anytime.
- `rabbitcli demo items list [--page-all]` — GET /v1/items; supports cursor pagination.
- `rabbitcli demo items get <id>` — GET /v1/items/:id.

## Agent guidance

- Use `--dry-run` to preview before real calls.
- Prefer `--format table` only for human display; parse JSON otherwise.
- Errors with `"type": "config"` mean baseUrl/token missing → run `rabbitcli config init` or set an environment via `rabbitcli env use <name>`.
