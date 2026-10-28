import type { CoinFacts, Rulebook, Snapshot, Timestamp } from '@pvp/shared';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface RawEvidence { source: string; fetched_at: Timestamp; payload: Json }
export interface HttpRequest { url: string; method: 'GET' | 'POST'; headers?: Record<string, string>; body?: Json; timeoutMs?: number }
export interface HttpResponse { status: number; body: unknown }
export interface Transport { request(request: HttpRequest): Promise<HttpResponse> }

/** A finalized execution position, not a provider's arrival order. */
export interface LedgerPosition { slot: number; transaction_index: number; event_index: number }
interface EventBase { id: string; at: Timestamp; position: LedgerPosition; evidence: string[] }
export type LedgerEvent = EventBase & (
  | { kind: 'initialize'; decimals: number }
  | { kind: 'supply'; delta_atomic: string }
  | { kind: 'balance'; account: string; owner: string; amount_atomic: string }
  | { kind: 'close'; account: string }
  | { kind: 'trade'; side: 'buy' | 'sell'; wallet: string; token_atomic: string; quote_atomic: string }
  | { kind: 'bonded' }
);
/** An attestation by the indexer, including closed/non-ATA accounts and failed-tx exclusion.
 * No built-in address-history endpoint is assumed to satisfy this contract. */
export interface LedgerCoverage {
  mint: string; through: Timestamp; from_mint_creation: boolean; finalized: boolean;
  all_token_accounts: boolean; all_balance_changes: boolean; all_supply_changes: boolean;
  all_trades: boolean; no_unsupported_extensions: boolean; gaps: string[]; evidence: string[];
}
export interface LedgerPage {
  events: LedgerEvent[]; next_cursor: string | null; coverage: LedgerCoverage; raw: RawEvidence;
}
export interface HistoricalLedger {
  page(ca: string, through: Timestamp, cursor: string | null): Promise<LedgerPage>;
}
export interface HistoricalPrice {
  mint: string; requested_at: Timestamp; observed_at: Timestamp; price_usd: number;
  evidence: string[]; raw: RawEvidence;
}
export interface HistoricalPriceProvider { priceAt(ca: string, at: Timestamp): Promise<HistoricalPrice> }
export interface MetadataFacts {
  name: string; ticker: string; image_url: string | null; mint_authority: string | null;
  freeze_authority: string | null; evidence: string[]; raw: RawEvidence[];
}
export interface MetadataProvider { metadata(ca: string): Promise<MetadataFacts> }
export interface LaunchFacts {
  launchpad: string | null; pair_asset: string | null; creator_wallet: string | null;
  fee_wallet: string | null; deployed_at: Timestamp | null; bonded_at: Timestamp | null;
  evidence: string[]; raw: RawEvidence[]; warnings: string[];
}
export interface LaunchProvider { launch(ca: string): Promise<LaunchFacts> }
export interface IngestedCoinFacts extends CoinFacts {
  raw_ingest: { config_hash: string; payloads: RawEvidence[]; history_complete: boolean };
}
export interface ReconstructedSnapshot extends Snapshot {
  raw_ingest: { payloads: RawEvidence[]; supply_atomic: string | null; decimals: number | null; price_usd: number | null; diagnostics: string[] };
}
export interface SnapshotCache {
  get(ca: string, at: Timestamp, configHash: string): Promise<ReconstructedSnapshot | null>;
  put(snapshot: ReconstructedSnapshot, config: Rulebook): Promise<void>;
}
