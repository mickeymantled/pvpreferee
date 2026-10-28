import type { CoinFacts, Endorsement, MemeRecord, RuleFixture, Snapshot } from '@pvp/shared';

/** All helpers create invented offline records, never captured on-chain facts. */
export const ca = { A: 'A'.repeat(43), B: 'B'.repeat(43), C: 'C'.repeat(43) };
export const at = {
  before: '2026-09-30T10:00:00.000Z', a: '2026-10-01T10:00:00.000Z',
  b: '2026-10-02T10:00:00.000Z', c: '2026-10-03T10:00:00.000Z', observed: '2026-10-28T12:00:00.000Z',
};
export const syntheticUrl = (name: string): string => 'https://example.invalid/synthetic-pvp-fixtures/' + name;
export function meme(name: string, fields: Partial<MemeRecord> = {}): MemeRecord {
  return {
    id: 'synthetic:' + name, slug: name, scope: 'artifact', canonical_name: name, canonical_ticker: name.toUpperCase(),
    source_url: syntheticUrl(name + '/source'), source_tier: 'subject_post', source_image_hash: null, source_image_url: null,
    subject_handle: null, home_chain: null, implied_pair: null, beneficiary_wallet: null, beneficiary_tie_at: null,
    created_by: 'synthetic-fixture-author', source_launchpad: null, overrides: [], evidence: [syntheticUrl(name + '/record')], resolved: true,
    ...fields,
  };
}
export function coin(record: MemeRecord, slot: keyof typeof ca, fields: Partial<CoinFacts> = {}): CoinFacts {
  return {
    ca: ca[slot], meme_id: record.id, chain: 'solana', launchpad: 'synthetic-pad', pair_asset: 'SOL',
    name: record.canonical_name, ticker: record.canonical_ticker,
    // Explicit synthetic, dissimilar 64-bit hashes. The brief does not supply real image evidence.
    image_hash: { A: '0000000000000000', B: 'ffffffffffffffff', C: 'aaaaaaaaaaaaaaaa' }[slot], image_url: syntheticUrl(record.slug + '/' + slot + '/image'),
    creator_wallet: 'synthetic-creator-' + slot, fee_wallet: 'synthetic-fees-' + slot,
    deployed_at: at.before, first_real_buy_at: at[slot.toLowerCase() as 'a' | 'b' | 'c'], bonded_at: null,
    mint_authority: null, freeze_authority: null, launch_mcap_usd: 2_000, beneficiary_claimable: false,
    fee_tie_at: null, subject_held_supply_pct: null, endorsements: [], snapshots: [], flags: {},
    evidence: [syntheticUrl(record.slug + '/' + slot + '/facts')], scope: record.scope, observed_at: at.observed,
    ...fields,
  };
}
export function snapshot(coin: CoinFacts, instant: string, fields: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'synthetic:' + coin.ca + ':' + instant, coin_ca: coin.ca, at: instant, mcap_usd: 25_000, holders: 100,
    distinct_buyers_lifetime: 100, last_trade_at: instant, source: 'synthetic fixture; not provider data', complete: true,
    evidence: [syntheticUrl(coin.ca + '/snapshot/' + instant)], ...fields,
  };
}
export function endorsement(coin: CoinFacts, supply: number | null, kind: Endorsement['kind'] = 'majority_supply'): Endorsement {
  return {
    coin_ca: coin.ca, kind, evidence_url: syntheticUrl(coin.ca + '/subject-post'), evidence_tx: null,
    at: coin.first_real_buy_at!, verified_by: 'synthetic-verifier', subject_wallet: 'synthetic-subject-wallet', subject_held_supply_pct: supply,
  };
}
export function fixture(name: string, description: string, record: MemeRecord, coins: CoinFacts[], expected: RuleFixture['expected']): RuleFixture {
  return { name, description: 'SYNTHETIC, not verified historical data. ' + description, synthetic: true, meme: record, coins, expected };
}
