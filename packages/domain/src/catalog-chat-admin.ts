import { DomainConflictError } from './errors.js';
import {
  validateStorefrontCatalogDraft,
  validateStorefrontDisplayAttributes,
  type StorefrontDisplayAttribute,
  type StorefrontIconKey,
  type StorefrontSettings,
} from './storefront.js';

export type CatalogAdminMutableDelta =
  | {
      readonly kind: 'category';
      readonly code: string;
      readonly name: string;
      readonly description: string;
      readonly position: number;
    }
  | {
      readonly kind: 'product';
      readonly code: string;
      readonly categoryCode: string;
      readonly name: string;
      readonly shortName: string;
      readonly description: string;
      readonly badge: string | null;
      readonly iconKey: StorefrontIconKey;
      readonly position: number;
      readonly active: boolean;
    }
  | {
      readonly kind: 'variant';
      readonly code: string;
      readonly productCode: string;
      readonly name: string;
      readonly description: string;
      readonly durationDays: number;
      readonly dataLimitBytes: bigint;
      readonly deviceLimit: number;
      readonly priceIrr: bigint;
      readonly position: number;
      readonly sellable: boolean;
      readonly providerCode: string;
      readonly groupIds: readonly number[];
      readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
    };

export type CatalogAdminChangesetChanges = readonly [
  Extract<CatalogAdminMutableDelta, { readonly kind: 'category' }>,
  Extract<CatalogAdminMutableDelta, { readonly kind: 'product' }>,
  Extract<CatalogAdminMutableDelta, { readonly kind: 'variant' }>,
];

export type CatalogAdminDelta =
  | { readonly kind: 'settings'; readonly settings: StorefrontSettings }
  | CatalogAdminMutableDelta
  | {
      readonly kind: 'archive' | 'restore';
      readonly entity: 'category' | 'product' | 'variant';
      readonly code: string;
    }
  | {
      readonly kind: 'reorder';
      readonly entity: 'category' | 'product' | 'variant';
      readonly code: string;
      readonly direction: 'up' | 'down';
    }
  | {
      readonly kind: 'changeset';
      readonly changes: CatalogAdminChangesetChanges;
    };

export type CatalogAdminWizardState =
  | { readonly kind: 'start'; readonly step: 'select-action' }
  | {
      readonly kind: 'settings';
      readonly step: 'settings-fields';
      readonly field: keyof CatalogSettingsPartial;
      readonly values: CatalogSettingsPartial;
    }
  | {
      readonly kind: 'category';
      readonly step: 'category-fields';
      readonly field: keyof CatalogCategoryPartial | 'select';
      readonly values: CatalogCategoryPartial;
      readonly mode?: 'edit';
    }
  | {
      readonly kind: 'product';
      readonly step: 'product-fields';
      readonly field: keyof CatalogProductPartial | 'select';
      readonly values: CatalogProductPartial;
      readonly mode?: 'edit';
    }
  | {
      readonly kind: 'variant';
      readonly step: 'variant-fields';
      readonly field: keyof CatalogVariantPartial | 'select';
      readonly values: CatalogVariantPartial;
      readonly mode?: 'edit';
    }
  | {
      readonly kind: 'changeset';
      readonly step: 'guided-fields';
      readonly field:
        | 'categoryName'
        | 'productName'
        | 'variantSpec'
        | 'variantName'
        | 'variantDescription'
        | 'displayAttributes'
        | 'groupIds';
      readonly values: CatalogChangesetPartial;
    }
  | {
      readonly kind: 'archive';
      readonly step: 'target';
      readonly field: keyof CatalogTargetPartial;
      readonly values: CatalogTargetPartial;
    }
  | {
      readonly kind: 'restore';
      readonly step: 'target';
      readonly field: keyof CatalogTargetPartial;
      readonly values: CatalogTargetPartial;
    }
  | { readonly kind: 'review'; readonly step: 'confirm'; readonly delta: CatalogAdminDelta };

