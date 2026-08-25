import { DomainConflictError } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { CommerceRepository } from './commerce-ports.js';
import { CustomerDeliveryUseCase, type CustomerDeliveryTransport } from './customer-delivery.js';

const fixedNow = () => new Date('2026-08-21T00:00:00.000Z');

const baseJob = {
  id: '9',
  orderId: '3',
  customerId: '1',
  serviceId: '4',
  stage: 'pending_brand_media',
  attemptCount: 1,
  telegramMessageId: null,
} as const;

function createRepository(): CommerceRepository {
  return {
    claimDueDeliveryJobs: vi.fn().mockResolvedValue([]),
    markDeliveryJobBrandSent: vi.fn().mockResolvedValue(undefined),
    markDeliveryJobAnchor: vi.fn().mockResolvedValue(undefined),
    markDeliveryJobDelivered: vi.fn().mockResolvedValue(undefined),
    retryDeliveryJob: vi.fn().mockResolvedValue(undefined),
    failDeliveryJob: vi.fn().mockResolvedValue(undefined),
    getDeliveryJobForOrder: vi.fn().mockResolvedValue(null),
    resetDeliveryJob: vi.fn().mockResolvedValue(null),
    backfillMissingDeliveryJobs: vi.fn().mockResolvedValue(0),
    getOrderDeliveryTarget: vi
      .fn()
      .mockResolvedValue({ chatId: '10001', subscriptionUrl: 'https://panel.example/sub/order' }),
  } as unknown as CommerceRepository;
}

