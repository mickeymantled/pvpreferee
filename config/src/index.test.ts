import { describe, expect, it } from 'vitest';
import { loadRulebook, hashRulebook, validateRulebook } from './index';
describe('versioned rulebook', () => {
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
