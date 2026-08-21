import { describe, expect, it } from 'vitest';

import {
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
