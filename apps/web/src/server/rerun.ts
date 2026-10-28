import { createHash, randomUUID } from 'node:crypto';
import { hashRulebook, loadRulebook } from '@pvp/config';
import { canonicalJson, type LoadedRulebook, type Ruling, type RulingRepository, type Snapshot } from '@pvp/shared';
import { rule } from '@pvp/rules';
import { isShareSlug } from '../lib/input';

export class RerunError extends Error {}
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export interface DerivedSnapshot extends Snapshot {
  reevaluation: { kind: 'frozen-values'; from_ruling: string; from_facts_hash: string; original: Snapshot };
}
export interface RerunOptions { load?: (version: string) => LoadedRulebook; now?: () => Date; uuid?: () => string }

/** No providers or cache writes. Derivations retain the exact original snapshot envelope. */
export async function rerunStoredRuling(slug: string, version: string, repository: RulingRepository, options: RerunOptions = {}): Promise<Ruling> {
  if (!isShareSlug(slug)) throw new RerunError('Enter a valid saved ruling slug.');
  const saved = await repository.findBySlug(slug);
  if (!saved) throw new RerunError('The saved ruling was not found.');
  if (hash(saved.facts) !== saved.facts_hash || hashRulebook(saved.facts.config) !== saved.config_hash || saved.rules_version !== saved.facts.config.version) throw new RerunError('Stored ruling integrity check failed.');
  let loaded: LoadedRulebook;
  try { loaded = (options.load ?? loadRulebook)(version); }
  catch { throw new RerunError('Choose a published rulebook version.'); }
  const before = saved.facts.config.participation, after = loaded.config.participation;
  if (before.min_distinct_buyers !== after.min_distinct_buyers || before.first_buy_window_seconds !== after.first_buy_window_seconds) {
    throw new RerunError('Fresh ingest required: changing minimum buyers or the first-buy window can change first_real_buy_at and every rival-time snapshot. This rerun cannot reconstruct that history from the frozen contract.');
  }
  const facts = structuredClone(saved.facts);
  if (loaded.hash !== saved.config_hash) {
    for (const coin of facts.coins) coin.snapshots = coin.snapshots.map(original => {
      // An incompatible original was not usable evidence; never promote it.
      if (original.config_hash !== undefined && original.config_hash !== saved.config_hash) throw new RerunError('Fresh ingest required: a frozen snapshot has incompatible config provenance.');
      const derived: DerivedSnapshot = {
        ...original,
        id: 'reevaluation-' + hash({ original, from: saved.facts_hash, config: loaded.hash }),
        config_hash: loaded.hash,
        source: 'Historical re-evaluation of ' + original.source + '; no new observation',
        evidence: [...original.evidence, 'snapshot:' + original.id, '/ruling/' + saved.share_slug],
        reevaluation: { kind: 'frozen-values', from_ruling: saved.share_slug, from_facts_hash: saved.facts_hash, original: structuredClone(original) },
      };
      return derived;
    });
  }
  // Pure judge copies and canonicalizes the facts. Its deterministic ID/time are
  // replaced here, outside the engine, because every rerun is a new stored event.
  const result = rule(facts.coins, facts.meme, loaded.config);
  const id = (options.uuid ?? randomUUID)();
  const rerun: Ruling = { ...result, id, share_slug: 'r-' + id, created_at: (options.now ?? (() => new Date()))().toISOString(), facts_hash: hash(result.facts) };
  await repository.save(rerun);
  return rerun;
}
export interface GridDifference { coin: string; field: string; before: unknown; after: unknown }
export function gridDiff(before: Ruling, after: Ruling): GridDifference[] {
  const differences: GridDifference[] = [];
  function compare(coin: string, field: string, a: unknown, b: unknown) {
    if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) differences.push({ coin, field, before: a ?? null, after: b ?? null });
  }
  compare('All coins', 'winner', before.winner_ca, after.winner_ca);
  compare('All coins', 'status', before.status, after.status);
  compare('All coins', 'ranking', before.ranked_cas, after.ranked_cas);
  for (const ca of new Set([...before.coin_cas, ...after.coin_cas])) {
    const a = before.grid.find(row => row.coin === ca), b = after.grid.find(row => row.coin === ca);
    compare(ca, 'eliminated_by', a?.eliminated_by, b?.eliminated_by);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8] as const) compare(ca, 'Rule ' + id, a?.rules[id], b?.rules[id]);
  }
  return differences;
}
