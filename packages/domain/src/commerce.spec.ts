import { describe, expect, it } from 'vitest';

import { validatePaymentProofReference, validateTelegramCustomerInput } from './commerce.js';

describe('commerce domain validation', () => {
  it('accepts a private Telegram customer identity', () => {
    expect(() =>
      validateTelegramCustomerInput({
        telegramUserId: '123456789',
        privateChatId: '123456789',
        username: 'buyer',
        displayName: 'خریدار',
      }),
    ).not.toThrow();
  });

  it('rejects group chats and invalid payment references', () => {
    expect(() =>
      validateTelegramCustomerInput({
        telegramUserId: '123456789',
        privateChatId: '-100123456789',
        displayName: 'خریدار',
      }),
    ).toThrow('INVALID_TELEGRAM_ID');
    expect(() => validatePaymentProofReference('', 'unique')).toThrow('INVALID_PAYMENT_PROOF');
  });
});