export interface CatalogSettingsPartial {
  readonly brandName?: string;
  readonly heroTitle?: string;
  readonly heroSubtitle?: string;
  readonly deliveryNote?: string;
  readonly supportNote?: string;
  readonly volumeHelper?: string;
  readonly cardNumber?: string;
  readonly cardHolder?: string;
}
export interface CatalogCategoryPartial {
  readonly code?: string;
  readonly name?: string;
  readonly description?: string;
  readonly position?: number;
}
export interface CatalogProductPartial {
  readonly code?: string;
  readonly categoryCode?: string;
  readonly name?: string;
  readonly shortName?: string;
  readonly description?: string;
  readonly badge?: string | null;
  readonly iconKey?: StorefrontIconKey;
  readonly position?: number;
  readonly active?: boolean;
}
export interface CatalogVariantPartial {
  readonly code?: string;
  readonly productCode?: string;
  readonly name?: string;
  readonly description?: string;
  readonly durationDays?: number;
  readonly dataLimitBytes?: bigint;
  readonly deviceLimit?: number;
  readonly priceIrr?: bigint;
  readonly position?: number;
  readonly sellable?: boolean;
  readonly providerCode?: string;
  readonly groupIds?: readonly number[];
  readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
}
export interface CatalogChangesetPartial {
  readonly categoryCode?: string;
  readonly categoryName?: string;
  readonly productCode?: string;
  readonly productName?: string;
  readonly variantCode?: string;
  readonly variantName?: string;
  readonly variantDescription?: string;
  readonly displayAttributes?: readonly StorefrontDisplayAttribute[];
  readonly dataLimitBytes?: bigint;
  readonly durationDays?: number;
  readonly deviceLimit?: number;
  readonly priceIrr?: bigint;
  readonly providerCode?: string;
  readonly groupIds?: readonly number[];
}
export interface CatalogTargetPartial {
  readonly entity?: 'category' | 'product' | 'variant';
  readonly code?: string;
}

export interface CatalogAdminCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly position: number;
  readonly active: boolean;
}

export interface CatalogAdminProductRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly shortName: string;
  readonly badge: string | null;
  readonly iconKey: StorefrontIconKey;
  readonly position: number;
  readonly categoryId: string;
  readonly categoryCode: string;
  readonly active: boolean;
}
export interface CatalogAdminVariantRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
  readonly priceIrr: bigint;
  readonly position: number;
  readonly productId: string;
  readonly productCode: string;
  readonly active: boolean;
  readonly sellable: boolean;
  readonly providerCode: string | null;
  readonly groupIds: readonly number[];
  readonly displayAttributes: readonly StorefrontDisplayAttribute[];
}
export interface CatalogAdminReadModel {
  readonly categories: readonly CatalogAdminCategory[];
  readonly products: readonly CatalogAdminProductRow[];
  readonly variants: readonly CatalogAdminVariantRow[];
}

export interface CatalogAdminSession {
  readonly id: string;
  readonly adminTelegramUserId: string;
  readonly baseRevision: number;
  readonly state: CatalogAdminWizardState;
  readonly status: 'pending' | 'canceled' | 'published' | 'expired';
  readonly expiresAt: Date;
  readonly publishedResult: CatalogAdminPublicationResult | null;
}

export interface CatalogAdminPublicationResult {
  readonly revision: number;
  readonly delta: CatalogAdminDelta;
}

