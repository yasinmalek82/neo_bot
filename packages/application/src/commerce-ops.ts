import { createHash } from 'node:crypto';

import {
  DomainConflictError,
  isActiveChatMember,
  mergeStorefrontOpsSettings,
  parseForcedJoinChannelInput,
  remainingTrafficPercent,
  validateBroadcastBody,
  validateStorefrontOpsSettingsPatch,
  type BroadcastJob,
  type CustomerServiceSummary,
  type ForcedJoinChannel,
  type ServiceReminderDelivery,
  type StorefrontOpsSettings,
  type StorefrontOpsSettingsPatch,
  type TelegramCustomer,
} from '@neo-bot/domain';

import type {
  ChannelGateDecision,
  ChatMembershipLookup,
  CommercialRepository,
} from './commerce-ops-ports.js';
import type { ReportingPublisher } from './reporting-ports.js';

const MAX_BACKOFF_MS = 15 * 60_000;

export class CommercialOpsUseCase {
  public constructor(
    private readonly repository: CommercialRepository,
    private readonly membership: ChatMembershipLookup | null = null,
    private readonly now: () => Date = () => new Date(),
    private readonly reporting: ReportingPublisher | null = null,
  ) {}

  public getSettings(): Promise<StorefrontOpsSettings> {
    return this.repository.getCommercialSettings();
  }

  public async updateSettings(patch: StorefrontOpsSettingsPatch): Promise<StorefrontOpsSettings> {
    return this.repository.updateCommercialSettings(validateStorefrontOpsSettingsPatch(patch));
  }

  public async addForcedJoinChannel(raw: string): Promise<StorefrontOpsSettings> {
    const channel = parseForcedJoinChannelInput(raw);
    const current = await this.repository.getCommercialSettings();
    const merged = mergeStorefrontOpsSettings(current, {
      forcedJoinChannels: [...current.forcedJoinChannels, channel],
    });
    return this.repository.updateCommercialSettings({
      forcedJoinChannels: merged.forcedJoinChannels,
    });
  }

  public async removeForcedJoinChannel(chatId: string): Promise<StorefrontOpsSettings> {
    const current = await this.repository.getCommercialSettings();
    return this.repository.updateCommercialSettings({
      forcedJoinChannels: current.forcedJoinChannels.filter((item) => item.chatId !== chatId),
    });
  }

  public async isTrialEligible(customerId: string): Promise<boolean> {
    const settings = await this.repository.getCommercialSettings();
    if (!settings.trialEnabled || settings.trialVariantId === null) {
      return false;
    }
    return (await this.repository.getTrialClaim(customerId)) === null;
  }

  public async evaluateChannelGate(input: {
    readonly telegramUserId: string;
    readonly isAdmin: boolean;
  }): Promise<ChannelGateDecision> {
    const settings = await this.repository.getCommercialSettings();
    const channels = settings.forcedJoinChannels;
    if (channels.length === 0 || input.isAdmin) {
      return { allowed: true, reason: 'ok', channels };
    }
    if (this.membership === null) {
      return { allowed: false, reason: 'unavailable', channels };
    }
    for (const channel of channels) {
      try {
        const member = await this.membership.getMemberStatus(channel.chatId, input.telegramUserId);
        if (!isActiveChatMember(member.status, member.isMember)) {
          return { allowed: false, reason: 'missing', channels };
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'TELEGRAM_MEMBER_NOT_FOUND') {
          return { allowed: false, reason: 'missing', channels };
        }
        return { allowed: false, reason: 'unavailable', channels };
      }
    }
    return { allowed: true, reason: 'ok', channels };
  }

  public listCustomerServices(customerId: string): Promise<readonly CustomerServiceSummary[]> {
    return this.repository.listCustomerServices(customerId);
  }

  public async requireServiceAccess(
    serviceId: string,
    customerId: string,
  ): Promise<{ readonly chatId: string; readonly subscriptionUrl: string }> {
    const target = await this.repository.getServiceAccessTarget(serviceId, customerId);
    if (target === null) {
      throw new DomainConflictError('CUSTOMER_SERVICE_NOT_FOUND');
    }
    return target;
  }

  public async dispatchDueReminders(
    send: (input: {
      readonly chatId: string;
      readonly kind: ServiceReminderDelivery['kind'];
      readonly productName: string;
      readonly variantName: string;
      readonly expiresAt: Date | null;
    }) => Promise<void>,
    limit = 10,
  ): Promise<void> {
    const settings = await this.repository.getCommercialSettings();
    if (!settings.remindersEnabled) {
      return;
    }
    await this.repository.enqueueDueServiceReminders(this.now());
    const claimed = await this.repository.claimDueServiceReminders(limit, this.now());
    for (const reminder of claimed) {
      try {
        await send({
          chatId: reminder.chatId,
          kind: reminder.kind,
          productName: reminder.productName,
          variantName: reminder.variantName,
          expiresAt: reminder.expiresAt,
        });
        await this.repository.markServiceReminderDelivered(reminder.id, this.now());
      } catch (error: unknown) {
        const code = transportErrorCode(error);
        if (!isRetryable(code)) {
          await this.repository.failServiceReminder(reminder.id, code, this.now());
        } else {
          await this.repository.retryServiceReminder(
            reminder.id,
            code,
            nextAttemptAt(1, this.now()),
          );
        }
      }
    }
  }

