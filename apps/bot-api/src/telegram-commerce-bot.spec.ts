import {
  CommerceUseCase,
  CustomerDeliveryUseCase,
  type CommerceRepository,
  type CommercialRepository,
  type OpsDailySummaryUseCase,
  type ReportingUseCase,
  type ServiceProvisioner,
} from '@neo-bot/application';
import {
  DomainConflictError,
  type CatalogAdminSession,
  type DurableConversationSession,
  type SalesOrder,
  type SellableProductVariant,
  type ServiceBinding,
  type TelegramCustomer,
  type TelegramPaymentProof,
} from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { TelegramConfig } from './config.js';
import type { TelegramMessenger } from './telegram-api.js';
import { createTelegramDeliveryTransport, TelegramCommerceBot } from './telegram-commerce-bot.js';
import { MENU_LABEL, serviceDeliveredText } from './telegram-menu.js';

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
  kind: 'purchase',
  status: 'receipt_submitted',
  serviceId: null,
  targetServiceId: null,
  serviceUsernameBase: null,
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
  it('edits multiple category fields in one draft and publishes only its reviewed delta', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    let pending: CatalogAdminSession | null = null;
    const publishSession = vi.fn(async () => {
      if (pending?.state.kind !== 'review') throw new Error('review required');
      return { revision: 4, delta: pending.state.delta };
    });
    const catalogChat = {
      getReadModel: vi.fn().mockResolvedValue({
        categories: [
          {
            id: '10',
            code: 'starter',
            name: 'قدیمی',
            description: 'قبل',
            position: 1,
            active: true,
          },
        ],
        products: [],
        variants: [],
      }),
      startSession: vi.fn(async (input: { id: string; adminTelegramUserId: string }) => {
        pending = {
          id: input.id,
          adminTelegramUserId: input.adminTelegramUserId,
          baseRevision: 3,
          state: { kind: 'start', step: 'select-action' },
          status: 'pending',
          expiresAt: new Date('2026-08-23T00:00:00.000Z'),
          publishedResult: null,
        };
        return pending;
      }),
      getPendingSession: vi.fn(async () => pending),
      updateSession: vi.fn(async (input: { state: CatalogAdminSession['state'] }) => {
        if (pending === null) throw new Error('missing pending');
        pending = { ...pending, state: input.state };
        return pending;
      }),
      cancelSession: vi.fn(),
      publishSession,
    };
    const bot = createBot(repository, messenger, null, undefined, null, {}, catalogChat);
    const callback = async (updateId: number, data: string) =>
      bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id: `cb-${String(updateId)}`,
          from: { id: 70001, first_name: 'مدیر' },
          message: { message_id: updateId, chat: { id: 70001, type: 'private' }, text: 'فروشگاه' },
          data,
        },
      });

    await callback(810, 'store:edit:c:10');
    expect((pending as CatalogAdminSession | null)?.state).toMatchObject({
      kind: 'category',
      field: 'select',
      mode: 'edit',
    });
    await callback(811, 'store:field:c:name');
    await bot.handleUpdate({
      update_id: 812,
      message: {
        message_id: 812,
        from: { id: 70001, first_name: 'مدیر' },
        chat: { id: 70001, type: 'private' },
        text: 'جدید',
      },
    });
    await callback(813, 'store:field:c:description');
    await bot.handleUpdate({
      update_id: 814,
      message: {
        message_id: 814,
        from: { id: 70001, first_name: 'مدیر' },
        chat: { id: 70001, type: 'private' },
        text: 'توضیح تازه',
      },
    });
    await callback(815, 'store:draft:review');
    expect((pending as CatalogAdminSession | null)?.state).toMatchObject({
      kind: 'review',
      delta: expect.objectContaining({ code: 'starter', name: 'جدید', description: 'توضیح تازه' }),
    });
    expect(publishSession).not.toHaveBeenCalled();
    await callback(816, 'store:publish');
    expect(publishSession).toHaveBeenCalledTimes(1);
  });

  it('guides a free variant title, escaped multiline copy, ordered attributes, provider choice, resume, review and publish', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    let pending: CatalogAdminSession | null = null;
    const publishSession = vi.fn(async () => {
      if (pending?.state.kind !== 'review') throw new Error('review required');
      return { revision: 5, delta: pending.state.delta };
    });
    const catalogChat = {
      getReadModel: vi.fn().mockResolvedValue({ categories: [], products: [], variants: [] }),
      startSession: vi.fn(async (input: { id: string; adminTelegramUserId: string }) => {
        pending = {
          id: input.id,
          adminTelegramUserId: input.adminTelegramUserId,
          baseRevision: 4,
          state: { kind: 'start', step: 'select-action' },
          status: 'pending',
          expiresAt: new Date('2026-08-23T00:00:00.000Z'),
          publishedResult: null,
        };
        return pending;
      }),
      getPendingSession: vi.fn(async () => pending),
      updateSession: vi.fn(async (input: { state: CatalogAdminSession['state'] }) => {
        if (pending === null) throw new Error('missing pending');
        pending = { ...pending, state: input.state };
        return pending;
      }),
      cancelSession: vi.fn(),
      publishSession,
    };
    const bot = createBot(repository, messenger, null, undefined, null, {}, catalogChat, {
      listProviderGroups: vi.fn().mockResolvedValue([
        {
          providerCode: 'catalog-provider',
          groupId: 51,
          name: 'گروه آزمایشی',
          available: true,
          disabled: false,
        },
      ]),
    });
    const callback = async (updateId: number, data: string) =>
      bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id: `guided-${String(updateId)}`,
          from: { id: 70001, first_name: 'مدیر' },
          message: { message_id: updateId, chat: { id: 70001, type: 'private' }, text: 'فروشگاه' },
          data,
        },
      });
    const text = async (updateId: number, value: string) =>
      bot.handleUpdate({
        update_id: updateId,
        message: {
          message_id: updateId,
          from: { id: 70001, first_name: 'مدیر' },
          chat: { id: 70001, type: 'private' },
          text: value,
        },
      });

    await callback(900, 'store:new:guided');
    await text(901, 'دستهٔ ویژه');
    await text(902, 'محصول ویژه');
    await text(903, '50,30,3,100000');
    await text(904, 'پلن <VIP>');
    await text(905, 'خط اول <امن>\nخط دوم & سریع');
    await text(906, 'پروتکل: VLESS\nموقعیت: آلمان\nپشتیبانی: ۲۴/۷\nتحویل: فوری');
    expect((pending as CatalogAdminSession | null)?.state).toMatchObject({
      kind: 'changeset',
      field: 'groupIds',
      values: expect.objectContaining({
        displayAttributes: expect.arrayContaining([
          { position: 0, label: 'پروتکل', value: 'VLESS' },
        ]),
      }),
    });
    await callback(907, 'store:resume');
    await callback(908, 'store:g:51');
    await callback(909, 'store:g:done');
    expect((pending as CatalogAdminSession | null)?.state).toMatchObject({
      kind: 'review',
      delta: expect.objectContaining({
        kind: 'changeset',
        changes: expect.arrayContaining([
          expect.objectContaining({ name: 'دستهٔ ویژه' }),
          expect.objectContaining({ name: 'محصول ویژه' }),
          expect.objectContaining({
            name: 'پلن <VIP>',
            description: 'خط اول <امن>\nخط دوم & سریع',
            groupIds: [51],
            displayAttributes: [
              { position: 0, label: 'پروتکل', value: 'VLESS' },
              { position: 1, label: 'موقعیت', value: 'آلمان' },
              { position: 2, label: 'پشتیبانی', value: '۲۴/۷' },
              { position: 3, label: 'تحویل', value: 'فوری' },
            ],
          }),
        ]),
      }),
    });
    await callback(910, 'store:publish');
    expect(publishSession).toHaveBeenCalledTimes(1);
  });

  it('keeps a hostile admin variant review below the Telegram text limit', async () => {
    const hostile = '<>&'.repeat(200);
    const pending: CatalogAdminSession = {
      id: '2d8e7f38-4dbe-4f09-bc71-68088c005001',
      adminTelegramUserId: '70001',
      baseRevision: 4,
      status: 'pending',
      expiresAt: new Date('2026-08-23T00:00:00.000Z'),
      publishedResult: null,
      state: {
        kind: 'review',
        step: 'confirm',
        delta: {
          kind: 'variant',
          code: 'hostile-variant',
          productCode: 'hostile-product',
          name: hostile,
          description: hostile,
          durationDays: 30,
          dataLimitBytes: 50n * 1024n ** 3n,
          deviceLimit: 3,
          priceIrr: 1_000_000n,
          position: 0,
          sellable: true,
          providerCode: 'catalog-provider',
          groupIds: [51],
          displayAttributes: Array.from({ length: 4 }, (_, position) => ({
            position,
            label: hostile,
            value: hostile,
          })),
        },
      },
    };
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getReadModel: vi.fn().mockResolvedValue({ categories: [], products: [], variants: [] }),
        getPendingSession: vi.fn().mockResolvedValue(pending),
      },
    );
    await bot.handleUpdate({
      update_id: 911,
      callback_query: {
        id: 'hostile-review',
        from: { id: 70001, first_name: 'مدیر' },
        message: { message_id: 911, chat: { id: 70001, type: 'private' }, text: 'فروشگاه' },
        data: 'store:resume',
      },
    });
    const text = vi.mocked(messenger.editMessageText).mock.calls[0]?.[2];
    expect(text).toBeDefined();
    expect(text!.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('&lt;&gt;&amp;');
  });

  it('shows the persistent home menu and completes the update exactly once', async () => {
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
      expect.stringContaining('NEO NETWORK'),
      expect.objectContaining({
        keyboard: [
          [{ text: 'خرید سریع 🛍' }],
          [{ text: 'سرویس‌های من 📡' }],
          [{ text: 'راهنمای انتخاب 🧭' }],
          [{ text: 'پیگیری سفارش 📦' }, { text: 'تمدید سرویس ♻️' }],
          [{ text: 'شارژ کیف پول 💳' }, { text: 'تیکت پشتیبانی 🎫' }],
          [{ text: 'دعوت دوستان 🎁' }],
          [{ text: 'راهنما 📘' }],
          [{ text: 'منوی اصلی 🏠' }],
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

  it('sends configured welcome media on a fresh start and falls back to text when it fails', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger, null, undefined, null, {
      brandMedia: { welcomePhotoFileId: 'welcome-file-id', deliveryPhotoFileId: null },
    });

    await bot.handleUpdate({
      update_id: 101,
      message: {
        message_id: 1,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start',
      },
    });

    expect(messenger.sendPhoto).toHaveBeenCalledWith(
      '10001',
      'welcome-file-id',
      expect.stringContaining('PRIVATE ACCESS'),
      undefined,
      { parseMode: 'HTML' },
    );
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('NEO NETWORK'),
      expect.objectContaining({ keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );

    vi.mocked(messenger.sendPhoto).mockRejectedValueOnce(new Error('TELEGRAM_UNAVAILABLE'));
    await bot.handleUpdate({
      update_id: 102,
      message: {
        message_id: 2,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start',
      },
    });
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('NEO NETWORK'),
      expect.objectContaining({ keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );
  });

  it('limits welcome media to /start commands, not home text or menu callbacks', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger, null, undefined, null, {
      brandMedia: { welcomePhotoFileId: 'welcome-file-id', deliveryPhotoFileId: null },
    });
    const message = (updateId: number, text: string) =>
      bot.handleUpdate({
        update_id: updateId,
        message: {
          message_id: updateId,
          from: { id: 10001, first_name: 'خریدار' },
          chat: { id: 10001, type: 'private' },
          text,
        },
      });

    await message(104, '/start');
    expect(messenger.sendPhoto).toHaveBeenCalledTimes(1);
    await message(105, '/start@bot');
    expect(messenger.sendPhoto).toHaveBeenCalledTimes(2);
    await message(106, 'منوی اصلی');
    expect(messenger.sendPhoto).toHaveBeenCalledTimes(2);

    const sendsBeforeHomeCallback = vi.mocked(messenger.sendMessage).mock.calls.length;
    await bot.handleUpdate({
      update_id: 107,
      callback_query: {
        id: 'cb-home',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 7, chat: { id: 10001, type: 'private' }, text: 'منو' },
        data: 'menu',
      },
    });
    expect(messenger.sendPhoto).toHaveBeenCalledTimes(2);
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '7',
      expect.stringContaining('به منوی اصلی برگشتی'),
      { inline_keyboard: [] },
    );
    expect(messenger.editMessageText).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledTimes(sendsBeforeHomeCallback);
  });

  it('shows the practical selection guide without creating checkout state', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 103,
      callback_query: {
        id: 'cb-guide',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 5, chat: { id: 10001, type: 'private' }, text: 'منو' },
        data: 'guide',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '5',
      expect.stringContaining('تعداد دستگاه'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'shop' })],
        ]),
      }),
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
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
      expect.stringContaining('خرید سریع'),
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

  it('groups a category by product and compares plans three at a time', async () => {
    const repository = createRepository();
    const plans = Array.from({ length: 4 }, (_, index) => ({
      ...variant,
      id: String(index + 20),
      productId: '40',
      productName: 'پریمیوم',
      name: `پلن ${String(index + 1)}`,
      priceIrr: BigInt(index + 1) * 1_000_000n,
    }));
    vi.mocked(repository.getCategory).mockResolvedValue({
      id: '10',
      code: 'economic',
      name: 'اقتصادی',
      description: '',
      parentId: null,
      position: 0,
    });
    vi.mocked(repository.listCategories).mockResolvedValue([]);
    vi.mocked(repository.listSellableVariants).mockResolvedValue(plans);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1201,
      callback_query: {
        id: 'cb-category-products',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 91, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
        data: 'cat:10',
      },
    });
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '91',
      expect.any(String),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'product:10:40:0' })],
        ]),
      }),
    );

    await bot.handleUpdate({
      update_id: 1202,
      callback_query: {
        id: 'cb-product-plans',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 92, chat: { id: 10001, type: 'private' }, text: 'پریمیوم' },
        data: 'product:10:40:0',
      },
    });
    const keyboard = vi.mocked(messenger.editMessageText).mock.calls.at(-1)?.[3]?.inline_keyboard;
    expect(
      keyboard?.filter((row) => {
        const first = row[0];
        return (
          first !== undefined &&
          'callback_data' in first &&
          first.callback_data.startsWith('variant:')
        );
      }),
    ).toHaveLength(3);
    expect(JSON.stringify(keyboard)).toContain('product:10:40:1');
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

  it('shows representative list prices when the buyer is an active representative', async () => {
    const repository = createRepository();
    const priced = {
      ...variant,
      priceIrr: 900_000n,
      pricingSource: 'representative_override' as const,
    };
    vi.mocked(repository.getCategory).mockResolvedValue({
      id: '10',
      code: 'economic',
      name: 'اقتصادی',
      description: 'سرویس مستقیم',
      parentId: null,
      position: 0,
    });
    vi.mocked(repository.listCategories).mockResolvedValue([]);
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '9', code: 'rep-one' });
    repository.listSellableVariantsForRepresentative = vi.fn().mockResolvedValue([priced]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 128,
      callback_query: {
        id: 'cb-rep-price',
        from: { id: 10001, first_name: 'نماینده' },
        message: {
          message_id: 17,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'cat:10',
      },
    });

    expect(repository.listSellableVariantsForRepresentative).toHaveBeenCalledWith('10', '9');
    expect(repository.listSellableVariants).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '17',
      expect.any(String),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining('یک‌ماهه'),
              callback_data: 'variant:2',
            }),
          ]),
        ]),
      }),
    );
    const keyboard = JSON.stringify(vi.mocked(messenger.editMessageText).mock.calls[0]?.[3]);
    expect(keyboard).toContain('۹۰٬۰۰۰ ت');
    expect(keyboard).not.toContain('۱۵۰٬۰۰۰ ت');
  });

  it('lists each plan button on its own row in a category', async () => {
    const secondVariant: SellableProductVariant = {
      ...variant,
      id: '3',
      code: 'economic-90',
      name: 'سه‌ماهه',
      durationDays: 90,
      priceIrr: 3_500_000n,
    };
    const repository = createRepository();
    vi.mocked(repository.getCategory).mockResolvedValue({
      id: '10',
      code: 'economic',
      name: 'اقتصادی',
      description: 'سرویس مستقیم',
      parentId: null,
      position: 0,
    });
    vi.mocked(repository.listCategories).mockResolvedValue([]);
    vi.mocked(repository.listSellableVariants).mockResolvedValue([variant, secondVariant]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 129,
      callback_query: {
        id: 'cb-plan-rows',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 18,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'cat:10',
      },
    });

    const keyboard = vi.mocked(messenger.editMessageText).mock.calls[0]?.[3]?.inline_keyboard;
    expect(keyboard).toBeDefined();
    const variantRows = keyboard!.filter((row) =>
      row.some(
        (button) =>
          'callback_data' in button &&
          typeof button.callback_data === 'string' &&
          button.callback_data.startsWith('variant:'),
      ),
    );
    expect(variantRows).toHaveLength(2);
    expect(variantRows.every((row) => row.length === 1)).toBe(true);
  });

  it('shows a clear message when a category is unavailable', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCategory).mockResolvedValue(null);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1291,
      callback_query: {
        id: 'cb-missing-category',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 181,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'cat:999',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '181',
      expect.stringContaining('دسته در دسترس نیست'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [{ text: 'خرید سریع ⬅️', callback_data: 'shop' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
        ]),
      }),
    );
  });

  it('shows variant details with checkout and shop-back actions', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1292,
      callback_query: {
        id: 'cb-variant-detail',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 182,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'variant:2',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '182',
      expect.stringContaining('قیمت:'),
      {
        inline_keyboard: [
          [{ text: 'ادامه و دریافت شماره کارت 💳', callback_data: 'buy:2' }],
          [{ text: 'خرید سریع ⬅️', callback_data: 'shop' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
        ],
      },
    );
  });

  it('takes an administrator from an empty shop to chat store management', async () => {
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
      expect.stringContaining('فروشگاه خالی است'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [{ text: 'مدیریت فروشگاه 🏪', callback_data: 'admin:store' }],
        ]),
      }),
    );
  });

  it('keeps empty-shop customer copy free of administrator instructions', async () => {
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

  it('shows unavailable-category copy when a category id is missing', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCategory).mockResolvedValue(null);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 130,
      callback_query: {
        id: 'cb-missing-cat',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 19,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'cat:404',
      },
    });

    const text = vi.mocked(messenger.editMessageText).mock.calls[0]?.[2] ?? '';
    expect(text).toContain('دسته در دسترس نیست');
    expect(text).not.toContain('پلن فعالی');
    const keyboard = JSON.stringify(vi.mocked(messenger.editMessageText).mock.calls[0]?.[3]);
    expect(keyboard).toContain('"callback_data":"shop"');
    expect(keyboard).toContain('خرید سریع');
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
      expect.stringContaining('NEO NETWORK'),
      expect.objectContaining({
        keyboard: expect.arrayContaining([[{ text: 'بخش ادمین 👨‍💻' }]]),
        is_persistent: true,
      }),
      { parseMode: 'HTML' },
    );
  });

  it('opens the private chat store-management hub without a console launcher', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 132,
      message: {
        message_id: 22,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: 'بخش ادمین 👨‍💻',
      },
    });

    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('مدیریت فروشگاه'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [{ text: 'مدیریت فروشگاه 🏪', callback_data: 'admin:store' }],
        ]),
      }),
      { parseMode: 'HTML' },
    );
    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('opens store management from its exact reply-keyboard label for an administrator', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1321,
      message: {
        message_id: 221,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: MENU_LABEL.store,
      },
    });

    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('مدیریت فروشگاه'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'store:create' })],
        ]),
      }),
      { parseMode: 'HTML' },
    );
  });

  it('does not let a non-administrator open store management from reply text', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await expect(
      bot.handleUpdate({
        update_id: 1322,
        message: {
          message_id: 222,
          from: { id: 10001, first_name: 'خریدار' },
          chat: { id: 10001, type: 'private' },
          text: 'مدیریت فروشگاه',
        },
      }),
    ).resolves.toBeUndefined();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('فقط برای مدیر فروشگاه'),
      expect.objectContaining({
        inline_keyboard: [[{ text: 'منوی اصلی 🏠', callback_data: 'menu' }]],
      }),
      { parseMode: 'HTML' },
    );
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('1322');
  });

  it('opens the private chat store-management hub for an authorized admin', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1361,
      callback_query: {
        id: 'cb-store',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 251, chat: { id: 70001, type: 'private' }, text: 'ادمین' },
        data: 'admin:store',
      },
    });
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '251',
      expect.stringContaining('مدیریت فروشگاه'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'store:create' })],
        ]),
      }),
    );
  });

  it('completes a successful store callback when its callback acknowledgement has expired', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    vi.mocked(messenger.answerCallbackQuery).mockRejectedValueOnce(new Error('TELEGRAM_HTTP_400'));
    const bot = createBot(repository, messenger);

    await expect(
      bot.handleUpdate({
        update_id: 13611,
        callback_query: {
          id: 'cb-store-expired',
          from: { id: 70001, first_name: 'ادمین' },
          message: { message_id: 2511, chat: { id: 70001, type: 'private' }, text: 'ادمین' },
          data: 'admin:store',
        },
      }),
    ).resolves.toBeUndefined();

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '70001',
      '2511',
      expect.stringContaining('مدیریت فروشگاه'),
      expect.any(Object),
    );
    expect(messenger.answerCallbackQuery).toHaveBeenCalledWith('cb-store-expired');
  });

  it('preserves the original callback error when acknowledging the failure also fails', async () => {
    const repository = createRepository();
    vi.mocked(repository.getSellableVariant).mockRejectedValueOnce(new Error('ORIGINAL_FAILURE'));
    const messenger = createMessenger();
    vi.mocked(messenger.answerCallbackQuery).mockRejectedValueOnce(new Error('TELEGRAM_HTTP_400'));
    const bot = createBot(repository, messenger);

    await expect(
      bot.handleUpdate({
        update_id: 13612,
        callback_query: {
          id: 'cb-buy-error',
          from: { id: 10001, first_name: 'خریدار' },
          message: { message_id: 2512, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
          data: 'buy:2',
        },
      }),
    ).rejects.toThrow('ORIGINAL_FAILURE');
    expect(messenger.answerCallbackQuery).toHaveBeenCalledWith(
      'cb-buy-error',
      'خطای موقت؛ دوباره تلاش کن.',
    );
  });

  it('paginates chat-store categories in eight rows with numeric callback targets', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const categories = Array.from({ length: 10 }, (_, index) => ({
      id: String(index + 1),
      code: `category-${String(index + 1)}`,
      name: `دسته ${String(index + 1)}`,
      description: '',
      position: index,
      active: true,
    }));
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getReadModel: vi.fn().mockResolvedValue({ categories, products: [], variants: [] }),
      },
    );
    await bot.handleUpdate({
      update_id: 1362,
      callback_query: {
        id: 'cb-store-list',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 252, chat: { id: 70001, type: 'private' }, text: 'ادمین' },
        data: 'store:list:c:0',
      },
    });
    const keyboard = vi.mocked(messenger.editMessageText).mock.calls[0]?.[3];
    const callbacks =
      keyboard?.inline_keyboard
        .flat()
        .flatMap((button) => ('callback_data' in button ? [button.callback_data] : [])) ?? [];
    expect(callbacks.filter((item) => item.startsWith('store:detail:c:'))).toHaveLength(8);
    expect(callbacks.every((item) => Buffer.byteLength(item, 'utf8') <= 64)).toBe(true);
    expect(callbacks).toContain('store:list:c:1');
  });

  it('does not open store management from a group chat or a non-admin identity', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1363,
      callback_query: {
        id: 'cb-store-denied',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 253, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
        data: 'admin:store',
      },
    });
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '253',
      expect.stringContaining('فقط برای مدیر فروشگاه'),
      expect.any(Object),
    );
    expect(vi.mocked(messenger.editMessageText).mock.calls[0]?.[2]).not.toContain(
      'NEO NETWORK — مدیریت فروشگاه',
    );
    await bot.handleUpdate({
      update_id: 1364,
      callback_query: {
        id: 'cb-store-group',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 254, chat: { id: -100, type: 'group' }, text: 'گروه' },
        data: 'admin:store',
      },
    });
    expect(messenger.editMessageText).toHaveBeenCalledTimes(1);
  });

  it('masks and removes a card-number input while preserving the settings wizard', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const pending = {
      id: 'session-1',
      adminTelegramUserId: '70001',
      baseRevision: 1,
      status: 'pending' as const,
      expiresAt: new Date('2026-08-23T00:00:00.000Z'),
      publishedResult: null,
      state: {
        kind: 'settings' as const,
        step: 'settings-fields' as const,
        field: 'cardNumber' as const,
        values: {
          brandName: 'NEO',
          heroTitle: 'فروشگاه',
          heroSubtitle: '',
          deliveryNote: '',
          supportNote: '',
          volumeHelper: '',
          cardNumber: '1111222233334444',
          cardHolder: 'صاحب کارت',
        },
      },
    };
    const updateSession = vi.fn().mockResolvedValue(pending);
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getPendingSession: vi.fn().mockResolvedValue(pending),
        updateSession,
      },
    );
    await bot.handleUpdate({
      update_id: 1365,
      message: {
        message_id: 255,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: '۵۵۵۵۶۶۶۶۷۷۷۷۸۸۸۸',
      },
    });
    expect(messenger.deleteMessage).toHaveBeenCalledWith('70001', '255');
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          values: expect.objectContaining({ cardNumber: '5555666677778888' }),
        }),
      }),
    );
    const text = vi.mocked(messenger.sendMessage).mock.calls.at(-1)?.[1] ?? '';
    expect(text).not.toContain('5555666677778888');
  });

  it('keeps a restored variant out of sale until a reviewed enable-sale action', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const variants = [
      {
        id: '7',
        code: 'plan-7',
        name: 'پلن اقتصادی',
        description: '',
        productId: '5',
        productCode: 'product-5',
        durationDays: 30,
        dataLimitBytes: 30n * 1024n ** 3n,
        deviceLimit: 1,
        priceIrr: 900_000n,
        position: 0,
        active: true,
        sellable: false,
        providerCode: 'provider',
        groupIds: [11],
      },
    ];
    const startSession = vi.fn().mockResolvedValue({
      id: 'session-2',
      adminTelegramUserId: '70001',
      baseRevision: 1,
      status: 'pending',
      state: { kind: 'start', step: 'select-action' },
      expiresAt: new Date('2026-08-23T00:00:00.000Z'),
      publishedResult: null,
    });
    const updateSession = vi.fn().mockResolvedValue(undefined);
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getReadModel: vi.fn().mockResolvedValue({ categories: [], products: [], variants }),
        startSession,
        updateSession,
        getPendingSession: vi.fn().mockResolvedValue(null),
      },
    );
    await bot.handleUpdate({
      update_id: 1366,
      callback_query: {
        id: 'cb-restored',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 256, chat: { id: 70001, type: 'private' }, text: 'پلن' },
        data: 'store:detail:v:7',
      },
    });
    expect(JSON.stringify(vi.mocked(messenger.editMessageText).mock.calls[0]?.[3])).toContain(
      'store:enable:v:7',
    );
    await bot.handleUpdate({
      update_id: 1367,
      callback_query: {
        id: 'cb-enable',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 257, chat: { id: 70001, type: 'private' }, text: 'پلن' },
        data: 'store:enable:v:7',
      },
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          delta: expect.objectContaining({ kind: 'variant', sellable: true }),
        }),
      }),
    );
    expect(JSON.stringify(vi.mocked(messenger.editMessageText).mock.calls.at(-1)?.[3])).toContain(
      'store:publish',
    );
  });

  it('keeps immutable and archived variant fields when editing custom dimensions', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const variantRow = {
      id: '9',
      code: 'archived-plan',
      name: 'پلن قدیمی',
      description: 'توضیح نگهداری‌شده',
      productId: '4',
      productCode: 'archived-product',
      durationDays: 30,
      dataLimitBytes: 30n * 1024n ** 3n,
      deviceLimit: 2,
      priceIrr: 1_000_000n,
      position: 6,
      active: false,
      sellable: false,
      providerCode: 'provider-a',
      groupIds: [21],
    };
    const base = {
      id: 'session-edit',
      adminTelegramUserId: '70001',
      baseRevision: 1,
      status: 'pending' as const,
      expiresAt: new Date('2026-08-23T00:00:00.000Z'),
      publishedResult: null,
    };
    let pending: unknown = null;
    const updateSession = vi.fn(async (input: { state: unknown }) => {
      pending = { ...base, state: input.state };
      return pending;
    });
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        startSession: vi
          .fn()
          .mockResolvedValue({ ...base, state: { kind: 'start', step: 'select-action' } }),
        updateSession,
        getPendingSession: vi.fn(async () => pending),
        getReadModel: vi
          .fn()
          .mockResolvedValue({ categories: [], products: [], variants: [variantRow] }),
      },
      {
        listProviderGroups: vi.fn().mockResolvedValue([
          {
            providerCode: 'provider-a',
            groupId: 21,
            name: 'گروه اول',
            available: true,
            disabled: false,
          },
        ]),
      },
    );
    await bot.handleUpdate({
      update_id: 1368,
      callback_query: {
        id: 'cb-edit-variant',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 258, chat: { id: 70001, type: 'private' }, text: 'پلن' },
        data: 'store:edit:v:9',
      },
    });
    await bot.handleUpdate({
      update_id: 1369,
      message: {
        message_id: 259,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: '۵۰، ۶۰، ۳، ۲۰۰۰۰۰',
      },
    });
    const state = (
      updateSession.mock.calls.at(-1)?.[0] as { state: { values: Record<string, unknown> } }
    ).state.values;
    expect(state).toMatchObject({
      code: 'archived-plan',
      description: 'توضیح نگهداری‌شده',
      position: 6,
      sellable: false,
      groupIds: [21],
    });
    expect(state).not.toHaveProperty('active');
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
          [expect.objectContaining({ callback_data: 'admin:order:3' })],
          [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
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
          [expect.objectContaining({ callback_data: 'admin:order:3' })],
          [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
          [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
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

  it('delegates approval delivery to the durable job and edits the link into one anchor', async () => {
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
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([
      {
        id: '9',
        orderId: order.id,
        customerId: customer.id,
        serviceId: service.id,
        stage: 'pending_brand_media',
        attemptCount: 1,
        claimVersion: '1',
        telegramMessageId: null,
      },
    ]);
    vi.mocked(repository.getOrderDeliveryTarget).mockResolvedValue({
      chatId: customer.privateChatId,
      subscriptionUrl: service.subscriptionUrl,
    });
    const messenger = createMessenger();
    const delivery = createDelivery(repository, messenger, 'delivery-file-id');
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {
        brandMedia: { welcomePhotoFileId: null, deliveryPhotoFileId: 'delivery-file-id' },
      },
      {},
      {},
      delivery,
    );

    await bot.handleUpdate({
      update_id: 1231,
      callback_query: {
        id: 'cb-approve-success',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 13, chat: { id: 70001, type: 'private' }, text: 'رسید' },
        data: 'approve:3',
      },
    });

    expect(messenger.sendPhoto).toHaveBeenCalledWith(
      '10001',
      'delivery-file-id',
      expect.any(String),
      undefined,
      { parseMode: 'HTML' },
    );
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('در همین پیام ثبت می‌شود'),
      undefined,
      { parseMode: 'HTML' },
    );
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '1',
      expect.stringContaining(service.subscriptionUrl),
    );
    for (const call of vi.mocked(messenger.sendMessage).mock.calls) {
      expect(call[1]).not.toContain(service.subscriptionUrl);
    }
    expect(repository.markDeliveryJobBrandSent).toHaveBeenCalledWith('9', '1', expect.any(Date));
    expect(repository.markDeliveryJobAnchor).toHaveBeenCalledWith('9', '1', '1', expect.any(Date));
    expect(repository.markDeliveryJobDelivered).toHaveBeenCalledWith('9', '1', expect.any(Date));
    expect(messenger.sendMessage).toHaveBeenCalledWith('70001', 'سفارش تکمیل شد.');
  });

  it('does not present a post-completion reporting failure as provisioning failure', async () => {
    const fulfilled = { ...order, status: 'fulfilled' as const, serviceId: service.id };
    const repository = createRepository();
    vi.mocked(repository.reserveProvisioning).mockResolvedValue({
      ...order,
      status: 'provisioning',
    });
    vi.mocked(repository.completeOrder).mockResolvedValue(fulfilled);
    vi.mocked(repository.getOrder).mockResolvedValue(fulfilled);
    const reporting = {
      record: vi
        .fn()
        .mockResolvedValueOnce({ id: 'approved', created: true })
        .mockRejectedValueOnce(new Error('REPORTING_UNAVAILABLE')),
      dispatchDue: vi.fn(),
    };
    const messenger = createMessenger();
    const delivery = createDelivery(repository, messenger);
    const bot = createBot(
      repository,
      messenger,
      reporting as never,
      undefined,
      null,
      {},
      {},
      {},
      delivery,
    );

    await expect(
      bot.handleUpdate({
        update_id: 1232,
        callback_query: {
          id: 'cb-approve-report-failure',
          from: { id: 70001, first_name: 'ادمین' },
          message: { message_id: 14, chat: { id: 70001, type: 'private' }, text: 'رسید' },
          data: 'approve:3',
        },
      }),
    ).rejects.toThrow('REPORTING_UNAVAILABLE');

    expect(repository.backfillMissingDeliveryJobs).toHaveBeenCalled();
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('ساخت سرویس الان تمام نشد'),
    );
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('بعداً'),
      expect.anything(),
    );
  });

  it('does not present a fulfilled retry reporting failure as provisioning failure', async () => {
    const fulfilled = { ...order, status: 'fulfilled' as const, serviceId: service.id };
    const repository = createRepository();
    vi.mocked(repository.getOrder).mockResolvedValue(fulfilled);
    const reporting = {
      record: vi.fn().mockRejectedValue(new Error('REPORTING_UNAVAILABLE')),
      dispatchDue: vi.fn(),
    };
    const messenger = createMessenger();
    const delivery = createDelivery(repository, messenger);
    const create = vi.fn();
    const renew = vi.fn();
    const bot = createBot(
      repository,
      messenger,
      reporting as never,
      { create, renew },
      null,
      {},
      {},
      {},
      delivery,
    );

    await expect(
      bot.handleUpdate({
        update_id: 1233,
        callback_query: {
          id: 'cb-retry-report-failure',
          from: { id: 70001, first_name: 'ادمین' },
          message: { message_id: 15, chat: { id: 70001, type: 'private' }, text: 'سفارش' },
          data: 'admin:retry:3',
        },
      }),
    ).rejects.toThrow('REPORTING_UNAVAILABLE');

    expect(create).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
    expect(repository.backfillMissingDeliveryJobs).toHaveBeenCalled();
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('ساخت سرویس الان تمام نشد'),
    );
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('بعداً'),
      expect.anything(),
    );
  });

  it('keeps the order fulfilled when only the delivery edit fails and retries stay provider-free', async () => {
    const repository = createRepository();
    vi.mocked(repository.completeOrder).mockResolvedValue({
      ...order,
      status: 'fulfilled',
      serviceId: service.id,
    });
    vi.mocked(repository.getDeliveryJobForOrder).mockResolvedValue({
      id: '9',
      orderId: order.id,
      customerId: customer.id,
      serviceId: service.id,
      stage: 'failed',
      attemptCount: 3,
      claimVersion: '2',
      nextAttemptAt: new Date('2026-08-21T00:00:00.000Z'),
      lastErrorCode: 'TELEGRAM_HTTP_500',
      telegramMessageId: '77',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    });
    vi.mocked(repository.resetDeliveryJob).mockResolvedValue({
      id: '9',
      orderId: order.id,
      customerId: customer.id,
      serviceId: service.id,
      stage: 'pending_link',
      attemptCount: 0,
      claimVersion: '3',
      nextAttemptAt: new Date('2026-08-21T00:05:00.000Z'),
      lastErrorCode: null,
      telegramMessageId: '77',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      updatedAt: new Date('2026-08-21T00:05:00.000Z'),
    });
    vi.mocked(repository.getOrderDeliveryTarget).mockResolvedValue({
      chatId: customer.privateChatId,
      subscriptionUrl: service.subscriptionUrl,
    });
    vi.mocked(repository.claimDueDeliveryJobs).mockResolvedValue([
      {
        id: '9',
        orderId: order.id,
        customerId: customer.id,
        serviceId: service.id,
        stage: 'pending_link',
        attemptCount: 4,
        claimVersion: '4',
        telegramMessageId: '77',
      },
    ]);
    const messenger = createMessenger();
    const serviceReaderGet = vi.fn();
    const delivery = createDelivery(repository, messenger);
    const bot = createBot(
      repository,
      messenger,
      null,
      {
        create: vi.fn(),
        renew: vi.fn(),
      },
      null,
      {},
      {},
      { get: serviceReaderGet },
      delivery,
    );

    await bot.handleUpdate({
      update_id: 1232,
      callback_query: {
        id: 'cb-redeliver',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 14, chat: { id: 70001, type: 'private' }, text: 'صف' },
        data: `admin:redeliver:${order.id}`,
      },
    });

    expect(serviceReaderGet).not.toHaveBeenCalled();
    expect(repository.resetDeliveryJob).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '77',
      expect.stringContaining(service.subscriptionUrl),
    );
    expect(repository.markDeliveryJobDelivered).toHaveBeenCalledWith('9', '4', expect.any(Date));
    expect(vi.mocked(messenger.editMessageText).mock.calls[0]?.[2]).toContain('ارسال دوباره');
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

  it('shows renewal confirmation without mutating the service', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const provisioner = {
      create: vi.fn().mockResolvedValue(service),
      renew: vi.fn().mockRejectedValue(new Error('PASARGUARD_UNAVAILABLE')),
    };
    const bot = createBot(repository, messenger, null, provisioner);

    const renewCallback = (updateId: number, id: string, data: string) =>
      bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id,
          from: { id: 10001, first_name: 'خریدار' },
          message: {
            message_id: 14,
            chat: { id: 10001, type: 'private' },
            text: 'منو',
          },
          data,
        },
      });

    await expect(renewCallback(125, 'cb-renew', 'renew')).resolves.toBeUndefined();
    await expect(renewCallback(1251, 'cb-renew-skip', 'flow:skip-coupon')).resolves.toBeUndefined();

    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('125');
    expect(repository.failTelegramUpdate).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '14',
      expect.stringContaining('تمدید فقط پس از تأیید رسید انجام می‌شود'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'renew:confirm' })],
        ]),
      }),
    );
    expect(provisioner.renew).not.toHaveBeenCalled();
  });

  it('creates a paid renewal order only after confirmation and never renews directly', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const provisioner = {
      create: vi.fn().mockResolvedValue(service),
      renew: vi.fn().mockResolvedValue(service),
    };
    const bot = createBot(repository, messenger, null, provisioner);
    const callback = (updateId: number, id: string, data: string) =>
      bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id,
          from: { id: 10001, first_name: 'خریدار' },
          message: { message_id: updateId, chat: { id: 10001, type: 'private' }, text: 'منو' },
          data,
        },
      });

    await callback(126, 'cb-renew-preview', 'renew');
    await callback(127, 'cb-renew-back', 'menu');
    expect(provisioner.renew).not.toHaveBeenCalled();
    expect(repository.createRenewalOrder).not.toHaveBeenCalled();

    await callback(128, 'cb-renew-stale', 'renew:confirm');
    expect(repository.createRenewalOrder).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '128',
      expect.stringContaining('این مرحله منقضی شد'),
      expect.any(Object),
    );

    await callback(129, 'cb-renew-again', 'renew');
    await callback(130, 'cb-renew-skip', 'flow:skip-coupon');
    await callback(131, 'cb-renew-confirm', 'renew:confirm');
    expect(repository.createRenewalOrder).toHaveBeenCalledWith(
      customer.id,
      'telegram:131:renew',
      undefined,
    );
    expect(provisioner.renew).not.toHaveBeenCalled();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '131',
      expect.stringContaining('سفارش ثبت شد؛ نوبت پرداخت است'),
      expect.any(Object),
    );
  });

  it('stores a photo proof with its media kind and never forwards it directly to administrators', async () => {
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
      'photo',
    );
    expect(messenger.sendPhoto).not.toHaveBeenCalled();
    expect(messenger.sendDocument).not.toHaveBeenCalled();
    expect(repository.completeTelegramUpdate).toHaveBeenCalledWith('101');
  });

  it('lets an administrator retrieve the stored photo proof on demand without exposing its file id', async () => {
    const repository = createRepository();
    vi.mocked(repository.getPaymentProof).mockResolvedValue({
      id: '20',
      orderId: order.id,
      telegramFileId: 'receipt-file-id',
      telegramFileUniqueId: 'receipt-unique',
      mediaKind: 'photo',
      submittedAt: new Date('2026-08-21T00:00:00.000Z'),
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 140,
      callback_query: {
        id: 'cb-proof-photo',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 21, chat: { id: 70001, type: 'private' }, text: 'سفارش' },
        data: `admin:proof:${order.id}`,
      },
    });

    expect(repository.getPaymentProof).toHaveBeenCalledWith(order.id);
    expect(messenger.sendPhoto).toHaveBeenCalledWith(
      '70001',
      'receipt-file-id',
      expect.stringContaining(order.id),
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );
  });

  it('sends a document-kind proof with sendDocument and rejects non-administrators', async () => {
    const repository = createRepository();
    vi.mocked(repository.getPaymentProof).mockResolvedValue({
      id: '20',
      orderId: order.id,
      telegramFileId: 'receipt-doc-id',
      telegramFileUniqueId: 'receipt-doc-unique',
      mediaKind: 'document',
      submittedAt: new Date('2026-08-21T00:00:00.000Z'),
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 141,
      callback_query: {
        id: 'cb-proof-document',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 22, chat: { id: 70001, type: 'private' }, text: 'سفارش' },
        data: `admin:proof:${order.id}`,
      },
    });
    expect(messenger.sendDocument).toHaveBeenCalledWith(
      '70001',
      'receipt-doc-id',
      expect.any(String),
      expect.any(Object),
      { parseMode: 'HTML' },
    );

    const outsiderMessenger = createMessenger();
    const outsiderBot = createBot(repository, outsiderMessenger);
    await outsiderBot.handleUpdate({
      update_id: 142,
      callback_query: {
        id: 'cb-proof-outsider',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 23, chat: { id: 10001, type: 'private' }, text: 'سفارش' },
        data: `admin:proof:${order.id}`,
      },
    });
    expect(outsiderMessenger.sendPhoto).not.toHaveBeenCalled();
    expect(outsiderMessenger.sendDocument).not.toHaveBeenCalled();

    vi.mocked(repository.getPaymentProof).mockResolvedValue(null);
    await bot.handleUpdate({
      update_id: 143,
      callback_query: {
        id: 'cb-proof-missing',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 24, chat: { id: 70001, type: 'private' }, text: 'سفارش' },
        data: `admin:proof:${order.id}`,
      },
    });
    expect(vi.mocked(messenger.editMessageText).mock.calls.at(-1)?.[2]).toContain('رسیدی ثبت نشده');
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

  it('accepts an image document as a receipt, persists its kind, and skips direct forwarding', async () => {
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
      'document',
    );
    expect(messenger.sendDocument).not.toHaveBeenCalled();
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
  it('prompts for a service username base before checkout', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1293,
      callback_query: {
        id: 'cb-buy',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 183,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'buy:2',
      },
    });

    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '183',
      expect.stringContaining('نام سرویس را انتخاب کن'),
      expect.any(Object),
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('starts checkout after a valid username base for a representative buyer', async () => {
    const repository = createRepository();
    repository.findRepresentativeByTelegramUserId = vi
      .fn()
      .mockResolvedValue({ id: '9', code: 'rep-a' });
    repository.getSellableVariantForRepresentative = vi.fn().mockResolvedValue(variant);
    repository.createOrder = vi.fn().mockResolvedValue({ ...order, representativeCode: 'rep-a' });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);

    await bot.handleUpdate({
      update_id: 1294,
      callback_query: {
        id: 'cb-buy-rep',
        from: { id: 40005, first_name: 'نماینده' },
        message: {
          message_id: 184,
          chat: { id: 40005, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'buy:2',
      },
    });
    await bot.handleUpdate({
      update_id: 1295,
      message: {
        message_id: 185,
        chat: { id: 40005, type: 'private' },
        from: { id: 40005, first_name: 'نماینده' },
        text: 'rep_user',
      },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
    await bot.handleUpdate({
      update_id: 1296,
      callback_query: {
        id: 'cb-skip-coupon',
        from: { id: 40005, first_name: 'نماینده' },
        message: {
          message_id: 186,
          chat: { id: 40005, type: 'private' },
          text: 'کد تخفیف',
        },
        data: 'flow:skip-coupon',
      },
    });

    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.id,
      '2',
      'telegram:1296:buy:2',
      '9',
      'rep_user',
    );
  });

  it('resumes purchase naming after bot reconstruction without a duplicate checkout', async () => {
    const repository = createRepository();
    repository.createOrder = vi.fn().mockResolvedValue(order);
    repository.getOrder = vi.fn().mockResolvedValue(order);
    const first = createBot(repository, createMessenger());
    await first.handleUpdate({
      update_id: 1401,
      callback_query: {
        id: 'cb-buy-restart',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 201,
          chat: { id: 10001, type: 'private' },
          text: 'فروشگاه',
        },
        data: 'buy:2',
      },
    });
    const reconstructed = createBot(repository, createMessenger());
    await reconstructed.handleUpdate({
      update_id: 1402,
      message: {
        message_id: 202,
        chat: { id: 10001, type: 'private' },
        from: { id: 10001, first_name: 'خریدار' },
        text: 'ali_reza',
      },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
    await reconstructed.handleUpdate({
      update_id: 1403,
      callback_query: {
        id: 'cb-skip-restart',
        from: { id: 10001, first_name: 'خریدار' },
        message: {
          message_id: 203,
          chat: { id: 10001, type: 'private' },
          text: 'کد تخفیف',
        },
        data: 'flow:skip-coupon',
      },
    });
    expect(repository.createOrder).toHaveBeenCalledTimes(1);
    expect(repository.createOrder).toHaveBeenCalledWith(
      customer.id,
      '2',
      'telegram:1403:buy:2',
      undefined,
      'ali_reza',
    );
    await reconstructed.handleUpdate({
      update_id: 1404,
      message: {
        message_id: 204,
        chat: { id: 10001, type: 'private' },
        from: { id: 10001, first_name: 'خریدار' },
        text: 'unrelated after complete',
      },
    });
    expect(repository.createOrder).toHaveBeenCalledTimes(1);
  });

  it('releases a purchase naming session when the shop reply-keyboard label is tapped', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1501,
      callback_query: {
        id: 'cb-buy-nav',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 301, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
        data: 'buy:2',
      },
    });
    await bot.handleUpdate({
      update_id: 1502,
      message: {
        message_id: 302,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: MENU_LABEL.shop,
      },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(await repository.getPendingConversationSession('10001')).toBeNull();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('فروشگاه خالی است'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
  });

  it('releases a purchase naming session when shop-back is tapped and does not treat it as a username', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1503,
      callback_query: {
        id: 'cb-buy-shopback',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 303, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
        data: 'buy:2',
      },
    });
    await bot.handleUpdate({
      update_id: 1504,
      callback_query: {
        id: 'cb-shop-back',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 304, chat: { id: 10001, type: 'private' }, text: 'نام' },
        data: 'shop',
      },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(await repository.getPendingConversationSession('10001')).toBeNull();
    expect(messenger.editMessageText).toHaveBeenCalledWith(
      '10001',
      '304',
      expect.stringContaining('فروشگاه خالی است'),
      expect.any(Object),
    );
  });

  it('returns /start during purchase naming to home instead of treating it as a username', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1505,
      callback_query: {
        id: 'cb-buy-start',
        from: { id: 10001, first_name: 'خریدار' },
        message: { message_id: 305, chat: { id: 10001, type: 'private' }, text: 'فروشگاه' },
        data: 'buy:2',
      },
    });
    await bot.handleUpdate({
      update_id: 1506,
      message: {
        message_id: 306,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start',
      },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(await repository.getPendingConversationSession('10001')).toBeNull();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('NEO NETWORK'),
      expect.objectContaining({ keyboard: expect.any(Array) }),
      { parseMode: 'HTML' },
    );
  });

  it('does not consume administrator menu labels as catalog wizard field text', async () => {
    const pending: CatalogAdminSession = {
      id: '2d8e7f38-4dbe-4f09-bc71-68088c005002',
      adminTelegramUserId: '70001',
      baseRevision: 4,
      status: 'pending',
      expiresAt: new Date('2026-09-06T00:00:00.000Z'),
      publishedResult: null,
      state: {
        kind: 'category',
        step: 'category-fields',
        field: 'name',
        values: { code: 'cat-open' },
      },
    };
    const updateSession = vi.fn();
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getReadModel: vi.fn().mockResolvedValue({ categories: [], products: [], variants: [] }),
        getPendingSession: vi.fn().mockResolvedValue(pending),
        updateSession,
      },
    );
    await bot.handleUpdate({
      update_id: 1601,
      message: {
        message_id: 401,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: MENU_LABEL.shop,
      },
    });
    expect(updateSession).not.toHaveBeenCalled();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('فروشگاه خالی است'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
  });

  it('keeps the store picker page indicator from canceling the wizard', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(
      repository,
      messenger,
      null,
      undefined,
      null,
      {},
      {
        getReadModel: vi.fn().mockResolvedValue({
          categories: [
            {
              id: '10',
              code: 'economic',
              name: 'اقتصادی',
              description: '',
              parentId: null,
              position: 0,
              active: true,
            },
          ],
          products: [],
          variants: [],
        }),
        getPendingSession: vi.fn().mockResolvedValue(null),
      },
    );
    await bot.handleUpdate({
      update_id: 1602,
      callback_query: {
        id: 'cb-picker',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 402, chat: { id: 70001, type: 'private' }, text: 'انتخاب' },
        data: 'store:picker:category:0',
      },
    });
    const keyboard = JSON.stringify(vi.mocked(messenger.editMessageText).mock.calls[0]?.[3]);
    expect(keyboard).toContain('"callback_data":"store:picker:category:0"');
    expect(keyboard).toContain('"callback_data":"store:cancel"');
    expect(keyboard).not.toMatch(/"text":"1\/1","callback_data":"store:cancel"/u);
  });

  it('refuses a second trial and does not provision again', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCommercialSettings).mockResolvedValue({
      trialEnabled: true,
      trialVariantId: variant.id,
      forcedJoinChannels: [],
      remindersEnabled: true,
      expiryReminderDays: 3,
      lowTrafficPercent: 15,
      referralEnabled: false,
      referralReferrerCreditIrr: 0n,
      referralInviteeDiscountIrr: 0n,
      referralMaxRewardsPerReferrer: 50,
      updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    vi.mocked(repository.getTrialClaim).mockResolvedValue({
      customerId: customer.id,
      orderId: order.id,
      claimedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const provisioner = { create: vi.fn(), renew: vi.fn() };
    const messenger = createMessenger();
    const bot = createBot(repository, messenger, null, provisioner);
    await bot.handleUpdate({
      update_id: 1701,
      message: {
        message_id: 501,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: MENU_LABEL.trial,
      },
    });
    expect(provisioner.create).not.toHaveBeenCalled();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('قبلاً استفاده شده'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
  });

  it('fails closed on channel membership errors and never opens shop', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCommercialSettings).mockResolvedValue({
      trialEnabled: false,
      trialVariantId: null,
      forcedJoinChannels: [{ chatId: '@NeoShop', username: 'NeoShop' }],
      remindersEnabled: true,
      expiryReminderDays: 3,
      lowTrafficPercent: 15,
      referralEnabled: false,
      referralReferrerCreditIrr: 0n,
      referralInviteeDiscountIrr: 0n,
      referralMaxRewardsPerReferrer: 50,
      updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    const messenger = createMessenger();
    messenger.getChatMember = vi.fn().mockRejectedValue(new Error('TELEGRAM_HTTP_403'));
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1702,
      message: {
        message_id: 502,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: MENU_LABEL.shop,
      },
    });
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('قابل بررسی نیست'),
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ url: 'https://t.me/NeoShop' })]),
        ]),
      }),
      { parseMode: 'HTML' },
    );
  });

  it('lets an allowlisted admin bypass the forced join gate', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCommercialSettings).mockResolvedValue({
      trialEnabled: false,
      trialVariantId: null,
      forcedJoinChannels: [{ chatId: '@NeoShop', username: 'NeoShop' }],
      remindersEnabled: true,
      expiryReminderDays: 3,
      lowTrafficPercent: 15,
      referralEnabled: false,
      referralReferrerCreditIrr: 0n,
      referralInviteeDiscountIrr: 0n,
      referralMaxRewardsPerReferrer: 50,
      updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    const messenger = createMessenger();
    messenger.getChatMember = vi.fn();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1703,
      message: {
        message_id: 503,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: MENU_LABEL.shop,
      },
    });
    expect(messenger.getChatMember).not.toHaveBeenCalled();
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '70001',
      expect.stringContaining('فروشگاه خالی است'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
  });

  it('queues an admin broadcast from a durable session without storing the body on the session', async () => {
    const repository = createRepository();
    vi.mocked(repository.createBroadcastJob).mockResolvedValue({
      id: '44',
      adminTelegramUserId: '70001',
      body: 'فروشگاه امشب قطع است',
      bodySha256: 'b'.repeat(64),
      status: 'queued',
      recipientCount: 3,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1704,
      callback_query: {
        id: 'cb-broadcast',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 504, chat: { id: 70001, type: 'private' }, text: 'ادمین' },
        data: 'admin:broadcast',
      },
    });
    await bot.handleUpdate({
      update_id: 1705,
      message: {
        message_id: 505,
        from: { id: 70001, first_name: 'ادمین' },
        chat: { id: 70001, type: 'private' },
        text: 'فروشگاه امشب قطع است',
      },
    });
    expect(repository.createBroadcastJob).toHaveBeenCalledWith({
      adminTelegramUserId: '70001',
      body: 'فروشگاه امشب قطع است',
      bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const session = await repository.getPendingConversationSession('70001');
    expect(session).toBeNull();
  });

  it('lists my services without putting a subscription URL on the list screen', async () => {
    const repository = createRepository();
    vi.mocked(repository.listCustomerServices).mockResolvedValue([
      {
        id: '4',
        productName: 'اقتصادی',
        variantName: 'یک‌ماهه',
        status: 'active',
        expiresAt: new Date('2026-09-21T00:00:00.000Z'),
        dataLimitBytes: 20n * 1024n ** 3n,
        usedTrafficBytes: null,
      },
    ]);
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1706,
      message: {
        message_id: 506,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: MENU_LABEL.services,
      },
    });
    const listCall = vi.mocked(messenger.sendMessage).mock.calls.at(-1);
    expect(listCall?.[1]).toContain('سرویس‌های من');
    expect(listCall?.[1]).not.toContain('https://');
    expect(JSON.stringify(listCall?.[2])).toContain('svc:4');
  });

  it('attributes a personal start payload and never treats it as a username', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1801,
      message: {
        message_id: 601,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: '/start r70001',
      },
    });
    expect(repository.attributeReferralStart).toHaveBeenCalledWith({
      customerId: customer.id,
      inviteeTelegramUserId: '10001',
      referrerTelegramUserId: '70001',
    });
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      '10001',
      expect.stringContaining('NEO NETWORK'),
      expect.any(Object),
      { parseMode: 'HTML' },
    );
  });

  it('shows a personal invite start link without a subscription URL', async () => {
    const repository = createRepository();
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1802,
      message: {
        message_id: 602,
        from: { id: 10001, first_name: 'خریدار' },
        chat: { id: 10001, type: 'private' },
        text: MENU_LABEL.invite,
      },
    });
    const call = vi.mocked(messenger.sendMessage).mock.calls.at(-1);
    expect(call?.[1]).toContain('https://t.me/NeoShopBot?start=r10001');
    expect(call?.[1]).toContain('اولین خرید موفق پرداخت‌شده');
    expect(call?.[1]).not.toContain('https://panel');
  });

  it('renders an admin sales snapshot from Postgres counts only', async () => {
    const repository = createRepository();
    vi.mocked(repository.getAdminSalesSnapshot).mockResolvedValue({
      timezone: 'Asia/Tehran',
      today: {
        ordersByStatus: {
          awaiting_receipt: 1,
          receipt_submitted: 2,
          provisioning: 0,
          provisioning_failed: 0,
          fulfilled: 3,
          rejected: 0,
          cancelled: 0,
        },
        orderCount: 6,
        revenueIrr: 450_000n,
        newCustomers: 2,
      },
      last7d: {
        ordersByStatus: {
          awaiting_receipt: 1,
          receipt_submitted: 2,
          provisioning: 0,
          provisioning_failed: 1,
          fulfilled: 8,
          rejected: 1,
          cancelled: 0,
        },
        orderCount: 13,
        revenueIrr: 1_200_000n,
        newCustomers: 5,
      },
      openTickets: 4,
      pendingReceiptReviews: 2,
    });
    const messenger = createMessenger();
    const bot = createBot(repository, messenger);
    await bot.handleUpdate({
      update_id: 1803,
      callback_query: {
        id: 'cb-sales',
        from: { id: 70001, first_name: 'ادمین' },
        message: { message_id: 603, chat: { id: 70001, type: 'private' }, text: 'ادمین' },
        data: 'admin:sales',
      },
    });
    const call = vi.mocked(messenger.editMessageText).mock.calls.at(-1);
    expect(call?.[2]).toContain('خلاصه فروش');
    expect(call?.[2]).toContain('Asia/Tehran');
    expect(call?.[2]).toContain('تیکت باز: 4');
    expect(call?.[2]).toContain('رسید در انتظار بررسی: 2');
    expect(call?.[2]).not.toMatch(/https?:\/\//u);
  });

  it('keeps usage sync gated when no PasarGuard reader is injected', async () => {
    const repository = createRepository();
    const bot = createBot(repository, createMessenger());
    await bot.dispatchDueUsageSync();
    expect(repository.listServicesDueForUsageSync).not.toHaveBeenCalled();
    expect(repository.persistServiceUsedTraffic).not.toHaveBeenCalled();
  });
});

