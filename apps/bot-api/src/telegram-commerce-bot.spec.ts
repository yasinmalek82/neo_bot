import {
  CommerceUseCase,
  type CommerceRepository,
  type ReportingUseCase,
} from '@neo-bot/application';
import type {
  SalesOrder,
  SellableProductVariant,
  ServiceBinding,
  TelegramCustomer,
  TelegramPaymentProof,
} from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { TelegramConfig } from './config.js';
import type { TelegramMessenger } from './telegram-api.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';

const customer: TelegramCustomer = {
  id: '1',
  telegramUserId: '10001',
  privateChatId: '10001',
  username: 'buyer',
  displayName: 'خریدار',
};

const variant: SellableProductVariant = {
  id: '2',
  code: 'economic-30',
  productName: 'اقتصادی',
  name: 'یک‌ماهه',
  description: 'سرویس مستقیم',
  durationDays: 30,
  dataLimitBytes: 20n * 1024n ** 3n,
  deviceLimit: 1,
  priceIrr: 1_500_000n,
};

const order: SalesOrder = {
  id: '3',
  customerId: customer.id,
  productVariantId: variant.id,
  productName: variant.productName,
  variantName: variant.name,
  amountIrr: variant.priceIrr,
  status: 'receipt_submitted',
  serviceId: null,
  failureCode: null,
  createdAt: new Date('2026-08-21T00:00:00.000Z'),
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
};

const service: ServiceBinding = {
  id: '4',
  productVariantId: variant.id,
  providerInstanceId: '5',
  targetUserId: 6,
  targetUsername: 'neo_order',
  status: 'active',
  expiresAt: new Date('2026-09-21T00:00:00.000Z'),
  subscriptionUrl: 'https://panel.example/sub/order',
};