  public async queueBroadcast(input: {
    readonly adminTelegramUserId: string;
    readonly body: string;
  }): Promise<BroadcastJob> {
    requireTelegramUserId(input.adminTelegramUserId);
    const body = validateBroadcastBody(input.body);
    const job = await this.repository.createBroadcastJob({
      adminTelegramUserId: input.adminTelegramUserId,
      body,
      bodySha256: createHash('sha256').update(body).digest('hex'),
    });
    if (this.reporting !== null) {
      await this.reporting.record({
        type: 'broadcast.queued',
        occurrenceKey: `broadcast:${job.id}:queued`,
        payload: {
          jobId: job.id,
          recipientCount: String(job.recipientCount),
          bodyHash: job.bodySha256.slice(0, 16),
        },
      });
    }
    return job;
  }

  public async cancelBroadcast(jobId: string, adminTelegramUserId: string): Promise<BroadcastJob> {
    requireTelegramUserId(adminTelegramUserId);
    return this.repository.cancelBroadcastJob(jobId, adminTelegramUserId);
  }

  public listRecentBroadcasts(limit = 5): Promise<readonly BroadcastJob[]> {
    return this.repository.listRecentBroadcastJobs(limit);
  }

  public async dispatchDueBroadcasts(
    send: (input: { readonly chatId: string; readonly body: string }) => Promise<void>,
    limit = 15,
  ): Promise<void> {
    const claimed = await this.repository.claimDueBroadcastRecipients(limit, this.now());
    for (const recipient of claimed) {
      try {
        await send({ chatId: recipient.chatId, body: recipient.body });
        await this.repository.markBroadcastRecipientSent(recipient.id, this.now());
      } catch (error: unknown) {
        const code = transportErrorCode(error);
        if (!isRetryable(code)) {
          await this.repository.failBroadcastRecipient(recipient.id, code, this.now());
        } else {
          await this.repository.retryBroadcastRecipient(
            recipient.id,
            code,
            nextAttemptAt(1, this.now()),
          );
        }
      }
    }
  }

  public setCustomerShopBlocked(
    telegramUserId: string,
    blocked: boolean,
  ): Promise<TelegramCustomer> {
    requireTelegramUserId(telegramUserId);
    return this.repository.setCustomerShopBlocked(telegramUserId, blocked);
  }

  public countQueues(): Promise<{
    readonly remindersPending: number;
    readonly broadcastsPending: number;
    readonly broadcastsRunning: number;
  }> {
    return this.repository.countCommercialQueues();
  }
}

export function joinUrlForChannel(channel: ForcedJoinChannel): string | null {
  return channel.username === null ? null : `https://t.me/${channel.username}`;
}

export function reminderCopy(input: {
  readonly kind: ServiceReminderDelivery['kind'];
  readonly productName: string;
  readonly variantName: string;
}): { readonly title: string; readonly body: string } {
  if (input.kind === 'expiry') {
    return {
      title: 'یادآوری پایان سرویس',
      body: `سرویس ${input.productName} — ${input.variantName} به‌زودی تمام می‌شود. از منوی تمدید می‌توانی ادامه بدهی.`,
    };
  }
  return {
    title: 'حجم سرویس رو به اتمام است',
    body: `حجم باقی‌مانده سرویس ${input.productName} — ${input.variantName} کم شده. از تمدید یا خرید حجم می‌توانی استفاده کنی.`,
  };
}

export function isLowTraffic(
  dataLimitBytes: bigint,
  usedTrafficBytes: bigint | null,
  percent: number,
): boolean {
  const remaining = remainingTrafficPercent(dataLimitBytes, usedTrafficBytes);
  return remaining !== null && remaining <= percent;
}

function requireTelegramUserId(value: string): void {
  if (!/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_TELEGRAM_ID');
  }
}

function transportErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)) {
    return error.message;
  }
  return 'COMMERCIAL_TRANSPORT_FAILED';
}

function isRetryable(code: string): boolean {
  return (
    code === 'COMMERCIAL_TRANSPORT_FAILED' ||
    code === 'TELEGRAM_HTTP_429' ||
    /^TELEGRAM_HTTP_5\d{2}$/u.test(code)
  );
}

function nextAttemptAt(attemptCount: number, now: Date): Date {
  const delay = Math.min(30_000 * 2 ** Math.max(attemptCount - 1, 0), MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}
