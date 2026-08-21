# ADR 0004: Admin-managed storefront catalog

- Status: accepted
- Date: 2026-08-21

## Context

The customer Mini App originally embedded product cards, volume choices, durations and prices in its
React source. Every catalog adjustment therefore required a code edit and a new frontend build. The
administrator also needs to map tunnel products to multiple PasarGuard groups without exposing
provider metadata to customers.

## Decision

PostgreSQL is the source of truth for customer-facing storefront data. An administrator edits one
complete catalog draft in the browser and publishes it with a single authenticated request. The
database applies the replacement in one short transaction: omitted managed records are archived,
stable codes are upserted, and every included variant is mapped to validated, available PasarGuard
groups.

Each sellable variant is one exact matrix row containing volume, duration, simultaneous-device limit,
price and provider groups. The customer Mini App derives its selectors from those rows and can render
any number of values on the supported axes. It never receives provider codes or group IDs.

Catalog administration uses a separate bearer token during local development. The token is held only
in browser session storage and is not logged. Production administration must replace this temporary
mechanism with verified Telegram Mini App `initData` and numeric administrator authorization before
internet exposure.

## Consequences

- Adding `75 GB`, a `45-day` duration, a different connection count or a new price does not require a
  Mini App code change.
- Product names, descriptions, badges, icons, ordering, category copy, storefront copy and card details
  are administrator-managed.
- One variant can map to multiple PasarGuard groups for tunnel or multi-location provisioning.
- A failed validation or unavailable group rolls back the complete publish; customers continue seeing
  the previous catalog.
- Visual layout, interaction design and entirely new selector dimensions remain code-owned. The system
  intentionally avoids an unrestricted EAV/page-builder model until a real new dimension is required.
