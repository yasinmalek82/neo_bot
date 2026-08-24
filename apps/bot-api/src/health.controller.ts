import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';

import { loadTelegramConfig } from './config.js';
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
    const telegram = telegramIntakeSnapshot();
    return {
      status: 'ok',
      database: 'reachable',
      telegram: telegram.mode,
      telegramReady: telegram.ready,
      telegramError: telegram.error,
      migrations: migrationCount(migrated.rows[0]?.n),
      reports: deliveryCounts(counts.rows[0]),
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
