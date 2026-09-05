# Feature 005 — Durable interaction kernel

This remote baseline did not contain earlier Phase 1–3 artifacts. Phase 4 customer
restart-safe flows were implemented against ADR 0021 and the existing catalog-admin
session pattern.

## Phase 4 — Customer restart-safe flows

- [x] T019 Restart, Home/Cancel, expiry, malformed payload, and out-of-order tests for
      purchase naming/coupon and renewal coupon in
      `apps/bot-api/src/interaction/commerce-flow.spec.ts`
- [x] T020 Same class of tests for wallet top-up amount/coupon in
      `apps/bot-api/src/interaction/wallet-flow.spec.ts`
- [x] T021 Same class of tests for ticket create/follow-up in
      `apps/bot-api/src/interaction/support-flow.spec.ts`
- [x] T022 `ConversationFlowHandler` runtime contract, transition results, input
      ownership, recovery vocabulary, and registry in
      `apps/bot-api/src/interaction/conversation-flow.ts`
- [x] T023 Purchase name, purchase discount, and renewal discount state in
      `apps/bot-api/src/interaction/commerce-flow.ts` plus durable sessions. Existing
      `beginCheckout` / `beginRenewal` remain the authoritative order writes
- [x] T024 Wallet top-up amount and wallet discount state in
      `apps/bot-api/src/interaction/wallet-flow.ts` plus durable sessions. Ledger
      credits are idempotent by Telegram update key; no negative balance
- [x] T025 Customer ticket draft and follow-up in
      `apps/bot-api/src/interaction/support-flow.ts`. Ticket body is written only by
      `packages/application/src/support-ticket.ts` through
      `packages/application/src/commerce-ports.ts` and
      `packages/database/src/commerce-repository.ts` with Telegram-update-scoped
      idempotency. Body is never stored in session history
- [x] T026 Route customer text/callback input through the flow registry; remove the
      migrated customer `Map` from `apps/bot-api/src/telegram-commerce-bot.ts`; add bot
      reconstruction coverage in `apps/bot-api/src/telegram-commerce-bot.spec.ts`
