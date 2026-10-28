import type { Rulebook } from '@pvp/shared';
import type { HistoricalLedger, LedgerEvent, LedgerPage, RawEvidence } from './contracts';
import { hash, IngestError, json, nonnegativeInteger, timestamp } from './common';

export class UnavailableHistoricalLedger implements HistoricalLedger {
  async page(): Promise<LedgerPage> {
    throw new IngestError('HISTORY_UNAVAILABLE', 'A complete mint-wide HistoricalLedger indexer is required. Helius mint-address history and owner tokenAccounts filters cannot certify all token accounts, including closed accounts.');
  }
}
export interface ReplayedLedger {
  events: LedgerEvent[]; raw: RawEvidence[]; evidence: string[]; decimals: number;
  supply_atomic: string; owner_balances: Record<string, string>; holders: number;
  distinct_buyers_lifetime: number; last_trade_at: string | null; deployed_at: string; bonded_at: string | null;
}
function atomic(value: string, signed = false): bigint {
  if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)) {
    throw new IngestError('INCOMPLETE_HISTORY', 'Ledger contains an invalid atomic amount');
  }
  return BigInt(value);
}
function compare(a: LedgerEvent, b: LedgerEvent): number {
  return a.position.slot - b.position.slot || a.position.transaction_index - b.position.transaction_index || a.position.event_index - b.position.event_index;
}
function requireHistory(condition: unknown, message: string): asserts condition {
  if (!condition) throw new IngestError('INCOMPLETE_HISTORY', message);
}
/** Reads every page, requires consistent coverage and replays ONLY events at or before T.
 * Future events are excluded even if an injected indexer overfetches. */
