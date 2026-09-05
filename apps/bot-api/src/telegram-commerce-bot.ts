import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  CommerceRepository,
  CommerceUseCase,
  CatalogChatAdminUseCase,
  CommercialRepository,
  ConversationSessionStore,
  CustomerDeliveryTransport,
  CustomerDeliveryUseCase,
  OpsDailySummaryUseCase,
  ReportingUseCase,
  type RepresentativeWalletRepository,
} from '@neo-bot/application';
import {
  CommercialOpsUseCase,
  joinUrlForChannel,
  ReferralUseCase,
  RepositoryConversationSessionStore,
  SupportTicketUseCase,
  UsageSyncUseCase,
  WalletUseCase,
  RepresentativeWalletUseCase,
  type UsageReader,
} from '@neo-bot/application';
import {
  DomainConflictError,
  type CatalogAdminSession,
  type CatalogAdminDelta,
  type CatalogAdminReadModel,
  type CatalogAdminWizardState,
  type ProviderGroupChoice,
  type SalesOrder,
  type StorefrontCatalog,
  type SellableProductVariant,
  type TelegramCustomerInput,
  parseNonNegativeIrr,
  type AdminOpsField,
  type RepresentativeWalletLedgerEntry,
} from '@neo-bot/domain';

import type { TelegramConfig } from './config.js';
import type { TelegramInlineKeyboardMarkup, TelegramMessenger } from './telegram-api.js';
import { brandDeliveryCaption, brandWelcomeCaption } from './telegram-brand.js';
import {
  ADMIN_CATALOG_CALLBACK,
  ADMIN_FAILED_CALLBACK,
  ADMIN_HUB_CALLBACK,
  ADMIN_QUEUE_CALLBACK,
  ADMIN_REPORTS_CALLBACK,
  ADMIN_STATUS_CALLBACK,
  ADMIN_STORE_CALLBACK,
  ADMIN_SUMMARY_CALLBACK,
  adminCatalogHealthText,
  adminDeniedText,
  adminFailedProvisioningText,
  adminHubKeyboard,
  adminHubText,
  adminOrderText,
  adminQueueKeyboard,
  adminQueueText,
  adminReportsKeyboard,
  adminReportsText,
  adminScreenKeyboard,
  adminStatusText,
  backToMenuButton,
  storeWizardKeyboard,
  buttonLabel,
  catalogKeyboard,
  categoryBackButton,
  categoryText,
  missingCategoryText,
  checkoutText,
  invalidServiceUsernameBaseText,
  serviceUsernamePromptText,
  columnKeyboard,
  dailySummaryQueuedText,
  deliveryAnchorText,
  deliveryStageLabel,
  emptyShopText,
  escapeHtml,
  escapeWithin,
  GUIDE_CALLBACK,
  guideInlineKeyboard,
  guideText,
  HELP_CALLBACK,
  helpKeyboard,
  helpText,
  TICKET_FOLLOW_PREFIX,
  TICKET_NEW_CALLBACK,
  WALLET_TOPUP_CALLBACK,
  TRIAL_CALLBACK,
  SERVICES_CALLBACK,
  JOIN_REFRESH_CALLBACK,
  ADMIN_OPS_CALLBACK,
  ADMIN_SALES_CALLBACK,
  ADMIN_BROADCAST_CALLBACK,
  ADMIN_REP_WALLET_CALLBACK,
  ADMIN_BROADCAST_CANCEL_PREFIX,
  INVITE_CALLBACK,
  ORDERS_WALLET_CALLBACK,
  GUIDE_SUPPORT_CALLBACK,
  ordersWalletHubText,
  ordersWalletHubKeyboard,
  guideSupportHubText,
  guideSupportHubKeyboard,
  trialOfferText,
  trialAlreadyClaimedText,
  trialUnavailableText,
  shopBlockedText,
  forcedJoinText,
  customerServicesText,
  serviceAccessText,
  platformGuideText,
  commercialSettingsText,
  inviteText,
  adminSalesSnapshotText,
  parseTelegramStartCommand,
  broadcastPromptText,
  broadcastQueuedText,
  reminderNoticeText,
  conversationCancelledText,
  conversationExpiredText,
  conversationMalformedText,
  discountPromptText,
  discountSkipButton,
  flowCancelButton,
  invalidDiscountText,
  invalidTicketBodyText,
  invalidWalletAmountText,
  ticketCreatePromptText,
  ticketFollowUpPromptText,
  ticketSubmittedText,
  walletAmountPromptText,
  walletCreditedText,
  HOME_CALLBACK,
  homeReplyKeyboard,
  homeReturnText,
  homeText,
  matchMenuAction,
  MENU_LABEL,
  type MenuAction,
  noActiveServiceText,
  ORDER_CALLBACK,
  orderStatusText,
  pairedKeyboard,
  paymentDetailsMissingText,
  productPlansText,
  provisioningDelayedText,
  receiptAcceptedText,
  receiptConflictText,
  receiptPhotoHint,
  receiptRejectedText,
  RENEW_CALLBACK,
  RENEW_CONFIRM_CALLBACK,
  renewalPreviewText,
  SHOP_CALLBACK,
  shopBackButton,
  shopText,
  unknownTextHint,
  variantListLabel,
  variantText,
} from './telegram-menu.js';
import { AdminBroadcastFlowHandler, AdminOpsFlowHandler } from './interaction/admin-ops-flow.js';
import { AdminRepWalletCreditFlowHandler } from './interaction/admin-rep-wallet-flow.js';
import { CommerceFlowHandler } from './interaction/commerce-flow.js';
import {
  applyFlowTransition,
  ConversationFlowRegistry,
  isCustomerNavigationInput,
  isGlobalCancelInput,
  isHomeInput,
  recoverConversationSession,
  type BotScreenModel,
  type ConversationInput,
  type FlowTransition,
} from './interaction/conversation-flow.js';
import { SupportFlowHandler } from './interaction/support-flow.js';
import { WalletFlowHandler } from './interaction/wallet-flow.js';
import { renderSubscriptionQrPng } from './subscription-qr.js';
import { readTelegramIntakeHealth } from './telegram-intake.js';
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

interface CatalogAdminReader {
  getPublicCatalog(): Promise<{
    readonly settings: { readonly cardNumber: string; readonly cardHolder: string };
  }>;
  listProviderGroups(): Promise<readonly ProviderGroupChoice[]>;
}

export class TelegramCommerceBot {
  private readonly config: Extract<TelegramConfig, { readonly enabled: true }>;
  private readonly sessions: ConversationSessionStore;
  private readonly wallet: WalletUseCase;
  private readonly tickets: SupportTicketUseCase;
  private readonly commercial: CommercialOpsUseCase;
  private readonly referral: ReferralUseCase;
  private readonly usageSync: UsageSyncUseCase;
  private readonly repWallet: RepresentativeWalletUseCase;

  public constructor(
    config: Extract<TelegramConfig, { readonly enabled: true }>,
    private readonly commerce: CommerceUseCase,
    private readonly repository: CommerceRepository & CommercialRepository,
    private readonly serviceReader: ServiceReader,
    private readonly messenger: TelegramMessenger,
    private readonly catalogAdmin: CatalogAdminReader,
    private readonly catalogChat: CatalogChatAdminUseCase,
    private readonly reporting: ReportingUseCase | null = null,
    private readonly dailySummary: OpsDailySummaryUseCase | null = null,
    private readonly delivery: CustomerDeliveryUseCase | null = null,
    usageReader: UsageReader | null = null,
    sessions?: ConversationSessionStore,
    representativeWallet: RepresentativeWalletUseCase | null = null,
  ) {
    this.config = config;
    this.sessions = sessions ?? new RepositoryConversationSessionStore(repository);
    this.wallet = new WalletUseCase(repository);
    this.tickets = new SupportTicketUseCase(repository);
    this.referral = new ReferralUseCase(repository, reporting);
    this.usageSync = new UsageSyncUseCase(repository, usageReader);
    this.repWallet =
      representativeWallet ??
      new RepresentativeWalletUseCase(repository as unknown as RepresentativeWalletRepository);
    this.commercial = new CommercialOpsUseCase(
      repository,
      messenger.getChatMember === undefined
        ? null
        : {
            getMemberStatus: (chatId, userId) => {
              if (messenger.getChatMember === undefined) {
                return Promise.reject(new Error('TELEGRAM_MEMBERSHIP_UNAVAILABLE'));
              }
              return messenger.getChatMember(chatId, userId);
            },
          },
      () => new Date(),
      reporting,
    );
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
      await this.dispatchDueDeliveries();
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
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const start = parseTelegramStartCommand(message.text ?? '');
    if (start?.payload !== undefined && start.payload !== null) {
      await this.referral.attributeStart({
        customer,
        customerId: recorded.customer.id,
        payload: start.payload,
      });
    }
    const flowInput: ConversationInput = {
      kind: 'text',
      updateId: String(update.update_id),
      telegramUserId: customer.telegramUserId,
      text: message.text ?? '',
    };
    if (await this.dispatchCustomerFlow(target, customer, flowInput)) {
      return;
    }
    if (this.isAdmin(customer.telegramUserId) && (message.text ?? '').trim().length > 0) {
      const pendingStore = await this.catalogChat.getPendingSession(customer.telegramUserId);
      if (pendingStore !== null) {
        const storeMenuAction = matchMenuAction(message.text ?? '');
        if (storeMenuAction !== null) {
          await this.routeAction(
            storeMenuAction,
            target,
            customer,
            isFreshStartCommand(message.text),
          );
          return;
        }
        try {
          await this.handleStoreText(
            target,
            customer.telegramUserId,
            message.text ?? '',
            pendingStore,
            String(message.message_id),
          );
        } catch (error: unknown) {
          if (!(error instanceof DomainConflictError)) throw error;
          await this.present(
            target,
            `ورودی معتبر نیست.\n${this.storePrompt(pendingStore.state)}`,
            storeWizardKeyboard(),
          );
        }
        return;
      }
    }
    const action = matchMenuAction(message.text ?? '');
    if (action === null) {
      await this.present(target, unknownTextHint(), columnKeyboard([backToMenuButton()]));
      return;
    }
    await this.routeAction(action, target, customer, isFreshStartCommand(message.text));
  }

  private customerFlowRegistry(customer: TelegramCustomerInput): ConversationFlowRegistry {
    const registry = new ConversationFlowRegistry();
    registry.register(
      new AdminRepWalletCreditFlowHandler({
        ownerCredit: (command) => this.ownerCreditRepresentative(command),
      }),
    );
    registry.register(new CommerceFlowHandler('commerce.purchase', this.commerce, customer));
    registry.register(new CommerceFlowHandler('commerce.renewal', this.commerce, customer));
    registry.register(
      new WalletFlowHandler(
        {
          previewDiscount: (code) => this.commerce.previewDiscount(code),
          creditTopUp: (command) => this.wallet.creditTopUp(command),
        },
        customer,
      ),
    );
    registry.register(new SupportFlowHandler(this.tickets, customer));
    registry.register(
      new AdminBroadcastFlowHandler((command) => this.commercial.queueBroadcast(command), customer),
    );
    registry.register(
      new AdminOpsFlowHandler((field, text) => this.applyAdminOpsField(field, text)),
    );
    return registry;
  }

  private async dispatchCustomerFlow(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    input: ConversationInput,
  ): Promise<boolean> {
    const session = await this.sessions.getPending(customer.telegramUserId);
    if (session === null) {
      return false;
    }
    const now = new Date();
    const recovery = recoverConversationSession(session, now);
    if (recovery.kind === 'expired' || recovery.kind === 'malformed') {
      await this.sessions.finish({
        id: session.id,
        telegramUserId: session.telegramUserId,
        status: recovery.kind === 'expired' ? 'expired' : 'canceled',
        now,
      });
      await this.present(
        target,
        recovery.kind === 'expired' ? conversationExpiredText() : conversationMalformedText(),
        columnKeyboard([backToMenuButton()]),
      );
      return true;
    }
    if (isGlobalCancelInput(input)) {
      await this.sessions.finish({
        id: session.id,
        telegramUserId: session.telegramUserId,
        status: 'canceled',
        now,
      });
      if (isHomeInput(input)) {
        await this.routeAction('home', target, customer, isFreshStartCommand(input.text));
      } else {
        await this.present(
          target,
          conversationCancelledText(),
          columnKeyboard([backToMenuButton()]),
        );
      }
      return true;
    }
    if (isCustomerNavigationInput(input)) {
      await this.sessions.finish({
        id: session.id,
        telegramUserId: session.telegramUserId,
        status: 'canceled',
        now,
      });
      return false;
    }
    const handler = this.customerFlowRegistry(customer).get(session.flowId);
    if (handler === null) {
      return false;
    }
    if (!handler.ownsInput(session, input)) {
      return false;
    }
    const transition = await handler.handle(session, input, now);
    if (transition.kind === 'ignore') {
      return false;
    }
    await applyFlowTransition(this.sessions, session, transition, now);
    await this.presentFlowTransition(target, customer, transition);
    return true;
  }

  private async presentFlowTransition(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    transition: FlowTransition,
  ): Promise<void> {
    if (transition.kind === 'ignore') {
      return;
    }
    await this.presentFlowScreen(target, customer, transition.screen, transition);
  }

