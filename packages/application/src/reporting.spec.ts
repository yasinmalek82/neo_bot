import { DomainConflictError } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type {
  ClaimedReportingDelivery,
  ForumTopicBindings,
  RecordedReportingEvent,
  ReportableEventInput,
  ReportingRepository,
  ReportTopicPurpose,
  ReportTransport,
} from './reporting-ports.js';
import {
  formatReportText,
  pickReportTopicIcon,
  ReportingUseCase,
  sanitizeEvent,
  utcDateStamp,
  EVENT_PURPOSE,
  REPORT_TOPIC_ICON_COLORS,
  REPORT_TOPIC_TITLES,
} from './reporting.js';

describe('ReportingUseCase', () => {
  it('rejects secret-bearing payloads before persistence', () => {
    expect(() =>
      sanitizeEvent({
        type: 'provisioning.succeeded',
        occurrenceKey: 'order:3:provisioned',
        payload: { subscriptionUrl: 'https://panel.example/sub/secret' },
      }),
    ).toThrow(DomainConflictError);
    expect(() =>
      sanitizeEvent({
        type: 'payment.proof_submitted',
        occurrenceKey: 'order:3:proof:unique',
        payload: { telegramFileId: 'receipt-file-id' },
      }),
    ).toThrow(DomainConflictError);
    expect(
      formatReportText('provisioning.succeeded', {
        orderId: '3',
        serviceId: '4',
        telegramUserId: '10001',
      }),
    ).not.toMatch(/https?:\/\//u);
  });

  it('records an occurrence once and delivers after a transient retry', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('TELEGRAM_HTTP_503'))
        .mockResolvedValue({ messageId: '88' }),
    };
    const clock = { now: new Date('2026-08-21T12:00:00.000Z') };
    const reporting = new ReportingUseCase(repository, transport, () => clock.now);
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { receipts: '21' },
    });

    const event = {
      type: 'payment.proof_submitted' as const,
      occurrenceKey: 'order:3:proof:unique',
      payload: {
        orderId: '3',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        amountIrr: '1500000',
      },
    };
    const first = await reporting.record(event);
    const duplicate = await reporting.record(event);
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.created).toBe(false);

    await reporting.dispatchDue();
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(repository.deliveries[0]?.status).toBe('pending');

    clock.now = new Date('2026-08-21T12:01:00.000Z');
    const restarted = new ReportingUseCase(repository, transport, () => clock.now);
    await restarted.dispatchDue();
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(repository.deliveries[0]?.status).toBe('delivered');
    expect(repository.deliveries[0]?.telegramMessageId).toBe('88');
    await expect(reporting.countDeliveries()).resolves.toEqual({
      pending: 0,
      failed: 0,
      delivered: 1,
    });
    expect(vi.mocked(transport.send).mock.calls[1]?.[0]).toMatchObject({
      chatId: '-100123',
      messageThreadId: '21',
    });
    expect(vi.mocked(transport.send).mock.calls[1]?.[0]?.text).not.toContain('unique');
  });

  it('fails permanently when the mapped forum topic is missing', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = { send: vi.fn() };
    const reporting = new ReportingUseCase(
      repository,
      transport,
      () => new Date('2026-08-21T12:00:00.000Z'),
    );
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { orders: '9' },
    });
    await reporting.record({
      type: 'payment.proof_submitted',
      occurrenceKey: 'order:8:proof:abc',
      payload: { orderId: '8', telegramUserId: '10001' },
    });
    await reporting.dispatchDue();
    expect(transport.send).not.toHaveBeenCalled();
    expect(repository.deliveries[0]?.status).toBe('failed');
    expect(repository.deliveries[0]?.lastErrorCode).toBe('REPORT_TOPIC_NOT_CONFIGURED');
  });

  it('creates an unmapped purpose topic and retries the same notice', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = {
      send: vi.fn().mockResolvedValue({ messageId: '44' }),
    };
    const provisioner = {
      inspectForum: vi.fn().mockResolvedValue({ isForum: true }),
      listTopicIcons: vi.fn().mockResolvedValue([]),
      createTopic: vi.fn().mockImplementation(async (_chatId: string, name: string) => ({
        messageThreadId: String(80 + Object.values(REPORT_TOPIC_TITLES).indexOf(name)),
      })),
      editTopicIcon: vi.fn(),
    };
    const reporting = new ReportingUseCase(
      repository,
      transport,
      () => new Date('2026-08-21T12:00:00.000Z'),
      provisioner,
    );
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { orders: '9' },
    });
    await reporting.record({
      type: 'payment.proof_submitted',
      occurrenceKey: 'order:11:proof:abc',
      payload: { orderId: '11', telegramUserId: '10001' },
    });

    await reporting.dispatchDue();
    expect(provisioner.createTopic).toHaveBeenCalledWith(
      '-100123',
      REPORT_TOPIC_TITLES.receipts,
      expect.anything(),
    );
    expect(transport.send).not.toHaveBeenCalled();
    expect(repository.deliveries[0]?.status).toBe('pending');

    await reporting.dispatchDue();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-100123',
        messageThreadId: String(
          80 + Object.values(REPORT_TOPIC_TITLES).indexOf(REPORT_TOPIC_TITLES.receipts),
        ),
      }),
    );
    expect(repository.deliveries[0]?.status).toBe('delivered');
  });

  it('records a redacted operator failure when delivery is not retryable', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = {
      send: vi.fn().mockRejectedValue(new Error('TELEGRAM_HTTP_400')),
    };
    const reporting = new ReportingUseCase(
      repository,
      transport,
      () => new Date('2026-08-21T12:00:00.000Z'),
    );
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { receipts: '21' },
    });
    await reporting.record({
      type: 'payment.proof_submitted',
      occurrenceKey: 'order:12:proof:abc',
      payload: { orderId: '12', telegramUserId: '10001' },
    });
    await reporting.dispatchDue();
    expect(repository.deliveries[0]?.status).toBe('failed');
    const failure = repository.events.find((event) => event.type === 'system.failure');
    expect(failure?.payload).toEqual({
      errorCode: 'TELEGRAM_HTTP_400',
      purpose: 'receipts',
    });
  });

  it('clears a deleted topic, recreates it, and retries the same notice', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('TELEGRAM_TOPIC_MISSING'))
        .mockResolvedValue({ messageId: '91' }),
    };
    const provisioner = {
      inspectForum: vi.fn().mockResolvedValue({ isForum: true }),
      listTopicIcons: vi.fn().mockResolvedValue([]),
      createTopic: vi.fn().mockImplementation(async (_chatId: string, name: string) => ({
        messageThreadId: String(70 + Object.values(REPORT_TOPIC_TITLES).indexOf(name)),
      })),
      editTopicIcon: vi.fn(),
    };
    const reporting = new ReportingUseCase(
      repository,
      transport,
      () => new Date('2026-08-21T12:00:00.000Z'),
      provisioner,
    );
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { receipts: '21' },
    });
    await reporting.record({
      type: 'payment.proof_submitted',
      occurrenceKey: 'order:9:proof:abc',
      payload: { orderId: '9', telegramUserId: '10001' },
    });

    await reporting.dispatchDue();
    expect(provisioner.createTopic).toHaveBeenCalledWith(
      '-100123',
      REPORT_TOPIC_TITLES.receipts,
      expect.anything(),
    );
    expect(repository.deliveries[0]?.status).toBe('pending');
    expect(repository.deliveries[0]?.lastErrorCode).toBe('TELEGRAM_TOPIC_MISSING');
    expect(repository.events.some((event) => event.type === 'system.failure')).toBe(true);

    await reporting.dispatchDue();
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.send).mock.calls[1]?.[0]).toMatchObject({
      chatId: '-100123',
      messageThreadId: String(
        70 + Object.values(REPORT_TOPIC_TITLES).indexOf(REPORT_TOPIC_TITLES.receipts),
      ),
    });
    expect(repository.deliveries[0]?.status).toBe('delivered');
  });

  it('stamps returning-user activity by UTC day', () => {
    expect(utcDateStamp(new Date('2026-08-21T23:15:00.000Z'))).toBe('2026-08-21');
  });

  it('creates only missing forum topics and reuses stored mappings', async () => {
    const repository = new MemoryReportingRepository();
    const provisioner = {
      inspectForum: vi.fn().mockResolvedValue({ isForum: true }),
      listTopicIcons: vi.fn().mockResolvedValue([
        { customEmojiId: 'icon-cart', emoji: '🛒' },
        { customEmojiId: 'icon-note', emoji: '📝' },
      ]),
      createTopic: vi.fn().mockImplementation(async (_chatId: string, name: string) => ({
        messageThreadId: String(100 + Object.values(REPORT_TOPIC_TITLES).indexOf(name)),
      })),
      editTopicIcon: vi.fn().mockResolvedValue(undefined),
    };
    const reporting = new ReportingUseCase(repository);
    await reporting.ensureForumTopics('-100123', provisioner, { receipts: '21' });
    expect(provisioner.inspectForum).toHaveBeenCalledTimes(1);
    expect(provisioner.createTopic).toHaveBeenCalledTimes(7);
    expect(provisioner.createTopic).toHaveBeenCalledWith(
      '-100123',
      REPORT_TOPIC_TITLES.orders,
      expect.objectContaining({
        iconCustomEmojiId: 'icon-cart',
        iconColor: REPORT_TOPIC_ICON_COLORS.orders,
      }),
    );
    expect(provisioner.createTopic).not.toHaveBeenCalledWith(
      '-100123',
      REPORT_TOPIC_TITLES.receipts,
      expect.anything(),
    );
    expect(provisioner.editTopicIcon).toHaveBeenCalledWith('-100123', '21', 'icon-note');

    provisioner.createTopic.mockClear();
    provisioner.inspectForum.mockClear();
    provisioner.editTopicIcon.mockClear();
    await reporting.ensureForumTopics('-100123', provisioner);
    expect(provisioner.inspectForum).not.toHaveBeenCalled();
    expect(provisioner.createTopic).not.toHaveBeenCalled();
    expect(provisioner.editTopicIcon).toHaveBeenCalledWith('-100123', '21', 'icon-note');
  });

  it('refuses to create topics when the group is not a forum', async () => {
    const repository = new MemoryReportingRepository();
    const provisioner = {
      inspectForum: vi.fn().mockResolvedValue({ isForum: false }),
      listTopicIcons: vi.fn().mockResolvedValue([]),
      createTopic: vi.fn(),
      editTopicIcon: vi.fn(),
    };
    const reporting = new ReportingUseCase(repository);
    await expect(reporting.ensureForumTopics('-100123', provisioner)).rejects.toThrow(
      'TELEGRAM_FORUM_DISABLED',
    );
    expect(provisioner.createTopic).not.toHaveBeenCalled();
    expect(provisioner.editTopicIcon).not.toHaveBeenCalled();
  });

  it('picks the first allowed custom emoji that matches a purpose', () => {
    expect(
      pickReportTopicIcon('sales', [
        { customEmojiId: 'icon-money', emoji: '💰' },
        { customEmojiId: 'icon-ok', emoji: '✅' },
      ]),
    ).toBe('icon-ok');
  });

  it('maps reseller events to the resellers forum topic', () => {
    expect(EVENT_PURPOSE['reseller.order_created']).toBe('resellers');
    expect(EVENT_PURPOSE['reseller.assignment_updated']).toBe('resellers');
    expect(EVENT_PURPOSE['reseller.pricing_updated']).toBe('resellers');
  });

  it('formats reseller notices without leaking forbidden values', () => {
    expect(
      formatReportText('reseller.order_created', {
        orderId: '21',
        representativeCode: 'rep-a',
        telegramUserId: '10001',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        amountIrr: '900000',
        pricingSource: 'representative_override',
      }),
    ).toContain('سفارش نماینده');
    expect(
      formatReportText('reseller.assignment_updated', {
        representativeCode: 'rep-a',
        customerTelegramUserId: '10002',
        active: 'true',
      }),
    ).toContain('تخصیص نماینده');
    expect(
      formatReportText('reseller.pricing_updated', {
        representativeCode: 'rep-a',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        amountIrr: '1200000',
        pricingKind: 'base',
      }),
    ).toContain('قیمت نماینده');
  });

  it('delivers reseller notices to the resellers topic', async () => {
    const repository = new MemoryReportingRepository();
    const transport: ReportTransport = {
      send: vi.fn().mockResolvedValue({ messageId: '55' }),
    };
    const reporting = new ReportingUseCase(
      repository,
      transport,
      () => new Date('2026-08-21T12:00:00.000Z'),
    );
    await repository.replaceForumDestination({
      chatId: '-100123',
      topics: { resellers: '33' },
    });
    await reporting.record({
      type: 'reseller.order_created',
      occurrenceKey: 'reseller:order:21:created',
      payload: {
        orderId: '21',
        representativeCode: 'rep-a',
        telegramUserId: '10001',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        amountIrr: '900000',
        pricingSource: 'representative_override',
      },
    });
    await reporting.dispatchDue();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-100123',
        messageThreadId: '33',
        text: expect.stringContaining('سفارش نماینده'),
      }),
    );
  });
});

