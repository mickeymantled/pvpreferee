import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, firstBuy, na, pass, unknown, type Context, type Evaluation } from '../context';

export function precedence(coin: CoinFacts, context: Context): Evaluation {
  if (context.coins.length === 1) return na('Earlier rules already leave one contender; no tiebreak required');
  const times = context.coins.map(firstBuy);
  const links = evidence(context.coins.flatMap(item => item.evidence));
  if (times.some(value => value === null)) return unknown('Earliest participation cannot be compared without all first real buy timestamps', links);
  const earliest = Math.min(...times as number[]);
  const own = firstBuy(coin)!;
  if (own > earliest) return fail('Later first real participation (' + coin.first_real_buy_at + '); deployment time is not considered', links);
  if (times.filter(value => value === earliest).length > 1) return unknown('First real participation timestamps tie; no deployment-time or CA tiebreak is specified', links);
  return pass('Earliest real participation among otherwise equal coins: ' + coin.first_real_buy_at, links);
}