  private async presentFlowScreen(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    screen: BotScreenModel,
    transition: FlowTransition,
  ): Promise<void> {
    const cancelRow = [flowCancelButton(), backToMenuButton()];
    switch (screen.id) {
      case 'purchase.naming':
        await this.present(
          target,
          serviceUsernamePromptText(screen.variantName ?? ''),
          columnKeyboard([shopBackButton(), flowCancelButton(), backToMenuButton()]),
        );
        return;
      case 'purchase.invalid-username':
        await this.present(
          target,
          invalidServiceUsernameBaseText(),
          columnKeyboard([shopBackButton(), ...cancelRow]),
        );
        return;
      case 'purchase.coupon':
      case 'renewal.coupon':
      case 'wallet.coupon':
        await this.present(
          target,
          discountPromptText(),
          columnKeyboard([discountSkipButton(), ...cancelRow]),
        );
        return;
      case 'purchase.invalid-coupon':
      case 'renewal.invalid-coupon':
      case 'wallet.invalid-coupon':
        await this.present(
          target,
          invalidDiscountText(),
          columnKeyboard([discountSkipButton(), ...cancelRow]),
        );
        return;
      case 'purchase.checkout':
      case 'renewal.checkout':
        await this.presentCheckoutFromTransition(target, transition);
        return;
      case 'renewal.preview':
        await this.present(
          target,
          renewalPreviewText(),
          columnKeyboard([
            { text: 'تأیید تمدید سرویس', callback_data: RENEW_CONFIRM_CALLBACK },
            ...cancelRow,
          ]),
        );
        return;
      case 'admin.rep-wallet.lookup':
        await this.present(target, 'شناسه نماینده را به‌صورت کد یا شناسه تلگرام بفرست.', columnKeyboard(cancelRow));
        return;
      case 'admin.rep-wallet.amount':
        await this.present(target, 'مبلغ شارژ را به ریال و فقط با عدد مثبت بفرست.', columnKeyboard(cancelRow));
        return;
      case 'admin.rep-wallet.invalid-lookup':
        await this.present(target, 'کد یا شناسه تلگرام نماینده پیدا نشد یا فعال نیست. دوباره بفرست.', columnKeyboard(cancelRow));
        return;
      case 'admin.rep-wallet.invalid-amount':
        await this.present(target, 'مبلغ شارژ معتبر نیست. عدد مثبت به ریال بفرست.', columnKeyboard(cancelRow));
        return;
      case 'admin.rep-wallet.credited':
        await this.present(target, 'شارژ کیف پول نماینده ثبت شد.', adminScreenKeyboard());
        return;
      case 'admin.rep-wallet.failed':
        await this.present(target, 'شارژ کیف پول نماینده انجام نشد؛ موجودی یا وضعیت نماینده را بررسی کن.', columnKeyboard(cancelRow));
        return;
      case 'wallet.amount':
        await this.present(target, walletAmountPromptText(), columnKeyboard(cancelRow));
        return;
      case 'wallet.invalid-amount':
        await this.present(target, invalidWalletAmountText(), columnKeyboard(cancelRow));
        return;
      case 'wallet.credited':
        await this.present(target, walletCreditedText(), columnKeyboard([backToMenuButton()]));
        return;
      case 'support.create':
        await this.present(target, ticketCreatePromptText(), columnKeyboard(cancelRow));
        return;
      case 'support.followup':
        await this.present(target, ticketFollowUpPromptText(), columnKeyboard(cancelRow));
        return;
      case 'support.invalid-body':
        await this.present(target, invalidTicketBodyText(), columnKeyboard(cancelRow));
        return;
      case 'admin.broadcast.compose':
        await this.present(target, broadcastPromptText(), columnKeyboard(cancelRow));
        return;
      case 'admin.broadcast.invalid':
        await this.present(
          target,
          'متن پیام همگانی معتبر نیست. بین ۱ تا ۳۵۰۰ نویسه بفرست.',
          columnKeyboard(cancelRow),
        );
        return;
      case 'admin.broadcast.queued':
        await this.present(
          target,
          broadcastQueuedText(screen.jobId ?? '', 0),
          adminScreenKeyboard(
            screen.jobId === undefined
              ? []
              : [
                  {
                    text: 'لغو پیام همگانی',
                    callback_data: `${ADMIN_BROADCAST_CANCEL_PREFIX}${screen.jobId}`,
                  },
                ],
          ),
        );
        return;
      case 'admin.ops.prompt':
      case 'admin.ops.invalid':
        await this.present(
          target,
          screen.id === 'admin.ops.invalid'
            ? 'ورودی تنظیمات تجاری معتبر نیست. دوباره بفرست.'
            : this.adminOpsPrompt(screen.field),
          columnKeyboard(cancelRow),
        );
        return;
      case 'admin.ops.saved':
        await this.showCommercialSettings(target);
        return;
      case 'support.submitted':
        await this.present(
          target,
          ticketSubmittedText(),
          columnKeyboard([
            ...(screen.ticketId === undefined
              ? []
              : [
                  {
                    text: 'پیام بعدی',
                    callback_data: `${TICKET_FOLLOW_PREFIX}${screen.ticketId}`,
                  },
                ]),
            backToMenuButton(),
          ]),
        );
        return;
      case 'expired':
        await this.present(target, conversationExpiredText(), columnKeyboard([backToMenuButton()]));
        return;
      case 'malformed':
        await this.present(
          target,
          conversationMalformedText(),
          columnKeyboard([backToMenuButton()]),
        );
        return;
      case 'cancelled':
        await this.present(
          target,
          conversationCancelledText(),
          columnKeyboard([backToMenuButton()]),
        );
        return;
      case 'home':
        await this.routeAction('home', target, customer, false);
        return;
    }
  }

