import { describe, expect, it, vi } from 'vitest';

import type { SalesOrder } from '@neo-bot/domain';

import { ReferralUseCase } from './referral.js';

const paidOrder = {
  id: '30',
  customerId: '2',
  productVariantId: '9',
  productName: 'اقتصادی',
  variantName: 'یک‌ماهه',
  amountIrr: 150_000n,
  kind: 'purchase',
  status: 'fulfilled',
  serviceId: '4',
  targetServiceId: null,
  serviceUsernameBase: null,
  failureCode: null,
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  updatedAt: new Date('2026-09-05T00:00:00.000Z'),
} as const satisfies SalesOrder;

describe('ReferralUseCase', () => {
  it('ignores self-referral and unknown start payloads before touching storage', async () => {
    const attributeReferralStart = vi.fn();
    const useCase = new ReferralUseCase({
      attributeReferralStart,
      getReferralAttribution: vi.fn(),
      grantReferralRewardForPaidOrder: vi.fn(),
    });
    await expect(
      useCase.attributeStart({
        customer: { telegramUserId: '10001' },
        customerId: '2',
        payload: 'r10001',
      }),
    ).resolves.toBeNull();
    await expect(
      useCase.attributeStart({
        customer: { telegramUserId: '10001' },
        customerId: '2',
        payload: 'welcome',
      }),
    ).resolves.toBeNull();
    expect(attributeReferralStart).not.toHaveBeenCalled();
  });

  it('attributes a personal start payload once', async () => {
    const attribution = {
      customerId: '2',
      referrerCustomerId: '1',
      referrerTelegramUserId: '70001',
      inviteeDiscountOrderId: null,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    };
    const useCase = new ReferralUseCase({
      attributeReferralStart: vi.fn().mockResolvedValue(attribution),
      getReferralAttribution: vi.fn(),
      grantReferralRewardForPaidOrder: vi.fn(),
    });
    await expect(
      useCase.attributeStart({
        customer: { telegramUserId: '10001' },
        customerId: '2',
        payload: 'r70001',
      }),
    ).resolves.toEqual(attribution);
  });

  it('does not reward a trial fulfillment', async () => {
    const grantReferralRewardForPaidOrder = vi.fn();
    const useCase = new ReferralUseCase({
      attributeReferralStart: vi.fn(),
      getReferralAttribution: vi.fn(),
      grantReferralRewardForPaidOrder,
    });
    await expect(
      useCase.grantForFulfilledPaidOrder({
        ...paidOrder,
        kind: 'trial',
        amountIrr: 0n,
      }),
    ).resolves.toBeNull();
    expect(grantReferralRewardForPaidOrder).not.toHaveBeenCalled();
  });

  it('credits the first paid fulfillment once and reports counts only', async () => {
    const reporting = { record: vi.fn().mockResolvedValue({ id: '1', created: true }) };
    const grantReferralRewardForPaidOrder = vi.fn().mockResolvedValue({
      referredCustomerId: '2',
      referrerCustomerId: '1',
      orderId: paidOrder.id,
      referrerCreditIrr: 25_000n,
      replayed: false,
      createdAt: paidOrder.updatedAt,
    });
    const useCase = new ReferralUseCase(
      {
        attributeReferralStart: vi.fn(),
        getReferralAttribution: vi.fn(),
        grantReferralRewardForPaidOrder,
      },
      reporting,
    );
    await expect(useCase.grantForFulfilledPaidOrder(paidOrder)).resolves.toMatchObject({
      replayed: false,
      referrerCreditIrr: 25_000n,
    });
    expect(reporting.record).toHaveBeenCalledWith({
      type: 'referral.rewarded',
      occurrenceKey: 'referral:reward:2',
      payload: {
        orderId: '30',
        referrerCustomerId: '1',
        referredCustomerId: '2',
        creditIrr: '25000',
        replayed: 'false',
      },
    });
  });
});
