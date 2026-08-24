# neo_bot Engineering Rules

## Mandatory continuity protocol

`PROJECT_CONTEXT.md` is the canonical cross-account project state and roadmap.

At the start of every task:

- Read this file and any nearer `AGENTS.md` before editing. Read all of `PROJECT_CONTEXT.md` on a
  new session. In a continuation of the same conversation, skip a full re-read when the fingerprint
  was already confirmed current.
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

## Removed Cursor tooling

Cursor tooling and `.cursor/**` are not part of this project and must not be recreated, installed or
used unless the owner explicitly authorizes a new integration. Spawn at most two subagents.

## Codex orchestration

- Preferred supervisor: `GPT-5.6 Sol High`. Preferred executors: Luna for bounded discovery,
  reports, tests, independent verification and small patches; Terra for medium or complex
  multi-file implementation. Sol delegates routine work and does not directly implement it.
- Sol enters directly only for an unresolved product or architecture decision; data-model,
  authentication, payment, provisioning/idempotency or secret boundary; migration, restore,
  deployment or other live mutation; failed/conflicting verification; or final authority work.
- At most two subagents may be active and at most one may write. Preserve the dirty-worktree
  baseline: before delegation record existing changes, give each subagent an explicit path scope,
  and never use cleanup, reset, restore or staging to simplify another worker's changes.
- Every task packet states `scope`, `forbidden`, `risk`, `output`, `tests`, and `stop` conditions.
  Subagents may not update ADRs or `PROJECT_CONTEXT.md`, stamp context, commit, push, deploy,
  migrate live data, call Telegram, or provision services without Sol's explicit final authority.
- If a preferred role is unavailable, use a role-equivalent fallback and disclose
  `requested_role`, `actual_model`, and `fallback_reason` in the task handoff. Repository policy
  selects roles; it does not claim to enforce the runtime model.

## Verification

- If the owner pasted Telegram bot copy, Grep that sentence in `apps/bot-api/src/telegram-menu.ts`
  first, then follow `telegram-commerce-bot.ts` and `config.ts`.
- Use Graphify (`query` / `path` / `explain`, budget 600, maximum 1200) when the file path is
  unknown. If `graphify-out/wiki/index.md` exists, use it for architecture questions.
- After changes run context check, typecheck, lint, tests, build, dependency-cruiser, and
  `graphify update .` when initialized. Use `graphify update . --force` after shrinking the corpus.
