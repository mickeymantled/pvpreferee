import { describe, expect, it } from 'vitest';
import { firstRealBuyAt, historicalCap, replayLedger, UnavailableHistoricalLedger } from '../src/ledger';
import { IngestService } from '../src/provider';
import type { LedgerPage, SnapshotCache } from '../src/contracts';
import { at, CA, config, events, launch, metadata, prices, service, SyntheticLedger } from './helpers';

describe('synthetic complete historical ledger', () => {
  it('returns the threshold-crossing buy; repeated wallets are counted once', () => {
    expect(firstRealBuyAt(events, config, at(40))).toBe(at(40));
    expect(firstRealBuyAt(events, config, at(39))).toBeNull();
  });
  it('uses a rolling inclusive window, with no grace window or future backdating', () => {
    const narrow = structuredClone(config); narrow.participation.first_buy_window_seconds = 20;
    expect(firstRealBuyAt(events, narrow, at(40))).toBe(at(40));
    narrow.participation.first_buy_window_seconds = 19;
    expect(firstRealBuyAt(events, narrow, at(40))).toBeNull();
  });
  it('replays all pages, bounds all future effects, and counts owners rather than accounts', async () => {
    const ledger = new SyntheticLedger();
    const before = await replayLedger(ledger, CA, at(40));
    expect(before).toMatchObject({ supply_atomic: '1000', holders: 4, distinct_buyers_lifetime: 3, last_trade_at: at(40) });
    const after = await replayLedger(ledger, CA, at(50));
    expect(after).toMatchObject({ supply_atomic: '900', holders: 3, distinct_buyers_lifetime: 3, last_trade_at: at(40) });
    expect(after.owner_balances['synthetic-alice']).toBe('200');
    expect(ledger.calls.length).toBeGreaterThan(2);
  });
  it('calculates market cap from historical supply and price and freezes raw evidence', async () => {
    const provider = service();
    const snapshot = await provider.snapshotAt(CA, at(40), config);
    expect(snapshot).toMatchObject({ complete: true, at: at(40), mcap_usd: 2000, holders: 4, distinct_buyers_lifetime: 3 });
    expect(snapshot.raw_ingest).toMatchObject({ supply_atomic: '1000', price_usd: 2 });
    expect(snapshot.raw_ingest.payloads.length).toBeGreaterThan(1);
    const facts = await provider.coinFacts(CA, config);
    expect(facts).toMatchObject({ first_real_buy_at: at(40), launch_mcap_usd: 1000, deployed_at: at(0) });
  });
  it.each(['from_mint_creation', 'finalized', 'all_token_accounts', 'all_balance_changes', 'all_supply_changes', 'all_trades', 'no_unsupported_extensions'] as const)('rejects missing %s coverage', async key => {
    const original = new SyntheticLedger();
    const bad = { page: async (...args: Parameters<SyntheticLedger['page']>) => { const p = await original.page(...args); p.coverage[key] = false; return p; } };
    await expect(replayLedger(bad, CA, at(40))).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' });
  });
  it('rejects missing pages, repeated cursors, duplicate events, gaps, wrong mint and insufficient bounds', async () => {
    const original = new SyntheticLedger(events, 100);
    for (const mutate of [
      (p: LedgerPage) => { p.next_cursor = 'loop'; },
      (p: LedgerPage) => { p.events.push(p.events[0]!); },
      (p: LedgerPage) => { p.coverage.gaps.push('missing block'); },
      (p: LedgerPage) => { p.coverage.mint = 'different'; },
      (p: LedgerPage) => { p.coverage.through = at(30); },
      (p: LedgerPage) => { p.events = p.events.filter(e => e.kind !== 'supply'); },
    ]) {
      const bad = { async page() { const p = await original.page(CA, at(40), null); mutate(p); return p; } };
      await expect(replayLedger(bad, CA, at(40), 3)).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' });
    }
  });
  it('does not treat transfers as purchases or current/missing history as zero participation', async () => {
    const p = new IngestService({ metadata, launch, ledger: new UnavailableHistoricalLedger(), prices });
    const facts = await p.coinFacts(CA, config);
    expect(facts.first_real_buy_at).toBeNull(); expect(facts.raw_ingest.history_complete).toBe(false);
    const s = await p.snapshotAt(CA, at(40), config);
    expect(s).toMatchObject({ complete: false, holders: null, mcap_usd: null, distinct_buyers_lifetime: null });
    expect(s.raw_ingest.diagnostics[0]).toContain('HISTORY_UNAVAILABLE');
  });
  it('rejects future/nearby historical prices and does not cache incomplete snapshots', async () => {
    let writes = 0;
    const cache: SnapshotCache = { async get() { return null; }, async put() { writes++; } };
    const p = new IngestService({ metadata, launch, ledger: new SyntheticLedger(), cache, prices: { async priceAt(ca, t) { const price = await prices.priceAt(ca, t); return { ...price, observed_at: at(60) }; } } });
    expect(await p.snapshotAt(CA, at(40), config)).toMatchObject({ complete: false, mcap_usd: null, holders: null });
    expect(writes).toBe(0);
  });
  it('keeps atomic arithmetic exact above the JavaScript integer limit', () => {
    expect(historicalCap('1000000000000000000', 18, 2)).toBe(2);
    expect(() => historicalCap('1', 0, Infinity)).toThrow();
  });
});
