import {
  DomainConflictError,
  PAYMENT_PROOF_MEDIA_KINDS,
  selectStorefrontEvidenceBadges,
  validateDiscountCode,
  validatePaymentProofReference,
  validateServiceUsernameBase,
  validateTelegramCustomerInput,
  type CatalogCategory,
  type PaymentProofMediaKind,
  type SalesOrder,
  type SellableProductVariant,
  type ServiceBinding,
  type TelegramCustomer,
  type TelegramCustomerInput,
  type TelegramPaymentProof,
} from '@neo-bot/domain';

import type { CommerceRepository, ServiceProvisioner } from './commerce-ports.js';
import type { ReferralUseCase } from './referral.js';
import type { RepresentativeWalletUseCase } from './representative-wallet.js';
import type { ReportingPublisher } from './reporting-ports.js';
import { utcDateStamp } from './reporting.js';

export class CommerceUseCase {
  public constructor(
    private readonly repository: CommerceRepository,
    private readonly serviceProvisioner: ServiceProvisioner,
    private readonly reporting: ReportingPublisher | null = null,
    private readonly referral: ReferralUseCase | null = null,
    private readonly representativeWallet: RepresentativeWalletUseCase | null = null,
  ) {}

  public listCategories(parentId: string | null): Promise<readonly CatalogCategory[]> {
    return this.repository.listCategories(parentId);
  }

  public getCategory(id: string): Promise<CatalogCategory | null> {
    return this.repository.getCategory(id);
  }

  public listVariants(categoryId: string): Promise<readonly SellableProductVariant[]> {
    return this.repository.listSellableVariants(categoryId);
  }

  public async listVariantsForCustomer(
    categoryId: string,
    customerInput: TelegramCustomerInput,
  ): Promise<readonly SellableProductVariant[]> {
    const representative = await this.resolveRepresentativeByTelegramUserId(
      customerInput.telegramUserId,
    );
    if (
      representative !== null &&
      this.repository.listSellableVariantsForRepresentative !== undefined
    ) {
      return this.withEvidenceBadges(
        await this.repository.listSellableVariantsForRepresentative(categoryId, representative.id),
      );
    }
    return this.withEvidenceBadges(await this.repository.listSellableVariants(categoryId));
  }

  private withEvidenceBadges(
    variants: readonly SellableProductVariant[],
  ): readonly SellableProductVariant[] {
    const byProduct = new Map<string, SellableProductVariant[]>();
    for (const variant of variants) {
      const key = variant.productId ?? variant.productName;
      const productVariants = byProduct.get(key) ?? [];
      productVariants.push(variant);
      byProduct.set(key, productVariants);
    }
    return variants.map((variant) => {
      const productVariants = byProduct.get(variant.productId ?? variant.productName) ?? [];
      const badges = selectStorefrontEvidenceBadges(
        productVariants.map((candidate) => ({
          id: candidate.id,
          fulfilledSalesLast30Days: candidate.fulfilledSalesLast30Days ?? 0,
          effectivePriceIrr: candidate.priceIrr,
          dataLimitBytes: candidate.dataLimitBytes,
        })),
      );
      const evidenceBadge = badges.get(variant.id);
      return evidenceBadge === undefined ? variant : { ...variant, evidenceBadge };
    });
  }

  public async getVariant(id: string): Promise<SellableProductVariant> {
    const variant = await this.repository.getSellableVariant(id);
    if (variant === null) {
      throw new DomainConflictError('PRODUCT_VARIANT_NOT_SELLABLE');
    }
    return variant;
  }

  public async getVariantForCustomer(
    id: string,
    customerInput: TelegramCustomerInput,
  ): Promise<SellableProductVariant> {
    const representative = await this.resolveRepresentativeByTelegramUserId(
      customerInput.telegramUserId,
    );
    const variant =
      representative !== null && this.repository.getSellableVariantForRepresentative !== undefined
        ? await this.repository.getSellableVariantForRepresentative(id, representative.id)
        : await this.repository.getSellableVariant(id);
    if (variant === null) {
      throw new DomainConflictError('PRODUCT_VARIANT_NOT_SELLABLE');
    }
    return variant;
  }

