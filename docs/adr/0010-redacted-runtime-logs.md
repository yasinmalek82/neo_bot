# ADR 0010: Redacted runtime logs and HTTP error bodies

- Status: accepted
- Date: 2026-08-21

## Context

The first-release definition of done forbids subscription URLs, tokens, receipt file IDs and card
numbers in logs and public APIs. Nest's default JSON logger and exception filter can echo `Error`
messages, Zod `cause` payloads, and unstructured Telegram/PasarGuard text. Reporting already
sanitizes forum payloads; HTTP and stdout did not.

## Decision

- `bot-api` logs through `SafeLogger`, which redacts URLs, bot tokens, bearer values, 16-digit
  cards, UUID-shaped identifiers, and object keys that look like secrets. It does not log request
  bodies.
- Unhandled exceptions go through `RedactingExceptionFilter`. HTTP clients see allowlisted error
  codes only. Unstructured messages become `INTERNAL_ERROR`.
- PasarGuard adapter errors stay as stable codes and do not attach provider JSON or Zod issues as
  `Error.cause`.

`packages/domain` stays free of logger and HTTP filter types.

## Consequences

- A failed provision or webhook no longer prints a subscription URL even if an upstream message
  contained one.
- Operators diagnose from allowlisted codes, health, and redacted forum notices. Raw Telegram or
  PasarGuard bodies are not a support channel.
