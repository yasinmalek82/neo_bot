import type {
  CatalogCategory,
  SalesOrder,
  SellableProductVariant,
  ServiceBinding,
  TelegramCustomer,
  TelegramCustomerInput,
  TelegramPaymentProof,
} from '@neo-bot/domain';

export interface CommerceRepository {
  listCategories(parentId: string | null): Promise<readonly CatalogCategory[]>;
  listSellableVariants(categoryId: string): Promise<readonly SellableProductVariant[]>;
  getSellableVariant(id: string): Promise<SellableProductVariant | null>;
  upsertTelegramCustomer(input: TelegramCustomerInput): Promise<{
    readonly customer: TelegramCustomer;
    readonly created: boolean;
  }>;
  createOrder(
    customerId: string,
    productVariantId: string,
    idempotencyKey: string,
  ): Promise<SalesOrder>;
  getOrder(id: string): Promise<SalesOrder | null>;
  getCustomerForOrder(orderId: string): Promise<TelegramCustomer | null>;
  getOpenOrderForCustomer(customerId: string): Promise<SalesOrder | null>;
  getLatestFulfilledServiceId(customerId: string): Promise<string | null>;
  summarizeUtcDay(
    from: Date,
    to: Date,
  ): Promise<{
    readonly orderCount: string;
    readonly fulfilledCount: string;
    readonly amountIrr: string;
    readonly failedCount: string;
  }>;
  listReviewQueue(limit: number): Promise<readonly SalesOrder[]>;
  submitTelegramProof(
    customerId: string,
    telegramFileId: string,
    telegramFileUniqueId: string,
  ): Promise<{ readonly order: SalesOrder; readonly proof: TelegramPaymentProof }>;
  reserveProvisioning(orderId: string, adminTelegramUserId: string): Promise<SalesOrder>;
  completeOrder(orderId: string, serviceId: string): Promise<SalesOrder>;
  markProvisioningFailed(orderId: string, errorCode: string): Promise<SalesOrder>;
  rejectOrder(
    orderId: string,
    adminTelegramUserId: string,
    reasonCode: string,
  ): Promise<SalesOrder>;
  reserveTelegramUpdate(updateId: string): Promise<boolean>;
  completeTelegramUpdate(updateId: string): Promise<void>;
  failTelegramUpdate(updateId: string, errorCode: string): Promise<void>;
}

export interface ServiceProvisioner {
  create(command: {
    readonly productVariantId: string;
    readonly idempotencyKey: string;
  }): Promise<ServiceBinding>;
  renew(command: {
    readonly serviceId: string;
    readonly idempotencyKey: string;
  }): Promise<ServiceBinding>;
}