  public getCustomerForOrder(orderId: string) {
    return this.repository.getCustomerForOrder(orderId);
  }

  public getPaymentProof(orderId: string): Promise<TelegramPaymentProof | null> {
    return this.repository.getPaymentProof(orderId);
  }

  public listReviewQueue(): Promise<readonly SalesOrder[]> {
    return this.repository.listReviewQueue(10);
  }

  public listFailedProvisioning(): Promise<readonly SalesOrder[]> {
    return this.repository.listFailedProvisioning(10);
  }

  public getOpenOrderForCustomer(customerId: string): Promise<SalesOrder | null> {
    return this.repository.getOpenOrderForCustomer(customerId);
  }

  public async recordCustomerActivity(customerInput: TelegramCustomerInput): Promise<{
    readonly customer: TelegramCustomer;
    readonly firstContact: boolean;
  }> {
    validateTelegramCustomerInput(customerInput);
    const { customer, created } = await this.repository.upsertTelegramCustomer(customerInput);
    if (created) {
      await this.publish({
        type: 'customer.first_contact',
        occurrenceKey: `customer:${customer.telegramUserId}:first-contact`,
        payload: { telegramUserId: customer.telegramUserId },
      });
    } else {
      await this.publish({
        type: 'customer.activity',
        occurrenceKey: `customer:${customer.telegramUserId}:activity:${utcDateStamp(new Date())}`,
        payload: { telegramUserId: customer.telegramUserId },
      });
    }
    return { customer, firstContact: created };
  }

  public async previewDiscount(code: string): Promise<string> {
    const normalized = validateDiscountCode(code);
    const found = await this.repository.findDiscountCode(normalized);
    if (found === null) {
      throw new DomainConflictError('INVALID_DISCOUNT_CODE');
    }
    return found.code;
  }

  public async beginCheckout(command: {
    readonly customer: TelegramCustomerInput;
    readonly productVariantId: string;
    readonly idempotencyKey: string;
    readonly serviceUsernameBase: string;
    readonly discountCode?: string;
  }): Promise<SalesOrder> {
    validateTelegramCustomerInput(command.customer);
    validateServiceUsernameBase(command.serviceUsernameBase);
    requireIdempotencyKey(command.idempotencyKey);
    if (command.discountCode !== undefined) {
      await this.previewDiscount(command.discountCode);
    }
    const { customer, created } = await this.repository.upsertTelegramCustomer(command.customer);
    rejectIfShopBlocked(customer);
    if (created) {
      await this.publish({
        type: 'customer.first_contact',
        occurrenceKey: `customer:${customer.telegramUserId}:first-contact`,
        payload: { telegramUserId: customer.telegramUserId },
      });
    }
    const representative = await this.resolveRepresentativeByTelegramUserId(
      command.customer.telegramUserId,
    );
    const order = await this.repository.createOrder(
      customer.id,
      command.productVariantId,
      command.idempotencyKey,
      representative?.id,
      command.serviceUsernameBase,
    );
    await this.publish({
      type: 'order.created',
      occurrenceKey: `order:${order.id}:created`,
      payload: {
        orderId: order.id,
        telegramUserId: customer.telegramUserId,
        productName: order.productName,
        variantName: order.variantName,
        amountIrr: order.amountIrr.toString(),
        ...(representative === null ? {} : { representativeCode: representative.code }),
      },
    });
    if (order.representativeCode != null) {
      await this.publish({
        type: 'reseller.order_created',
        occurrenceKey: `reseller:order:${order.id}:created`,
        payload: {
          orderId: order.id,
          representativeCode: order.representativeCode,
          telegramUserId: customer.telegramUserId,
          productName: order.productName,
          variantName: order.variantName,
          amountIrr: order.amountIrr.toString(),
          pricingSource: order.pricingSource ?? 'public',
        },
      });
    }
    return order;
  }

