import { createHash } from 'node:crypto';
import type { Endorsement, MemeRecord, Rulebook, SourceProvider, SourceResolution } from '@pvp/shared';
import { hashImageFromUrl } from './image.js';
import { isSolanaAddress, parseAuthorities, parseSiteHtml, parseXPost, parseYouTubeVideo, SOURCE_HIERARCHY, timestamp, type SourceAuthority, type SourceObservation, type SourceReference } from './parse.js';
import { countPressCandidates } from './press.js';
import { createPublicTransport, publicUrl, responseText, SourceError, type SourceTransport } from './transport.js';

/** Returned only by a trusted on-chain verifier, never by parsing post text. */
export interface VerifiedChainEvidence {
  kind: 'majority_supply' | 'fee_claim';
  coin_ca: string;
  subject_wallet: string;
  subject_held_supply_pct: number | null;
  evidence_tx: string;
  at: string;
  verified_by: string;
}
export interface SourceOptions {
  transport?: SourceTransport;
  xBearerToken?: string;
  youtubeApiKey?: string;
  authorities?: SourceAuthority[];
  /** Explicitly scoped by the caller; no web-wide discovery or crawling. */
  pressArticleUrls?: string[];
  /** Extra source URLs for the same meme, keyed by the primary source's exact URL. */
  relatedSources?: Record<string, string[]>;
  imageHasher?: (url: string) => Promise<string>;
  verifyChainEvidence?: (reference: SourceReference, source: SourceObservation) => Promise<VerifiedChainEvidence | null>;
}
export interface SourceResolver extends SourceProvider {
  inspect(url: string): Promise<SourceObservation>;
  resolveMany(urls: string[], config: Rulebook): Promise<SourceResolution>;
}
const xHosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

