import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CatalogAdminUseCase, CommerceUseCase, ReportingUseCase } from '@neo-bot/application';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresCommerceRepository } from './commerce-repository.js';
import { PostgresCatalogRepository } from './catalog-repository.js';
import { migrate } from './migrator.js';
import { createDatabasePool } from './pool.js';
import { PostgresReportingRepository } from './reporting-repository.js';
import { PostgresProvisioningRepository } from './repository.js';

describe('PostgresProvisioningRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let repository: PostgresProvisioningRepository;
  let commerceRepository: PostgresCommerceRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = createDatabasePool({ connectionString: container.getConnectionUri() });
    await migrate(pool);
    repository = new PostgresProvisioningRepository(pool);
    commerceRepository = new PostgresCommerceRepository(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('tracks removed groups and persists an idempotent create/renew lifecycle', async () => {
    const providerId = await repository.upsertProviderInstance(
      'integration-provider',
      'https://panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [
        { id: 10, name: 'Pilot', disabled: false, inboundTags: ['pilot'] },
        { id: 11, name: 'Removed later', disabled: false, inboundTags: [] },
      ],
      new Date('2026-08-20T00:00:00.000Z'),
    );
    expect(await repository.groupsExist(providerId, [10, 11])).toBe(true);

    await repository.replaceGroupSnapshots(
      providerId,
      [{ id: 10, name: 'Pilot', disabled: false, inboundTags: ['pilot'] }],
      new Date('2026-08-20T00:01:00.000Z'),
    );
    expect(await repository.groupsExist(providerId, [11])).toBe(false);

    const variantId = await repository.upsertPilotVariant({
      providerInstanceId: providerId,
      code: 'integration-direct-variant',
      name: 'Integration direct variant',
      groupIds: [10],
      durationDays: 30,
      dataLimitBytes: 10_737_418_240n,
      deviceLimit: 1,
    });
    const variant = await repository.getProductVariant(variantId);
    expect(variant?.groupIds).toEqual([10]);

    const createHash = '1'.repeat(64);
    const firstReservation = await repository.reserveOperation('create', 'update-1', createHash);
    const duplicateReservation = await repository.reserveOperation(
      'create',
      'update-1',
      createHash,
    );
    expect(duplicateReservation.operation.id).toBe(firstReservation.operation.id);

    const service = await repository.completeCreate(firstReservation.operation.id, variant!, {
      id: 900719,
      username: 'neo_integration',
      status: 'active',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
      subscriptionUrl: 'https://panel.example.test/sub/integration',
    });
    expect(service.targetUserId).toBe(900719);

    const renew = await repository.reserveOperation(
      'renew',
      'update-2',
      '2'.repeat(64),
      service.id,
    );
    const renewed = await repository.completeRenew(renew.operation.id, service.id, {
      status: 'active',
      expiresAt: new Date('2026-10-19T00:00:00.000Z'),
      subscriptionUrl: 'https://panel.example.test/sub/integration',
    });
    expect(renewed.expiresAt?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('persists an idempotent card-to-card checkout and fulfillment lifecycle', async () => {
    const providerId = await repository.upsertProviderInstance(
      'commerce-provider',
      'https://commerce-panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [{ id: 20, name: 'Commerce pilot', disabled: false, inboundTags: ['commerce'] }],
      new Date('2026-08-21T00:00:00.000Z'),
    );
    const variantId = await repository.upsertPilotVariant({
      providerInstanceId: providerId,
      code: 'commerce-direct-variant',
      name: 'اقتصادی یک‌ماهه',
      groupIds: [20],
      durationDays: 30,
      dataLimitBytes: 20n * 1024n ** 3n,
      deviceLimit: 1,
    });
    const categoryId = await commerceRepository.upsertCategory({
      code: 'economic',
      name: 'اقتصادی',
      description: 'سرویس مستقیم و ساده',
    });
    await commerceRepository.assignProductToCategory(categoryId, 'pilot-direct');
    await commerceRepository.configureVariantForSale({
      variantCode: 'commerce-direct-variant',
      priceIrr: 1_500_000n,
      description: '۳۰ روز، ۲۰ گیگابایت',
    });

    expect(await commerceRepository.listCategories(null)).toMatchObject([
      { id: categoryId, code: 'economic' },
    ]);
    expect(await commerceRepository.listSellableVariants(categoryId)).toMatchObject([
      { id: variantId, priceIrr: 1_500_000n },
    ]);

    const variant = await repository.getProductVariant(variantId);
    const serviceOperation = await repository.reserveOperation(
      'create',
      'commerce-service',
      '3'.repeat(64),
    );
    const service = await repository.completeCreate(serviceOperation.operation.id, variant!, {
      id: 900_720,
      username: 'neo_commerce',
      status: 'active',
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      subscriptionUrl: 'https://commerce-panel.example.test/sub/integration',
    });
    let provisionCalls = 0;
    const useCase = new CommerceUseCase(commerceRepository, {
      create: async () => {
        provisionCalls += 1;
        return service;
      },
      renew: async () => service,
    });
    const customer = {
      telegramUserId: '10001',
      privateChatId: '10001',
      username: 'buyer',
      displayName: 'خریدار آزمایشی',
    } as const;
    const order = await useCase.beginCheckout({
      customer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:100:buy',
    });
    const duplicateOrder = await useCase.beginCheckout({
      customer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:100:buy',
    });
    expect(duplicateOrder.id).toBe(order.id);
    expect(order.amountIrr).toBe(1_500_000n);

    const submitted = await useCase.submitPaymentProof({
      customer,
      telegramFileId: 'telegram-file-sensitive-reference',
      telegramFileUniqueId: 'unique-proof-1',
    });
    const duplicateProof = await useCase.submitPaymentProof({
      customer,
      telegramFileId: 'telegram-file-sensitive-reference',
      telegramFileUniqueId: 'unique-proof-1',
    });
    expect(submitted.status).toBe('receipt_submitted');
    expect(duplicateProof.id).toBe(order.id);

    const fulfilled = await useCase.approveOrder(order.id, '70001');
    const duplicateApproval = await useCase.approveOrder(order.id, '70001');
    expect(fulfilled.status).toBe('fulfilled');
    expect(duplicateApproval.serviceId).toBe(service.id);
    expect(provisionCalls).toBe(1);

    expect(await commerceRepository.reserveTelegramUpdate('500')).toBe(true);
    await commerceRepository.completeTelegramUpdate('500');
    expect(await commerceRepository.reserveTelegramUpdate('500')).toBe(false);
    expect(await commerceRepository.reserveTelegramUpdate('501')).toBe(true);
    await commerceRepository.failTelegramUpdate('501', 'TEMPORARY_FAILURE');
    expect(await commerceRepository.reserveTelegramUpdate('501')).toBe(true);
  });

  it('publishes an arbitrary catalog matrix atomically for the Mini App', async () => {
    const providerId = await repository.upsertProviderInstance(
      'catalog-provider',
      'https://catalog-panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [
        { id: 31, name: 'Tunnel entry', disabled: false, inboundTags: ['entry'] },
        { id: 32, name: 'Tunnel exit', disabled: false, inboundTags: ['exit'] },
      ],
      new Date('2026-08-21T01:00:00.000Z'),
    );
    const catalog = new CatalogAdminUseCase(new PostgresCatalogRepository(pool));
    await catalog.replaceCatalog({
      settings: {
        brandName: 'نئوبات',
        heroTitle: 'انتخاب سرویس',
        heroSubtitle: 'کاتالوگ پویا',
        deliveryNote: 'تحویل سریع',
        supportNote: 'پشتیبانی',
        volumeHelper: 'حجم مشترک است.',
        cardNumber: '0000000000000000',
        cardHolder: 'مدیر آزمایشی',
      },
      products: [
        {
          code: 'dynamic-special',
          name: 'ویژه',
          shortName: 'ویژه',
          description: 'مسیر تونل',
          badge: 'جدید',
          iconKey: 'star',
          position: 0,
          active: true,
          category: { code: 'dynamic', name: 'پویا', description: '', position: 0 },
          variants: [
            {
              code: 'dynamic-special-75gb-45d',
              name: '۷۵ گیگ، ۴۵ روزه',
              description: 'ترکیب آزمایشی',
              durationDays: 45,
              durationLabel: '۴۵ روزه',
              dataLimitBytes: 75n * 1024n ** 3n,
              dataLimitLabel: '۷۵ گیگ',
              deviceLimit: 3,
              deviceLabel: 'سه اتصال',
              priceIrr: 1_250_000n,
              position: 0,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [31, 32],
            },
          ],
        },
      ],
    });

    const published = await catalog.getPublicCatalog();
    expect(published.products).toMatchObject([
      {
        code: 'dynamic-special',
        variants: [
          {
            durationDays: 45,
            dataLimitBytes: 75n * 1024n ** 3n,
            deviceLimit: 3,
            priceIrr: 1_250_000n,
            groupIds: [31, 32],
          },
        ],
      },
    ]);
  });

  it('persists first contact and delivers a receipt report once after retry and restart', async () => {
    const reportingRepository = new PostgresReportingRepository(pool);
    await reportingRepository.replaceForumDestination({
      chatId: '-1001234567890',
      topics: {
        new_users: '11',
        orders: '12',
        receipts: '13',
        sales: '14',
        errors: '16',
      },
    });
    const sent: string[] = [];
    let receiptAttempts = 0;
    const transport = {
      send: async (input: { readonly text: string; readonly messageThreadId: string }) => {
        if (input.messageThreadId === '13') {
          receiptAttempts += 1;
          if (receiptAttempts === 1) {
            throw new Error('TELEGRAM_HTTP_503');
          }
        }
        sent.push(`${input.messageThreadId}:${input.text}`);
        return { messageId: String(900 + sent.length) };
      },
    };
    let now = new Date('2026-08-21T12:00:00.000Z');
    const reporting = new ReportingUseCase(reportingRepository, transport, () => now);
    const providerId = await repository.upsertProviderInstance(
      'reporting-provider',
      'https://reporting-panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [{ id: 40, name: 'Reporting', disabled: false, inboundTags: ['report'] }],
      new Date('2026-08-21T12:00:00.000Z'),
    );
    const variantId = await repository.upsertPilotVariant({
      providerInstanceId: providerId,
      code: 'reporting-direct-variant',
      name: 'گزارش یک‌ماهه',
      groupIds: [40],
      durationDays: 30,
      dataLimitBytes: 10n * 1024n ** 3n,
      deviceLimit: 1,
    });
    await commerceRepository.configureVariantForSale({
      variantCode: 'reporting-direct-variant',
      priceIrr: 900_000n,
    });
    const useCase = new CommerceUseCase(
      commerceRepository,
      {
        create: async () => {
          throw new Error('NOT_USED');
        },
        renew: async () => {
          throw new Error('NOT_USED');
        },
      },
      reporting,
    );
    const customer = {
      telegramUserId: '20002',
      privateChatId: '20002',
      displayName: 'کاربر گزارش',
    } as const;
    const first = await useCase.recordCustomerActivity(customer);
    const again = await useCase.recordCustomerActivity(customer);
    expect(first.firstContact).toBe(true);
    expect(again.firstContact).toBe(false);
    const order = await useCase.beginCheckout({
      customer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:900:buy',
    });
    await useCase.submitPaymentProof({
      customer,
      telegramFileId: 'sensitive-file-id',
      telegramFileUniqueId: 'unique-report-proof',
    });
    now = new Date();
    await reporting.dispatchDue(20);
    now = new Date(now.getTime() + 5 * 60_000);
    const restarted = new ReportingUseCase(reportingRepository, transport, () => now);
    await restarted.dispatchDue(20);
    expect(sent.some((item) => item.startsWith('11:') && item.includes('کاربر جدید'))).toBe(true);
    expect(
      sent.filter((item) => item.startsWith('13:') && item.includes('رسید ثبت شد')),
    ).toHaveLength(1);
    expect(sent.join('\n')).not.toContain('sensitive-file-id');
    expect(sent.join('\n')).not.toContain('https://');
    const duplicate = await reporting.record({
      type: 'order.created',
      occurrenceKey: `order:${order.id}:created`,
      payload: { orderId: order.id, telegramUserId: customer.telegramUserId },
    });
    expect(duplicate.created).toBe(false);
  });
}, 180_000);
