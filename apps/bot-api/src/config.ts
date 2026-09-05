import { z } from 'zod';
import type { ProvisioningMode } from '@neo-bot/application';

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const httpEnvironmentSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  WEB_ORIGINS: z.string().default('http://127.0.0.1:4173'),
});

const telegramEnvironmentSchema = z.object({
  TELEGRAM_ENABLED: z.enum(['true', 'false']).default('false'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_BRAND_WELCOME_PHOTO_FILE_ID: z.string().optional(),
  TELEGRAM_BRAND_DELIVERY_PHOTO_FILE_ID: z.string().optional(),
  TELEGRAM_ADMIN_IDS: z.string().optional(),
  TELEGRAM_REPORT_GROUP_CHAT_ID: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_NEW_USERS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_ORDERS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_RECEIPTS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_SALES: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_RENEWALS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_RESELLERS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_ERRORS: z.string().optional(),
  TELEGRAM_REPORT_TOPIC_DAILY_SUMMARIES: z.string().optional(),
  TELEGRAM_REPORT_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(15_000),
  TELEGRAM_REMINDER_DISPATCH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(15_000),
  TELEGRAM_BROADCAST_DISPATCH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(15_000),
  TELEGRAM_USAGE_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).max(300_000).default(60_000),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/u)
    .optional(),
});

const pilotEnvironmentSchema = databaseEnvironmentSchema.extend({
  PASARGUARD_BASE_URL: z.url(),
  PASARGUARD_API_KEY: z.string().min(8),
  PROVISIONING_MODE: z.enum(['disabled', 'isolated', 'live']).default('disabled'),
  PROVISIONING_ISOLATED_GROUP_ID: z.coerce.number().int().positive().optional(),
  PILOT_ENABLED: z.enum(['true', 'false']).default('false'),
  PILOT_PROVIDER_CODE: z
    .string()
    .regex(/^[a-z0-9-]{3,50}$/u)
    .default('pilot-pasarguard'),
  PILOT_VARIANT_CODE: z
    .string()
    .regex(/^[a-z0-9-]{3,80}$/u)
    .default('pilot-direct-variant'),
  PILOT_VARIANT_NAME: z.string().min(3).max(120).default('Pilot direct variant'),
  PILOT_GROUP_ID: z.coerce.number().int().nonnegative().default(0),
  PILOT_DURATION_DAYS: z.coerce.number().int().min(1).max(366).default(30),
  PILOT_DATA_LIMIT_BYTES: z.coerce.bigint().positive().default(10737418240n),
  PILOT_DEVICE_LIMIT: z.coerce.number().int().min(0).max(100).default(1),
});

interface DatabaseConfig {
  readonly databaseUrl: string;
}

interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly webOrigins: readonly string[];
}

export interface PilotConfig extends DatabaseConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly pilotEnabled: boolean;
  readonly provisioningMode: ProvisioningMode;
  readonly isolatedGroupId: number | null;
  readonly providerCode: string;
  readonly variantCode: string;
  readonly variantName: string;
  readonly groupId: number;
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
}

export interface TelegramReportingConfig {
  readonly groupChatId: string;
  readonly topics: {
    readonly new_users?: string;
    readonly orders?: string;
    readonly receipts?: string;
    readonly sales?: string;
    readonly renewals?: string;
    readonly resellers?: string;
    readonly errors?: string;
    readonly daily_summaries?: string;
  };
}

export type TelegramConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly botToken: string;
      readonly webhookSecret: string;
      readonly webhookUrl: string | null;
      readonly brandMedia: {
        readonly welcomePhotoFileId: string | null;
        readonly deliveryPhotoFileId: string | null;
      };
      readonly adminTelegramUserIds: ReadonlySet<string>;
      readonly reporting: TelegramReportingConfig | null;
      readonly reportDispatchIntervalMs: number;
      readonly deliveryDispatchIntervalMs: number;
      readonly reminderDispatchIntervalMs: number;
      readonly broadcastDispatchIntervalMs: number;
      readonly usageSyncIntervalMs: number;
      readonly botUsername: string | null;
    };

export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('INVALID_DATABASE_CONFIGURATION');
  }
  return { databaseUrl: parsed.data.DATABASE_URL };
}

export function loadHttpConfig(environment: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = httpEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error('INVALID_HTTP_CONFIGURATION');
  const webOrigins = parsed.data.WEB_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^/]+(?::\d+)?$/u.test(origin));
  if (webOrigins.length === 0) throw new Error('INVALID_HTTP_CONFIGURATION');
  return { host: parsed.data.HOST, port: parsed.data.PORT, webOrigins };
}