export function createSourceProvider(options: SourceOptions = {}): SourceResolver {
  const transport = options.transport ?? createPublicTransport();
  const authorities = parseAuthorities(options.authorities ?? []);
  if (new Set(authorities.map(a => a.url)).size !== authorities.length) throw new SourceError('CONFIG', 'Duplicate source authority URLs are not allowed.');
  const authorityFor = (url: string): SourceAuthority | undefined => authorities.find(authority => authority.url === url);
  async function inspect(value: string): Promise<SourceObservation> {
    const url = publicUrl(value);
    const authority = authorityFor(url.href);
    if (xHosts.has(url.hostname)) {
      const match = /^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)\/?$/.exec(url.pathname);
      if (!match) throw new SourceError('SOURCE_URL', 'An X post URL with a numeric status ID is required.');
      if (!options.xBearerToken) throw new SourceError('CREDENTIALS', 'Set X_BEARER_TOKEN for X post lookup, or use an authenticated manual override.');
      const endpoint = new URL(`https://api.x.com/2/tweets/${match[1]}`);
      endpoint.search = new URLSearchParams({
        'tweet.fields': 'author_id,created_at,attachments,referenced_tweets',
        expansions: 'author_id,attachments.media_keys', 'user.fields': 'username', 'media.fields': 'url,type',
      }).toString();
      const response = await transport.get(endpoint.href, { headers: { Authorization: `Bearer ${options.xBearerToken}` }, allowRedirects: false });
      return parseXPost(JSON.parse(responseText(response, 'json')) as unknown, url.href, match[1]!, authority);
    }
    if (youtubeHosts.has(url.hostname)) {
      const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new SourceError('SOURCE_URL', 'A YouTube watch, shorts, embed, or youtu.be video URL is required.');
      if (!options.youtubeApiKey) throw new SourceError('CREDENTIALS', 'Set YOUTUBE_API_KEY for YouTube video lookup, or use an authenticated manual override.');
      const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
      endpoint.search = new URLSearchParams({ part: 'snippet', id: videoId, key: options.youtubeApiKey }).toString();
      const response = await transport.get(endpoint.href, { allowRedirects: false });
      return parseYouTubeVideo(JSON.parse(responseText(response, 'json')) as unknown, url.href, videoId, authority);
    }
    const response = await transport.get(url.href);
    const finalUrl = publicUrl(response.url).href;
    // Authority is tied to the final URL: a redirect cannot inherit the original site's attestation.
    return parseSiteHtml(responseText(response, 'html'), finalUrl, authorityFor(finalUrl));
  }

  async function resolveMany(urls: string[], config: Rulebook): Promise<SourceResolution> {
    const reasons: string[] = [];
    const endorsements: Endorsement[] = [];
    const review = (): SourceResolution => ({ meme: null, endorsements, needs_review: true, reasons: [...new Set(reasons)] });
    if (urls.length < 1 || urls.length > 10) { reasons.push('Supply between 1 and 10 source URLs.'); return review(); }
    if (JSON.stringify(config.identity.source_hierarchy) !== JSON.stringify(SOURCE_HIERARCHY)) {
      reasons.push('Unsupported source hierarchy; expected subject_post > official_asset > site_text > wiki.'); return review();
    }
    const observations: SourceObservation[] = [];
    const fetched = await Promise.allSettled([...new Set(urls)].map(inspect));
    for (const result of fetched) {
      if (result.status === 'fulfilled') observations.push(result.value);
      else reasons.push(result.reason instanceof SourceError ? result.reason.message : 'Source could not be read or parsed; retry or review the source.');
    }
    const valid = observations.filter(source => source.verified).sort((a, b) => SOURCE_HIERARCHY.indexOf(a.tier) - SOURCE_HIERARCHY.indexOf(b.tier) || a.url.localeCompare(b.url));
    for (const source of observations) {
      if (!source.verified) reasons.push(...source.reasons, 'Unverified source metadata requires review.');
      else reasons.push(...source.reasons);
      for (const reference of source.references) {
        if (!source.verified || !source.subjectVerified) continue;
        if (reference.kind === 'contract') {
          if (!reference.at) { reasons.push('Subject CA post has no provider timestamp; endorsement needs review.'); continue; }
          endorsements.push({ coin_ca: reference.value, kind: 'ca_post', evidence_url: source.url, evidence_tx: null,
            at: reference.at, verified_by: source.verifiedBy, subject_wallet: null, subject_held_supply_pct: null });
        } else if (options.verifyChainEvidence) {
          try {
            const verified = await options.verifyChainEvidence(reference, source);
            if (!verified) { reasons.push('Wallet/fee reference has no verified on-chain attestation.'); continue; }
            const at = timestamp(verified.at);
            if (!at || !verified.verified_by.trim() || !isSolanaAddress(verified.coin_ca) || !isSolanaAddress(verified.subject_wallet) ||
                !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(verified.evidence_tx) ||
                (reference.kind === 'wallet' && (verified.subject_wallet !== reference.value || verified.kind !== 'majority_supply')) ||
                (reference.kind === 'fee_claim' && (verified.evidence_tx !== reference.value || verified.kind !== 'fee_claim')) ||
                (verified.kind === 'majority_supply' && (verified.subject_held_supply_pct === null || verified.subject_held_supply_pct <= 0)) ||
                (verified.subject_held_supply_pct !== null && (!Number.isFinite(verified.subject_held_supply_pct) || verified.subject_held_supply_pct < 0 || verified.subject_held_supply_pct > 100))) {
              throw new SourceError('ATTESTATION', 'Invalid or mismatched on-chain endorsement attestation.');
            }
            endorsements.push({ ...verified, at, evidence_url: source.url });
          } catch { reasons.push('On-chain endorsement attestation failed; wallet/fee reference requires review.'); }
        } else reasons.push('Wallet/fee reference detected; ownership, holdings, and fee claims require an on-chain verifier.');
      }
    }
    if (!valid.length) { reasons.push('No verified source metadata is available.'); return review(); }
    function fieldCandidates(field: 'names' | 'tickers' | 'scopes' | 'images' | 'homeChains' | 'impliedPairs' | 'launchpads'): { values: string[]; sources: SourceObservation[] } {
      const available = valid.filter(source => source[field].length);
      const sources = available.filter(source => source.tier === available[0]?.tier);
      return { values: [...new Set(sources.flatMap(source => source[field]))], sources };
    }
    const names = fieldCandidates('names');
    const tickers = fieldCandidates('tickers');
    const scopes = fieldCandidates('scopes');
    const images = fieldCandidates('images');
    const homeChains = fieldCandidates('homeChains').values;
    const pairs = fieldCandidates('impliedPairs').values;
    const launchpads = fieldCandidates('launchpads').values;
    for (const [label, values] of [['home chain', homeChains], ['implied pair', pairs], ['source launchpad', launchpads]] as const) {
      if (values.length > 1) reasons.push(`Conflicting trusted ${label} values require review.`);
    }
    let name = names.values.length === 1 ? names.values[0]! : null;
    let pressCandidates: MemeRecord['press_candidates'];
    if (names.values.length > 1) {
      const press = await countPressCandidates(names.values, options.pressArticleUrls ?? [], config, transport);
      name = press.winner; pressCandidates = press.candidates; reasons.push(...press.reasons);
    }
    if (!name) reasons.push('Canonical name is missing or ambiguous.');
    if (tickers.values.length !== 1) reasons.push('Canonical ticker is missing or ambiguous; tickers are never inferred from names or titles.');
    const allScopes = new Set(valid.flatMap(source => source.scopes));
    if (scopes.values.length !== 1 || allScopes.size > 1) reasons.push('Meme scope is missing or conflicting; artifact and concept may be separate memes.');
    if (!name || tickers.values.length !== 1 || scopes.values.length !== 1 || allScopes.size > 1) return review();
    const subjects = [...new Set(valid.flatMap(source => source.subjectHandle ? [source.subjectHandle] : []))];
    if (subjects.length > 1) { reasons.push('Verified sources refer to different subjects; review is required.'); return review(); }
    let imageHash: string | null = null;
    const imageUrl = images.values.length === 1 ? images.values[0]! : null;
    if (images.values.length > 1) reasons.push('Multiple source images are ambiguous; select one with an audited override.');
    if (imageUrl) {
      try {
        imageHash = await (options.imageHasher ?? (url => hashImageFromUrl(url, { transport })))(imageUrl);
        if (!/^[a-f\d]{16}$/i.test(imageHash)) throw new SourceError('IMAGE_HASH', 'Image hasher returned an invalid 64-bit hash.');
      } catch { imageHash = null; reasons.push('Source image could not be safely hashed; image comparison requires review.'); }
    } else reasons.push('No single source image is available; image comparison requires review.');
    const primary = names.sources.find(source => source.names.includes(name))!;
    const configuredPair = Object.hasOwn(config.pair.meme_pairs, name) ? config.pair.meme_pairs[name] : null;
    const impliedPair = pairs.length === 1 ? pairs[0]! : pairs.length === 0 && typeof configuredPair === 'string' && configuredPair.trim() ? configuredPair : null;
    const digest = createHash('sha256').update(`${primary.url}\n${name}\n${scopes.values[0]}`).digest('hex');
    const evidence = [...new Set(valid.flatMap(source => [source.url, ...(source.authorityEvidence ? [source.authorityEvidence] : [])]).concat(pressCandidates?.flatMap(candidate => candidate.articles) ?? []))];
    const meme: MemeRecord = {
      id: `source_${digest.slice(0, 24)}`, slug: `meme-${digest.slice(0, 16)}`, scope: scopes.values[0] as MemeRecord['scope'],
      canonical_name: name, canonical_ticker: tickers.values[0]!, source_url: primary.url, source_tier: primary.tier,
      source_image_url: imageUrl, source_image_hash: imageHash, subject_handle: subjects[0] ?? null,
      home_chain: homeChains.length === 1 ? homeChains[0]! : null, implied_pair: impliedPair, beneficiary_wallet: null, beneficiary_tie_at: null,
      source_launchpad: launchpads.length === 1 ? launchpads[0]! : null, created_by: 'source-resolver', overrides: [], evidence,
      ...(pressCandidates ? { press_candidates: pressCandidates } : {}), resolved: reasons.length === 0,
    };
    return { meme, endorsements, needs_review: reasons.length > 0, reasons: [...new Set(reasons)] };
  }
  return {
    inspect, resolveMany,
    resolve: (url, config) => resolveMany([url, ...(options.relatedSources?.[url] ?? [])], config),
  };
}

export function resolveSource(url: string, config: Rulebook, options: SourceOptions = {}): Promise<SourceResolution> {
  return createSourceProvider(options).resolve(url, config);
}
export function resolveSources(urls: string[], config: Rulebook, options: SourceOptions = {}): Promise<SourceResolution> {
  return createSourceProvider(options).resolveMany(urls, config);
}

/** No admin session is needed to resolve verified sources. Keep this factory on the server. */
export function createSourceFromEnv(env: NodeJS.ProcessEnv = process.env, options: SourceOptions = {}): SourceResolver {
  let authorities: SourceAuthority[] = options.authorities ?? [];
  if (!options.authorities && env.SOURCE_AUTHORITIES) {
    try { authorities = parseAuthorities(JSON.parse(env.SOURCE_AUTHORITIES) as unknown); }
    catch { throw new SourceError('CONFIG', 'SOURCE_AUTHORITIES is invalid; provide a JSON array of documented source authority bindings.'); }
  }
  return createSourceProvider({ ...options, authorities, xBearerToken: options.xBearerToken ?? env.X_BEARER_TOKEN,
    youtubeApiKey: options.youtubeApiKey ?? env.YOUTUBE_API_KEY });
}
