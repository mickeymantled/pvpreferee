import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleRulingRepository, PostgresSnapshotCache } from '../src/repository';
import * as schema from '../src/schema';
import { hash } from '../src/common';
import { IngestService } from '../src/provider';
import { at, CA, config, launch, makeRuling, meme, metadata, prices, service, SyntheticLedger } from './helpers';

describe('real PostgreSQL semantics via offline PGlite, synthetic records', () => {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const repository = new DrizzleRulingRepository(db), cache = new PostgresSnapshotCache(db);
  beforeAll(async () => { await pg.exec(await readFile(new URL('../migrations/0001_ingest.sql', import.meta.url), 'utf8')); }, 30_000);
  afterAll(async () => { await pg.close(); });
  it('creates exactly the five specified tables', async () => {
    const r = await pg.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    expect(r.rows.map(x => x.tablename)).toEqual(['coins', 'endorsements', 'memes', 'rulings', 'snapshots']);
  });
  it('saves and retrieves the full immutable ruling and raw evidence; identical saves are idempotent', async () => {
    const ruling = await makeRuling('synthetic-roundtrip');
    await repository.save(ruling); await repository.save(ruling);
    expect(await repository.findBySlug(ruling.share_slug)).toEqual(ruling);
    expect(await repository.findBySlug('missing')).toBeNull();
    const raw = await pg.query<{ raw_facts: unknown }>('SELECT raw_facts FROM coins LIMIT 1');
    expect(raw.rows[0]!.raw_facts).toHaveProperty('raw_ingest.payloads');
  });
  it('rejects hash mismatch and conflicting immutable permalink without leaking partial rows', async () => {
    const ruling = await makeRuling('synthetic-conflict'); await repository.save(ruling);
    const wrongHash = structuredClone(ruling); wrongHash.facts.coins[0]!.ticker = 'changed';
    await expect(repository.save(wrongHash)).rejects.toThrow('hash');
    const conflicting = structuredClone(ruling); conflicting.status = 'no_winner';
    await expect(repository.save(conflicting)).rejects.toMatchObject({ code: 'IMMUTABLE_CONFLICT' });
    expect(await repository.findBySlug(ruling.share_slug)).toEqual(ruling);
  });
  it('protects coins, snapshots, endorsements and rulings against SQL updates/deletes/truncation', async () => {
    const ruling = await makeRuling('synthetic-protection');
    ruling.facts.coins[0]!.endorsements.push({ coin_ca: CA, kind: 'ca_post', evidence_url: 'https://example.invalid/synthetic-endorsement', evidence_tx: null, at: at(40), verified_by: 'synthetic-brian', subject_wallet: null, subject_held_supply_pct: null });
    ruling.facts_hash = hash(ruling.facts); await repository.save(ruling);
    await cache.put(await service().snapshotAt(CA, at(40), config), config);
    for (const table of ['coins', 'snapshots', 'endorsements', 'rulings']) {
      const column = table === 'coins' ? 'ca' : 'id';
      await expect(pg.exec(`UPDATE ${table} SET ${column}=${column}`)).rejects.toThrow('immutable');
      await expect(pg.exec(`DELETE FROM ${table}`)).rejects.toThrow('immutable');
      await expect(pg.exec(`TRUNCATE ${table}`)).rejects.toThrow();
    }
  });
  it('uses exact timestamp and config hash; concurrent equivalent raw fetches retain first payload', async () => {
    const snap = await service().snapshotAt(CA, at(50), config);
    await cache.put(snap, config);
    expect(await cache.get(CA, at(50), hash(config))).toEqual(snap);
    expect(await cache.get(CA, at(50.001), hash(config))).toBeNull();
    const v2 = structuredClone(config); v2.version = 'v2';
    expect(await cache.get(CA, at(50), hash(v2))).toBeNull();
    const concurrent = structuredClone(snap); concurrent.raw_ingest.payloads[0]!.fetched_at = at(200);
    await cache.put(concurrent, config);
    expect(await cache.get(CA, at(50), hash(config))).toEqual(snap);
    const conflicting = structuredClone(snap); conflicting.mcap_usd = 99999;
    await expect(cache.put(conflicting, config)).rejects.toMatchObject({ code: 'IMMUTABLE_CONFLICT' });
  });
  it('retains cross-meme facts only for an explicit separate_memes ruling', async () => {
    const r = await makeRuling('synthetic-separate'); r.facts.coins[0]!.meme_id = 'synthetic-other-meme'; r.facts_hash = hash(r.facts);
    await expect(repository.save(r)).rejects.toThrow('outside a separate_memes');
    r.status = 'separate_memes'; await repository.save(r);
    expect((await repository.findBySlug(r.share_slug))!.facts.coins[0]!.meme_id).toBe('synthetic-other-meme');
  });
  it('returns the same first stored raw payload to concurrent snapshot callers', async () => {
    const version = structuredClone(config); version.version = 'v3';
    const provider = (observed: string) => {
      const ledger = new SyntheticLedger();
      return new IngestService({ metadata, launch, prices, cache, ledger: { async page(...args) {
        const page = await ledger.page(...args); page.raw.fetched_at = observed; return page;
      } } });
    };
    const [a, b] = await Promise.all([provider(at(100)).snapshotAt(CA, at(40), version), provider(at(200)).snapshotAt(CA, at(40), version)]);
    expect(a).toEqual(b); expect(a).toEqual(await cache.get(CA, at(40), hash(version)));
  });
  it('saves standalone overrides with optimistic concurrency, audit enforcement, and no ruling needed', async () => {
    const previous = { ...structuredClone(meme), id: 'synthetic-review', slug: 'synthetic-review' };
    const current = structuredClone(previous); current.canonical_name = 'Synthetic Reviewed Cat';
    current.overrides.push({ field: 'canonical_name', previous: previous.canonical_name, value: current.canonical_name, actor: 'synthetic-brian', at: at(100), reason: 'Synthetic evidence correction' });
    await repository.applyMemeOverride(previous, current);
    await expect(repository.applyMemeOverride(previous, current)).rejects.toThrow('changed since review');
    const row = await pg.query<{ raw_record: unknown }>('SELECT raw_record FROM memes WHERE id=$1', [previous.id]);
    expect(row.rows[0]!.raw_record).toEqual(current);
    await expect(pg.query('UPDATE memes SET canonical_name=$1 WHERE id=$2', ['unlogged', previous.id])).rejects.toThrow('disagrees');
    const unaudited = structuredClone(current); unaudited.canonical_ticker = 'UNLOGGED';
    unaudited.overrides.push({ field: 'canonical_name', previous: current.canonical_name, value: current.canonical_name, actor: 'synthetic-brian', at: at(101), reason: 'Wrong audit field' });
    await expect(repository.applyMemeOverride(current, unaudited)).rejects.toThrow();
  });
  it('freezes original meme versions on rulings after a later override and supports replaying an old version', async () => {
    const r = await makeRuling('synthetic-before-override'); await repository.save(r);
    const updated = structuredClone(r.facts.meme); updated.canonical_name = 'Synthetic Updated';
    updated.overrides.push({ field: 'canonical_name', previous: r.facts.meme.canonical_name, value: updated.canonical_name, actor: 'synthetic-brian', at: at(100), reason: 'Synthetic correction' });
    await repository.applyMemeOverride(r.facts.meme, updated);
    expect((await repository.findBySlug(r.share_slug))!.facts.meme).toEqual(r.facts.meme);
    const rerun = structuredClone(r); rerun.id = 'synthetic-old-replay'; rerun.share_slug = rerun.id;
    await repository.save(rerun);
    const row = await pg.query<{ raw_record: unknown }>('SELECT raw_record FROM memes WHERE id=$1', [r.meme_id]);
    expect(row.rows[0]!.raw_record).toEqual(updated);
  });
});
