import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { PressCandidate, Rulebook } from '@pvp/shared';
import { publicUrl, responseText, SourceError, type SourceTransport } from './transport.js';

export interface PressResult { winner: string | null; candidates: PressCandidate[]; reasons: string[] }
export function canonicalArticleUrl(value: string): string {
  const url = publicUrl(value);
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.replace(/^www\./, '');
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}
function allowed(value: string, allowlist: string[]): boolean {
  const host = publicUrl(value).hostname;
  return allowlist.some(domain => /^[a-z0-9.-]+$/i.test(domain) && (host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`)));
}
function containsName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(text);
}

/** Counts supplied, fetched articles once per exact candidate; never claims a complete web census. */
export async function countPressCandidates(values: string[], articleUrls: string[], config: Rulebook, transport: SourceTransport): Promise<PressResult> {
  if (articleUrls.length > 50) throw new SourceError('LIMIT', 'At most 50 press article URLs are accepted per resolution.');
  const candidates: PressCandidate[] = [...new Set(values)].map(value => ({ value, articles: [] }));
  const reasons: string[] = [];
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  let incomplete = false;
  for (const raw of articleUrls) {
    try {
      const initial = canonicalArticleUrl(raw);
      if (!allowed(initial, config.identity.press_sources)) continue;
      if (seenUrls.has(initial)) continue;
      const response = await transport.get(initial);
      if (!allowed(response.url, config.identity.press_sources)) throw new SourceError('PRESS_SOURCE', 'Press redirect left the configured publisher allowlist.');
      const $ = load(responseText(response, 'html'));
      let citation = canonicalArticleUrl(response.url);
      const canonical = $('link[rel="canonical"]').attr('href');
      if (canonical) {
        const proposed = canonicalArticleUrl(new URL(canonical, response.url).href);
        if (new URL(proposed).hostname === new URL(citation).hostname) citation = proposed;
      }
      $('script,style,noscript,nav,header,footer,aside').remove();
      const body = ($('article').first().text() || $('main').first().text()).replace(/\s+/g, ' ').trim();
      if (!body) throw new SourceError('PRESS_CONTENT', 'Press article has no readable article/main text; review is required.');
      const digest = createHash('sha256').update(body).digest('hex');
      const duplicate = seenUrls.has(citation) || seenContent.has(digest);
      seenUrls.add(initial); seenUrls.add(canonicalArticleUrl(response.url)); seenUrls.add(citation); seenContent.add(digest);
      if (duplicate) continue;
      for (const candidate of candidates) if (containsName(body, candidate.value)) candidate.articles.push(citation);
    } catch (error) {
      incomplete = true;
      reasons.push(error instanceof SourceError ? error.message : 'Press article could not be read; counts are incomplete.');
    }
  }
  const maximum = Math.max(0, ...candidates.map(candidate => candidate.articles.length));
  const leaders = candidates.filter(candidate => candidate.articles.length === maximum);
  const winner = !incomplete && maximum > 0 && leaders.length === 1 ? leaders[0]!.value : null;
  if (!winner) reasons.push('Canonical name press count is tied, empty, or incomplete; manual review is required.');
  return { winner, candidates, reasons };
}
