import { load } from 'cheerio';
import { publicUrl } from './transport.js';

const xHosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const videoHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const under = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Keep this URL grammar aligned with provider.inspect; profiles are not posts. */
export function discoveryUrl(value: string): { url: string; html: boolean } {
  const url = publicUrl(value);
  if (under(url.hostname, 'x.com') || under(url.hostname, 'twitter.com')) {
    if (!xHosts.has(url.hostname) || !/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/\d+\/?$/.test(url.pathname)) {
      throw new Error('Unsupported X profile or non-post URL.');
    }
    return { url: url.href, html: false };
  }
  if (under(url.hostname, 'youtube.com') || under(url.hostname, 'youtu.be')) {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch'
      ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!videoHosts.has(url.hostname) || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      throw new Error('Unsupported YouTube profile or non-video URL.');
    }
    return { url: url.href, html: false };
  }
  if (['t.me', 'telegram.me', 'telegram.org', 'discord.com', 'discord.gg', 'instagram.com',
    'facebook.com', 'tiktok.com', 'dexscreener.com', 'pump.fun'].some(domain => under(url.hostname, domain))) {
    throw new Error('Profile/listing URL is not a supported source document.');
  }
  return { url: url.href, html: true };
}

const explicitLabel = /^(?:(?:meme|original)\s+)?(?:origin|source|inspiration)(?:\s+(?:post|video|link))?\s*[:.!]?$|^original\s+(?:post|video)\s*[:.!]?$|^inspired\s+by\s*:?$/i;

/** Literal link labels only. Page prose/instructions, scripts and metadata never execute. */
export function originLinks(html: string): { hrefs: string[]; truncated: boolean } {
  const $ = load(html);
  $('script,style,noscript,template,svg,blockquote').remove();
  const hrefs = new Set<string>();
  let truncated = false;
  let inspected = 0;
  $('a[href]').each((_index, element) => {
    if (++inspected > 500) { truncated = true; return false; }
    const link = $(element);
    const labels = [link.text(), link.attr('aria-label'), link.attr('title')];
    const parent = link.parent();
    // Also accept e.g. <p>Source: <a href="...">watch</a></p>, without treating
    // arbitrary ancestor prose or a page's claim to be "official" as a source link.
    if (parent.find('a').length === 1 && parent.text().length < 200) {
      const copy = parent.clone(); copy.find('a').remove(); labels.push(copy.text());
    }
    const rel = (link.attr('rel') ?? '').split(/\s+/);
    if (!labels.some(label => label && explicitLabel.test(label.trim().replace(/\s+/g, ' '))) &&
        !rel.some(value => ['source', 'origin', 'inspiration'].includes(value.toLowerCase()))) return;
    const href = link.attr('href')!.trim();
    // Fragments identify the same page, not a new source reference.
    if (href && !href.startsWith('#')) hrefs.add(href);
  });
  return { hrefs: [...hrefs].sort(), truncated };
}
