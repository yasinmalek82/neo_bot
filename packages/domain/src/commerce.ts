import { DomainConflictError } from './errors.js';
import type { StorefrontDisplayAttribute, StorefrontEvidenceBadge } from './storefront.js';

export interface CatalogCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly parentId: string | null;
  readonly position: number;
}

export const REPRESENTATIVE_PRICING_SOURCES = [
  'public',
  'representative_base',
  'representative_override',
] as const;

export type RepresentativePricingSource = (typeof REPRESENTATIVE_PRICING_SOURCES)[number];

export interface SellableProductVariant {
  readonly id: string;
  readonly code: string;
  readonly productId?: string;
  readonly productName: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
  readonly priceIrr: bigint;
  readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
  readonly fulfilledSalesLast30Days?: number;
  readonly evidenceBadge?: StorefrontEvidenceBadge;
  readonly pricingSource?: RepresentativePricingSource;
}

export interface RepresentativeProfile {
  readonly id: string;
  readonly code: string;
  readonly telegramUserId: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface TelegramCustomer {
  readonly id: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly username: string | null;
  readonly displayName: string;
}

export type SalesOrderStatus =
  | 'awaiting_receipt'
  | 'receipt_submitted'
  | 'provisioning'
  | 'provisioning_failed'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled';

export interface SalesOrder {
  readonly id: string;
  readonly customerId: string;
  readonly productVariantId: string;
  readonly productName: string;
  readonly variantName: string;
  readonly amountIrr: bigint;
  readonly status: SalesOrderStatus;
  readonly serviceId: string | null;
  readonly representativeId?: string | null;
  readonly representativeCode?: string | null;
  readonly pricingSource?: RepresentativePricingSource;
  readonly serviceUsernameBase: string | null;
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TelegramPaymentProof {
  readonly id: string;
  readonly orderId: string;
  readonly telegramFileId: string;
  readonly telegramFileUniqueId: string;
  readonly submittedAt: Date;
}

export interface TelegramCustomerInput {
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly username?: string;
  readonly displayName: string;
}

export function validateTelegramCustomerInput(input: TelegramCustomerInput): void {
  if (!/^\d{1,20}$/u.test(input.telegramUserId) || !/^\d{1,20}$/u.test(input.privateChatId)) {
    throw new DomainConflictError('INVALID_TELEGRAM_ID');
  }
  if (input.telegramUserId !== input.privateChatId) {
    throw new DomainConflictError('PRIVATE_CHAT_REQUIRED');
  }
  if (input.displayName.trim().length === 0 || input.displayName.length > 200) {
    throw new DomainConflictError('INVALID_CUSTOMER_NAME');
  }
  if (input.username !== undefined && input.username.length > 64) {
    throw new DomainConflictError('INVALID_TELEGRAM_USERNAME');
  }
}

export function validatePaymentProofReference(fileId: string, fileUniqueId: string): void {
  if (
    fileId.length === 0 ||
    fileId.length > 512 ||
    fileUniqueId.length === 0 ||
    fileUniqueId.length > 128
  ) {
    throw new DomainConflictError('INVALID_PAYMENT_PROOF');
  }
}

export function isRepresentativePricingSource(value: string): value is RepresentativePricingSource {
  return REPRESENTATIVE_PRICING_SOURCES.some((source) => source === value);
}

export function resolveRepresentativePrice(input: {
  readonly publicPriceIrr: bigint;
  readonly representativeBasePriceIrr: bigint | null;
  readonly representativeOverridePriceIrr: bigint | null;
}): {
  readonly priceIrr: bigint;
  readonly pricingSource: RepresentativePricingSource;
} {
  requirePositivePrice(input.publicPriceIrr);
  if (input.representativeOverridePriceIrr !== null) {
    requirePositivePrice(input.representativeOverridePriceIrr);
    return {
      priceIrr: input.representativeOverridePriceIrr,
      pricingSource: 'representative_override',
    };
  }
  if (input.representativeBasePriceIrr !== null) {
    requirePositivePrice(input.representativeBasePriceIrr);
    return {
      priceIrr: input.representativeBasePriceIrr,
      pricingSource: 'representative_base',
    };
  }
  return { priceIrr: input.publicPriceIrr, pricingSource: 'public' };
}

function requirePositivePrice(priceIrr: bigint): void {
  if (priceIrr <= 0n) {
    throw new DomainConflictError('INVALID_PRICE');
  }
}
