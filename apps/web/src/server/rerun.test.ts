import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRulebookRegistry, hashRulebook, loadRulebook } from '@pvp/config';
import { canonicalJson } from '@pvp/shared';
import { rule } from '@pvp/rules';
import { robotaxi } from '../../../../packages/rules/fixtures/robotaxi';
import { gridDiff, rerunStoredRuling, type DerivedSnapshot } from './rerun';

function fixture() {
  // Reuse the explicitly synthetic robotaxi dispute; never live facts.
  const facts = structuredClone(robotaxi), { config, hash } = loadRulebook();
  for (const coin of facts.coins) for (const snapshot of coin.snapshots) snapshot.config_hash = hash;
  return rule(facts.coins, facts.meme, config);
}
describe('immutable historical re-evaluation', () => {
  it('saves a new UUID and timestamp, preserving the old payload and canonical hash', async () => {
    const saved = fixture(), original = structuredClone(saved), save = vi.fn();
    const result = await rerunStoredRuling(saved.share_slug, 'v1', { findBySlug: async () => saved, save }, { uuid: () => 'synthetic-new-id', now: () => new Date('2026-10-28T12:00:00Z') });
    expect(saved).toEqual(original);
    expect(result.id).toBe('synthetic-new-id');
    expect(result.created_at).toBe('2026-10-28T12:00:00.000Z');
    expect(result.facts_hash).toBe(createHash('sha256').update(canonicalJson(result.facts)).digest('hex'));
    expect(result.facts).toEqual(saved.facts);
    expect(gridDiff(saved, result)).toEqual([]);
    expect(save).toHaveBeenCalledWith(result);
  });
  it('synthetic v2 retains usable snapshots and exact original envelopes without claiming new observations', async () => {
    const saved = fixture(), original = structuredClone(saved);
    const v2 = { ...loadRulebook().config, version: 'v2' };
    const registry = createRulebookRegistry([loadRulebook().config, v2]);
    const result = await rerunStoredRuling(saved.share_slug, 'v2', { findBySlug: async () => saved, save: vi.fn() }, { load: registry.load });
    expect(result.status).toBe(saved.status);
    expect(result.winner_ca).toBe(saved.winner_ca);
    expect(saved).toEqual(original);
    const snapshots = result.facts.coins.flatMap(c => c.snapshots) as DerivedSnapshot[];
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.config_hash).toBe(hashRulebook(v2));
      expect(snapshot.reevaluation.original.config_hash).toBe(saved.config_hash);
      expect(snapshot.reevaluation.from_facts_hash).toBe(saved.facts_hash);
      expect(snapshot.id).not.toBe(snapshot.reevaluation.original.id);
      expect(snapshot.source).toContain('no new observation');
      expect(snapshot.at).toBe(snapshot.reevaluation.original.at);
      expect(snapshot.mcap_usd).toBe(snapshot.reevaluation.original.mcap_usd);
      expect(snapshot.reevaluation.original).toEqual(saved.facts.coins.flatMap(c => c.snapshots).find(s => s.id === snapshot.reevaluation.original.id));
    }
    const replay = rule(result.facts.coins, result.facts.meme, result.facts.config);
    expect(replay.grid).toEqual(result.grid);
    expect(replay.facts_hash).toBe(result.facts_hash);
  });
  it.each(['min_distinct_buyers', 'first_buy_window_seconds'] as const)('blocks changed %s before saving', async key => {
    const saved = fixture(), v2 = { ...loadRulebook().config, version: 'v2' }, save = vi.fn();
    v2.participation[key]++;
    const registry = createRulebookRegistry([v2]);
    await expect(rerunStoredRuling(saved.share_slug, 'v2', { findBySlug: async () => saved, save }, { load: registry.load })).rejects.toThrow('Fresh ingest required');
    expect(save).not.toHaveBeenCalled();
  });
  it('allows a cap-only threshold change and exposes the grid diff', async () => {
    const saved = fixture(), v2 = { ...loadRulebook().config, version: 'v2' };
    v2.participation.min_cap_above_launch_usd = 1e15; // Synthetic counterfactual, not published policy.
    const result = await rerunStoredRuling(saved.share_slug, 'v2', { findBySlug: async () => saved, save: vi.fn() }, { load: createRulebookRegistry([v2]).load });
    expect(gridDiff(saved, result).length).toBeGreaterThan(0);
    expect(gridDiff(saved, result).some(row => row.field === 'Rule 7')).toBe(true);
  });
  it('rejects corrupted facts and propagates save failure', async () => {
    const saved = fixture(), save = vi.fn();
    const corrupt = { ...saved, facts_hash: 'wrong' };
    await expect(rerunStoredRuling(saved.share_slug, 'v1', { findBySlug: async () => corrupt, save })).rejects.toThrow('integrity');
    expect(save).not.toHaveBeenCalled();
    await expect(rerunStoredRuling(saved.share_slug, 'v1', { findBySlug: async () => saved, save: async () => { throw new Error('Storage failed'); } })).rejects.toThrow('Storage failed');
  });
});
