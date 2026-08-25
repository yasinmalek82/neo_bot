import { describe, expect, it } from 'vitest';

import {
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

  it('defaults provider mutations to disabled and requires an explicit isolated group', () => {
    const base = {
      DATABASE_URL: 'postgres://local/test',
      PASARGUARD_BASE_URL: 'https://panel.example.test',
      PASARGUARD_API_KEY: 'test-api-key',
    };
    expect(loadPilotConfig(base)).toMatchObject({
      provisioningMode: 'disabled',
      isolatedGroupId: null,
    });
    expect(() => loadPilotConfig({ ...base, PROVISIONING_MODE: 'isolated' })).toThrow(
      'INVALID_PILOT_CONFIGURATION',
    );
    expect(
      loadPilotConfig({
        ...base,
        PROVISIONING_MODE: 'isolated',
        PROVISIONING_ISOLATED_GROUP_ID: '42',
      }),
    ).toMatchObject({ provisioningMode: 'isolated', isolatedGroupId: 42 });
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

  it('keeps optional brand media disabled until Telegram file IDs are configured', () => {
    const base = {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_WEBHOOK_SECRET: 'safe_webhook_secret_123',
      TELEGRAM_ADMIN_IDS: '70001',
    };
    expect(loadTelegramConfig(base)).toMatchObject({
      brandMedia: { welcomePhotoFileId: null, deliveryPhotoFileId: null },
    });
    expect(
      loadTelegramConfig({
        ...base,
        TELEGRAM_BRAND_WELCOME_PHOTO_FILE_ID: ' welcome-file-id ',
        TELEGRAM_BRAND_DELIVERY_PHOTO_FILE_ID: 'delivery-file-id',
      }),
    ).toMatchObject({
      brandMedia: {
        welcomePhotoFileId: 'welcome-file-id',
        deliveryPhotoFileId: 'delivery-file-id',
      },
    });
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
    ).toMatchObject({ webhookUrl: 'https://bot.example.com/telegram/webhook' });
    expect(() =>
      loadTelegramConfig({ ...base, TELEGRAM_WEBHOOK_URL: 'http://127.0.0.1/telegram/webhook' }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
    expect(() =>
      loadTelegramConfig({
        ...base,
        TELEGRAM_WEBHOOK_URL: 'https://user:pass@bot.example.com/telegram/webhook',
      }),
    ).toThrow('INVALID_TELEGRAM_CONFIGURATION');
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