export function loadPilotConfig(environment: NodeJS.ProcessEnv = process.env): PilotConfig {
  const parsed = pilotEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('INVALID_PILOT_CONFIGURATION');
  }
  if (
    parsed.data.PROVISIONING_MODE === 'isolated' &&
    parsed.data.PROVISIONING_ISOLATED_GROUP_ID === undefined
  ) {
    throw new Error('INVALID_PILOT_CONFIGURATION');
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    baseUrl: parsed.data.PASARGUARD_BASE_URL,
    apiKey: parsed.data.PASARGUARD_API_KEY,
    pilotEnabled: parsed.data.PILOT_ENABLED === 'true',
    provisioningMode: parsed.data.PROVISIONING_MODE,
    isolatedGroupId: parsed.data.PROVISIONING_ISOLATED_GROUP_ID ?? null,
    providerCode: parsed.data.PILOT_PROVIDER_CODE,
    variantCode: parsed.data.PILOT_VARIANT_CODE,
    variantName: parsed.data.PILOT_VARIANT_NAME,
    groupId: parsed.data.PILOT_GROUP_ID,
    durationDays: parsed.data.PILOT_DURATION_DAYS,
    dataLimitBytes: parsed.data.PILOT_DATA_LIMIT_BYTES,
    deviceLimit: parsed.data.PILOT_DEVICE_LIMIT,
  };
}

export function loadTelegramConfig(environment: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const parsed = telegramEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  if (parsed.data.TELEGRAM_ENABLED === 'false') {
    return { enabled: false };
  }

  const botToken = parsed.data.TELEGRAM_BOT_TOKEN;
  const webhookSecret = parsed.data.TELEGRAM_WEBHOOK_SECRET;
  const adminIds = parsed.data.TELEGRAM_ADMIN_IDS?.split(',').map((value) => value.trim());
  if (
    botToken === undefined ||
    !/^\d{5,20}:[A-Za-z0-9_-]{20,}$/u.test(botToken) ||
    webhookSecret === undefined ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(webhookSecret) ||
    adminIds === undefined ||
    adminIds.length === 0 ||
    adminIds.some((value) => !/^\d{1,20}$/u.test(value))
  ) {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  return {
    enabled: true,
    botToken,
    webhookSecret,
    webhookUrl: loadHttpsPublicUrl(parsed.data.TELEGRAM_WEBHOOK_URL),
    brandMedia: {
      welcomePhotoFileId: optionalTelegramFileId(parsed.data.TELEGRAM_BRAND_WELCOME_PHOTO_FILE_ID),
      deliveryPhotoFileId: optionalTelegramFileId(
        parsed.data.TELEGRAM_BRAND_DELIVERY_PHOTO_FILE_ID,
      ),
    },
    adminTelegramUserIds: new Set(adminIds),
    reporting: loadTelegramReportingConfig(parsed.data),
    reportDispatchIntervalMs: parsed.data.TELEGRAM_REPORT_DISPATCH_INTERVAL_MS,
    deliveryDispatchIntervalMs: parsed.data.TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS,
    reminderDispatchIntervalMs: parsed.data.TELEGRAM_REMINDER_DISPATCH_INTERVAL_MS,
    broadcastDispatchIntervalMs: parsed.data.TELEGRAM_BROADCAST_DISPATCH_INTERVAL_MS,
    usageSyncIntervalMs: parsed.data.TELEGRAM_USAGE_SYNC_INTERVAL_MS,
    botUsername: parsed.data.TELEGRAM_BOT_USERNAME ?? null,
  };
}

function optionalTelegramFileId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function loadHttpsPublicUrl(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hostname.length === 0
  ) {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  return value;
}

function loadTelegramReportingConfig(environment: {
  readonly TELEGRAM_REPORT_GROUP_CHAT_ID?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_NEW_USERS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_ORDERS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_RECEIPTS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_SALES?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_RENEWALS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_RESELLERS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_ERRORS?: string | undefined;
  readonly TELEGRAM_REPORT_TOPIC_DAILY_SUMMARIES?: string | undefined;
}): TelegramReportingConfig | null {
  const groupChatId = environment.TELEGRAM_REPORT_GROUP_CHAT_ID;
  if (groupChatId === undefined || groupChatId.length === 0) {
    return null;
  }
  if (!/^-?\d{1,20}$/u.test(groupChatId)) {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  const topics: TelegramReportingConfig['topics'] = {
    ...optionalTopic('new_users', environment.TELEGRAM_REPORT_TOPIC_NEW_USERS),
    ...optionalTopic('orders', environment.TELEGRAM_REPORT_TOPIC_ORDERS),
    ...optionalTopic('receipts', environment.TELEGRAM_REPORT_TOPIC_RECEIPTS),
    ...optionalTopic('sales', environment.TELEGRAM_REPORT_TOPIC_SALES),
    ...optionalTopic('renewals', environment.TELEGRAM_REPORT_TOPIC_RENEWALS),
    ...optionalTopic('resellers', environment.TELEGRAM_REPORT_TOPIC_RESELLERS),
    ...optionalTopic('errors', environment.TELEGRAM_REPORT_TOPIC_ERRORS),
    ...optionalTopic('daily_summaries', environment.TELEGRAM_REPORT_TOPIC_DAILY_SUMMARIES),
  };
  return { groupChatId, topics };
}

function optionalTopic(
  purpose: keyof TelegramReportingConfig['topics'],
  value: string | undefined,
): Partial<TelegramReportingConfig['topics']> {
  if (value === undefined || value.length === 0) {
    return {};
  }
  if (!/^\d{1,20}$/u.test(value) || value === '0') {
    throw new Error('INVALID_TELEGRAM_CONFIGURATION');
  }
  return { [purpose]: value };
}
