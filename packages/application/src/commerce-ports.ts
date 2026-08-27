import type {
  CatalogCategory,
  ClaimedDeliveryJob,
  CustomerDeliveryJob,
  PaymentProofMediaKind,
  RepresentativeProfile,
  RepresentativePricingSource,
  SalesOrder,
  SellableProductVariant,
  ServiceBinding,
  TelegramCustomer,
  TelegramCustomerInput,
  TelegramPaymentProof,
} from '@neo-bot/domain';

export interface CommerceRepository {
  listCategories(parentId: string | null): Promise<readonly CatalogCategory[]>;
  getCategory(id: string): Promise<CatalogCategory | null>;
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
    representativeId?: string,
    serviceUsernameBase?: string,
  ): Promise<SalesOrder>;
  createRenewalOrder(
    customerId: string,
    idempotencyKey: string,
    representativeId?: string,
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
  listFailedProvisioning(limit: number): Promise<readonly SalesOrder[]>;
  submitTelegramProof(
    customerId: string,
    telegramFileId: string,
    telegramFileUniqueId: string,
    mediaKind?: PaymentProofMediaKind | null,
  ): Promise<{ readonly order: SalesOrder; readonly proof: TelegramPaymentProof }>;
  getPaymentProof(orderId: string): Promise<TelegramPaymentProof | null>;
  claimDueDeliveryJobs(limit: number, now: Date): Promise<readonly ClaimedDeliveryJob[]>;
  markDeliveryJobBrandSent(jobId: string, claimVersion: string, now: Date): Promise<boolean>;
  markDeliveryJobAnchor(
    jobId: string,
    claimVersion: string,
    telegramMessageId: string,
    now: Date,
  ): Promise<boolean>;
  markDeliveryJobDelivered(jobId: string, claimVersion: string, now: Date): Promise<boolean>;
  retryDeliveryJob(
    jobId: string,
    claimVersion: string,
    errorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean>;
  failDeliveryJob(
    jobId: string,
    claimVersion: string,
    errorCode: string,
    now: Date,
  ): Promise<boolean>;
  getDeliveryJobForOrder(orderId: string): Promise<CustomerDeliveryJob | null>;
  resetDeliveryJob(orderId: string, now: Date): Promise<CustomerDeliveryJob>;
  backfillMissingDeliveryJobs(now: Date): Promise<number>;
  getOrderDeliveryTarget(orderId: string): Promise<{
    readonly chatId: string;
    readonly subscriptionUrl: string;
  } | null>;
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

  findRepresentativeByTelegramUserId?(
    telegramUserId: string,
  ): Promise<Pick<RepresentativeProfile, 'id' | 'code'> | null>;
  listSellableVariantsForRepresentative?(
    categoryId: string,
    representativeId: string,
  ): Promise<readonly SellableProductVariant[]>;
  getSellableVariantForRepresentative?(
    variantId: string,
    representativeId: string,
  ): Promise<SellableProductVariant | null>;
  upsertRepresentative?(input: {
    readonly code: string;
    readonly telegramUserId: string;
    readonly displayName: string;
    readonly active: boolean;
  }): Promise<string>;
  listRepresentatives?(): Promise<readonly RepresentativeProfile[]>;
  assignRepresentativeToCustomerByTelegramId?(
    customerTelegramUserId: string,
    representativeId: string,
  ): Promise<void>;
  setRepresentativeVariantAccess?(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly active: boolean;
  }): Promise<void>;
  setRepresentativeBasePrice?(input: {
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void>;
  setRepresentativeOverridePrice?(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void>;
  clearRepresentativeOverridePrice?(input: {
    readonly representativeId: string;
    readonly variantId: string;
  }): Promise<void>;
  listRepresentativePriceAudit?(): Promise<
    readonly {
      representativeCode: string;
      variantCode: string;
      priceIrr: bigint;
      pricingSource: RepresentativePricingSource;
    }[]
  >;
}

export interface ServiceProvisioner {
  create(command: {
    readonly productVariantId: string;
    readonly idempotencyKey: string;
    readonly serviceUsernameBase?: string;
    readonly requestedUsername?: string;
  }): Promise<ServiceBinding>;
  renew(command: {
    readonly serviceId: string;
    readonly idempotencyKey: string;
  }): Promise<ServiceBinding>;
}
