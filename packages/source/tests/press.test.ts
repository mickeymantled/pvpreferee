import { describe, expect, it, vi } from 'vitest';
import { canonicalArticleUrl, countPressCandidates, type SourceTransport } from '../src/index.js';
import { config, fixture, fixtureTransport, response } from './helpers.js';

describe('citation normalization and counts', () => {
  it('preserves meaningful queries while stripping only known tracking fields', () => {
    expect(canonicalArticleUrl('https://www.reuters.com/story/?b=2&utm_medium=x&a=1&fbclid=x#top')).toBe('https://reuters.com/story?a=1&b=2');
    expect(canonicalArticleUrl('https://apnews.com/?id=one')).not.toBe(canonicalArticleUrl('https://apnews.com/?id=two'));
    expect(canonicalArticleUrl('http://apnews.com/article')).not.toBe(canonicalArticleUrl('https://apnews.com/article'));
  });

  it('deduplicates canonical URLs, redirect aliases, and identical syndicated content', async () => {
    const duplicate = await fixture('press-tigrino-one.html');
    const result = await countPressCandidates(['Tigrino', 'Tilcayo'], [
      'https://reuters.com/world/pet-one', 'https://apnews.com/syndication', 'https://bbc.com/news/pet-three',
    ], config, fixtureTransport({ 'https://apnews.com/syndication': response('https://apnews.com/syndication', duplicate) }));
    expect(result.candidates[0]?.articles).toHaveLength(1);
    expect(result.winner).toBeNull();
  });

  it('does not count disallowed publishers, hostname suffix attacks, navigation or substring matches', async () => {
    const get = vi.fn(async (url: string) => response(url, '<!-- SYNTHETIC --><nav>Tilcayo</nav><article>Tigrinoish news.</article>'));
    const result = await countPressCandidates(['Tigrino', 'Tilcayo'], ['https://fake.example.com/story', 'https://reuters.com.attacker.example.com/story', 'https://reuters.com/story'], config, { get });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.candidates.map(candidate => candidate.articles.length)).toEqual([0, 0]);
  });

  it('counts an article mentioning both strings once for each string, leaving a tie', async () => {
    const transport: SourceTransport = { get: async url => response(url, '<!-- SYNTHETIC --><article>Tilcayo is also called Tigrino. Tigrino Tigrino.</article>') };
    const result = await countPressCandidates(['Tilcayo', 'Tigrino'], ['https://bbc.com/story'], config, transport);
    expect(result.candidates.map(candidate => candidate.articles.length)).toEqual([1, 1]);
    expect(result.winner).toBeNull();
  });

  it('does not resolve from partial press counts after a fetch failure or off-allowlist redirect', async () => {
    const result = await countPressCandidates(['Tigrino', 'Tilcayo'], ['https://reuters.com/world/pet-one', 'https://bbc.com/broken'], config, fixtureTransport());
    expect(result.winner).toBeNull();
    const redirected = await countPressCandidates(['Tigrino', 'Tilcayo'], ['https://bbc.com/redirect'], config,
      fixtureTransport({ 'https://bbc.com/redirect': response('https://untrusted.example.com/story', await fixture('press-tigrino-one.html')) }));
    expect(redirected.winner).toBeNull();
  });
});
