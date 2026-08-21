import { describe, expect, it } from 'vitest';

import { validateDirectProductVariant } from './catalog.js';

const validVariant = {
  id: '1',
  code: 'direct-30d',
  name: 'Direct 30 days',
  durationDays: 30,
  dataLimitBytes: 0n,
  deviceLimit: 1,
  providerInstanceId: '1',
  groupIds: [7],
  active: true,
} as const;

describe('validateDirectProductVariant', () => {
  it('accepts an unlimited direct product mapped to one group', () => {
    expect(() => validateDirectProductVariant(validVariant)).not.toThrow();
  });

  it('rejects duplicate group assignments', () => {
    expect(() => validateDirectProductVariant({ ...validVariant, groupIds: [7, 7] })).toThrow(
      'INVALID_GROUPS',
    );
  });

  it('rejects inactive variants', () => {
    expect(() => validateDirectProductVariant({ ...validVariant, active: false })).toThrow(
      'PRODUCT_INACTIVE',
    );
  });
});
