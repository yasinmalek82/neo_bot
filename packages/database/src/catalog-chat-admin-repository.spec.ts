import { describe, expect, it } from 'vitest';

import {
  decodeCatalogAdminWizardState,
  encodeCatalogAdminWizardState,
} from './catalog-chat-admin-repository.js';

describe('catalog chat admin session serialization', () => {
  it('round-trips partial variant bigint fields before review', () => {
    const encoded = encodeCatalogAdminWizardState({
      kind: 'variant',
      step: 'variant-fields',
      field: 'priceIrr',
      values: { code: 'starter-30', dataLimitBytes: 30n * 1024n ** 3n, priceIrr: 1_250_000n },
    });
    const restarted = decodeCatalogAdminWizardState(JSON.parse(JSON.stringify(encoded)));
    expect(restarted).toEqual({
      kind: 'variant',
      step: 'variant-fields',
      field: 'priceIrr',
      values: { code: 'starter-30', dataLimitBytes: 30n * 1024n ** 3n, priceIrr: 1_250_000n },
    });
  });

  it('round-trips a resumable guided changeset including ordered display attributes', () => {
    const encoded = encodeCatalogAdminWizardState({
      kind: 'changeset',
      step: 'guided-fields',
      field: 'displayAttributes',
      values: {
        categoryCode: 'guided-category',
        productCode: 'guided-product',
        variantCode: 'guided-variant',
        dataLimitBytes: 50n * 1024n ** 3n,
        priceIrr: 1_500_000n,
        displayAttributes: [{ position: 0, label: 'پروتکل', value: 'VLESS' }],
      },
    });
    expect(decodeCatalogAdminWizardState(JSON.parse(JSON.stringify(encoded)))).toEqual({
      kind: 'changeset',
      step: 'guided-fields',
      field: 'displayAttributes',
      values: {
        categoryCode: 'guided-category',
        productCode: 'guided-product',
        variantCode: 'guided-variant',
        dataLimitBytes: 50n * 1024n ** 3n,
        priceIrr: 1_500_000n,
        displayAttributes: [{ position: 0, label: 'پروتکل', value: 'VLESS' }],
      },
    });
  });
});
