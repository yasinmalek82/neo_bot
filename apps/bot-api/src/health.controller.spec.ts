import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { databasePoolToken } from './database.provider.js';
import { HealthController } from './health.controller.js';
import { resetTelegramIntakeForTests } from './telegram-intake.js';

describe('HealthController', () => {
  afterEach(() => {
    resetTelegramIntakeForTests();
  });
  it('only reports a healthy database after the query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const controller = new HealthController({ query } as unknown as Pool);

    await expect(controller.getHealth()).resolves.toEqual({
      status: 'ok',
      database: 'reachable',
      telegram: expect.stringMatching(/^(disabled|polling|webhook)$/u),
      telegramReady: true,
      telegramError: 'none',
      migrations: 0,
      reports: { pending: 0, failed: 0, retrying: 0, due: 0 },
      provisioning: { mode: 'disabled', pilotEnabled: false },
      commercial: { remindersPending: 0, broadcastsPending: 0, broadcastsRunning: 0 },
    });
    expect(query).toHaveBeenCalledWith('select 1');
  });

  it('exposes pending, failed, retrying, and due report counts without identifiers', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ pending: 3, failed: 1, retrying: 2, due: 1 }],
      })
      .mockResolvedValueOnce({ rows: [{ n: 6 }] })
      .mockResolvedValueOnce({
        rows: [{ reminders_pending: 2, broadcasts_pending: 4, broadcasts_running: 1 }],
      });
    const controller = new HealthController({ query } as unknown as Pool);

    await expect(controller.getHealth()).resolves.toMatchObject({
      reports: { pending: 3, failed: 1, retrying: 2, due: 1 },
      migrations: 6,
      commercial: { remindersPending: 2, broadcastsPending: 4, broadcastsRunning: 1 },
    });
  });

  it('responds through the real Fastify route without opening a network port', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(databasePoolToken)
      .useValue({ query, end: vi.fn().mockResolvedValue(undefined) })
      .compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      database: 'reachable',
      telegram: expect.stringMatching(/^(disabled|polling|webhook)$/u),
      telegramReady: expect.any(Boolean),
      telegramError: expect.stringMatching(/^(none|TELEGRAM_[A-Z0-9_]+)$/u),
      migrations: 0,
      reports: { pending: 0, failed: 0, retrying: 0, due: 0 },
      provisioning: { mode: 'disabled', pilotEnabled: false },
      commercial: { remindersPending: 0, broadcastsPending: 0, broadcastsRunning: 0 },
    });
    await app.close();
  });
});
