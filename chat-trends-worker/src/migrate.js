import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Own tracking table, deliberately named so it can never collide with the main app's EF Core
// __EFMigrationsHistory or Vendor Portal's own vendor_schema_migrations — this worker, the main
// app's API tiers, and Vendor Portal each own a disjoint slice of the same shared Postgres database.
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_trends_schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM chat_trends_schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length > 0) continue;

    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO chat_trends_schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`[migrate] failed applying ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(async () => { console.log('[migrate] up to date'); await pool.end(); process.exit(0); })
    .catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });
}
