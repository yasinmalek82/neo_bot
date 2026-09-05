import { DomainConflictError } from './errors.js';
import {
  REFERRAL_MAX_REWARDS_DEFAULT,
  validateReferralCreditIrr,
  validateReferralMaxRewards,
} from './referral.js';
import type { SalesOrderStatus } from './commerce.js';

export const FORCED_JOIN_CHANNEL_LIMIT = 8;
export const BROADCAST_BODY_MAX = 3500;

export interface ForcedJoinChannel {
  readonly chatId: string;
  readonly username: string | null;
}

export interface StorefrontOpsSettings {
  readonly trialEnabled: boolean;
  readonly trialVariantId: string | null;
  readonly forcedJoinChannels: readonly ForcedJoinChannel[];
  readonly remindersEnabled: boolean;
  readonly expiryReminderDays: number;
  readonly lowTrafficPercent: number;
  readonly referralEnabled: boolean;
  readonly referralReferrerCreditIrr: bigint;
  readonly referralInviteeDiscountIrr: bigint;
  readonly referralMaxRewardsPerReferrer: number;
  readonly updatedAt: Date;
}

export interface StorefrontOpsSettingsPatch {
  readonly trialEnabled?: boolean;
  readonly trialVariantId?: string | null;
  readonly forcedJoinChannels?: readonly ForcedJoinChannel[];
  readonly remindersEnabled?: boolean;
  readonly expiryReminderDays?: number;
  readonly lowTrafficPercent?: number;
  readonly referralEnabled?: boolean;
  readonly referralReferrerCreditIrr?: bigint;
  readonly referralInviteeDiscountIrr?: bigint;
  readonly referralMaxRewardsPerReferrer?: number;
}

export const SALES_SNAPSHOT_STATUSES = [
  'awaiting_receipt',
  'receipt_submitted',
  'provisioning',
  'provisioning_failed',
  'fulfilled',
  'rejected',
  'cancelled',
] as const;

export interface AdminSalesWindowSnapshot {
  readonly ordersByStatus: Readonly<Record<SalesOrderStatus, number>>;
  readonly orderCount: number;
  readonly revenueIrr: bigint;
  readonly newCustomers: number;
}

export interface AdminSalesSnapshot {
  readonly timezone: 'Asia/Tehran';
  readonly today: AdminSalesWindowSnapshot;
  readonly last7d: AdminSalesWindowSnapshot;
  readonly openTickets: number;
  readonly pendingReceiptReviews: number;
}

export interface TrialClaim {
  readonly customerId: string;
  readonly orderId: string;
  readonly claimedAt: Date;
}

export interface CustomerServiceSummary {
  readonly id: string;
  readonly productName: string;
  readonly variantName: string;
  readonly status: string;
  readonly expiresAt: Date | null;
  readonly dataLimitBytes: bigint;
  readonly usedTrafficBytes: bigint | null;
}

export const SERVICE_REMINDER_KINDS = ['expiry', 'low_traffic'] as const;
export type ServiceReminderKind = (typeof SERVICE_REMINDER_KINDS)[number];

export interface ServiceReminderDelivery {
  readonly id: string;
  readonly serviceId: string;
  readonly customerId: string;
  readonly chatId: string;
  readonly kind: ServiceReminderKind;
  readonly windowKey: string;
  readonly productName: string;
  readonly variantName: string;
  readonly expiresAt: Date | null;
}

export const BROADCAST_JOB_STATUSES = [
  'queued',
  'running',
  'canceled',
  'completed',
  'failed',
] as const;
export type BroadcastJobStatus = (typeof BROADCAST_JOB_STATUSES)[number];

export interface BroadcastJob {
  readonly id: string;
  readonly adminTelegramUserId: string;
  readonly body: string;
  readonly bodySha256: string;
  readonly status: BroadcastJobStatus;
  readonly recipientCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly createdAt: Date;
}

export const CHAT_MEMBER_STATUSES = [
  'creator',
  'administrator',
  'member',
  'restricted',
  'left',
  'kicked',
] as const;

export type ChatMemberStatus = (typeof CHAT_MEMBER_STATUSES)[number];

export function defaultStorefrontOpsSettings(now = new Date()): StorefrontOpsSettings {
  return {
    trialEnabled: false,
    trialVariantId: null,
    forcedJoinChannels: [],
    remindersEnabled: true,
    expiryReminderDays: 3,
    lowTrafficPercent: 15,
    referralEnabled: false,
    referralReferrerCreditIrr: 0n,
    referralInviteeDiscountIrr: 0n,
    referralMaxRewardsPerReferrer: REFERRAL_MAX_REWARDS_DEFAULT,
    updatedAt: now,
  };
}

export function validateForcedJoinChannel(input: {
  readonly chatId?: string | null;
  readonly username?: string | null;
}): ForcedJoinChannel {
  const username = normalizeChannelUsername(input.username ?? undefined);
  const chatId = normalizeChannelChatId(input.chatId ?? undefined);
  if (chatId === null && username === null) {
    throw new DomainConflictError('INVALID_FORCED_JOIN_CHANNEL');
  }
  return {
    chatId: chatId ?? `@${username ?? ''}`,
    username,
  };
}

export function parseForcedJoinChannelInput(raw: string): ForcedJoinChannel {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new DomainConflictError('INVALID_FORCED_JOIN_CHANNEL');
  }
  if (/^-?\d{5,20}$/u.test(trimmed)) {
    return validateForcedJoinChannel({ chatId: trimmed });
  }
  return validateForcedJoinChannel({ username: trimmed });
}

