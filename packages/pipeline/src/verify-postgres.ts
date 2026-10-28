import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createRulingRepository } from '@pvp/ingest';
import { migrateIngest } from '@pvp/ingest/migrate';
import { fixtures } from '@pvp/rules/fixtures';
import { rule } from '@pvp/rules';
import { loadRulebook } from '@pvp/config';
import type { Snapshot } from '@pvp/shared';
import { createPipeline } from './index';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || process.env.PVP_ALLOW_SYNTHETIC_DB !== '1') throw new Error('Set TEST_DATABASE_URL to an isolated database and PVP_ALLOW_SYNTHETIC_DB=1. This verification inserts clearly labeled synthetic rulings.');
await migrateIngest(databaseUrl);
await migrateIngest(databaseUrl);
const repository = createRulingRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const runId = randomUUID().slice(0, 8);
try {
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  assert.deepEqual(rows.map(row => row.tablename), ['coins', 'endorsements', 'memes', 'rulings', 'snapshots']);
  for (const template of fixtures) {
    const fixture = structuredClone(template);
    const previousId = fixture.meme.id;
    fixture.meme.id = 'synthetic-smoke-' + runId + '-' + fixture.name;
    fixture.meme.slug = fixture.meme.id;
    for (const coin of fixture.coins) {
      if (coin.meme_id === previousId) coin.meme_id = fixture.meme.id;
      coin.flags.warnings = [...(coin.flags.warnings ?? []), 'SYNTHETIC TEST DATA — not verified on-chain'];
    }
    const pipeline = createPipeline({
      ingest: {
        coinFacts: async ca => structuredClone(fixture.coins.find(c => c.ca === ca)!),
        snapshotAt: async (ca, at): Promise<Snapshot> => structuredClone(fixture.coins.find(c => c.ca === ca)!.snapshots.find(s => s.at === at) ?? {
          id: 'synthetic-unavailable', coin_ca: ca, at, mcap_usd: null, holders: null, distinct_buyers_lifetime: null,
          last_trade_at: null, source: 'Synthetic fixture has no checkpoint at this instant', complete: false, evidence: [],
        }),
      },
      source: { resolve: async () => ({ meme: fixture.meme, endorsements: [], needs_review: false, reasons: [] }) },
      repository, judge: rule, newId: () => fixture.meme.id,
    });
    const ruling = await pipeline.run({ cas: fixture.coins.map(c => c.ca), source_url: fixture.meme.source_url });
    assert.equal(ruling.winner_ca, fixture.expected.winner_ca);
    assert.equal(ruling.status, fixture.expected.status);
    assert.deepEqual(Object.fromEntries(ruling.grid.map(row => [row.coin, row.eliminated_by])), fixture.expected.eliminated_by);
    assert.deepEqual(await repository.findBySlug(ruling.share_slug), ruling);
    await repository.save(ruling);
    assert.equal(rule(ruling.facts.coins, ruling.facts.meme, loadRulebook().config).winner_ca, ruling.winner_ca);
    await assert.rejects(pool.query('UPDATE rulings SET winner_ca = winner_ca WHERE id = $1', [ruling.id]), /immutable/);
    console.log(JSON.stringify({ synthetic: true, fixture: fixture.name, winner: ruling.winner_ca, status: ruling.status, permalink: '/ruling/' + ruling.share_slug }));
  }
  console.log('PASS: ten synthetic pipelines, immutable Postgres round trips, replay, and SQL mutation rejection. No live on-chain acceptance asserted.');
} finally { await Promise.all([repository.close(), pool.end()]); }
