import { describe, expect, it } from 'vitest';
import { loadRulebook, hashRulebook, validateRulebook, createRulebookRegistry, listRulebooks } from './index';
describe('versioned rulebook', () => {
  it('preserves the published v1 hash exactly', () => {
    expect(loadRulebook().hash).toBe('7eb4b1e1f6b71878ec7f264b719ab69bf2b3a0a4517b35af2b3171d65dc83e84');
    expect(listRulebooks()).toEqual(['v1']);
  });
  it('supports isolated synthetic v2 without overwriting or exposing old configs', () => {
    const v1 = loadRulebook().config, v2 = { ...structuredClone(v1), version: 'v2' };
    v2.identity.max_image_hamming_distance = 11; // Synthetic test only, not published policy.
    const registry = createRulebookRegistry([v1, v2]);
    expect(registry.versions()).toEqual(['v1', 'v2']);
    expect(registry.load('v1')).toEqual(loadRulebook());
    expect(registry.load('v2').hash).not.toBe(loadRulebook().hash);
    v2.version = 'v3';
    registry.load('v1').config.participation.min_distinct_buyers = 999;
    expect(registry.load('v1')).toEqual(loadRulebook());
    expect(registry.versions()).toEqual(['v1', 'v2']);
    expect(() => createRulebookRegistry([v1, v1])).toThrow('Duplicate');
  });
  it('has eight ordered rules and a content hash', () => {
    const loaded = loadRulebook();
    expect(loaded.config.rules.map(r => r.id)).toEqual([1,2,3,4,5,6,7,8]);
    expect(loaded.hash).toMatch(/^[a-f0-9]{64}$/);
    const changed = structuredClone(loaded.config);
    changed.participation.min_distinct_buyers++;
    expect(hashRulebook(changed)).not.toBe(loaded.hash);
  });
  it('rejects unknown versions and changes to settled requirements', () => {
    expect(() => loadRulebook('v404')).toThrow();
    expect(() => validateRulebook({...loadRulebook().config, rules: []})).toThrow();
    const config = loadRulebook().config;
    expect(() => validateRulebook({...config, participation: {...config.participation, pvp_grace_seconds: 5}})).toThrow();
  });
});