class MemoryReportingRepository implements ReportingRepository {
  public events: RecordedReportingEvent[] = [];
  public deliveries: {
    id: string;
    eventId: string;
    destinationId: string;
    status: 'pending' | 'delivered' | 'failed';
    attemptCount: number;
    nextAttemptAt: Date;
    lastErrorCode: string | null;
    telegramMessageId: string | null;
  }[] = [];
  private destination: {
    id: string;
    chatId: string;
    topics: Record<string, string>;
  } | null = null;
  private nextId = 1;

  public async recordEvent(input: ReportableEventInput): Promise<RecordedReportingEvent> {
    const existing = this.events.find((event) => event.occurrenceKey === input.occurrenceKey);
    if (existing !== undefined) {
      return { ...existing, created: false };
    }
    const recorded: RecordedReportingEvent = {
      id: String(this.nextId++),
      type: input.type,
      occurrenceKey: input.occurrenceKey,
      payload: input.payload,
      created: true,
    };
    this.events.push(recorded);
    return recorded;
  }

  public async enqueueDeliveries(eventId: string): Promise<void> {
    const event = this.events.find((item) => item.id === eventId);
    if (event === undefined || this.destination === null) {
      return;
    }
    if (this.deliveries.some((delivery) => delivery.eventId === eventId)) {
      return;
    }
    this.deliveries.push({
      id: String(this.nextId++),
      eventId,
      destinationId: this.destination.id,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(0),
      lastErrorCode: null,
      telegramMessageId: null,
    });
  }

