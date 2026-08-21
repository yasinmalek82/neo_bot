---
name: neo-bot-gates
description: Closes a neo_bot change with context, ADR, stamp, check, and graphify. Use after material edits to code, schema, config, architecture, tests, or behavior.
---

# neo_bot close-out gates

A change is incomplete while the context gate is stale.

1. Update status, evidence, roadmap gate, and next task in `PROJECT_CONTEXT.md`.
2. Add one newest-first handoff entry. No transcripts, secrets, dumps, or source snippets.
3. Write or amend an ADR for durable architecture/security/data-model changes; link it from context.
4. `pnpm context:stamp` only after the file is truthful.
5. `pnpm check`.
6. `graphify update .` (or `--force` after shrinking `.graphifyignore`).

Read-only investigation does not need a context update.
