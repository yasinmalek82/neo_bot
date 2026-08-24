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
  readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
}

export interface StorefrontDisplayAttribute {
  readonly position: number;
  readonly label: string;
  readonly value: string;
}

export type StorefrontEvidenceBadge =
  | { readonly kind: 'popular'; readonly label: 'پرفروش' }
  | { readonly kind: 'value'; readonly label: 'کمترین قیمت' }
  | { readonly kind: 'capacity'; readonly label: 'بیشترین حجم' };

export interface StorefrontEvidenceCandidate {
  readonly id: string;
  readonly fulfilledSalesLast30Days: number;
  readonly effectivePriceIrr: bigint;
  readonly dataLimitBytes: bigint;
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
  readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
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

export interface RepresentativeVariantBasePriceDraft {
  readonly variantCode: string;
  readonly priceIrr: bigint;
}

export interface RepresentativeVariantOverrideDraft {
  readonly representativeCode: string;
  readonly variantCode: string;
  readonly priceIrr: bigint;
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
      validateStorefrontDisplayAttributes(variant.displayAttributes ?? []);
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

export function validateStorefrontDisplayAttributes(
  attributes: readonly StorefrontDisplayAttribute[],
): void {
  if (attributes.length > 4) throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
  const positions = new Set<number>();
  for (const attribute of attributes) {
    if (!Number.isInteger(attribute.position) || attribute.position < 0 || attribute.position > 3) {
      throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
    }
    if (positions.has(attribute.position))
      throw new DomainConflictError('INVALID_DISPLAY_ATTRIBUTES');
    positions.add(attribute.position);
    requireText(attribute.label, 1, 40, 'INVALID_DISPLAY_ATTRIBUTES');
    requireText(attribute.value, 1, 120, 'INVALID_DISPLAY_ATTRIBUTES');
  }
}

export function selectStorefrontEvidenceBadges(
  candidates: readonly StorefrontEvidenceCandidate[],
): ReadonlyMap<string, StorefrontEvidenceBadge> {
  const badges = new Map<string, StorefrontEvidenceBadge>();
  const popular = uniqueCandidate(candidates, (item) => item.fulfilledSalesLast30Days, 'max');
  if (popular !== null && popular.fulfilledSalesLast30Days >= 3) {
    badges.set(popular.id, { kind: 'popular', label: 'پرفروش' });
  }
  const value = uniqueCandidate(candidates, (item) => item.effectivePriceIrr, 'min');
  if (value !== null && !badges.has(value.id)) {
    badges.set(value.id, { kind: 'value', label: 'کمترین قیمت' });
  }
  const finite = candidates.filter((item) => item.dataLimitBytes > 0n);
  const capacity = uniqueCandidate(finite, (item) => item.dataLimitBytes, 'max');
  if (capacity !== null && !badges.has(capacity.id)) {
    badges.set(capacity.id, { kind: 'capacity', label: 'بیشترین حجم' });
  }
  return badges;
}

function uniqueCandidate(
  candidates: readonly StorefrontEvidenceCandidate[],
  metric: (item: StorefrontEvidenceCandidate) => number | bigint,
  direction: 'min' | 'max',
): StorefrontEvidenceCandidate | null {
  if (candidates.length === 0) return null;
  let selected = candidates[0];
  if (selected === undefined) return null;
  let count = 1;
  for (const candidate of candidates.slice(1)) {
    const value = metric(candidate);
    const current = metric(selected);
    if ((direction === 'min' && value < current) || (direction === 'max' && value > current)) {
      selected = candidate;
      count = 1;
    } else if (value === current) {
      count += 1;
    }
  }
  return count === 1 ? selected : null;
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

export function validateRepresentativePricingDraft(input: {
  readonly basePrices: readonly RepresentativeVariantBasePriceDraft[];
  readonly overrides: readonly RepresentativeVariantOverrideDraft[];
}): void {
  const baseKeys = new Set<string>();
  for (const item of input.basePrices) {
    requireCode(item.variantCode, 'INVALID_VARIANT_CODE');
    if (item.priceIrr <= 0n) {
      throw new DomainConflictError('INVALID_PRICE');
    }
    if (baseKeys.has(item.variantCode)) {
      throw new DomainConflictError('DUPLICATE_VARIANT_CODE');
    }
    baseKeys.add(item.variantCode);
  }

  const overrideKeys = new Set<string>();
  for (const item of input.overrides) {
    requireCode(item.representativeCode, 'INVALID_PROVIDER_CODE');
    requireCode(item.variantCode, 'INVALID_VARIANT_CODE');
    if (item.priceIrr <= 0n) {
      throw new DomainConflictError('INVALID_PRICE');
    }
    const key = `${item.representativeCode}:${item.variantCode}`;
    if (overrideKeys.has(key)) {
      throw new DomainConflictError('DUPLICATE_VARIANT_CODE');
    }
    overrideKeys.add(key);
  }
}
