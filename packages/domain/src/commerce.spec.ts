import { describe, expect, it } from 'vitest';

import {
  resolveRepresentativePrice,
  validatePaymentProofReference,
  validateTelegramCustomerInput,
} from './commerce.js';

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

  it('resolves representative prices as override, then base, then public', () => {
    expect(
      resolveRepresentativePrice({
        publicPriceIrr: 1_500_000n,
        representativeBasePriceIrr: 1_200_000n,
        representativeOverridePriceIrr: 900_000n,
      }),
    ).toEqual({ priceIrr: 900_000n, pricingSource: 'representative_override' });
    expect(
      resolveRepresentativePrice({
        publicPriceIrr: 1_500_000n,
        representativeBasePriceIrr: 1_200_000n,
        representativeOverridePriceIrr: null,
      }),
    ).toEqual({ priceIrr: 1_200_000n, pricingSource: 'representative_base' });
    expect(
      resolveRepresentativePrice({
        publicPriceIrr: 1_500_000n,
        representativeBasePriceIrr: null,
        representativeOverridePriceIrr: null,
      }),
    ).toEqual({ priceIrr: 1_500_000n, pricingSource: 'public' });
  });

  it('rejects non-positive prices before a source is chosen', () => {
    expect(() =>
      resolveRepresentativePrice({
        publicPriceIrr: 0n,
        representativeBasePriceIrr: null,
        representativeOverridePriceIrr: null,
      }),
    ).toThrow('INVALID_PRICE');
    expect(() =>
      resolveRepresentativePrice({
        publicPriceIrr: 1_500_000n,
        representativeBasePriceIrr: -1n,
        representativeOverridePriceIrr: null,
      }),
    ).toThrow('INVALID_PRICE');
  });
});