  private async presentCheckoutFromTransition(
    target: MenuTarget,
    transition: FlowTransition,
  ): Promise<void> {
    if (transition.kind !== 'complete' || transition.effect?.type !== 'checkout') {
      return;
    }
    const order = await this.repository.getOrder(transition.effect.orderId);
    if (order === null) {
      throw new DomainConflictError('ORDER_NOT_FOUND');
    }
    const card = await this.readCheckoutCard();
    await this.present(
      target,
      checkoutText(order, card.cardNumber, card.cardHolder),
      columnKeyboard([
        { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async startAdminRepWallet(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    await AdminRepWalletCreditFlowHandler.start(this.sessions, {
      telegramUserId: customer.telegramUserId,
      now: new Date(),
    });
    await this.present(
      target,
      'شناسه نماینده را به‌صورت کد یا شناسه تلگرام بفرست.',
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private async startWalletTopUp(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    await WalletFlowHandler.start(this.sessions, {
      telegramUserId: customer.telegramUserId,
      now: new Date(),
    });
    await this.present(
      target,
      walletAmountPromptText(),
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private async startTicketCreate(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    await SupportFlowHandler.startCreate(this.sessions, {
      telegramUserId: customer.telegramUserId,
      now: new Date(),
    });
    await this.present(
      target,
      ticketCreatePromptText(),
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private async startTicketFollowUp(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    ticketId: string,
  ): Promise<void> {
    await SupportFlowHandler.startFollowUp(this.sessions, {
      telegramUserId: customer.telegramUserId,
      ticketId,
      now: new Date(),
    });
    await this.present(
      target,
      ticketFollowUpPromptText(),
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private async startRenewalCoupon(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    if (!(await this.commerce.hasActiveService(customer))) {
      await this.present(target, noActiveServiceText(), columnKeyboard([backToMenuButton()]));
      return;
    }
    await CommerceFlowHandler.startRenewal(this.sessions, {
      telegramUserId: customer.telegramUserId,
      now: new Date(),
    });
    await this.present(
      target,
      discountPromptText(),
      columnKeyboard([discountSkipButton(), flowCancelButton(), backToMenuButton()]),
    );
  }

  private async handleReceiptFile(
    customer: TelegramCustomerInput,
    target: MenuTarget,
    receipt: ReceiptFile,
  ): Promise<void> {
    await this.commerce.recordCustomerActivity(customer);
    try {
      await this.commerce.submitPaymentProof({
        customer,
        telegramFileId: receipt.fileId,
        telegramFileUniqueId: receipt.fileUniqueId,
        mediaKind: receipt.kind === 'document' ? 'document' : 'photo',
      });
    } catch (error: unknown) {
      if (error instanceof DomainConflictError) {
        await this.present(
          target,
          receiptConflictText(error.code),
          columnKeyboard([backToMenuButton()]),
        );
        return;
      }
      throw error;
    }
    await this.present(target, receiptAcceptedText(), columnKeyboard([backToMenuButton()]));
    // The durable, deduplicated, redacted reporting outbox owns administrator receipt
    // notices. A direct Telegram fanout here could lose or repeat a financial action.
  }

  private async handleCallback(
    update: TelegramUpdate,
    callback: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const data = callback.data;
    const chatId = callback.message?.chat.id;
    if (data === undefined || chatId === undefined || callback.message?.chat.type !== 'private') {
      await this.answerCallbackBestEffort(callback.id);
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
      const flowInput: ConversationInput = {
        kind: 'callback',
        updateId: String(update.update_id),
        telegramUserId: customer.telegramUserId,
        callbackData: data,
      };
      if (data === WALLET_TOPUP_CALLBACK) {
        await this.startWalletTopUp(target, customer);
      } else if (data === TICKET_NEW_CALLBACK) {
        await this.startTicketCreate(target, customer);
      } else if (data.startsWith(TICKET_FOLLOW_PREFIX)) {
        await this.startTicketFollowUp(target, customer, data.slice(TICKET_FOLLOW_PREFIX.length));
      } else if (await this.dispatchCustomerFlow(target, customer, flowInput)) {
        // Owned by the durable customer flow; acknowledgement still happens below.
      } else if (data === HOME_CALLBACK) {
        await this.routeAction('home', target, customer, false);
      } else if (data === SHOP_CALLBACK) {
        await this.routeAction('shop', target, customer, false);
      } else if (data === TRIAL_CALLBACK) {
        await this.routeAction('trial', target, customer, false);
      } else if (data === SERVICES_CALLBACK) {
        await this.routeAction('services', target, customer, false);
      } else if (data === ORDERS_WALLET_CALLBACK) {
        await this.routeAction('orders-wallet', target, customer, false);
      } else if (data === GUIDE_SUPPORT_CALLBACK) {
        await this.routeAction('guide-support', target, customer, false);
      } else if (data === INVITE_CALLBACK) {
        await this.routeAction('invite', target, customer, false);
      } else if (data === JOIN_REFRESH_CALLBACK) {
        await this.routeAction('shop', target, customer, false);
      } else if (data === 'trial:claim') {
        await this.claimTrial(target, customer);
      } else if (/^svc:\d+$/u.test(data)) {
        await this.showCustomerService(target, customer, data.slice(4));
      } else if (/^svc:link:\d+$/u.test(data)) {
        await this.resendServiceLink(target, customer, data.slice('svc:link:'.length));
      } else if (/^svc:guide:(ios|android|windows):\d+$/u.test(data)) {
        const [, , platform, serviceId] = data.split(':');
        await this.present(
          target,
          platformGuideText(platform as 'ios' | 'android' | 'windows'),
          columnKeyboard([
            { text: 'بازگشت به سرویس', callback_data: `svc:${serviceId ?? ''}` },
            backToMenuButton(),
          ]),
        );
      } else if (/^svc:qr:\d+$/u.test(data)) {
        await this.sendServiceQr(target, customer, data.slice('svc:qr:'.length));
      } else if (data === ADMIN_REP_WALLET_CALLBACK) {
        this.requireAdmin(actorId);
        this.requirePrivateTarget(target, customer);
        await this.startAdminRepWallet(target, customer);
      } else if (data === ADMIN_OPS_CALLBACK) {
        this.requireAdmin(actorId);
        await this.showCommercialSettings(target);
      } else if (data === 'ops:trial') {
        this.requireAdmin(actorId);
        await this.toggleTrial(target);
      } else if (data === 'ops:referral') {
        this.requireAdmin(actorId);
        await this.toggleReferral(target);
      } else if (
        data === 'ops:channel' ||
        data === 'ops:variant' ||
        data === 'ops:reminders' ||
        data === 'ops:block' ||
        data === 'ops:referralCredit' ||
        data === 'ops:referralDiscount' ||
        data === 'ops:referralCap'
      ) {
        this.requireAdmin(actorId);
        await this.startAdminOpsField(
          target,
          customer,
          data === 'ops:channel'
            ? 'channel'
            : data === 'ops:variant'
              ? 'trialVariant'
              : data === 'ops:reminders'
                ? 'reminderDays'
                : data === 'ops:referralCredit'
                  ? 'referralCredit'
                  : data === 'ops:referralDiscount'
                    ? 'referralDiscount'
                    : data === 'ops:referralCap'
                      ? 'referralCap'
                      : 'blockCustomer',
        );
      } else if (data === ADMIN_BROADCAST_CALLBACK) {
        this.requireAdmin(actorId);
        await this.startBroadcast(target, customer);
      } else if (data.startsWith(ADMIN_BROADCAST_CANCEL_PREFIX)) {
        this.requireAdmin(actorId);
        await this.cancelBroadcast(
          target,
          actorId,
          data.slice(ADMIN_BROADCAST_CANCEL_PREFIX.length),
        );
      } else if (data === GUIDE_CALLBACK) {
        await this.routeAction('guide', target, customer, false);
      } else if (data === HELP_CALLBACK) {
        await this.routeAction('help', target, customer, false);
      } else if (data === ORDER_CALLBACK) {
        await this.routeAction('order', target, customer, false);
      } else if (data === RENEW_CALLBACK) {
        await this.routeAction('renew', target, customer, false);
      } else if (data === RENEW_CONFIRM_CALLBACK) {
        await this.present(
          target,
          conversationExpiredText(),
          columnKeyboard([
            { text: MENU_LABEL.renew, callback_data: RENEW_CALLBACK },
            backToMenuButton(),
          ]),
        );
      } else if (data === ADMIN_STATUS_CALLBACK) {
        await this.routeAction('status', target, customer, false);
      } else if (data === ADMIN_REPORTS_CALLBACK) {
        await this.routeAction('reports', target, customer, false);
      } else if (data === ADMIN_QUEUE_CALLBACK) {
        await this.routeAction('queue', target, customer, false);
      } else if (data === ADMIN_HUB_CALLBACK) {
        await this.routeAction('admin', target, customer, false);
      } else if (data === ADMIN_STORE_CALLBACK) {
        this.requireAdmin(actorId);
        await this.showStoreHub(target, actorId);
      } else if (data.startsWith('store:')) {
        this.requireAdmin(actorId);
        await this.handleStoreCallback(target, actorId, data);
      } else if (data === ADMIN_FAILED_CALLBACK) {
        this.requireAdmin(actorId);
        await this.showFailedProvisioning(target);
      } else if (data === ADMIN_CATALOG_CALLBACK) {
        this.requireAdmin(actorId);
        await this.showCatalogHealth(target);
      } else if (data === ADMIN_SUMMARY_CALLBACK) {
        this.requireAdmin(actorId);
        await this.publishAdminDailySummary(target);
      } else if (data === ADMIN_SALES_CALLBACK) {
        this.requireAdmin(actorId);
        await this.showAdminSalesSnapshot(target);
      } else if (/^admin:order:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.showAdminOrder(target, data.slice('admin:order:'.length));
      } else if (/^cat:\d+$/u.test(data)) {
        if (!(await this.ensureChannelGate(target, customer, 'shop'))) {
          return;
        }
        await this.showCategory(target, data.slice(4), customer);
      } else if (/^product:\d+:\d+:\d+$/u.test(data)) {
        if (!(await this.ensureChannelGate(target, customer, 'shop'))) {
          return;
        }
        const [, categoryId = '', productId = '', page = '0'] = data.split(':');
        await this.showProductPlans(target, categoryId, productId, Number(page), customer);
      } else if (/^variant:\d+$/u.test(data)) {
        if (!(await this.ensureChannelGate(target, customer, 'shop'))) {
          return;
        }
        await this.showVariant(target, data.slice(8), customer);
      } else if (/^buy:\d+$/u.test(data)) {
        if (!(await this.ensureChannelGate(target, customer, 'shop'))) {
          return;
        }
        const variantId = data.slice(4);
        const variant = await this.commerce.getVariantForCustomer(variantId, customer);
        await CommerceFlowHandler.startPurchase(this.sessions, {
          telegramUserId: customer.telegramUserId,
          variantId,
          variantName: variant.name,
          now: new Date(),
        });
        await this.present(
          target,
          serviceUsernamePromptText(variant.name),
          columnKeyboard([shopBackButton(), flowCancelButton(), backToMenuButton()]),
        );
      } else if (/^admin:retry:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeRetry(data.slice('admin:retry:'.length), actorId, String(chatId));
      } else if (/^admin:proof:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeProofRetrieval(target, data.slice('admin:proof:'.length));
      } else if (/^admin:redeliver:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeDeliveryRetry(target, data.slice('admin:redeliver:'.length), actorId);
      } else if (/^approve:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeApproval(data.slice(8), actorId, String(chatId));
      } else if (/^reject:\d+$/u.test(data)) {
        this.requireAdmin(actorId);
        await this.completeRejection(data.slice(7), actorId, String(chatId));
      }
      await this.answerCallbackBestEffort(callback.id);
    } catch (error: unknown) {
      await this.answerCallbackBestEffort(callback.id, customerSafeError(error));
      if (error instanceof DomainConflictError) {
        if (error.code === 'PAYMENT_DETAILS_MISSING') {
          await this.present(
            target,
            paymentDetailsMissingText(),
            columnKeyboard([backToMenuButton()]),
          );
        }
        if (error.code === 'ADMIN_ACCESS_DENIED') {
          await this.present(target, adminDeniedText(), columnKeyboard([backToMenuButton()]));
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

  public async dispatchDueDeliveries(): Promise<void> {
    if (this.delivery === null) {
      return;
    }
    try {
      await this.delivery.dispatchDue();
    } catch (error: unknown) {
      if (!(error instanceof DomainConflictError)) {
        throw error;
      }
    }
  }

  public async dispatchDueReminders(): Promise<void> {
    await this.commercial.dispatchDueReminders(async (input) => {
      await this.messenger.sendMessage(
        input.chatId,
        reminderNoticeText(input.kind, `${input.productName} — ${input.variantName}`),
        undefined,
        { parseMode: 'HTML' },
      );
    });
  }

  public async dispatchDueBroadcasts(): Promise<void> {
    await this.commercial.dispatchDueBroadcasts(async (input) => {
      await this.messenger.sendMessage(input.chatId, input.body);
    });
  }

  public async dispatchDueUsageSync(): Promise<void> {
    await this.usageSync.syncDue();
  }

  public async publishDailySummary(): Promise<boolean> {
    if (this.dailySummary === null) {
      return false;
    }
    const result = await this.dailySummary.publishForUtcDay();
    return result.created;
  }

  private async routeAction(
    action: MenuAction,
    target: MenuTarget,
    customer: TelegramCustomerInput,
    showWelcomeMedia = false,
  ): Promise<void> {
    switch (action) {
      case 'home':
        await this.showHome(target, customer, showWelcomeMedia);
        return;
      case 'shop':
        if (!(await this.ensureChannelGate(target, customer, 'shop'))) {
          return;
        }
        await this.showRootCategories(target, this.isAdmin(customer.telegramUserId));
        return;
      case 'trial':
        await this.showTrial(target, customer);
        return;
      case 'services':
        await this.showCustomerServices(target, customer);
        return;
      case 'invite':
        await this.showInvite(target, customer);
        return;
      case 'orders-wallet':
        await this.present(target, ordersWalletHubText(), ordersWalletHubKeyboard());
        return;
      case 'guide-support':
        await this.present(target, guideSupportHubText(), guideSupportHubKeyboard());
        return;
      case 'guide':
        await this.present(target, guideText(), guideInlineKeyboard());
        return;
      case 'help':
        await this.present(target, helpText(), helpKeyboard());
        return;
      case 'order':
        await this.showOrder(target, customer);
        return;
      case 'renew':
        await this.startRenewalCoupon(target, customer);
        return;
      case 'wallet':
        await this.startWalletTopUp(target, customer);
        return;
      case 'ticket':
        await this.startTicketCreate(target, customer);
        return;
      case 'status':
      case 'reports':
      case 'queue':
      case 'admin':
        if (!this.isAdmin(customer.telegramUserId)) {
          await this.present(target, adminDeniedText(), columnKeyboard([backToMenuButton()]));
          return;
        }
        await this.showAdmin(action, target);
        return;
      case 'store':
        if (!this.isAdmin(customer.telegramUserId)) {
          await this.present(target, adminDeniedText(), columnKeyboard([backToMenuButton()]));
          return;
        }
        this.requirePrivateTarget(target, customer);
        await this.showStoreHub(target, customer.telegramUserId);
        return;
    }
  }

  private async answerCallbackBestEffort(callbackId: string, text?: string): Promise<void> {
    try {
      if (text === undefined) {
        await this.messenger.answerCallbackQuery(callbackId);
      } else {
        await this.messenger.answerCallbackQuery(callbackId, text);
      }
    } catch {
      // Callback acknowledgements can expire after the requested work already completed.
    }
  }

  private requirePrivateTarget(target: MenuTarget, customer: TelegramCustomerInput): void {
    if (target.chatId !== customer.privateChatId) {
      throw new DomainConflictError('ADMIN_ACCESS_DENIED');
    }
  }

  private async showHome(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    showWelcomeMedia: boolean,
  ): Promise<void> {
    if (target.messageId !== undefined) {
      await this.present(target, homeReturnText(), { inline_keyboard: [] });
      return;
    }
    if (showWelcomeMedia) {
      await this.sendBrandPhoto(
        target.chatId,
        this.config.brandMedia.welcomePhotoFileId,
        brandWelcomeCaption(),
      );
    }
    const admin = this.isAdmin(customer.telegramUserId);
    const { customer: recorded } = await this.repository.upsertTelegramCustomer(customer);
    const trialEligible =
      !admin &&
      recorded.shopBlocked !== true &&
      (await this.commercial.isTrialEligible(recorded.id));
    await this.messenger.sendMessage(
      target.chatId,
      homeText(admin),
      homeReplyKeyboard(admin, { trialEligible }),
      { parseMode: 'HTML' },
    );
  }

  private async showRootCategories(target: MenuTarget, isAdmin: boolean): Promise<void> {
    const categories = await this.commerce.listCategories(null);
    if (categories.length === 0) {
      await this.present(
        target,
        emptyShopText(isAdmin),
        columnKeyboard(
          isAdmin
            ? [{ text: MENU_LABEL.store, callback_data: ADMIN_STORE_CALLBACK }, backToMenuButton()]
            : [backToMenuButton()],
        ),
      );
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

  private async showCategory(
    target: MenuTarget,
    categoryId: string,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    const category = await this.repository.getCategory(categoryId);
    if (category === null) {
      await this.present(
        target,
        missingCategoryText(),
        catalogKeyboard([], [shopBackButton(), backToMenuButton()]),
      );
      return;
    }
    const [parent, children, variants] = await Promise.all([
      category.parentId === null
        ? Promise.resolve(null)
        : this.repository.getCategory(category.parentId),
      this.commerce.listCategories(categoryId),
      this.commerce.listVariantsForCustomer(categoryId, customer),
    ]);
    const hasItems = children.length > 0 || variants.length > 0;
    await this.present(
      target,
      categoryText({
        name: category.name,
        description: category.description,
        parentName: parent?.name ?? null,
        hasItems,
      }),
      this.buildCategoryKeyboard(categoryId, children, variants, parent),
    );
  }

  private buildCategoryKeyboard(
    categoryId: string,
    children: readonly { readonly id: string; readonly name: string }[],
    variants: readonly SellableProductVariant[],
    parent: { readonly id: string; readonly name: string } | null,
  ): TelegramInlineKeyboardMarkup {
    const childItems = children.map((child) => ({
      text: child.name,
      callback_data: `cat:${child.id}`,
    }));
    const productGroups = new Map<string, { readonly id: string; readonly name: string }>();
    for (const variant of variants) {
      if (variant.productId !== undefined) {
        productGroups.set(variant.productId, { id: variant.productId, name: variant.productName });
      }
    }
    const productItems = [...productGroups.values()].map((product) => ({
      text: product.name,
      callback_data: `product:${categoryId}:${product.id}:0`,
    }));
    const variantItems = variants.map((variant) => ({
      text: variantListLabel(variant),
      callback_data: `variant:${variant.id}`,
    }));
    const footer = [categoryBackButton(parent), backToMenuButton()];

    if (variantItems.length === 0) {
      return catalogKeyboard(childItems, footer);
    }

    if (productItems.length > 0) {
      return {
        inline_keyboard: [
          ...(childItems.length > 0 ? catalogKeyboard(childItems, []).inline_keyboard : []),
          ...columnKeyboard(productItems).inline_keyboard,
          ...catalogKeyboard([], footer).inline_keyboard,
        ],
      };
    }

    return {
      inline_keyboard: [
        ...(childItems.length > 0 ? catalogKeyboard(childItems, []).inline_keyboard : []),
        ...columnKeyboard(variantItems).inline_keyboard,
        ...catalogKeyboard([], footer).inline_keyboard,
      ],
    };
  }

  private async showProductPlans(
    target: MenuTarget,
    categoryId: string,
    productId: string,
    requestedPage: number,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    const variants = (await this.commerce.listVariantsForCustomer(categoryId, customer)).filter(
      (variant) => variant.productId === productId,
    );
    if (variants.length === 0) {
      await this.showCategory(target, categoryId, customer);
      return;
    }
    const pageCount = Math.ceil(variants.length / 3);
    const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
    const selected = variants.slice(page * 3, page * 3 + 3);
    await this.present(
      target,
      productPlansText({
        productName: variants[0]?.productName ?? 'محصول',
        planCount: variants.length,
        page,
        pageCount,
        variants: selected,
      }),
      columnKeyboard([
        ...selected.map((variant) => ({
          text: variantListLabel(variant),
          callback_data: `variant:${variant.id}`,
        })),
        ...(page > 0
          ? [
              {
                text: 'پلن‌های قبلی ◀',
                callback_data: `product:${categoryId}:${productId}:${String(page - 1)}`,
              },
            ]
          : []),
        ...(page + 1 < pageCount
          ? [
              {
                text: 'پلن‌های بعدی ▶',
                callback_data: `product:${categoryId}:${productId}:${String(page + 1)}`,
              },
            ]
          : []),
        { text: 'بازگشت به دسته ⬅️', callback_data: `cat:${categoryId}` },
        shopBackButton(),
        backToMenuButton(),
      ]),
    );
  }

  private async showVariant(
    target: MenuTarget,
    variantId: string,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    const variant = await this.commerce.getVariantForCustomer(variantId, customer);
    await this.present(
      target,
      variantText(variant),
      columnKeyboard([
        { text: 'ادامه و دریافت شماره کارت 💳', callback_data: `buy:${variant.id}` },
        shopBackButton(),
        backToMenuButton(),
      ]),
    );
  }

  private async showOrder(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const order = await this.repository.getOpenOrderForCustomer(recorded.customer.id);
    await this.present(target, orderStatusText(order), this.orderKeyboard(order));
  }

  private async showAdmin(
    action: 'status' | 'reports' | 'queue' | 'admin',
    target: MenuTarget,
  ): Promise<void> {
    if (action === 'status') {
      const categories = await this.commerce.listCategories(null);
      const reports = await this.deliveryCounts();
      const intake = readTelegramIntakeHealth(
        Date.now(),
        this.config.webhookUrl === null ? 'polling' : 'webhook',
      );
      await this.present(
        target,
        adminStatusText({
          categoryCount: categories.length,
          forumConfigured: this.config.reporting !== null,
          localIntake: this.config.webhookUrl === null,
          telegramReady: intake.ready,
          telegramError: intake.error,
          reportsPending: reports.pending,
          reportsFailed: reports.failed,
        }),
        adminScreenKeyboard(),
      );
      return;
    }
    if (action === 'reports') {
      const reports = await this.deliveryCounts();
      await this.present(
        target,
        adminReportsText({
          forumConfigured: this.config.reporting !== null,
          reportsPending: reports.pending,
          reportsFailed: reports.failed,
        }),
        adminReportsKeyboard(this.dailySummary !== null),
      );
      return;
    }
    if (action === 'queue') {
      const orders = await this.repository.listReviewQueue(10);
      await this.present(target, adminQueueText(orders), adminQueueKeyboard(orders));
      return;
    }
    await this.present(target, adminHubText(), adminHubKeyboard());
  }

  private async showStoreHub(target: MenuTarget, adminId: string): Promise<void> {
    const [model, pending] = await Promise.all([
      this.catalogChat.getReadModel(),
      this.catalogChat.getPendingSession(adminId),
    ]);
    await this.present(
      target,
      [
        '<b>NEO NETWORK — مدیریت فروشگاه</b>',
        `دسته‌ها: ${String(model.categories.length)} | محصولات: ${String(model.products.length)} | پلن‌ها: ${String(model.variants.length)}`,
        'یک کار را انتخاب کن. هر تغییر ابتدا پیش‌نمایش می‌شود و فقط با «انتشار نهایی» اعمال می‌شود.',
      ].join('\n'),
      columnKeyboard([
        { text: 'دسته‌ها', callback_data: 'store:list:c:0' },
        { text: 'محصولات', callback_data: 'store:list:p:0' },
        { text: 'پلن‌ها', callback_data: 'store:list:v:0' },
        { text: 'ساخت سریع', callback_data: 'store:create' },
        { text: 'تنظیمات فروش و کارت', callback_data: 'store:new:settings' },
        { text: 'بایگانی و بازگردانی', callback_data: 'store:list:a:0' },
        { text: 'سلامت گروه‌ها', callback_data: 'store:groups:0' },
        { text: 'نمای فروشگاه', callback_data: 'store:preview' },
        ...(pending === null ? [] : [{ text: 'ادامه فرم باز', callback_data: 'store:resume' }]),
        { text: MENU_LABEL.admin, callback_data: ADMIN_HUB_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async handleStoreCallback(
    target: MenuTarget,
    adminId: string,
    data: string,
  ): Promise<void> {
    if (data === 'store:cancel') {
      const session = await this.catalogChat.getPendingSession(adminId);
      if (session !== null)
        await this.catalogChat.cancelSession({
          id: session.id,
          adminTelegramUserId: adminId,
          now: new Date(),
        });
      await this.showStoreHub(target, adminId);
      return;
    }
    if (data === 'store:resume') {
      const session = await this.catalogChat.getPendingSession(adminId);
      if (session === null) return this.showStoreHub(target, adminId);
      await this.renderStoreSession(target, adminId, session, true);
      return;
    }
    if (data === 'store:create') {
      await this.present(
        target,
        'مورد جدید را انتخاب کن.',
        columnKeyboard([
          { text: 'دسته + محصول + پلن', callback_data: 'store:new:guided' },
          { text: 'دسته', callback_data: 'store:new:category' },
          { text: 'محصول', callback_data: 'store:new:product' },
          { text: 'پلن', callback_data: 'store:new:variant' },
          { text: 'مدیریت فروشگاه', callback_data: ADMIN_STORE_CALLBACK },
          backToMenuButton(),
        ]),
      );
      return;
    }
    if (/^store:list:[cpva]:\d+$/u.test(data)) {
      const [, , kind, page] = data.split(':');
      await this.showStoreList(target, kind as 'c' | 'p' | 'v' | 'a', Number(page));
      return;
    }
    if (/^store:enable:v:\d+$/u.test(data)) {
      await this.startStoreEnableVariant(target, adminId, data.slice('store:enable:v:'.length));
      return;
    }
    if (/^store:detail:[cpv]:\d+$/u.test(data)) {
      const [, , kind = '', id = ''] = data.split(':');
      await this.showStoreDetail(target, kind as 'c' | 'p' | 'v', id);
      return;
    }
    if (/^store:customer:[cpv]:\d+$/u.test(data)) {
      const [, , kind = '', id = ''] = data.split(':');
      await this.showStoreCustomerPreview(target, kind as 'c' | 'p' | 'v', id);
      return;
    }
    if (/^store:edit:[cpv]:\d+$/u.test(data)) {
      const [, , kind = '', id = ''] = data.split(':');
      await this.startStoreEdit(target, adminId, kind as 'c' | 'p' | 'v', id);
      return;
    }
    if (/^store:move:[cpv]:\d+:(up|down)$/u.test(data)) {
      const [, , kind = '', id = '', direction = ''] = data.split(':');
      await this.startStoreReorder(
        target,
        adminId,
        kind as 'c' | 'p' | 'v',
        id,
        direction as 'up' | 'down',
      );
      return;
    }
    if (
      /^store:field:[cpv]:(name|description|position|shortName|badge|durationDays|groupIds|displayAttributes)$/u.test(
        data,
      )
    ) {
      const [, , kind = '', field = ''] = data.split(':');
      await this.selectStoreDraftField(target, adminId, kind as 'c' | 'p' | 'v', field);
      return;
    }
    if (data === 'store:draft:review') {
      await this.reviewStoreDraft(target, adminId);
      return;
    }
    if (/^store:action:(archive|restore):[cpv]:\d+$/u.test(data)) {
      const [, , action = '', kind = '', id = ''] = data.split(':');
      await this.startStoreReviewForEntity(
        target,
        adminId,
        action as 'archive' | 'restore',
        kind as 'c' | 'p' | 'v',
        id,
      );
      return;
    }
    if (data === 'store:publish') {
      const session = await this.catalogChat.getPendingSession(adminId);
      if (session === null) throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_FOUND');
      const published = await this.catalogChat.publishSession({
        id: session.id,
        adminTelegramUserId: adminId,
        now: new Date(),
      });
      await this.present(
        target,
        `<b>منتشر شد</b>\nنسخهٔ کاتالوگ: ${String(published.revision)}`,
        columnKeyboard([{ text: 'مدیریت فروشگاه', callback_data: ADMIN_STORE_CALLBACK }]),
      );
      return;
    }
    if (data === 'store:preview') {
      await this.showStorePreview(target, 0);
      return;
    }
    if (/^store:preview:\d+$/u.test(data)) {
      await this.showStorePreview(target, Number(data.slice('store:preview:'.length)));
      return;
    }
    if (/^store:groups:\d+$/u.test(data)) {
      await this.showProviderHealth(target, Number(data.slice('store:groups:'.length)));
      return;
    }
    if (data === 'store:new:category') {
      await this.startStoreSession(target, adminId, {
        kind: 'category',
        step: 'category-fields',
        field: 'select',
        mode: 'edit',
        values: { code: generatedCatalogCode('cat') },
      });
      return;
    }
    if (data === 'store:new:guided') {
      await this.startStoreGuidedChangeset(target, adminId);
      return;
    }
    if (data === 'store:new:product') {
      await this.startStoreProduct(target, adminId);
      return;
    }
    if (data === 'store:new:variant') {
      await this.startStoreVariant(target, adminId);
      return;
    }
    if (data === 'store:new:settings') {
      await this.startStoreSettings(target, adminId);
      return;
    }
    if (data === 'store:pick:category') {
      await this.showPicker(target, 'category', 0);
      return;
    }
    if (/^store:picker:(category|product):\d+$/u.test(data)) {
      const [, , kind, page] = data.split(':');
      await this.showPicker(target, kind as 'category' | 'product', Number(page));
      return;
    }
    if (/^store:pick:category:\d+:\d+$/u.test(data)) {
      const [, , , id] = data.split(':');
      const category = (await this.catalogChat.getReadModel()).categories.find(
        (item) => item.id === id,
      );
      if (category === undefined) throw new DomainConflictError('CATEGORY_NOT_FOUND');
      await this.advanceStoreSession(target, adminId, (session) => ({
        kind: 'product',
        step: 'product-fields',
        field: 'select',
        mode: 'edit',
        values: { ...storeValues(session.state), categoryCode: category.code },
      }));
      return;
    }
    if (data === 'store:pick:product') {
      await this.showPicker(target, 'product', 0);
      return;
    }
    if (/^store:pick:product:\d+:\d+$/u.test(data)) {
      const [, , , id] = data.split(':');
      const product = (await this.catalogChat.getReadModel()).products.find(
        (item) => item.id === id,
      );
      if (product === undefined) throw new DomainConflictError('PRODUCT_NOT_FOUND');
      await this.present(
        target,
        'نوع پلن را انتخاب کن.',
        columnKeyboard([
          { text: 'حجمی', callback_data: `store:template:volume:${product.id}` },
          { text: 'نامحدود', callback_data: `store:template:unlimited:${product.id}` },
          { text: 'مولتی‌کانکشن', callback_data: `store:template:multi:${product.id}` },
          { text: 'سفارشی', callback_data: `store:template:custom:${product.id}` },
          { text: 'لغو', callback_data: 'store:cancel' },
        ]),
      );
      return;
    }
    if (/^store:template:(volume|unlimited|multi|custom):\d+$/u.test(data)) {
      await this.applyVariantTemplate(target, adminId, data);
      return;
    }
    if (/^store:g:\d+$/u.test(data)) {
      await this.toggleProviderGroup(target, adminId, Number(data.slice('store:g:'.length)));
      return;
    }
    if (data === 'store:g:done') {
      await this.finishProviderGroups(target, adminId);
      return;
    }
    if (/^store:gpage:\d+$/u.test(data)) {
      await this.showProviderGroups(
        target,
        adminId,
        undefined,
        Number(data.slice('store:gpage:'.length)),
      );
      return;
    }
  }

  private async startStoreSession(
    target: MenuTarget,
    adminId: string,
    state: CatalogAdminWizardState,
  ): Promise<void> {
    try {
      const session = await this.catalogChat.startSession({
        id: randomUUID(),
        adminTelegramUserId: adminId,
        now: new Date(),
      });
      await this.catalogChat.updateSession({
        id: session.id,
        adminTelegramUserId: adminId,
        state,
        now: new Date(),
      });
      await this.renderStoreSession(target, adminId, { ...session, state }, false);
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code === 'CATALOG_ADMIN_SESSION_ACTIVE') {
        const existing = await this.catalogChat.getPendingSession(adminId);
        if (existing !== null) {
          await this.renderStoreSession(target, adminId, existing, true);
          return;
        }
      }
      throw error;
    }
  }

  private async startStoreProduct(target: MenuTarget, adminId: string): Promise<void> {
    if ((await this.catalogChat.getReadModel()).categories.length === 0)
      throw new DomainConflictError('CATEGORY_NOT_FOUND');
    await this.startStoreSession(target, adminId, {
      kind: 'product',
      step: 'product-fields',
      field: 'categoryCode',
      values: { code: generatedCatalogCode('product') },
    });
    await this.showPicker(target, 'category', 0);
  }
  private async startStoreVariant(target: MenuTarget, adminId: string): Promise<void> {
    if ((await this.catalogChat.getReadModel()).products.length === 0)
      throw new DomainConflictError('PRODUCT_NOT_FOUND');
    await this.startStoreSession(target, adminId, {
      kind: 'variant',
      step: 'variant-fields',
      field: 'productCode',
      values: { code: generatedCatalogCode('plan') },
    });
    await this.showPicker(target, 'product', 0);
  }
  private async startStoreGuidedChangeset(target: MenuTarget, adminId: string): Promise<void> {
    await this.startStoreSession(target, adminId, {
      kind: 'changeset',
      step: 'guided-fields',
      field: 'categoryName',
      values: {
        categoryCode: generatedCatalogCode('cat'),
        productCode: generatedCatalogCode('product'),
        variantCode: generatedCatalogCode('plan'),
      },
    });
  }
  private async startStoreSettings(target: MenuTarget, adminId: string): Promise<void> {
    const settings = (await this.catalogAdmin.getPublicCatalog()).settings;
    await this.startStoreSession(target, adminId, {
      kind: 'settings',
      step: 'settings-fields',
      field: 'brandName',
      values: { ...settings },
    });
  }
  private async advanceStoreSession(
    target: MenuTarget,
    adminId: string,
    next: (session: CatalogAdminSession) => CatalogAdminWizardState,
  ): Promise<void> {
    const session = await this.catalogChat.getPendingSession(adminId);
    if (session === null) throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_FOUND');
    const state = next(session);
    await this.catalogChat.updateSession({
      id: session.id,
      adminTelegramUserId: adminId,
      state,
      now: new Date(),
    });
    await this.renderStoreSession(target, adminId, { ...session, state }, false);
  }

  private async renderStoreSession(
    target: MenuTarget,
    adminId: string,
    session: CatalogAdminSession,
    resumed: boolean,
  ): Promise<void> {
    const state = session.state;
    if (
      (state.kind === 'category' || state.kind === 'product' || state.kind === 'variant') &&
      state.field === 'select'
    ) {
      await this.showStoreDraftFields(target, state);
      return;
    }
    if (state.kind === 'product' && state.field === 'categoryCode') {
      await this.showPicker(target, 'category', 0);
      return;
    }
    if (state.kind === 'variant' && state.field === 'productCode') {
      await this.showPicker(target, 'product', 0);
      return;
    }
    if (state.kind === 'variant' && state.field === 'groupIds') {
      await this.showProviderGroups(target, adminId);
      return;
    }
    if (state.kind === 'changeset' && state.field === 'groupIds') {
      await this.showProviderGroups(target, adminId);
      return;
    }
    await this.present(
      target,
      state.kind === 'review'
        ? await this.storeReviewText(state)
        : `${this.storePrompt(state)}${resumed ? '\n\nفرم ذخیره‌شده ادامه دارد.' : ''}`,
      state.kind === 'review'
        ? storeWizardKeyboard([{ text: 'انتشار نهایی', callback_data: 'store:publish' }])
        : storeWizardKeyboard(),
    );
  }

  private async handleStoreText(
    target: MenuTarget,
    adminId: string,
    raw: string,
    session: CatalogAdminSession,
    messageId: string,
  ): Promise<void> {
    const text = raw.trim();
    if (session.state.kind === 'changeset') {
      const values = session.state.values;
      if (session.state.field === 'categoryName')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'changeset',
          step: 'guided-fields',
          field: 'productName',
          values: { ...values, categoryName: text },
        }));
      if (session.state.field === 'productName')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'changeset',
          step: 'guided-fields',
          field: 'variantSpec',
          values: { ...values, productName: text },
        }));
      if (session.state.field === 'variantSpec') {
        const parsed = parseCustomVariant(text);
        return this.beginVariantDisplayCopy(target, adminId, { ...values, ...parsed });
      }
      if (session.state.field === 'variantName')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'changeset',
          step: 'guided-fields',
          field: 'variantDescription',
          values: { ...values, variantName: text === '-' ? '' : text },
        }));
      if (session.state.field === 'variantDescription')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'changeset',
          step: 'guided-fields',
          field: 'displayAttributes',
          values: { ...values, variantDescription: text === '-' ? '' : text },
        }));
      if (session.state.field === 'displayAttributes') {
        return this.showProviderGroups(target, adminId, {
          ...values,
          displayAttributes: parseDisplayAttributes(text),
        });
      }
    }
    if (session.state.kind === 'category') {
      const values = session.state.values;
      if (session.state.field === 'name')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'category', {
            ...values,
            name: text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'category',
            step: 'category-fields',
            field: 'description',
            values: { ...values, name: text },
          }));
      if (session.state.field === 'description')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'category', {
            ...values,
            description: text === '-' ? '' : text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'category',
            step: 'category-fields',
            field: 'position',
            values: { ...values, description: text === '-' ? '' : text },
          }));
      if (session.state.mode === 'edit')
        return this.returnToStoreDraftFields(target, adminId, 'category', {
          ...values,
          position: parsePersianInteger(text),
        });
      return this.advanceStoreSession(target, adminId, () => ({
        kind: 'review',
        step: 'confirm',
        delta: {
          kind: 'category',
          code: requiredStoreString(values.code),
          name: requiredStoreString(values.name),
          description: values.description ?? '',
          position: parsePersianInteger(text),
        },
      }));
    }
    if (session.state.kind === 'product') {
      const values = session.state.values;
      if (session.state.field === 'name')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'product', {
            ...values,
            name: text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'product',
            step: 'product-fields',
            field: 'shortName',
            values: { ...values, name: text },
          }));
      if (session.state.field === 'shortName')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'product', {
            ...values,
            shortName: text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'product',
            step: 'product-fields',
            field: 'description',
            values: { ...values, shortName: text },
          }));
      if (session.state.field === 'description')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'product', {
            ...values,
            description: text === '-' ? '' : text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'product',
            step: 'product-fields',
            field: 'badge',
            values: { ...values, description: text === '-' ? '' : text },
          }));
      if (session.state.field === 'badge')
        if (session.state.mode === 'edit')
          return this.returnToStoreDraftFields(target, adminId, 'product', {
            ...values,
            badge: text === '-' ? null : text,
          });
        else
          return this.advanceStoreSession(target, adminId, () => ({
            kind: 'review',
            step: 'confirm',
            delta: {
              kind: 'product',
              code: requiredStoreString(values.code),
              categoryCode: requiredStoreString(values.categoryCode),
              name: requiredStoreString(values.name),
              shortName: values.shortName ?? requiredStoreString(values.name),
              description: values.description ?? '',
              badge: text === '-' ? null : text,
              iconKey: values.iconKey ?? 'globe',
              position: values.position ?? 0,
              active: values.active ?? true,
            },
          }));
    }
    if (session.state.kind === 'settings') {
      if (session.state.field === 'cardNumber')
        await this.messenger.deleteMessage?.(target.chatId, messageId).catch(() => undefined);
      const values = {
        ...session.state.values,
        [session.state.field]:
          session.state.field === 'cardNumber' ? normalizeNumericText(text) : text,
      };
      const fields: (keyof typeof values)[] = [
        'brandName',
        'heroTitle',
        'heroSubtitle',
        'deliveryNote',
        'supportNote',
        'volumeHelper',
        'cardNumber',
        'cardHolder',
      ];
      const next = fields[fields.indexOf(session.state.field) + 1];
      if (next === undefined)
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'review',
          step: 'confirm',
          delta: { kind: 'settings', settings: values as StorefrontCatalog['settings'] },
        }));
      return this.advanceStoreSession(target, adminId, () => ({
        kind: 'settings',
        step: 'settings-fields',
        field: next,
        values,
      }));
    }
    if (session.state.kind === 'variant' && session.state.field === 'name') {
      const values = session.state.values;
      if (session.state.mode !== 'edit')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'variant',
          step: 'variant-fields',
          field: 'description',
          values: { ...values, name: text === '-' ? '' : text },
        }));
      return this.returnToStoreDraftFields(target, adminId, 'variant', {
        ...values,
        name: text,
      });
    }
    if (session.state.kind === 'variant' && session.state.field === 'displayAttributes') {
      const values = { ...session.state.values, displayAttributes: parseDisplayAttributes(text) };
      if (session.state.mode === 'edit')
        return this.returnToStoreDraftFields(target, adminId, 'variant', values);
      return this.showProviderGroups(target, adminId, values);
    }
    if (session.state.kind === 'variant' && session.state.field === 'description') {
      const values = session.state.values;
      if (session.state.mode !== 'edit')
        return this.advanceStoreSession(target, adminId, () => ({
          kind: 'variant',
          step: 'variant-fields',
          field: 'displayAttributes',
          values: { ...values, description: text === '-' ? '' : text },
        }));
      return this.returnToStoreDraftFields(target, adminId, 'variant', {
        ...values,
        description: text === '-' ? '' : text,
      });
    }
    if (session.state.kind === 'variant' && session.state.field === 'durationDays') {
      const parsed = parseCustomVariant(text);
      const current = session.state.values;
      if (session.state.mode === 'edit')
        return this.returnToStoreDraftFields(target, adminId, 'variant', { ...current, ...parsed });
      return this.beginVariantDisplayCopy(target, adminId, {
        ...current,
        ...parsed,
        code: current.code ?? generatedCatalogCode('plan'),
        position: current.position ?? 0,
        sellable: current.sellable ?? true,
      });
    }
    await this.present(
      target,
      this.storePrompt(session.state),
      columnKeyboard([{ text: 'لغو', callback_data: 'store:cancel' }]),
    );
  }

  private async applyVariantTemplate(
    target: MenuTarget,
    adminId: string,
    data: string,
  ): Promise<void> {
    const [, , template, productId] = data.split(':');
    const product = (await this.catalogChat.getReadModel()).products.find(
      (item) => item.id === productId,
    );
    if (product === undefined) throw new DomainConflictError('PRODUCT_NOT_FOUND');
    const base =
      template === 'unlimited'
        ? { dataLimitBytes: 0n, durationDays: 30, deviceLimit: 1, priceIrr: 1_000_000n }
        : template === 'multi'
          ? {
              dataLimitBytes: 50n * 1024n ** 3n,
              durationDays: 30,
              deviceLimit: 3,
              priceIrr: 1_500_000n,
            }
          : template === 'custom'
            ? null
            : {
                dataLimitBytes: 30n * 1024n ** 3n,
                durationDays: 30,
                deviceLimit: 1,
                priceIrr: 900_000n,
              };
    if (base === null) {
      await this.advanceStoreSession(target, adminId, (session) => ({
        kind: 'variant',
        step: 'variant-fields',
        field: 'durationDays',
        values: { ...storeValues(session.state), productCode: product.code },
      }));
      return;
    }
    await this.beginVariantDisplayCopy(target, adminId, {
      code: generatedCatalogCode('plan'),
      productCode: product.code,
      ...base,
      position: 0,
      sellable: true,
    });
  }
  private async beginVariantDisplayCopy(
    target: MenuTarget,
    adminId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.advanceStoreSession(target, adminId, (session) => {
      if (session.state.kind === 'changeset')
        return { kind: 'changeset', step: 'guided-fields', field: 'variantName', values };
      return { kind: 'variant', step: 'variant-fields', field: 'name', values };
    });
  }
  private async showProviderGroups(
    target: MenuTarget,
    adminId: string,
    values?: Record<string, unknown>,
    requestedPage = 0,
  ): Promise<void> {
    const groups = (await this.catalogAdmin.listProviderGroups()).filter(
      (item) => item.available && !item.disabled,
    );
    if (groups.length === 0) throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    if (values !== undefined) {
      await this.advanceStoreSession(target, adminId, (current) =>
        current.state.kind === 'changeset'
          ? { kind: 'changeset', step: 'guided-fields', field: 'groupIds', values }
          : { kind: 'variant', step: 'variant-fields', field: 'groupIds', values },
      );
    }
    const session = await this.catalogChat.getPendingSession(adminId);
    if (session?.state.kind !== 'variant' && session?.state.kind !== 'changeset')
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_FOUND');
    const selected = new Set(session.state.values.groupIds ?? []);
    const pageCount = Math.max(1, Math.ceil(groups.length / 8));
    const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
    const rows = groups.slice(page * 8, page * 8 + 8);
    await this.present(
      target,
      'گروه‌های فعال PasarGuard را انتخاب کن. فقط گروه‌های یک ارائه‌دهنده را می‌توانی هم‌زمان انتخاب کنی.',
      columnKeyboard([
        ...rows.map((group) => ({
          text: `${selected.has(group.groupId) ? '✓ ' : ''}${buttonLabel(group.name)}`,
          callback_data: `store:g:${String(group.groupId)}`,
        })),
        { text: '◀', callback_data: `store:gpage:${String(Math.max(0, page - 1))}` },
        { text: `${String(page + 1)}/${String(pageCount)}`, callback_data: 'store:g:done' },
        { text: '▶', callback_data: `store:gpage:${String(Math.min(pageCount - 1, page + 1))}` },
        { text: 'تأیید گروه‌ها', callback_data: 'store:g:done' },
        { text: 'لغو', callback_data: 'store:cancel' },
      ]),
    );
  }

  private async toggleProviderGroup(
    target: MenuTarget,
    adminId: string,
    groupId: number,
  ): Promise<void> {
    const groups = (await this.catalogAdmin.listProviderGroups()).filter(
      (item) => item.available && !item.disabled,
    );
    const selectedGroup = groups.find((item) => item.groupId === groupId);
    if (selectedGroup === undefined) throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    await this.advanceStoreSession(target, adminId, (session) => {
      if (session.state.kind !== 'variant' && session.state.kind !== 'changeset')
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
      const selected = new Set(session.state.values.groupIds ?? []);
      const existing = groups.filter((item) => selected.has(item.groupId));
      const existingProviderCode = existing[0]?.providerCode;
      if (existingProviderCode !== undefined && existingProviderCode !== selectedGroup.providerCode)
        throw new DomainConflictError('PROVIDER_GROUP_MIXED_PROVIDER');
      if (selected.has(groupId)) selected.delete(groupId);
      else selected.add(groupId);
      const values = { ...session.state.values, groupIds: [...selected] };
      if (selected.size === 0) delete values.providerCode;
      else values.providerCode = selectedGroup.providerCode;
      return session.state.kind === 'changeset'
        ? { kind: 'changeset', step: 'guided-fields', field: 'groupIds', values }
        : { kind: 'variant', step: 'variant-fields', field: 'groupIds', values };
    });
    await this.showProviderGroups(target, adminId);
  }

  private async finishProviderGroups(target: MenuTarget, adminId: string): Promise<void> {
    const session = await this.catalogChat.getPendingSession(adminId);
    if (session?.state.kind !== 'variant' && session?.state.kind !== 'changeset')
      throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    if (
      typeof session.state.values.providerCode !== 'string' ||
      session.state.values.providerCode.length === 0 ||
      session.state.values.groupIds?.length === 0
    )
      throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    if (session.state.kind === 'variant' && session.state.mode === 'edit') {
      await this.returnToStoreDraftFields(target, adminId, 'variant', { ...session.state.values });
      return;
    }
    await this.advanceStoreSession(target, adminId, (current) =>
      current.state.kind === 'changeset'
        ? this.reviewGuidedChangeset(storeValues(current.state))
        : this.reviewVariant(storeValues(current.state)),
    );
  }
  private reviewVariant(values: Record<string, unknown>): CatalogAdminWizardState {
    const dataLimitBytes = values['dataLimitBytes'] as bigint;
    const durationDays = values['durationDays'] as number;
    const deviceLimit = values['deviceLimit'] as number;
    return {
      kind: 'review',
      step: 'confirm',
      delta: {
        kind: 'variant',
        code: values['code'] as string,
        productCode: values['productCode'] as string,
        name: displayVariantName(values['name'], { dataLimitBytes, durationDays, deviceLimit }),
        description: (values['description'] as string | undefined) ?? '',
        durationDays,
        dataLimitBytes,
        deviceLimit,
        priceIrr: values['priceIrr'] as bigint,
        position: values['position'] as number,
        sellable: values['sellable'] as boolean,
        providerCode: values['providerCode'] as string,
        groupIds: values['groupIds'] as number[],
        ...(values['displayAttributes'] === undefined
          ? {}
          : { displayAttributes: values['displayAttributes'] as never }),
      },
    };
  }
  private reviewGuidedChangeset(values: Record<string, unknown>): CatalogAdminWizardState {
    const dataLimitBytes = values['dataLimitBytes'] as bigint;
    const durationDays = values['durationDays'] as number;
    const deviceLimit = values['deviceLimit'] as number;
    const productName = requiredStoreString(values['productName']);
    const productCode = requiredStoreString(values['productCode']);
    return {
      kind: 'review',
      step: 'confirm',
      delta: {
        kind: 'changeset',
        changes: [
          {
            kind: 'category',
            code: requiredStoreString(values['categoryCode']),
            name: requiredStoreString(values['categoryName']),
            description: '',
            position: 0,
          },
          {
            kind: 'product',
            code: productCode,
            categoryCode: requiredStoreString(values['categoryCode']),
            name: productName,
            shortName: productName,
            description: '',
            badge: null,
            iconKey: 'globe',
            position: 0,
            active: true,
          },
          {
            kind: 'variant',
            code: requiredStoreString(values['variantCode']),
            productCode,
            name: displayVariantName(values['variantName'], {
              dataLimitBytes,
              durationDays,
              deviceLimit,
            }),
            description: (values['variantDescription'] as string | undefined) ?? '',
            durationDays,
            dataLimitBytes,
            deviceLimit,
            priceIrr: values['priceIrr'] as bigint,
            position: 0,
            sellable: true,
            providerCode: requiredStoreString(values['providerCode']),
            groupIds: values['groupIds'] as number[],
            ...(values['displayAttributes'] === undefined
              ? {}
              : { displayAttributes: values['displayAttributes'] as never }),
          },
        ],
      },
    };
  }
  private storePrompt(state: CatalogAdminWizardState): string {
    if (state.kind === 'category')
      return state.field === 'name'
        ? `نام دسته را بنویس. مقدار فعلی: ${escapeHtml(state.values.name ?? '—')}`
        : state.field === 'description'
          ? `توضیح کوتاه دسته را بنویس یا «-». مقدار فعلی: ${escapeHtml(state.values.description ?? '—')}`
          : `ترتیب نمایش را با رقم فارسی یا لاتین بنویس. مقدار فعلی: ${String(state.values.position ?? 0)}`;
    if (state.kind === 'product')
      return state.field === 'name'
        ? `نام محصول را بنویس. مقدار فعلی: ${escapeHtml(state.values.name ?? '—')}`
        : state.field === 'shortName'
          ? `نام کوتاه را بنویس. مقدار فعلی: ${escapeHtml(state.values.shortName ?? '—')}`
          : state.field === 'description'
            ? `توضیح محصول را بنویس یا «-». مقدار فعلی: ${escapeHtml(state.values.description ?? '—')}`
            : `نشان کوتاه را بنویس یا «-». مقدار فعلی: ${escapeHtml(state.values.badge ?? '—')}`;
    if (state.kind === 'settings') {
      const current =
        state.field === 'cardNumber' && state.values.cardNumber !== undefined
          ? maskCard(state.values.cardNumber)
          : (state.values[state.field] ?? '—');
      return `مقدار «${persianSettingsField(state.field)}» را وارد کن. مقدار فعلی: ${escapeHtml(current)}`;
    }
    if (state.kind === 'variant' && state.field === 'name')
      return 'نام نمایشی پلن را بنویس یا «-» تا نام استاندارد مشخصات استفاده شود.';
    if (state.kind === 'variant' && state.field === 'description')
      return 'توضیح کوتاه پلن را بنویس یا «-».';
    if (state.kind === 'variant' && state.field === 'displayAttributes')
      return 'حداکثر ۴ ویژگی را هر خط به شکل «برچسب: مقدار» بنویس؛ برای پاک‌کردن همه «-».';
    if (state.kind === 'variant')
      return `برای پلن سفارشی: حجم گیگ، روز، دستگاه، قیمت تومان را با ویرگول وارد کن.${
        state.values.dataLimitBytes === undefined
          ? ''
          : ` مقدار فعلی: ${variantAdminLabel({ dataLimitBytes: state.values.dataLimitBytes, durationDays: state.values.durationDays ?? 0, deviceLimit: state.values.deviceLimit ?? 0 })} · ${String((state.values.priceIrr ?? 0n) / 10n)} تومان`
      }`;
    if (state.kind === 'changeset') {
      if (state.field === 'categoryName') return 'نام دستهٔ جدید را بنویس.';
      if (state.field === 'productName') return 'نام محصول را بنویس.';
      if (state.field === 'variantSpec')
        return 'مشخصات اولین پلن را به شکل «حجم گیگ، روز، دستگاه، قیمت تومان» بنویس.';
      if (state.field === 'variantName') return 'نام نمایشی اولین پلن را بنویس یا «-».';
      if (state.field === 'variantDescription') return 'توضیح کوتاه اولین پلن را بنویس یا «-».';
      if (state.field === 'displayAttributes')
        return 'حداکثر ۴ ویژگی را هر خط به شکل «برچسب: مقدار» بنویس؛ برای پاک‌کردن همه «-».';
      return 'گروه سرویس را انتخاب کن.';
    }
    return 'هدف را انتخاب کن.';
  }
  private async storeReviewText(
    state: Extract<CatalogAdminWizardState, { readonly kind: 'review' }>,
  ): Promise<string> {
    const delta = state.delta;
    const model = await this.catalogChat.getReadModel();
    const differences = reviewDifferences(delta, model);
    const summary =
      delta.kind === 'settings'
        ? `تنظیمات فروشگاه · کارت ${maskCard(delta.settings.cardNumber)}`
        : delta.kind === 'category'
          ? `دسته‌بندی · ${delta.name}`
          : delta.kind === 'product'
            ? `محصول · ${delta.name}`
            : delta.kind === 'variant'
              ? `پلن · ${variantAdminLabel(delta)}`
              : delta.kind === 'reorder'
                ? `ترتیب ${delta.entity === 'category' ? 'دسته' : delta.entity === 'product' ? 'محصول' : 'پلن'} به سمت ${delta.direction === 'up' ? 'بالا' : 'پایین'}`
                : delta.kind === 'changeset'
                  ? `ساخت هم‌زمان دسته «${delta.changes[0].name}»، محصول «${delta.changes[1].name}» و پلن «${delta.changes[2].name}»`
                  : delta.kind === 'archive'
                    ? 'بایگانی مورد انتخاب‌شده'
                    : 'بازگردانی مورد انتخاب‌شده';
    const customerCopy =
      delta.kind === 'variant'
        ? `\n<b>نمای مشتری</b>\n${productPlansText({
            productName: 'محصول انتخاب‌شده',
            planCount: 1,
            page: 0,
            pageCount: 1,
            variants: [
              {
                id: 'preview',
                code: delta.code,
                productName: 'محصول انتخاب‌شده',
                name: delta.name,
                description: delta.description,
                durationDays: delta.durationDays,
                dataLimitBytes: delta.dataLimitBytes,
                deviceLimit: delta.deviceLimit,
                priceIrr: delta.priceIrr,
                ...(delta.displayAttributes === undefined
                  ? {}
                  : { displayAttributes: delta.displayAttributes }),
              },
            ],
          })}`
        : delta.kind === 'product'
          ? `\n<b>نمای مشتری</b>\n<b>${escapeWithin(delta.name, 250)}</b>\n${escapeWithin(delta.description, 400)}`
          : delta.kind === 'category'
            ? `\n<b>نمای مشتری</b>\n<b>${escapeWithin(delta.name, 250)}</b>\n${escapeWithin(delta.description, 400)}`
            : '';
    return [
      '<b>پیش‌نمایش تغییر</b>',
      escapeHtml(summary),
      ...(differences.length === 0
        ? []
        : ['<b>تغییرات</b>', ...differences.slice(0, 7).map((item) => escapeWithin(item, 200))]),
      customerCopy,
      'برای اعمال، انتشار نهایی را بزن.',
    ].join('\n');
  }
  private async showStorePreview(target: MenuTarget, requestedPage: number): Promise<void> {
    const [model, catalog] = await Promise.all([
      this.catalogChat.getReadModel(),
      this.catalogAdmin.getPublicCatalog(),
    ]);
    const pages = Math.max(1, Math.ceil(model.products.length / 8));
    const page = Math.max(0, Math.min(requestedPage, pages - 1));
    const categories = new Map(model.categories.map((category) => [category.id, category.name]));
    const products = model.products.slice(page * 8, page * 8 + 8).map((product) => {
      const variants = model.variants.filter((variant) => variant.productId === product.id);
      return `${escapeHtml(categories.get(product.categoryId) ?? 'دسته‌بندی')} · ${escapeHtml(product.name)} · ${String(variants.length)} پلن`;
    });
    await this.present(
      target,
      [
        '<b>نمای فروشگاه</b>',
        `کارت فروش: ${maskCard(catalog.settings.cardNumber)}`,
        ...products,
      ].join('\n'),
      columnKeyboard([
        { text: '◀', callback_data: `store:preview:${String(Math.max(0, page - 1))}` },
        { text: `${String(page + 1)}/${String(pages)}`, callback_data: ADMIN_STORE_CALLBACK },
        { text: '▶', callback_data: `store:preview:${String(Math.min(pages - 1, page + 1))}` },
        { text: 'مدیریت فروشگاه', callback_data: ADMIN_STORE_CALLBACK },
      ]),
    );
  }
  private async showStoreList(
    target: MenuTarget,
    kind: 'c' | 'p' | 'v' | 'a',
    page: number,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    const rows =
      kind === 'c'
        ? model.categories
        : kind === 'p'
          ? model.products
          : kind === 'v'
            ? model.variants
            : [...model.categories, ...model.products, ...model.variants];
    const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(rows.length / 8) - 1)));
    const chunk = rows.slice(safePage * 8, safePage * 8 + 8);
    const buttons = chunk.map((row) => {
      const id = row.id;
      const label =
        'sellable' in row
          ? `${row.name} ${row.active && row.sellable ? '●' : '○'}`
          : `${row.name} ${row.active ? '●' : '○'}`;
      return {
        text: buttonLabel(label),
        callback_data:
          kind === 'a'
            ? `store:detail:${'categoryId' in row ? 'p' : 'productId' in row ? 'v' : 'c'}:${id}`
            : `store:detail:${kind}:${id}`,
      };
    });
    const nav = [
      { text: '◀', callback_data: `store:list:${kind}:${String(Math.max(0, safePage - 1))}` },
      {
        text: `${String(safePage + 1)}/${String(Math.max(1, Math.ceil(rows.length / 8)))}`,
        callback_data: `store:list:${kind}:${String(safePage)}`,
      },
      {
        text: '▶',
        callback_data: `store:list:${kind}:${String(Math.min(Math.max(0, Math.ceil(rows.length / 8) - 1), safePage + 1))}`,
      },
    ];
    await this.present(
      target,
      `${kind === 'c' ? 'دسته‌ها' : kind === 'p' ? 'محصولات' : kind === 'v' ? 'پلن‌ها' : 'بایگانی و بازگردانی'} — صفحه ${String(safePage + 1)}`,
      columnKeyboard([
        ...buttons,
        ...nav,
        { text: 'مدیریت فروشگاه', callback_data: ADMIN_STORE_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async showStoreDetail(
    target: MenuTarget,
    kind: 'c' | 'p' | 'v',
    id: string,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    const row =
      kind === 'c'
        ? model.categories.find((item) => item.id === id)
        : kind === 'p'
          ? model.products.find((item) => item.id === id)
          : model.variants.find((item) => item.id === id);
    if (row === undefined) throw new DomainConflictError('CATALOG_ENTITY_NOT_FOUND');
    const active = 'sellable' in row ? row.active && row.sellable : row.active;
    const action = active ? 'archive' : 'restore';
    const children =
      kind === 'c'
        ? model.products.filter((item) => item.categoryId === row.id).length
        : kind === 'p'
          ? model.variants.filter((item) => item.productId === row.id).length
          : 0;
    const text = `<b>${escapeHtml(row.name)}</b>\nوضعیت: ${active ? 'فعال' : 'بایگانی'}${kind === 'c' ? `\nمحصول‌های زیرمجموعه: ${String(children)}` : kind === 'p' ? `\nپلن‌های زیرمجموعه: ${String(children)}` : ''}`;
    const variantNeedsSaleEnable = kind === 'v' && 'sellable' in row && row.active && !row.sellable;
    await this.present(
      target,
      text,
      columnKeyboard([
        ...(variantNeedsSaleEnable
          ? [{ text: 'فعال‌سازی فروش', callback_data: `store:enable:v:${row.id}` }]
          : [
              {
                text: action === 'archive' ? 'بایگانی' : 'بازگردانی',
                callback_data: `store:action:${action}:${kind}:${row.id}`,
              },
            ]),
        { text: 'ویرایش', callback_data: `store:edit:${kind}:${row.id}` },
        { text: 'پیش‌نمایش مشتری', callback_data: `store:customer:${kind}:${row.id}` },
        { text: 'جابجایی به بالا', callback_data: `store:move:${kind}:${row.id}:up` },
        { text: 'جابجایی به پایین', callback_data: `store:move:${kind}:${row.id}:down` },
        { text: 'بازگشت', callback_data: `store:list:${kind}:0` },
      ]),
    );
  }

  private async showStoreCustomerPreview(
    target: MenuTarget,
    kind: 'c' | 'p' | 'v',
    id: string,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    if (kind === 'c') {
      const category = model.categories.find((item) => item.id === id);
      if (category === undefined) throw new DomainConflictError('CATEGORY_NOT_FOUND');
      const products = model.products.filter((item) => item.categoryId === id);
      await this.present(
        target,
        `<b>${escapeHtml(category.name)}</b>\n${escapeHtml(category.description)}\n${String(products.length)} محصول برای نمایش مشتری آماده است.`,
        columnKeyboard([{ text: 'بازگشت', callback_data: `store:detail:c:${id}` }]),
      );
      return;
    }
    if (kind === 'p') {
      const product = model.products.find((item) => item.id === id);
      if (product === undefined) throw new DomainConflictError('PRODUCT_NOT_FOUND');
      const variants = model.variants
        .filter((item) => item.productId === id && item.active && item.sellable)
        .slice(0, 3)
        .map((item) => toCustomerPreviewVariant(item, product.name));
      await this.present(
        target,
        productPlansText({
          productName: product.name,
          planCount: variants.length,
          page: 0,
          pageCount: 1,
          variants,
        }),
        columnKeyboard([{ text: 'بازگشت', callback_data: `store:detail:p:${id}` }]),
      );
      return;
    }
    const variant = model.variants.find((item) => item.id === id);
    if (variant === undefined) throw new DomainConflictError('VARIANT_NOT_FOUND');
    const productName =
      model.products.find((item) => item.id === variant.productId)?.name ?? 'محصول';
    await this.present(
      target,
      variantText(toCustomerPreviewVariant(variant, productName)),
      columnKeyboard([{ text: 'بازگشت', callback_data: `store:detail:v:${id}` }]),
    );
  }

  private async startStoreReviewForEntity(
    target: MenuTarget,
    adminId: string,
    action: 'archive' | 'restore',
    kind: 'c' | 'p' | 'v',
    id: string,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    const row =
      kind === 'c'
        ? model.categories.find((item) => item.id === id)
        : kind === 'p'
          ? model.products.find((item) => item.id === id)
          : model.variants.find((item) => item.id === id);
    if (row === undefined) throw new DomainConflictError('CATALOG_ENTITY_NOT_FOUND');
    await this.startStoreSession(target, adminId, {
      kind: 'review',
      step: 'confirm',
      delta: {
        kind: action,
        entity: kind === 'c' ? 'category' : kind === 'p' ? 'product' : 'variant',
        code: row.code,
      },
    });
  }

  private async startStoreReorder(
    target: MenuTarget,
    adminId: string,
    kind: 'c' | 'p' | 'v',
    id: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    const row =
      kind === 'c'
        ? model.categories.find((item) => item.id === id)
        : kind === 'p'
          ? model.products.find((item) => item.id === id)
          : model.variants.find((item) => item.id === id);
    if (row === undefined) throw new DomainConflictError('CATALOG_ENTITY_NOT_FOUND');
    await this.startStoreSession(target, adminId, {
      kind: 'review',
      step: 'confirm',
      delta: {
        kind: 'reorder',
        entity: kind === 'c' ? 'category' : kind === 'p' ? 'product' : 'variant',
        code: row.code,
        direction,
      },
    });
  }

  private async showStoreDraftFields(
    target: MenuTarget,
    state: Extract<CatalogAdminWizardState, { readonly kind: 'category' | 'product' | 'variant' }>,
  ): Promise<void> {
    const kind = state.kind === 'category' ? 'c' : state.kind === 'product' ? 'p' : 'v';
    const fields: readonly (readonly [string, string])[] =
      kind === 'c'
        ? [
            ['نام', 'name'],
            ['توضیح', 'description'],
            ['ترتیب', 'position'],
          ]
        : kind === 'p'
          ? [
              ['نام', 'name'],
              ['نام کوتاه', 'shortName'],
              ['توضیح', 'description'],
              ['نشان', 'badge'],
            ]
          : [
              ['نام', 'name'],
              ['توضیح', 'description'],
              ['مشخصات و قیمت', 'durationDays'],
              ['گروه سرویس', 'groupIds'],
              ['ویژگی‌های نمایشی', 'displayAttributes'],
            ];
    await this.present(
      target,
      '<b>ویرایش انتخابی</b>\nفیلدها را هر تعداد که خواستی تغییر بده؛ بعد پیش‌نمایش را بزن.',
      columnKeyboard([
        ...fields.map(([label, field]) => ({
          text: label,
          callback_data: `store:field:${kind}:${field}`,
        })),
        { text: 'پیش‌نمایش تغییرات', callback_data: 'store:draft:review' },
        { text: 'لغو', callback_data: 'store:cancel' },
      ]),
    );
  }

  private async selectStoreDraftField(
    target: MenuTarget,
    adminId: string,
    kind: 'c' | 'p' | 'v',
    field: string,
  ): Promise<void> {
    const stateKind = kind === 'c' ? 'category' : kind === 'p' ? 'product' : 'variant';
    await this.advanceStoreSession(target, adminId, (session) => {
      if (session.state.kind !== stateKind || session.state.mode !== 'edit')
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
      return { ...session.state, field: field as never };
    });
  }

  private async returnToStoreDraftFields(
    target: MenuTarget,
    adminId: string,
    kind: 'category' | 'product' | 'variant',
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.advanceStoreSession(target, adminId, (session) => {
      if (session.state.kind !== kind || session.state.mode !== 'edit')
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
      return { ...session.state, field: 'select', values };
    });
  }

  private async reviewStoreDraft(target: MenuTarget, adminId: string): Promise<void> {
    await this.advanceStoreSession(target, adminId, (session) => {
      const values = storeValues(session.state);
      if (session.state.kind === 'category' && session.state.mode === 'edit')
        return {
          kind: 'review',
          step: 'confirm',
          delta: {
            kind: 'category',
            code: requiredStoreString(values['code']),
            name: requiredStoreString(values['name']),
            description: (values['description'] as string | undefined) ?? '',
            position: (values['position'] as number | undefined) ?? 0,
          },
        };
      if (session.state.kind === 'product' && session.state.mode === 'edit')
        return {
          kind: 'review',
          step: 'confirm',
          delta: {
            kind: 'product',
            code: requiredStoreString(values['code']),
            categoryCode: requiredStoreString(values['categoryCode']),
            name: requiredStoreString(values['name']),
            shortName:
              (values['shortName'] as string | undefined) ?? requiredStoreString(values['name']),
            description: (values['description'] as string | undefined) ?? '',
            badge: (values['badge'] as string | null | undefined) ?? null,
            iconKey:
              (values['iconKey'] as 'loop' | 'globe' | 'star' | 'bolt' | undefined) ?? 'globe',
            position: (values['position'] as number | undefined) ?? 0,
            active: (values['active'] as boolean | undefined) ?? true,
          },
        };
      if (session.state.kind === 'variant' && session.state.mode === 'edit')
        return this.reviewVariant(values);
      throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
    });
  }

  private async startStoreEdit(
    target: MenuTarget,
    adminId: string,
    kind: 'c' | 'p' | 'v',
    id: string,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    if (kind === 'c') {
      const row = model.categories.find((item) => item.id === id);
      if (row === undefined) throw new DomainConflictError('CATEGORY_NOT_FOUND');
      await this.startStoreSession(target, adminId, {
        kind: 'category',
        step: 'category-fields',
        field: 'select',
        mode: 'edit',
        values: {
          code: row.code,
          name: row.name,
          description: row.description,
          position: row.position,
        },
      });
      return;
    }
    if (kind === 'p') {
      const row = model.products.find((item) => item.id === id);
      if (row === undefined) throw new DomainConflictError('PRODUCT_NOT_FOUND');
      await this.startStoreSession(target, adminId, {
        kind: 'product',
        step: 'product-fields',
        field: 'select',
        mode: 'edit',
        values: {
          code: row.code,
          categoryCode: row.categoryCode,
          name: row.name,
          shortName: row.shortName,
          description: row.description,
          badge: row.badge,
          iconKey: row.iconKey,
          position: row.position,
          active: row.active,
        },
      });
      return;
    }
    const row = model.variants.find((item) => item.id === id);
    if (row === undefined) throw new DomainConflictError('VARIANT_NOT_FOUND');
    await this.startStoreSession(target, adminId, {
      kind: 'variant',
      step: 'variant-fields',
      field: 'select',
      mode: 'edit',
      values: {
        code: row.code,
        productCode: row.productCode,
        name: row.name,
        description: row.description,
        dataLimitBytes: row.dataLimitBytes,
        durationDays: row.durationDays,
        deviceLimit: row.deviceLimit,
        priceIrr: row.priceIrr,
        position: row.position,
        sellable: row.sellable,
        ...(row.providerCode === null ? {} : { providerCode: row.providerCode }),
        groupIds: row.groupIds,
        displayAttributes: row.displayAttributes,
      },
    });
  }

  private async startStoreEnableVariant(
    target: MenuTarget,
    adminId: string,
    id: string,
  ): Promise<void> {
    const row = (await this.catalogChat.getReadModel()).variants.find((item) => item.id === id);
    if (row === undefined || !row.active || row.providerCode === null || row.groupIds.length === 0)
      throw new DomainConflictError('VARIANT_NOT_RESTORABLE');
    await this.startStoreSession(target, adminId, {
      kind: 'review',
      step: 'confirm',
      delta: {
        kind: 'variant',
        code: row.code,
        productCode: row.productCode,
        name: row.name,
        description: row.description,
        durationDays: row.durationDays,
        dataLimitBytes: row.dataLimitBytes,
        deviceLimit: row.deviceLimit,
        priceIrr: row.priceIrr,
        position: row.position,
        sellable: true,
        providerCode: row.providerCode,
        groupIds: row.groupIds,
      },
    });
  }

  private async showPicker(
    target: MenuTarget,
    kind: 'category' | 'product',
    page: number,
  ): Promise<void> {
    const model = await this.catalogChat.getReadModel();
    const rows = kind === 'category' ? model.categories : model.products;
    const pages = Math.max(1, Math.ceil(rows.length / 8));
    const safe = Math.max(0, Math.min(page, pages - 1));
    await this.present(
      target,
      kind === 'category' ? 'دستهٔ محصول را انتخاب کن.' : 'محصول پلن را انتخاب کن.',
      columnKeyboard([
        ...rows.slice(safe * 8, safe * 8 + 8).map((row) => ({
          text: buttonLabel(row.name),
          callback_data: `store:pick:${kind}:${row.id}:${String(safe)}`,
        })),
        { text: '◀', callback_data: `store:picker:${kind}:${String(Math.max(0, safe - 1))}` },
        {
          text: `${String(safe + 1)}/${String(pages)}`,
          callback_data: `store:picker:${kind}:${String(safe)}`,
        },
        {
          text: '▶',
          callback_data: `store:picker:${kind}:${String(Math.min(pages - 1, safe + 1))}`,
        },
        { text: 'لغو', callback_data: 'store:cancel' },
        backToMenuButton(),
      ]),
    );
  }

  private async showProviderHealth(target: MenuTarget, page: number): Promise<void> {
    const groups = (await this.catalogAdmin.listProviderGroups()).filter(
      (item) => item.available && !item.disabled,
    );
    const pages = Math.max(1, Math.ceil(groups.length / 8));
    const safe = Math.max(0, Math.min(page, pages - 1));
    await this.present(
      target,
      `<b>سلامت گروه‌های سرویس</b>\nگروه‌های فعال: ${String(groups.length)}`,
      columnKeyboard([
        ...groups
          .slice(safe * 8, safe * 8 + 8)
          .map((group) => ({ text: buttonLabel(group.name), callback_data: 'store:groups:0' })),
        { text: '◀', callback_data: `store:groups:${String(Math.max(0, safe - 1))}` },
        { text: `${String(safe + 1)}/${String(pages)}`, callback_data: ADMIN_STORE_CALLBACK },
        { text: '▶', callback_data: `store:groups:${String(Math.min(pages - 1, safe + 1))}` },
        { text: 'مدیریت فروشگاه', callback_data: ADMIN_STORE_CALLBACK },
      ]),
    );
  }

  private async showFailedProvisioning(target: MenuTarget): Promise<void> {
    const orders = await this.repository.listFailedProvisioning(10);
    await this.present(target, adminFailedProvisioningText(orders), adminQueueKeyboard(orders));
  }

  private async showCatalogHealth(target: MenuTarget): Promise<void> {
    const [categories, catalog] = await Promise.all([
      this.commerce.listCategories(null),
      this.catalogAdmin.getPublicCatalog(),
    ]);
    const cardPublished =
      /^\d{16}$/u.test(catalog.settings.cardNumber) &&
      catalog.settings.cardHolder.trim().length >= 2;
    await this.present(
      target,
      adminCatalogHealthText({
        categoryCount: categories.length,
        cardPublished,
      }),
      adminScreenKeyboard(),
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
    const deliveryJob = this.delivery === null ? null : await this.delivery.getJobForOrder(orderId);
    const buttons: { text: string; callback_data?: string; url?: string }[] = [
      { text: 'تأیید و ساخت سرویس ✅', callback_data: `approve:${order.id}` },
      { text: 'رد رسید ❌', callback_data: `reject:${order.id}` },
      { text: 'مشاهده رسید 🧾', callback_data: `admin:proof:${order.id}` },
    ];
    if (deliveryJob !== null && deliveryJob.stage !== 'delivered') {
      buttons.push({ text: 'ارسال دوباره لینک 📩', callback_data: `admin:redeliver:${order.id}` });
    }
    buttons.push(
      { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
      backToMenuButton(),
    );
    await this.present(target, adminOrderText(order), pairedKeyboard(buttons));
  }

  private async publishAdminDailySummary(target: MenuTarget): Promise<void> {
    const created = await this.publishDailySummary();
    await this.dispatchDueReports();
    await this.present(target, dailySummaryQueuedText(created), adminScreenKeyboard());
  }

  private async deliveryCounts(): Promise<{
    readonly pending: number;
    readonly failed: number;
    readonly delivered: number;
  }> {
    if (this.reporting === null) {
      return { pending: 0, failed: 0, delivered: 0 };
    }
    return this.reporting.countDeliveries();
  }

  private async completeApproval(
    orderId: string,
    actorId: string,
    adminChatId: string,
  ): Promise<void> {
    try {
      await this.commerce.approveOrder(orderId, actorId);
    } catch (error: unknown) {
      const current = await this.repository.getOrder(orderId);
      if (current?.status === 'fulfilled') {
        await this.dispatchDueDeliveries();
        throw error;
      }
      // Only a genuine provisioning failure reaches this branch; delivery failures
      // stay inside the durable delivery job and never mislabel the order.
      await this.notifyProvisioningDelay(orderId);
      await this.messenger.sendMessage(
        adminChatId,
        'ساخت سرویس الان تمام نشد. از صف سفارش‌های باز دوباره تلاش کن.',
      );
      return;
    }
    await this.messenger.sendMessage(adminChatId, 'سفارش تکمیل شد.');
    await this.dispatchDueDeliveries();
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
        receiptRejectedText(),
        columnKeyboard([
          { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
          backToMenuButton(),
        ]),
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
      await this.commerce.retryProvisioning(orderId, actorId);
    } catch (error: unknown) {
      const current = await this.repository.getOrder(orderId);
      if (current?.status === 'fulfilled') {
        await this.dispatchDueDeliveries();
        throw error;
      }
      // Provisioning retry and delivery retry are distinct operations; only the
      // provisioning attempt can land here.
      await this.notifyProvisioningDelay(orderId);
      await this.messenger.sendMessage(
        adminChatId,
        'ساخت سرویس الان تمام نشد. از صف سفارش‌های باز دوباره تلاش کن.',
      );
      return;
    }
    await this.messenger.sendMessage(adminChatId, 'ساخت سرویس تکرار شد.');
    await this.dispatchDueDeliveries();
  }

  private async completeProofRetrieval(target: MenuTarget, orderId: string): Promise<void> {
    const proof = await this.commerce.getPaymentProof(orderId);
    if (proof === null) {
      await this.present(
        target,
        'برای این سفارش رسیدی ثبت نشده است.',
        columnKeyboard([backToMenuButton()]),
      );
      return;
    }
    const caption = `رسید سفارش ${escapeHtml(orderId)}`;
    // The stored file ID never enters callback data, reports or logs; it is only
    // passed to the Telegram send call.
    if (proof.mediaKind === 'document') {
      await this.messenger.sendDocument(
        target.chatId,
        proof.telegramFileId,
        caption,
        columnKeyboard([backToMenuButton()]),
        { parseMode: 'HTML' },
      );
      return;
    }
    try {
      await this.messenger.sendPhoto(
        target.chatId,
        proof.telegramFileId,
        caption,
        columnKeyboard([backToMenuButton()]),
        { parseMode: 'HTML' },
      );
    } catch (error: unknown) {
      if (proof.mediaKind === null) {
        // Legacy proofs without a persisted kind fall back to document delivery.
        await this.messenger.sendDocument(
          target.chatId,
          proof.telegramFileId,
          caption,
          columnKeyboard([backToMenuButton()]),
          { parseMode: 'HTML' },
        );
        return;
      }
      throw error;
    }
  }

  private async completeDeliveryRetry(
    target: MenuTarget,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    if (!this.isAdmin(actorId)) {
      throw new DomainConflictError('ADMIN_REQUIRED');
    }
    if (this.delivery === null) {
      throw new DomainConflictError('DELIVERY_UNAVAILABLE');
    }
    const job = await this.delivery.resetForOrder(orderId);
    await this.present(
      target,
      `ارسال دوباره در صف قرار گرفت.\nوضعیت: ${deliveryStageLabel(job.stage)}`,
      columnKeyboard([
        { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
        backToMenuButton(),
      ]),
    );
    await this.dispatchDueDeliveries();
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

  private async readCheckoutCard(): Promise<{
    readonly cardNumber: string;
    readonly cardHolder: string;
  }> {
    const catalog = await this.catalogAdmin.getPublicCatalog();
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

  private async sendBrandPhoto(
    chatId: string,
    fileId: string | null,
    caption: string,
  ): Promise<void> {
    if (fileId === null) {
      return;
    }
    try {
      await this.messenger.sendPhoto(chatId, fileId, caption, undefined, { parseMode: 'HTML' });
    } catch {
      // Optional welcome media must never block the home screen.
    }
  }

  private async ensureChannelGate(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    next: 'shop' | 'trial',
  ): Promise<boolean> {
    const decision = await this.commercial.evaluateChannelGate({
      telegramUserId: customer.telegramUserId,
      isAdmin: this.isAdmin(customer.telegramUserId),
    });
    if (decision.allowed) {
      return true;
    }
    const joinButtons = decision.channels.flatMap((channel) => {
      const url = joinUrlForChannel(channel);
      return url === null ? [] : [{ text: `عضویت در ${channel.username ?? 'کانال'}`, url }];
    });
    await this.present(
      target,
      forcedJoinText(decision.reason === 'unavailable' ? 'unavailable' : 'missing'),
      columnKeyboard([
        ...joinButtons,
        {
          text: 'بررسی مجدد',
          callback_data: next === 'trial' ? TRIAL_CALLBACK : JOIN_REFRESH_CALLBACK,
        },
        backToMenuButton(),
      ]),
    );
    return false;
  }

  private async showTrial(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    if (!(await this.ensureChannelGate(target, customer, 'trial'))) {
      return;
    }
    const recorded = await this.commerce.recordCustomerActivity(customer);
    if (recorded.customer.shopBlocked === true) {
      await this.present(target, shopBlockedText(), columnKeyboard([backToMenuButton()]));
      return;
    }
    if (!(await this.commercial.isTrialEligible(recorded.customer.id))) {
      const settings = await this.commercial.getSettings();
      await this.present(
        target,
        settings.trialEnabled ? trialAlreadyClaimedText() : trialUnavailableText(),
        columnKeyboard([backToMenuButton()]),
      );
      return;
    }
    const settings = await this.commercial.getSettings();
    if (settings.trialVariantId === null) {
      await this.present(target, trialUnavailableText(), columnKeyboard([backToMenuButton()]));
      return;
    }
    try {
      const variant = await this.commerce.getVariant(settings.trialVariantId);
      await this.present(
        target,
        trialOfferText({
          durationDays: variant.durationDays,
          dataLimitBytes: variant.dataLimitBytes,
          deviceLimit: variant.deviceLimit,
        }),
        columnKeyboard([
          { text: 'فعال‌سازی سرویس تست', callback_data: 'trial:claim' },
          backToMenuButton(),
        ]),
      );
    } catch {
      await this.present(
        target,
        [
          '<b>سرویس تست</b>',
          'یک‌بار برای هر مشتری، بدون پرداخت کارت‌به‌کارت.',
          'مدت و حجم از پلن تست تنظیم‌شده در فروشگاه می‌آید.',
        ].join('\n'),
        columnKeyboard([
          { text: 'فعال‌سازی سرویس تست', callback_data: 'trial:claim' },
          backToMenuButton(),
        ]),
      );
    }
  }

  private async claimTrial(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    if (!(await this.ensureChannelGate(target, customer, 'trial'))) {
      return;
    }
    try {
      const order = await this.commerce.beginTrial({
        customer,
        idempotencyKey: `trial:${customer.telegramUserId}`,
      });
      if (order.status === 'fulfilled') {
        await this.present(
          target,
          'سرویس تست آماده است. لینک دسترسی از «سرویس‌های من» قابل دریافت است.',
          columnKeyboard([
            { text: MENU_LABEL.services, callback_data: SERVICES_CALLBACK },
            backToMenuButton(),
          ]),
        );
        return;
      }
      await this.present(target, provisioningDelayedText(), columnKeyboard([backToMenuButton()]));
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code === 'TRIAL_ALREADY_CLAIMED') {
        await this.present(target, trialAlreadyClaimedText(), columnKeyboard([backToMenuButton()]));
        return;
      }
      if (error instanceof DomainConflictError && error.code === 'SHOP_BLOCKED') {
        await this.present(target, shopBlockedText(), columnKeyboard([backToMenuButton()]));
        return;
      }
      if (error instanceof DomainConflictError && error.code === 'TRIAL_NOT_CONFIGURED') {
        await this.present(target, trialUnavailableText(), columnKeyboard([backToMenuButton()]));
        return;
      }
      if (error instanceof DomainConflictError && error.code === 'PROVISIONING_DISABLED') {
        await this.present(
          target,
          'سرویس تست ثبت شد ولی ساخت زنده فعلاً خاموش است. بعد از روشن شدن پایلوت، از صف ساخت ناموفق پیگیری می‌شود.',
          columnKeyboard([backToMenuButton()]),
        );
        return;
      }
      throw error;
    }
  }

  private async showCustomerServices(
    target: MenuTarget,
    customer: TelegramCustomerInput,
  ): Promise<void> {
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const services = await this.commercial.listCustomerServices(recorded.customer.id);
    await this.present(
      target,
      customerServicesText(services),
      columnKeyboard([
        ...services.map((service) => ({
          text: buttonLabel(`${service.productName} — ${service.variantName}`),
          callback_data: `svc:${service.id}`,
        })),
        backToMenuButton(),
      ]),
    );
  }

  private async showCustomerService(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    serviceId: string,
  ): Promise<void> {
    await this.present(
      target,
      'لینک را دوباره بفرست، راهنمای اتصال را ببین، یا QR خصوصی بگیر. لینک در گزارش ادمین نیست.',
      columnKeyboard([
        { text: 'ارسال دوباره لینک', callback_data: `svc:link:${serviceId}` },
        { text: 'QR خصوصی', callback_data: `svc:qr:${serviceId}` },
        { text: 'راهنمای آیفون', callback_data: `svc:guide:ios:${serviceId}` },
        { text: 'راهنمای اندروید', callback_data: `svc:guide:android:${serviceId}` },
        { text: 'راهنمای ویندوز', callback_data: `svc:guide:windows:${serviceId}` },
        { text: MENU_LABEL.services, callback_data: SERVICES_CALLBACK },
        backToMenuButton(),
      ]),
    );
  }

  private async resendServiceLink(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    serviceId: string,
  ): Promise<void> {
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const access = await this.commercial.requireServiceAccess(serviceId, recorded.customer.id);
    await this.messenger.sendMessage(
      access.chatId,
      serviceAccessText(access.subscriptionUrl),
      undefined,
      {
        parseMode: 'HTML',
      },
    );
    await this.present(
      target,
      'لینک دسترسی در پیام جداگانه ارسال شد.',
      columnKeyboard([backToMenuButton()]),
    );
  }

  private async sendServiceQr(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    serviceId: string,
  ): Promise<void> {
    const recorded = await this.commerce.recordCustomerActivity(customer);
    const access = await this.commercial.requireServiceAccess(serviceId, recorded.customer.id);
    if (this.messenger.sendPhotoBuffer === undefined) {
      await this.resendServiceLink(target, customer, serviceId);
      return;
    }
    const png = renderSubscriptionQrPng(access.subscriptionUrl);
    await this.messenger.sendPhotoBuffer(access.chatId, png, 'QR خصوصی سرویس. برای دیگران نفرست.');
    await this.present(
      target,
      'QR در پیام جداگانه ارسال شد.',
      columnKeyboard([backToMenuButton()]),
    );
  }

  private async showCommercialSettings(target: MenuTarget): Promise<void> {
    const settings = await this.commercial.getSettings();
    await this.present(
      target,
      commercialSettingsText({
        trialEnabled: settings.trialEnabled,
        trialVariantId: settings.trialVariantId,
        channelCount: settings.forcedJoinChannels.length,
        remindersEnabled: settings.remindersEnabled,
        expiryReminderDays: settings.expiryReminderDays,
        lowTrafficPercent: settings.lowTrafficPercent,
        referralEnabled: settings.referralEnabled,
        referralReferrerCreditIrr: settings.referralReferrerCreditIrr,
        referralInviteeDiscountIrr: settings.referralInviteeDiscountIrr,
        referralMaxRewardsPerReferrer: settings.referralMaxRewardsPerReferrer,
      }),
      adminScreenKeyboard([
        {
          text: settings.trialEnabled ? 'خاموش کردن تست' : 'روشن کردن تست',
          callback_data: 'ops:trial',
        },
        { text: 'تعیین پلن تست', callback_data: 'ops:variant' },
        { text: 'افزودن کانال اجباری', callback_data: 'ops:channel' },
        { text: 'روز یادآوری انقضا', callback_data: 'ops:reminders' },
        {
          text: settings.referralEnabled ? 'خاموش کردن دعوت' : 'روشن کردن دعوت',
          callback_data: 'ops:referral',
        },
        { text: 'پاداش دعوت‌کننده', callback_data: 'ops:referralCredit' },
        { text: 'تخفیف دعوت‌شده', callback_data: 'ops:referralDiscount' },
        { text: 'سقف پاداش دعوت', callback_data: 'ops:referralCap' },
        { text: 'مسدود/آزاد کردن خرید', callback_data: 'ops:block' },
      ]),
    );
  }

  private async toggleTrial(target: MenuTarget): Promise<void> {
    const settings = await this.commercial.getSettings();
    await this.commercial.updateSettings({ trialEnabled: !settings.trialEnabled });
    await this.showCommercialSettings(target);
  }

  private async toggleReferral(target: MenuTarget): Promise<void> {
    const settings = await this.commercial.getSettings();
    await this.commercial.updateSettings({ referralEnabled: !settings.referralEnabled });
    await this.showCommercialSettings(target);
  }

  private async showInvite(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    const invite = this.referral.inviteFor(customer.telegramUserId, this.config.botUsername);
    await this.present(target, inviteText(invite), columnKeyboard([backToMenuButton()]));
  }

  private async showAdminSalesSnapshot(target: MenuTarget): Promise<void> {
    const snapshot = await this.commercial.salesSnapshot();
    await this.present(target, adminSalesSnapshotText(snapshot), adminScreenKeyboard());
  }

  private async startAdminOpsField(
    target: MenuTarget,
    customer: TelegramCustomerInput,
    field: AdminOpsField,
  ): Promise<void> {
    await AdminOpsFlowHandler.start(this.sessions, {
      telegramUserId: customer.telegramUserId,
      field,
      now: new Date(),
    });
    await this.present(
      target,
      this.adminOpsPrompt(field),
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private adminOpsPrompt(field: string | undefined): string {
    if (field === 'channel') {
      return 'آیدی عددی کانال یا یوزرنیم عمومی را بفرست. مثال: @NeoShop';
    }
    if (field === 'trialVariant') {
      return 'شناسه عددی پلن تست را بفرست.';
    }
    if (field === 'reminderDays') {
      return 'تعداد روز یادآوری انقضا را بین ۱ تا ۳۰ بفرست.';
    }
    if (field === 'referralCredit') {
      return 'مبلغ پاداش دعوت‌کننده را به ریال بفرست. صفر یعنی بدون اعتبار کیف پول.';
    }
    if (field === 'referralDiscount') {
      return 'مبلغ تخفیف اولین خرید دعوت‌شده را به ریال بفرست. صفر یعنی بدون تخفیف.';
    }
    if (field === 'referralCap') {
      return 'سقف پاداش هر دعوت‌کننده را بین ۱ تا ۵۰۰ بفرست.';
    }
    return 'شناسه تلگرام مشتری را با + برای مسدود یا - برای آزاد بفرست. مثال: +10001';
  }

  private async applyAdminOpsField(field: AdminOpsField, text: string): Promise<void> {
    if (field === 'channel') {
      await this.commercial.addForcedJoinChannel(text);
      return;
    }
    if (field === 'trialVariant') {
      await this.commercial.updateSettings({ trialVariantId: text.trim() });
      return;
    }
    if (field === 'reminderDays') {
      await this.commercial.updateSettings({ expiryReminderDays: Number(text.trim()) });
      return;
    }
    if (field === 'referralCredit') {
      await this.commercial.updateSettings({
        referralReferrerCreditIrr: parseNonNegativeIrr(text),
      });
      return;
    }
    if (field === 'referralDiscount') {
      await this.commercial.updateSettings({
        referralInviteeDiscountIrr: parseNonNegativeIrr(text),
      });
      return;
    }
    if (field === 'referralCap') {
      await this.commercial.updateSettings({
        referralMaxRewardsPerReferrer: Number(text.trim()),
      });
      return;
    }
    const trimmed = text.trim();
    const blocked = trimmed.startsWith('+');
    const telegramUserId = trimmed.replace(/^[+-]/u, '');
    await this.commercial.setCustomerShopBlocked(telegramUserId, blocked);
  }

  private async startBroadcast(target: MenuTarget, customer: TelegramCustomerInput): Promise<void> {
    await AdminBroadcastFlowHandler.start(this.sessions, {
      telegramUserId: customer.telegramUserId,
      now: new Date(),
    });
    await this.present(
      target,
      broadcastPromptText(),
      columnKeyboard([flowCancelButton(), backToMenuButton()]),
    );
  }

  private async cancelBroadcast(
    target: MenuTarget,
    adminTelegramUserId: string,
    jobId: string,
  ): Promise<void> {
    await this.commercial.cancelBroadcast(jobId, adminTelegramUserId);
    await this.present(target, 'پیام همگانی لغو شد.', adminScreenKeyboard());
  }

  private async ownerCreditRepresentative(command: {
    readonly code?: string;
    readonly telegramUserId?: number;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
  }): Promise<RepresentativeWalletLedgerEntry> {
    const entry = await this.repWallet.ownerCredit(command);
    await this.publish({
      type: 'reseller.wallet_credited',
      occurrenceKey: `reseller:wallet-credit:${command.idempotencyKey}`,
      payload: {
        representativeId: entry.representativeId,
        ledgerId: entry.id,
        amountIrr: command.amountIrr.toString(),
        replayed: String(entry.replayed),
      },
    });
    return entry;
  }

  private isAdmin(telegramUserId: string): boolean {
    return this.config.adminTelegramUserIds.has(telegramUserId);
  }

  private orderKeyboard(order: SalesOrder | null): TelegramInlineKeyboardMarkup {
    if (order === null) {
      return columnKeyboard([
        { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
        backToMenuButton(),
      ]);
    }
    if (order.status === 'awaiting_receipt' || order.status === 'rejected') {
      return columnKeyboard([
        { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
        { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
        backToMenuButton(),
      ]);
    }
    if (order.status === 'fulfilled' || order.status === 'cancelled') {
      return columnKeyboard([
        { text: MENU_LABEL.renew, callback_data: RENEW_CALLBACK },
        { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
        backToMenuButton(),
      ]);
    }
    return columnKeyboard([
      { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
      backToMenuButton(),
    ]);
  }

  private requireAdmin(telegramUserId: string): void {
    if (!this.isAdmin(telegramUserId)) {
      throw new DomainConflictError('ADMIN_ACCESS_DENIED');
    }
  }
}

function isFreshStartCommand(text: string | undefined): boolean {
  return parseTelegramStartCommand(text ?? '') !== null;
}

export function createTelegramDeliveryTransport(
  messenger: TelegramMessenger,
  brandPhotoFileId: string | null,
): CustomerDeliveryTransport {
  return {
    async sendBrandPhoto(chatId: string): Promise<boolean> {
      if (brandPhotoFileId === null) {
        return false;
      }
      await messenger.sendPhoto(chatId, brandPhotoFileId, brandDeliveryCaption(), undefined, {
        parseMode: 'HTML',
      });
      return true;
    },
    async sendAnchorMessage(chatId: string): Promise<{ readonly messageId: string }> {
      const sent = await messenger.sendMessage(chatId, deliveryAnchorText(), undefined, {
        parseMode: 'HTML',
      });
      return { messageId: sent.messageId };
    },
    async editMessageText(chatId: string, messageId: string, text: string): Promise<void> {
      await messenger.editMessageText(chatId, messageId, text);
    },
  };
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
      case 'INSUFFICIENT_REPRESENTATIVE_WALLET':
        return 'موجودی کیف پول نماینده کافی نیست.';
      case 'REPRESENTATIVE_NOT_FOUND':
        return 'نماینده پیدا نشد.';
      case 'ADMIN_ACCESS_DENIED':
        return 'اجازهٔ این عملیات را نداری.';
      case 'PRODUCT_VARIANT_NOT_SELLABLE':
        return 'این محصول دیگر قابل خرید نیست.';
      case 'INVALID_SERVICE_USERNAME_BASE':
        return 'نام کاربری نامعتبر است؛ فقط a-z و 0-9 و _ و -.';
      case 'SERVICE_USERNAME_EXHAUSTED':
        return 'نام کاربری آزاد پیدا نشد؛ نام دیگری بفرست.';
      default:
        return 'عملیات انجام نشد؛ دوباره تلاش کن.';
    }
  }
  return 'خطای موقت؛ دوباره تلاش کن.';
}

function normalizeNumericText(value: string): string {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return value
    .trim()
    .replace(/[۰-۹]/gu, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/gu, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[^\d-]/gu, '');
}

function maskCard(value: string): string {
  const digits = normalizeNumericText(value);
  return digits.length < 4 ? '••••' : `•••• •••• •••• ${digits.slice(-4)}`;
}

function persianSettingsField(field: string): string {
  return (
    {
      brandName: 'نام برند',
      heroTitle: 'تیتر فروشگاه',
      heroSubtitle: 'توضیح فروشگاه',
      deliveryNote: 'پیام تحویل',
      supportNote: 'متن پشتیبانی',
      volumeHelper: 'راهنمای حجم',
      cardNumber: 'شماره کارت',
      cardHolder: 'نام دارندهٔ کارت',
    }[field] ?? 'تنظیمات'
  );
}

function variantAdminLabel(input: {
  readonly dataLimitBytes: bigint;
  readonly durationDays: number;
  readonly deviceLimit: number;
}): string {
  const volume =
    input.dataLimitBytes === 0n ? 'نامحدود' : `${String(input.dataLimitBytes / 1024n ** 3n)} گیگ`;
  const devices = input.deviceLimit === 0 ? 'نامحدود' : `${String(input.deviceLimit)} اتصال`;
  return `${volume} · ${String(input.durationDays)} روزه · ${devices}`;
}

function displayVariantName(
  value: unknown,
  dimensions: {
    readonly dataLimitBytes: bigint;
    readonly durationDays: number;
    readonly deviceLimit: number;
  },
): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : variantAdminLabel(dimensions);
}

function generatedCatalogCode(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

function parsePersianInteger(value: string): number {
  const parsed = Number(normalizeNumericText(value));
  if (!Number.isInteger(parsed)) throw new DomainConflictError('INVALID_POSITION');
  return parsed;
}

function parseCustomVariant(value: string): Record<string, unknown> {
  const fields = value.split(/[،,]/u).map((field) => Number(normalizeNumericText(field)));
  if (fields.length !== 4 || fields.some((field) => !Number.isSafeInteger(field))) {
    throw new DomainConflictError('INVALID_CATALOG_TEXT');
  }
  const [gigabytes, durationDays, deviceLimit, toman] = fields;
  if (
    gigabytes === undefined ||
    durationDays === undefined ||
    deviceLimit === undefined ||
    toman === undefined
  ) {
    throw new DomainConflictError('INVALID_CATALOG_TEXT');
  }
  return {
    dataLimitBytes: BigInt(gigabytes) * 1024n ** 3n,
    durationDays,
    deviceLimit,
    priceIrr: BigInt(toman) * 10n,
  };
}

function parseDisplayAttributes(value: string): readonly {
  position: number;
  label: string;
  value: string;
}[] {
  const text = value.trim();
  if (text === '-' || text.length === 0) return [];
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > 4) throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
  return lines.map((line, position) => {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
    const label = line.slice(0, separator).trim();
    const attributeValue = line.slice(separator + 1).trim();
    if (
      label.length === 0 ||
      label.length > 40 ||
      attributeValue.length === 0 ||
      attributeValue.length > 120
    )
      throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
    return { position, label, value: attributeValue };
  });
}

function toCustomerPreviewVariant(
  variant: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly description: string;
    readonly durationDays: number;
    readonly dataLimitBytes: bigint;
    readonly deviceLimit: number;
    readonly priceIrr: bigint;
    readonly displayAttributes: readonly {
      readonly position: number;
      readonly label: string;
      readonly value: string;
    }[];
  },
  productName: string,
): SellableProductVariant {
  return {
    id: variant.id,
    code: variant.code,
    productName,
    name: variant.name,
    description: variant.description,
    durationDays: variant.durationDays,
    dataLimitBytes: variant.dataLimitBytes,
    deviceLimit: variant.deviceLimit,
    priceIrr: variant.priceIrr,
    displayAttributes: variant.displayAttributes,
  };
}

function reviewDifferences(
  delta: CatalogAdminDelta,
  model: CatalogAdminReadModel,
): readonly string[] {
  if (delta.kind === 'category') {
    const current = model.categories.find((item) => item.code === delta.code);
    return current === undefined
      ? ['دستهٔ جدید ساخته می‌شود.']
      : changedFields([
          ['نام', current.name, delta.name],
          ['توضیح', current.description, delta.description],
          ['ترتیب', current.position, delta.position],
        ]);
  }
  if (delta.kind === 'product') {
    const current = model.products.find((item) => item.code === delta.code);
    return current === undefined
      ? ['محصول جدید ساخته می‌شود.']
      : changedFields([
          ['نام', current.name, delta.name],
          ['نام کوتاه', current.shortName, delta.shortName],
          ['توضیح', current.description, delta.description],
          ['نشان', current.badge ?? '', delta.badge ?? ''],
          ['ترتیب', current.position, delta.position],
        ]);
  }
  if (delta.kind === 'variant') {
    const current = model.variants.find((item) => item.code === delta.code);
    return current === undefined
      ? ['پلن جدید ساخته می‌شود.']
      : changedFields([
          ['نام', current.name, delta.name],
          ['توضیح', current.description, delta.description],
          ['مدت', current.durationDays, delta.durationDays],
          ['حجم', current.dataLimitBytes, delta.dataLimitBytes],
          ['اتصال', current.deviceLimit, delta.deviceLimit],
          ['قیمت', current.priceIrr, delta.priceIrr],
          [
            'ویژگی‌ها',
            JSON.stringify(current.displayAttributes),
            JSON.stringify(delta.displayAttributes ?? []),
          ],
        ]);
  }
  return [];
}

function changedFields(
  fields: readonly (readonly [string, string | number | bigint, string | number | bigint])[],
): readonly string[] {
  return fields.flatMap(([label, before, after]) =>
    before === after ? [] : [`${label}: ${String(before)} ← ${String(after)}`],
  );
}

function storeValues(state: CatalogAdminWizardState): Record<string, unknown> {
  return 'values' in state ? { ...state.values } : {};
}

function requiredStoreString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
  }
  return value;
}
