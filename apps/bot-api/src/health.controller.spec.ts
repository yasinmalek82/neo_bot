import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { databasePoolToken } from './database.provider.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('only reports a healthy database after the query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const controller = new HealthController({ query } as unknown as Pool);

    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'ok',
      database: 'reachable',
    });
    expect(query).toHaveBeenCalledWith('select 1');
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
    });
    await app.close();
  });
});