export function parseSafeProviderGroupId(value: string): number {
  if (!/^\d+$/u.test(value)) throw new DomainConflictError('INVALID_PROVIDER_GROUP_ID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new DomainConflictError('INVALID_PROVIDER_GROUP_ID');
  return parsed;
}

export function parseCatalogAdminWizardState(value: unknown): CatalogAdminWizardState {
  const state = requireRecord(value, 'INVALID_CATALOG_WIZARD_STATE');
  const kind = state['kind'];
  const step = state['step'];
  if (kind === 'start' && step === 'select-action') {
    requireExactKeys(state, ['kind', 'step']);
    return { kind, step };
  }
  if (kind === 'review' && step === 'confirm') {
    requireExactKeys(state, ['kind', 'step', 'delta']);
    return { kind, step, delta: parseCatalogAdminDelta(state['delta']) };
  }
  if ((kind === 'archive' || kind === 'restore') && step === 'target') {
    requireExactKeys(state, ['kind', 'step', 'field', 'values']);
    if (state['field'] !== 'entity' && state['field'] !== 'code')
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return { kind, step, field: state['field'], values: parseTargetPartial(state['values']) };
  }
  if (kind === 'settings' && step === 'settings-fields') {
    requireExactKeys(state, ['kind', 'step', 'field', 'values']);
    if (
      ![
        'brandName',
        'heroTitle',
        'heroSubtitle',
        'deliveryNote',
        'supportNote',
        'volumeHelper',
        'cardNumber',
        'cardHolder',
      ].includes(state['field'] as string)
    )
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return {
      kind,
      step,
      field: state['field'] as keyof CatalogSettingsPartial,
      values: parsePartial(
        state['values'],
        [
          'brandName',
          'heroTitle',
          'heroSubtitle',
          'deliveryNote',
          'supportNote',
          'volumeHelper',
          'cardNumber',
          'cardHolder',
        ],
        validSettingsField,
      ),
    };
  }
  if (kind === 'category' && step === 'category-fields') {
    requireWizardKeys(state, ['kind', 'step', 'field', 'values']);
    if (!['select', 'code', 'name', 'description', 'position'].includes(state['field'] as string))
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return {
      kind,
      step,
      field: state['field'] as keyof CatalogCategoryPartial | 'select',
      values: parsePartial(
        state['values'],
        ['code', 'name', 'description', 'position'],
        validCategoryField,
      ),
      ...(state['mode'] === 'edit' ? { mode: 'edit' as const } : {}),
    };
  }
  if (kind === 'product' && step === 'product-fields') {
    requireWizardKeys(state, ['kind', 'step', 'field', 'values']);
    if (
      ![
        'select',
        'code',
        'categoryCode',
        'name',
        'shortName',
        'description',
        'badge',
        'iconKey',
        'position',
        'active',
      ].includes(state['field'] as string)
    )
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return {
      kind,
      step,
      field: state['field'] as keyof CatalogProductPartial | 'select',
      values: parsePartial(
        state['values'],
        [
          'code',
          'categoryCode',
          'name',
          'shortName',
          'description',
          'badge',
          'iconKey',
          'position',
          'active',
        ],
        validProductField,
      ),
      ...(state['mode'] === 'edit' ? { mode: 'edit' as const } : {}),
    };
  }
  if (kind === 'variant' && step === 'variant-fields') {
    requireWizardKeys(state, ['kind', 'step', 'field', 'values']);
    if (
      ![
        'select',
        'code',
        'productCode',
        'name',
        'description',
        'durationDays',
        'dataLimitBytes',
        'deviceLimit',
        'priceIrr',
        'position',
        'sellable',
        'providerCode',
        'groupIds',
        'displayAttributes',
      ].includes(state['field'] as string)
    )
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return {
      kind,
      step,
      field: state['field'] as keyof CatalogVariantPartial | 'select',
      values: parsePartial(
        state['values'],
        [
          'code',
          'productCode',
          'name',
          'description',
          'durationDays',
          'dataLimitBytes',
          'deviceLimit',
          'priceIrr',
          'position',
          'sellable',
          'providerCode',
          'groupIds',
          'displayAttributes',
        ],
        validVariantField,
      ),
      ...(state['mode'] === 'edit' ? { mode: 'edit' as const } : {}),
    };
  }
  if (kind === 'changeset' && step === 'guided-fields') {
    requireExactKeys(state, ['kind', 'step', 'field', 'values']);
    if (
      ![
        'categoryName',
        'productName',
        'variantSpec',
        'variantName',
        'variantDescription',
        'displayAttributes',
        'groupIds',
      ].includes(state['field'] as string)
    )
      throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
    return {
      kind,
      step,
      field: state['field'] as CatalogAdminWizardState extends {
        readonly kind: 'changeset';
        readonly field: infer Field;
      }
        ? Field
        : never,
      values: parsePartial(
        state['values'],
        [
          'categoryCode',
          'categoryName',
          'productCode',
          'productName',
          'variantCode',
          'variantName',
          'variantDescription',
          'displayAttributes',
          'dataLimitBytes',
          'durationDays',
          'deviceLimit',
          'priceIrr',
          'providerCode',
          'groupIds',
        ],
        validChangesetField,
      ),
    };
  }
  throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
}

export function parseCatalogAdminDelta(value: unknown): CatalogAdminDelta {
  const delta = requireRecord(value, 'INVALID_CATALOG_DELTA');
  const kind = delta['kind'];
  if (kind === 'settings') {
    requireExactKeys(delta, ['kind', 'settings']);
    const settings = requireRecord(delta['settings'], 'INVALID_CATALOG_DELTA');
    requireExactKeys(settings, [
      'brandName',
      'heroTitle',
      'heroSubtitle',
      'deliveryNote',
      'supportNote',
      'volumeHelper',
      'cardNumber',
      'cardHolder',
    ]);
    if (!Object.values(settings).every((item) => typeof item === 'string'))
      throw new DomainConflictError('INVALID_CATALOG_DELTA');
    const parsed = { kind, settings: settings as unknown as StorefrontSettings } as const;
    validateCatalogAdminDelta(parsed);
    return parsed;
  }
  if (kind === 'category')
    return parseDelta(
      delta,
      ['kind', 'code', 'name', 'description', 'position'],
      (item) =>
        typeof item['code'] === 'string' &&
        typeof item['name'] === 'string' &&
        typeof item['description'] === 'string' &&
        Number.isInteger(item['position']),
    );
  if (kind === 'product')
    return parseDelta(
      delta,
      [
        'kind',
        'code',
        'categoryCode',
        'name',
        'shortName',
        'description',
        'badge',
        'iconKey',
        'position',
        'active',
      ],
      (item) =>
        typeof item['code'] === 'string' &&
        typeof item['categoryCode'] === 'string' &&
        typeof item['name'] === 'string' &&
        typeof item['shortName'] === 'string' &&
        typeof item['description'] === 'string' &&
        (item['badge'] === null || typeof item['badge'] === 'string') &&
        typeof item['iconKey'] === 'string' &&
        Number.isInteger(item['position']) &&
        typeof item['active'] === 'boolean',
    );
  if (kind === 'variant')
    return parseDelta(
      delta,
      delta['displayAttributes'] === undefined
        ? [
            'kind',
            'code',
            'productCode',
            'name',
            'description',
            'durationDays',
            'dataLimitBytes',
            'deviceLimit',
            'priceIrr',
            'position',
            'sellable',
            'providerCode',
            'groupIds',
          ]
        : [
            'kind',
            'code',
            'productCode',
            'name',
            'description',
            'durationDays',
            'dataLimitBytes',
            'deviceLimit',
            'priceIrr',
            'position',
            'sellable',
            'providerCode',
            'groupIds',
            'displayAttributes',
          ],
      (item) =>
        typeof item['code'] === 'string' &&
        typeof item['productCode'] === 'string' &&
        typeof item['name'] === 'string' &&
        typeof item['description'] === 'string' &&
        Number.isInteger(item['durationDays']) &&
        typeof item['dataLimitBytes'] === 'bigint' &&
        Number.isInteger(item['deviceLimit']) &&
        typeof item['priceIrr'] === 'bigint' &&
        Number.isInteger(item['position']) &&
        typeof item['sellable'] === 'boolean' &&
        typeof item['providerCode'] === 'string' &&
        Array.isArray(item['groupIds']) &&
        item['groupIds'].every((groupId) => Number.isSafeInteger(groupId) && groupId > 0) &&
        (item['displayAttributes'] === undefined ||
          validDisplayAttributes(item['displayAttributes'])),
    );
  if (kind === 'archive' || kind === 'restore')
    return parseDelta(
      delta,
      ['kind', 'entity', 'code'],
      (item) => typeof item['entity'] === 'string' && typeof item['code'] === 'string',
    );
  if (kind === 'reorder')
    return parseDelta(
      delta,
      ['kind', 'entity', 'code', 'direction'],
      (item) =>
        (item['entity'] === 'category' ||
          item['entity'] === 'product' ||
          item['entity'] === 'variant') &&
        typeof item['code'] === 'string' &&
        (item['direction'] === 'up' || item['direction'] === 'down'),
    );
  if (kind === 'changeset') {
    requireExactKeys(delta, ['kind', 'changes']);
    if (!Array.isArray(delta['changes']) || delta['changes'].length !== 3)
      throw new DomainConflictError('INVALID_CATALOG_DELTA');
    const changes = delta['changes'].map(parseCatalogAdminDelta);
    if (
      changes[0]?.kind !== 'category' ||
      changes[1]?.kind !== 'product' ||
      changes[2]?.kind !== 'variant'
    )
      throw new DomainConflictError('INVALID_CATALOG_DELTA');
    const parsed = { kind, changes: changes as unknown as CatalogAdminChangesetChanges } as const;
    validateCatalogAdminDelta(parsed);
    return parsed;
  }
  throw new DomainConflictError('INVALID_CATALOG_DELTA');
}

export function catalogVariantLabels(input: {
  readonly dataLimitBytes: bigint;
  readonly durationDays: number;
  readonly deviceLimit: number;
}): {
  readonly dataLimitLabel: string;
  readonly durationLabel: string;
  readonly deviceLabel: string;
} {
  const gib = 1024n ** 3n;
  const mib = 1024n ** 2n;
  const dataLimitLabel =
    input.dataLimitBytes === 0n
      ? 'نامحدود'
      : input.dataLimitBytes % gib === 0n
        ? `${String(input.dataLimitBytes / gib)} گیگ`
        : input.dataLimitBytes % mib === 0n
          ? `${String(input.dataLimitBytes / mib)} مگ`
          : `${String(input.dataLimitBytes)} بایت`;
  return {
    dataLimitLabel,
    durationLabel: `${String(input.durationDays)} روز`,
    deviceLabel: input.deviceLimit === 0 ? 'نامحدود' : `${String(input.deviceLimit)} دستگاه`,
  };
}

export function validateCatalogAdminDelta(delta: CatalogAdminDelta): void {
  if (delta.kind === 'changeset') {
    const [category, product, variant] = delta.changes;
    validateCatalogAdminDelta(category);
    validateCatalogAdminDelta(product);
    validateCatalogAdminDelta(variant);
    if (product.categoryCode !== category.code || variant.productCode !== product.code)
      throw new DomainConflictError('INVALID_CATALOG_CHANGESET');
    return;
  }
  if (delta.kind === 'settings') {
    validateStorefrontCatalogDraft({ settings: delta.settings, products: [] });
    return;
  }
  requireCode(delta.code);
  if (delta.kind === 'archive' || delta.kind === 'restore' || delta.kind === 'reorder') return;
  if (!('name' in delta)) return;
  requireText(delta.name, 1, 120);
  if (delta.kind === 'category') {
    requireText(delta.description, 0, 500);
    requirePosition(delta.position);
    return;
  }
  if (delta.kind === 'product') {
    requireCode(delta.categoryCode);
    requireText(delta.shortName, 0, 120);
    requireText(delta.description, 0, 500);
    if (delta.badge !== null) requireText(delta.badge, 1, 40);
    requirePosition(delta.position);
    return;
  }
  requireCode(delta.productCode);
  requireText(delta.description, 0, 500);
  requirePosition(delta.position);
  if (
    !Number.isInteger(delta.durationDays) ||
    delta.durationDays < 1 ||
    delta.durationDays > 3660
  ) {
    throw new DomainConflictError('INVALID_DURATION');
  }
  if (delta.dataLimitBytes < 0n) throw new DomainConflictError('INVALID_DATA_LIMIT');
  if (!Number.isInteger(delta.deviceLimit) || delta.deviceLimit < 0 || delta.deviceLimit > 100) {
    throw new DomainConflictError('INVALID_DEVICE_LIMIT');
  }
  if (delta.priceIrr < 0n) throw new DomainConflictError('INVALID_PRICE');
  if (delta.sellable && delta.priceIrr <= 0n)
    throw new DomainConflictError('SELLABLE_VARIANT_REQUIRES_PRICE');
  requireCode(delta.providerCode);
  if (delta.groupIds.length === 0 || new Set(delta.groupIds).size !== delta.groupIds.length) {
    throw new DomainConflictError('INVALID_GROUPS');
  }
  if (delta.groupIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new DomainConflictError('INVALID_GROUPS');
  }
  validateStorefrontDisplayAttributes(delta.displayAttributes ?? []);
}

function requireCode(value: string): void {
  if (!/^[a-z0-9-]{3,80}$/u.test(value)) throw new DomainConflictError('INVALID_CATALOG_CODE');
}
function requireText(value: string, min: number, max: number): void {
  const length = value.trim().length;
  if (length < min || length > max) throw new DomainConflictError('INVALID_CATALOG_TEXT');
}
function requirePosition(value: number): void {
  if (!Number.isInteger(value) || value < -10_000 || value > 10_000) {
    throw new DomainConflictError('INVALID_POSITION');
  }
}
function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DomainConflictError(code);
  return value as Record<string, unknown>;
}
function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
  }
}
function requireWizardKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = [...keys, 'mode'];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    keys.some((key) => !(key in value)) ||
    (value['mode'] !== undefined && value['mode'] !== 'edit')
  ) {
    throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
  }
}
function validSettingsField(field: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const limits: Record<string, readonly [number, number]> = {
    brandName: [1, 80],
    heroTitle: [1, 160],
    heroSubtitle: [0, 240],
    deliveryNote: [0, 160],
    supportNote: [0, 160],
    volumeHelper: [0, 240],
    cardHolder: [2, 120],
  };
  if (field === 'cardNumber') return /^\d{16}$/u.test(value);
  const limit = limits[field];
  return limit !== undefined && textWithin(value, limit[0], limit[1]);
}
function validCategoryField(field: string, value: unknown): boolean {
  if (field === 'code') return typeof value === 'string' && validCode(value);
  if (field === 'name') return typeof value === 'string' && textWithin(value, 1, 120);
  if (field === 'description') return typeof value === 'string' && textWithin(value, 0, 500);
  return field === 'position' && validPosition(value);
}
function validProductField(field: string, value: unknown): boolean {
  if (field === 'code' || field === 'categoryCode')
    return typeof value === 'string' && validCode(value);
  if (field === 'name') return typeof value === 'string' && textWithin(value, 1, 120);
  if (field === 'shortName') return typeof value === 'string' && textWithin(value, 0, 120);
  if (field === 'description') return typeof value === 'string' && textWithin(value, 0, 500);
  if (field === 'badge')
    return value === null || (typeof value === 'string' && textWithin(value, 1, 40));
  if (field === 'iconKey')
    return value === 'loop' || value === 'globe' || value === 'star' || value === 'bolt';
  if (field === 'position') return validPosition(value);
  return field === 'active' && typeof value === 'boolean';
}
function validVariantField(field: string, value: unknown): boolean {
  if (field === 'code' || field === 'productCode' || field === 'providerCode')
    return typeof value === 'string' && validCode(value);
  if (field === 'name') return typeof value === 'string' && textWithin(value, 1, 120);
  if (field === 'description') return typeof value === 'string' && textWithin(value, 0, 500);
  if (field === 'durationDays')
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3660;
  if (field === 'dataLimitBytes' || field === 'priceIrr')
    return typeof value === 'bigint' && value >= 0n;
  if (field === 'deviceLimit')
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
  if (field === 'position') return validPosition(value);
  if (field === 'sellable') return typeof value === 'boolean';
  if (field === 'displayAttributes') return validDisplayAttributes(value);
  return field === 'groupIds' && validGroupIds(value);
}
function validChangesetField(field: string, value: unknown): boolean {
  if (field === 'categoryCode' || field === 'productCode' || field === 'variantCode')
    return typeof value === 'string' && validCode(value);
  if (field === 'categoryName' || field === 'productName')
    return typeof value === 'string' && textWithin(value, 1, 120);
  if (field === 'variantName') return typeof value === 'string' && textWithin(value, 0, 120);
  if (field === 'variantDescription') return typeof value === 'string' && textWithin(value, 0, 500);
  if (field === 'displayAttributes') return validDisplayAttributes(value);
  if (field === 'dataLimitBytes' || field === 'priceIrr')
    return typeof value === 'bigint' && value >= 0n;
  if (field === 'durationDays')
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3660;
  if (field === 'deviceLimit')
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
  if (field === 'providerCode') return typeof value === 'string' && validCode(value);
  return field === 'groupIds' && validGroupIds(value);
}

