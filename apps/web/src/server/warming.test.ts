import { describe, expect, it, vi } from 'vitest';
import { loadRulebook } from '@pvp/config';
import type { Snapshot } from '@pvp/shared';
import { CAS } from '../test/fixtures';
import { UnsupportedTrendingProvider, warmTrending, type TrendingProvider } from './warming';

const at = '2026-10-28T12:00:00Z';
const ranking = { status: 'ok' as const, mints: CAS, asOf: at, evidence: 'https://synthetic.example/ranking', methodology: 'Synthetic test ranking; not provider evidence' };
const provider: TrendingProvider = { top50: async () => ranking };
const snapshot = (ca: string, complete = true): Snapshot => ({ id: 'synthetic-' + ca, coin_ca: ca, at, mcap_usd: null, holders: null, distinct_buyers_lifetime: null, last_trade_at: null, source: 'synthetic warming boundary', complete, evidence: [] });
describe('single-run warming with injected synthetic providers', () => {
  it('reports unsupported without fetching anything', async () => {
    const snapshotAt = vi.fn(), coinFacts = vi.fn();
    expect(await warmTrending(new UnsupportedTrendingProvider(), { snapshotAt, coinFacts }, loadRulebook().config, at)).toMatchObject({ status: 'unsupported', results: [] });
    expect(snapshotAt).not.toHaveBeenCalled();
    expect(coinFacts).not.toHaveBeenCalled();
  });
  it('isolates failures and incomplete history without claiming cached success', async () => {
    const report = await warmTrending(provider, { coinFacts: vi.fn(), snapshotAt: async ca => { if (ca === CAS[0]) throw new Error('secret upstream details'); return snapshot(ca, false); } }, loadRulebook().config, at);
    expect(report.status).toBe('partial');
    expect(report.results.map(row => row.status)).toEqual(['failed', 'incomplete']);
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('bounds concurrency and retains provider rank order', async () => {
    const mints = Array.from({ length: 50 }, (_, i) => '1'.repeat(31) + '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[i]);
    let active = 0, maximum = 0;
    const report = await warmTrending({ top50: async () => ({ ...ranking, mints }) }, { coinFacts: vi.fn(), snapshotAt: async ca => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return snapshot(ca);
    } }, loadRulebook().config, at, 3);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(maximum).toBeGreaterThan(1);
    expect(report.status).toBe('complete');
    expect(report.results.map(row => row.ca)).toEqual(mints);
  });
  it('rejects missing ranking semantics, duplicates, oversized lists and provider failure', async () => {
    const snapshotAt = vi.fn();
    for (const patch of [{ methodology: '' }, { evidence: '' }, { mints: ['z'.repeat(44)] }, { mints: [...CAS, CAS[0]!] }, { mints: Array.from({ length: 51 }, () => CAS[0]!) }]) {
      const result = await warmTrending({ top50: async () => ({ ...ranking, ...patch }) }, { coinFacts: vi.fn(), snapshotAt }, loadRulebook().config, at);
      expect(result.status).toBe('failed');
    }
    expect(snapshotAt).not.toHaveBeenCalled();
    expect((await warmTrending({ top50: async () => { throw new Error('Unavailable'); } }, { coinFacts: vi.fn(), snapshotAt }, loadRulebook().config, at)).status).toBe('failed');
  });
});
