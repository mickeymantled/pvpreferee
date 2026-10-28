import { createHash } from 'node:crypto';
import { canonicalJson, type LoadedRulebook, type Rulebook } from '@pvp/shared';
import v1 from '../rulebook.v1.json';

export function validateRulebook(value: unknown): asserts value is Rulebook {
  if (!value || typeof value !== 'object') throw new Error('Rulebook must be an object');
  const c = value as Rulebook;
  if (!/^v[1-9]\d*$/.test(c.version ?? '')) throw new Error('Invalid rulebook version');
  if (!Array.isArray(c.rules) || c.rules.map(r => r.id).join(',') !== '1,2,3,4,5,6,7,8') throw new Error('Rule order must be 1 through 8');
  if (c.rules.some(r => !r.key || !r.name || !r.description)) throw new Error('Every rule requires public text');
  const p = c.participation;
  if (!p || !Number.isInteger(p.min_distinct_buyers) || p.min_distinct_buyers < 1 ||
      !Number.isFinite(p.first_buy_window_seconds) || p.first_buy_window_seconds <= 0 ||
      !Number.isFinite(p.min_cap_above_launch_usd) || p.min_cap_above_launch_usd < 0 ||
      p.pvp_grace_seconds !== 0 || p.post_rival_window_seconds !== 0) throw new Error('Invalid participation thresholds');
  const i = c.identity;
  if (!i || i.hash_bits !== 64 || !Number.isInteger(i.max_image_hamming_distance) ||
      i.max_image_hamming_distance < 0 || i.max_image_hamming_distance > 64 ||
      i.exact_spelling !== true || i.source_hierarchy?.join(',') !== 'subject_post,official_asset,site_text,wiki' ||
      !Array.isArray(i.press_sources) || !i.press_sources.length || i.press_sources.some(s => typeof s !== 'string' || !/^[a-z0-9.-]+\.[a-z]+$/.test(s))) throw new Error('Invalid identity configuration');
  if (c.endorsement?.selection !== 'most_subject_held_supply' || c.endorsement.fixed_minimum_supply_pct !== null) throw new Error('Endorsement must use most subject-held supply');
  if (!c.pair?.default_asset || !c.pair.meme_pairs || Object.values(c.pair.meme_pairs).some(p => typeof p !== 'string' || !p)) throw new Error('Invalid pair configuration');
  if (c.beneficiary?.require_pre_rival_tie !== true || c.beneficiary.require_claimable !== true) throw new Error('Beneficiary prerequisites required');
}
export function hashRulebook(config: Rulebook): string {
  validateRulebook(config);
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}
export function loadRulebook(version = 'v1'): LoadedRulebook {
  if (version !== 'v1') throw new Error('Unknown rulebook version: ' + version);
  const config: unknown = structuredClone(v1);
  validateRulebook(config);
  return { config, hash: hashRulebook(config) };
}
export function listRulebooks(): string[] { return ['v1']; }