function createTransport(
  overrides: Partial<CustomerDeliveryTransport> = {},
): CustomerDeliveryTransport & {
  readonly sendBrandPhoto: ReturnType<typeof vi.fn>;
  readonly sendAnchorMessage: ReturnType<typeof vi.fn>;
  readonly editMessageText: ReturnType<typeof vi.fn>;
} {
  const transport = {
    sendBrandPhoto: vi.fn().mockResolvedValue(false),
    sendAnchorMessage: vi.fn().mockResolvedValue({ messageId: '55' }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return transport as never;
}

describe('CustomerDeliveryUseCase', () => {
  it('walks the staged anchor flow once and stores no subscription URL on the job', async () => {
    const repository = createRepository();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([{ ...baseJob }]);
    const transport = createTransport({ sendBrandPhoto: vi.fn().mockResolvedValue(true) });
    const useCase = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);

    await useCase.dispatchDue();

    expect(transport.sendBrandPhoto).toHaveBeenCalledWith('10001');
    expect(repository.markDeliveryJobBrandSent).toHaveBeenCalledWith('9', fixedNow());
    expect(transport.sendAnchorMessage).toHaveBeenCalledTimes(1);
    expect(repository.markDeliveryJobAnchor).toHaveBeenCalledWith('9', '55', fixedNow());
    expect(transport.editMessageText).toHaveBeenCalledWith(
      '10001',
      '55',
      expect.stringContaining('https://panel.example/sub/order'),
    );
    expect(repository.markDeliveryJobDelivered).toHaveBeenCalledWith('9', fixedNow());
  });

  it('keeps unconfigured optional brand media observable-free but non-blocking', async () => {
    const repository = createRepository();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([{ ...baseJob }]);
    const transport = createTransport();
    const useCase = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);

    await useCase.dispatchDue();

    expect(transport.sendBrandPhoto).toHaveBeenCalledTimes(1);
    expect(repository.markDeliveryJobBrandSent).toHaveBeenCalled();
    expect(repository.retryDeliveryJob).not.toHaveBeenCalled();
    expect(transport.editMessageText).toHaveBeenCalledTimes(1);
  });

  it('records a brand-media Telegram failure as retryable without touching the link stage', async () => {
    const repository = createRepository();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([{ ...baseJob }]);
    const transport = createTransport({
      sendBrandPhoto: vi.fn().mockRejectedValue(new Error('TELEGRAM_HTTP_500')),
    });
    const useCase = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);

    await useCase.dispatchDue();

    expect(repository.retryDeliveryJob).toHaveBeenCalledWith(
      '9',
      'TELEGRAM_HTTP_500',
      expect.any(Date),
      fixedNow(),
    );
    expect(repository.failDeliveryJob).not.toHaveBeenCalled();
    expect(transport.sendAnchorMessage).not.toHaveBeenCalled();
  });

  it('fails the job definitively when attempts are exhausted or the target is missing', async () => {
    const repository = createRepository();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([{ ...baseJob, attemptCount: 8 }]);
    const transport = createTransport({
      sendBrandPhoto: vi.fn().mockRejectedValue(new Error('TELEGRAM_HTTP_429')),
    });
    const exhausted = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);
    await exhausted.dispatchDue();
    expect(repository.failDeliveryJob).toHaveBeenCalledWith('9', 'TELEGRAM_HTTP_429', fixedNow());

    vi.mocked(repository.getOrderDeliveryTarget).mockResolvedValue(null);
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([
      { ...baseJob, stage: 'pending_link', telegramMessageId: '77' },
    ]);
    const missingTarget = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);
    await missingTarget.dispatchDue();
    expect(repository.failDeliveryJob).toHaveBeenCalledWith(
      '9',
      'DELIVERY_TARGET_MISSING',
      fixedNow(),
    );
  });

  it('treats an unchanged replayed edit as successful delivery after a simulated crash', async () => {
    const repository = createRepository();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([
      { ...baseJob, stage: 'pending_link', telegramMessageId: '55' },
    ]);
    const transport = createTransport({
      editMessageText: vi.fn().mockRejectedValue(new Error('TELEGRAM_MESSAGE_UNCHANGED')),
    });
    const useCase = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);

    await useCase.dispatchDue();

    expect(repository.markDeliveryJobDelivered).toHaveBeenCalledWith('9', fixedNow());
    expect(repository.retryDeliveryJob).not.toHaveBeenCalled();
    expect(transport.sendAnchorMessage).not.toHaveBeenCalled();
  });

  it('allows one duplicated non-secret anchor after a crash before the anchor was persisted', async () => {
    const repository = createRepository();
    let dispatches = 0;
    vi.mocked(repository.claimDueDeliveryJobs).mockImplementation(async () => {
      dispatches += 1;
      return dispatches === 1 ? [{ ...baseJob }] : [];
    });
    const transport = createTransport();
    const useCase = new CustomerDeliveryUseCase(repository, transport, serviceText, fixedNow);

    // First dispatch crashes right after the anchor was sent to Telegram but before
    // the repository persisted its message id.
    vi.mocked(repository.markDeliveryJobAnchor).mockRejectedValueOnce(
      new DomainConflictError('SIMULATED_CRASH'),
    );
    await useCase.dispatchDue();
    expect(transport.sendAnchorMessage).toHaveBeenCalledTimes(1);
    expect(repository.retryDeliveryJob).toHaveBeenCalledWith(
      '9',
      'SIMULATED_CRASH',
      expect.any(Date),
      fixedNow(),
    );

    // Replay: the job is claimed again with no stored message id, so a second anchor
    // may be created (duplicated non-secret placeholder), which is then completed.
    vi.mocked(repository.markDeliveryJobAnchor).mockResolvedValue();
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([
      { ...baseJob, telegramMessageId: null },
    ]);
    await useCase.dispatchDue();
    expect(transport.sendAnchorMessage).toHaveBeenCalledTimes(2);
    expect(repository.markDeliveryJobDelivered).toHaveBeenCalled();
  });

  it('resets only non-delivered jobs for administrator retry', async () => {
    const repository = createRepository();
    const resetJob = {
      id: '9',
      orderId: '3',
      customerId: '1',
      serviceId: '4',
      stage: 'pending_link',
      attemptCount: 0,
      nextAttemptAt: fixedNow(),
      lastErrorCode: null,
      telegramMessageId: '77',
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
    } as const;
    vi.mocked(repository.getDeliveryJobForOrder).mockResolvedValue({
      ...resetJob,
      stage: 'failed',
      attemptCount: 8,
      lastErrorCode: 'BRAND_MEDIA_FAILED',
      telegramMessageId: '77',
    });
    vi.mocked(repository.resetDeliveryJob).mockResolvedValue(resetJob);
    const useCase = new CustomerDeliveryUseCase(
      repository,
      createTransport(),
      serviceText,
      fixedNow,
    );

    await expect(useCase.resetForOrder('3')).resolves.toMatchObject({ stage: 'pending_link' });
    expect(repository.resetDeliveryJob).toHaveBeenCalledWith('3', fixedNow());

    vi.mocked(repository.getDeliveryJobForOrder).mockResolvedValue({
      ...resetJob,
      stage: 'delivered',
    });
    await expect(useCase.resetForOrder('3')).rejects.toThrow('DELIVERY_ALREADY_COMPLETED');

    vi.mocked(repository.getDeliveryJobForOrder).mockResolvedValue(null);
    await expect(useCase.resetForOrder('3')).rejects.toThrow('DELIVERY_JOB_NOT_FOUND');
  });
});

function serviceText(subscriptionUrl: string): string {
  return `لینک اشتراک: ${subscriptionUrl}`;
}
