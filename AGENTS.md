# neo_bot Engineering Rules

## Mandatory continuity protocol

`PROJECT_CONTEXT.md` is the canonical cross-account project state and roadmap.

At the start of every task:

- Read this file, all of `PROJECT_CONTEXT.md`, and any nearer `AGENTS.md` before editing.
- Run `git status` and `pnpm context:check`.
- If the context fingerprint is stale, inspect and document the existing changes before starting new
  work. Never blindly run the stamp command over unknown changes.
- Continue from the recorded current phase and next task unless the user explicitly changes priority.

After every material change to code, schema, configuration, architecture, behavior, tests, deployment
or security:

- Update the relevant status, validation evidence, roadmap gate and next task in
  `PROJECT_CONTEXT.md`.
- Add one concise newest-first entry to its handoff log. Do not store transcripts, reasoning, terminal
  dumps, secrets or source snippets there.
- Record durable architecture, security or data-model changes in an ADR and link it from the context.
- Run `pnpm context:stamp` only after the context is truthful, then run `pnpm check`.

A change is not complete while the context gate is stale. Read-only investigation does not require a
context update.

## Scope

This is a private, clean-room implementation. Do not copy code from the legacy AGPL bot.
Legacy repositories and migration journals are read-only evidence unless a task explicitly authorizes an import.

## Architecture

- Keep `packages/domain` framework- and infrastructure-independent.
- Keep external PasarGuard payloads inside `packages/pasarguard`; map them to domain types.
- Never hold a database transaction open across an HTTP request.
- Persist PasarGuard users by numeric target ID. Usernames are display/search attributes only.
- Every remote mutation must be idempotent or followed by read-after-write reconciliation.
- Products reference prepared PasarGuard groups. Do not model product categories as panel instances.

## Safety

- Never log API keys, Telegram tokens, subscription URLs, UUIDs, raw bank SMS, dumps, or journals.
- Never run pilot provisioning unless `PILOT_ENABLED=true` and an explicit isolated group ID is configured.
- Never connect to production, migrate users, deploy, commit, or push without explicit authorization.

## Agent tooling

Project skills are in `.cursor/skills/`, session/stop hooks in `.cursor/hooks/`, and the cheap
codebase mapper is `.cursor/agents/graphify-explore.md`. Spawn at most two subagents.

## Verification

- Before changes, inspect the repository and use Graphify queries when a graph exists.
- Prefer `graphify query`, `graphify path` and `graphify explain`. If `graphify-out/wiki/index.md`
  exists, navigate that wiki instead of reading the raw graph report first.
- Use Graphify query budget 600 by default and 1200 maximum.
- After changes run context check, typecheck, lint, tests, build, dependency-cruiser, and
  `graphify update .` when initialized. Use `graphify update . --force` after shrinking the corpus.
