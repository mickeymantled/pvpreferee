import type { IngestProvider, Rulebook } from '@pvp/shared';
import type { HistoricalLedger, HistoricalPriceProvider, IngestedCoinFacts, LaunchProvider, MetadataProvider, RawEvidence, ReconstructedSnapshot, SnapshotCache, Transport } from './contracts';
import { hash, IngestError, mintAddress, timestamp } from './common';
import { firstRealBuyAt, historicalCap, replayLedger, UnavailableHistoricalLedger } from './ledger';
import { HeliusAdapter } from './helius';
import { PumpFunAdapter } from './pump';
import { BirdeyeHistoricalPrice } from './birdeye';
import { FetchTransport, JsonRpcClient } from './transport';
import { createPostgresSnapshotCache } from './repository';

export interface IngestOptions {
  metadata: MetadataProvider; launch: LaunchProvider; ledger: HistoricalLedger; prices: HistoricalPriceProvider;
  cache?: SnapshotCache; now?: () => string; maxLedgerPages?: number;
}
function historicalFailure(error: unknown): error is IngestError {
  return error instanceof IngestError && ['HISTORY_UNAVAILABLE', 'INCOMPLETE_HISTORY', 'PRICE_UNAVAILABLE'].includes(error.code);
}
function checkPrice(price: Awaited<ReturnType<HistoricalPriceProvider['priceAt']>>, ca: string, at: string): void {
  if (price.mint !== ca || timestamp(price.requested_at) !== at || timestamp(price.observed_at) !== at || price.evidence.length === 0) throw new IngestError('PRICE_UNAVAILABLE', 'Historical price does not certify the exact mint and instant');
}
export class IngestService implements IngestProvider {
  constructor(private readonly options: IngestOptions) {}
  async coinFacts(ca: string, config: Rulebook): Promise<IngestedCoinFacts> {
    config = structuredClone(config);
    mintAddress(ca);
    const observed = timestamp((this.options.now ?? (() => new Date().toISOString()))());
    const [metadata, launch] = await Promise.all([this.options.metadata.metadata(ca), this.options.launch.launch(ca)]);
    const facts: IngestedCoinFacts = {
      ca, meme_id: null, chain: 'solana', name: metadata.name, ticker: metadata.ticker, image_url: metadata.image_url, image_hash: null,
      mint_authority: metadata.mint_authority, freeze_authority: metadata.freeze_authority,
      launchpad: launch.launchpad, pair_asset: launch.pair_asset, creator_wallet: launch.creator_wallet, fee_wallet: launch.fee_wallet,
      deployed_at: launch.deployed_at, bonded_at: launch.bonded_at, first_real_buy_at: null, launch_mcap_usd: null,
      beneficiary_claimable: null, fee_tie_at: null, subject_held_supply_pct: null, endorsements: [], snapshots: [],
      flags: { warnings: [...launch.warnings] }, evidence: [...metadata.evidence, ...launch.evidence], observed_at: observed,
      raw_ingest: { config_hash: hash(config), payloads: [...metadata.raw, ...launch.raw], history_complete: false },
    };
    try {
      const ledger = await replayLedger(this.options.ledger, ca, observed, this.options.maxLedgerPages);
      facts.raw_ingest.payloads.push(...ledger.raw); facts.raw_ingest.history_complete = true;
      facts.first_real_buy_at = firstRealBuyAt(ledger.events, config, observed);
      facts.deployed_at = ledger.deployed_at; facts.bonded_at = ledger.bonded_at;
      facts.evidence.push(...ledger.evidence);
      // Reconstruct supply at launch too: never multiply launch price by current supply.
      const launchLedger = await replayLedger(this.options.ledger, ca, ledger.deployed_at, this.options.maxLedgerPages);
      const price = await this.options.prices.priceAt(ca, ledger.deployed_at);
      checkPrice(price, ca, ledger.deployed_at);
      facts.launch_mcap_usd = historicalCap(launchLedger.supply_atomic, launchLedger.decimals, price.price_usd);
      facts.raw_ingest.payloads.push(...launchLedger.raw, price.raw); facts.evidence.push(...price.evidence);
    } catch (error) {
      if (!historicalFailure(error)) throw error;
      facts.flags.warnings!.push(`${error.code}: ${error.message}`);
    }
    return facts;
  }
  async snapshotAt(ca: string, at: string, config: Rulebook): Promise<ReconstructedSnapshot> {
    config = structuredClone(config);
    mintAddress(ca); const requested = timestamp(at), configHash = hash(config);
    const cached = await this.options.cache?.get(ca, requested, configHash);
    if (cached) {
      if (cached.coin_ca !== ca || timestamp(cached.at) !== requested || cached.config_hash !== configHash || !cached.complete) throw new IngestError('IMMUTABLE_CONFLICT', 'Snapshot cache returned an inconsistent record');
      return cached;
    }
    const payloads: RawEvidence[] = [];
    const snapshot: ReconstructedSnapshot = {
      id: hash({ ca, at: requested, config_hash: configHash }), coin_ca: ca, at: requested, config_hash: configHash,
      mcap_usd: null, holders: null, distinct_buyers_lifetime: null, last_trade_at: null, source: 'complete-ledger+historical-price',
      complete: false, evidence: [], raw_ingest: { payloads, supply_atomic: null, decimals: null, price_usd: null, diagnostics: [] },
    };
    try {
      const ledger = await replayLedger(this.options.ledger, ca, requested, this.options.maxLedgerPages);
      payloads.push(...ledger.raw); snapshot.evidence.push(...ledger.evidence);
      const price = await this.options.prices.priceAt(ca, requested);
      checkPrice(price, ca, requested); payloads.push(price.raw);
      snapshot.mcap_usd = historicalCap(ledger.supply_atomic, ledger.decimals, price.price_usd);
      snapshot.holders = ledger.holders; snapshot.distinct_buyers_lifetime = ledger.distinct_buyers_lifetime; snapshot.last_trade_at = ledger.last_trade_at;
      snapshot.evidence.push(...price.evidence); snapshot.complete = true;
      snapshot.raw_ingest.supply_atomic = ledger.supply_atomic; snapshot.raw_ingest.decimals = ledger.decimals; snapshot.raw_ingest.price_usd = price.price_usd;
    } catch (error) {
      if (!historicalFailure(error)) throw error;
      snapshot.raw_ingest.diagnostics.push(`${error.code}: ${error.message}`);
      return snapshot; // Incomplete results are deliberately NOT cached as immutable facts.
    }
    await this.options.cache?.put(snapshot, config);
    return this.options.cache ? (await this.options.cache.get(ca, requested, configHash)) ?? snapshot : snapshot;
  }
}
export interface EnvironmentOptions { env?: NodeJS.ProcessEnv; transport?: Transport; ledger?: HistoricalLedger; cache?: SnapshotCache; now?: () => string }
export type CloseableIngestProvider = IngestProvider & { close(): Promise<void> };
/** No I/O at construction. No built-in API can attest mint-wide historical completeness. */
export function createIngestFromEnv(options: EnvironmentOptions = {}): CloseableIngestProvider {
  const env = options.env ?? process.env;
  const endpoint = env.HELIUS_RPC_URL || (env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}` : null);
  if (!endpoint) throw new IngestError('INVALID_INPUT', 'Set HELIUS_API_KEY or HELIUS_RPC_URL');
  const transport = options.transport ?? new FetchTransport(env.INGEST_TIMEOUT_MS ? Number(env.INGEST_TIMEOUT_MS) : 10_000);
  const rpc = new JsonRpcClient(endpoint, transport);
  const ownedCache = !options.cache && env.DATABASE_URL ? createPostgresSnapshotCache(env.DATABASE_URL) : null;
  const service = new IngestService({ metadata: new HeliusAdapter(rpc, options.now), launch: new PumpFunAdapter(rpc, transport, env.PUMP_API_BASE_URL, options.now),
    ledger: options.ledger ?? new UnavailableHistoricalLedger(), prices: new BirdeyeHistoricalPrice(env.BIRDEYE_API_KEY ?? '', transport, env.BIRDEYE_API_BASE_URL, options.now), cache: options.cache ?? ownedCache ?? undefined, now: options.now });
  return { coinFacts: service.coinFacts.bind(service), snapshotAt: service.snapshotAt.bind(service), close: async () => { await ownedCache?.close(); } };
}
