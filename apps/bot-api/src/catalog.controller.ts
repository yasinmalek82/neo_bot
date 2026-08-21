import { timingSafeEqual } from 'node:crypto';

import type { CatalogAdminUseCase } from '@neo-bot/application';
import {
  DomainConflictError,
  type ReplaceStorefrontCatalogCommand,
  type StorefrontCatalog,
} from '@neo-bot/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Put,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';

import { catalogAdminUseCaseToken } from './catalog.provider.js';
import { loadAdminApiConfig, loadTelegramConfig } from './config.js';
import { verifyTelegramInitData } from './telegram-init-data.js';

const codeSchema = z.string().regex(/^[a-z0-9-]{3,80}$/u);
const labelSchema = z.string().max(500);
const variantSchema = z
  .object({
    code: codeSchema,
    name: z.string().min(1).max(120),
    description: labelSchema.default(''),
    durationDays: z.number().int().min(1).max(3660),
    durationLabel: z.string().max(80).default(''),
    dataLimitGb: z.number().int().min(0).max(1_000_000),
    dataLimitLabel: z.string().max(80).default(''),
    deviceLimit: z.number().int().min(0).max(100),
    deviceLabel: z.string().max(80).default(''),
    priceToman: z.number().int().min(0).max(9_000_000_000_000),
    position: z.number().int().min(-10_000).max(10_000).default(0),
    sellable: z.boolean().default(true),
    providerCode: codeSchema,
    groupIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

const productSchema = z
  .object({
    code: codeSchema,
    name: z.string().min(1).max(120),
    shortName: z.string().max(120).default(''),
    description: labelSchema.default(''),
    badge: z.string().min(1).max(40).nullable().default(null),
    iconKey: z.enum(['loop', 'globe', 'star', 'bolt']),
    position: z.number().int().min(-10_000).max(10_000).default(0),
    active: z.boolean().default(true),
    category: z
      .object({
        code: codeSchema,
        name: z.string().min(1).max(120),
        description: labelSchema.default(''),
        position: z.number().int().min(-10_000).max(10_000).default(0),
      })
      .strict(),
    variants: z.array(variantSchema).max(1000),
  })
  .strict();

const catalogSchema = z
  .object({
    settings: z
      .object({
        brandName: z.string().min(1).max(80),
        heroTitle: z.string().min(1).max(160),
        heroSubtitle: z.string().max(240).default(''),
        deliveryNote: z.string().max(160).default(''),
        supportNote: z.string().max(160).default(''),
        volumeHelper: z.string().max(240).default(''),
        cardNumber: z.string().regex(/^\d{16}$/u),
        cardHolder: z.string().min(2).max(120),
      })
      .strict(),
    products: z.array(productSchema).max(100),
  })
  .strict();

@Controller()
export class CatalogController {
  public constructor(
    @Inject(catalogAdminUseCaseToken)
    private readonly catalog: CatalogAdminUseCase,
  ) {}

  @Get('catalog')
  public async getCatalog() {
    return serializeCatalog(await this.catalog.getPublicCatalog(), false);
  }

  @Get('admin/catalog')
  public async getAdminCatalog(
    @Headers('authorization') authorization?: string,
    @Headers('x-telegram-init-data') initData?: string,
  ) {
    requireCatalogAdmin(authorization, initData);
    return serializeCatalog(await this.catalog.getAdminCatalog(), true);
  }

  @Get('admin/provider-groups')
  public async getProviderGroups(
    @Headers('authorization') authorization?: string,
    @Headers('x-telegram-init-data') initData?: string,
  ) {
    requireCatalogAdmin(authorization, initData);
    return { groups: await this.catalog.listProviderGroups() };
  }

  @Put('admin/catalog')
  public async replaceCatalog(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Body() body: unknown,
  ) {
    requireCatalogAdmin(authorization, initData);
    const parsed = catalogSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('INVALID_CATALOG_PAYLOAD');
    try {
      const command: ReplaceStorefrontCatalogCommand = {
        settings: parsed.data.settings,
        products: parsed.data.products.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => ({
            ...variant,
            dataLimitBytes: BigInt(variant.dataLimitGb) * 1024n ** 3n,
            priceIrr: BigInt(variant.priceToman) * 10n,
          })),
        })),
      };
      return serializeCatalog(await this.catalog.replaceCatalog(command), true);
    } catch (error: unknown) {
      if (error instanceof DomainConflictError) throw new ConflictException(error.code);
      throw error;
    }
  }
}

function requireCatalogAdmin(authorization?: string, initData?: string): void {
  if (process.env['NODE_ENV'] !== 'production') {
    requireBearerAuthorization(authorization);
    return;
  }
  const telegram = loadTelegramConfig();
  if (!telegram.enabled) {
    throw new ServiceUnavailableException('ADMIN_API_DISABLED');
  }
  if (initData === undefined || initData.length === 0) {
    throw new UnauthorizedException('INIT_DATA_REQUIRED');
  }
  try {
    const user = verifyTelegramInitData(initData, telegram.botToken);
    if (!telegram.adminTelegramUserIds.has(String(user.id))) {
      throw new UnauthorizedException('ADMIN_AUTH_INVALID');
    }
  } catch (error: unknown) {
    if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) {
      throw error;
    }
    if (error instanceof DomainConflictError) {
      throw new UnauthorizedException(error.code);
    }
    throw error;
  }
}

function requireBearerAuthorization(authorization?: string): void {
  const configuredToken = loadAdminApiConfig().token;
  if (configuredToken === null) {
    throw new ServiceUnavailableException('ADMIN_API_DISABLED');
  }
  const suppliedToken = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/u)?.[1];
  if (suppliedToken === undefined) throw new UnauthorizedException('ADMIN_AUTH_REQUIRED');
  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new UnauthorizedException('ADMIN_AUTH_INVALID');
  }
}

function serializeCatalog(catalog: StorefrontCatalog, includeAdminFields: boolean) {
  const settings = includeAdminFields
    ? catalog.settings
    : {
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
        dataLimitGb: Number(variant.dataLimitBytes / 1024n ** 3n),
        dataLimitLabel: variant.dataLimitLabel,
        deviceLimit: variant.deviceLimit,
        deviceLabel: variant.deviceLabel,
        priceToman: Number(variant.priceIrr / 10n),
        position: variant.position,
        sellable: variant.sellable,
        ...(includeAdminFields
          ? { providerCode: variant.providerCode, groupIds: variant.groupIds }
          : {}),
      })),
    })),
  };
}
