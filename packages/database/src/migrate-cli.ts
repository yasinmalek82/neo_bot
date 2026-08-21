import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabasePool } from './pool.js';
import { migrate } from './migrator.js';

const rootEnvironmentFile = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  loadEnvFile(rootEnvironmentFile);
} catch (error: unknown) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
    throw error;
  }
}

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined) {
  throw new Error('DATABASE_URL is required');
}

const pool = createDatabasePool({ connectionString });
try {
  await migrate(pool);
} finally {
  await pool.end();
}
