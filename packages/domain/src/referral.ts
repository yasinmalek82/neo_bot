import { DomainConflictError } from './errors.js';
import type { SalesOrder } from './commerce.js';

export const REFERRAL_START_PREFIX = 'r';
export const REFERRAL_CREDIT_MAX_IRR = 50_000_000n;
export const REFERRAL_MAX_REWARDS_DEFAULT = 50;
export const REFERRAL_MAX_REWARDS_LIMIT = 500;

export interface ReferralAttribution {
  readonly customerId: string;
  readonly referrerCustomerId: string;
  readonly referrerTelegramUserId: string;
  readonly inviteeDiscountOrderId: string | null;
  readonly createdAt: Date;
}

export interface ReferralReward {
  readonly referredCustomerId: string;
  readonly referrerCustomerId: string;
  readonly orderId: string;
  readonly referrerCreditIrr: bigint;
  readonly replayed: boolean;
  readonly createdAt: Date;
}

export interface ReferralInvite {
  readonly token: string;
  readonly url: string | null;
}

export function parseReferralStartPayload(raw: string): string | null {
  const match = raw.trim().match(/^r(\d{1,20})$/u);
  return match?.[1] ?? null;
}

export function buildReferralStartPayload(telegramUserId: string): string {
  requireTelegramUserId(telegramUserId);
  return `${REFERRAL_START_PREFIX}${telegramUserId}`;
}

export function buildReferralInvite(
  telegramUserId: string,
  botUsername: string | null,
): ReferralInvite {
  const token = buildReferralStartPayload(telegramUserId);
  if (botUsername === null) {
    return { token, url: null };
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(botUsername)) {
    throw new DomainConflictError('INVALID_BOT_USERNAME');
  }
  return { token, url: `https://t.me/${botUsername}?start=${token}` };
}

export function isSelfReferral(
  inviteeTelegramUserId: string,
  referrerTelegramUserId: string,
): boolean {
  return inviteeTelegramUserId === referrerTelegramUserId;
}

export function isPaidFulfillmentEligible(order: Pick<SalesOrder, 'kind' | 'status' | 'amountIrr'>): boolean {
  return order.status === 'fulfilled' && order.kind !== 'trial' && order.amountIrr > 0n;
}

export function applyInviteeCheckoutDiscount(
  priceIrr: bigint,
  discountIrr: bigint,
): { readonly amountIrr: bigint; readonly discountAppliedIrr: bigint } {
  if (priceIrr <= 0n || discountIrr <= 0n) {
    return { amountIrr: priceIrr, discountAppliedIrr: 0n };
  }
  if (priceIrr <= 1n) {
    return { amountIrr: priceIrr, discountAppliedIrr: 0n };
  }
  const applied = discountIrr >= priceIrr ? priceIrr - 1n : discountIrr;
  return { amountIrr: priceIrr - applied, discountAppliedIrr: applied };
}

export function validateReferralCreditIrr(amountIrr: bigint): bigint {
  if (amountIrr < 0n || amountIrr > REFERRAL_CREDIT_MAX_IRR) {
    throw new DomainConflictError('INVALID_REFERRAL_CREDIT');
  }
  return amountIrr;
}

export function validateReferralMaxRewards(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > REFERRAL_MAX_REWARDS_LIMIT) {
    throw new DomainConflictError('INVALID_REFERRAL_CAP');
  }
  return value;
}

export function parseNonNegativeIrr(raw: string): bigint {
  const digits = normalizeAmountDigits(raw);
  if (digits.length === 0 || digits.length > 15) {
    throw new DomainConflictError('INVALID_REFERRAL_CREDIT');
  }
  return validateReferralCreditIrr(BigInt(digits));
}

export function referralRewardIdempotencyKey(referredCustomerId: string): string {
  if (!/^\d{1,20}$/u.test(referredCustomerId)) {
    throw new DomainConflictError('INVALID_CUSTOMER_ID');
  }
  return `referral:reward:${referredCustomerId}`;
}

function requireTelegramUserId(value: string): void {
  if (!/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_TELEGRAM_ID');
  }
}

function normalizeAmountDigits(raw: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return raw
    .trim()
    .replace(/[۰-۹]/gu, (digit) => String(persian.indexOf(digit)))
    .replace(/[,٬_\s]/gu, '')
    .replace(/[^\d]/gu, '');
}
