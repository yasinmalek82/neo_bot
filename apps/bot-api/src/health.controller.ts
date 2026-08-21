import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';

import { loadTelegramConfig } from './config.js';
import { databasePoolToken } from './database.provider.js';

interface HealthResponse {
  readonly status: 'ok';
  readonly database: 'reachable';
  readonly telegram: 'disabled' | 'polling' | 'webhook';
}

@Controller('health')
export class HealthController {
  public constructor(@Inject(databasePoolToken) private readonly pool: Pool) {}

  @Get()
  public async getHealth(): Promise<HealthResponse> {
    await this.pool.query('select 1');
    return { status: 'ok', database: 'reachable', telegram: telegramIntakeStatus() };
  }
}

function telegramIntakeStatus(): HealthResponse['telegram'] {
  try {
    const telegram = loadTelegramConfig();
    if (!telegram.enabled) {
      return 'disabled';
    }
    return telegram.webhookUrl === null ? 'polling' : 'webhook';
  } catch {
    return 'disabled';
  }
}
