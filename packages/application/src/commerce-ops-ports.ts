import type {
  BroadcastJob,
  CustomerServiceSummary,
  ForcedJoinChannel,
  ServiceReminderDelivery,
  StorefrontOpsSettings,
  StorefrontOpsSettingsPatch,
  TelegramCustomer,
  TrialClaim,
} from '@neo-bot/domain';
import type { SalesOrder } from '@neo-bot/domain';

export interface ChatMembershipLookup {
  getMemberStatus(
    chatId: string,
    telegramUserId: string,
  ): Promise<{ readonly status: string; readonly isMember?: boolean }>;
}

export interface CommercialRepository {
  getCommercialSettings(): Promise<StorefrontOpsSettings>;
  updateCommercialSettings(patch: StorefrontOpsSettingsPatch): Promise<StorefrontOpsSettings>;
  createTrialOrder(input: {
    readonly customerId: string;
    readonly idempotencyKey: string;
    readonly serviceUsernameBase: string;
  }): Promise<SalesOrder>;
  getTrialClaim(customerId: string): Promise<TrialClaim | null>;
  listCustomerServices(customerId: string): Promise<readonly CustomerServiceSummary[]>;
  getServiceAccessTarget(
    serviceId: string,
    customerId: string,
  ): Promise<{ readonly chatId: string; readonly subscriptionUrl: string } | null>;
  enqueueDueServiceReminders(now: Date): Promise<number>;
  claimDueServiceReminders(limit: number, now: Date): Promise<readonly ServiceReminderDelivery[]>;
  markServiceReminderDelivered(id: string, now: Date): Promise<boolean>;
  retryServiceReminder(id: string, errorCode: string, nextAttemptAt: Date): Promise<boolean>;
  failServiceReminder(id: string, errorCode: string, now: Date): Promise<boolean>;
  createBroadcastJob(input: {
    readonly adminTelegramUserId: string;
    readonly body: string;
    readonly bodySha256: string;
  }): Promise<BroadcastJob>;
  cancelBroadcastJob(jobId: string, adminTelegramUserId: string): Promise<BroadcastJob>;
  getBroadcastJob(jobId: string): Promise<BroadcastJob | null>;
  listRecentBroadcastJobs(limit: number): Promise<readonly BroadcastJob[]>;
  claimDueBroadcastRecipients(
    limit: number,
    now: Date,
  ): Promise<
    readonly {
      readonly id: string;
      readonly jobId: string;
      readonly chatId: string;
      readonly body: string;
    }[]
  >;
  markBroadcastRecipientSent(id: string, now: Date): Promise<boolean>;
  retryBroadcastRecipient(id: string, errorCode: string, nextAttemptAt: Date): Promise<boolean>;
  failBroadcastRecipient(id: string, errorCode: string, now: Date): Promise<boolean>;
  setCustomerShopBlocked(telegramUserId: string, blocked: boolean): Promise<TelegramCustomer>;
  countCommercialQueues(): Promise<{
    readonly remindersPending: number;
    readonly broadcastsPending: number;
    readonly broadcastsRunning: number;
  }>;
}

export interface ChannelGateDecision {
  readonly allowed: boolean;
  readonly reason: 'ok' | 'missing' | 'unavailable';
  readonly channels: readonly ForcedJoinChannel[];
}
