import { afterEach, describe, expect, it } from 'vitest';

import {
  configureTelegramIntake,
  readTelegramIntakeHealth,
  applyWebhookInfo,
  recordTelegramIntakeFailure,
  recordTelegramIntakeSuccess,
  resetTelegramIntakeForTests,
  sanitizeIntakeError,
} from './telegram-intake.js';

describe('telegram intake health', () => {
  afterEach(() => {
    resetTelegramIntakeForTests();
  });

  it('keeps polling ready until a sanitized transport error is recorded', () => {
    configureTelegramIntake('polling');
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'polling',
      ready: true,
      error: 'none',
    });
    recordTelegramIntakeFailure(new Error('TELEGRAM_POLLING_CONFLICT'));
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'polling',
      ready: false,
      error: 'TELEGRAM_POLLING_CONFLICT',
    });
  });

  it('clears the error after a successful getUpdates cycle', () => {
    configureTelegramIntake('polling');
    recordTelegramIntakeFailure(new Error('TELEGRAM_HTTP_500'));
    recordTelegramIntakeSuccess();
    expect(readTelegramIntakeHealth()).toMatchObject({ ready: true, error: 'none' });
  });

  it('does not treat a quiet webhook as stale when no traffic has arrived', () => {
    configureTelegramIntake('webhook');
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'webhook',
      ready: true,
      error: 'none',
    });
  });

  it('marks webhook intake not ready after an allowlisted delivery error', () => {
    configureTelegramIntake('webhook');
    recordTelegramIntakeFailure(new Error('TELEGRAM_WEBHOOK_DELIVERY'));
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'webhook',
      ready: false,
      error: 'TELEGRAM_WEBHOOK_DELIVERY',
    });
  });

  it('maps getWebhookInfo without putting Telegram descriptions into health', () => {
    configureTelegramIntake('webhook');
    applyWebhookInfo('https://bot.example.com/telegram/webhook', {
      url: 'https://bot.example.com/telegram/webhook/',
      lastErrorDate: null,
    });
    expect(readTelegramIntakeHealth()).toMatchObject({ ready: true, error: 'none' });
    applyWebhookInfo('https://bot.example.com/telegram/webhook', {
      url: '',
      lastErrorDate: null,
    });
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'webhook',
      ready: false,
      error: 'TELEGRAM_WEBHOOK_UNSET',
    });
    recordTelegramIntakeSuccess();
    applyWebhookInfo('https://bot.example.com/telegram/webhook', {
      url: 'https://bot.example.com/telegram/webhook',
      lastErrorDate: Math.floor(Date.now() / 1000) + 60,
    });
    expect(readTelegramIntakeHealth()).toEqual({
      mode: 'webhook',
      ready: false,
      error: 'TELEGRAM_WEBHOOK_DELIVERY',
    });
  });

  it('drops unstructured error text so health never echoes Telegram descriptions', () => {
    expect(sanitizeIntakeError(new Error('Conflict: terminated by other getUpdates'))).toBe(
      'TELEGRAM_UNAVAILABLE',
    );
    expect(sanitizeIntakeError('secret')).toBe('TELEGRAM_UNAVAILABLE');
  });
});
