---
name: neo-bot-session
description: Starts a neo_bot implementation session from PROJECT_CONTEXT. Use at the beginning of coding, debugging, architecture, or handoff work in this repository.
---

# neo_bot session start

Do this before editing, every time:

1. Confirm cwd is `/Users/yasin_mst/Documents/neo_bot`.
2. Read root `AGENTS.md` and the full `PROJECT_CONTEXT.md`.
3. Run `git status -sb` and `pnpm context:check`.
4. If the fingerprint is stale, inspect existing diffs and update context before new work. Never stamp unknown changes.
5. `graphify query` (budget 600) before broad Read/Grep/Glob.
6. Continue from **Current priority and next task** unless the owner changed priority.

Do not ask the owner to paste tokens, chat IDs, or secrets.
