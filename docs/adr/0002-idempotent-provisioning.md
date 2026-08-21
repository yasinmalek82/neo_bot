# ADR 0002: Idempotent provisioning with read-after-write

- Status: accepted
- Date: 2026-08-20

## Context

Telegram updates, queues and HTTP clients can retry. A PasarGuard mutation can also time out after the
remote side has already applied it. Blind retries can create or renew a service twice.

## Decision

Every create or renew command requires an idempotency key. The database stores the operation type,
request hash, status and resulting service. Reusing a key with different input is rejected.

New usernames are deterministic from the idempotency key. A concurrent request observing a pending
operation does not issue another mutation. After an ambiguous mutation failure, the application reads
the user back and only reports success if the intended state is observed. Definitive provider errors
are marked failed and are never converted to pending success.

PasarGuard users are persisted and addressed by their numeric ID. Username is discovery metadata,
not the identity used for renewals.

## Consequences

- Duplicate delivery does not intentionally duplicate remote mutations.
- Ambiguous operations may remain pending for operator reconciliation.
- Later queue workers must carry the original idempotency key unchanged.