function validDisplayAttributes(value: unknown): value is readonly StorefrontDisplayAttribute[] {
  if (!Array.isArray(value)) return false;
  try {
    validateStorefrontDisplayAttributes(value as readonly StorefrontDisplayAttribute[]);
    return true;
  } catch {
    return false;
  }
}
function validGroupIds(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((id) => Number.isSafeInteger(id) && id > 0) &&
    new Set(value).size === value.length
  );
}
function textWithin(value: string, min: number, max: number): boolean {
  const length = value.trim().length;
  return length >= min && length <= max;
}
function validCode(value: string): boolean {
  return /^[a-z0-9-]{3,80}$/u.test(value);
}
function validPosition(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= -10_000 && (value as number) <= 10_000;
}
function parsePartial(
  value: unknown,
  keys: readonly string[],
  valid: (field: string, value: unknown) => boolean,
): Record<string, unknown> {
  const partial = requireRecord(value, 'INVALID_CATALOG_WIZARD_STATE');
  if (Object.keys(partial).some((key) => !keys.includes(key) || !valid(key, partial[key])))
    throw new DomainConflictError('INVALID_CATALOG_WIZARD_STATE');
  return partial;
}
function parseTargetPartial(value: unknown): CatalogTargetPartial {
  const partial = parsePartial(value, ['entity', 'code'], (field, item) =>
    field === 'entity'
      ? item === 'category' || item === 'product' || item === 'variant'
      : typeof item === 'string' && validCode(item),
  );
  return partial;
}
function parseDelta(
  value: Record<string, unknown>,
  keys: readonly string[],
  valid: (value: Record<string, unknown>) => boolean,
): CatalogAdminDelta {
  requireExactKeys(value, keys);
  if (!valid(value)) throw new DomainConflictError('INVALID_CATALOG_DELTA');
  const parsed = value as unknown as CatalogAdminDelta;
  validateCatalogAdminDelta(parsed);
  return parsed;
}
