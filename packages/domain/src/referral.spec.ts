import { describe, expect, it } from 'vitest';

import {
  applyInviteeCheckoutDiscount,
  buildReferralInvite,
  buildReferralStartPayload,
  isPaidFulfillmentEligible,
  isSelfReferral,
  parseNonNegativeIrr,
  parseReferralStartPayload,
  referralRewardIdempotencyKey,
  validateReferralMaxRewards,
} from './referral.js';

describe('referral domain rules', () => {
  it('parses a personal start payload and rejects self-referral', () => {
    expect(parseReferralStartPayload('r70001')).toBe('70001');
    expect(parseReferralStartPayload('bonus')).toBeNull();
    expect(buildReferralStartPayload('70001')).toBe('r70001');
    expect(isSelfReferral('70001', '70001')).toBe(true);
    expect(isSelfReferral('10001', '70001')).toBe(false);
  });

  it('builds a t.me start link only when the bot username is known', () => {
    expect(buildReferralInvite('10001', 'NeoShopBot')).toEqual({
      token: 'r10001',
      url: 'https://t.me/NeoShopBot?start=r10001',
    });
    expect(buildReferralInvite('10001', null)).toEqual({ token: 'r10001', url: null });
  });

  it('rewards only a fulfilled paid purchase or renewal, never a trial', () => {
    expect(
      isPaidFulfillmentEligible({ kind: 'purchase', status: 'fulfilled', amountIrr: 150_000n }),
    ).toBe(true);
    expect(
      isPaidFulfillmentEligible({ kind: 'renewal', status: 'fulfilled', amountIrr: 150_000n }),
    ).toBe(true);
    expect(
      isPaidFulfillmentEligible({ kind: 'trial', status: 'fulfilled', amountIrr: 0n }),
    ).toBe(false);
    expect(
      isPaidFulfillmentEligible({ kind: 'purchase', status: 'provisioning', amountIrr: 150_000n }),
    ).toBe(false);
  });

  it('keeps a paid checkout amount positive after an invitee discount', () => {
    expect(applyInviteeCheckoutDiscount(100_000n, 20_000n)).toEqual({
      amountIrr: 80_000n,
      discountAppliedIrr: 20_000n,
    });
    expect(applyInviteeCheckoutDiscount(10_000n, 50_000n)).toEqual({
      amountIrr: 1n,
      discountAppliedIrr: 9_999n,
    });
    expect(applyInviteeCheckoutDiscount(1n, 5_000n)).toEqual({
      amountIrr: 1n,
      discountAppliedIrr: 0n,
    });
  });

  it('accepts a zero credit to disable wallet reward and bounds the cap', () => {
    expect(parseNonNegativeIrr('۰')).toBe(0n);
    expect(parseNonNegativeIrr('۲۵٬۰۰۰')).toBe(25_000n);
    expect(() => parseNonNegativeIrr('50000001')).toThrow('INVALID_REFERRAL_CREDIT');
    expect(validateReferralMaxRewards(20)).toBe(20);
    expect(() => validateReferralMaxRewards(0)).toThrow('INVALID_REFERRAL_CAP');
    expect(referralRewardIdempotencyKey('44')).toBe('referral:reward:44');
  });
});
