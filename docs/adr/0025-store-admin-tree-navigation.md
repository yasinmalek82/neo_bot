# ADR 0025: Store-admin tree navigation

- Status: accepted
- Date: 2026-09-05

## Context

The private Telegram store administrator workflow had grown into a flat hub with separate product, plan, archive, group-health, preview, and a fast-create mega menu. That layout made the catalog hierarchy hard to follow and made publishing too easy to trigger accidentally.

The catalog model is already hierarchical: categories contain products and products contain plans. Administrator navigation should make that relationship visible while preserving the durable chat sessions and compare-and-swap publication rules established by ADR 0012 and the catalog administration decisions.

## Decision

The store home is a compact set of primary actions, at most four: دسته‌ها, کارت و پرداخت, انتشار when a draft is pending, and بیشتر. «سلامت گروه‌ها» is not part of the store hub; it remains available from the appropriate operational area.

The catalog is navigated as Category → Product → Plan. Category and product detail screens show their children and expose creation only as «افزودن اینجا» at the current level. Root-category creation is available from «بیشتر». There are no top-level flat محصولات or پلن‌ها actions.

The old «ساخت سریع» mega menu is removed from the store hub. The legacy `store:new:guided` callback remains supported for its existing durable guided flow, but it is not a primary hub action.

Publishing is an explicit two-step flow: `store:publish` shows a preview and `store:publish:confirm` performs the compare-and-swap (CAS) publication. A missing durable session fails closed rather than publishing.

Durable administrator sessions, resumable forms, and CAS publication remain in force as specified by ADR 0012. The «بیشتر» menu contains بایگانی, نمای مشتری, ادامه فرم باز when available, and افزودن دسته ریشه.


## Consequences

- The store home is shorter and the catalog hierarchy is visible in every navigation path.
- Creation is scoped to the selected category or product, reducing accidental mis-parenting.
- Publication requires an explicit confirmation after a preview, without changing the durable-session or CAS guarantees.
- Group health is kept out of the store hub, while archive, customer view, resume, and root-category creation remain discoverable in «بیشتر».
- The owner must use the tree path for normal catalog administration; the guided callback is retained for compatibility and tests.
