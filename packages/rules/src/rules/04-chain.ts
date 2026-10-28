import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, na, pass, unknown, type Context, type Evaluation } from '../context';

export function chain(coin: CoinFacts, context: Context): Evaluation {
  if (context.meme.home_chain === null) return na('Meme has no source home chain; chain is not scored');
  const links = evidence([context.meme.source_url], context.meme.evidence, coin.evidence);
  if (!context.meme.source_url || !coin.chain || !evidence(coin.evidence).length) return unknown('Home-chain comparison needs source and coin-chain evidence', links);
  return coin.chain === context.meme.home_chain
    ? pass('Chain matches source home chain ' + context.meme.home_chain, links)
    : fail('Chain ' + coin.chain + ' does not match source home chain ' + context.meme.home_chain, links);
}
