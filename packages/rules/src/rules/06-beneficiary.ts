import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, firstBuy, na, pass, time, unknown, type Context, type Evaluation } from '../context';

function advantage(coin: CoinFacts, rival: CoinFacts, context: Context): boolean | null {
  if (coin.fee_wallet === null) return null;
  if (coin.fee_wallet !== context.meme.beneficiary_wallet || coin.beneficiary_claimable === false) return false;
  if (coin.beneficiary_claimable === null || !evidence(coin.evidence).length) return null;
  const sourceTie = time(context.meme.beneficiary_tie_at);
  const feeTie = time(coin.fee_tie_at);
  const rivalBuy = firstBuy(rival);
  if (sourceTie === null || feeTie === null || rivalBuy === null) return null;
  return Math.max(sourceTie, feeTie) < rivalBuy;
}
export function beneficiary(coin: CoinFacts, context: Context): Evaluation {
  if (context.meme.beneficiary_wallet === null) return na('No natural beneficiary in the meme record');
  const links = evidence(context.meme.evidence, [context.meme.source_url], coin.evidence);
  if (context.coins.length === 1) return na('No remaining rival for the beneficiary pre-tie comparison', links);
  let preferred = false;
  let uncertain = false;
  for (const rival of context.coins) {
    if (rival.ca === coin.ca) continue;
    const own = advantage(coin, rival, context);
    const other = advantage(rival, coin, context);
    if (other === true && own === false) return fail('Rival ' + rival.ca + ' routes claimable fees to the beneficiary with a public tie before this coin first ran',
      evidence(links, rival.evidence));
    if (own === null || other === null) uncertain = true;
    if (own === true && other === false) preferred = true;
  }
  if (uncertain) return unknown('Beneficiary priority requires fee wallets, claimability, public tie timestamps, and rival first-buy evidence', links);
  return preferred ? pass('Claimable beneficiary fees and public tie predate the rival first real buy', links)
    : na('No exclusive qualifying beneficiary advantage; late or unclaimable ties do not change priority', links);
}
