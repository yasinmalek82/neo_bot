import { timingSafeEqual } from 'node:crypto';

import type {
  CommerceRepository,
  CommerceUseCase,
  OpsDailySummaryUseCase,
  ReportingUseCase,
} from '@neo-bot/application';
import { DomainConflictError, type SalesOrder, type TelegramCustomerInput } from '@neo-bot/domain';

import type { TelegramConfig } from './config.js';
import type { TelegramInlineKeyboardMarkup, TelegramMessenger } from './telegram-api.js';
import {
  ADMIN_HUB_CALLBACK,
  ADMIN_QUEUE_CALLBACK,
  ADMIN_REPORTS_CALLBACK,
  ADMIN_STATUS_CALLBACK,
  adminHubText,
  adminOrderText,
  adminQueueKeyboard,
  adminQueueText,
  adminReportsText,
  adminStatusText,
  backToMenuButton,
  catalogKeyboard,
  categoryText,
  checkoutText,
  columnKeyboard,
  emptyShopText,
  escapeHtml,
  formatMoney,
  HELP_CALLBACK,
  helpText,
  HOME_CALLBACK,
  homeInlineKeyboard,
  homeReplyKeyboard,
  homeText,
  matchMenuAction,
  MENU_LABEL,
  type MenuAction,
  noOpenOrderText,
  ORDER_CALLBACK,
  orderStatusText,
  pairedKeyboard,
  paymentDetailsMissingText,
  provisioningDelayedText,
  receiptAcceptedText,
  receiptPhotoHint,
  RENEW_CALLBACK,
  SHOP_CALLBACK,
  shopText,
  unknownTextHint,
  variantText,
} from './telegram-menu.js';
import {
  hasUnsupportedReceiptMedia,
  isImageReceiptDocument,
  readTelegramUpdateId,
  telegramUpdateSchema,
  type TelegramUpdate,
} from './telegram-update.js';

interface ServiceReader {
  get(serviceId: string): Promise<{
    readonly remote: { readonly subscriptionUrl: string };
  }>;
}

interface MenuTarget {
  readonly chatId: string;
  readonly messageId?: string;
}

interface PaymentSettingsReader {
  getPublicCatalog(): Promise<{
    readonly settings: { readonly cardNumber: string; readonly cardHolder: string };
  }>;
}

export class TelegramCommerceBot {
  private readonly config: Extract<TelegramConfig, { readonly enabled: true }>;

  public constructor(
    config: Extract<TelegramConfig, { readonly enabled: true }>,
    private readonly commerce: CommerceUseCase,
    private readonly repository: CommerceRepository,
    private readonly serviceReader: ServiceReader,
    private readonly messenger: TelegramMessenger,
    private readonly paymentSettings: PaymentSettingsReader,
    private readonly reporting: ReportingUseCase | null = null,
    private readonly dailySummary: OpsDailySummaryUseCase | null = null,
  ) {
    this.config = config;
  }

  public isWebhookSecretValid(candidate: string | undefined): boolean {
    if (candidate === undefined) {
      return false;
    }
    const expectedBytes = Buffer.from(this.config.webhookSecret);
    const candidateBytes = Buffer.from(candidate);
    return (
      expectedBytes.length === candidateBytes.length &&
      timingSafeEqual(expectedBytes, candidateBytes)
    );
  }

