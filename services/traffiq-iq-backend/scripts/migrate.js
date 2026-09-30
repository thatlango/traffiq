import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');
const MIGRATION_LOCK_KEY = 'traffiq-iq-backend:migrations';

/**
 * Run the complete migration chain under one Postgres session advisory lock.
 * API and mobile can start together, but only one process may inspect/apply
 * migrations at a time. This prevents races around CREATE EXTENSION and the
 * _migrations table while keeping each migration transactionally isolated.
 */
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
    for (const name of files) {
      const exists = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [name]);
      if (exists.rowCount) continue;

      const sql = await readFile(join(migrationsDir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`applied migration ${name}`);
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    } catch (unlockError) {
      console.error('failed to release migration advisory lock', unlockError);
    }
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
