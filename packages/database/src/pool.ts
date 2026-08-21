import { Pool } from 'pg';

export interface DatabasePoolOptions {
  readonly connectionString: string;
  readonly max?: number;
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: 'neo_bot',
  });
}
