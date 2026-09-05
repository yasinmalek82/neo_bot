import { describe, expect, it, vi } from 'vitest';
import { RepresentativePricingUseCase } from './representative-pricing.js';

describe('RepresentativePricingUseCase', () => {
  it('clears base prices and uses the active representative gate', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const repository = {
      listRepresentatives: vi.fn(),
      findRepresentativeById: vi
        .fn()
        .mockResolvedValue({ id: '4', code: 'rep-4', telegramUserId: 44, active: true }),
      setRepresentativeVariantAccess: vi.fn(),
      setRepresentativeBasePrice: vi.fn(),
      clearRepresentativeBasePrice: clear,
      setRepresentativeOverridePrice: vi.fn(),
      clearRepresentativeOverridePrice: vi.fn(),
    };
    await new RepresentativePricingUseCase(repository).apply({
      operation: 'clear-base-price',
      variantId: '12',
    });
    expect(clear).toHaveBeenCalledWith({ variantId: '12' });
  });

  it('rejects inactive representatives before mutation', async () => {
    const setAccess = vi.fn();
    const repository = {
      listRepresentatives: vi.fn(),
      findRepresentativeById: vi
        .fn()
        .mockResolvedValue({ id: '4', code: 'rep-4', telegramUserId: 44, active: false }),
      setRepresentativeVariantAccess: setAccess,
      setRepresentativeBasePrice: vi.fn(),
      clearRepresentativeBasePrice: vi.fn(),
      setRepresentativeOverridePrice: vi.fn(),
      clearRepresentativeOverridePrice: vi.fn(),
    };
    await expect(
      new RepresentativePricingUseCase(repository).apply({
        operation: 'grant-access',
        representativeId: '4',
        variantId: '12',
      }),
    ).rejects.toThrow('REPRESENTATIVE_INACTIVE');
    expect(setAccess).not.toHaveBeenCalled();
  });
});
