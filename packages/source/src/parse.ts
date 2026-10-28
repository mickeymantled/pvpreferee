import { load } from 'cheerio';
import type { MemeScope, SourceTier } from '@pvp/shared';
import { publicUrl, SourceError } from './transport.js';

export const SOURCE_HIERARCHY: readonly SourceTier[] = ['subject_post', 'official_asset', 'site_text', 'wiki'];
/** Server-side identity attestation, never obtained from page claims or an HTTP request body. */
export interface SourceAuthority {
  url: string;
  tier: SourceTier;
  verifiedBy: string;
  evidenceUrl: string;
  subject?: { handle: string; xUserId?: string; youtubeChannelId?: string };
}
export interface SourceReference {
  kind: 'contract' | 'wallet' | 'fee_claim';
  value: string;
  url: string;
  at: string | null;
  subjectVerified: boolean;
}
export interface SourceObservation {
  url: string;
  tier: SourceTier;
  verified: boolean;
  subjectVerified: boolean;
  subjectHandle: string | null;
  verifiedBy: string | null;
  authorityEvidence: string | null;
  names: string[];
  tickers: string[];
  scopes: MemeScope[];
  homeChains: string[];
  impliedPairs: string[];
  launchpads: string[];
  images: string[];
  publishedAt: string | null;
  text: string;
  references: SourceReference[];
  reasons: string[];
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function timestamp(value: unknown): string | null {
  const text = string(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) return null;
  const normalized = new Date(text).toISOString();
  return normalized.slice(0, 19) === text.slice(0, 19) ? normalized : null;
}
export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  let length = 0;
  while (number > 0n) { length++; number >>= 8n; }
  return length + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function labels(text: string, keys: string[]): string[] {
  const pattern = new RegExp(`^(?:${keys.join('|')})\\s*:\\s*(.+?)\\s*$`, 'gim');
  return [...new Set(Array.from(text.matchAll(pattern), match => match[1]!.trim()))];
}
function safeImages(values: string[], base: string): string[] {
  return [...new Set(values.flatMap(value => {
    try { return [publicUrl(new URL(value, base).href).href]; } catch { return []; }
  }))];
}
export function parseAuthorities(input: unknown): SourceAuthority[] {
  if (!Array.isArray(input)) throw new SourceError('CONFIG', 'SOURCE_AUTHORITIES must be a JSON array.');
  return input.map(value => {
    const item = record(value);
    if (!string(item.url) || !SOURCE_HIERARCHY.includes(item.tier as SourceTier) || !string(item.verifiedBy) || !string(item.evidenceUrl)) {
      throw new SourceError('CONFIG', 'Every source authority requires url, tier, verifiedBy, and evidenceUrl.');
    }
    let subject: SourceAuthority['subject'];
    if (item.subject !== undefined) {
      const raw = record(item.subject);
      const handle = string(raw.handle);
      const xUserId = string(raw.xUserId);
      const youtubeChannelId = string(raw.youtubeChannelId);
      if (!handle || (!xUserId && !youtubeChannelId)) throw new SourceError('CONFIG', 'Subject binding requires a handle and a provider account ID.');
      subject = { handle, ...(xUserId ? { xUserId } : {}), ...(youtubeChannelId ? { youtubeChannelId } : {}) };
    }
    return { url: publicUrl(item.url as string).href, tier: item.tier as SourceTier, verifiedBy: item.verifiedBy as string,
      evidenceUrl: publicUrl(item.evidenceUrl as string).href, ...(subject ? { subject } : {}) };
  });
}

function observation(input: {
  url: string; text: string; images: string[]; authority?: SourceAuthority; subjectVerified?: boolean;
  publishedAt?: string | null; names?: string[]; tickers?: string[]; scopes?: string[]; reasons?: string[];
  homeChains?: string[]; impliedPairs?: string[]; launchpads?: string[];
}): SourceObservation {
  const subjectVerified = input.subjectVerified ?? false;
  const authority = input.authority;
  // A claimed subject_post is never downgraded into usable site metadata on verification failure.
  const verified = !!authority && (authority.tier !== 'subject_post' || subjectVerified);
  const result: SourceObservation = {
    url: input.url, tier: authority?.tier ?? 'site_text', verified, subjectVerified,
    subjectHandle: subjectVerified ? authority?.subject?.handle ?? null : null,
    verifiedBy: verified ? authority?.verifiedBy ?? null : null, authorityEvidence: verified ? authority?.evidenceUrl ?? null : null,
    names: [...new Set([...(input.names ?? []), ...labels(input.text, ['Canonical name', 'Name'])])],
    tickers: [...new Set([...(input.tickers ?? []), ...labels(input.text, ['Canonical ticker', 'Ticker'])])],
    scopes: [...new Set([...(input.scopes ?? []), ...labels(input.text, ['Meme scope', 'Scope'])])].filter((scope): scope is MemeScope => scope === 'artifact' || scope === 'concept'),
    homeChains: [...new Set([...(input.homeChains ?? []), ...labels(input.text, ['Home chain'])])],
    impliedPairs: [...new Set([...(input.impliedPairs ?? []), ...labels(input.text, ['Implied pair', 'Pair asset'])])],
    launchpads: [...new Set([...(input.launchpads ?? []), ...labels(input.text, ['Source launchpad'])])],
    images: safeImages(input.images, input.url), publishedAt: input.publishedAt ?? null,
    text: input.text, references: [], reasons: [...(input.reasons ?? [])],
  };
  if (!verified) result.reasons.push('Source identity/authority is unverified; review or configure an evidence-backed authority binding.');
  for (const [kind, keys] of [
    ['contract', ['CA', 'Contract address']], ['wallet', ['Wallet', 'My wallet', 'Subject wallet']],
    ['fee_claim', ['Fee claim transaction']],
  ] as const) {
    for (const value of labels(input.text, [...keys])) {
      if (kind === 'fee_claim' ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) : isSolanaAddress(value)) {
        result.references.push({ kind, value, url: input.url, at: result.publishedAt, subjectVerified });
      } else result.reasons.push(`Invalid ${kind} reference requires review.`);
    }
  }
  return result;
}

