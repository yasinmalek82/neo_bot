import type { CatalogAdminUseCase } from '@neo-bot/application';
import type { StorefrontCatalog } from '@neo-bot/domain';
import { Controller, Get, Inject } from '@nestjs/common';

import { catalogAdminUseCaseToken } from './catalog.provider.js';

@Controller()
export class CatalogController {
  public constructor(
    @Inject(catalogAdminUseCaseToken)
    private readonly catalog: CatalogAdminUseCase,
  ) {}

  @Get('catalog')
  public async getCatalog() {
    return serializeCatalog(await this.catalog.getPublicCatalog());
  }
}

function serializeCatalog(catalog: StorefrontCatalog) {
  const settings = {
    brandName: catalog.settings.brandName,
    heroTitle: catalog.settings.heroTitle,
    heroSubtitle: catalog.settings.heroSubtitle,
    deliveryNote: catalog.settings.deliveryNote,
    supportNote: catalog.settings.supportNote,
    volumeHelper: catalog.settings.volumeHelper,
  };
  return {
    settings,
    updatedAt: catalog.updatedAt.toISOString(),
    products: catalog.products.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      shortName: product.shortName,
      description: product.description,
      badge: product.badge,
      iconKey: product.iconKey,
      position: product.position,
      active: product.active,
      category: product.category,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        code: variant.code,
        name: variant.name,
        description: variant.description,
        durationDays: variant.durationDays,
        durationLabel: variant.durationLabel,
        dataLimitGb: bytesToGb(variant.dataLimitBytes),
        dataLimitLabel: variant.dataLimitLabel,
        deviceLimit: variant.deviceLimit,
        deviceLabel: variant.deviceLabel,
        priceToman: Number(variant.priceIrr / 10n),
        position: variant.position,
        sellable: variant.sellable,
      })),
    })),
  };
}

function bytesToGb(dataLimitBytes: bigint): number {
  return Number(dataLimitBytes / 1024n ** 3n);
}
