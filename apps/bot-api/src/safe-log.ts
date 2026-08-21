import { ConsoleLogger } from '@nestjs/common';

const FORBIDDEN_KEY =
  /(token|secret|password|api.?key|subscription|file.?id|card|sms|authorization|cookie|username|init.?data|hash)/iu;
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/giu;
const BOT_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/giu;
const CARD_PATTERN = /\b\d{16}\b/gu;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;

export function redactLogText(value: string): string {
  return value
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(BOT_TOKEN_PATTERN, '[redacted-token]')
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(CARD_PATTERN, '[redacted-card]')
    .replace(UUID_PATTERN, '[redacted-id]');
}

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redactLogText(value);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[cycle]';
  }
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, seen));
  }
  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    redacted[key] = FORBIDDEN_KEY.test(key) ? '[redacted]' : redactLogValue(nested, seen);
  }
  return redacted;
}

export class SafeLogger extends ConsoleLogger {
  public override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  public override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  public override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  public override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  public override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  public override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }
}
