import type {
  SalesOrder,
  ServiceBinding,
  TelegramCustomer,
  TelegramPaymentProof,
} from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { CommerceRepository } from './commerce-ports.js';
import { CommerceUseCase } from './commerce.js';

const customer: TelegramCustomer = {
  id: '1',
  telegramUserId: '10001',
  privateChatId: '10001',
  username: 'buyer',
  displayName: 'خریدار',
};

const order: SalesOrder = {
  id: '20',
  customerId: customer.id,
  productVariantId: '30',
  productName: 'اقتصادی',
  variantName: 'یک‌ماهه',
  amountIrr: 1_500_000n,
  status: 'provisioning',
  serviceId: null,
  failureCode: null,
  createdAt: new Date('2026-08-21T00:00:00.000Z'),
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
};

const service: ServiceBinding = {
  id: '40',
  productVariantId: order.productVariantId,
  providerInstanceId: '50',
  targetUserId: 60,
  targetUsername: 'neo_order',
  status: 'active',
  expiresAt: new Date('2026-09-21T00:00:00.000Z'),
  subscriptionUrl: 'https://panel.example/sub/order',
};

describe('CommerceUseCase', () => {
  it('provisions an approved order once with an order-scoped idempotency key', async () => {
    const fulfilled = { ...order, status: 'fulfilled', serviceId: service.id } as const;
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning)
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(fulfilled);
    vi.mocked(repository.completeOrder).mockResolvedValue(fulfilled);
    const provision = vi.fn().mockResolvedValue(service);
    const useCase = new CommerceUseCase(repository, { create: provision, renew: vi.fn() });

    await expect(useCase.approveOrder(order.id, '70001')).resolves.toEqual(fulfilled);
    await expect(useCase.approveOrder(order.id, '70001')).resolves.toEqual(fulfilled);
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision).toHaveBeenCalledWith({
      productVariantId: order.productVariantId,
      idempotencyKey: `order:${order.id}:provision`,
    });
  });

  it('records first contact once through the reporting publisher', async () => {
    const repository = createRepository();
    vi.mocked(repository.upsertTelegramCustomer).mockResolvedValueOnce({
      customer,
      created: true,
    });
    const reporting = { record: vi.fn().mockResolvedValue({ id: '1', created: true }) };
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() }, reporting);

    await expect(
      useCase.recordCustomerActivity({
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual({ customer, firstContact: true });
    expect(reporting.record).toHaveBeenCalledWith({
      type: 'customer.first_contact',
      occurrenceKey: 'customer:10001:first-contact',
      payload: { telegramUserId: '10001' },
    });
  });

  it('validates private chat identity before writing customer data', async () => {
    const repository = createRepository();
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.beginCheckout({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10002',
          displayName: 'خریدار',
        },
        productVariantId: '30',
        idempotencyKey: 'telegram:10:buy',
      }),
    ).rejects.toThrow('PRIVATE_CHAT_REQUIRED');
    expect(repository.upsertTelegramCustomer).not.toHaveBeenCalled();
  });

  it('reads the administrator review queue without opening a remote session', async () => {
    const repository = createRepository();
    vi.mocked(repository.listReviewQueue).mockResolvedValue([order]);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(useCase.listReviewQueue()).resolves.toEqual([order]);
    expect(repository.listReviewQueue).toHaveBeenCalledWith(10);
  });

  it('retries provisioning without recording a second payment approval', async () => {
    const failed = { ...order, status: 'provisioning_failed' } as const;
    const fulfilled = { ...order, status: 'fulfilled', serviceId: service.id } as const;
    const repository = createRepository();
    vi.mocked(repository.getOrder).mockResolvedValue(failed);
    vi.mocked(repository.completeOrder).mockResolvedValue(fulfilled);
    const provision = vi.fn().mockResolvedValue(service);
    const reporting = { record: vi.fn().mockResolvedValue({ id: '2', created: true }) };
    const useCase = new CommerceUseCase(
      repository,
      { create: provision, renew: vi.fn() },
      reporting,
    );

    await expect(useCase.retryProvisioning(order.id, '70001')).resolves.toEqual(fulfilled);
    expect(repository.reserveProvisioning).not.toHaveBeenCalled();
    expect(provision).toHaveBeenCalledWith({
      productVariantId: order.productVariantId,
      idempotencyKey: `order:${order.id}:provision`,
    });
    expect(reporting.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.approved' }),
    );
  });

  it('rejects provisioning retry for unready orders', async () => {
    const repository = createRepository();
    vi.mocked(repository.getOrder).mockResolvedValue({ ...order, status: 'awaiting_receipt' });
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(useCase.retryProvisioning(order.id, '10001')).rejects.toThrow(
      'ORDER_NOT_READY_FOR_RETRY',
    );
  });

  it('renews the latest fulfilled service without putting usernames in reports', async () => {
    const repository = createRepository();
    const reporting = { record: vi.fn().mockResolvedValue({ id: '3', created: true }) };
    const renew = vi.fn().mockResolvedValue(service);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew }, reporting);

    await expect(
      useCase.renewForCustomer({
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual(service);
    expect(renew).toHaveBeenCalledWith({
      serviceId: service.id,
      idempotencyKey: expect.stringMatching(/^renew:40:\d{4}-\d{2}-\d{2}$/u),
    });
    expect(JSON.stringify(reporting.record.mock.calls)).not.toContain('neo_order');
    expect(JSON.stringify(reporting.record.mock.calls)).not.toContain('https://');
  });
});

function createRepository(): CommerceRepository {
  const proof: TelegramPaymentProof = {
    id: '1',
    orderId: order.id,
    telegramFileId: 'file',
    telegramFileUniqueId: 'unique',
    submittedAt: new Date('2026-08-21T00:00:00.000Z'),
  };
  return {
    listCategories: vi.fn().mockResolvedValue([]),
    listSellableVariants: vi.fn().mockResolvedValue([]),
    getSellableVariant: vi.fn().mockResolvedValue(null),
    upsertTelegramCustomer: vi.fn().mockResolvedValue({ customer, created: false }),
    createOrder: vi.fn().mockResolvedValue(order),
    getOrder: vi.fn().mockResolvedValue(order),
    getCustomerForOrder: vi.fn().mockResolvedValue(customer),
    getOpenOrderForCustomer: vi.fn().mockResolvedValue(order),
    getLatestFulfilledServiceId: vi.fn().mockResolvedValue(service.id),
    summarizeUtcDay: vi.fn().mockResolvedValue({
      orderCount: '0',
      fulfilledCount: '0',
      amountIrr: '0',
      failedCount: '0',
    }),
    listReviewQueue: vi.fn().mockResolvedValue([]),
    submitTelegramProof: vi.fn().mockResolvedValue({ order, proof }),
    reserveProvisioning: vi.fn().mockResolvedValue(order),
    completeOrder: vi.fn().mockResolvedValue(order),
    markProvisioningFailed: vi.fn().mockResolvedValue(order),
    rejectOrder: vi.fn().mockResolvedValue(order),
    reserveTelegramUpdate: vi.fn().mockResolvedValue(true),
    completeTelegramUpdate: vi.fn().mockResolvedValue(undefined),
    failTelegramUpdate: vi.fn().mockResolvedValue(undefined),
  };
}
