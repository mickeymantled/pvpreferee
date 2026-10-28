/** Frozen phase-0 contracts. Timestamps are ISO-8601 UTC. Unknown data is null, never guessed. */
export type Timestamp = string;
export type Chain = string;
export type RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type SourceTier = 'subject_post' | 'official_asset' | 'site_text' | 'wiki';
export type MemeScope = 'artifact' | 'concept';
export interface Evidence { url: string; label?: string; at?: Timestamp }
export interface OverrideEntry { field: string; previous: unknown; value: unknown; actor: string; at: Timestamp; reason: string }
export interface PressCandidate { value: string; articles: string[] }
export interface MemeRecord {
  id: string; slug: string; scope: MemeScope; canonical_name: string; canonical_ticker: string;
  source_url: string; source_tier: SourceTier; source_image_hash: string | null; source_image_url: string | null;
  subject_handle: string | null; home_chain: Chain | null; implied_pair: string | null;
  beneficiary_wallet: string | null; beneficiary_tie_at: Timestamp | null; created_by: string;
  source_launchpad: string | null; overrides: OverrideEntry[]; evidence: string[];
  press_candidates?: PressCandidate[]; resolved?: boolean;
}
export interface Snapshot {
  id: string; coin_ca: string; at: Timestamp; mcap_usd: number | null; holders: number | null;
  distinct_buyers_lifetime: number | null; last_trade_at: Timestamp | null; source: string;
  complete: boolean; evidence: string[]; config_hash?: string;
}
export interface Endorsement {
  coin_ca: string; kind: 'ca_post' | 'majority_supply' | 'fee_claim';
  evidence_url: string | null; evidence_tx: string | null; at: Timestamp; verified_by: string | null;
  subject_wallet: string | null; subject_held_supply_pct: number | null;
}
export interface DisplayFlags {
  top10_pct?: number | null; creator_launches_30d?: number | null; dev_sold?: boolean | null;
  cto?: boolean | null; dex_paid?: boolean | null; verified_badges?: string[]; bundled?: boolean | null;
  warnings?: string[];
}
export interface CoinFacts {
  ca: string; meme_id: string | null; chain: Chain; launchpad: string | null; pair_asset: string | null;
  name: string; ticker: string; image_hash: string | null; image_url: string | null;
  creator_wallet: string | null; fee_wallet: string | null; deployed_at: Timestamp | null;
  first_real_buy_at: Timestamp | null; bonded_at: Timestamp | null;
  mint_authority: string | null; freeze_authority: string | null; launch_mcap_usd: number | null;
  beneficiary_claimable: boolean | null; fee_tie_at: Timestamp | null; subject_held_supply_pct: number | null;
  endorsements: Endorsement[]; snapshots: Snapshot[]; flags: DisplayFlags; evidence: string[];
  scope?: MemeScope; observed_at: Timestamp;
}
export interface RuleDefinition { id: RuleId; key: string; name: string; description: string }
export interface Rulebook {
  version: string; rules: RuleDefinition[];
  participation: { min_distinct_buyers: number; first_buy_window_seconds: number; min_cap_above_launch_usd: number; pvp_grace_seconds: 0; post_rival_window_seconds: 0 };
  identity: { hash_bits: 64; max_image_hamming_distance: number; exact_spelling: true; source_hierarchy: SourceTier[]; press_sources: string[] };
  endorsement: { selection: 'most_subject_held_supply'; fixed_minimum_supply_pct: null };
  pair: { default_asset: string; meme_pairs: Record<string, string> };
  beneficiary: { require_pre_rival_tie: true; require_claimable: true };
}
export type RulebookConfig = Rulebook;
export interface LoadedRulebook { config: Rulebook; hash: string }
export type RuleResult = 'pass' | 'fail' | 'na';
export interface RuleCheck { result: RuleResult; reason?: string; evidence?: string[] }
export interface CoinGrid {
  coin: string; eliminated_by: RuleId | null; rules: Record<RuleId, RuleCheck>; flags: DisplayFlags;
}
export type RulingStatus = 'resolved' | 'unresolved' | 'separate_memes' | 'no_winner';
export interface FrozenFacts { coins: CoinFacts[]; meme: MemeRecord; config: Rulebook }
export interface Ruling {
  id: string; meme_id: string; coin_cas: string[]; winner_ca: string | null; ranked_cas: string[];
  status: RulingStatus; grid: CoinGrid[]; flags: Record<string, DisplayFlags>;
  config_hash: string; rules_version: string; facts_hash: string; created_at: Timestamp; share_slug: string;
  facts: FrozenFacts;
}
export interface SourceResolution { meme: MemeRecord | null; endorsements: Endorsement[]; needs_review: boolean; reasons: string[] }
export interface IngestProvider {
  coinFacts(ca: string, config: Rulebook): Promise<CoinFacts>;
  snapshotAt(ca: string, at: Timestamp, config: Rulebook): Promise<Snapshot>;
}
export interface SourceProvider { resolve(url: string, config: Rulebook): Promise<SourceResolution> }
export interface RulingRepository {
  save(ruling: Ruling): Promise<void>;
  findBySlug(slug: string): Promise<Ruling | null>;
}
export interface RuleFixture {
  name: string; description: string; synthetic: true; coins: CoinFacts[]; meme: MemeRecord;
  expected: { winner_ca: string | null; status: RulingStatus; eliminated_by: Record<string, RuleId | null> };
}
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error('Cannot hash undefined');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}';
}
