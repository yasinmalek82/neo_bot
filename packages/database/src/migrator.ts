import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function migrate(
  pool: Pool,
  migrationsDirectory = resolve(packageRoot, 'migrations'),
): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
    .sort();

  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await pool.query('select pg_advisory_lock($1)', [8_721_406]);
  try {
    for (const file of files) {
      const alreadyApplied = await pool.query<{ exists: boolean }>(
        'select exists(select 1 from schema_migrations where version = $1) as exists',
        [file],
      );
      if (alreadyApplied.rows[0]?.exists === true) {
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations(version) values ($1)', [file]);
        await client.query('commit');
      } catch (error: unknown) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.query('select pg_advisory_unlock($1)', [8_721_406]);
  }
}
