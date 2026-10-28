import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { IngestError } from './common';

export async function migrateIngest(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO public');
      await client.query("SELECT pg_advisory_xact_lock(718295301)");
      const present = await client.query<{ marker: string | null }>("SELECT obj_description(to_regclass('public.rulings'), 'pg_class') AS marker");
      if (present.rows[0]?.marker === 'pvp-ingest:0001') { await client.query('COMMIT'); return; }
      const collisions = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)", [['memes', 'coins', 'snapshots', 'endorsements', 'rulings']]);
      if (collisions.rows.length) throw new IngestError('IMMUTABLE_CONFLICT', 'Existing domain tables have no matching migration marker; inspect schema before migration');
      await client.query(await readFile(new URL('../migrations/0001_ingest.sql', import.meta.url), 'utf8'));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new IngestError('INVALID_INPUT', 'Set DATABASE_URL before running db:migrate');
  await migrateIngest(url);
}
