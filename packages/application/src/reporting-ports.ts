export const REPORTING_EVENT_TYPES = [
  'customer.first_contact',
  'customer.activity',
  'order.created',
  'payment.proof_submitted',
  'payment.approved',
  'payment.rejected',
  'provisioning.succeeded',
  'provisioning.failed',
  'renewal.requested',
  'renewal.completed',
  'renewal.failed',
  'system.failure',
  'ops.daily_summary',
  'reseller.order_created',
  'reseller.assignment_updated',
  'reseller.pricing_updated',
] as const;

export type ReportingEventType = (typeof REPORTING_EVENT_TYPES)[number];

export const REPORT_TOPIC_PURPOSES = [
  'new_users',
  'orders',
  'receipts',
  'sales',
  'renewals',
  'resellers',
  'errors',
  'daily_summaries',
] as const;

export type ReportTopicPurpose = (typeof REPORT_TOPIC_PURPOSES)[number];

export type ReportingPayload = Readonly<Record<string, string>>;

export interface ReportableEventInput {
  readonly type: ReportingEventType;
  readonly occurrenceKey: string;
  readonly payload: ReportingPayload;
}

export interface RecordedReportingEvent {
  readonly id: string;
  readonly type: ReportingEventType;
  readonly occurrenceKey: string;
  readonly payload: ReportingPayload;
  readonly created: boolean;
}

export type ReportingDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface ClaimedReportingDelivery {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: ReportingEventType;
  readonly payload: ReportingPayload;
  readonly purpose: ReportTopicPurpose;
  readonly destinationId: string;
  readonly chatId: string;
  readonly messageThreadId: string | null;
  readonly attemptCount: number;
}

export interface ForumTopicBindings {
  readonly new_users?: string;
  readonly orders?: string;
  readonly receipts?: string;
  readonly sales?: string;
  readonly renewals?: string;
  readonly resellers?: string;
  readonly errors?: string;
  readonly daily_summaries?: string;
}

export interface ActiveForumDestination {
  readonly id: string;
  readonly chatId: string;
  readonly topics: ForumTopicBindings;
}

export interface ForumTopicIcon {
  readonly customEmojiId: string;
  readonly emoji: string | null;
}

export interface ForumTopicStyle {
  readonly iconCustomEmojiId?: string;
  readonly iconColor?: number;
}

export interface ForumTopicProvisioner {
  inspectForum(chatId: string): Promise<{ readonly isForum: boolean }>;
  listTopicIcons(): Promise<readonly ForumTopicIcon[]>;
  createTopic(
    chatId: string,
    name: string,
    style?: ForumTopicStyle,
  ): Promise<{ readonly messageThreadId: string }>;
  editTopicIcon(chatId: string, messageThreadId: string, iconCustomEmojiId: string): Promise<void>;
}

export interface ReportingRepository {
  recordEvent(input: ReportableEventInput): Promise<RecordedReportingEvent>;
  enqueueDeliveries(eventId: string): Promise<void>;
  backfillMissingDeliveries(): Promise<void>;
  replaceForumDestination(input: {
    readonly chatId: string;
    readonly topics: ForumTopicBindings;
  }): Promise<string>;
  ensureForumDestination(chatId: string): Promise<ActiveForumDestination>;
  upsertTopicBinding(
    destinationId: string,
    purpose: ReportTopicPurpose,
    messageThreadId: string,
  ): Promise<void>;
  clearTopicBinding(destinationId: string, purpose: ReportTopicPurpose): Promise<void>;
  claimDueDeliveries(limit: number, now: Date): Promise<readonly ClaimedReportingDelivery[]>;
  markDelivered(deliveryId: string, telegramMessageId: string, deliveredAt: Date): Promise<void>;
  retryLater(deliveryId: string, errorCode: string, nextAttemptAt: Date): Promise<void>;
  markFailed(deliveryId: string, errorCode: string, failedAt: Date): Promise<void>;
  countDeliveries(): Promise<{
    readonly pending: number;
    readonly failed: number;
    readonly delivered: number;
  }>;
}

export interface ReportTransport {
  send(input: {
    readonly chatId: string;
    readonly messageThreadId: string;
    readonly text: string;
  }): Promise<{ readonly messageId: string }>;
}

export interface ReportingPublisher {
  record(input: ReportableEventInput): Promise<RecordedReportingEvent>;
}
