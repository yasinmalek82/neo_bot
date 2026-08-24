import type { CatalogAdminUseCase, CommerceUseCase } from '@neo-bot/application';
import { DomainConflictError, type SalesOrder, type TelegramCustomerInput } from '@neo-bot/domain';

import type { TelegramMessenger } from './telegram-api.js';
import { verifyTelegramInitData } from './telegram-init-data.js';
import {
  backToMenuButton,
  checkoutText,
  columnKeyboard,
  renewalCompletedText,
} from './telegram-menu.js';

interface ShopCategorySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ShopVariantSummary {
  readonly id: string;
  readonly productName: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly volumeLabel: string;
  readonly deviceLabel: string;
  readonly priceToman: number;
}

interface ShopCategoryDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parent: { readonly id: string; readonly name: string } | null;
  readonly categories: readonly ShopCategorySummary[];
  readonly variants: readonly ShopVariantSummary[];
}

interface ServiceReader {
  get(serviceId: string): Promise<{
    readonly remote: { readonly subscriptionUrl: string };
  }>;
}

export class CustomerOrderService {
  public constructor(
    private readonly commerce: CommerceUseCase,
    private readonly catalog: CatalogAdminUseCase,
    private readonly botToken: string,
    private readonly messenger: TelegramMessenger | null = null,
    private readonly adminTelegramUserIds: ReadonlySet<string> = new Set(),
    private readonly serviceReader: ServiceReader | null = null,
  ) {}

  public async listShopCategories(
    initData: string,
    parentId: string | null,
  ): Promise<{
    readonly categories: readonly ShopCategorySummary[];
    readonly emptyHint: 'admin' | 'customer' | null;
  }> {
    const customer = this.customerFrom(initData);
    const categories = (await this.commerce.listCategories(parentId)).map(summarizeCategory);
    if (parentId !== null || categories.length > 0) {
      return { categories, emptyHint: null };
    }
    return {
      categories,
      emptyHint: this.adminTelegramUserIds.has(customer.telegramUserId) ? 'admin' : 'customer',
    };
  }

  public async getShopCategory(initData: string, categoryId: string): Promise<ShopCategoryDetail> {
    this.customerFrom(initData);
    const category = await this.commerce.getCategory(categoryId);
    if (category === null) {
      throw new DomainConflictError('CATEGORY_NOT_FOUND');
    }
    const [parent, children, variants] = await Promise.all([
      category.parentId === null
        ? Promise.resolve(null)
        : this.commerce.getCategory(category.parentId),
      this.commerce.listCategories(categoryId),
      this.commerce.listVariants(categoryId),
    ]);
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      parent: parent === null ? null : { id: parent.id, name: parent.name },
      categories: children.map(summarizeCategory),
      variants: variants.map(summarizeVariant),
    };
  }

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
      serviceUsernameBase: `u${customer.telegramUserId}`,
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

  public async hasActiveService(initData: string): Promise<{ readonly hasActiveService: boolean }> {
    const customer = this.customerFrom(initData);
    return { hasActiveService: await this.commerce.hasActiveService(customer) };
  }

  public async renew(initData: string): Promise<{ readonly status: 'renewed' }> {
    const customer = this.customerFrom(initData);
    const service = await this.commerce.renewForCustomer(customer);
    await this.notifyPrivateRenewal(customer.privateChatId, service.id);
    return { status: 'renewed' };
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

  private async notifyPrivateRenewal(chatId: string, serviceId: string): Promise<void> {
    if (this.messenger === null || this.serviceReader === null) {
      return;
    }
    try {
      const remote = await this.serviceReader.get(serviceId);
      await this.messenger.sendMessage(
        chatId,
        renewalCompletedText(remote.remote.subscriptionUrl),
        columnKeyboard([backToMenuButton()]),
        { parseMode: 'HTML' },
      );
    } catch {
      // Mini App renew still succeeds; the customer can open the bot chat for the link.
    }
  }
}

function summarizeCategory(category: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}): ShopCategorySummary {
  return { id: category.id, name: category.name, description: category.description };
}

function summarizeVariant(variant: {
  readonly id: string;
  readonly productName: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
  readonly priceIrr: bigint;
}): ShopVariantSummary {
  return {
    id: variant.id,
    productName: variant.productName,
    name: variant.name,
    description: variant.description,
    durationDays: variant.durationDays,
    volumeLabel:
      variant.dataLimitBytes === 0n
        ? 'نامحدود'
        : `${String(variant.dataLimitBytes / 1024n ** 3n)} گیگابایت`,
    deviceLabel: variant.deviceLimit === 0 ? 'نامحدود' : String(variant.deviceLimit),
    priceToman: Number(variant.priceIrr / 10n),
  };
}
