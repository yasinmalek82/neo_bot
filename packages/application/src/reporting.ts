import { DomainConflictError } from '@neo-bot/domain';

import type {
  ClaimedReportingDelivery,
  ForumTopicBindings,
  ForumTopicIcon,
  ForumTopicProvisioner,
  ForumTopicStyle,
  ReportableEventInput,
  RecordedReportingEvent,
  ReportingEventType,
  ReportingPayload,
  ReportingPublisher,
  ReportingRepository,
  ReportTopicPurpose,
  ReportTransport,
} from './reporting-ports.js';
import { REPORT_TOPIC_PURPOSES, REPORTING_EVENT_TYPES } from './reporting-ports.js';

const EVENT_TYPE_SET = new Set<string>(REPORTING_EVENT_TYPES);
const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 15 * 60_000;
const FORBIDDEN_KEY =
  /(token|secret|password|api.?key|subscription|file.?id|card|sms|authorization|cookie|username)/iu;

export const REPORT_TOPIC_TITLES: Readonly<Record<ReportTopicPurpose, string>> = {
  new_users: 'کاربران جدید',
  orders: 'سفارش‌ها',
  receipts: 'رسیدها',
  sales: 'فروش موفق',
  renewals: 'تمدیدها',
  resellers: 'نمایندگان',
  errors: 'خطاها',
  daily_summaries: 'خلاصه روزانه',
};

export const REPORT_TOPIC_ICON_EMOJIS: Readonly<Record<ReportTopicPurpose, readonly string[]>> = {
  new_users: ['🪪', '👨‍👩‍👧‍👦', '👶'],
  orders: ['🛒', '🛍', '👜'],
  receipts: ['📝', '🔎', '📁'],
  sales: ['✅', '💰', '🎉'],
  renewals: ['📆', '🔝', '📈'],
  resellers: ['💼', '👑', '💰'],
  errors: ['❗️', '‼️', '🔥'],
  daily_summaries: ['📈', '📆', '📰'],
};

export const REPORT_TOPIC_ICON_COLORS: Readonly<Record<ReportTopicPurpose, number>> = {
  new_users: 7_322_096,
  orders: 16_766_590,
  receipts: 13_338_331,
  sales: 9_367_192,
  renewals: 16_766_590,
  resellers: 16_749_490,
  errors: 16_478_047,
  daily_summaries: 7_322_096,
};

export function pickReportTopicIcon(
  purpose: ReportTopicPurpose,
  stickers: readonly ForumTopicIcon[],
): string | undefined {
  for (const wanted of REPORT_TOPIC_ICON_EMOJIS[purpose]) {
    const match = stickers.find((sticker) => sticker.emoji === wanted);
    if (match !== undefined) {
      return match.customEmojiId;
    }
  }
  return undefined;
}

export const EVENT_PURPOSE: Readonly<Record<ReportingEventType, ReportTopicPurpose>> = {
  'customer.first_contact': 'new_users',
  'customer.activity': 'new_users',
  'order.created': 'orders',
  'payment.proof_submitted': 'receipts',
  'payment.approved': 'receipts',
  'payment.rejected': 'receipts',
  'provisioning.succeeded': 'sales',
  'provisioning.failed': 'errors',
  'renewal.requested': 'renewals',
  'renewal.completed': 'renewals',
  'renewal.failed': 'renewals',
  'system.failure': 'errors',
  'ops.daily_summary': 'daily_summaries',
};

