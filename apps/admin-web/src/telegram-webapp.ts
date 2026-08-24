interface TelegramWebApp {
  readonly initData?: string;
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
}

const MINI_APP_NAVY = '#071625';
const INIT_DATA_WAIT_MS = 800;
const INIT_DATA_POLL_MS = 50;

function telegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function prepareTelegramWebApp(): void {
  const webApp = telegramWebApp();
  webApp?.ready?.();
  webApp?.expand?.();
  webApp?.setHeaderColor?.(MINI_APP_NAVY);
  webApp?.setBackgroundColor?.(MINI_APP_NAVY);
}

export function readInitDataFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) {
    return null;
  }
  const encoded = new URLSearchParams(raw).get('tgWebAppData');
  if (encoded === null || encoded.length === 0) {
    return null;
  }
  return encoded;
}

function readTelegramInitData(
  hash = typeof globalThis.location === 'undefined' ? '' : globalThis.location.hash,
): string | null {
  prepareTelegramWebApp();
  const fromWebApp = telegramWebApp()?.initData;
  const fromHash = readInitDataFromHash(hash);
  const result = typeof fromWebApp === 'string' && fromWebApp.length > 0 ? fromWebApp : fromHash;
  return result;
}

export function waitForTelegramInitData(timeoutMs = INIT_DATA_WAIT_MS): Promise<string | null> {
  const immediate = readTelegramInitData();
  if (immediate !== null) {
    return Promise.resolve(immediate);
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      const value = readTelegramInitData();
      if (value !== null) {
        resolve(value);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      globalThis.setTimeout(tick, INIT_DATA_POLL_MS);
    };
    globalThis.setTimeout(tick, INIT_DATA_POLL_MS);
  });
}

export function shouldUsePhonePreview(
  search = typeof globalThis.location === 'undefined' ? '' : globalThis.location.search,
): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('preview') === '1';
}

export function closeTelegramWebApp(): void {
  telegramWebApp()?.close?.();
}
