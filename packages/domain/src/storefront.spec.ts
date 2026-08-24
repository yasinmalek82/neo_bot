import { describe, expect, it } from 'vitest';

import {
  selectStorefrontEvidenceBadges,
  validateStorefrontDisplayAttributes,
  validateStorefrontCatalogDraft,
  type ReplaceStorefrontCatalogCommand,
} from './storefront.js';

describe('storefront catalog validation', () => {
  it('accepts arbitrary volume, duration and multi-group combinations', () => {
    const command = validCatalog();
    expect(() => validateStorefrontCatalogDraft(command)).not.toThrow();
  });

  it('does not publish an active product without a priced sellable variant', () => {
    const command = validCatalog();
    const variant = command.products[0]?.variants[0];
    expect(variant).toBeDefined();
    const invalid: ReplaceStorefrontCatalogCommand = {
      ...command,
      products: command.products.map((product) => ({
        ...product,
        variants: product.variants.map((current) => ({
          ...current,
          sellable: false,
        })),
      })),
    };
    expect(() => validateStorefrontCatalogDraft(invalid)).toThrow(
      'ACTIVE_PRODUCT_REQUIRES_SELLABLE_VARIANT',
    );
  });

  it('rejects duplicate variant codes across the complete catalog', () => {
    const command = validCatalog();
    const product = command.products[0]!;
    const variant = product.variants[0]!;
    const invalid: ReplaceStorefrontCatalogCommand = {
      ...command,
      products: [{ ...product, variants: [variant, { ...variant }] }],
    };
    expect(() => validateStorefrontCatalogDraft(invalid)).toThrow('DUPLICATE_VARIANT_CODE');
  });

  it('limits normalized display attributes to four ordered label/value pairs', () => {
    expect(() =>
      validateStorefrontDisplayAttributes([
        { position: 0, label: 'پروتکل', value: 'VLESS' },
        { position: 1, label: 'موقعیت', value: 'آلمان' },
        { position: 2, label: 'پشتیبانی', value: '۲۴/۷' },
        { position: 3, label: 'تحویل', value: 'فوری' },
      ]),
    ).not.toThrow();
    expect(() =>
      validateStorefrontDisplayAttributes([
        { position: 0, label: 'الف', value: '۱' },
        { position: 0, label: 'ب', value: '۲' },
      ]),
    ).toThrow('INVALID_DISPLAY_ATTRIBUTES');
  });

  it('assigns factual badges to distinct winners while retaining one highest-priority badge per variant', () => {
    expect(
      selectStorefrontEvidenceBadges([
        { id: 'a', fulfilledSalesLast30Days: 5, effectivePriceIrr: 2_000n, dataLimitBytes: 10n },
        { id: 'b', fulfilledSalesLast30Days: 1, effectivePriceIrr: 1_000n, dataLimitBytes: 20n },
        { id: 'c', fulfilledSalesLast30Days: 2, effectivePriceIrr: 3_000n, dataLimitBytes: 50n },
      ]),
    ).toEqual(
      new Map([
        ['a', { kind: 'popular', label: 'پرفروش' }],
        ['b', { kind: 'value', label: 'کمترین قیمت' }],
        ['c', { kind: 'capacity', label: 'بیشترین حجم' }],
      ]),
    );
  });

  it('keeps only the highest-priority badge when one plan wins multiple metrics', () => {
    expect(
      selectStorefrontEvidenceBadges([
        { id: 'a', fulfilledSalesLast30Days: 5, effectivePriceIrr: 1_000n, dataLimitBytes: 50n },
        { id: 'b', fulfilledSalesLast30Days: 1, effectivePriceIrr: 2_000n, dataLimitBytes: 10n },
      ]),
    ).toEqual(new Map([['a', { kind: 'popular', label: 'پرفروش' }]]));
  });

  it('does not award a badge for ties, including a tie at the highest sales count', () => {
    expect(
      selectStorefrontEvidenceBadges([
        { id: 'a', fulfilledSalesLast30Days: 3, effectivePriceIrr: 1_000n, dataLimitBytes: 10n },
        { id: 'b', fulfilledSalesLast30Days: 3, effectivePriceIrr: 1_000n, dataLimitBytes: 10n },
      ]),
    ).toEqual(new Map());
  });
});

function validCatalog(): ReplaceStorefrontCatalogCommand {
  return {
    settings: {
      brandName: 'نئوبات',
      heroTitle: 'انتخاب سرویس',
      heroSubtitle: '',
      deliveryNote: '',
      supportNote: '',
      volumeHelper: '',
      cardNumber: '0000000000000000',
      cardHolder: 'نام آزمایشی',
    },
    products: [
      {
        code: 'economic-plan',
        name: 'اقتصادی',
        shortName: 'اقتصادی',
        description: '',
        badge: null,
        iconKey: 'globe',
        position: 0,
        active: true,
        category: { code: 'economic', name: 'اقتصادی', description: '', position: 0 },
        variants: [
          {
            code: 'economic-75gb-45d',
            name: '۷۵ گیگ، ۴۵ روزه',
            description: '',
            durationDays: 45,
            durationLabel: '۴۵ روزه',
            dataLimitBytes: 75n * 1024n ** 3n,
            dataLimitLabel: '۷۵ گیگ',
            deviceLimit: 3,
            deviceLabel: 'سه اتصال',
            priceIrr: 1_250_000n,
            position: 0,
            sellable: true,
            providerCode: 'pilot-pasarguard',
            groupIds: [5, 6],
          },
        ],
      },
    ],
  };
}