/** HTML titles, OpenGraph titles, social handles and self-declared verification are never canonical facts. */
export function parseSiteHtml(html: string, url: string, authority?: SourceAuthority): SourceObservation {
  const $ = load(html);
  const meta = (key: string): string[] => $(`meta[property="${key}"],meta[name="${key}"]`).toArray().flatMap(element => {
    const value = string($(element).attr('content')); return value ? [value] : [];
  });
  $('script,style,noscript,nav,header,footer,aside,blockquote').remove();
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,section').append('\n');
  const text = ($('main').first().text() || $('article').first().text() || $('body').text()).trim();
  return observation({ url, text, authority, images: [...meta('og:image'), ...meta('twitter:image')],
    names: meta('pvp:canonical_name'), tickers: meta('pvp:canonical_ticker'), scopes: meta('pvp:scope'),
    homeChains: meta('pvp:home_chain'), impliedPairs: meta('pvp:implied_pair'), launchpads: meta('pvp:source_launchpad'),
    // Page-supplied timestamps do not prove when a tie or endorsement became public.
  });
}

export function parseXPost(payload: unknown, url: string, expectedId: string, authority?: SourceAuthority): SourceObservation {
  const root = record(payload);
  const post = record(root.data);
  const includes = record(root.includes);
  if (post.id !== expectedId || !string(post.text) || !string(post.author_id)) throw new SourceError('PROVIDER_DATA', 'X did not return the requested post with text and author_id.');
  const user = array(includes.users).map(record).find(user => user.id === post.author_id);
  const subjectVerified = !!authority?.subject?.xUserId && post.author_id === authority.subject.xUserId &&
    typeof user?.username === 'string' && user.username.toLowerCase() === authority.subject.handle.replace(/^@/, '').toLowerCase();
  const references = array(post.referenced_tweets).map(record);
  const isRepost = references.some(ref => ref.type === 'retweeted');
  const keys = array(record(post.attachments).media_keys);
  const media = array(includes.media).map(record).filter(media => keys.includes(media.media_key) && media.type === 'photo');
  const result = observation({ url, text: isRepost ? '' : post.text as string, authority,
    subjectVerified: subjectVerified && !isRepost, publishedAt: timestamp(post.created_at),
    images: media.flatMap(media => string(media.url) ? [media.url as string] : []),
    reasons: isRepost ? ['Reposted text cannot establish the subject’s own canonical metadata or endorsement.'] : [],
  });
  // Provider author identity is required for *any* trusted X tier, not just subject_post.
  if (!subjectVerified || isRepost) { result.verified = false; result.verifiedBy = null; result.authorityEvidence = null; }
  return result;
}

export function parseYouTubeVideo(payload: unknown, url: string, expectedId: string, authority?: SourceAuthority): SourceObservation {
  const video = array(record(payload).items).map(record).find(video => video.id === expectedId);
  const snippet = record(video?.snippet);
  if (!video || !string(snippet.channelId) || typeof snippet.description !== 'string') throw new SourceError('PROVIDER_DATA', 'YouTube did not return the requested video snippet.');
  const subjectVerified = !!authority?.subject?.youtubeChannelId && snippet.channelId === authority.subject.youtubeChannelId;
  const thumbnails = record(snippet.thumbnails);
  const image = ['maxres', 'standard', 'high', 'medium', 'default'].map(key => string(record(thumbnails[key]).url)).find(Boolean);
  const result = observation({ url, text: snippet.description, authority, subjectVerified, images: image ? [image] : [], publishedAt: timestamp(snippet.publishedAt) });
  if (!subjectVerified) { result.verified = false; result.verifiedBy = null; result.authorityEvidence = null; }
  return result;
}
