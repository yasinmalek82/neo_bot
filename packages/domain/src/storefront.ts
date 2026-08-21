import { DomainConflictError } from './errors.js';

export type StorefrontIconKey = 'loop' | 'globe' | 'star' | 'bolt';

export interface StorefrontSettings {
  readonly brandName: string;
  readonly heroTitle: string;
  readonly heroSubtitle: string;
  readonly deliveryNote: string;
  readonly supportNote: string;
  readonly volumeHelper: string;
  readonly cardNumber: string;
  readonly cardHolder: string;
}

export interface StorefrontVariant {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly durationLabel: string;
  readonly dataLimitBytes: bigint;
  readonly dataLimitLabel: string;
  readonly deviceLimit: number;
  readonly deviceLabel: string;
  readonly priceIrr: bigint;
  readonly position: number;
  readonly sellable: boolean;
  readonly providerCode: string;
  readonly groupIds: readonly number[];
}

export interface StorefrontProduct {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly badge: string | null;
  readonly iconKey: StorefrontIconKey;
  readonly position: number;
  readonly active: boolean;
  readonly category: {
    readonly code: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
  };
  readonly variants: readonly StorefrontVariant[];
}

export interface StorefrontCatalog {
  readonly settings: StorefrontSettings;
  readonly products: readonly StorefrontProduct[];
  readonly updatedAt: Date;
}

export interface CatalogVariantDraft {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly durationLabel: string;
  readonly dataLimitBytes: bigint;
  readonly dataLimitLabel: string;
  readonly deviceLimit: number;
  readonly deviceLabel: string;
  readonly priceIrr: bigint;
  readonly position: number;
  readonly sellable: boolean;
  readonly providerCode: string;
  readonly groupIds: readonly number[];
}

export interface CatalogProductDraft {
  readonly code: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly badge: string | null;
  readonly iconKey: StorefrontIconKey;
  readonly position: number;
  readonly active: boolean;
  readonly category: {
    readonly code: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
  };
  readonly variants: readonly CatalogVariantDraft[];
}

export interface ReplaceStorefrontCatalogCommand {
  readonly settings: StorefrontSettings;
  readonly products: readonly CatalogProductDraft[];
}

export interface ProviderGroupChoice {
  readonly providerCode: string;
  readonly groupId: number;
  readonly name: string;
  readonly available: boolean;
  readonly disabled: boolean;
}

export function validateStorefrontCatalogDraft(command: ReplaceStorefrontCatalogCommand): void {
  requireText(command.settings.brandName, 1, 80, 'INVALID_BRAND_NAME');
  requireText(command.settings.heroTitle, 1, 160, 'INVALID_HERO_TITLE');
  requireText(command.settings.heroSubtitle, 0, 240, 'INVALID_HERO_SUBTITLE');
  requireText(command.settings.deliveryNote, 0, 160, 'INVALID_DELIVERY_NOTE');
  requireText(command.settings.supportNote, 0, 160, 'INVALID_SUPPORT_NOTE');
  requireText(command.settings.volumeHelper, 0, 240, 'INVALID_VOLUME_HELPER');
  if (!/^\d{16}$/u.test(command.settings.cardNumber)) {
    throw new DomainConflictError('INVALID_CARD_NUMBER');
  }
  requireText(command.settings.cardHolder, 2, 120, 'INVALID_CARD_HOLDER');

  const productCodes = new Set<string>();
  const variantCodes = new Set<string>();
  const categoryDefinitions = new Map<string, string>();
  for (const product of command.products) {
    requireCode(product.code, 'INVALID_PRODUCT_CODE');
    if (productCodes.has(product.code)) throw new DomainConflictError('DUPLICATE_PRODUCT_CODE');
    productCodes.add(product.code);
    requireText(product.name, 1, 120, 'INVALID_PRODUCT_NAME');
    requireText(product.shortName, 0, 120, 'INVALID_PRODUCT_SHORT_NAME');
    requireText(product.description, 0, 500, 'INVALID_PRODUCT_DESCRIPTION');
    if (product.badge !== null) requireText(product.badge, 1, 40, 'INVALID_PRODUCT_BADGE');
    requirePosition(product.position);

    requireCode(product.category.code, 'INVALID_CATEGORY_CODE');
    requireText(product.category.name, 1, 120, 'INVALID_CATEGORY_NAME');
    requireText(product.category.description, 0, 500, 'INVALID_CATEGORY_DESCRIPTION');
    requirePosition(product.category.position);
    const categoryFingerprint = JSON.stringify(product.category);
    const previousCategory = categoryDefinitions.get(product.category.code);
    if (previousCategory !== undefined && previousCategory !== categoryFingerprint) {
      throw new DomainConflictError('CONFLICTING_CATEGORY_DEFINITION');
    }
    categoryDefinitions.set(product.category.code, categoryFingerprint);

    let sellableCount = 0;
    for (const variant of product.variants) {
      requireCode(variant.code, 'INVALID_VARIANT_CODE');
      if (variantCodes.has(variant.code)) throw new DomainConflictError('DUPLICATE_VARIANT_CODE');
      variantCodes.add(variant.code);
      requireText(variant.name, 1, 120, 'INVALID_VARIANT_NAME');
      requireText(variant.description, 0, 500, 'INVALID_VARIANT_DESCRIPTION');
      requireText(variant.durationLabel, 0, 80, 'INVALID_DURATION_LABEL');
      requireText(variant.dataLimitLabel, 0, 80, 'INVALID_DATA_LIMIT_LABEL');
      requireText(variant.deviceLabel, 0, 80, 'INVALID_DEVICE_LABEL');
      requireCode(variant.providerCode, 'INVALID_PROVIDER_CODE');
      requirePosition(variant.position);
      if (
        !Number.isInteger(variant.durationDays) ||
        variant.durationDays < 1 ||
        variant.durationDays > 3660
      ) {
        throw new DomainConflictError('INVALID_DURATION');
      }
      if (variant.dataLimitBytes < 0n) throw new DomainConflictError('INVALID_DATA_LIMIT');
      if (
        !Number.isInteger(variant.deviceLimit) ||
        variant.deviceLimit < 0 ||
        variant.deviceLimit > 100
      ) {
        throw new DomainConflictError('INVALID_DEVICE_LIMIT');
      }
      if (variant.priceIrr < 0n) throw new DomainConflictError('INVALID_PRICE');
      if (
        variant.groupIds.length === 0 ||
        new Set(variant.groupIds).size !== variant.groupIds.length
      ) {
        throw new DomainConflictError('INVALID_GROUPS');
      }
      if (variant.groupIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new DomainConflictError('INVALID_GROUPS');
      }
      if (variant.sellable) {
        sellableCount += 1;
        if (variant.priceIrr <= 0n)
          throw new DomainConflictError('SELLABLE_VARIANT_REQUIRES_PRICE');
      }
    }
    if (product.active && sellableCount === 0) {
      throw new DomainConflictError('ACTIVE_PRODUCT_REQUIRES_SELLABLE_VARIANT');
    }
  }
}

function requireCode(value: string, errorCode: string): void {
  if (!/^[a-z0-9-]{3,80}$/u.test(value)) throw new DomainConflictError(errorCode);
}

function requireText(value: string, minimum: number, maximum: number, errorCode: string): void {
  const length = value.trim().length;
  if (length < minimum || length > maximum) throw new DomainConflictError(errorCode);
}

function requirePosition(value: number): void {
  if (!Number.isInteger(value) || value < -10_000 || value > 10_000) {
    throw new DomainConflictError('INVALID_POSITION');
  }
}
