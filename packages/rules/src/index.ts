import { createHash } from 'node:crypto';
import { hashRulebook } from '@pvp/config';
import { canonicalJson, type CoinFacts, type CoinGrid, type FrozenFacts, type MemeRecord, type Rulebook, type RuleCheck, type RuleId, type Ruling, type RulingStatus } from '@pvp/shared';
import { compareText, na, time, type Context, type Evaluator } from './context';
import { endorsement } from './rules/01-endorsement';
import { identity } from './rules/02-identity';
import { scope, separateMemes } from './rules/03-scope';
import { chain } from './rules/04-chain';
import { launchpadPair } from './rules/05-launchpad-pair';
import { beneficiary } from './rules/06-beneficiary';
import { participation } from './rules/07-participation';
import { precedence } from './rules/08-precedence';

const evaluators: Record<RuleId, Evaluator> = { 1: endorsement, 2: identity, 3: scope, 4: chain, 5: launchpadPair, 6: beneficiary, 7: participation, 8: precedence };

/** Pure, deterministic evaluation of supplied frozen facts; never fetches or fills facts. */
export function rule(coins: CoinFacts[], meme: MemeRecord, config: Rulebook): Ruling {
  const configHash = hashRulebook(config);
  if (coins.length < 2 || coins.length > 10) throw new Error('A ruling requires 2 to 10 coins');
  if (coins.some(coin => !coin.ca) || new Set(coins.map(coin => coin.ca)).size !== coins.length) throw new Error('Coin CAs must be nonempty and unique');
  if (coins.some(coin => time(coin.observed_at) === null)) throw new Error('Every coin requires a valid UTC observed_at for deterministic provenance');
  // Copy the full input; CA sorting makes the compared set order immaterial.
  const facts: FrozenFacts = structuredClone({ coins: [...coins].sort((a, b) => compareText(a.ca, b.ca)), meme, config });
  const factsHash = createHash('sha256').update(canonicalJson(facts)).digest('hex');
  const context: Context = { ...facts, configHash };
  const grid: CoinGrid[] = facts.coins.map(coin => ({
    coin: coin.ca, eliminated_by: null, flags: structuredClone(coin.flags),
    rules: Object.fromEntries(config.rules.map(item => [item.id, na('Not reached')])) as Record<RuleId, RuleCheck>,
  }));
  let candidates = facts.coins;
  let status: RulingStatus = 'unresolved';
  const separate = separateMemes(context);
  if (separate) {
    status = 'separate_memes';
    for (let i = 0; i < grid.length; i++) {
      for (const definition of config.rules) grid[i]!.rules[definition.id] = na('No comparative ruling across separate memes');
      grid[i]!.rules[3] = scope(facts.coins[i]!, context);
    }
  } else if (facts.coins.some(coin => coin.meme_id === null)) {
    // Missing assignments could conceal a separate meme; do not eliminate by
    // identity or endorsement before the pipeline resolves comparability.
    for (let i = 0; i < grid.length; i++) {
      for (const definition of config.rules) grid[i]!.rules[definition.id] = na('Not evaluated: meme assignment is unresolved');
      const check = scope(facts.coins[i]!, context);
      grid[i]!.rules[3] = { result: check.result, reason: check.reason, evidence: check.evidence };
    }
  } else {
    for (const definition of facts.config.rules) {
      const id = definition.id;
      const stage = { ...context, coins: candidates };
      const checks = candidates.map(coin => ({ coin, check: evaluators[id](coin, stage) }));
      for (const { coin, check } of checks) {
        const row = grid.find(item => item.coin === coin.ca)!;
        row.rules[id] = { result: check.result, reason: check.reason, evidence: check.evidence };
        if (check.result === 'fail') {
          row.eliminated_by = id;
          for (const later of facts.config.rules.filter(item => item.id > id)) row.rules[later.id] = na('Not evaluated: eliminated by rule ' + id);
        }
      }
      candidates = candidates.filter(coin => grid.find(item => item.coin === coin.ca)!.eliminated_by === null);
      if (!candidates.length) { status = 'no_winner'; break; }
      if (checks.some(item => item.check.unresolved && candidates.some(coin => coin.ca === item.coin.ca))) {
        status = 'unresolved';
        for (const coin of candidates) {
          const row = grid.find(item => item.coin === coin.ca)!;
          for (const later of facts.config.rules.filter(item => item.id > id)) row.rules[later.id] = na('Not evaluated: required evidence or tiebreak unresolved at rule ' + id);
        }
        break;
      }
      if (checks.some(item => item.check.decisive) && candidates.length === 1) {
        status = 'resolved';
        const row = grid.find(item => item.coin === candidates[0]!.ca)!;
        for (const later of facts.config.rules.filter(item => item.id > id)) row.rules[later.id] = na('Subject endorsement decided the ruling at rule 1');
        break;
      }
      if (id === 8) status = candidates.length === 1 ? 'resolved' : 'unresolved';
    }
  }
  const winner = status === 'resolved' ? candidates[0]!.ca : null;
  const ranked = separate ? [] : [...grid].sort((a, b) => {
    if (a.coin === b.coin) return 0;
    if (a.coin === winner) return -1;
    if (b.coin === winner) return 1;
    // CA order only serializes tied ranks; it never selects a winner.
    return (b.eliminated_by ?? 9) - (a.eliminated_by ?? 9) || compareText(a.coin, b.coin);
  }).map(row => row.coin);
  return {
    id: 'ruling_' + factsHash, meme_id: facts.meme.id, coin_cas: facts.coins.map(coin => coin.ca), winner_ca: winner,
    ranked_cas: ranked, status, grid, flags: Object.fromEntries(facts.coins.map(coin => [coin.ca, structuredClone(coin.flags)])),
    config_hash: configHash, rules_version: facts.config.version, facts_hash: factsHash,
    created_at: new Date(Math.max(...facts.coins.map(coin => time(coin.observed_at)!))).toISOString(),
    share_slug: 'r-' + factsHash, facts,
  };
}