  public async backfillMissingDeliveries(): Promise<void> {
    for (const event of this.events) {
      await this.enqueueDeliveries(event.id);
    }
  }

  public async replaceForumDestination(input: {
    readonly chatId: string;
    readonly topics: Readonly<Record<string, string | undefined>>;
  }): Promise<string> {
    const topics: Record<string, string> = {};
    for (const [purpose, threadId] of Object.entries(input.topics)) {
      if (threadId !== undefined) {
        topics[purpose] = threadId;
      }
    }
    this.destination = {
      id: this.destination?.id ?? String(this.nextId++),
      chatId: input.chatId,
      topics,
    };
    return this.destination.id;
  }

  public async ensureForumDestination(chatId: string): Promise<{
    readonly id: string;
    readonly chatId: string;
    readonly topics: ForumTopicBindings;
  }> {
    if (this.destination?.chatId !== chatId) {
      this.destination = {
        id: this.destination?.id ?? String(this.nextId++),
        chatId,
        topics: this.destination?.chatId === chatId ? this.destination.topics : {},
      };
    }
    return {
      id: this.destination.id,
      chatId: this.destination.chatId,
      topics: { ...this.destination.topics },
    };
  }

  public async upsertTopicBinding(
    destinationId: string,
    purpose: ReportTopicPurpose,
    messageThreadId: string,
  ): Promise<void> {
    if (this.destination?.id !== destinationId) {
      throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
    }
    this.destination.topics[purpose] = messageThreadId;
  }

