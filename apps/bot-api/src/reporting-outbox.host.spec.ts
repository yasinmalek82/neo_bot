import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportingOutboxHost } from './reporting-outbox.host.js';

const environment = {
  TELEGRAM_ENABLED: process.env['TELEGRAM_ENABLED'],
  TELEGRAM_BOT_TOKEN: process.env['TELEGRAM_BOT_TOKEN'],
  TELEGRAM_WEBHOOK_SECRET: process.env['TELEGRAM_WEBHOOK_SECRET'],
  TELEGRAM_ADMIN_IDS: process.env['TELEGRAM_ADMIN_IDS'],
  TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: process.env['TELEGRAM_REPORT_DISPATCH_INTERVAL_MS'],
  TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS: process.env['TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS'],
  TELEGRAM_REMINDER_DISPATCH_INTERVAL_MS: process.env['TELEGRAM_REMINDER_DISPATCH_INTERVAL_MS'],
  TELEGRAM_BROADCAST_DISPATCH_INTERVAL_MS: process.env['TELEGRAM_BROADCAST_DISPATCH_INTERVAL_MS'],
};

afterEach(() => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
  vi.useRealTimers();
});

describe('ReportingOutboxHost', () => {
  it('wakes idle delivery even when timed report dispatch is disabled', async () => {
    vi.useFakeTimers();
    Object.assign(process.env, {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
      TELEGRAM_ADMIN_IDS: '70001',
      TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: '0',
      TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS: '15000',
    });
    const bot = {
      dispatchDueReports: vi.fn().mockResolvedValue(undefined),
      dispatchDueDeliveries: vi.fn().mockResolvedValue(undefined),
      dispatchDueReminders: vi.fn().mockResolvedValue(undefined),
      dispatchDueBroadcasts: vi.fn().mockResolvedValue(undefined),
      dispatchDueUsageSync: vi.fn().mockResolvedValue(undefined),
    };
    const host = new ReportingOutboxHost(bot as never);

    host.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.dispatchDueReports).not.toHaveBeenCalled();
    expect(bot.dispatchDueDeliveries).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(bot.dispatchDueReports).not.toHaveBeenCalled();
    expect(bot.dispatchDueDeliveries).toHaveBeenCalledTimes(2);
    await host.onModuleDestroy();
  });

  it('keeps delivery progress independent from report dispatcher failures', async () => {
    vi.useFakeTimers();
    Object.assign(process.env, {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
      TELEGRAM_ADMIN_IDS: '70001',
      TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: '15000',
      TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS: '15000',
    });
    const bot = {
      dispatchDueReports: vi.fn().mockRejectedValue(new Error('REPORTING_UNAVAILABLE')),
      dispatchDueDeliveries: vi.fn().mockResolvedValue(undefined),
      dispatchDueReminders: vi.fn().mockResolvedValue(undefined),
      dispatchDueBroadcasts: vi.fn().mockResolvedValue(undefined),
      dispatchDueUsageSync: vi.fn().mockResolvedValue(undefined),
    };
    const host = new ReportingOutboxHost(bot as never);

    host.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.dispatchDueReports).toHaveBeenCalledTimes(1);
    expect(bot.dispatchDueDeliveries).toHaveBeenCalledTimes(1);
    await host.onModuleDestroy();
  });

  it('wakes idle reminder and broadcast dispatch independently', async () => {
    vi.useFakeTimers();
    Object.assign(process.env, {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
      TELEGRAM_ADMIN_IDS: '70001',
      TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: '0',
      TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS: '15000',
      TELEGRAM_REMINDER_DISPATCH_INTERVAL_MS: '15000',
      TELEGRAM_BROADCAST_DISPATCH_INTERVAL_MS: '15000',
    });
    const bot = {
      dispatchDueReports: vi.fn().mockResolvedValue(undefined),
      dispatchDueDeliveries: vi.fn().mockResolvedValue(undefined),
      dispatchDueReminders: vi.fn().mockResolvedValue(undefined),
      dispatchDueBroadcasts: vi.fn().mockResolvedValue(undefined),
      dispatchDueUsageSync: vi.fn().mockResolvedValue(undefined),
    };
    const host = new ReportingOutboxHost(bot as never);

    host.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.dispatchDueReports).not.toHaveBeenCalled();
    expect(bot.dispatchDueReminders).toHaveBeenCalledTimes(1);
    expect(bot.dispatchDueBroadcasts).toHaveBeenCalledTimes(1);
    await host.onModuleDestroy();
  });
});
