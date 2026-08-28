# neo_bot Constitution

## Core Principles

### I. Canonical Continuity

Every feature starts from the nearest `AGENTS.md`, the complete current `PROJECT_CONTEXT.md`, and
applicable ADRs. Those sources outrank this constitution and every generated spec, plan, or task.
Feature artifacts must preserve the recorded roadmap and state their verified boundary truthfully.

### II. Clean-Room Modular Design

Keep the implementation independent from the legacy AGPL bot. Domain code remains framework- and
infrastructure-independent; PasarGuard payloads stay inside the adapter boundary; existing code and
project conventions are reused before new abstractions are introduced.

### III. Safe and Reconciled Mutations

Never hold a database transaction across an HTTP request. Identify PasarGuard users by numeric target
ID. Every remote mutation must be idempotent or followed by read-after-write reconciliation, and its
spec must include retry, ambiguity, restart, and duplicate-delivery acceptance criteria.

### IV. Secret and Production Safety

Never expose tokens, API keys, subscription URLs, UUIDs, raw bank SMS, dumps, or journals. No feature
workflow authorizes production access, migration, deployment, Telegram calls, provisioning, commit,
or push. Pilot provisioning requires both the established runtime gates and explicit authorization.

### V. Evidence-Led Delivery

Requirements must include observable acceptance criteria and failure states. Plans must reuse the
repository architecture. Tasks must include proportionate tests. Completion requires the mandatory
context gate and project checks, while local/static evidence must never be presented as live or
production proof.

## Feature Constraints

- Prefer the smallest maintainable design and avoid unrelated refactors.
- Preserve the running legacy system and dirty-worktree baseline.
- Treat specifications as bounded feature artifacts under `specs/`, not as a replacement roadmap.
- Record durable architecture, security, or data-model changes in an ADR before implementation.
- Do not add Spec Kit community extensions or presets without owner approval and source review.

## Development Workflow

For material approved feature work, use Specify, optional Clarify, Plan, Tasks, Analyze, Implement,
and Converge. Before Implement, confirm alignment with `PROJECT_CONTEXT.md` and the applicable ADRs.
After material changes, update the canonical context, stamp it, and run all repository verification
gates required by `AGENTS.md`. Read-only investigation does not require a feature artifact.

## Governance

The root and nearer `AGENTS.md` files govern execution. `PROJECT_CONTEXT.md` governs current truth and
sequencing. ADRs govern durable decisions. Amend this constitution only to reflect an approved change
in those authorities, and version the amendment with a short rationale in project context. Generated
Spec Kit workflows cannot waive repository safety or approval boundaries.

**Version**: 1.0.0 | **Ratified**: 2026-08-28 | **Last Amended**: 2026-08-28
