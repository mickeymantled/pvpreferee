import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { CoinFacts, Endorsement, FrozenFacts, MemeRecord, OverrideEntry, Ruling, Rulebook } from '@pvp/shared';
import type { ReconstructedSnapshot } from './contracts';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'string', precision: 3 });
export const memes = pgTable('memes', {
  id: text('id').primaryKey(), slug: text('slug').notNull().unique(), scope: text('scope').notNull(),
  canonical_name: text('canonical_name').notNull(), canonical_ticker: text('canonical_ticker').notNull(),
  source_url: text('source_url').notNull(), source_tier: text('source_tier').notNull(), source_image_hash: text('source_image_hash'),
  subject_handle: text('subject_handle'), home_chain: text('home_chain'), implied_pair: text('implied_pair'),
  beneficiary_wallet: text('beneficiary_wallet'), beneficiary_tie_at: instant('beneficiary_tie_at'), created_by: text('created_by').notNull(),
  override_audit: jsonb('override_audit').$type<OverrideEntry[]>().notNull(), raw_record: jsonb('raw_record').$type<MemeRecord>().notNull(),
});
/** Multiple immutable observed fact versions per CA; rulings freeze the exact selected version. */
export const coins = pgTable('coins', {
  ca: text('ca').notNull(), facts_hash: text('facts_hash').notNull(), meme_id: text('meme_id').references(() => memes.id),
  chain: text('chain').notNull(), launchpad: text('launchpad'), pair_asset: text('pair_asset'), name: text('name').notNull(), ticker: text('ticker').notNull(),
  image_hash: text('image_hash'), creator_wallet: text('creator_wallet'), fee_wallet: text('fee_wallet'), deployed_at: instant('deployed_at'),
  first_real_buy_at: instant('first_real_buy_at'), bonded_at: instant('bonded_at'), observed_at: instant('observed_at').notNull(),
  raw_facts: jsonb('raw_facts').$type<CoinFacts>().notNull(), config_hash: text('config_hash').notNull(), frozen_config: jsonb('frozen_config').$type<Rulebook>().notNull(),
}, t => [primaryKey({ columns: [t.ca, t.facts_hash] })]);
export const snapshots = pgTable('snapshots', {
  coin_ca: text('coin_ca').notNull(), at: instant('at').notNull(), config_hash: text('config_hash').notNull(), id: text('id').notNull().unique(),
  mcap_usd: doublePrecision('mcap_usd'), holders: integer('holders'), distinct_buyers_lifetime: integer('distinct_buyers_lifetime'), last_trade_at: instant('last_trade_at'),
  source: text('source').notNull(), complete: boolean('complete').notNull(), raw_snapshot: jsonb('raw_snapshot').$type<ReconstructedSnapshot>().notNull(), frozen_config: jsonb('frozen_config').$type<Rulebook>().notNull(),
}, t => [primaryKey({ columns: [t.coin_ca, t.at, t.config_hash] })]);
export const endorsements = pgTable('endorsements', {
  id: text('id').primaryKey(), coin_ca: text('coin_ca').notNull(), kind: text('kind').notNull(), evidence_url: text('evidence_url'), evidence_tx: text('evidence_tx'),
  at: instant('at').notNull(), verified_by: text('verified_by'), raw_record: jsonb('raw_record').$type<Endorsement>().notNull(),
});
export const rulings = pgTable('rulings', {
  id: text('id').primaryKey(), meme_id: text('meme_id').notNull().references(() => memes.id), coin_cas: text('coin_cas').array().notNull(),
  winner_ca: text('winner_ca'), grid: jsonb('grid').$type<Ruling['grid']>().notNull(), flags: jsonb('flags').$type<Ruling['flags']>().notNull(),
  config_hash: text('config_hash').notNull(), rules_version: text('rules_version').notNull(), facts_hash: text('facts_hash').notNull(), created_at: instant('created_at').notNull(), share_slug: text('share_slug').notNull().unique(),
  frozen_facts: jsonb('frozen_facts').$type<FrozenFacts>().notNull(), frozen_config: jsonb('frozen_config').$type<Rulebook>().notNull(), raw_ruling: jsonb('raw_ruling').$type<Ruling>().notNull(),
});