describe('TelegramCommerceBot', () => {
  it('shows the home inline menu and completes the update exactly once', async () => {
    const repository = createRepository();
    vi.mocked(repository.listCategories).mockResolvedValue([
      {
        id: '10',
        code: 'economic',
        name: 'اقتصادی',
        description: '',
        parentId: null,
        position: 0,
      },
    ]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 100,
      message: {
        message_id: 1,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start',
      },
    });

    expect(messenger.sendMessage).toHaveBeenNthCalledWith(
      1,
      '10001',
      expect.stringContaining('خوش آمدی'),
      {
        inline_keyboard: [
          [{ text: 'خرید سرویس 🛍', callback_data: 'shop' }],
          [
            { text: 'پیگیری سفارش 📦', callback_data: 'order' },
            { text: 'تمدید سرویس ♻️', callback_data: 'renew' },
          ],
          [{ text: 'راهنما 📘', callback_data: 'help' }],
        ],
      },
      { parseMode: 'HTML' },
    );
    expect(messenger.sendMessage).toHaveBeenNthCalledWith(
      2,
      '10001',
      expect.stringContaining('منوی پایین'),
      expect.objectContaining({
        keyboard: [
          [{ text: 'خرید سرویس 🛍' }],
          [{ text: 'پیگیری سفارش 📦' }, { text: 'تمدید سرویس ♻️' }],
          [{ text: 'راهنما 📘' }],
        ],
        resize_keyboard: true,
        is_persistent: true,
      }),
      { parseMode: 'HTML' },
    );
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('100');
    expect(repository.upsertTelegramCustomer).toHaveBeenCalledWith({
      telegramUserId: '10001',
      privateChatId: '10001',
      displayName: 'خریدار',
    });
  });

  it('opens the catalog from an inline shop button instead of a typed command', async () => {
    const repository = createRepository();
    vi.mocked(repository.listCategories).mockResolvedValue([
      {
        id: '10',
        code: 'economic',
        name: 'اقتصادی',
        description: '',
        parentId: null,
        position: 0,
      },
    ]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 120,
      callback_query: {
        id: 'cb-shop',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 9,
          chat: { id: 10001, type: 'private' },
          text: 'منو',
        },
        data: 'shop',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '9',
      expect.stringContaining('خرید سرویس'),
      expect.objectContaining({
        inline_keyboard: [
          [{ text: 'اقتصادی', callback_data: 'cat:10' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
        ],
      }),
    );
    expect(messenger.sendMessage).not.toHaveBeenCalled();
    expect(messenger.answerCallbackQuery).toHaveBeenCalledWith('cb-shop');
  });

  it('shows the mixed admin menu to an administrator', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 121,
      message: {
        message_id: 8,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: '/start',
      },
    });

    expect(messenger.sendMessage).toHaveBeenNthCalledWith(
      1,
      '70001',
      expect.stringContaining('خوش آمدی'),
      {
        inline_keyboard: [
          [{ text: 'وضعیت سیستم ⚙️', callback_data: 'admin:status' }],
          [
            { text: 'گزارش‌ها 📣', callback_data: 'admin:reports' },
            { text: 'سفارش‌های باز 📋', callback_data: 'admin:queue' },
          ],
          [{ text: 'خرید سرویس 🛍', callback_data: 'shop' }],
          [
            { text: 'پیگیری سفارش 📦', callback_data: 'order' },
            { text: 'تمدید سرویس ♻️', callback_data: 'renew' },
          ],
          [{ text: 'راهنما 📘', callback_data: 'help' }],
          [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
        ],
      },
      { parseMode: 'HTML' },
    );
  });

  it('lets an administrator open the review queue from the inline menu', async () => {
    const repository = createRepository();
    vi.mocked(repository.listReviewQueue).mockResolvedValue([order]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 122,
      callback_query: {
        id: 'cb-queue',
        from: { id: 70001, first_name: 'ادمین' },
        message: {
          message_id: 11,
          chat: { id: 70001, type: 'private' },
          text: 'منو',
        },
        data: 'admin:queue',
      },
    });

    expect(repository.listReviewQueue).toHaveBeenCalledWith(10);
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '11',
      expect.stringContaining('سفارش‌های باز'),
      expect.objectContaining({
        inline_keyboard: [
          [{ text: 'اقتصادی — رسید در صف', callback_data: 'admin:order:3' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
        ],
      }),
    );
  });

  it('offers provisioning retry for a failed order without re-approving payment', async () => {
    const repository = createRepository();
    vi.mocked(repository.getOrder).mockResolvedValue({
      ...order,
      status: 'provisioning_failed',
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 123,
      callback_query: {
        id: 'cb-order',
        from: { id: 70001, first_name: 'ادمین' },
        message: {
          message_id: 12,
          chat: { id: 70001, type: 'private' },
          text: 'صف',
        },
        data: 'admin:order:3',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '12',
      expect.stringContaining('بررسی سفارش'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: 'admin:retry:3' })]),
        ]),
      }),
    );
  });

  it('stores a photo proof and sends it to the administrator for review', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 101,
      message: {
        message_id: 2,
        from: { id: 10001, first_name: 'خریدار', username: 'buyer' },
        chat: { id: 10001, type: 'private' },
        photo: [
          {
            file_id: 'receipt-file-id',
            file_unique_id: 'receipt-unique',
            width: 800,
            height: 1200,
          },
        ],
      },
    });

    expect(repository.submitTelegramProof).toHaveBeenCalledWith(
      customer.id,
      'receipt-file-id',
      'receipt-unique',
    );
    expect(messenger.sendPhoto).toHaveBeenCalledWith(
      '70001',
      'receipt-file-id',
      expect.stringContaining('سفارش: 3'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('101');
  });

  it('records first contact and keeps receipt reports free of file identifiers', async () => {
    const repository = createRepository();
    vi.mocked(repository.upsertTelegramCustomer)
      .mockResolvedValueOnce({ customer, created: true })
      .mockResolvedValue({ customer, created: false });
    const messenger = createMessenger();
    const recorded: {
      readonly type: string;
      readonly payload: Readonly<Record<string, string>>;
    }[] = [];
    const reporting = {
      record: vi.fn(async (input: { type: string; payload: Readonly<Record<string, string>> }) => {
        recorded.push(input);
        return { id: String(recorded.length), ...input, created: true, occurrenceKey: 'key' };
      }),
      dispatchDue: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createBot(repository, messenger, reporting as unknown as ReportingUseCase);

    await bot.handleUpdate({
      update_id: 110,
      message: {
        message_id: 4,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start',
      },
    });
    await bot.handleUpdate({
      update_id: 111,
      message: {
        message_id: 5,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        photo: [
          {
            file_id: 'receipt-file-id',
            file_unique_id: 'receipt-unique',
            width: 800,
            height: 1200,
          },
        ],
      },
    });

    expect(recorded.map((event) => event.type)).toEqual([
      'customer.first_contact',
      'customer.activity',
      'payment.proof_submitted',
    ]);
    expect(JSON.stringify(recorded)).not.toContain('receipt-file-id');
    expect(JSON.stringify(recorded)).not.toContain('https://');
    expect(reporting.dispatchDue).toHaveBeenCalled();
  });

  it('ignores a Telegram retry after the update was already reserved', async () => {
    const repository = createRepository();
    vi.mocked(repository.reserveTelegramUpdate).mockResolvedValue(false);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({ update_id: 102 });

    expect(messenger.sendMessage).not.toHaveBeenCalled();
    expect(repository.completeTelegramUpdate).not.toHaveBeenCalled();
  });

  it('accepts an image document as a receipt and forwards it to the administrator', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 104,
      message: {
        message_id: 6,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        document: {
          file_id: 'receipt-doc-id',
          file_unique_id: 'receipt-doc-unique',
          mime_type: 'image/jpeg',
          file_name: 'receipt.jpg',
        },
      },
    });

    expect(repository.submitTelegramProof).toHaveBeenCalledWith(
      customer.id,
      'receipt-doc-id',
      'receipt-doc-unique',
    );
    expect(messenger.sendDocument).toHaveBeenCalledWith(
      '70001',
      'receipt-doc-id',
      expect.stringContaining('سفارش: 3'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );
  });

  it('completes a malformed update without throwing so webhook intake is not stalled', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await expect(
      bot.handleUpdate({ update_id: 105, message: { chat: { id: 10001 } } }),
    ).resolves.toBeUndefined();
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('105');
    expect(messenger.sendMessage).not.toHaveBeenCalled();
  });
});

