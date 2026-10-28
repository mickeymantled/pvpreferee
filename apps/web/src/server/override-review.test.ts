import { describe, expect, it, vi } from 'vitest';
import type { MemeRecord } from '@pvp/shared';
import { INPUT, MEME, form } from '../test/fixtures';
import { parseOverride } from '../lib/override-form';
import { commitReviewedOverride, overrideFingerprint } from './override-review';

const env = { NODE_ENV: 'test' as const, SOURCE_ADMIN_ACTOR: 'synthetic-brian' }, auth = { authenticated: true as const, actor: env.SOURCE_ADMIN_ACTOR };
describe('audited administrator overrides (synthetic evidence)', () => {
  it('freshly loads previous, preserves history and appends exact field audit', async () => {
    const previous: MemeRecord = { ...structuredClone(MEME), overrides: [{ field: 'canonical_name', previous: 'Earlier', value: MEME.canonical_name, actor: 'prior-admin', at: '2026-01-01T00:00:00Z', reason: 'Prior synthetic proof' }] };
    const original = structuredClone(previous), persist = vi.fn(), load = vi.fn(async () => previous);
    const current = await commitReviewedOverride(INPUT, overrideFingerprint(INPUT, previous), { patch: { canonical_name: 'Reviewed Cat' }, reason: 'Cited synthetic proof' }, auth, { load, persist }, env);
    expect(load).toHaveBeenCalledOnce();
    expect(previous).toEqual(original);
    expect(current.id).toBe(previous.id);
    expect(current.overrides[0]).toEqual(previous.overrides[0]);
    expect(current.overrides[1]).toMatchObject({ field: 'canonical_name', previous: MEME.canonical_name, value: 'Reviewed Cat', actor: auth.actor, reason: 'Cited synthetic proof' });
    expect(persist).toHaveBeenCalledWith(previous, current);
  });
  it('creates an audited record when metadata is missing', async () => {
    const persist = vi.fn();
    const current = await commitReviewedOverride(INPUT, overrideFingerprint(INPUT, null), { patch: { canonical_name: 'Synthetic', canonical_ticker: 'SYN', scope: 'artifact', source_tier: 'subject_post', evidence: [INPUT.source_url], resolved: true }, reason: 'Manual synthetic citation' }, auth, { load: async () => null, persist }, env);
    expect(current.created_by).toBe(auth.actor);
    expect(current.source_url).toBe(INPUT.source_url);
    expect(current.overrides.length).toBeGreaterThan(5);
    expect(persist).toHaveBeenCalledWith(null, current);
  });
  it('rejects stale fields and concurrent null-to-existing creation reviews', async () => {
    const persist = vi.fn();
    for (const fingerprint of [overrideFingerprint(INPUT, null), overrideFingerprint(INPUT, { ...MEME, canonical_name: 'Stale' })]) await expect(commitReviewedOverride(INPUT, fingerprint, { patch: { canonical_name: 'Attempt' }, reason: 'test' }, auth, { load: async () => MEME, persist }, env)).rejects.toThrow('changed since review');
    expect(persist).not.toHaveBeenCalled();
  });
  it('gives concurrent new creations one stable identity so the repository can reject the second insert', async () => {
    const ids = new Set<string>();
    const persist = vi.fn(async (_previous: MemeRecord | null, current: MemeRecord) => {
      if (ids.has(current.id)) throw new Error('Immutable conflict');
      ids.add(current.id);
    });
    const request = { patch: { canonical_name: 'Synthetic', canonical_ticker: 'SYN', scope: 'artifact' as const, source_tier: 'subject_post' as const, evidence: [INPUT.source_url] }, reason: 'Synthetic evidence' };
    const deps = { load: async () => null, persist };
    const results = await Promise.allSettled([1, 2].map(() => commitReviewedOverride(INPUT, overrideFingerprint(INPUT, null), request, auth, deps, env)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(persist.mock.calls[0]![1].id).toBe(persist.mock.calls[1]![1].id);
  });
  it('fails permissions before loading records or appending audit', async () => {
    const load = vi.fn(), persist = vi.fn();
    await expect(commitReviewedOverride(INPUT, 'forged', { patch: {}, reason: 'test' }, { authenticated: true, actor: 'attacker' }, { load, persist }, env)).rejects.toThrow('sign-in');
    expect(load).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it('propagates transactional concurrency failure without claiming success', async () => {
    await expect(commitReviewedOverride(INPUT, overrideFingerprint(INPUT, MEME), { patch: { canonical_name: 'Reviewed' }, reason: 'test' }, auth, { load: async () => MEME, persist: async () => { throw new Error('Concurrent change'); } }, env)).rejects.toThrow('Concurrent');
  });
  it.each(['actor', 'authenticated', 'id', 'overrides', 'previous', 'meme', 'created_by'])('rejects client %s', key => {
    expect(() => parseOverride(form({ [key]: 'forged' }))).toThrow('Unexpected');
  });
  it('rejects duplicate fields and preserves explicit clearing', () => {
    const data = form({ canonical_name: 'Cat', canonical_ticker: 'CAT', scope: 'artifact', source_tier: 'subject_post', evidence: INPUT.source_url, resolved: 'true', reason: 'proof' });
    const parsed = parseOverride(data);
    expect(parsed.patch.home_chain).toBeNull();
    expect(parsed.patch.evidence).toEqual([INPUT.source_url]);
    data.append('canonical_name', 'duplicate');
    expect(() => parseOverride(data)).toThrow('one text');
  });
});