function createBot(
  repository: CommerceRepository & CommercialRepository,
  messenger: TelegramMessenger,
  reporting: ReportingUseCase | null = null,
  provisioner: ServiceProvisioner = {
    create: vi.fn().mockResolvedValue(service),
    renew: vi.fn().mockResolvedValue(service),
  },
  dailySummary: OpsDailySummaryUseCase | null = null,
  configOverrides: Partial<Extract<TelegramConfig, { readonly enabled: true }>> = {},
  catalogChatOverrides: Record<string, unknown> = {},
  catalogAdminOverrides: Record<string, unknown> = {},
  delivery: CustomerDeliveryUseCase | null = null,
) {
  const config: Extract<TelegramConfig, { readonly enabled: true }> = {
    enabled: true,
    botToken: '12345:abcdefghijklmnopqrstuvwxyz',
    webhookSecret: 'safe_webhook_secret_123',
    webhookUrl: null,
    brandMedia: { welcomePhotoFileId: null, deliveryPhotoFileId: null },
    adminTelegramUserIds: new Set(['70001']),
    reporting: null,
    reportDispatchIntervalMs: 15_000,
    deliveryDispatchIntervalMs: 15_000,
    reminderDispatchIntervalMs: 15_000,
    broadcastDispatchIntervalMs: 15_000,
    usageSyncIntervalMs: 60_000,
    botUsername: 'NeoShopBot',
    ...configOverrides,
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
      listProviderGroups: vi.fn().mockResolvedValue([]),
      ...catalogAdminOverrides,
    },
    {
      startSession: vi.fn(),
      getReadModel: vi.fn().mockResolvedValue({ categories: [], products: [], variants: [] }),
      getPendingSession: vi.fn().mockResolvedValue(null),
      updateSession: vi.fn(),
      cancelSession: vi.fn(),
      publishSession: vi.fn(),
      ...catalogChatOverrides,
    } as never,
    reporting,
    dailySummary,
    delivery,
  );
}

