import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CatalogAdminUseCase,
  CatalogChatAdminUseCase,
  CommerceUseCase,
  ReportingUseCase,
} from '@neo-bot/application';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresCommerceRepository } from './commerce-repository.js';
import { PostgresCatalogRepository } from './catalog-repository.js';
import { PostgresCatalogChatAdminRepository } from './catalog-chat-admin-repository.js';
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
    expect(await commerceRepository.getCategory(categoryId)).toMatchObject({
      id: categoryId,
      code: 'economic',
      parentId: null,
    });
    expect(await commerceRepository.listFailedProvisioning(10)).toEqual([]);
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
      serviceUsernameBase: 'buyer',
    });
    const duplicateOrder = await useCase.beginCheckout({
      customer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:100:buy',
      serviceUsernameBase: 'buyer',
    });
    expect(duplicateOrder.id).toBe(order.id);
    expect(order.amountIrr).toBe(1_500_000n);
    expect(order.pricingSource).toBe('public');
    expect(order.representativeId ?? null).toBe(null);

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
          code: 'dynamic-economy',
          name: 'اقتصادی',
          shortName: 'اقتصادی',
          description: 'مسیر مستقیم',
          badge: null,
          iconKey: 'globe',
          position: 0,
          active: true,
          category: { code: 'dynamic-new', name: 'جدید', description: '', position: 0 },
          variants: [
            {
              code: 'dynamic-economy-30gb-30d',
              name: '۳۰ گیگ، ۳۰ روزه',
              description: 'ترکیب جایگزین',
              durationDays: 30,
              durationLabel: '۳۰ روزه',
              dataLimitBytes: 30n * 1024n ** 3n,
              dataLimitLabel: '۳۰ گیگ',
              deviceLimit: 1,
              deviceLabel: 'یک اتصال',
              priceIrr: 950_000n,
              position: 0,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [31],
            },
          ],
        },
      ],
    });

    const refreshedAdminCatalog = await catalog.getAdminCatalog();
    expect(refreshedAdminCatalog.products.map((product) => product.code)).toEqual([
      'dynamic-economy',
    ]);

    const refreshedPublicCatalog = await catalog.getPublicCatalog();
    expect(refreshedPublicCatalog.products.map((product) => product.code)).toEqual([
      'dynamic-economy',
    ]);

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
          code: 'dynamic-economy',
          name: 'اقتصادی',
          shortName: 'اقتصادی',
          description: 'مسیر مستقیم',
          badge: null,
          iconKey: 'globe',
          position: 0,
          active: true,
          category: { code: 'dynamic-new', name: 'جدید', description: '', position: 0 },
          variants: [
            {
              code: 'dynamic-economy-30gb-30d',
              name: '۳۰ گیگ، ۳۰ روزه',
              description: 'ترکیب اول',
              durationDays: 30,
              durationLabel: '۳۰ روزه',
              dataLimitBytes: 30n * 1024n ** 3n,
              dataLimitLabel: '۳۰ گیگ',
              deviceLimit: 1,
              deviceLabel: 'یک اتصال',
              priceIrr: 950_000n,
              position: 0,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [31],
            },
            {
              code: 'dynamic-economy-50gb-30d',
              name: '۵۰ گیگ، ۳۰ روزه',
              description: 'ترکیب دوم',
              durationDays: 30,
              durationLabel: '۳۰ روزه',
              dataLimitBytes: 50n * 1024n ** 3n,
              dataLimitLabel: '۵۰ گیگ',
              deviceLimit: 1,
              deviceLabel: 'یک اتصال',
              priceIrr: 1_250_000n,
              position: 1,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [31],
            },
          ],
        },
      ],
    });

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
          code: 'dynamic-economy',
          name: 'اقتصادی',
          shortName: 'اقتصادی',
          description: 'مسیر مستقیم',
          badge: null,
          iconKey: 'globe',
          position: 0,
          active: true,
          category: { code: 'dynamic-new', name: 'جدید', description: '', position: 0 },
          variants: [
            {
              code: 'dynamic-economy-30gb-30d',
              name: '۳۰ گیگ، ۳۰ روزه',
              description: 'ترکیب اول',
              durationDays: 30,
              durationLabel: '۳۰ روزه',
              dataLimitBytes: 30n * 1024n ** 3n,
              dataLimitLabel: '۳۰ گیگ',
              deviceLimit: 1,
              deviceLabel: 'یک اتصال',
              priceIrr: 990_000n,
              position: 0,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [31],
            },
          ],
        },
      ],
    });

    const afterVariantDelete = await catalog.getAdminCatalog();
    const economyProduct = afterVariantDelete.products.find(
      (product) => product.code === 'dynamic-economy',
    );
    expect(economyProduct?.variants.map((variant) => variant.code)).toEqual([
      'dynamic-economy-30gb-30d',
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
      serviceUsernameBase: 'report-user',
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

  it('lists and checks out representative prices as override then base then public', async () => {
    const providerId = await repository.upsertProviderInstance(
      'reseller-provider',
      'https://reseller-panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [{ id: 50, name: 'Reseller', disabled: false, inboundTags: ['reseller'] }],
      new Date('2026-08-22T00:00:00.000Z'),
    );
    const variantId = await repository.upsertPilotVariant({
      providerInstanceId: providerId,
      code: 'reseller-direct-variant',
      name: 'نماینده یک‌ماهه',
      groupIds: [50],
      durationDays: 30,
      dataLimitBytes: 20n * 1024n ** 3n,
      deviceLimit: 1,
    });
    const categoryId = await commerceRepository.upsertCategory({
      code: 'reseller-economic',
      name: 'اقتصادی نماینده',
    });
    await commerceRepository.assignProductToCategory(categoryId, 'pilot-direct');
    await commerceRepository.configureVariantForSale({
      variantCode: 'reseller-direct-variant',
      priceIrr: 1_500_000n,
    });
    const representativeId = await commerceRepository.upsertRepresentative({
      code: 'rep-alpha',
      telegramUserId: '30003',
      displayName: 'نماینده آزمایشی',
      active: true,
    });
    await commerceRepository.setRepresentativeVariantAccess({
      representativeId,
      variantId,
      active: true,
    });
    await commerceRepository.setRepresentativeBasePrice({
      variantId,
      priceIrr: 1_200_000n,
    });

    const publicListed = await commerceRepository.listSellableVariants(categoryId);
    expect(publicListed.find((item) => item.id === variantId)).toMatchObject({
      id: variantId,
      priceIrr: 1_500_000n,
      pricingSource: 'public',
    });
    expect(
      await commerceRepository.listSellableVariantsForRepresentative(categoryId, representativeId),
    ).toMatchObject([
      { id: variantId, priceIrr: 1_200_000n, pricingSource: 'representative_base' },
    ]);

    await commerceRepository.setRepresentativeOverridePrice({
      representativeId,
      variantId,
      priceIrr: 900_000n,
    });
    expect(
      await commerceRepository.getSellableVariantForRepresentative(variantId, representativeId),
    ).toMatchObject({
      id: variantId,
      priceIrr: 900_000n,
      pricingSource: 'representative_override',
    });

    const useCase = new CommerceUseCase(commerceRepository, {
      create: async () => {
        throw new Error('NOT_USED');
      },
      renew: async () => {
        throw new Error('NOT_USED');
      },
    });
    const representativeCustomer = {
      telegramUserId: '30003',
      privateChatId: '30003',
      displayName: 'نماینده آزمایشی',
    } as const;
    const publicCustomer = {
      telegramUserId: '30004',
      privateChatId: '30004',
      displayName: 'خریدار عمومی',
    } as const;

    const representativeOrder = await useCase.beginCheckout({
      customer: representativeCustomer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:30003:buy',
      serviceUsernameBase: 'rep-order',
    });
    expect(representativeOrder.amountIrr).toBe(900_000n);
    expect(representativeOrder.pricingSource).toBe('representative_override');
    expect(representativeOrder.representativeCode).toBe('rep-alpha');

    const publicOrder = await useCase.beginCheckout({
      customer: publicCustomer,
      productVariantId: variantId,
      idempotencyKey: 'telegram:30004:buy',
      serviceUsernameBase: 'public-order',
    });
    expect(publicOrder.amountIrr).toBe(1_500_000n);
    expect(publicOrder.pricingSource).toBe('public');
    expect(publicOrder.representativeId ?? null).toBe(null);

    await commerceRepository.clearRepresentativeOverridePrice({ representativeId, variantId });
    const listed = await useCase.listVariantsForCustomer(categoryId, representativeCustomer);
    expect(listed).toMatchObject([
      { id: variantId, priceIrr: 1_200_000n, pricingSource: 'representative_base' },
    ]);
  });

  it('assigns a customer to a representative and lists override prices in the audit', async () => {
    const providerId = await repository.upsertProviderInstance(
      'reseller-assign-provider',
      'https://reseller-assign-panel.example.test',
    );
    await repository.replaceGroupSnapshots(
      providerId,
      [{ id: 51, name: 'Reseller assign', disabled: false, inboundTags: ['reseller'] }],
      new Date('2026-08-22T01:00:00.000Z'),
    );
    const variantId = await repository.upsertPilotVariant({
      providerInstanceId: providerId,
      code: 'reseller-assign-variant',
      name: 'نماینده اختصاصی',
      groupIds: [51],
      durationDays: 30,
      dataLimitBytes: 20n * 1024n ** 3n,
      deviceLimit: 1,
    });
    const categoryId = await commerceRepository.upsertCategory({
      code: 'reseller-assigned',
      name: 'نماینده اختصاص‌یافته',
    });
    await commerceRepository.assignProductToCategory(categoryId, 'pilot-direct');
    await commerceRepository.configureVariantForSale({
      variantCode: 'reseller-assign-variant',
      priceIrr: 1_500_000n,
    });
    const representativeId = await commerceRepository.upsertRepresentative({
      code: 'rep-assigned',
      telegramUserId: '40005',
      displayName: 'نماینده اختصاص',
      active: true,
    });
    await commerceRepository.setRepresentativeVariantAccess({
      representativeId,
      variantId,
      active: true,
    });
    await commerceRepository.setRepresentativeOverridePrice({
      representativeId,
      variantId,
      priceIrr: 850_000n,
    });

    const assigned = await commerceRepository.upsertTelegramCustomer({
      telegramUserId: '40006',
      privateChatId: '40006',
      displayName: 'مشتری نماینده',
    });
    await commerceRepository.assignRepresentativeToCustomerByTelegramId(
      assigned.customer.telegramUserId,
      representativeId,
    );

    const listed = await commerceRepository.listRepresentatives();
    expect(listed.find((item) => item.id === representativeId)).toMatchObject({
      id: representativeId,
      code: 'rep-assigned',
      telegramUserId: '40005',
      displayName: 'نماینده اختصاص',
      active: true,
    });

    const assignment = await pool.query<{ representative_id: string }>(
      `select representative_id::text as representative_id
       from customers
       where telegram_user_id = $1`,
      [assigned.customer.telegramUserId],
    );
    expect(assignment.rows[0]?.representative_id).toBe(representativeId);

    expect(
      (await commerceRepository.listSellableVariants(categoryId)).find(
        (item) => item.id === variantId,
      ),
    ).toMatchObject({
      id: variantId,
      priceIrr: 1_500_000n,
      pricingSource: 'public',
    });
    expect(await commerceRepository.listRepresentativePriceAudit()).toEqual(
      expect.arrayContaining([
        {
          representativeCode: 'rep-assigned',
          variantCode: 'reseller-assign-variant',
          priceIrr: 850_000n,
          pricingSource: 'representative_override',
        },
      ]),
    );
  });

  it('publishes an empty admin category through a durable revision-checked session', async () => {
    const catalog = new CatalogChatAdminUseCase(new PostgresCatalogChatAdminRepository(pool));
    const now = new Date('2026-08-22T12:00:00.000Z');
    const first = await catalog.startSession({
      id: 'cab1c0b0-0000-4000-8000-000000000001',
      adminTelegramUserId: '90001',
      now,
    });
    await catalog.updateSession({
      id: first.id,
      adminTelegramUserId: '90001',
      now,
      state: {
        kind: 'review',
        step: 'confirm',
        delta: { kind: 'category', code: 'chat-empty', name: 'خالی', description: '', position: 9 },
      },
    });
    const published = await catalog.publishSession({
      id: first.id,
      adminTelegramUserId: '90001',
      now,
    });
    expect(published.revision).toBe(first.baseRevision + 1);
    expect(await catalog.listCategories()).toContainEqual(
      expect.objectContaining({
        code: 'chat-empty',
        name: 'خالی',
        description: '',
        position: 9,
        active: true,
      }),
    );
    await expect(
      catalog.publishSession({ id: first.id, adminTelegramUserId: '90001', now }),
    ).resolves.toEqual(published);
    const audit = await pool.query<{ action: string; summary: unknown }>(
      `select action, summary from catalog_publication_audit where revision = $1`,
      [published.revision],
    );
    expect(audit.rows).toEqual([{ action: 'category', summary: { action: 'category' } }]);
  });

  it('rolls back a guided three-item changeset when its final variant cannot use the provider group', async () => {
    const catalog = new CatalogChatAdminUseCase(new PostgresCatalogChatAdminRepository(pool));
    const now = new Date('2026-08-22T12:15:00.000Z');
    const session = await catalog.startSession({
      id: 'cab1c0b0-0000-4000-8000-000000000010',
      adminTelegramUserId: '90010',
      now,
    });
    await catalog.updateSession({
      id: session.id,
      adminTelegramUserId: '90010',
      now,
      state: {
        kind: 'review',
        step: 'confirm',
        delta: {
          kind: 'changeset',
          changes: [
            {
              kind: 'category',
              code: 'atomic-category',
              name: 'اتمی',
              description: '',
              position: 0,
            },
            {
              kind: 'product',
              code: 'atomic-product',
              categoryCode: 'atomic-category',
              name: 'محصول اتمی',
              shortName: 'اتمی',
              description: '',
              badge: null,
              iconKey: 'globe',
              position: 0,
              active: true,
            },
            {
              kind: 'variant',
              code: 'atomic-variant',
              productCode: 'atomic-product',
              name: 'پلن اتمی',
              description: '',
              durationDays: 30,
              dataLimitBytes: 20n * 1024n ** 3n,
              deviceLimit: 1,
              priceIrr: 1_000_000n,
              position: 0,
              sellable: true,
              providerCode: 'catalog-provider',
              groupIds: [9_999_999],
            },
          ],
        },
      },
    });
    await expect(
      catalog.publishSession({ id: session.id, adminTelegramUserId: '90010', now }),
    ).rejects.toThrow('PROVIDER_GROUP_NOT_AVAILABLE');
    expect(
      (await pool.query(`select code from product_categories where code = 'atomic-category'`)).rows,
    ).toEqual([]);
    expect(
      (await pool.query(`select code from products where code = 'atomic-product'`)).rows,
    ).toEqual([]);
  });

  it('reads product position from its production category assignment', async () => {
    const category = await pool.query<{ id: string }>(
      `insert into product_categories(code, name, description, position, active, managed_by_admin)
       values ('read-model-position-category', 'دسته ترتیب', '', 0, true, true)
       returning id::text`,
    );
    const product = await pool.query<{ id: string }>(
      `insert into products(code, name, description, short_name, icon_key, active, managed_by_admin)
       values ('read-model-position-product', 'محصول ترتیب', '', 'ترتیب', 'globe', true, true)
       returning id::text`,
    );
    await pool.query(
      `insert into product_category_assignments(category_id, product_id, position)
       values ($1, $2, $3)`,
      [category.rows[0]?.id, product.rows[0]?.id, 37],
    );

    const repository = new PostgresCatalogChatAdminRepository(pool);
    const directReadModel = await repository.getCatalogAdminReadModel();
    expect(directReadModel.products).toContainEqual(
      expect.objectContaining({
        code: 'read-model-position-product',
        categoryCode: 'read-model-position-category',
        position: 37,
      }),
    );

    const useCase = new CatalogChatAdminUseCase(repository);
    expect((await useCase.getReadModel()).products).toContainEqual(
      expect.objectContaining({ code: 'read-model-position-product', position: 37 }),
    );
  });

  it('allows one pending session per admin and archives a category cascade without restoring descendants', async () => {
    const catalog = new CatalogChatAdminUseCase(new PostgresCatalogChatAdminRepository(pool));
    const now = (await pool.query<{ now: Date }>('select now() as now')).rows[0]!.now;
    const pending = await catalog.startSession({
      id: 'cab1c0b0-0000-4000-8000-000000000003',
      adminTelegramUserId: '90002',
      now,
    });
    await expect(
      catalog.startSession({
        id: 'cab1c0b0-0000-4000-8000-000000000004',
        adminTelegramUserId: '90002',
        now,
      }),
    ).rejects.toThrow('CATALOG_ADMIN_SESSION_ACTIVE');
    await catalog.cancelSession({ id: pending.id, adminTelegramUserId: '90002', now });
    await expect(
      catalog.publishSession({ id: pending.id, adminTelegramUserId: '90002', now }),
    ).rejects.toThrow('CATALOG_ADMIN_SESSION_NOT_PENDING');

    const archive = await catalog.startSession({
      id: 'cab1c0b0-0000-4000-8000-000000000005',
      adminTelegramUserId: '90002',
      now,
    });
    await catalog.updateSession({
      id: archive.id,
      adminTelegramUserId: '90002',
      now,
      state: {
        kind: 'review',
        step: 'confirm',
        delta: { kind: 'archive', entity: 'category', code: 'dynamic-new' },
      },
    });
    await catalog.publishSession({ id: archive.id, adminTelegramUserId: '90002', now });
    const archived = await pool.query<{
      product_active: boolean;
      variant_active: boolean;
      sellable: boolean;
    }>(
      `select product.active as product_active, variant.active as variant_active, variant.sellable
       from products product join product_variants variant on variant.product_id = product.id
       where product.code = 'dynamic-economy' and variant.code = 'dynamic-economy-30gb-30d'`,
    );
    expect(archived.rows).toEqual([
      { product_active: false, variant_active: false, sellable: false },
    ]);

    const restore = await catalog.startSession({
      id: 'cab1c0b0-0000-4000-8000-000000000006',
      adminTelegramUserId: '90002',
      now,
    });
    await catalog.updateSession({
      id: restore.id,
      adminTelegramUserId: '90002',
      now,
      state: {
        kind: 'review',
        step: 'confirm',
        delta: { kind: 'restore', entity: 'category', code: 'dynamic-new' },
      },
    });
    await catalog.publishSession({ id: restore.id, adminTelegramUserId: '90002', now });
    expect(
      (
        await pool.query<{ active: boolean }>(
          `select active from products where code = 'dynamic-economy'`,
        )
      ).rows,
    ).toEqual([{ active: false }]);
  });
}, 180_000);