  public async beginRenewal(command: {
    readonly customer: TelegramCustomerInput;
    readonly idempotencyKey: string;
    readonly discountCode?: string;
  }): Promise<SalesOrder> {
    validateTelegramCustomerInput(command.customer);
    requireIdempotencyKey(command.idempotencyKey);
    if (command.discountCode !== undefined) {
      await this.previewDiscount(command.discountCode);
    }
    const { customer, created } = await this.repository.upsertTelegramCustomer(command.customer);
    rejectIfShopBlocked(customer);
    if (created) {
      await this.publish({
        type: 'customer.first_contact',
        occurrenceKey: `customer:${customer.telegramUserId}:first-contact`,
        payload: { telegramUserId: customer.telegramUserId },
      });
    }
    const representative = await this.resolveRepresentativeByTelegramUserId(
      command.customer.telegramUserId,
    );
    const order = await this.repository.createRenewalOrder(
      customer.id,
      command.idempotencyKey,
      representative?.id,
    );
    await this.publish({
      type: 'renewal.requested',
      occurrenceKey: `order:${order.id}:renewal-requested`,
      payload: {
        orderId: order.id,
        targetServiceId: order.targetServiceId ?? 'unknown',
        telegramUserId: customer.telegramUserId,
        amountIrr: order.amountIrr.toString(),
      },
    });
    return order;
  }

  public async beginTrial(command: {
    readonly customer: TelegramCustomerInput;
    readonly idempotencyKey: string;
  }): Promise<SalesOrder> {
    validateTelegramCustomerInput(command.customer);
    requireIdempotencyKey(command.idempotencyKey);
    if (this.repository.createTrialOrder === undefined) {
      throw new DomainConflictError('TRIAL_NOT_CONFIGURED');
    }
    const { customer, created } = await this.repository.upsertTelegramCustomer(command.customer);
    rejectIfShopBlocked(customer);
    if (created) {
      await this.publish({
        type: 'customer.first_contact',
        occurrenceKey: `customer:${customer.telegramUserId}:first-contact`,
        payload: { telegramUserId: customer.telegramUserId },
      });
    }
    const usernameBase = trialUsernameBase(customer.telegramUserId);
    const order = await this.repository.createTrialOrder({
      customerId: customer.id,
      idempotencyKey: command.idempotencyKey,
      serviceUsernameBase: usernameBase,
    });
    if (order.status === 'fulfilled') {
      throw new DomainConflictError('TRIAL_ALREADY_CLAIMED');
    }
    await this.publish({
      type: 'trial.claimed',
      occurrenceKey: `order:${order.id}:trial-claimed`,
      payload: {
        orderId: order.id,
        telegramUserId: customer.telegramUserId,
        productName: order.productName,
        variantName: order.variantName,
      },
    });
    if (order.status === 'provisioning' || order.status === 'provisioning_failed') {
      return this.fulfillReservedOrder(order);
    }
    return order;
  }

  public async submitPaymentProof(command: {
    readonly customer: TelegramCustomerInput;
    readonly telegramFileId: string;
    readonly telegramFileUniqueId: string;
    readonly mediaKind?: PaymentProofMediaKind | null;
  }): Promise<SalesOrder> {
    validateTelegramCustomerInput(command.customer);
    validatePaymentProofReference(command.telegramFileId, command.telegramFileUniqueId);
    if (
      command.mediaKind !== undefined &&
      command.mediaKind !== null &&
      !PAYMENT_PROOF_MEDIA_KINDS.includes(command.mediaKind)
    ) {
      throw new DomainConflictError('INVALID_PAYMENT_PROOF');
    }
    const { customer } = await this.repository.upsertTelegramCustomer(command.customer);
    const result = await this.repository.submitTelegramProof(
      customer.id,
      command.telegramFileId,
      command.telegramFileUniqueId,
      command.mediaKind ?? null,
    );
    await this.publish({
      type: 'payment.proof_submitted',
      occurrenceKey: `order:${result.order.id}:proof:${command.telegramFileUniqueId}`,
      payload: {
        orderId: result.order.id,
        telegramUserId: customer.telegramUserId,
        productName: result.order.productName,
        variantName: result.order.variantName,
        amountIrr: result.order.amountIrr.toString(),
      },
    });
    return result.order;
  }

