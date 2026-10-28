import type { CoinFacts } from '@pvp/shared';
import { evidence, fail, firstBuy, participationAt, pass, unknown, type Context, type Evaluation } from '../context';

function hash(value: string | null): bigint | null {
  if (value === null) return null;
  if (/^[01]{64}$/.test(value)) return BigInt('0b' + value);
  if (/^[a-fA-F0-9]{16}$/.test(value)) return BigInt('0x' + value);
  return null;
}
function distance(a: bigint, b: bigint): number {
  let bits = a ^ b;
  let count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  return count;
}
export function canonicalName(context: Context): { name: string | null; links: string[] } {
  const { meme, config } = context;
  if (!meme.press_candidates?.length) return { name: meme.canonical_name || null, links: [] };
  const totals = new Map<string, Set<string>>();
  for (const candidate of meme.press_candidates) {
    const articles = totals.get(candidate.value) ?? new Set<string>();
    for (const article of candidate.articles) {
      try {
        const url = new URL(article);
        if (['https:', 'http:'].includes(url.protocol) && config.identity.press_sources.some(domain =>
          url.hostname === domain || url.hostname.endsWith('.' + domain))) {
          url.hash = '';
          url.hostname = url.hostname.replace(/^www\./, '');
          url.pathname = url.pathname.replace(/\/+$/, '') || '/';
          for (const key of [...url.searchParams.keys()]) {
            if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
          }
          url.searchParams.sort();
          articles.add(url.href);
        }
      } catch { /* Invalid or unlisted article URLs do not establish press counts. */ }
    }
    totals.set(candidate.value, articles);
  }
  const max = Math.max(...[...totals.values()].map(articles => articles.size));
  const winners = [...totals.entries()].filter(([, articles]) => articles.size === max);
  return { name: max > 0 && winners.length === 1 ? winners[0]![0] : null, links: evidence([...totals.values()].flatMap(set => [...set])) };
}

export function identity(coin: CoinFacts, context: Context): Evaluation {
  const canonical = canonicalName(context);
  const links = evidence([context.meme.source_url], context.meme.evidence, coin.evidence, canonical.links);
  if (context.meme.resolved === false || !context.meme.source_url || !context.meme.canonical_ticker || !canonical.name ||
      !context.config.identity.source_hierarchy.includes(context.meme.source_tier) || !evidence(coin.evidence).length) {
    return unknown('Canonical identity or source/coin evidence is missing, unresolved, or tied in eligible press counts', links);
  }
  if (!coin.name || !coin.ticker) return unknown('Coin name or ticker is missing', links);
  const reasons: string[] = [];
  if (coin.name !== canonical.name) reasons.push('Name "' + coin.name + '" does not match canonical "' + canonical.name + '"');
  if (coin.ticker !== context.meme.canonical_ticker) reasons.push('Ticker "' + coin.ticker + '" does not match canonical "' + context.meme.canonical_ticker + '"');
  if (reasons.length) return fail(reasons.join('; ') + ' from ' + context.meme.source_tier, links);
  const ownTime = firstBuy(coin);
  const ownHash = hash(coin.image_hash);
  const issues: string[] = [];
  for (const earlier of context.coins) {
    if (earlier.ca === coin.ca || earlier.name !== canonical.name || earlier.ticker !== context.meme.canonical_ticker) continue;
    const earlierTime = firstBuy(earlier);
    const earlierHash = hash(earlier.image_hash);
    const hamming = ownHash !== null && earlierHash !== null ? distance(ownHash, earlierHash) : null;
    if (hamming !== null && hamming > context.config.identity.max_image_hamming_distance) continue;
    if (ownTime !== null && earlierTime !== null && earlierTime >= ownTime) continue;
    if (ownTime === null || earlierTime === null) { issues.push('Image-copy chronology is unknown'); continue; }
    const life = participationAt(earlier, coin.first_real_buy_at!, context);
    if (life.alive === false) continue;
    if (hamming === null || life.alive === null) {
      issues.push(hamming === null ? 'Image hash evidence is unknown; similarity cannot be inferred' : life.reason);
      continue;
    }
    return fail('Image is a copy of earlier alive coin ' + earlier.ca + ': supplied image hash distance ' + hamming +
      ' <= ' + context.config.identity.max_image_hamming_distance, evidence(links, earlier.evidence, life.evidence));
  }
  if (issues.length) return unknown([...new Set(issues)].join('; '), links);
  return pass('Name and ticker independently match canonical strings exactly; no copy established by supplied image evidence', links);
}
