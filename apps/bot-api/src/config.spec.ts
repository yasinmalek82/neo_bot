import { describe, expect, it } from 'vitest';

import {
  loadAdminApiConfig,
  loadDatabaseConfig,
  loadHttpConfig,
  loadPilotConfig,
  loadTelegramConfig,
} from './config.js';

describe('configuration', () => {
  it('does not include secret values in validation errors', () => {
    expect(() => loadPilotConfig({ PASARGUARD_API_KEY: 'secret-value' })).toThrow(
      'INVALID_PILOT_CONFIGURATION',
    );
  });

  it('loads the database URL independently from pilot credentials', () => {
    expect(loadDatabaseConfig({ DATABASE_URL: 'postgres://local/test' })).toEqual({
      databaseUrl: 'postgres://local/test',
    });
  });

  it('keeps Telegram disabled without requiring secrets', () => {
    expect(loadTelegramConfig({ TELEGRAM_ENABLED: 'false' })).toEqual({ enabled: false });
  });

  it('rejects incomplete Telegram configuration without exposing values', () => {
    expect(() =>
      loadTelegramConfig({ TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'private-value' }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
  });

  it('loads optional forum reporting mappings without requiring them', () => {
    expect(
      loadTelegramConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
        TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
        TELEGRAM_ADMIN_IDS: '70001',
        TELEGRAM_REPORT_GROUP_CHAT_ID: '-1001234567890',
        TELEGRAM_REPORT_TOPIC_RECEIPTS: '3',
      }),
    ).toMatchObject({
      enabled: true,
      reporting: {
        groupChatId: '-1001234567890',
        topics: { receipts: '3' },
      },
      reportDispatchIntervalMs: 15_000,
    });
  });

  it('allows disabling the idle report dispatcher with a zero interval', () => {
    expect(
      loadTelegramConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
        TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
        TELEGRAM_ADMIN_IDS: '70001',
        TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: '0',
      }),
    ).toMatchObject({ enabled: true, webhookUrl: null, reportDispatchIntervalMs: 0 });
  });

  it('accepts an https webhook URL and rejects http or credentialed URLs', () => {
    const base = {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
      TELEGRAM_ADMIN_IDS: '70001',
    };
    expect(
      loadTelegramConfig({
        ...base,
        TELEGRAM_WEBHOOK_URL: 'https://bot.example.com/telegram/webhook',
      }),
    ).toMatchObject({ webhookUrl: 'https://bot.example.com/telegram/webhook', miniAppUrl: null });
    expect(() =>
      loadTelegramConfig({ ...base, TELEGRAM_WEBHOOK_URL: 'http://127.0.0.1/telegram/webhook' }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
    expect(() =>
      loadTelegramConfig({
        ...base,
        TELEGRAM_WEBHOOK_URL: 'https://user:pass@bot.example.com/telegram/webhook',
      }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
    expect(
      loadTelegramConfig({
        ...base,
        TELEGRAM_MINI_APP_URL: 'https://mini.example.com/',
      }),
    ).toMatchObject({ miniAppUrl: 'https://mini.example.com/' });
    expect(() =>
      loadTelegramConfig({ ...base, TELEGRAM_MINI_APP_URL: 'http://127.0.0.1:4173/' }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
  });

  it('keeps the admin API disabled until a strong token is configured', () => {
    expect(loadAdminApiConfig({})).toEqual({ token: null });
    expect(() => loadAdminApiConfig({ ADMIN_API_TOKEN: 'too-short' })).toThrow(
      'INVALID_ADMIN_API_CONFIGURATION',
    );
  });

  it('loads explicit HTTP origins without allowing arbitrary origins', () => {
    expect(
      loadHttpConfig({ HOST: '127.0.0.1', PORT: '3100', WEB_ORIGINS: 'http://127.0.0.1:4173' }),
    ).toEqual({
      host: '127.0.0.1',
      port: 3100,
      webOrigins: ['http://127.0.0.1:4173'],
    });
  });
});
