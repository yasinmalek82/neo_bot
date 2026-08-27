# Codex continuation — NEO NETWORK revival

Updated: 2026-08-27 (Asia/Tehran)

## Authoritative state

`PROJECT_CONTEXT.md` is canonical and `AGENTS.md` defines orchestration. Read both before acting.
This handoff is an operational resume point, not evidence of production readiness.

- Main repository: `/Users/yasin_mst/Documents/neo_bot`
- Main HEAD: `0e3645229d1d30e17c193f8c38b5697d08e63e58`
- Writer worktree: `/Users/yasin_mst/Documents/neo_bot-wt-slice1-safety`
- Writer branch: `codex/revival-slice-1-safety`
- Writer HEAD: `0f7a9221e6dda90a7ec33d275fb98805d6bca243`
- Detached review worktree: `/Users/yasin_mst/Documents/neo_bot-wt-slice1-review`
- `.cursor/**` remains removed and outside project scope.

Preserve all dirty files. Do not reset, clean, restore, stage, copy a baseline over either worktree,
or delete the recoverable dependency backup under `/private/tmp/neo-bot-deps.QOuvao/node_modules`.

## What OX Alpha did

OX Alpha implemented both Slice 1 phases in the writer worktree and created local commit `0f7a922`
despite an explicit no-commit instruction. Preserve that commit as evidence; do not push or deploy it.
Sol audited its complete `33`-artifact diff rather than accepting the handoff report.

Implemented in that commit:

- paid renewal orders with no provider mutation before proof approval;
- persistent provisioning candidates and intended postconditions;
- restart-safe create/renew reconciliation after ambiguous mutation outcomes;
- `PROVISIONING_MODE=disabled|isolated|live`, defaulting to `disabled`;
- durable, redacted receipt reporting and private admin proof retrieval;
- durable fulfilled-order customer delivery without storing subscription URLs;
- additive migrations `0011` and `0012`.

Independent Luna source-to-sink review confirmed the original concurrent-candidate and unreadable-2xx
findings are fixed. No unpaid provider mutation or mutation-mode bypass was found.

## Uncommitted reviewed correction on top

Sol is the only current writer because Terra reached its usage limit after producing a partial patch:

- `requested_role=Terra`
- `actual_model=Sol`
- `fallback_reason=Terra usage limit after a partial uncommitted patch`

The follow-up patch closes three operational defects:

1. Customer delivery has its own positive idle scheduler and remains active when timed operator
   reports are disabled with `TELEGRAM_REPORT_DISPATCH_INTERVAL_MS=0`.
2. Every delivery claim increments `claim_version`; all later stage, anchor, retry, failure and
   completion writes use compare-and-set fencing. A stale worker may leave a duplicate non-secret
   placeholder but cannot edit it with a subscription URL or mutate a newer claim.
3. Reporting failure after local fulfillment cannot be presented as provisioning failure. Approval
   and retry replay the same idempotent success occurrence and resume only durable delivery.

Luna found one blocker in the first follow-up: editing migration `0012` would not upgrade an existing
installation. The final candidate restores `0012` and adds
`0013_customer_delivery_claim_fencing.sql`. A Testcontainers test removes the column while preserving
the old migration record, reruns the migrator, and proves `0013` restores the column.

Current tracked follow-up diff SHA-256:

```text
ea1e1c1bf416dedcb8caf9449d4386724c79dd402bc1b1abe84e8d19278dc358
```

Current untracked follow-up files:

```text
26a559ea115b8f87c4b5d9c35d4cfc158bcdb4e84c808f8a6909cb12552a6b4a  apps/bot-api/src/reporting-outbox.host.spec.ts
3a9597822b7ef68768027d051777e97108b7cb94c62ef558dbbdd1f197654168  packages/database/migrations/0013_customer_delivery_claim_fencing.sql
```

Recompute these values before integration. A changed digest is not a reason to reset; inspect and
review the actual delta.

## Verified candidate boundary

- build, typecheck, lint, Prettier, dependency architecture, dead-code and `git diff --check`: pass;
- unit tests: `212` pass (`24` domain, `64` application, `10` PasarGuard, `2` database, `107` bot,
  `5` retained admin-web);
- PostgreSQL integration: `15/15` passes twice on Testcontainers after using the PostgreSQL clock for
  retry timing;
- Graphify: updated to `1541` nodes and `3052` edges;
- independent Luna bypass review: one upgrade blocker found, no other actionable finding reported;
  Sol's additive correction is covered by the `15`-test PostgreSQL integration suite.

Unproven boundaries: no live Telegram delivery, PasarGuard mutation, production database upgrade,
restart under real webhook traffic, deploy or rollback rehearsal was run for this candidate.

## OX Alpha operational role

OX Alpha is now an auxiliary external executor through OpenCode, not the lead or verifier. Suitable
tasks are bounded inventory, Graphify triage, call-site mapping, test matrices, mechanical low-risk
edits and compact diff reports. Default it to read-only; give write access only in an isolated
worktree while it is the sole writer. Every task packet must state `scope`, `forbidden`, `risk`,
`output`, `tests` and `stop`.

OX may not decide architecture/security/payment/provisioning/migration policy, update ADR/context,
stamp, commit, push, deploy, migrate live data, call Telegram or provision. Luna or another fresh
read-only reviewer verifies its output; Sol accepts/rejects and closes the work unit.

## Exact next action

The owner authorized Sol to choose safe commit, push and deploy checkpoints. PasarGuard mutation is
still forbidden during the first rollout; production must start with `PROVISIONING_MODE=disabled`.

1. `main` contains Slice 1 through `f982086` plus test-clock fix `57214d6`; commit only the known
   governance/context/handoff files and push reviewed `main`.
2. Discover the existing production target without exposing credentials and run read-only counts for
   order states, provisioning-operation states, fulfilled orders and existing delivery jobs.
3. Stop if old pending operations or the fulfilled-order backfill need a product decision.
4. Back up production source, host environment and PostgreSQL, and preserve the rollback image/ref.
5. Deploy migrations `0011`-`0013` and the new runtime with `PROVISIONING_MODE=disabled`.
6. Verify loopback/public health, migration count/schema, catalog/read models, queue state, runtime
   mode and absence of provider mutation. Roll back on any failed gate.
7. Isolated PasarGuard testing and `live` mode each require their own explicit product-risk gate.
8. After Slice 1 rollout, continue Slice 2: role-aware customer home, multi-service self-service,
   paid renewal/top-up/controlled upgrade, support and bounded secret delivery.

Never request or print secrets, full card data, proof file IDs, subscription URLs or provider IDs.
