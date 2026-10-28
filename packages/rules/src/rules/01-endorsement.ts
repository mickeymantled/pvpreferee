import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, na, nonnegative, pass, time, unknown, type Context, type Evaluation } from '../context';

interface Holding { supply: number | null; links: string[]; issue?: string }
function holding(coin: CoinFacts): Holding | null {
  if (!coin.endorsements.length) return null;
  const links = evidence(coin.endorsements.flatMap(item => [item.evidence_url ?? '', item.evidence_tx ?? '']));
  if (coin.endorsements.some(item => item.coin_ca !== coin.ca || !item.verified_by?.trim() ||
      !evidence([item.evidence_url ?? '', item.evidence_tx ?? '']).length || time(item.at) === null ||
      time(item.at)! > time(coin.observed_at)! || (item.kind === 'majority_supply' && !item.subject_wallet?.trim()))) {
    return { supply: null, links, issue: 'Endorsement needs verified, dated subject evidence for this CA' };
  }
  const supply = coin.subject_held_supply_pct;
  if (supply !== null && (!nonnegative(supply) || supply > 100)) return { supply: null, links, issue: 'Subject-held supply is invalid' };
  // Do not pick the convenient maximum from contradictory supplied measurements.
  const latest = Math.max(...coin.endorsements.map(item => time(item.at)!));
  const latestSupplies = coin.endorsements.filter(item => time(item.at) === latest)
    .map(item => item.subject_held_supply_pct).filter(value => value !== null);
  if (latestSupplies.some(value => !nonnegative(value) || value > 100 || (supply !== null && value !== supply)) || new Set(latestSupplies).size > 1) {
    return { supply: null, links, issue: 'Conflicting subject-held supply evidence' };
  }
  return { supply, links };
}

export function endorsement(coin: CoinFacts, context: Context): Evaluation {
  const holdings = context.coins.map(item => ({ coin: item, holding: holding(item) }));
  const endorsed = holdings.filter(item => item.holding !== null);
  if (!endorsed.length) return na('No subject endorsement in the supplied evidence');
  const links = evidence(endorsed.flatMap(item => item.holding!.links));
  const uncertain = endorsed.find(item => item.holding!.issue);
  if (uncertain) return unknown(uncertain.holding!.issue + ' (' + uncertain.coin.ca + ')', links);
  if (endorsed.length === 1) {
    const only = endorsed[0]!;
    return coin.ca === only.coin.ca
      ? { ...pass('Only coin with a verified subject endorsement; no supply comparison or percentage minimum required', links), decisive: true }
      : fail('Another coin has the sole verified subject endorsement', links);
  }
  if (endorsed.some(item => item.holding!.supply === null)) return unknown('Multiple endorsed coins require known subject-held supply to compare priority', links);
  const highest = Math.max(...endorsed.map(item => item.holding!.supply!));
  const leaders = endorsed.filter(item => item.holding!.supply === highest);
  const own = holdings.find(item => item.coin.ca === coin.ca)!.holding;
  if (leaders.length > 1) return unknown('Endorsed coins tie at ' + highest + '% subject-held supply; no endorsement tiebreak is specified', links);
  if (leaders[0]!.coin.ca === coin.ca) return {
    ...pass('Verified subject endorsement has the most subject-held supply: ' + highest + '%', links), decisive: true,
  };
  return fail(own
    ? 'Endorsement conflict: ' + own.supply + '% subject-held supply cannot transfer priority from ' + highest + '%'
    : 'Another coin has a verified subject endorsement (' + highest + '% subject-held supply)', links);
}
