import { getAddressDecoder } from '@solana/addresses';
import type { MemeRecord, Ruling, Rulebook } from '@pvp/shared';
import configJson from '../../../config/rulebook.v1.json';
import fixture from '../fixtures/ledger.synthetic.json';
import type { HistoricalLedger, HistoricalPriceProvider, LedgerEvent, LedgerPage, LaunchProvider, MetadataProvider } from '../src/contracts';
import { hash, json } from '../src/common';
import { IngestService } from '../src/provider';

export const CA = getAddressDecoder().decode(new Uint8Array(32).fill(7));
export const CREATOR = getAddressDecoder().decode(new Uint8Array(32).fill(9));
export const config = configJson as Rulebook;
export const at = (second: number) => new Date(Date.parse('2026-10-28T00:00:00.000Z') + second * 1000).toISOString();
export const events: LedgerEvent[] = fixture.transactions.flatMap((tx, transaction_index) => tx.events.map((event, event_index) => ({ ...event,
  id: `synthetic:${transaction_index}:${event_index}`, at: at(tx.second), position: { slot: transaction_index + 1, transaction_index: 0, event_index }, evidence: [`synthetic:tx:${transaction_index}`],
} as LedgerEvent)));
export class SyntheticLedger implements HistoricalLedger {
  calls: string[] = [];
  constructor(public records = structuredClone(events), public pageSize = 7) {}
  async page(ca: string, through: string, cursor: string | null): Promise<LedgerPage> {
    this.calls.push(through);
    const offset = cursor === null ? 0 : Number(cursor), end = offset + this.pageSize;
    const pageEvents = this.records.slice(offset, end); // Intentionally overfetch: engine must bound at T.
    return { events: pageEvents, next_cursor: end < this.records.length ? String(end) : null,
      coverage: { mint: ca, through, from_mint_creation: true, finalized: true, all_token_accounts: true, all_balance_changes: true,
        all_supply_changes: true, all_trades: true, no_unsupported_extensions: true, gaps: [], evidence: ['synthetic:coverage'] },
      raw: { source: 'synthetic:ledger', fetched_at: at(100), payload: json({ synthetic: true, events: pageEvents }) } };
  }
}
export const prices: HistoricalPriceProvider = { async priceAt(ca, requested) {
  const second = (Date.parse(requested) - Date.parse(at(0))) / 1000;
  const price = (fixture.prices as Record<string, number>)[String(second)];
  if (price === undefined) throw new Error('Synthetic fixture has no price for this instant');
  return { mint: ca, requested_at: requested, observed_at: requested, price_usd: price, evidence: ['synthetic:price'], raw: { source: 'synthetic:price', fetched_at: at(100), payload: { synthetic: true, price, at: requested } } };
} };
export const metadata: MetadataProvider = { async metadata() { return { name: 'Synthetic Cat', ticker: 'SYNTH', image_url: null, mint_authority: null, freeze_authority: null, evidence: ['synthetic:metadata'], raw: [{ source: 'synthetic:metadata', fetched_at: at(100), payload: { synthetic: true } }] }; } };
export const launch: LaunchProvider = { async launch() { return { launchpad: 'pump.fun', pair_asset: 'SOL', creator_wallet: CREATOR, fee_wallet: CREATOR, deployed_at: null, bonded_at: null, evidence: ['synthetic:launch'], raw: [], warnings: [] }; } };
export const service = () => new IngestService({ metadata, launch, ledger: new SyntheticLedger(), prices, now: () => at(50) });
export const meme: MemeRecord = { id: 'synthetic-meme', slug: 'synthetic-meme', scope: 'artifact', canonical_name: 'Synthetic Cat', canonical_ticker: 'SYNTH', source_url: 'https://example.invalid/synthetic', source_tier: 'subject_post', source_image_hash: null, source_image_url: null, subject_handle: null, home_chain: null, implied_pair: null, beneficiary_wallet: null, beneficiary_tie_at: null, created_by: 'synthetic-brian', source_launchpad: null, overrides: [], evidence: ['synthetic:source'] };
export async function makeRuling(id: string): Promise<Ruling> {
  const coin = await service().coinFacts(CA, config);
  coin.snapshots.push(await service().snapshotAt(CA, at(40), config));
  const facts = { coins: [coin], meme: structuredClone(meme), config: structuredClone(config) };
  return { id, share_slug: id, meme_id: meme.id, coin_cas: [CA], winner_ca: null, ranked_cas: [CA], status: 'unresolved', grid: [], flags: {}, config_hash: hash(config), rules_version: config.version, facts_hash: hash(facts), created_at: at(100), facts };
}
