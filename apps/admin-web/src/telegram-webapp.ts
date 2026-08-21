interface TelegramWebApp {
  readonly initData?: string;
  ready?: () => void;
  expand?: () => void;
}

function telegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function prepareTelegramWebApp(): void {
  const webApp = telegramWebApp();
  webApp?.ready?.();
  webApp?.expand?.();
}

export function readTelegramInitData(): string | null {
  prepareTelegramWebApp();
  const initData = telegramWebApp()?.initData;
  if (typeof initData !== 'string' || initData.length === 0) {
    return null;
  }
  return initData;
}