export function validateForcedJoinChannels(
  channels: readonly ForcedJoinChannel[],
): readonly ForcedJoinChannel[] {
  if (channels.length > FORCED_JOIN_CHANNEL_LIMIT) {
    throw new DomainConflictError('INVALID_FORCED_JOIN_CHANNEL');
  }
  const seen = new Set<string>();
  const normalized: ForcedJoinChannel[] = [];
  for (const channel of channels) {
    const item = validateForcedJoinChannel(channel);
    const key = `${item.chatId}:${item.username ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

export function validateStorefrontOpsSettingsPatch(
  patch: StorefrontOpsSettingsPatch,
): StorefrontOpsSettingsPatch {
  const trialEnabled = patch.trialEnabled;
  const trialVariantId = patch.trialVariantId;
  if (
    trialVariantId !== undefined &&
    trialVariantId !== null &&
    !/^\d{1,20}$/u.test(trialVariantId)
  ) {
    throw new DomainConflictError('INVALID_TRIAL_VARIANT');
  }
  const forcedJoinChannels =
    patch.forcedJoinChannels === undefined
      ? undefined
      : validateForcedJoinChannels(patch.forcedJoinChannels);
  const remindersEnabled = patch.remindersEnabled;
  if (patch.expiryReminderDays !== undefined) {
    if (
      !Number.isInteger(patch.expiryReminderDays) ||
      patch.expiryReminderDays < 1 ||
      patch.expiryReminderDays > 30
    ) {
      throw new DomainConflictError('INVALID_REMINDER_DAYS');
    }
  }
  if (patch.lowTrafficPercent !== undefined) {
    if (
      !Number.isInteger(patch.lowTrafficPercent) ||
      patch.lowTrafficPercent < 1 ||
      patch.lowTrafficPercent > 50
    ) {
      throw new DomainConflictError('INVALID_LOW_TRAFFIC_PERCENT');
    }
  }
  return {
    ...(trialEnabled === undefined ? {} : { trialEnabled }),
    ...(trialVariantId === undefined ? {} : { trialVariantId }),
    ...(forcedJoinChannels === undefined ? {} : { forcedJoinChannels }),
    ...(remindersEnabled === undefined ? {} : { remindersEnabled }),
    ...(patch.expiryReminderDays === undefined
      ? {}
      : { expiryReminderDays: patch.expiryReminderDays }),
    ...(patch.lowTrafficPercent === undefined
      ? {}
      : { lowTrafficPercent: patch.lowTrafficPercent }),
    ...(patch.referralEnabled === undefined ? {} : { referralEnabled: patch.referralEnabled }),
    ...(patch.referralReferrerCreditIrr === undefined
      ? {}
      : { referralReferrerCreditIrr: validateReferralCreditIrr(patch.referralReferrerCreditIrr) }),
    ...(patch.referralInviteeDiscountIrr === undefined
      ? {}
      : {
          referralInviteeDiscountIrr: validateReferralCreditIrr(patch.referralInviteeDiscountIrr),
        }),
    ...(patch.referralMaxRewardsPerReferrer === undefined
      ? {}
      : {
          referralMaxRewardsPerReferrer: validateReferralMaxRewards(
            patch.referralMaxRewardsPerReferrer,
          ),
        }),
  };
}

export function mergeStorefrontOpsSettings(
  current: StorefrontOpsSettings,
  patch: StorefrontOpsSettingsPatch,
  now = new Date(),
): StorefrontOpsSettings {
  const validated = validateStorefrontOpsSettingsPatch(patch);
  return {
    trialEnabled: validated.trialEnabled ?? current.trialEnabled,
    trialVariantId:
      validated.trialVariantId === undefined ? current.trialVariantId : validated.trialVariantId,
    forcedJoinChannels: validated.forcedJoinChannels ?? current.forcedJoinChannels,
    remindersEnabled: validated.remindersEnabled ?? current.remindersEnabled,
    expiryReminderDays: validated.expiryReminderDays ?? current.expiryReminderDays,
    lowTrafficPercent: validated.lowTrafficPercent ?? current.lowTrafficPercent,
    referralEnabled: validated.referralEnabled ?? current.referralEnabled,
    referralReferrerCreditIrr:
      validated.referralReferrerCreditIrr ?? current.referralReferrerCreditIrr,
    referralInviteeDiscountIrr:
      validated.referralInviteeDiscountIrr ?? current.referralInviteeDiscountIrr,
    referralMaxRewardsPerReferrer:
      validated.referralMaxRewardsPerReferrer ?? current.referralMaxRewardsPerReferrer,
    updatedAt: now,
  };
}

export function isActiveChatMember(status: string, isMember?: boolean): boolean {
  if (status === 'creator' || status === 'administrator' || status === 'member') {
    return true;
  }
  return status === 'restricted' && isMember === true;
}

export function validateBroadcastBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > BROADCAST_BODY_MAX) {
    throw new DomainConflictError('INVALID_BROADCAST_BODY');
  }
  return trimmed;
}

export function remainingTrafficPercent(
  dataLimitBytes: bigint,
  usedTrafficBytes: bigint | null,
): number | null {
  if (dataLimitBytes <= 0n || usedTrafficBytes === null || usedTrafficBytes < 0n) {
    return null;
  }
  if (usedTrafficBytes >= dataLimitBytes) {
    return 0;
  }
  return Number(((dataLimitBytes - usedTrafficBytes) * 100n) / dataLimitBytes);
}

function normalizeChannelUsername(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim().replace(/^@/u, '');
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(trimmed)) {
    throw new DomainConflictError('INVALID_FORCED_JOIN_CHANNEL');
  }
  return trimmed;
}

function normalizeChannelChatId(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^-?\d{5,20}$/u.test(trimmed)) {
    throw new DomainConflictError('INVALID_FORCED_JOIN_CHANNEL');
  }
  return trimmed;
}
