import {
  CommerceUseCase,
  type CommerceRepository,
  type OpsDailySummaryUseCase,
  type ReportingUseCase,
  type ServiceProvisioner,
} from '@neo-bot/application';
import {
  DomainConflictError,
  type SalesOrder,
  type SellableProductVariant,
  type ServiceBinding,
  type TelegramCustomer,
  type TelegramPaymentProof,
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
      expect.stringContaining('دکمه‌های پایین'),
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

  it('shows a published category description and returns to the parent category', async () => {
    const parent = {
      id: '10',
      code: 'economic',
      name: 'اقتصادی',
      description: 'سرویس مستقیم',
      parentId: null,
      position: 0,
    };
    const nested = {
      id: '11',
      code: 'special',
      name: 'ویژه',
      description: 'تونل چند لوکیشن <script>',
      parentId: '10',
      position: 1,
    };
    const repository = createRepository();
    vi.mocked(repository.getCategory).mockImplementation(async (id) => {
      if (id === nested.id) {
        return nested;
      }
      if (id === parent.id) {
        return parent;
      }
      return null;
    });
    vi.mocked(repository.listCategories).mockResolvedValue([]);
    vi.mocked(repository.listSellableVariants).mockResolvedValue([variant]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 126,
      callback_query: {
        id: 'cb-nested',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 15,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'cat:11',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '15',
      expect.stringMatching(/ویژه[\s\S]*زیرمجموعهٔ اقتصادی[\s\S]*تونل چند لوکیشن &lt;script&gt;/u),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ text: 'اقتصادی ⬅️', callback_data: 'cat:10' }),
          ]),
        ]),
      }),
    );
    const keyboard = vi.mocked(messenger.editMessageText).mock.calls[0]?.[3];
    expect(JSON.stringify(keyboard)).not.toContain('"callback_data":"shop"');
  });

  it('tells an administrator to publish from the catalog console when the shop is empty', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 127,
      callback_query: {
        id: 'cb-empty-admin',
        from: { id: 70001, first_name: 'ادمین' },
        message: {
          message_id: 16,
          chat: { id: 70001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'shop',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '16',
      expect.stringContaining('کنسول کاتالوگ'),
      expect.any(Object),
    );
  });

  it('keeps empty-shop customer copy free of catalog-console instructions', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 128,
      callback_query: {
        id: 'cb-empty-customer',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 17,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'shop',
      },
    });

    const text = vi.mocked(messenger.editMessageText).mock.calls[0]?.[2] ?? '';
    expect(text).toContain('فروشگاه خالی است');
    expect(text).not.toContain('کنسول کاتالوگ');
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
          [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
        ],
      }),
    );
  });

  it('lists failed provisioning from the admin hub without mixing the receipt queue', async () => {
    const failed = { ...order, status: 'provisioning_failed' as const };
    const repository = createRepository();
    vi.mocked(repository.listFailedProvisioning).mockResolvedValue([failed]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 129,
      callback_query: {
        id: 'cb-failed',
        from: { id: 70001, first_name: 'ادمین' },
        message: {
          message_id: 18,
          chat: { id: 70001, type: 'private' },
          text: 'ادمین',
        },
        data: 'admin:failed',
      },
    });

    expect(repository.listFailedProvisioning).toHaveBeenCalledWith(10);
    expect(repository.listReviewQueue).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '18',
      expect.stringContaining('ساخت ناموفق'),
      expect.objectContaining({
        inline_keyboard: [
          [{ text: 'اقتصادی — خطای ساخت', callback_data: 'admin:order:3' }],
          [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
        ],
      }),
    );
  });

  it('reports catalog and card-published health without card digits', async () => {
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
      update_id: 130,
      callback_query: {
        id: 'cb-catalog',
        from: { id: 70001, first_name: 'ادمین' },
        message: {
          message_id: 19,
          chat: { id: 70001, type: 'private' },
          text: 'ادمین',
        },
        data: 'admin:catalog',
      },
    });

    const text = vi.mocked(messenger.editMessageText).mock.calls[0]?.[2] ?? '';
    expect(text).toContain('دسته‌های ریشهٔ منتشرشده: 1');
    expect(text).toContain('کارت کارت‌به‌کارت: منتشر شده');
    expect(text).not.toContain('0000000000000000');
    expect(text).not.toMatch(/\d{4} \d{4} \d{4} \d{4}/u);
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

  it('completes an approval update after provisioning fails so Telegram does not retry the button', async () => {
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValue({
      ...order,
      status: 'provisioning',
    });
    vi.mocked(repository.markProvisioningFailed).mockResolvedValue({
      ...order,
      status: 'provisioning_failed',
    });
    vi.mocked(repository.getOrder).mockResolvedValue({
      ...order,
      status: 'provisioning_failed',
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger, null, {
      create: vi.fn().mockRejectedValue(new Error('PASARGUARD_UNAVAILABLE')),
      renew: vi.fn(),
    });

    await expect(
      bot.handleUpdate({
        update_id: 124,
        callback_query: {
          id: 'cb-approve',
          from: { id: 70001, first_name: 'ادمین' },
          message: {
            message_id: 13,
            chat: { id: 70001, type: 'private' },
            text: 'رسید',
          },
          data: 'approve:3',
        },
      }),
    ).resolves.toBeUndefined();

    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('124');
    expect(repository.failTelegramUpdate).not.toHaveBeenCalled();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('آماده‌سازی سرویس کامل نشد'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('دوباره تلاش کن'),
    );
  });

  it('completes a renewal update after provider failure so Telegram does not retry the button', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger, null, {
      create: vi.fn().mockResolvedValue(service),
      renew: vi.fn().mockRejectedValue(new Error('PASARGUARD_UNAVAILABLE')),
    });

    await expect(
      bot.handleUpdate({
        update_id: 125,
        callback_query: {
          id: 'cb-renew',
          from: { id: 10001, first_name: 'خریدار' },
          message: {
            message_id: 14,
            chat: { id: 10001, type: 'private' },
            text: 'منو',
          },
          data: 'renew',
        },
      }),
    ).resolves.toBeUndefined();

    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('125');
    expect(repository.failTelegramUpdate).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '14',
      expect.stringContaining('تمدید الان تمام نشد'),
      expect.any(Object),
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

  it('tells the customer when a receipt is already under review', async () => {
    const repository = createRepository();
    vi.mocked(repository.submitTelegramProof).mockRejectedValue(
      new DomainConflictError('OPEN_ORDER_UNDER_REVIEW'),
    );
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 112,
      message: {
        message_id: 8,
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

    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('در حال بررسی'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
    expect(messenger.sendPhoto).not.toHaveBeenCalled();
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('112');
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

  it('shows report-queue counts on admin status without identifiers', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const reporting = {
      record: vi.fn(),
      dispatchDue: vi.fn().mockResolvedValue(undefined),
      countDeliveries: vi.fn().mockResolvedValue({ pending: 2, failed: 1, delivered: 4 }),
    };
    const bot = createBot(repository, messenger, reporting as unknown as ReportingUseCase);

    await bot.handleUpdate({
      update_id: 130,
      message: {
        message_id: 20,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: 'وضعیت سیستم ⚙️',
      },
    });

    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('صف گزارش: 2 در انتظار، 1 ناموفق'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
    expect(vi.mocked(messenger.sendMessage).mock.calls[0]?.[1]).not.toMatch(/https?:\/\//u);
  });

  it('lets an administrator republish the daily summary without duplicating forum delivery', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const reporting = {
      record: vi.fn(),
      dispatchDue: vi.fn().mockResolvedValue(undefined),
      countDeliveries: vi.fn().mockResolvedValue({ pending: 0, failed: 0, delivered: 4 }),
    };
    const dailySummary = {
      publishForUtcDay: vi.fn().mockResolvedValue({ created: false }),
    };
    const bot = createBot(
      repository,
      messenger,
      reporting as unknown as ReportingUseCase,
      {
        create: vi.fn().mockResolvedValue(service),
        renew: vi.fn().mockResolvedValue(service),
      },
      dailySummary as unknown as OpsDailySummaryUseCase,
    );

    await expect(
      bot.handleUpdate({
        update_id: 131,
        callback_query: {
          id: 'cb-summary',
          from: { id: 70001, first_name: 'ادمین' },
          message: {
            message_id: 21,
            chat: { id: 70001, type: 'private' },
            text: 'گزارش‌ها',
          },
          data: 'admin:summary',
        },
      }),
    ).resolves.toBeUndefined();

    expect(dailySummary.publishForUtcDay).toHaveBeenCalledTimes(1);
    expect(reporting.dispatchDue).toHaveBeenCalled();
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('131');
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '21',
      expect.stringContaining('از قبل ثبت بود'),
      expect.any(Object),
    );
  });
});

function createBot(
  repository: CommerceRepository,
  messenger: TelegramMessenger,
  reporting: ReportingUseCase | null = null,
  provisioner: ServiceProvisioner = {
    create: vi.fn().mockResolvedValue(service),
    renew: vi.fn().mockResolvedValue(service),
  },
  dailySummary: OpsDailySummaryUseCase | null = null,
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
  const commerce = new CommerceUseCase(repository, provisioner, reporting);
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
    dailySummary,
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
    getCategory: vi.fn().mockResolvedValue(null),
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
    listFailedProvisioning: vi.fn().mockResolvedValue([]),
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
