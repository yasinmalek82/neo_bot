import { describe, expect, it, vi } from 'vitest';

import { defaultStorefrontOpsSettings, type StorefrontOpsSettings } from '@neo-bot/domain';

import type { CommercialRepository } from './commerce-ops-ports.js';
import { CommercialOpsUseCase, isLowTraffic } from './commerce-ops.js';

const settings: StorefrontOpsSettings = {
  ...defaultStorefrontOpsSettings(new Date('2026-09-05T00:00:00.000Z')),
  trialEnabled: true,
  trialVariantId: '30',
  forcedJoinChannels: [{ chatId: '@NeoShop', username: 'NeoShop' }],
};

describe('CommercialOpsUseCase', () => {
  it('refuses a second trial once a claim exists', async () => {
    const repository = createRepository();
    vi.mocked(repository.getTrialClaim).mockResolvedValue({
      customerId: '1',
      orderId: '20',
      claimedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const useCase = new CommercialOpsUseCase(repository);
    await expect(useCase.isTrialEligible('1')).resolves.toBe(false);
  });

  it('fails closed when Telegram membership cannot be read', async () => {
    const repository = createRepository();
    const useCase = new CommercialOpsUseCase(repository, {
      getMemberStatus: vi.fn().mockRejectedValue(new Error('TELEGRAM_HTTP_403')),
    });
    await expect(
      useCase.evaluateChannelGate({ telegramUserId: '10001', isAdmin: false }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
      channels: settings.forcedJoinChannels,
    });
  });

  it('lets administrators bypass the join gate', async () => {
    const repository = createRepository();
    const membership = { getMemberStatus: vi.fn() };
    const useCase = new CommercialOpsUseCase(repository, membership);
    await expect(
      useCase.evaluateChannelGate({ telegramUserId: '70001', isAdmin: true }),
    ).resolves.toMatchObject({ allowed: true, reason: 'ok' });
    expect(membership.getMemberStatus).not.toHaveBeenCalled();
  });

  it('queues a broadcast without putting the body on the reporting event', async () => {
    const repository = createRepository();
    const reporting = { record: vi.fn().mockResolvedValue({ id: '1', created: true }) };
    const useCase = new CommercialOpsUseCase(repository, null, () => new Date(), reporting);
    const job = await useCase.queueBroadcast({
      adminTelegramUserId: '70001',
      body: 'فروشگاه امشب از ساعت ۲۳ قطع است',
    });
    expect(job.bodySha256).toHaveLength(64);
    expect(reporting.record).toHaveBeenCalledWith({
      type: 'broadcast.queued',
      occurrenceKey: `broadcast:${job.id}:queued`,
      payload: {
        jobId: job.id,
        recipientCount: '2',
        bodyHash: job.bodySha256.slice(0, 16),
      },
    });
    expect(JSON.stringify(reporting.record.mock.calls[0]?.[0])).not.toContain('قطع است');
  });

  it('delivers a reminder once and never asks the transport for a subscription URL', async () => {
    const repository = createRepository();
    const send = vi.fn().mockResolvedValue(undefined);
    const useCase = new CommercialOpsUseCase(repository);
    await useCase.dispatchDueReminders(send);
    expect(send).toHaveBeenCalledWith({
      chatId: '10001',
      kind: 'expiry',
      productName: 'اقتصادی',
      variantName: 'یک‌ماهه',
      expiresAt: new Date('2026-09-08T00:00:00.000Z'),
    });
    expect(repository.markServiceReminderDelivered).toHaveBeenCalledWith(
      '9',
      expect.any(Date),
    );
    expect(JSON.stringify(send.mock.calls[0]?.[0])).not.toMatch(/https?:\/\//u);
  });

  it('treats unknown usage as not-low-traffic', () => {
    expect(isLowTraffic(100n, 90n, 15)).toBe(true);
    expect(isLowTraffic(100n, null, 15)).toBe(false);
  });
});

function createRepository(): CommercialRepository {
  return {
    getCommercialSettings: vi.fn().mockResolvedValue(settings),
    updateCommercialSettings: vi.fn().mockImplementation(async (patch) => ({
      ...settings,
      ...patch,
    })),
    createTrialOrder: vi.fn(),
    getTrialClaim: vi.fn().mockResolvedValue(null),
    listCustomerServices: vi.fn().mockResolvedValue([]),
    getServiceAccessTarget: vi.fn().mockResolvedValue(null),
    enqueueDueServiceReminders: vi.fn().mockResolvedValue(1),
    claimDueServiceReminders: vi.fn().mockResolvedValue([
      {
        id: '9',
        serviceId: '4',
        customerId: '1',
        chatId: '10001',
        kind: 'expiry',
        windowKey: '2026-09-08',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        expiresAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    ]),
    markServiceReminderDelivered: vi.fn().mockResolvedValue(true),
    retryServiceReminder: vi.fn().mockResolvedValue(true),
    failServiceReminder: vi.fn().mockResolvedValue(true),
    createBroadcastJob: vi.fn().mockResolvedValue({
      id: '11',
      adminTelegramUserId: '70001',
      body: 'فروشگاه امشب از ساعت ۲۳ قطع است',
      bodySha256: 'a'.repeat(64),
      status: 'queued',
      recipientCount: 2,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    }),
    cancelBroadcastJob: vi.fn(),
    getBroadcastJob: vi.fn(),
    listRecentBroadcastJobs: vi.fn().mockResolvedValue([]),
    claimDueBroadcastRecipients: vi.fn().mockResolvedValue([]),
    markBroadcastRecipientSent: vi.fn(),
    retryBroadcastRecipient: vi.fn(),
    failBroadcastRecipient: vi.fn(),
    setCustomerShopBlocked: vi.fn(),
    countCommercialQueues: vi.fn().mockResolvedValue({
      remindersPending: 0,
      broadcastsPending: 0,
      broadcastsRunning: 0,
    }),
  };
}
