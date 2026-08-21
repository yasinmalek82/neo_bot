import type { CatalogAdminUseCase } from '@neo-bot/application';
import type { StorefrontCatalog } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import { CatalogController } from './catalog.controller.js';

const catalog: StorefrontCatalog = {
  settings: {
    brandName: 'نئو',
    heroTitle: 'عنوان',
    heroSubtitle: '',
    deliveryNote: '',
    supportNote: '',
    volumeHelper: '',
    cardNumber: '0000000000000000',
    cardHolder: 'صاحب کارت',
  },
  products: [],
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
};

describe('CatalogController', () => {
  it('redacts card details from the public catalog payload', async () => {
    const useCase = {
      getPublicCatalog: vi.fn().mockResolvedValue(catalog),
      getAdminCatalog: vi.fn().mockResolvedValue(catalog),
    } as unknown as CatalogAdminUseCase;
    const controller = new CatalogController(useCase);
    const body = await controller.getCatalog();
    expect(body.settings).not.toHaveProperty('cardNumber');
    expect(body.settings).not.toHaveProperty('cardHolder');
    expect(body.settings).toMatchObject({ brandName: 'نئو', heroTitle: 'عنوان' });
    expect(JSON.stringify(body)).not.toContain('0000000000000000');
  });

  it('does not accept a bearer token when NODE_ENV is production', async () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const useCase = {
      getAdminCatalog: vi.fn(),
    } as unknown as CatalogAdminUseCase;
    const controller = new CatalogController(useCase);
    try {
      await expect(
        controller.getAdminCatalog('Bearer neo-local-catalog-admin-2026-test-only'),
      ).rejects.toThrow('ADMIN_API_DISABLED');
      expect(useCase.getAdminCatalog).not.toHaveBeenCalled();
    } finally {
      process.env['NODE_ENV'] = previous;
    }
  });
});