export class ReportingUseCase implements ReportingPublisher {
  public constructor(
    private readonly repository: ReportingRepository,
    private readonly transport: ReportTransport | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async record(input: ReportableEventInput): Promise<RecordedReportingEvent> {
    const event = sanitizeEvent(input);
    const recorded = await this.repository.recordEvent(event);
    await this.repository.enqueueDeliveries(recorded.id);
    return recorded;
  }

  public async ensureForumTopics(
    chatId: string,
    provisioner: ForumTopicProvisioner,
    seed: ForumTopicBindings = {},
  ): Promise<void> {
    const destination = await this.repository.ensureForumDestination(chatId);
    const topics: Record<string, string> = { ...destination.topics };
    for (const purpose of REPORT_TOPIC_PURPOSES) {
      const seeded = seed[purpose];
      if (seeded === undefined || topics[purpose] === seeded) {
        continue;
      }
      await this.repository.upsertTopicBinding(destination.id, purpose, seeded);
      topics[purpose] = seeded;
    }
    const missing = REPORT_TOPIC_PURPOSES.filter((purpose) => topics[purpose] === undefined);
    const created = new Set(missing);
    if (missing.length > 0) {
      const forum = await provisioner.inspectForum(chatId);
      if (!forum.isForum) {
        throw new DomainConflictError('TELEGRAM_FORUM_DISABLED');
      }
    }
    const stickers = await loadTopicIcons(provisioner);
    for (const purpose of missing) {
      const createdTopic = await provisioner.createTopic(
        chatId,
        REPORT_TOPIC_TITLES[purpose],
        topicStyle(purpose, stickers),
      );
      await this.repository.upsertTopicBinding(
        destination.id,
        purpose,
        createdTopic.messageThreadId,
      );
      topics[purpose] = createdTopic.messageThreadId;
    }
    for (const purpose of REPORT_TOPIC_PURPOSES) {
      const threadId = topics[purpose];
      const iconCustomEmojiId = pickReportTopicIcon(purpose, stickers);
      if (created.has(purpose) || threadId === undefined || iconCustomEmojiId === undefined) {
        continue;
      }
      try {
        await provisioner.editTopicIcon(chatId, threadId, iconCustomEmojiId);
      } catch {
        // Existing topics must not block startup if Telegram rejects one icon edit.
      }
    }
  }

  public async dispatchDue(limit = 20): Promise<void> {
    await this.repository.backfillMissingDeliveries();
    const claimed = await this.repository.claimDueDeliveries(limit, this.now());
    for (const delivery of claimed) {
      await this.dispatchOne(delivery);
    }
  }

  private async dispatchOne(delivery: ClaimedReportingDelivery): Promise<void> {
    const now = this.now();
    if (delivery.messageThreadId === null) {
      await this.repository.markFailed(delivery.id, 'REPORT_TOPIC_NOT_CONFIGURED', now);
      return;
    }
    if (this.transport === null) {
      await this.repository.retryLater(
        delivery.id,
        'REPORT_TRANSPORT_UNAVAILABLE',
        nextAttemptAt(delivery.attemptCount, now),
      );
      return;
    }
    try {
      const sent = await this.transport.send({
        chatId: delivery.chatId,
        messageThreadId: delivery.messageThreadId,
        text: formatReportText(delivery.eventType, delivery.payload),
      });
      await this.repository.markDelivered(delivery.id, sent.messageId, now);
    } catch (error: unknown) {
      const code = transportErrorCode(error);
      if (!isRetryableTransportError(code) || delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        await this.repository.markFailed(delivery.id, code, now);
        return;
      }
      await this.repository.retryLater(
        delivery.id,
        code,
        nextAttemptAt(delivery.attemptCount, now),
      );
    }
  }
}

export function sanitizeEvent(input: ReportableEventInput): ReportableEventInput {
  if (!EVENT_TYPE_SET.has(input.type)) {
    throw new DomainConflictError('INVALID_REPORTING_EVENT_TYPE');
  }
  requireOccurrenceKey(input.occurrenceKey);
  return {
    type: input.type,
    occurrenceKey: input.occurrenceKey,
    payload: sanitizePayload(input.payload),
  };
}

export function formatReportText(type: ReportingEventType, payload: ReportingPayload): string {
  const telegramUserId = payload['telegramUserId'] ?? 'نامشخص';
  switch (type) {
    case 'customer.first_contact':
      return `کاربر جدید\nشناسه تلگرام: ${telegramUserId}`;
    case 'customer.activity':
      return `فعالیت کاربر بازگشتی\nشناسه تلگرام: ${telegramUserId}`;
    case 'order.created':
      return [
        'سفارش ثبت شد',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `محصول: ${payload['productName'] ?? ''} — ${payload['variantName'] ?? ''}`.trim(),
        `مبلغ: ${payload['amountIrr'] ?? 'نامشخص'} ریال`,
        `شناسه تلگرام: ${telegramUserId}`,
      ].join('\n');
    case 'payment.proof_submitted':
      return [
        'رسید ثبت شد',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `محصول: ${payload['productName'] ?? ''} — ${payload['variantName'] ?? ''}`.trim(),
        `مبلغ: ${payload['amountIrr'] ?? 'نامشخص'} ریال`,
        `شناسه تلگرام: ${telegramUserId}`,
      ].join('\n');
    case 'payment.approved':
      return [
        'رسید تأیید شد',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `ادمین: ${payload['adminTelegramUserId'] ?? 'نامشخص'}`,
      ].join('\n');
    case 'payment.rejected':
      return [
        'رسید رد شد',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `علت: ${payload['reasonCode'] ?? 'نامشخص'}`,
        `ادمین: ${payload['adminTelegramUserId'] ?? 'نامشخص'}`,
      ].join('\n');
    case 'provisioning.succeeded':
      return [
        'فروش موفق',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `سرویس داخلی: ${payload['serviceId'] ?? 'نامشخص'}`,
        `شناسه تلگرام: ${telegramUserId}`,
      ].join('\n');
    case 'provisioning.failed':
      return [
        'خطای تأمین سرویس',
        `سفارش: ${payload['orderId'] ?? 'نامشخص'}`,
        `کد: ${payload['errorCode'] ?? 'نامشخص'}`,
      ].join('\n');
    case 'renewal.requested':
      return `درخواست تمدید\nسفارش یا سرویس: ${payload['aggregateId'] ?? 'نامشخص'}`;
    case 'renewal.completed':
      return `تمدید موفق\nسرویس داخلی: ${payload['serviceId'] ?? 'نامشخص'}`;
    case 'renewal.failed':
      return `خطای تمدید\nکد: ${payload['errorCode'] ?? 'نامشخص'}`;
    case 'system.failure':
      return `خطای عملیاتی\nکد: ${payload['errorCode'] ?? 'نامشخص'}`;
    case 'ops.daily_summary':
      return [
        'خلاصه روزانه',
        `روز: ${payload['day'] ?? 'نامشخص'}`,
        `سفارش: ${payload['orderCount'] ?? '0'}`,
        `فروش: ${payload['fulfilledCount'] ?? '0'}`,
        `مبلغ: ${payload['amountIrr'] ?? '0'} ریال`,
        `خطا: ${payload['failedCount'] ?? '0'}`,
      ].join('\n');
  }
}

export function utcDateStamp(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function nextAttemptAt(attemptCount: number, now: Date): Date {
  const exponent = Math.max(attemptCount - 1, 0);
  const delay = Math.min(30_000 * 2 ** exponent, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}

function sanitizePayload(payload: ReportingPayload): ReportingPayload {
  const entries = Object.entries(payload);
  if (entries.length === 0 || entries.length > 16) {
    throw new DomainConflictError('INVALID_REPORTING_PAYLOAD');
  }
  const sanitized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/u.test(key) || FORBIDDEN_KEY.test(key)) {
      throw new DomainConflictError('FORBIDDEN_REPORTING_PAYLOAD');
    }
    if (value.length === 0 || value.length > 200 || isForbiddenValue(value)) {
      throw new DomainConflictError('FORBIDDEN_REPORTING_PAYLOAD');
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function isForbiddenValue(value: string): boolean {
  if (/https?:\/\//iu.test(value) || /t\.me\//iu.test(value)) {
    return true;
  }
  if (/^\d{5,20}:[A-Za-z0-9_-]{20,}$/u.test(value)) {
    return true;
  }
  return false;
}

function requireOccurrenceKey(value: string): void {
  if (value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new DomainConflictError('INVALID_OCCURRENCE_KEY');
  }
}

function transportErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)) {
    return error.message;
  }
  return 'REPORT_TRANSPORT_FAILED';
}

function isRetryableTransportError(code: string): boolean {
  return (
    code === 'REPORT_TRANSPORT_UNAVAILABLE' ||
    code === 'REPORT_TRANSPORT_FAILED' ||
    code === 'TELEGRAM_HTTP_429' ||
    /^TELEGRAM_HTTP_5\d{2}$/u.test(code)
  );
}

async function loadTopicIcons(
  provisioner: ForumTopicProvisioner,
): Promise<readonly ForumTopicIcon[]> {
  try {
    return await provisioner.listTopicIcons();
  } catch {
    return [];
  }
}

function topicStyle(
  purpose: ReportTopicPurpose,
  stickers: readonly ForumTopicIcon[],
): ForumTopicStyle {
  const iconCustomEmojiId = pickReportTopicIcon(purpose, stickers);
  return {
    iconColor: REPORT_TOPIC_ICON_COLORS[purpose],
    ...(iconCustomEmojiId === undefined ? {} : { iconCustomEmojiId }),
  };
}
