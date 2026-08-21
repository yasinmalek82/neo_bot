import type { CatalogAdminUseCase, CommerceUseCase } from '@neo-bot/application';
import { DomainConflictError, type SalesOrder, type TelegramCustomerInput } from '@neo-bot/domain';

import type { TelegramMessenger } from './telegram-api.js';
import { verifyTelegramInitData } from './telegram-init-data.js';
import { backToMenuButton, checkoutText, columnKeyboard } from './telegram-menu.js';

export class CustomerOrderService {
  public constructor(
    private readonly commerce: CommerceUseCase,
    private readonly catalog: CatalogAdminUseCase,
    private readonly botToken: string,
    private readonly messenger: TelegramMessenger | null = null,
  ) {}

  public async createOrder(
    initData: string,
    productVariantId: string,
    idempotencyKey: string | undefined,
  ): Promise<{
    readonly order: SalesOrder;
    readonly payment: { readonly cardNumber: string; readonly cardHolder: string };
  }> {
    const customer = this.customerFrom(initData);
    const payment = await this.readCard();
    const order = await this.commerce.beginCheckout({
      customer,
      productVariantId,
      idempotencyKey:
        idempotencyKey ?? `telegram:miniapp:${customer.telegramUserId}:${productVariantId}`,
    });
    await this.notifyPrivateCheckout(customer.privateChatId, order, payment);
    return { order, payment };
  }

  public async currentOrder(initData: string): Promise<{
    readonly order: SalesOrder | null;
    readonly payment: { readonly cardNumber: string; readonly cardHolder: string } | null;
  }> {
    const customerInput = this.customerFrom(initData);
    const { customer } = await this.commerce.recordCustomerActivity(customerInput);
    const order = await this.commerce.getOpenOrderForCustomer(customer.id);
    const payment =
      order !== null && (order.status === 'awaiting_receipt' || order.status === 'rejected')
        ? await this.readCard()
        : null;
    return { order, payment };
  }

  private customerFrom(initData: string): TelegramCustomerInput {
    const user = verifyTelegramInitData(initData, this.botToken);
    return {
      telegramUserId: String(user.id),
      privateChatId: String(user.id),
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
      ...(user.username === undefined ? {} : { username: user.username }),
    };
  }

  private async readCard(): Promise<{ readonly cardNumber: string; readonly cardHolder: string }> {
    const catalog = await this.catalog.getPublicCatalog();
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

  private async notifyPrivateCheckout(
    chatId: string,
    order: SalesOrder,
    payment: { readonly cardNumber: string; readonly cardHolder: string },
  ): Promise<void> {
    if (this.messenger === null) {
      return;
    }
    try {
      await this.messenger.sendMessage(
        chatId,
        checkoutText(order, payment.cardNumber, payment.cardHolder),
        columnKeyboard([backToMenuButton()]),
        { parseMode: 'HTML' },
      );
    } catch {
      // Mini App checkout still succeeds; the customer can send the receipt from the bot menu.
    }
  }
}