function createBot(
  repository: CommerceRepository,
  messenger: TelegramMessenger,
  reporting: ReportingUseCase | null = null,
) {
  const config: Extract<TelegramConfig, { readonly enabled: true }> = {
    enabled: true,
    botToken: '12345:abcdefghijklmnopqrstuvwxyz',
    webhookSecret: 'safe_webhook_secret_123',
    webhookUrl: null,
    miniAppUrl: null,
    adminTelegramUserIds: new Set(['70001']),
    reporting: null,
    reportDispatchIntervalMs: 15_000,
  };
  const commerce = new CommerceUseCase(
    repository,
    { create: vi.fn().mockResolvedValue(service), renew: vi.fn().mockResolvedValue(service) },
    reporting,
  );
  return new TelegramCommerceBot(
    config,
    commerce,
    repository,
    { get: vi.fn().mockResolvedValue({ remote: { subscriptionUrl: service.subscriptionUrl } }) },
    messenger,
    {
      getPublicCatalog: vi.fn().mockResolvedValue({
        settings: { cardNumber: '0000000000000000', cardHolder: 'صاحب کارت' },
      }),
    },
    reporting,
  );
}

function createMessenger(): TelegramMessenger {
  return {
    sendMessage: vi.fn().mockResolvedValue({ messageId: '1' }),
    sendPhoto: vi.fn().mockResolvedValue({ messageId: '2' }),
    sendDocument: vi.fn().mockResolvedValue({ messageId: '3' }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

function createRepository(): CommerceRepository {
  const proof: TelegramPaymentProof = {
    id: '20',
    orderId: order.id,
    telegramFileId: 'receipt-file-id',
    telegramFileUniqueId: 'receipt-unique',
    submittedAt: new Date('2026-08-21T00:00:00.000Z'),
  };
  return {
    listCategories: vi.fn().mockResolvedValue([]),
    listSellableVariants: vi.fn().mockResolvedValue([variant]),
    getSellableVariant: vi.fn().mockResolvedValue(variant),
    upsertTelegramCustomer: vi.fn().mockResolvedValue({ customer, created: true }),
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
