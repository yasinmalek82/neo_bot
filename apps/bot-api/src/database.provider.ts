import { createDatabasePool, migrate } from '@neo-bot/database';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';

import { loadDatabaseConfig } from './config.js';

export const databasePoolToken = Symbol('databasePool');

export const databasePoolProvider = {
  provide: databasePoolToken,
  useFactory: async () => {
    const pool = createDatabasePool({ connectionString: loadDatabaseConfig().databaseUrl });
    await migrate(pool);
    return pool;
  },
};

@Injectable()
export class DatabasePoolHost implements OnModuleDestroy {
  public constructor(@Inject(databasePoolToken) private readonly pool: Pool) {}

  public async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