  public async approveOrder(orderId: string, adminTelegramUserId: string): Promise<SalesOrder> {
    requireTelegramUserId(adminTelegramUserId);
    const order = await this.repository.reserveProvisioning(orderId, adminTelegramUserId);
    const customer = await this.repository.getCustomerForOrder(order.id);
    await this.publish({
      type: 'payment.approved',
      occurrenceKey: `order:${order.id}:approved`,
      payload: {
        orderId: order.id,
        adminTelegramUserId,
        telegramUserId: customer?.telegramUserId ?? 'unknown',
      },
    });
    if (order.status === 'fulfilled') {
      await this.publishProvisioningSucceeded(order, customer?.telegramUserId ?? 'unknown');
      await this.grantReferralReward(order);
      return order;
    }
    return this.fulfillReservedOrder(order);
  }

  public async retryProvisioning(
    orderId: string,
    adminTelegramUserId: string,
  ): Promise<SalesOrder> {
    requireTelegramUserId(adminTelegramUserId);
    const order = await this.repository.getOrder(orderId);
    if (order === null) {
      throw new DomainConflictError('ORDER_NOT_FOUND');
    }
    if (order.status === 'fulfilled') {
      const customer = await this.repository.getCustomerForOrder(order.id);
      await this.publishProvisioningSucceeded(order, customer?.telegramUserId ?? 'unknown');
      await this.grantReferralReward(order);
      return order;
    }
    if (order.status !== 'provisioning' && order.status !== 'provisioning_failed') {
      throw new DomainConflictError('ORDER_NOT_READY_FOR_RETRY');
    }
    return this.fulfillReservedOrder(order);
  }

  public async hasActiveService(customerInput: TelegramCustomerInput): Promise<boolean> {
    validateTelegramCustomerInput(customerInput);
    const { customer } = await this.repository.upsertTelegramCustomer(customerInput);
    const serviceId = await this.repository.getLatestFulfilledServiceId(customer.id);
    return serviceId !== null;
  }

  public async rejectOrder(
    orderId: string,
    adminTelegramUserId: string,
    reasonCode = 'PAYMENT_NOT_CONFIRMED',
  ): Promise<SalesOrder> {
    requireTelegramUserId(adminTelegramUserId);
    if (!/^[A-Z0-9_]{3,80}$/u.test(reasonCode)) {
      throw new DomainConflictError('INVALID_REJECTION_REASON');
    }
    const order = await this.repository.rejectOrder(orderId, adminTelegramUserId, reasonCode);
    await this.publish({
      type: 'payment.rejected',
      occurrenceKey: `order:${order.id}:rejected:${String(order.updatedAt.getTime())}`,
      payload: {
        orderId: order.id,
        reasonCode,
        adminTelegramUserId,
      },
    });
    return order;
  }

