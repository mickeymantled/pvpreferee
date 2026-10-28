import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, firstBuy, participationAt, pass, unknown, type Context, type Evaluation } from '../context';

export function launchpadPair(coin: CoinFacts, context: Context): Evaluation {
  // The resolver supplies implied_pair. A display slug is not source evidence.
  const pair = context.meme.implied_pair ?? context.config.pair.default_asset;
  const links = evidence(coin.evidence, [context.meme.source_url], context.meme.evidence);
  if (coin.pair_asset === null || !evidence(coin.evidence).length) return unknown('Pair asset or pool evidence is missing', links);
  if (coin.pair_asset !== pair) return fail('Pair ' + coin.pair_asset + ' does not match required pair ' + pair, links);
  if (context.coins.length === 1) return pass('Correct pair ' + pair + '; no remaining launchpad rival', links);
  if (coin.launchpad === null) return unknown('Launchpad is unknown', links);
  if (context.meme.source_launchpad === coin.launchpad) return pass('Correct pair ' + pair + '; source explicitly points to launchpad ' + coin.launchpad, links);
  const issues: string[] = [];
  for (const rival of context.coins) {
    // A wrong-pair rival cannot defeat the coin that fixes its pair at this rule.
    if (rival.ca === coin.ca || rival.pair_asset !== pair || rival.launchpad === coin.launchpad) continue;
    if (rival.launchpad === null) { issues.push('Rival launchpad is unknown'); continue; }
    const own = firstBuy(coin);
    const earlier = firstBuy(rival);
    if (own === null || earlier === null) { issues.push('Launchpad-port chronology is unknown'); continue; }
    if (earlier >= own) continue;
    const life = participationAt(rival, coin.first_real_buy_at!, context);
    if (life.alive === null) { issues.push(life.reason); continue; }
    if (life.alive) return fail('Later launchpad port from ' + rival.launchpad + ' to ' + coin.launchpad +
      ' is a vamp; source does not point to this launchpad', evidence(links, rival.evidence, life.evidence));
  }
  if (issues.length) return unknown(issues.join('; '), links);
  return pass('Correct pair ' + pair + '; no unsupported port from an earlier alive rival', links);
}
