import { describe, expect, it, vi } from 'vitest';
import { createManualOverrideService, createManualOverrideServiceFromEnv, resolveSource, type CallerAuthContext, type ManualOverridePatch, type OverrideCommit } from '../src/index.js';
import { authority, config, siteB, sourceOptions } from './helpers.js';

const auth: CallerAuthContext = { authenticated: true, actor: 'brian-subject-id' };
const clock = () => new Date('2026-10-28T12:00:00.000Z');
const initial = async () => (await resolveSource(siteB, config, sourceOptions({ authorities: [authority(siteB)] }))).meme!;

describe('single-admin manual overrides with injected atomic persistence', () => {
  it('logs every changed field with immutable before/value/actor/time/reason', async () => {
    const before = await initial();
    const persist = vi.fn(async (_commit: OverrideCommit) => {});
    const service = createManualOverrideService({ adminActor: auth.actor, persist, clock });
    const result = await service.apply(before, { patch: { canonical_name: 'Tigrnio', canonical_ticker: 'TIGRNIO', resolved: true }, reason: 'Exact spelling in the verified source, including its typo.' }, auth);
    expect(result.canonical_name).toBe('Tigrnio');
    expect(result.overrides).toEqual([
      { field: 'canonical_name', previous: 'Tigrino', value: 'Tigrnio', actor: auth.actor, at: clock().toISOString(), reason: 'Exact spelling in the verified source, including its typo.' },
      { field: 'canonical_ticker', previous: 'TIGRINO', value: 'TIGRNIO', actor: auth.actor, at: clock().toISOString(), reason: 'Exact spelling in the verified source, including its typo.' },
    ]);
    expect(before.canonical_name).toBe('Tigrino');
    expect(before.overrides).toEqual([]);
    expect(persist).toHaveBeenCalledWith({ previous: before, current: result, entries: result.overrides });
  });

  it('denies non-admin and missing/forged unauthenticated contexts before persistence', async () => {
    const persist = vi.fn(async () => {});
    const service = createManualOverrideService({ adminActor: auth.actor, persist });
    const before = await initial();
    for (const context of [undefined, { authenticated: false, actor: auth.actor }, { authenticated: true, actor: 'someone-else' }]) {
      await expect(service.apply(before, { patch: { canonical_name: 'Changed' }, reason: 'test' }, context as CallerAuthContext)).rejects.toThrow(/authenticated session/);
    }
    expect(persist).not.toHaveBeenCalled();
    expect(() => createManualOverrideServiceFromEnv(persist, {})).toThrow(/adminActor/);
  });

  it('creates a manually reviewed record from null without guessing mandatory fields', async () => {
    const persist = vi.fn(async () => {});
    const service = createManualOverrideServiceFromEnv(persist, { SOURCE_ADMIN_ACTOR: auth.actor }, clock);
    await expect(service.apply(null, { patch: { canonical_name: 'Example' }, reason: 'incomplete' }, auth)).rejects.toThrow();
    const result = await service.apply(null, { patch: { canonical_name: 'Exact Nmae', canonical_ticker: 'EXACT',
      scope: 'artifact', source_tier: 'subject_post', source_url: 'https://x.com/synthetic_subject/status/1001',
      evidence: ['https://x.com/synthetic_subject/status/1001'], resolved: true }, reason: 'Admin verified the original source.' }, auth);
    expect(result.created_by).toBe(auth.actor);
    expect(result.canonical_name).toBe('Exact Nmae');
    expect(result.overrides.find(entry => entry.field === 'canonical_name')).toMatchObject({ previous: null, value: 'Exact Nmae' });
    expect(result.beneficiary_tie_at).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('invalidates an old image hash and logs the implicit change when its URL changes', async () => {
    const service = createManualOverrideService({ adminActor: auth.actor, persist: async () => {}, clock });
    const result = await service.apply(await initial(), { patch: { source_image_url: 'https://images.example.com/new.png' }, reason: 'Correct source image' }, auth);
    expect(result.source_image_hash).toBeNull();
    expect(result.overrides.map(entry => entry.field)).toEqual(['source_image_url', 'source_image_hash']);
  });

  it('rejects missing reasons, unsupported fields, empty canonical strings and unsafe URLs', async () => {
    const persist = vi.fn(async () => {});
    const service = createManualOverrideService({ adminActor: auth.actor, persist });
    const before = await initial();
    await expect(service.apply(before, { patch: { canonical_name: 'new' }, reason: '' }, auth)).rejects.toThrow();
    for (const patch of [{ overrides: [] }, { created_by: 'attacker' }, { canonical_name: '' }, { source_url: 'file:///etc/passwd' }, { canonical_name: undefined }]) {
      await expect(service.apply(before, { patch: patch as ManualOverridePatch, reason: 'test' }, auth)).rejects.toThrow();
    }
    expect(persist).not.toHaveBeenCalled();
  });

  it('propagates persistence failure without mutating the original or reporting a saved result', async () => {
    const before = await initial();
    const service = createManualOverrideService({ adminActor: auth.actor, persist: async () => { throw new Error('transaction rejected'); } });
    await expect(service.apply(before, { patch: { canonical_name: 'new' }, reason: 'test' }, auth)).rejects.toThrow('transaction rejected');
    expect(before.canonical_name).toBe('Tigrino');
    expect(before.overrides).toEqual([]);
  });

  it('does not create redundant entries or persist a no-op', async () => {
    const before = await initial();
    const persist = vi.fn(async () => {});
    const service = createManualOverrideService({ adminActor: auth.actor, persist });
    const result = await service.apply(before, { patch: { canonical_name: before.canonical_name }, reason: 'confirmed' }, auth);
    expect(result).toEqual(before);
    expect(persist).not.toHaveBeenCalled();
  });
});
