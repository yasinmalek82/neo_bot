const POLLING_STALE_MS = 45_000;

export type TelegramIntakeMode = 'disabled' | 'polling' | 'webhook';

export interface TelegramIntakeHealth {
  readonly mode: TelegramIntakeMode;
  readonly ready: boolean;
  readonly error: string;
}

const state: {
  mode: TelegramIntakeMode;
  lastSuccessAt: number | null;
  lastError: string;
} = {
  mode: 'disabled',
  lastSuccessAt: null,
  lastError: 'none',
};

export function configureTelegramIntake(mode: TelegramIntakeMode): void {
  state.mode = mode;
  if (mode === 'disabled') {
    state.lastError = 'none';
  }
}

export function recordTelegramIntakeSuccess(): void {
  state.lastSuccessAt = Date.now();
  state.lastError = 'none';
}

export function recordTelegramIntakeFailure(error: unknown): void {
  state.lastError = sanitizeIntakeError(error);
}

export function recordTelegramIntakeProbeOk(): void {
  state.lastError = 'none';
}

export function applyWebhookInfo(
  expectedUrl: string,
  info: { readonly url: string; readonly lastErrorDate: number | null },
  lastSuccessAt: number | null = state.lastSuccessAt,
): void {
  const expected = trimTrailingSlash(expectedUrl);
  const actual = trimTrailingSlash(info.url);
  if (actual.length === 0 || actual !== expected) {
    recordTelegramIntakeFailure(new Error('TELEGRAM_WEBHOOK_UNSET'));
    return;
  }
  if (
    info.lastErrorDate !== null &&
    Number.isInteger(info.lastErrorDate) &&
    info.lastErrorDate > 0 &&
    (lastSuccessAt === null || info.lastErrorDate * 1000 > lastSuccessAt)
  ) {
    recordTelegramIntakeFailure(new Error('TELEGRAM_WEBHOOK_DELIVERY'));
    return;
  }
  recordTelegramIntakeProbeOk();
}

export function readTelegramIntakeHealth(
  now = Date.now(),
  configMode: TelegramIntakeMode = state.mode,
): TelegramIntakeHealth {
  const mode = configMode;
  const error = state.lastError;
  if (mode === 'disabled') {
    return { mode, ready: true, error: 'none' };
  }
  if (mode === 'webhook') {
    return { mode, ready: error === 'none', error };
  }
  if (error === 'none') {
    return { mode, ready: true, error };
  }
  const lastSuccessAt = state.lastSuccessAt;
  const ready = lastSuccessAt !== null && now - lastSuccessAt < POLLING_STALE_MS;
  return { mode, ready, error };
}

export function resetTelegramIntakeForTests(): void {
  state.mode = 'disabled';
  state.lastSuccessAt = null;
  state.lastError = 'none';
}

export function sanitizeIntakeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'TELEGRAM_UNAVAILABLE';
  }
  const code = error.message.trim();
  if (/^TELEGRAM_[A-Z0-9_]{1,60}$/u.test(code)) {
    return code;
  }
  return 'TELEGRAM_UNAVAILABLE';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/u, '');
}