export async function replayLedger(provider: HistoricalLedger, ca: string, at: string, maxPages = 10_000): Promise<ReplayedLedger> {
  const through = timestamp(at);
  requireHistory(Number.isSafeInteger(maxPages) && maxPages > 0, 'Invalid ledger page budget');
  const events: LedgerEvent[] = [], raw: RawEvidence[] = [], evidence = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null, certificate: string | null = null;
  for (let pageNumber = 0; ; pageNumber++) {
    requireHistory(pageNumber < maxPages, 'Ledger pagination budget exhausted; history remains incomplete');
    const page = await provider.page(ca, through, cursor);
    const c = page.coverage;
    requireHistory(c.mint === ca && timestamp(c.through) === through, 'Ledger coverage must match the mint and exact requested instant');
    requireHistory(c.from_mint_creation === true && c.finalized === true && c.all_token_accounts === true && c.all_balance_changes === true && c.all_supply_changes === true && c.all_trades === true && c.no_unsupported_extensions === true && Array.isArray(c.gaps) && c.gaps.length === 0 && c.evidence.length > 0, 'Indexer did not attest complete finalized mint-wide history');
    requireHistory(certificate === null || certificate === hash(c), 'Ledger coverage changed between pages');
    certificate = hash(c);
    c.evidence.forEach(e => evidence.add(e));
    raw.push(page.raw);
    raw.push({ source: 'ingest:normalized-ledger-page', fetched_at: page.raw.fetched_at,
      payload: json({ coverage: c, cursor, next_cursor: page.next_cursor, events: page.events }) });
    for (const event of page.events) {
      if (Date.parse(timestamp(event.at)) <= Date.parse(through)) events.push(event);
    }
    if (page.next_cursor === null) break;
    requireHistory(typeof page.next_cursor === 'string' && page.next_cursor.length > 0 && !cursors.has(page.next_cursor), 'Ledger pagination repeated or returned an invalid cursor');
    cursor = page.next_cursor; cursors.add(cursor);
  }
  for (const e of events) {
    nonnegativeInteger(e.position.slot, 'slot'); nonnegativeInteger(e.position.transaction_index, 'transaction index'); nonnegativeInteger(e.position.event_index, 'event index');
    requireHistory(typeof e.id === 'string' && e.id.length > 0 && e.evidence.length > 0, 'Every ledger event requires an identity and source evidence');
  }
  events.sort(compare);
  const first = events[0];
  requireHistory(first?.kind === 'initialize', 'Mint initialization evidence missing at requested instant');
  const decimals = nonnegativeInteger(first.decimals, 'mint decimals');
  requireHistory(decimals <= 255, 'Invalid mint decimals');
  const accounts = new Map<string, { owner: string; balance: bigint }>(), buyers = new Set<string>(), ids = new Set<string>();
  let supply = 0n, lastTrade: string | null = null, bondedAt: string | null = null;
  const reconcile = () => requireHistory([...accounts.values()].reduce((total, a) => total + a.balance, 0n) === supply, 'Historical balances do not reconcile with historical supply');
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    requireHistory(!ids.has(e.id), 'Duplicate ledger event; refusing double counting'); ids.add(e.id);
    if (i > 0) {
      const previous = events[i - 1]!;
      requireHistory(compare(previous, e) < 0, 'Ambiguous execution ordering');
      requireHistory(Date.parse(e.at) >= Date.parse(previous.at), 'Nonmonotonic block time needs indexer reconciliation');
      if (previous.position.slot !== e.position.slot || previous.position.transaction_index !== e.position.transaction_index) reconcile();
    }
    e.evidence.forEach(v => evidence.add(v));
    switch (e.kind) {
      case 'initialize': requireHistory(i === 0, 'Duplicate mint initialization'); break;
      case 'supply': supply += atomic(e.delta_atomic, true); requireHistory(supply >= 0n, 'Negative historical supply'); break;
      case 'balance':
        requireHistory(Boolean(e.account) && Boolean(e.owner), 'Balance missing account or owner');
        accounts.set(e.account, { owner: e.owner, balance: atomic(e.amount_atomic) }); break;
      case 'close':
        requireHistory(accounts.has(e.account) && accounts.get(e.account)!.balance === 0n, 'Closing missing or nonempty token account');
        accounts.delete(e.account); break;
      case 'trade':
        requireHistory((e.side === 'buy' || e.side === 'sell') && Boolean(e.wallet) && atomic(e.token_atomic) > 0n && atomic(e.quote_atomic) > 0n, 'Trade needs a classified buy/sell, wallet and nonzero exchanged amounts');
        lastTrade = timestamp(e.at); if (e.side === 'buy') buyers.add(e.wallet); break;
      case 'bonded': bondedAt ??= timestamp(e.at); break;
      default: throw new IngestError('INCOMPLETE_HISTORY', 'Unsupported ledger event');
    }
  }
  reconcile();
  const owners = new Map<string, bigint>();
  for (const a of accounts.values()) owners.set(a.owner, (owners.get(a.owner) ?? 0n) + a.balance);
  return {
    events, raw, evidence: [...evidence], decimals, supply_atomic: supply.toString(),
    owner_balances: Object.fromEntries([...owners].filter(([, balance]) => balance > 0n).map(([owner, balance]) => [owner, balance.toString()])),
    holders: [...owners.values()].filter(v => v > 0n).length, distinct_buyers_lifetime: buyers.size,
    last_trade_at: lastTrade, deployed_at: timestamp(first.at), bonded_at: bondedAt,
  };
}
/** The threshold-crossing buy's timestamp. No backdating to the first buyer in its window. */
export function firstRealBuyAt(events: readonly LedgerEvent[], config: Rulebook, through: string): string | null {
  const { min_distinct_buyers: minimum, first_buy_window_seconds: seconds } = config.participation;
  if (!Number.isSafeInteger(minimum) || minimum < 1 || !Number.isFinite(seconds) || seconds <= 0) throw new IngestError('INVALID_INPUT', 'Invalid participation window or minimum buyers');
  const bound = Date.parse(timestamp(through));
  const buys = events.filter((e): e is LedgerEvent & { kind: 'trade' } => e.kind === 'trade' && e.side === 'buy' && Date.parse(timestamp(e.at)) <= bound).sort(compare);
  const counts = new Map<string, number>();
  let left = 0;
  for (let i = 0; i < buys.length; i++) {
    const buy = buys[i]!;
    while (left < i && Date.parse(buys[left]!.at) < Date.parse(buy.at) - seconds * 1000) {
      const wallet = buys[left++]!.wallet, count = counts.get(wallet)! - 1;
      if (count === 0) counts.delete(wallet); else counts.set(wallet, count);
    }
    counts.set(buy.wallet, (counts.get(buy.wallet) ?? 0) + 1);
    if (counts.size >= minimum) return timestamp(buy.at);
  }
  return null;
}
export function historicalCap(supplyAtomic: string, decimals: number, price: number): number {
  const digits = atomic(supplyAtomic).toString().padStart(decimals + 1, '0');
  const supply = Number(decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`);
  const cap = supply * price;
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cap)) throw new IngestError('PRICE_UNAVAILABLE', 'Historical price or market cap is invalid');
  return cap;
}
