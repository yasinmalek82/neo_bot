# ADR 0006: Bot-provisioned reporting forum topics

- Status: accepted
- Date: 2026-08-21
- Supersedes: the topic-ownership clause of `docs/adr/0005-admin-reporting-event-backbone.md`

## Context

ADR 0005 required the owner to create every forum topic and paste `message_thread_id` values into
configuration. That is operationally brittle and blocked local forum validation. The owner can still
create the private supergroup and enable Topics; the bot should then provision the stable purpose
topics itself.

Telegram Bot API exposes `createForumTopic` when the bot is an administrator with
`can_manage_topics`. Bots cannot list existing topics, so idempotency cannot be derived from Telegram
alone.

## Decision

The owner supplies only the forum group chat ID and enables Topics on that group. The bot must be an
administrator with `can_manage_topics`. On startup the application:

1. persists one active forum destination for that chat ID;
2. reuses stored purpose-to-thread mappings;
3. calls `createForumTopic` only for missing purposes;
4. writes each new thread ID immediately after Telegram accepts the create.

The bot does not rename, close or delete topics. It may set a topic icon from Telegram's allowed
forum-topic custom emoji stickers, and a color from the Bot API palette when creating a missing
topic. Optional environment thread IDs remain overrides and are stored before any create. A crash
after Telegram creates a topic and before the binding is stored may leave an unused duplicate topic;
it must never duplicate orders or PasarGuard users.

If the chat is not a forum, or the bot lacks topic rights, bootstrap fails with an operator-visible
error code and does not send reports into the General topic.

`packages/domain` stays free of forum and Telegram thread concepts. No database transaction stays
open across the Telegram HTTP call.

## Consequences

- Local setup is: create a private forum group, add the bot as admin with topic rights, set
  `TELEGRAM_REPORT_GROUP_CHAT_ID`.
- Restart does not recreate mapped topics. It may refresh topic icons from the allowed custom-emoji
  set.
- Changing the configured group starts a new destination and new topics in that group.
- A dedicated process that inventories Telegram topics remains unnecessary until Bot API can list
  them.
