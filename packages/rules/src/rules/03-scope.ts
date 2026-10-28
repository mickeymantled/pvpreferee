import type { CoinFacts } from '@pvp/shared';
import { evidence, na, pass, unknown, type Context, type Evaluation } from '../context';

export function separateMemes(context: Context): boolean {
  return context.coins.some(coin => coin.meme_id !== null && coin.meme_id !== context.meme.id) ||
    context.coins.some(coin => coin.scope !== undefined && coin.scope !== context.meme.scope && coin.name !== context.meme.canonical_name);
}
export function scope(coin: CoinFacts, context: Context): Evaluation {
  const links = evidence(context.meme.evidence, [context.meme.source_url], coin.evidence);
  if (separateMemes(context)) return na('Separate memes: a different meme record or differently named concept/artifact cannot receive a comparative ruling', links);
  if (coin.meme_id === null) return unknown('Coin has no resolved meme assignment', links);
  return pass('Coin belongs to the resolved ' + context.meme.scope + ' meme ' + context.meme.id, links);
}
