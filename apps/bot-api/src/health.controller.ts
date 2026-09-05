import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';

import { loadPilotConfig, loadTelegramConfig } from './config.js';
import { databasePoolToken } from './database.provider.js';
import { readTelegramIntakeHealth, type TelegramIntakeMode } from './telegram-intake.js';

interface HealthResponse {
  readonly status: 'ok';
  readonly database: 'reachable';
  readonly telegram: TelegramIntakeMode;
  readonly telegramReady: boolean;
  readonly telegramError: string;
  readonly migrations: number;
  readonly reports: {
    readonly pending: number;
    readonly failed: number;
    readonly retrying: number;
    readonly due: number;
  };
  readonly provisioning: {
    readonly mode: 'disabled' | 'isolated' | 'live';
    readonly pilotEnabled: boolean;
  };
  readonly commercial: {
    readonly remindersPending: number;
    readonly broadcastsPending: number;
    readonly broadcastsRunning: number;
    readonly usageSyncDue: number;
  };
}

@Controller('health')
export class HealthController {
  public constructor(@Inject(databasePoolToken) private readonly pool: Pool) {}

  @Get()
  public async getHealth(): Promise<HealthResponse> {
    await this.pool.query('select 1');
    const counts = await this.pool.query<DeliveryCountRow>(
      `select
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'pending' and attempt_count > 0)::int as retrying,
         count(*) filter (where status = 'pending' and next_attempt_at <= now())::int as due
       from reporting_deliveries`,
    );
    const migrated = await this.pool.query<{ n: number }>(
      'select count(*)::int as n from schema_migrations',
    );
    const commercial = await readCommercialCounts(this.pool);
    const telegram = telegramIntakeSnapshot();
    return {
      status: 'ok',
      database: 'reachable',
      telegram: telegram.mode,
      telegramReady: telegram.ready,
      telegramError: telegram.error,
      migrations: migrationCount(migrated.rows[0]?.n),
      reports: deliveryCounts(counts.rows[0]),
      provisioning: provisioningSnapshot(),
      commercial: commercialCounts(commercial.rows[0]),
    };
  }
}

function telegramIntakeSnapshot(): ReturnType<typeof readTelegramIntakeHealth> {
  try {
    const telegram = loadTelegramConfig();
    if (!telegram.enabled) {
      return readTelegramIntakeHealth(Date.now(), 'disabled');
    }
    return readTelegramIntakeHealth(
      Date.now(),
      telegram.webhookUrl === null ? 'polling' : 'webhook',
    );
  } catch {
    return readTelegramIntakeHealth(Date.now(), 'disabled');
  }
}

function migrationCount(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

interface DeliveryCountRow {
  readonly pending: number;
  readonly failed: number;
  readonly retrying: number;
  readonly due: number;
}

function deliveryCounts(row: DeliveryCountRow | undefined): HealthResponse['reports'] {
  return {
    pending: nonNegativeInt(row?.pending),
    failed: nonNegativeInt(row?.failed),
    retrying: nonNegativeInt(row?.retrying),
    due: nonNegativeInt(row?.due),
  };
}

function nonNegativeInt(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

interface CommercialCountRow {
  readonly reminders_pending: number;
  readonly broadcasts_pending: number;
  readonly broadcasts_running: number;
  readonly usage_sync_due: number;
}

function commercialCounts(row: CommercialCountRow | undefined): HealthResponse['commercial'] {
  return {
    remindersPending: nonNegativeInt(row?.reminders_pending),
    broadcastsPending: nonNegativeInt(row?.broadcasts_pending),
    broadcastsRunning: nonNegativeInt(row?.broadcasts_running),
    usageSyncDue: nonNegativeInt(row?.usage_sync_due),
  };
}

async function readCommercialCounts(pool: Pool): Promise<{ rows: CommercialCountRow[] }> {
  try {
    return await pool.query<CommercialCountRow>(
      `select
         (select count(*)::int from service_reminder_deliveries where status = 'pending') as reminders_pending,
         (select count(*)::int from broadcast_recipients where status = 'pending') as broadcasts_pending,
         (select count(*)::int from broadcast_jobs where status in ('queued', 'running')) as broadcasts_running,
         (select count(*)::int from services
           where status = 'active'
             and (usage_synced_at is null or usage_synced_at <= now() - interval '10 minutes')
         ) as usage_sync_due`,
    );
  } catch (error: unknown) {
    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) {
      return { rows: [] };
    }
    throw error;
  }
}

function isUndefinedTableError(error: unknown): boolean {
  return postgresCode(error) === '42P01';
}

function isUndefinedColumnError(error: unknown): boolean {
  return postgresCode(error) === '42703';
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return (error as { readonly code?: string }).code;
}

function provisioningSnapshot(): HealthResponse['provisioning'] {
  try {
    const pilot = loadPilotConfig();
    return { mode: pilot.provisioningMode, pilotEnabled: pilot.pilotEnabled };
  } catch {
    return { mode: 'disabled', pilotEnabled: false };
  }
}
