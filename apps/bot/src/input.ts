import { parseCas, validateCas } from '@pvp/pipeline';
import { isIP } from 'node:net';
import type { Identity, Post } from './types';

// Whole alphanumeric tokens: never salvage a valid substring from a malformed CA.
function candidates(text: string): string[] {
  return (text.replace(/https?:\/\/\S+|@[a-zA-Z0-9_]+/g, ' ').match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter(token => token.length >= 32);
}
function validCa(token: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const char of token) value = value * 58n + BigInt(alphabet.indexOf(char));
  let bytes = token.match(/^1*/)?.[0].length ?? 0;
  while (value) { bytes++; value >>= 8n; }
  return bytes === 32;
}
export function extractCas(posts: Post[]): string[] {
  return validateCas(parseCas(posts.flatMap(post => candidates(post.text).filter(validCa)).join('\n')));
}
export function actualMention(post: Post, me: Identity): boolean {
  return !!post.author_id && post.author_id !== me.id &&
    !post.referenced_tweets?.some(ref => ref.type === 'retweeted') &&
    !!post.entities?.mentions?.some(mention =>
      mention.username.toLowerCase() === me.username.toLowerCase() && (!mention.id || mention.id === me.id)) &&
    new RegExp(`(^|[^a-zA-Z0-9_])@${me.username}(?![a-zA-Z0-9_])`, 'i').test(post.text.replace(/https?:\/\/\S+/g, ''));
}
export function parentId(post: Post): string | undefined {
  const parents = [...new Set(post.referenced_tweets?.filter(ref => ref.type !== 'retweeted').map(ref => ref.id))];
  return parents.length === 1 ? parents[0] : undefined;
}
const excluded = ['t.co', 'pump.fun', 'dexscreener.com', 'dextools.io', 'solscan.io', 'birdeye.so', 'jup.ag', 'solana.fm'];
function sourceLink(input: string, baseUrl: string): string | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2048) return null;
    const host = url.hostname.toLowerCase();
    if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /\.(localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (url.origin === baseUrl || excluded.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    url.hash = '';
    if (['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(host)) {
      const match = url.pathname.match(/^\/(?:[a-zA-Z0-9_]+|i\/web)\/status\/([0-9]{1,19})\/?$/);
      return match ? `https://x.com${url.pathname.replace(/\/$/, '')}` : null;
    }
    return url.href;
  } catch { return null; }
}
/** A URL is only a candidate; the shared source resolver must establish its authority. */
export function originalSource(mention: Post, parent: Post | null, me: Identity, baseUrl: string): string | null {
  const links = new Set([mention, ...(parent ? [parent] : [])].flatMap(post =>
    (post.entities?.urls ?? []).flatMap(link => {
      const value = sourceLink(link.unwound_url ?? link.expanded_url ?? '', baseUrl);
      return value ? [value] : [];
    })));
  if (links.size === 1) return [...links][0]!;
  if (links.size > 1) return null;
  // A parent that itself discusses contracts is not assumed to be the original source.
  if (parent?.author_id && parent.author_id !== me.id && candidates(parent.text).length === 0 && !actualMention(parent, me)) {
    return `https://x.com/i/web/status/${parent.id}`;
  }
  return null;
}