  public async handleUpdate(input: unknown): Promise<void> {
    const parsed = telegramUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const updateId = readTelegramUpdateId(input);
      if (updateId === undefined) {
        return;
      }
      if (!(await this.repository.reserveTelegramUpdate(String(updateId)))) {
        return;
      }
      await this.repository.completeTelegramUpdate(String(updateId));
      return;
    }
    const update = parsed.data;
    const updateId = String(update.update_id);
    if (!(await this.repository.reserveTelegramUpdate(updateId))) {
      return;
    }
    try {
      await this.dispatch(update);
      await this.dispatchDueReports();
      await this.repository.completeTelegramUpdate(updateId);
    } catch (error: unknown) {
      await this.repository.failTelegramUpdate(updateId, safeErrorCode(error));
      throw error;
    }
  }

  private async dispatch(update: TelegramUpdate): Promise<void> {
    if (update.callback_query !== undefined) {
      await this.handleCallback(update, update.callback_query);
      return;
    }
    const message = update.message;
    if (message?.from === undefined || message.chat.type !== 'private') {
      return;
    }
    const customer = customerFrom(message.from, message.chat.id);
    const target: MenuTarget = { chatId: customer.privateChatId };
    const receipt = receiptFileFrom(message);
    if (receipt !== null) {
      await this.handleReceiptFile(customer, target, receipt);
      return;
    }
    if (hasUnsupportedReceiptMedia(message)) {
      await this.present(target, receiptPhotoHint(), columnKeyboard([backToMenuButton()]));
      return;
    }
    await this.commerce.recordCustomerActivity(customer);
    const action = matchMenuAction(message.text ?? '');
    if (action === null) {
      await this.present(
        target,
        unknownTextHint(),
        homeInlineKeyboard(this.isAdmin(customer.telegramUserId)),
      );
      return;
    }
    await this.routeAction(action, target, customer, action === 'home');
  }

  private async handleReceiptFile(
    customer: TelegramCustomerInput,
    target: MenuTarget,
    receipt: ReceiptFile,
  ): Promise<void> {
    await this.commerce.recordCustomerActivity(customer);
    let order: SalesOrder;
    try {
      order = await this.commerce.submitPaymentProof({
        customer,
        telegramFileId: receipt.fileId,
        telegramFileUniqueId: receipt.fileUniqueId,
      });
    } catch (error: unknown) {
      if (error instanceof DomainConflictError) {
        await this.present(target, noOpenOrderText(), columnKeyboard([backToMenuButton()]));
        return;
      }
      throw error;
    }
    await this.present(target, receiptAcceptedText(), columnKeyboard([backToMenuButton()]));
    const caption = [
      '<b>رسید جدید</b>',
      `سفارش: ${escapeHtml(order.id)}`,
      `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
      `مبلغ: ${escapeHtml(formatMoney(order.amountIrr))}`,
    ].join('\n');
    const keyboard = pairedKeyboard([
      { text: 'تأیید و ساخت سرویس ✅', callback_data: `approve:${order.id}` },
      { text: 'رد رسید ❌', callback_data: `reject:${order.id}` },
    ]);
    await Promise.all(
      [...this.config.adminTelegramUserIds].map((adminId) =>
        receipt.kind === 'photo'
          ? this.messenger.sendPhoto(adminId, receipt.fileId, caption, keyboard, {
              parseMode: 'HTML',
            })
          : this.messenger.sendDocument(adminId, receipt.fileId, caption, keyboard, {
              parseMode: 'HTML',
            }),
      ),
    );
  }

  private async handleCallback(
    update: TelegramUpdate,
    callback: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const data = callback.data;
    const chatId = callback.message?.chat.id;
    if (data === undefined || chatId === undefined || callback.message?.chat.type !== 'private') {
      await this.messenger.answerCallbackQuery(callback.id);
      return;
    }
    const actorId = String(callback.from.id);
    const customer = customerFrom(callback.from, chatId);
    const target: MenuTarget = {
      chatId: String(chatId),
      ...(callback.message.photo === undefined
        ? { messageId: String(callback.message.message_id) }
        : {}),
    };
    try {
      if (data === HOME_CALLBACK) {
        await this.routeAction('home', target, customer, false);
      } else if (data === SHOP_CALLBACK) {
        await this.routeAction('shop', target, customer, false);
      } else if (data === HELP_CALLBACK) {
        await this.routeAction('help', target, customer, false);
      } else if (data === ORDER_CALLBACK) {
        await this.routeAction('order', target, customer, false);
      } else if (data === RENEW_CALLBACK) {
        await this.routeAction('renew', target, customer, false);
      } else if (data === ADMIN_STATUS_CALLBACK) {
        await this.routeAction('status', target, customer, false);
      } else if (data === ADMIN_REPORTS_CALLBACK) {
        await this.routeAction('reports', target, customer, false);
      } else if (data === ADMIN_QUEUE_CALLBACK) {
        await this.routeAction('queue', target, customer, false);
      } else if (data === ADMIN_HUB_CALLBACK) {
        await this.routeAction('admin', target, customer, false);
      } else if (/^admin:order:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.showAdminOrder(target, data.slice('admin:order:'.length));
      } else if (/^cat:\d+$/u.test(data)) {
        await this.showCategory(target, data.slice(4));
      } else if (/^variant:\d+$/u.test(data)) {
        await this.showVariant(target, data.slice(8));
      } else if (/^buy:\d+$/u.test(data)) {
        const card = await this.readCheckoutCard();
        const order = await this.commerce.beginCheckout({
          customer,
          productVariantId: data.slice(4),
          idempotencyKey: `telegram:${String(update.update_id)}:buy`,
        });
        await this.present(
          target,
          checkoutText(order, card.cardNumber, card.cardHolder),
          columnKeyboard([backToMenuButton()]),
        );
      } else if (/^admin:retry:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeRetry(data.slice('admin:retry:'.length), actorId, String(chatId));
      } else if (/^approve:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeApproval(data.slice(8), actorId, String(chatId));
      } else if (/^reject:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeRejection(data.slice(7), actorId, String(chatId));
      }
      await this.messenger.answerCallbackQuery(callback.id);
    } catch (error: unknown) {
      await this.messenger.answerCallbackQuery(callback.id, customerSafeError(error));
      if (error instanceof DomainConflictError) {
        if (error.code === 'PAYMENT_DETAILS_MISSING') {
          await this.present(
            target,
            paymentDetailsMissingText(),
            columnKeyboard([backToMenuButton()]),
          );
        }
        return;
      }
      throw error;
    }
  }

  public async dispatchDueReports(): Promise<void> {
    if (this.reporting === null) {
      return;
    }
    await this.reporting.dispatchDue();
  }

  public async publishDailySummary(): Promise<void> {
    if (this.dailySummary === null) {
      return;
    }
    await this.dailySummary.publishForUtcDay();
  }

  private async routeAction(
    action: MenuAction,
    target: MenuTarget,
    customer: TelegramCustomerInput,
    persistKeyboard: boolean,
  ): Promise<void> {
    switch (action) {
      case 'home':
        await this.showHome(target, customer.telegramUserId, persistKeyboard);
        return;
      case 'shop':
        await this.showRootCategories(target);
        return;
      case 'help':
        await this.present(target, helpText(), columnKeyboard([backToMenuButton()]));
        return;
      case 'order':
        await this.showOrder(target, customer);
        return;
      case 'renew':
        await this.completeCustomerRenewal(target, customer);
        return;
      case 'status':
      case 'reports':
      case 'queue':
      case 'admin':
        this.requireAdmin(customer.telegramUserId);
        await this.showAdmin(action, target);
        return;
    }
  }

  private async showHome(
    target: MenuTarget,
    actorId: string,
    persistKeyboard: boolean,
  ): Promise<void> {
    const admin = this.isAdmin(actorId);
    await this.present(target, homeText(admin), homeInlineKeyboard(admin));
    if (persistKeyboard && target.messageId === undefined) {
      await this.messenger.sendMessage(
        target.chatId,
        'منوی پایین صفحه همیشه در دسترس است.',
        homeReplyKeyboard(admin),
        { parseMode: 'HTML' },
      );
    }
  }

  private async showRootCategories(target: MenuTarget): Promise<void> {
    const categories = await this.commerce.listCategories(null);
    if (categories.length === 0) {
      await this.present(target, emptyShopText(), columnKeyboard([backToMenuButton()]));
      return;
    }
    await this.present(
      target,
      shopText(),
      catalogKeyboard(
        categories.map((category) => ({
          text: category.name,
          callback_data: `cat:${category.id}`,
        })),
        [backToMenuButton()],
      ),
    );
  }

  private async showCategory(target: MenuTarget, categoryId: string): Promise<void> {
    const [children, variants] = await Promise.all([
      this.commerce.listCategories(categoryId),
      this.commerce.listVariants(categoryId),
    ]);
    const hasItems = children.length > 0 || variants.length > 0;
    await this.present(
      target,
      categoryText(hasItems),
      catalogKeyboard(
        [
          ...children.map((category) => ({
            text: category.name,
            callback_data: `cat:${category.id}`,
          })),
          ...variants.map((variant) => ({
            text: `${variant.name} — ${formatMoney(variant.priceIrr)}`,
            callback_data: `variant:${variant.id}`,
          })),
        ],
        [{ text: 'دسته‌ها ⬅️', callback_data: SHOP_CALLBACK }, backToMenuButton()],
      ),
    );
  }

  private async showVariant(target: MenuTarget, variantId: string): Promise<void> {
    const variant = await this.commerce.getVariant(variantId);
    await this.present(
      target,
      variantText(variant),
      columnKeyboard([
        { text: 'ادامه و دریافت شماره کارت 💳', callback_data: `buy:${variant.id}` },
        { text: 'دسته‌ها ⬅️', callback_data: SHOP_CALLBACK },
      ]),
    );
  }

  private async showOrder(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const order = await this.repository.getOpenOrderForCustomer(recorded.customer.id);
    await this.present(
      target,
      orderStatusText(order),
      columnKeyboard(
        order === null
          ? [{ text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK }, backToMenuButton()]
          : [backToMenuButton()],
      ),
    );
  }

  private async showAdmin(
    action: 'status' | 'reports' | 'queue' | 'admin',
    target: MenuTarget,
  ): Promise<void> {
    if (action === 'status') {
      const categories = await this.commerce.listCategories(null);
      await this.present(
        target,
        adminStatusText({
          categoryCount: categories.length,
          forumConfigured: this.config.reporting !== null,
          localIntake: this.config.webhookUrl === null,
        }),
        columnKeyboard([backToMenuButton()]),
      );
      return;
    }
    if (action === 'reports') {
      await this.present(
        target,
        adminReportsText(this.config.reporting !== null),
        columnKeyboard([backToMenuButton()]),
      );
      return;
    }
    if (action === 'queue') {
      const orders = await this.repository.listReviewQueue(10);
      await this.present(target, adminQueueText(orders), adminQueueKeyboard(orders));
      return;
    }
    await this.present(
      target,
      adminHubText(),
      columnKeyboard([
        { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async showAdminOrder(target: MenuTarget, orderId: string): Promise<void> {
    const order = await this.repository.getOrder(orderId);
    if (order === null) {
      throw new DomainConflictError('ORDER_NOT_FOUND');
    }
    if (order.status === 'provisioning_failed' || order.status === 'provisioning') {
      await this.present(
        target,
        adminOrderText(order),
        columnKeyboard([
          { text: 'تلاش مجدد ساخت سرویس', callback_data: `admin:retry:${order.id}` },
          { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
          backToMenuButton(),
        ]),
      );
      return;
    }
    await this.present(
      target,
      adminOrderText(order),
      pairedKeyboard([
        { text: 'تأیید و ساخت سرویس ✅', callback_data: `approve:${order.id}` },
        { text: 'رد رسید ❌', callback_data: `reject:${order.id}` },
        { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async completeApproval(
    orderId: string,
    actorId: string,
    adminChatId: string,
  ): Promise<void> {
    try {
      const order = await this.commerce.approveOrder(orderId, actorId);
      const customer = await this.commerce.getCustomerForOrder(order.id);
      if (customer === null || order.serviceId === null) {
        throw new DomainConflictError('FULFILLED_ORDER_INCOMPLETE');
      }
      const service = await this.serviceReader.get(order.serviceId);
      await this.present(
        { chatId: customer.privateChatId },
        [
          '<b>پرداخت تأیید شد</b>',
          'سرویس آماده است. لینک اشتراک را در برنامه وارد کن.',
          '',
          `<code>${escapeHtml(service.remote.subscriptionUrl)}</code>`,
        ].join('\n'),
        columnKeyboard([backToMenuButton()]),
      );
      await this.messenger.sendMessage(adminChatId, 'سفارش تکمیل شد.');
    } catch (error: unknown) {
      await this.notifyProvisioningDelay(orderId);
      throw error;
    }
  }

  private async completeRejection(
    orderId: string,
    actorId: string,
    adminChatId: string,
  ): Promise<void> {
    const order = await this.commerce.rejectOrder(orderId, actorId);
    const customer = await this.commerce.getCustomerForOrder(order.id);
    if (customer !== null) {
      await this.present(
        { chatId: customer.privateChatId },
        ['<b>رسید تأیید نشد</b>', 'یک عکس واضح‌تر از همان پرداخت را همین‌جا بفرست.'].join('\n'),
        columnKeyboard([backToMenuButton()]),
      );
    }
    await this.messenger.sendMessage(adminChatId, 'رسید رد شد.');
  }

  private async completeRetry(
    orderId: string,
    actorId: string,
    adminChatId: string,
  ): Promise<void> {
    try {
      const order = await this.commerce.retryProvisioning(orderId, actorId);
      const customer = await this.commerce.getCustomerForOrder(order.id);
      if (customer === null || order.serviceId === null) {
        throw new DomainConflictError('FULFILLED_ORDER_INCOMPLETE');
      }
      const service = await this.serviceReader.get(order.serviceId);
      await this.present(
        { chatId: customer.privateChatId },
        [
          '<b>سرویس آماده شد</b>',
          'لینک اشتراک را در برنامه وارد کن.',
          '',
          `<code>${escapeHtml(service.remote.subscriptionUrl)}</code>`,
        ].join('\n'),
        columnKeyboard([backToMenuButton()]),
      );
      await this.messenger.sendMessage(adminChatId, 'ساخت سرویس تکرار شد.');
    } catch (error: unknown) {
      await this.notifyProvisioningDelay(orderId);
      throw error;
    }
  }

  private async notifyProvisioningDelay(orderId: string): Promise<void> {
    const order = await this.repository.getOrder(orderId);
    if (order?.status !== 'provisioning_failed') {
      return;
    }
    const customer = await this.commerce.getCustomerForOrder(order.id);
    if (customer === null) {
      return;
    }
    await this.present(
      { chatId: customer.privateChatId },
      provisioningDelayedText(),
      columnKeyboard([backToMenuButton()]),
    );
  }

  private async completeCustomerRenewal(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    const service = await this.commerce.renewForCustomer(customer);
    const remote = await this.serviceReader.get(service.id);
    await this.present(
      target,
      [
        '<b>تمدید انجام شد</b>',
        'لینک اشتراک به‌روز است.',
        '',
        `<code>${escapeHtml(remote.remote.subscriptionUrl)}</code>`,
      ].join('\n'),
      columnKeyboard([backToMenuButton()]),
    );
  }

  private async readCheckoutCard(): Promise<{
    readonly cardNumber: string;
    readonly cardHolder: string;
  }> {
    const catalog = await this.paymentSettings.getPublicCatalog();
    if (
      !/^\d{16}$/u.test(catalog.settings.cardNumber) ||
      catalog.settings.cardHolder.trim().length < 2
    ) {
      throw new DomainConflictError('PAYMENT_DETAILS_MISSING');
    }
    return {
      cardNumber: catalog.settings.cardNumber,
      cardHolder: catalog.settings.cardHolder,
    };
  }

  private async present(
    target: MenuTarget,
    text: string,
    replyMarkup: TelegramInlineKeyboardMarkup,
  ): Promise<void> {
    if (target.messageId !== undefined) {
      try {
        await this.messenger.editMessageText(target.chatId, target.messageId, text, replyMarkup);
        return;
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'TELEGRAM_MESSAGE_UNCHANGED') {
          return;
        }
      }
    }
    await this.messenger.sendMessage(target.chatId, text, replyMarkup, { parseMode: 'HTML' });
  }

  private isAdmin(telegramUserId: string): boolean {
    return this.config.adminTelegramUserIds.has(telegramUserId);
  }

  private requireAdmin(telegramUserId: string): void {
    if (!this.isAdmin(telegramUserId)) {
      throw new DomainConflictError('ADMIN_ACCESS_DENIED');
    }
  }
}

function customerFrom(
  user: {
    readonly id: number;
    readonly first_name: string;
    readonly last_name?: string | undefined;
    readonly username?: string | undefined;
  },
  chatId: number,
): TelegramCustomerInput {
  return {
    telegramUserId: String(user.id),
    privateChatId: String(chatId),
    displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
    ...(user.username === undefined ? {} : { username: user.username }),
  };
}

interface ReceiptFile {
  readonly fileId: string;
  readonly fileUniqueId: string;
  readonly kind: 'photo' | 'document';
}

function receiptFileFrom(message: NonNullable<TelegramUpdate['message']>): ReceiptFile | null {
  const photo = message.photo?.at(-1);
  if (photo !== undefined) {
    return { fileId: photo.file_id, fileUniqueId: photo.file_unique_id, kind: 'photo' };
  }
  if (isImageReceiptDocument(message.document) && message.document !== undefined) {
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      kind: 'document',
    };
  }
  return null;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DomainConflictError) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return 'TELEGRAM_UPDATE_FAILED';
}

function customerSafeError(error: unknown): string {
  if (error instanceof DomainConflictError) {
    switch (error.code) {
      case 'PAYMENT_DETAILS_MISSING':
        return 'شماره کارت هنوز برای فروش تنظیم نشده.';
      case 'NO_ORDER_AWAITING_PAYMENT':
        return 'سفارش باز برای این رسید پیدا نشد.';
      case 'OPEN_ORDER_UNDER_REVIEW':
        return 'یک سفارش در حال بررسی داری.';
      case 'NO_ACTIVE_SERVICE':
        return 'سرویس فعالی برای تمدید پیدا نشد.';
      case 'ADMIN_ACCESS_DENIED':
        return 'اجازهٔ این عملیات را نداری.';
      case 'PRODUCT_VARIANT_NOT_SELLABLE':
        return 'این محصول دیگر قابل خرید نیست.';
      default:
        return 'عملیات انجام نشد؛ دوباره تلاش کن.';
    }
  }
  return 'خطای موقت؛ دوباره تلاش کن.';
}
