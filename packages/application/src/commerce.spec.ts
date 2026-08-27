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
  kind: 'purchase',
  status: 'provisioning',
  serviceId: null,
  targetServiceId: null,
  serviceUsernameBase: 'buyer',
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

const sellableVariant = {
  id: '30',
  code: 'economic-30',
  productName: 'اقتصادی',
  name: 'یک‌ماهه',
  description: 'سرویس مستقیم',
  durationDays: 30,
  dataLimitBytes: 20n * 1024n ** 3n,
  deviceLimit: 1,
  priceIrr: 1_500_000n,
  pricingSource: 'public' as const,
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
      serviceUsernameBase: 'buyer',
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
        serviceUsernameBase: 'buyer',
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

  it('lists failed provisioning separately from the receipt review queue', async () => {
    const failed = { ...order, status: 'provisioning_failed' } as const;
    const repository = createRepository();
    vi.mocked(repository.listFailedProvisioning).mockResolvedValue([failed]);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(useCase.listFailedProvisioning()).resolves.toEqual([failed]);
    expect(repository.listFailedProvisioning).toHaveBeenCalledWith(10);
  });

  it('reads an active category by id for nested shop navigation', async () => {
    const category = {
      id: '10',
      code: 'economic',
      name: 'اقتصادی',
      description: 'سرویس مستقیم',
      parentId: null,
      position: 0,
    };
    const repository = createRepository();
    vi.mocked(repository.getCategory).mockResolvedValue(category);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(useCase.getCategory('10')).resolves.toEqual(category);
    expect(repository.getCategory).toHaveBeenCalledWith('10');
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
      serviceUsernameBase: 'buyer',
    });
    expect(reporting.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.approved' }),
    );
  });

  it('replays the idempotent success report for an already fulfilled provisioning retry', async () => {
    const fulfilled = { ...order, status: 'fulfilled' as const, serviceId: service.id };
    const repository = createRepository();
    vi.mocked(repository.getOrder).mockResolvedValue(fulfilled);
    const create = vi.fn();
    const renew = vi.fn();
    const reporting = { record: vi.fn().mockResolvedValue({ id: '2', created: true }) };
    const useCase = new CommerceUseCase(repository, { create, renew }, reporting);

    await expect(useCase.retryProvisioning(order.id, '70001')).resolves.toEqual(fulfilled);

    expect(create).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
    expect(reporting.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'provisioning.succeeded',
        occurrenceKey: `order:${order.id}:provisioned`,
      }),
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

  it('creates a paid renewal order and renews only after receipt approval', async () => {
    const repository = createRepository();
    const reporting = { record: vi.fn().mockResolvedValue({ id: '3', created: true }) };
    const renew = vi.fn().mockResolvedValue(service);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew }, reporting);
    const awaitingReceipt = {
      ...order,
      kind: 'renewal' as const,
      status: 'awaiting_receipt' as const,
      targetServiceId: service.id,
    };
    const provisioning = { ...awaitingReceipt, status: 'provisioning' as const };
    const fulfilled = {
      ...provisioning,
      status: 'fulfilled' as const,
      serviceId: service.id,
    };
    vi.mocked(repository.createRenewalOrder).mockResolvedValue(awaitingReceipt);
    vi.mocked(repository.reserveProvisioning).mockResolvedValue(provisioning);
    vi.mocked(repository.completeOrder).mockResolvedValue(fulfilled);

    await expect(
      useCase.beginRenewal({
        idempotencyKey: 'telegram:10001:renew:7',
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
      }),
    ).resolves.toEqual(awaitingReceipt);
    expect(repository.createRenewalOrder).toHaveBeenCalledWith(
      customer.id,
      'telegram:10001:renew:7',
      undefined,
    );
    expect(renew).not.toHaveBeenCalled();

    await expect(useCase.approveOrder(awaitingReceipt.id, '70001')).resolves.toEqual(fulfilled);
    expect(renew).toHaveBeenCalledWith({
      serviceId: service.id,
      idempotencyKey: `order:${awaitingReceipt.id}:provision`,
    });
    expect(JSON.stringify(reporting.record.mock.calls)).not.toContain('neo_order');
    expect(JSON.stringify(reporting.record.mock.calls)).not.toContain('https://');
  });

  it('reports whether the customer has a fulfilled service without exposing remotes', async () => {
    const withService = createRepository();
    const withoutService = createRepository();
    vi.mocked(withoutService.getLatestFulfilledServiceId).mockResolvedValue(null);
    const useCase = new CommerceUseCase(withService, { create: vi.fn(), renew: vi.fn() });
    const empty = new CommerceUseCase(withoutService, { create: vi.fn(), renew: vi.fn() });
    const input = {
      telegramUserId: '10001',
      privateChatId: '10001',
      displayName: 'خریدار',
    };

    await expect(useCase.hasActiveService(input)).resolves.toBe(true);
    await expect(empty.hasActiveService(input)).resolves.toBe(false);
  });

  it('lists public sellable variants when the buyer is not a representative', async () => {
    const repository = createRepository();
    vi.mocked(repository.listSellableVariants).mockResolvedValue([sellableVariant]);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.listVariantsForCustomer('10', {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual([
      { ...sellableVariant, evidenceBadge: { kind: 'value', label: 'کمترین قیمت' } },
    ]);
    expect(repository.listSellableVariants).toHaveBeenCalledWith('10');
    expect(repository.listSellableVariantsForRepresentative).toBeUndefined();
  });

  it('lists representative-priced variants when the buyer is an active representative', async () => {
    const repository = createRepository();
    const priced = {
      ...sellableVariant,
      priceIrr: 900_000n,
      pricingSource: 'representative_override' as const,
    };
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    repository.listSellableVariantsForRepresentative = vi.fn().mockResolvedValue([priced]);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.listVariantsForCustomer('10', {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual([{ ...priced, evidenceBadge: { kind: 'value', label: 'کمترین قیمت' } }]);
    expect(repository.listSellableVariantsForRepresentative).toHaveBeenCalledWith('10', '8');
    expect(repository.listSellableVariants).not.toHaveBeenCalled();
  });

  it('uses the buyer effective price when awarding a single product badge', async () => {
    const repository = createRepository();
    const lowerRepresentativePrice = {
      ...sellableVariant,
      id: '31',
      productId: '40',
      priceIrr: 900_000n,
      fulfilledSalesLast30Days: 1,
      pricingSource: 'representative_override' as const,
    };
    const moreSales = {
      ...sellableVariant,
      id: '32',
      productId: '40',
      priceIrr: 1_500_000n,
      fulfilledSalesLast30Days: 4,
    };
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    repository.listSellableVariantsForRepresentative = vi
      .fn()
      .mockResolvedValue([lowerRepresentativePrice, moreSales]);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.listVariantsForCustomer('10', {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual([
      {
        ...lowerRepresentativePrice,
        evidenceBadge: { kind: 'value', label: 'کمترین قیمت' },
      },
      { ...moreSales, evidenceBadge: { kind: 'popular', label: 'پرفروش' } },
    ]);
  });

  it('loads a representative-priced variant for checkout preview', async () => {
    const repository = createRepository();
    const priced = {
      ...sellableVariant,
      priceIrr: 1_200_000n,
      pricingSource: 'representative_base' as const,
    };
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    repository.getSellableVariantForRepresentative = vi.fn().mockResolvedValue(priced);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.getVariantForCustomer('30', {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).resolves.toEqual(priced);
    expect(repository.getSellableVariantForRepresentative).toHaveBeenCalledWith('30', '8');
    expect(repository.getSellableVariant).not.toHaveBeenCalled();
  });

  it('does not fall back to the public variant when the representative has no access', async () => {
    const repository = createRepository();
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    repository.getSellableVariantForRepresentative = vi.fn().mockResolvedValue(null);
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.getVariantForCustomer('30', {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      }),
    ).rejects.toThrow('PRODUCT_VARIANT_NOT_SELLABLE');
    expect(repository.getSellableVariant).not.toHaveBeenCalled();
  });

  it('passes the representative id into checkout so the repository can snapshot price', async () => {
    const repository = createRepository();
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.beginCheckout({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        productVariantId: '30',
        idempotencyKey: 'telegram:10:buy',
        serviceUsernameBase: 'buyer',
      }),
    ).resolves.toEqual(order);
    expect(repository.createOrder).toHaveBeenCalledWith('1', '30', 'telegram:10:buy', '8', 'buyer');
  });

  it('checks out public customers without a representative id', async () => {
    const repository = createRepository();
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.beginCheckout({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        productVariantId: '30',
        idempotencyKey: 'telegram:11:buy',
        serviceUsernameBase: 'buyer',
      }),
    ).resolves.toEqual(order);
    expect(repository.createOrder).toHaveBeenCalledWith(
      '1',
      '30',
      'telegram:11:buy',
      undefined,
      'buyer',
    );
  });

  it('publishes a reseller order notice when checkout snapshots representative pricing', async () => {
    const representativeOrder: SalesOrder = {
      ...order,
      id: '21',
      amountIrr: 900_000n,
      representativeId: '8',
      representativeCode: 'rep-a',
      pricingSource: 'representative_override',
    };
    const repository = createRepository();
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '8', code: 'rep-a' });
    vi.mocked(repository.createOrder).mockResolvedValue(representativeOrder);
    const reporting = { record: vi.fn().mockResolvedValue({ id: '4', created: true }) };
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() }, reporting);

    await expect(
      useCase.beginCheckout({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        productVariantId: '30',
        idempotencyKey: 'telegram:12:buy',
        serviceUsernameBase: 'buyer',
      }),
    ).resolves.toEqual(representativeOrder);
    expect(reporting.record).toHaveBeenCalledWith({
      type: 'reseller.order_created',
      occurrenceKey: 'reseller:order:21:created',
      payload: {
        orderId: '21',
        representativeCode: 'rep-a',
        telegramUserId: '10001',
        productName: representativeOrder.productName,
        variantName: representativeOrder.variantName,
        amountIrr: '900000',
        pricingSource: 'representative_override',
      },
    });
  });

  it('does not publish a reseller order notice for public checkout', async () => {
    const repository = createRepository();
    const reporting = { record: vi.fn().mockResolvedValue({ id: '5', created: true }) };
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() }, reporting);

    await useCase.beginCheckout({
      customer: {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      },
      productVariantId: '30',
      idempotencyKey: 'telegram:13:buy',
      serviceUsernameBase: 'buyer',
    });
    expect(reporting.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reseller.order_created' }),
    );
  });
  it('passes the stored username base to provisioning', async () => {
    const orderWithBase = { ...order, serviceUsernameBase: 'buyer' } as const;
    const fulfilled = { ...orderWithBase, status: 'fulfilled', serviceId: service.id } as const;
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValueOnce(orderWithBase);
    vi.mocked(repository.completeOrder).mockResolvedValue(fulfilled);
    const provision = vi.fn().mockResolvedValue(service);
    const useCase = new CommerceUseCase(repository, { create: provision, renew: vi.fn() });

    await useCase.approveOrder(orderWithBase.id, '70001');
    expect(provision).toHaveBeenCalledWith({
      productVariantId: orderWithBase.productVariantId,
      idempotencyKey: `order:${orderWithBase.id}:provision`,
      serviceUsernameBase: 'buyer',
    });
  });

  it('does not mislabel a fulfilled order as provisioning failure when post-completion reporting fails', async () => {
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValue({
      ...order,
      status: 'provisioning',
    });
    vi.mocked(repository.completeOrder).mockResolvedValue({
      ...order,
      status: 'fulfilled',
      serviceId: service.id,
    });
    const reporting = { record: vi.fn().mockRejectedValue(new Error('REPORTING_UNAVAILABLE')) };
    const useCase = new CommerceUseCase(
      repository,
      { create: vi.fn().mockResolvedValue(service), renew: vi.fn() },
      reporting,
    );

    await expect(useCase.approveOrder(order.id, '70001')).rejects.toThrow('REPORTING_UNAVAILABLE');
    expect(repository.markProvisioningFailed).not.toHaveBeenCalled();
    expect(reporting.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'provisioning.failed' }),
    );
  });

  it('replays the idempotent success report when an already fulfilled approval is retried', async () => {
    const fulfilled = { ...order, status: 'fulfilled' as const, serviceId: service.id };
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValue(fulfilled);
    const reporting = { record: vi.fn().mockResolvedValue({ id: '2', created: true }) };
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() }, reporting);

    await expect(useCase.approveOrder(order.id, '70001')).resolves.toEqual(fulfilled);

    expect(reporting.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'provisioning.succeeded',
        occurrenceKey: `order:${order.id}:provisioned`,
      }),
    );
  });

  it('still marks genuine provider failures as provisioning_failed', async () => {
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValue({
      ...order,
      status: 'provisioning',
    });
    const reporting = { record: vi.fn().mockResolvedValue({ id: '7', created: true }) };
    const useCase = new CommerceUseCase(
      repository,
      { create: vi.fn().mockRejectedValue(new Error('PASARGUARD_HTTP_503')), renew: vi.fn() },
      reporting,
    );

    await expect(useCase.approveOrder(order.id, '70001')).rejects.toThrow('PASARGUARD_HTTP_503');
    expect(repository.markProvisioningFailed).toHaveBeenCalledWith(order.id, 'PASARGUARD_HTTP_503');
    expect(reporting.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'provisioning.failed' }),
    );
    expect(repository.completeOrder).not.toHaveBeenCalled();
  });

  it('persists the proof media kind and retrieves the stored proof by order', async () => {
    const repository = createRepository();
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });
    await useCase.submitPaymentProof({
      customer: {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      },
      telegramFileId: 'receipt-file-id',
      telegramFileUniqueId: 'receipt-unique',
      mediaKind: 'photo',
    });
    expect(repository.submitTelegramProof).toHaveBeenCalledWith(
      customer.id,
      'receipt-file-id',
      'receipt-unique',
      'photo',
    );

    await expect(useCase.getPaymentProof(order.id)).resolves.toMatchObject({
      telegramFileId: 'file',
    });

    await expect(
      useCase.submitPaymentProof({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        telegramFileId: 'receipt-file-id',
        telegramFileUniqueId: 'receipt-unique-2',
        mediaKind: 'video' as never,
      }),
    ).rejects.toThrow('INVALID_PAYMENT_PROOF');
  });

  it('rejects checkout when the username base is invalid', async () => {
    const repository = createRepository();
    const useCase = new CommerceUseCase(repository, { create: vi.fn(), renew: vi.fn() });

    await expect(
      useCase.beginCheckout({
        customer: {
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        productVariantId: '30',
        idempotencyKey: 'telegram:99:buy',
        serviceUsernameBase: 'bad name',
      }),
    ).rejects.toThrow('INVALID_SERVICE_USERNAME_BASE');
    expect(repository.createOrder).not.toHaveBeenCalled();
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
    getCategory: vi.fn().mockResolvedValue(null),
    listSellableVariants: vi.fn().mockResolvedValue([]),
    getSellableVariant: vi.fn().mockResolvedValue(null),
    upsertTelegramCustomer: vi.fn().mockResolvedValue({ customer, created: false }),
    createOrder: vi.fn().mockResolvedValue(order),
    createRenewalOrder: vi.fn().mockResolvedValue(order),
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
    listFailedProvisioning: vi.fn().mockResolvedValue([]),
    submitTelegramProof: vi.fn().mockResolvedValue({ order, proof }),
    getPaymentProof: vi.fn().mockResolvedValue(proof),
    claimDueDeliveryJobs: vi.fn().mockResolvedValue([]),
    markDeliveryJobBrandSent: vi.fn().mockResolvedValue(true),
    markDeliveryJobAnchor: vi.fn().mockResolvedValue(true),
    markDeliveryJobDelivered: vi.fn().mockResolvedValue(true),
    retryDeliveryJob: vi.fn().mockResolvedValue(true),
    failDeliveryJob: vi.fn().mockResolvedValue(true),
    getDeliveryJobForOrder: vi.fn().mockResolvedValue(null),
    resetDeliveryJob: vi.fn().mockImplementation(() => {
      throw new Error('DELIVERY_JOB_NOT_RETRYABLE');
    }),
    backfillMissingDeliveryJobs: vi.fn().mockResolvedValue(0),
    getOrderDeliveryTarget: vi.fn().mockResolvedValue(null),
    reserveProvisioning: vi.fn().mockResolvedValue(order),
    completeOrder: vi.fn().mockResolvedValue(order),
    markProvisioningFailed: vi.fn().mockResolvedValue(order),
    rejectOrder: vi.fn().mockResolvedValue(order),
    reserveTelegramUpdate: vi.fn().mockResolvedValue(true),
    completeTelegramUpdate: vi.fn().mockResolvedValue(undefined),
    failTelegramUpdate: vi.fn().mockResolvedValue(undefined),
  };
}
