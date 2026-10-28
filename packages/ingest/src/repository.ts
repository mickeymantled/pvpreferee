import { Pool } from 'pg';
import { and, eq, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { MemeRecord, Ruling, RulingRepository, Rulebook } from '@pvp/shared';
import type { ReconstructedSnapshot, SnapshotCache } from './contracts';
import { hash, IngestError, timestamp } from './common';
import * as schema from './schema';

export type IngestDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface IngestRulingRepository extends RulingRepository {
  /** Caller authenticates/authorizes the actor. Null creates; non-null uses optimistic concurrency under a row lock. */
  applyMemeOverride(previous: MemeRecord | null, current: MemeRecord): Promise<void>;
  findMemeById(id: string): Promise<MemeRecord | null>;
  /** Exact URL match. Multiple distinct memes for one source require lookup by ID. */
  findMemeBySourceUrl(url: string): Promise<MemeRecord | null>;
}
function immutableConflict(message: string): never { throw new IngestError('IMMUTABLE_CONFLICT', message); }
function memeRow(m: MemeRecord) {
  return { id: m.id, slug: m.slug, scope: m.scope, canonical_name: m.canonical_name, canonical_ticker: m.canonical_ticker,
    source_url: m.source_url, source_tier: m.source_tier, source_image_hash: m.source_image_hash, subject_handle: m.subject_handle,
    home_chain: m.home_chain, implied_pair: m.implied_pair, beneficiary_wallet: m.beneficiary_wallet, beneficiary_tie_at: m.beneficiary_tie_at,
    created_by: m.created_by, override_audit: m.overrides, raw_record: m };
}
function validateRuling(r: Ruling): void {
  if (!r.id || !r.share_slug || r.meme_id !== r.facts.meme.id || r.rules_version !== r.facts.config.version || r.config_hash !== hash(r.facts.config) || r.facts_hash !== hash(r.facts)) throw new IngestError('INVALID_INPUT', 'Ruling identity/version/config hash/facts hash does not match frozen facts');
  if (hash(r.coin_cas) !== hash(r.facts.coins.map(c => c.ca)) || new Set(r.coin_cas).size !== r.coin_cas.length || (r.winner_ca !== null && !r.coin_cas.includes(r.winner_ca))) throw new IngestError('INVALID_INPUT', 'Ruling coin list does not match frozen facts');
  timestamp(r.created_at);
  for (const c of r.facts.coins) {
    if (c.meme_id !== null && c.meme_id !== r.meme_id && r.status !== 'separate_memes') throw new IngestError('INVALID_INPUT', 'Coin references a different meme outside a separate_memes ruling');
    if (c.endorsements.some(e => e.coin_ca !== c.ca)) throw new IngestError('INVALID_INPUT', 'Endorsement references a different coin');
  }
}
/** Database-injectable for offline tests; all normal writes use Drizzle. */
export class DrizzleRulingRepository implements IngestRulingRepository {
  constructor(private readonly db: IngestDatabase) {}
  async applyMemeOverride(previous: MemeRecord | null, current: MemeRecord): Promise<void> {
    const before = structuredClone(previous), after = structuredClone(current);
    if (before === null) {
      if (after.overrides.length === 0) throw new IngestError('INVALID_INPUT', 'Manual meme creation requires the supplied field audit');
    } else if (before.id !== after.id || after.overrides.length <= before.overrides.length || hash(after.overrides.slice(0, before.overrides.length)) !== hash(before.overrides)) throw new IngestError('INVALID_INPUT', 'Override must preserve meme identity and append to the previous audit');
    await this.db.transaction(async tx => {
      if (before === null) {
        // Persist the source package's reviewed facts and audit verbatim; there is no inferred baseline.
        const inserted = await tx.insert(schema.memes).values(memeRow(after)).onConflictDoNothing().returning({ id: schema.memes.id });
        if (inserted.length !== 1) immutableConflict('Meme ID or slug already exists; load the audited record before reviewing it');
        return;
      }
      // The initial resolver record may not yet be saved when /resolve is reviewed.
      await tx.insert(schema.memes).values(memeRow(before)).onConflictDoNothing({ target: schema.memes.id });
      const [stored] = await tx.select().from(schema.memes).where(eq(schema.memes.id, before.id)).for('update');
      if (!stored || hash(stored.raw_record) !== hash(before)) immutableConflict('Meme changed since review; reload and reapply the override');
      await tx.update(schema.memes).set(memeRow(after)).where(eq(schema.memes.id, before.id));
    });
  }
  async findMemeById(id: string): Promise<MemeRecord | null> {
    const [row] = await this.db.select({ raw: schema.memes.raw_record }).from(schema.memes).where(eq(schema.memes.id, id));
    return row?.raw ?? null;
  }
  async findMemeBySourceUrl(url: string): Promise<MemeRecord | null> {
    const rows = await this.db.select({ raw: schema.memes.raw_record }).from(schema.memes).where(eq(schema.memes.source_url, url)).limit(2);
    if (rows.length > 1) immutableConflict('Source URL identifies multiple memes; load the intended audited record by ID');
    return rows[0]?.raw ?? null;
  }
  async save(ruling: Ruling): Promise<void> {
    // Detach before the first await, retaining optional raw_ingest extensions in JSON.
    const r = structuredClone(ruling); validateRuling(r);
    await this.db.transaction(async tx => {
      await tx.insert(schema.memes).values(memeRow(r.facts.meme)).onConflictDoNothing({ target: schema.memes.id });
      const [current] = await tx.select().from(schema.memes).where(eq(schema.memes.id, r.meme_id)).for('update');
      if (!current) throw new IngestError('INVALID_INPUT', 'Meme record could not be saved');
      if (hash(current.raw_record) !== hash(r.facts.meme)) {
        const oldAudit = current.override_audit, incoming = r.facts.meme.overrides;
        if (incoming.length > oldAudit.length) {
          // Database trigger verifies append-only audit and each changed field.
          await tx.update(schema.memes).set(memeRow(r.facts.meme)).where(eq(schema.memes.id, r.meme_id));
        } else if (incoming.length === oldAudit.length || hash(oldAudit.slice(0, incoming.length)) !== hash(incoming)) {
          immutableConflict('Meme changed without a new audit entry, or has a divergent audit history');
        }
        // Replaying an older immutable ruling does not roll back the current meme record.
      }
      for (const c of r.facts.coins) {
        const factsHash = hash({ coin: c, config_hash: r.config_hash });
        await tx.insert(schema.coins).values({ ca: c.ca, facts_hash: factsHash, meme_id: c.meme_id === r.meme_id ? c.meme_id : null, chain: c.chain, launchpad: c.launchpad,
          pair_asset: c.pair_asset, name: c.name, ticker: c.ticker, image_hash: c.image_hash, creator_wallet: c.creator_wallet, fee_wallet: c.fee_wallet,
          deployed_at: c.deployed_at, first_real_buy_at: c.first_real_buy_at, bonded_at: c.bonded_at, observed_at: c.observed_at,
          raw_facts: c, config_hash: r.config_hash, frozen_config: r.facts.config }).onConflictDoNothing();
        for (const e of c.endorsements) await tx.insert(schema.endorsements).values({ id: hash(e), coin_ca: e.coin_ca, kind: e.kind, evidence_url: e.evidence_url, evidence_tx: e.evidence_tx, at: e.at, verified_by: e.verified_by, raw_record: e }).onConflictDoNothing();
      }
      await tx.insert(schema.rulings).values({ id: r.id, meme_id: r.meme_id, coin_cas: r.coin_cas, winner_ca: r.winner_ca, grid: r.grid, flags: r.flags,
        config_hash: r.config_hash, rules_version: r.rules_version, facts_hash: r.facts_hash, created_at: r.created_at, share_slug: r.share_slug,
        frozen_facts: r.facts, frozen_config: r.facts.config, raw_ruling: r }).onConflictDoNothing();
      const existing = await tx.select({ raw: schema.rulings.raw_ruling }).from(schema.rulings).where(or(eq(schema.rulings.id, r.id), eq(schema.rulings.share_slug, r.share_slug)));
      if (existing.length !== 1 || hash(existing[0]!.raw) !== hash(r)) immutableConflict('Ruling ID or permalink already contains different immutable data');
    });
  }
  async findBySlug(slug: string): Promise<Ruling | null> {
    const [row] = await this.db.select({ raw: schema.rulings.raw_ruling }).from(schema.rulings).where(eq(schema.rulings.share_slug, slug));
    return row?.raw ?? null;
  }
}
export class PostgresSnapshotCache implements SnapshotCache {
  constructor(private readonly db: IngestDatabase) {}
  async get(ca: string, at: string, configHash: string): Promise<ReconstructedSnapshot | null> {
    const [row] = await this.db.select({ raw: schema.snapshots.raw_snapshot }).from(schema.snapshots).where(and(eq(schema.snapshots.coin_ca, ca), eq(schema.snapshots.at, timestamp(at)), eq(schema.snapshots.config_hash, configHash)));
    return row?.raw ?? null;
  }
  async put(value: ReconstructedSnapshot, config: Rulebook): Promise<void> {
    const s = structuredClone(value);
    if (!s.complete || s.config_hash !== hash(config) || s.mcap_usd === null || s.holders === null || s.distinct_buyers_lifetime === null) throw new IngestError('INVALID_INPUT', 'Only complete snapshots with matching frozen config may be cached');
    await this.db.insert(schema.snapshots).values({ coin_ca: s.coin_ca, at: timestamp(s.at), config_hash: s.config_hash, id: s.id,
      mcap_usd: s.mcap_usd, holders: s.holders, distinct_buyers_lifetime: s.distinct_buyers_lifetime, last_trade_at: s.last_trade_at,
      source: s.source, complete: s.complete, raw_snapshot: s, frozen_config: structuredClone(config) }).onConflictDoNothing();
    const saved = await this.get(s.coin_ca, s.at, s.config_hash);
    // Equivalent concurrent fetches may have different observation times/raw envelopes.
    // The first stored envelope wins permanently; historical values may never change.
    const derived = (v: ReconstructedSnapshot) => ({ ...v, raw_ingest: { supply_atomic: v.raw_ingest.supply_atomic, decimals: v.raw_ingest.decimals, price_usd: v.raw_ingest.price_usd } });
    if (!saved || hash(derived(saved)) !== hash(derived(s))) immutableConflict('Exact snapshot cache key already has different immutable historical values');
  }
}
function connection(databaseUrl: string) {
  if (!databaseUrl) throw new IngestError('INVALID_INPUT', 'DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
export function createRulingRepository(databaseUrl: string): IngestRulingRepository & { close(): Promise<void> } {
  const client = connection(databaseUrl), repository = new DrizzleRulingRepository(client.db);
  return { save: repository.save.bind(repository), findBySlug: repository.findBySlug.bind(repository), applyMemeOverride: repository.applyMemeOverride.bind(repository),
    findMemeById: repository.findMemeById.bind(repository), findMemeBySourceUrl: repository.findMemeBySourceUrl.bind(repository), close: client.close };
}
export function createPostgresSnapshotCache(databaseUrl: string): SnapshotCache & { close(): Promise<void> } {
  const client = connection(databaseUrl), cache = new PostgresSnapshotCache(client.db);
  return { get: cache.get.bind(cache), put: cache.put.bind(cache), close: client.close };
}
