import {
  buildReferralInvite,
  isPaidFulfillmentEligible,
  isSelfReferral,
  parseReferralStartPayload,
  type ReferralAttribution,
  type ReferralInvite,
  type ReferralReward,
  type SalesOrder,
  type TelegramCustomerInput,
} from '@neo-bot/domain';

import type { ReportingPublisher } from './reporting-ports.js';

export interface ReferralRepository {
  attributeReferralStart(input: {
    readonly customerId: string;
    readonly inviteeTelegramUserId: string;
    readonly referrerTelegramUserId: string;
  }): Promise<ReferralAttribution | null>;
  getReferralAttribution(customerId: string): Promise<ReferralAttribution | null>;
  grantReferralRewardForPaidOrder(order: SalesOrder): Promise<ReferralReward | null>;
}

export class ReferralUseCase {
  public constructor(
    private readonly repository: ReferralRepository,
    private readonly reporting: ReportingPublisher | null = null,
  ) {}

  public inviteFor(telegramUserId: string, botUsername: string | null): ReferralInvite {
    return buildReferralInvite(telegramUserId, botUsername);
  }

  public async attributeStart(input: {
    readonly customer: Pick<TelegramCustomerInput, 'telegramUserId'> & { readonly id?: string };
    readonly customerId: string;
    readonly payload: string;
  }): Promise<ReferralAttribution | null> {
    const referrerTelegramUserId = parseReferralStartPayload(input.payload);
    if (referrerTelegramUserId === null) {
      return null;
    }
    if (isSelfReferral(input.customer.telegramUserId, referrerTelegramUserId)) {
      return null;
    }
    return this.repository.attributeReferralStart({
      customerId: input.customerId,
      inviteeTelegramUserId: input.customer.telegramUserId,
      referrerTelegramUserId,
    });
  }

  public async grantForFulfilledPaidOrder(order: SalesOrder): Promise<ReferralReward | null> {
    if (!isPaidFulfillmentEligible(order)) {
      return null;
    }
    const reward = await this.repository.grantReferralRewardForPaidOrder(order);
    if (reward === null || this.reporting === null) {
      return reward;
    }
    await this.reporting.record({
      type: 'referral.rewarded',
      occurrenceKey: `referral:reward:${reward.referredCustomerId}`,
      payload: {
        orderId: reward.orderId,
        referrerCustomerId: reward.referrerCustomerId,
        referredCustomerId: reward.referredCustomerId,
        creditIrr: reward.referrerCreditIrr.toString(),
        replayed: reward.replayed ? 'true' : 'false',
      },
    });
    return reward;
  }
}
