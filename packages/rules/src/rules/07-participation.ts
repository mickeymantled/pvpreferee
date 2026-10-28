import type { CoinFacts } from '@pvp/shared';
import { compareText, evidence, fail, firstBuy, na, participationAt, pass, unknown, type Context, type Evaluation } from '../context';

export function participation(coin: CoinFacts, context: Context): Evaluation {
  if (context.coins.length === 1) return na('No remaining rival requiring a participation snapshot');
  if (context.coins.some(item => firstBuy(item) === null)) return unknown('First real buy and supporting evidence are required for every remaining contender');
  const ordered = [...context.coins].sort((a, b) => firstBuy(a)! - firstBuy(b)! || compareText(a.ca, b.ca));
  const groups: CoinFacts[][] = [];
  for (const item of ordered) {
    const previous = groups.at(-1);
    if (previous && firstBuy(previous[0]!) === firstBuy(item)) previous.push(item);
    else groups.push([item]);
  }
  const checks = new Map<string, Evaluation>();
  let survivors: CoinFacts[] = [];
  const unresolved = (reason: string, links: string[]): Evaluation => {
    // Preserve earlier proven eliminations, but stop before an unknown transition
    // can confer priority on an entrant or eliminate an incumbent.
    for (const item of ordered) if (checks.get(item.ca)?.result !== 'fail') checks.set(item.ca, unknown(reason, links));
    return checks.get(coin.ca)!;
  };
  for (const entrants of groups) {
    const instant = entrants[0]!.first_real_buy_at!;
    const observations = survivors.map(item => ({ coin: item, life: participationAt(item, instant, context) }));
    const missing = observations.find(item => item.life.alive === null);
    if (missing) return unresolved(missing.life.reason, missing.life.evidence);
    for (const { coin: incumbent, life } of observations) {
      checks.set(incumbent.ca, life.alive
        ? pass(life.reason, life.evidence)
        : fail(life.reason + '; activity after this frozen instant cannot revive priority', life.evidence));
    }
    survivors = survivors.filter(item => checks.get(item.ca)?.result !== 'fail');
    if (survivors.length) {
      const alive = observations.filter(item => item.life.alive);
      const links = evidence(alive.flatMap(item => item.life.evidence));
      for (const entrant of entrants) checks.set(entrant.ca, fail('Later participation is a vamp of ' + survivors.map(item => item.ca).join(', ') +
        ': ' + alive.map(item => item.life.reason).join('; ') + '; no grace window', links));
      // A vamp is never carried forward to eliminate a subsequent entrant.
      continue;
    }
    if (entrants.length > 1) {
      const tied = entrants.map(item => ({ coin: item, life: participationAt(item, instant, context) }));
      const missingTie = tied.find(item => item.life.alive === null);
      if (missingTie) return unresolved(missingTie.life.reason, missingTie.life.evidence);
      for (const item of tied) checks.set(item.coin.ca, item.life.alive
        ? pass(item.life.reason + '; equal timestamps remain tied', item.life.evidence)
        : fail(item.life.reason, item.life.evidence));
      survivors = entrants.filter(item => checks.get(item.ca)?.result === 'pass');
    } else {
      survivors = entrants;
      checks.set(entrants[0]!.ca, pass('First real participation has no surviving earlier rival', evidence(entrants[0]!.evidence, observations.flatMap(item => item.life.evidence))));
    }
  }
  return checks.get(coin.ca)!;
}
