import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { CatalogAdminUseCase } from '@neo-bot/application';
import type { CatalogProductDraft, CatalogVariantDraft } from '@neo-bot/domain';

import { PostgresCatalogRepository } from './catalog-repository.js';
import { migrate } from './migrator.js';
import { createDatabasePool } from './pool.js';

try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error: unknown) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

const databaseUrl = process.env['DATABASE_URL'];
const providerCode = process.env['PILOT_PROVIDER_CODE'] ?? 'pilot-pasarguard';
const groupId = Number(process.env['PILOT_GROUP_ID'] ?? '0');
if (databaseUrl === undefined || !Number.isSafeInteger(groupId) || groupId <= 0) {
  throw new Error('INVALID_CATALOG_SEED_CONFIGURATION');
}

const pool = createDatabasePool({ connectionString: databaseUrl });
try {
  await migrate(pool);
  const catalog = new CatalogAdminUseCase(new PostgresCatalogRepository(pool));
  const products: CatalogProductDraft[] = [
    createProduct({
      code: 'storefront-unlimited-economic',
      name: 'نامحدود اقتصادی',
      description: 'اتصال مستقیم، پایدار و بدون محدودیت حجم',
      categoryCode: 'unlimited-economic',
      categoryName: 'نامحدود اقتصادی',
      iconKey: 'loop',
      position: 0,
      badge: null,
      combinations: [
        [0, 30, 75_000],
        [0, 90, 215_000],
        [0, 180, 405_000],
      ],
    }),
    createProduct({
      code: 'storefront-multi-economic',
      name: 'مولتی‌لوکیشن اقتصادی',
      description: 'چند کشور در یک سرویس، برای آزادی بیشتر',
      categoryCode: 'multi-location-economic',
      categoryName: 'مولتی‌لوکیشن اقتصادی',
      iconKey: 'globe',
      position: 1,
      badge: 'پیشنهاد ما',
      combinations: [
        [50, 30, 95_000],
        [50, 90, 270_000],
        [50, 180, 510_000],
        [100, 30, 155_000],
        [100, 90, 440_000],
        [100, 180, 835_000],
        [200, 30, 265_000],
        [200, 90, 755_000],
        [200, 180, 1_430_000],
      ],
    }),
    createProduct({
      code: 'storefront-multi-special',
      name: 'مولتی‌لوکیشن ویژه',
      description: 'مسیرهای ویژه، سرعت بالاتر و سرور اختصاصی‌تر',
      categoryCode: 'multi-location-premium',
      categoryName: 'مولتی‌لوکیشن ویژه',
      iconKey: 'star',
      position: 2,
      badge: null,
      combinations: [
        [50, 30, 135_000],
        [50, 90, 385_000],
        [50, 180, 730_000],
        [100, 30, 225_000],
        [100, 90, 640_000],
        [100, 180, 1_215_000],
        [200, 30, 385_000],
        [200, 90, 1_095_000],
        [200, 180, 2_080_000],
      ],
    }),
  ];
  await catalog.replaceCatalog({
    settings: {
      brandName: 'نئوبات',
      heroTitle: 'سرویس مناسب خودت را انتخاب کن',
      heroSubtitle: 'سریع، امن و پایدار برای هر نیاز',
      deliveryNote: 'تحویل سریع پس از تأیید پرداخت',
      supportNote: 'پشتیبانی آنلاین',
      volumeHelper: 'حجم انتخابی میان تمام لوکیشن‌های سرویس مشترک است.',
      cardNumber: '0000000000000000',
      cardHolder: 'نام صاحب کارت',
    },
    products,
  });
  process.stdout.write(`Catalog seed completed: ${String(products.length)} products\n`);
} finally {
  await pool.end();
}

function createProduct(input: {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly categoryCode: string;
  readonly categoryName: string;
  readonly iconKey: CatalogProductDraft['iconKey'];
  readonly position: number;
  readonly badge: string | null;
  readonly combinations: readonly (readonly [number, number, number])[];
}): CatalogProductDraft {
  return {
    code: input.code,
    name: input.name,
    shortName: input.name,
    description: input.description,
    badge: input.badge,
    iconKey: input.iconKey,
    position: input.position,
    active: true,
    category: {
      code: input.categoryCode,
      name: input.categoryName,
      description: input.description,
      position: input.position,
    },
    variants: input.combinations.map(([volumeGb, durationDays, priceToman], index) =>
      createVariant(input.code, volumeGb, durationDays, priceToman, index),
    ),
  };
}

function createVariant(
  productCode: string,
  volumeGb: number,
  durationDays: number,
  priceToman: number,
  position: number,
): CatalogVariantDraft {
  const volumeCode = volumeGb === 0 ? 'unlimited' : `${String(volumeGb)}gb`;
  return {
    code: `${productCode}-${volumeCode}-${String(durationDays)}d`,
    name: `${volumeLabel(volumeGb)}، ${durationLabel(durationDays)}`,
    description: volumeDescription(volumeGb),
    durationDays,
    durationLabel: durationLabel(durationDays),
    dataLimitBytes: BigInt(volumeGb) * 1024n ** 3n,
    dataLimitLabel: volumeGb === 0 ? '' : `${persianNumber(volumeGb)} گیگ`,
    deviceLimit: 1,
    deviceLabel: 'یک اتصال',
    priceIrr: BigInt(priceToman) * 10n,
    position,
    sellable: true,
    providerCode,
    groupIds: [groupId],
  };
}

function durationLabel(days: number): string {
  if (days === 30) return 'یک‌ماهه';
  if (days === 90) return 'سه‌ماهه';
  if (days === 180) return 'شش‌ماهه';
  return `${persianNumber(days)} روزه`;
}

function volumeLabel(volumeGb: number): string {
  return volumeGb === 0 ? 'نامحدود' : `${persianNumber(volumeGb)} گیگ`;
}

function volumeDescription(volumeGb: number): string {
  if (volumeGb === 0) return 'بدون محدودیت حجم';
  if (volumeGb <= 50) return 'مصرف سبک';
  if (volumeGb <= 100) return 'مصرف روزمره';
  return 'مصرف سنگین';
}

function persianNumber(value: number): string {
  return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(value);
}
