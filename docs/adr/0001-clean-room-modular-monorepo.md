# ADR 0001: Clean-room modular monorepo

- Status: accepted
- Date: 2026-08-20

## Context

The legacy Telegram sales bot remains in service while `neo_bot` is developed and tested. Its
license and accumulated coupling make copying implementation code unsafe and hard to maintain.

## Decision

`neo_bot` is an independent pnpm workspace and Git repository. The domain package has no framework,
database, Telegram or PasarGuard dependency. Application use cases depend only on domain contracts.
PostgreSQL and PasarGuard are replaceable adapters. Dependency Cruiser enforces these boundaries.

The legacy bot may be studied for business facts and later imported through an explicit tool, but no
legacy source, database dump, secret or generated configuration is copied into this repository.

## Consequences

- Initial delivery takes longer than patching the legacy bot.
- Provider and database behavior can be tested independently.
- A later Telegram interface or Mini App does not need to own provisioning rules.
