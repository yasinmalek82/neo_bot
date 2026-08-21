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
  };
}

@Controller('health')
export class HealthController {
  public constructor(@Inject(databasePoolToken) private readonly pool: Pool) {}

  @Get()
  public async getHealth(): Promise<HealthResponse> {
    await this.pool.query('select 1');
    const counts = await this.pool.query<{ status: string; n: number }>(
      `select status, count(*)::int as n
       from reporting_deliveries
       group by status`,
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
      reports: deliveryCounts(counts.rows),
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

function deliveryCounts(
  rows: readonly { readonly status: string; readonly n: number }[],
): HealthResponse['reports'] {
  let pending = 0;
  let failed = 0;
  for (const row of rows) {
    if (!Number.isInteger(row.n) || row.n < 0) {
      continue;
    }
    if (row.status === 'pending') {
      pending = row.n;
    }
    if (row.status === 'failed') {
      failed = row.n;
    }
  }
  return { pending, failed };
}