  private async fulfillReservedOrder(order: SalesOrder): Promise<SalesOrder> {
    if (order.status !== 'provisioning' && order.status !== 'provisioning_failed') {
      throw new DomainConflictError('ORDER_NOT_READY_FOR_PROVISIONING');
    }
    await this.debitRepresentativeWalletIfNeeded(order);
    const customer = await this.repository.getCustomerForOrder(order.id);
    let service: ServiceBinding;
    try {
      service =
        order.kind === 'renewal'
          ? await this.renewReservedOrder(order)
          : await this.serviceProvisioner.create({
              productVariantId: order.productVariantId,
              idempotencyKey: `order:${order.id}:provision`,
              ...(order.serviceUsernameBase === null
                ? {}
                : { serviceUsernameBase: order.serviceUsernameBase }),
            });
    } catch (error: unknown) {
      // Only a provider failure before completion may mark provisioning failed.
      const errorCode =
        error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : 'PROVISIONING_FAILED';
      await this.repository.markProvisioningFailed(order.id, errorCode);
      await this.publish({
        type: 'provisioning.failed',
        occurrenceKey: `order:${order.id}:provision-failed`,
        payload: { orderId: order.id, errorCode },
      });
      throw error;
    }
    const fulfilled = await this.repository.completeOrder(order.id, service.id);
    // Failures after completeOrder must not rewrite the fulfilled order into a
    // provisioning failure; the durable delivery job owns customer notification.
    await this.publishProvisioningSucceeded(fulfilled, customer?.telegramUserId ?? 'unknown');
    await this.grantReferralReward(fulfilled);
    return fulfilled;
  }

  private async debitRepresentativeWalletIfNeeded(order: SalesOrder): Promise<void> {
    if (this.representativeWallet === null) {
      return;
    }
    if (order.kind === 'trial' || order.amountIrr <= 0n) {
      return;
    }
    if (
      order.pricingSource !== 'representative_base' &&
      order.pricingSource !== 'representative_override'
    ) {
      return;
    }
    if (
      order.representativeId === undefined ||
      order.representativeId === null ||
      order.representativeId.length === 0
    ) {
      throw new DomainConflictError('INVALID_REPRESENTATIVE');
    }
    const entry = await this.representativeWallet.debitForPurchase({
      representativeId: order.representativeId,
      amountIrr: order.amountIrr,
      salesOrderId: order.id,
      idempotencyKey: `order:${order.id}:rep-wallet-debit`,
    });
    await this.publish({
      type: 'reseller.wallet_debited',
      occurrenceKey: `reseller:order:${order.id}:wallet-debited`,
      payload: {
        representativeId: entry.representativeId,
        ledgerId: entry.id,
        orderId: order.id,
      },
    });
  }

  private async grantReferralReward(order: SalesOrder): Promise<void> {
    if (this.referral === null) {
      return;
    }
    await this.referral.grantForFulfilledPaidOrder(order);
  }

  private async publishProvisioningSucceeded(
    order: SalesOrder,
    telegramUserId: string,
  ): Promise<void> {
    await this.publish({
      type: 'provisioning.succeeded',
      occurrenceKey: `order:${order.id}:provisioned`,
      payload: {
        orderId: order.id,
        serviceId: order.serviceId ?? 'unknown',
        telegramUserId,
      },
    });
  }

  private async renewReservedOrder(order: SalesOrder): Promise<ServiceBinding> {
    if (order.targetServiceId === null) {
      throw new DomainConflictError('RENEWAL_TARGET_MISSING');
    }
    return this.serviceProvisioner.renew({
      serviceId: order.targetServiceId,
      idempotencyKey: `order:${order.id}:provision`,
    });
  }

  private async publish(
    input: Parameters<NonNullable<ReportingPublisher['record']>>[0],
  ): Promise<void> {
    if (this.reporting === null) {
      return;
    }
    await this.reporting.record(input);
  }

  private async resolveRepresentativeByTelegramUserId(
    telegramUserId: string,
  ): Promise<{ id: string; code: string } | null> {
    if (this.repository.findRepresentativeByTelegramUserId === undefined) {
      return null;
    }
    return this.repository.findRepresentativeByTelegramUserId(telegramUserId);
  }
}

function requireTelegramUserId(value: string): void {
  if (!/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_TELEGRAM_ID');
  }
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new DomainConflictError('INVALID_IDEMPOTENCY_KEY');
  }
}

function rejectIfShopBlocked(customer: { readonly shopBlocked?: boolean }): void {
  if (customer.shopBlocked === true) {
    throw new DomainConflictError('SHOP_BLOCKED');
  }
}

function trialUsernameBase(telegramUserId: string): string {
  return `t${telegramUserId.slice(-8)}`;
}
