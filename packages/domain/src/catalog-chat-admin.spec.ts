import { describe, expect, it } from 'vitest';

import {
  catalogVariantLabels,
  parseSafeProviderGroupId,
  parseCatalogAdminWizardState,
  validateCatalogAdminDelta,
} from './catalog-chat-admin.js';

describe('catalog chat administration domain', () => {
  it('generates labels from canonical variant dimensions', () => {
    expect(
      catalogVariantLabels({ dataLimitBytes: 50n * 1024n ** 3n, durationDays: 30, deviceLimit: 1 }),
    ).toEqual({
      dataLimitLabel: '50 گیگ',
      durationLabel: '30 روز',
      deviceLabel: '1 دستگاه',
    });
  });

  it('rejects sellable variants without a price or group', () => {
    expect(() =>
      validateCatalogAdminDelta({
        kind: 'variant',
        code: 'alpha-30',
        productCode: 'alpha',
        name: 'Alpha',
        description: '',
        durationDays: 30,
        dataLimitBytes: 0n,
        deviceLimit: 1,
        priceIrr: 0n,
        position: 0,
        sellable: true,
        providerCode: 'provider',
        groupIds: [],
      }),
    ).toThrow('SELLABLE_VARIANT_REQUIRES_PRICE');
  });

  it('accepts only positive safe provider group identifiers', () => {
    expect(parseSafeProviderGroupId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseSafeProviderGroupId('9007199254740992')).toThrow('INVALID_PROVIDER_GROUP_ID');
    expect(() => parseSafeProviderGroupId('0')).toThrow('INVALID_PROVIDER_GROUP_ID');
    expect(() => parseSafeProviderGroupId('-1')).toThrow('INVALID_PROVIDER_GROUP_ID');
  });

  it('rejects unknown wizard keys before persistence', () => {
    expect(() =>
      parseCatalogAdminWizardState({ kind: 'start', step: 'select-action', extra: true }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
    expect(() =>
      parseCatalogAdminWizardState({ kind: 'category', step: 'wrong', values: {} }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
  });

  it('bounds present partial values while keeping incomplete states valid', () => {
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'variant',
        step: 'variant-fields',
        field: 'durationDays',
        values: {},
      }),
    ).not.toThrow();
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'variant',
        step: 'variant-fields',
        field: 'groupIds',
        values: { groupIds: [1, 1] },
      }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'variant',
        step: 'variant-fields',
        field: 'groupIds',
        values: { groupIds: [Number.MAX_SAFE_INTEGER + 1] },
      }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'category',
        step: 'category-fields',
        field: 'name',
        values: { name: 'x'.repeat(121) },
      }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'variant',
        step: 'variant-fields',
        field: 'durationDays',
        values: { durationDays: 3661 },
      }),
    ).toThrow('INVALID_CATALOG_WIZARD_STATE');
  });

  it('persists a guided changeset attribute draft with ordered safe display rows', () => {
    expect(() =>
      parseCatalogAdminWizardState({
        kind: 'changeset',
        step: 'guided-fields',
        field: 'displayAttributes',
        values: {
          categoryCode: 'guided-category',
          productCode: 'guided-product',
          variantCode: 'guided-variant',
          variantName: 'نمایش آزاد',
          displayAttributes: [
            { position: 0, label: 'پروتکل', value: 'VLESS' },
            { position: 1, label: 'موقعیت', value: 'آلمان' },
          ],
        },
      }),
    ).not.toThrow();
  });
});
