import { readFile } from 'node:fs/promises';
import configJson from '../../../config/rulebook.v1.json';
import type { Rulebook } from '@pvp/shared';
import type { SourceAuthority, SourceOptions, SourceTransport, TransportResponse } from '../src/index.js';

export const config = configJson as Rulebook;
export const xUrl = 'https://x.com/synthetic_subject/status/1001';
export const siteA = 'https://sources.example.com/tilcayo';
export const siteB = 'https://sources.example.com/tigrino';
export const youtubeUrl = 'https://www.youtube.com/watch?v=SYNTHETIC01';
export const fixture = (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
export const jsonFixture = async (name: string): Promise<unknown> => JSON.parse(await fixture(name)) as unknown;
export function response(url: string, body: string, type = 'text/html', status = 200): TransportResponse {
  return { url, status, headers: { 'content-type': type }, body: new TextEncoder().encode(body) };
}
export function authority(url: string, tier: SourceAuthority['tier'] = 'site_text'): SourceAuthority {
  return { url, tier, verifiedBy: 'synthetic-admin', evidenceUrl: 'https://sources.example.com/identity-proof',
    subject: { handle: 'synthetic_subject', xUserId: '501', youtubeChannelId: 'UC_SYNTHETIC_SHELTER' } };
}
/** Fixture-only dispatcher. It rejects every unexpected request and never falls back to live fetch. */
export function fixtureTransport(extra: Record<string, string | TransportResponse> = {}): SourceTransport {
  return { async get(value) {
    const url = new URL(value);
    const file = extra[value] ?? ({
      [siteA]: 'tilcayo.html', [siteB]: 'tigrino.html',
      'https://sources.example.com/ambiguous': 'ambiguous.html',
      'https://reuters.com/world/pet-one': 'press-tigrino-one.html',
      'https://apnews.com/article/pet-two': 'press-tigrino-two.html',
      'https://bbc.com/news/pet-three': 'press-tilcayo.html',
    } as Record<string, string>)[value];
    if (file) return typeof file === 'string' ? response(value, await fixture(file)) : file;
    if (url.hostname === 'api.x.com') {
      const filename = ({ '1001': 'dacity.x.json', '1002': 'third-party.x.json', '1003': 'wallet-fees.x.json' } as Record<string, string>)[url.pathname.split('/').at(-1)!];
      if (filename) return response(value, await fixture(filename), 'application/json');
    }
    if (url.hostname === 'www.googleapis.com' && url.searchParams.get('id') === 'SYNTHETIC01') return response(value, await fixture('tigrino.youtube.json'), 'application/json');
    throw new Error(`No saved synthetic fixture for ${url.origin}${url.pathname}`);
  } };
}
export function sourceOptions(extra: SourceOptions = {}): SourceOptions {
  return { transport: fixtureTransport(), xBearerToken: 'synthetic-not-a-secret', youtubeApiKey: 'synthetic-not-a-secret',
    imageHasher: async () => '0123456789abcdef', ...extra };
}
