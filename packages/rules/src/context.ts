import { canonicalJson, type CoinFacts, type MemeRecord, type Rulebook, type RuleCheck, type Snapshot } from '@pvp/shared';

/** Unknown is internal: the frozen public grid represents it as na plus a reason. */
export interface Evaluation extends RuleCheck { unresolved?: boolean; decisive?: boolean }
export interface Context { coins: CoinFacts[]; meme: MemeRecord; config: Rulebook; configHash: string }
export type Evaluator = (coin: CoinFacts, context: Context) => Evaluation;
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function time(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function evidence(...lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap(list => list ?? []).filter(value => value.trim().length > 0))].sort(compareText);
}
export const pass = (reason: string, links: string[] = []): Evaluation => ({ result: 'pass', reason, evidence: evidence(links) });
export const fail = (reason: string, links: string[] = []): Evaluation => ({ result: 'fail', reason, evidence: evidence(links) });
export const na = (reason: string, links: string[] = []): Evaluation => ({ result: 'na', reason, evidence: evidence(links) });
export const unknown = (reason: string, links: string[] = []): Evaluation => ({ ...na('Unresolved: ' + reason, links), unresolved: true });
export const nonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

export interface Participation { alive: boolean | null; reason: string; evidence: string[] }
/** Only a complete, exact-instant, config-compatible reconstruction can establish life. */
export function participationAt(coin: CoinFacts, at: string, context: Context): Participation {
  const instant = time(at);
  const observed = time(coin.observed_at);
  const missing = (reason: string, links: string[] = []): Participation => ({ alive: null, reason, evidence: evidence(links) });
  if (instant === null || observed === null || instant > observed) return missing('Snapshot instant is invalid or later than observation');
  const matches = coin.snapshots.filter(snapshot => snapshot.coin_ca === coin.ca && time(snapshot.at) === instant);
  const usable = matches.filter(snapshot => snapshot.complete && snapshot.source.trim() && evidence(snapshot.evidence).length > 0 &&
    (snapshot.config_hash === undefined || snapshot.config_hash === context.configHash));
  if (!usable.length) return missing('Missing complete snapshot for ' + coin.ca + ' at exact rival first real buy ' + at);
  const signature = (snapshot: Snapshot): string => canonicalJson({
    mcap: snapshot.mcap_usd, holders: snapshot.holders, buyers: snapshot.distinct_buyers_lifetime, last: snapshot.last_trade_at,
  });
  if (new Set(usable.map(signature)).size !== 1) return missing('Conflicting snapshots at ' + at, usable.flatMap(s => s.evidence));
  const snapshot = usable[0]!;
  const links = evidence(usable.flatMap(s => ['snapshot:' + s.id, ...s.evidence]));
  if (!nonnegative(snapshot.mcap_usd) || !nonnegative(coin.launch_mcap_usd) ||
      !nonnegative(snapshot.distinct_buyers_lifetime) || !Number.isInteger(snapshot.distinct_buyers_lifetime) ||
      !nonnegative(snapshot.holders) || !Number.isInteger(snapshot.holders)) return missing('Snapshot counts, market cap, or launch cap baseline are unknown', links);
  const last = time(snapshot.last_trade_at);
  if (snapshot.last_trade_at !== null && (last === null || last > instant)) return missing('Snapshot contains an invalid or future trade', links);
  const alive = snapshot.distinct_buyers_lifetime >= context.config.participation.min_distinct_buyers &&
    snapshot.mcap_usd - coin.launch_mcap_usd >= context.config.participation.min_cap_above_launch_usd;
  if (alive && last === null) return missing('Qualifying participation needs a last-trade timestamp at or before the snapshot', links);
  return {
    alive,
    reason: (alive ? 'Alive' : 'Not alive') + ' at ' + at + ': $' + snapshot.mcap_usd + ' cap, $' +
      coin.launch_mcap_usd + ' launch baseline, ' + snapshot.distinct_buyers_lifetime + ' distinct buyers',
    evidence: links,
  };
}

export function firstBuy(coin: CoinFacts): number | null {
  const buy = time(coin.first_real_buy_at);
  const observed = time(coin.observed_at);
  return buy !== null && observed !== null && buy <= observed && evidence(coin.evidence).length > 0 ? buy : null;
}