  public async clearTopicBinding(
    destinationId: string,
    purpose: ReportTopicPurpose,
  ): Promise<void> {
    if (this.destination?.id !== destinationId) {
      return;
    }
    Reflect.deleteProperty(this.destination.topics, purpose);
  }

  public async claimDueDeliveries(
    limit: number,
    now: Date,
  ): Promise<readonly ClaimedReportingDelivery[]> {
    const claimed: ClaimedReportingDelivery[] = [];
    for (const delivery of this.deliveries) {
      if (claimed.length >= limit || this.destination === null) {
        break;
      }
      if (delivery.status !== 'pending' || delivery.nextAttemptAt > now) {
        continue;
      }
      const event = this.events.find((item) => item.id === delivery.eventId);
      if (event === undefined) {
        continue;
      }
      delivery.attemptCount += 1;
      delivery.nextAttemptAt = new Date(now.getTime() + 120_000);
      const purpose = EVENT_PURPOSE[event.type];
      claimed.push({
        id: delivery.id,
        eventId: event.id,
        eventType: event.type,
        payload: event.payload,
        purpose,
        destinationId: delivery.destinationId,
        chatId: this.destination.chatId,
        messageThreadId: this.destination.topics[purpose] ?? null,
        attemptCount: delivery.attemptCount,
      });
    }
    return claimed;
  }

  public async markDelivered(
    deliveryId: string,
    telegramMessageId: string,
    deliveredAt: Date,
  ): Promise<void> {
    void deliveredAt;
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (delivery === undefined) {
      return;
    }
    delivery.status = 'delivered';
    delivery.telegramMessageId = telegramMessageId;
    delivery.lastErrorCode = null;
  }

  public async retryLater(
    deliveryId: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (delivery === undefined) {
      return;
    }
    delivery.status = 'pending';
    delivery.lastErrorCode = errorCode;
    delivery.nextAttemptAt = nextAttemptAt;
  }

  public async markFailed(deliveryId: string, errorCode: string, failedAt: Date): Promise<void> {
    void failedAt;
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (delivery === undefined) {
      return;
    }
    delivery.status = 'failed';
    delivery.lastErrorCode = errorCode;
  }

  public async countDeliveries(): Promise<{
    readonly pending: number;
    readonly failed: number;
    readonly delivered: number;
  }> {
    let pending = 0;
    let failed = 0;
    let delivered = 0;
    for (const delivery of this.deliveries) {
      if (delivery.status === 'pending') {
        pending += 1;
      }
      if (delivery.status === 'failed') {
        failed += 1;
      }
      if (delivery.status === 'delivered') {
        delivered += 1;
      }
    }
    return { pending, failed, delivered };
  }
}