function createDelivery(
  repository: CommerceRepository,
  messenger: TelegramMessenger,
  brandPhotoFileId: string | null = null,
): CustomerDeliveryUseCase {
  return new CustomerDeliveryUseCase(
    repository,
    createTelegramDeliveryTransport(messenger, brandPhotoFileId),
    serviceDeliveredText,
    () => new Date('2026-08-21T00:00:00.000Z'),
  );
}

function createMessenger(): TelegramMessenger {
  return {
    sendMessage: vi.fn().mockResolvedValue({ messageId: '1' }),
    sendPhoto: vi.fn().mockResolvedValue({ messageId: '2' }),
    sendDocument: vi.fn().mockResolvedValue({ messageId: '3' }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

function createRepository(): CommerceRepository & CommercialRepository {
  const sessions = new Map<string, DurableConversationSession>();
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
    getSellableVariantForRepresentative: vi.fn().mockResolvedValue(variant),
    upsertTelegramCustomer: vi.fn().mockResolvedValue({ customer, created: true }),
    createOrder: vi.fn().mockResolvedValue(order),
    createRenewalOrder: vi.fn().mockResolvedValue({
      ...order,
      kind: 'renewal' as const,
      targetServiceId: service.id,
      status: 'awaiting_receipt' as const,
    }),
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
    getPendingConversationSession: vi.fn(async (telegramUserId: string) => {
      return (
        [...sessions.values()].find(
          (session) => session.telegramUserId === telegramUserId && session.status === 'pending',
        ) ?? null
      );
    }),
    putConversationSession: vi.fn(async (session: DurableConversationSession) => {
      for (const [id, existing] of sessions) {
        if (
          existing.telegramUserId === session.telegramUserId &&
          existing.status === 'pending' &&
          existing.id !== session.id
        ) {
          sessions.set(id, { ...existing, status: 'canceled' });
        }
      }
      sessions.set(session.id, session);
      return session;
    }),
    finishConversationSession: vi.fn(
      async (input: {
        readonly id: string;
        readonly telegramUserId: string;
        readonly status: DurableConversationSession['status'];
        readonly now: Date;
      }) => {
        const existing = sessions.get(input.id);
        if (existing === undefined) {
          return;
        }
        sessions.set(input.id, { ...existing, status: input.status, updatedAt: input.now });
      },
    ),
    findDiscountCode: vi.fn().mockResolvedValue(null),
    creditWalletTopUp: vi.fn(),
    createSupportTicket: vi.fn(),
    followUpSupportTicket: vi.fn(),
    getCommercialSettings: vi.fn().mockResolvedValue({
      trialEnabled: false,
      trialVariantId: null,
      forcedJoinChannels: [],
      remindersEnabled: true,
      expiryReminderDays: 3,
      lowTrafficPercent: 15,
      referralEnabled: false,
      referralReferrerCreditIrr: 0n,
      referralInviteeDiscountIrr: 0n,
      referralMaxRewardsPerReferrer: 50,
      updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    }),
    updateCommercialSettings: vi.fn(),
    createTrialOrder: vi.fn(),
    getTrialClaim: vi.fn().mockResolvedValue(null),
    listCustomerServices: vi.fn().mockResolvedValue([]),
    getServiceAccessTarget: vi.fn().mockResolvedValue(null),
    enqueueDueServiceReminders: vi.fn().mockResolvedValue(0),
    claimDueServiceReminders: vi.fn().mockResolvedValue([]),
    markServiceReminderDelivered: vi.fn(),
    retryServiceReminder: vi.fn(),
    failServiceReminder: vi.fn(),
    createBroadcastJob: vi.fn(),
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
      usageSyncDue: 0,
    }),
    attributeReferralStart: vi.fn().mockResolvedValue(null),
    getReferralAttribution: vi.fn().mockResolvedValue(null),
    grantReferralRewardForPaidOrder: vi.fn().mockResolvedValue(null),
    getAdminSalesSnapshot: vi.fn().mockResolvedValue({
      timezone: 'Asia/Tehran',
      today: {
        ordersByStatus: {
          awaiting_receipt: 0,
          receipt_submitted: 0,
          provisioning: 0,
          provisioning_failed: 0,
          fulfilled: 0,
          rejected: 0,
          cancelled: 0,
        },
        orderCount: 0,
        revenueIrr: 0n,
        newCustomers: 0,
      },
      last7d: {
        ordersByStatus: {
          awaiting_receipt: 0,
          receipt_submitted: 0,
          provisioning: 0,
          provisioning_failed: 0,
          fulfilled: 0,
          rejected: 0,
          cancelled: 0,
        },
        orderCount: 0,
        revenueIrr: 0n,
        newCustomers: 0,
      },
      openTickets: 0,
      pendingReceiptReviews: 0,
    }),
    listServicesDueForUsageSync: vi.fn().mockResolvedValue([]),
    persistServiceUsedTraffic: vi.fn(),
    countDueUsageSync: vi.fn().mockResolvedValue(0),
  };
}
