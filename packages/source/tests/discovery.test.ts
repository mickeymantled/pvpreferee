import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemeRecord, SourceResolution } from '@pvp/shared';
import { createPublicTransport, createSourceProvider, discoverOrigin, SourceError, type SourceTransport, type TransportResponse } from '../src/index.js';
import { authority, config, fixture, jsonFixture, response } from './helpers.js';

// All responses/identities below are synthetic, not live provider evidence.
const A = 'So11111111111111111111111111111111111111112';
const B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const C = '11111111111111111111111111111111';
const post = 'https://x.com/synthetic_subject/status/1001';
const other = 'https://x.com/synthetic_subject/status/1002';
const site = 'https://sources.example.com/origin';
const rootA = 'https://coin-a.example.com/';
const rootB = 'https://coin-b.example.com/';
const endpoint = (cas = [A, B]): string => `https://api.dexscreener.com/tokens/v1/solana/${[...new Set(cas)].sort().join(',')}`;
const pair = (ca: string, urls: unknown[] = [post]): object => ({ chainId: 'solana', baseToken: { address: ca, name: 'Not canonical', symbol: 'NO' },
  info: { websites: urls.map(url => ({ url })) } });
const review = (): SourceResolution => ({ meme: null, needs_review: true, endorsements: [], reasons: ['Synthetic source authority is unknown.'] });
function verified(url = post, patch: Partial<MemeRecord> = {}): SourceResolution {
  return { needs_review: false, reasons: [], endorsements: [{ coin_ca: A, kind: 'ca_post', evidence_url: url, evidence_tx: null,
    at: '2026-10-20T12:00:00.000Z', verified_by: 'synthetic-verifier', subject_wallet: null, subject_held_supply_pct: null }],
  meme: { id: 'synthetic', slug: 'synthetic', canonical_name: 'Synthetic original', canonical_ticker: 'SYNTHETIC', scope: 'artifact',
    source_url: url, source_tier: 'subject_post', source_image_hash: '0123456789abcdef', source_image_url: null,
    subject_handle: 'synthetic_subject', home_chain: null, implied_pair: null, source_launchpad: null, beneficiary_wallet: null,
    beneficiary_tie_at: null, created_by: 'synthetic-verifier', overrides: [], evidence: [url], resolved: true, ...patch } };
}
function harness(payload: unknown, pages: Record<string, string | TransportResponse> = {}) {
  const get = vi.fn(async (url: string, _options?: Parameters<SourceTransport['get']>[1]) => {
    if (url.startsWith('https://api.dexscreener.com/tokens/v1/solana/')) return response(url, JSON.stringify(payload), 'application/json');
    const page = pages[url];
    if (page) return typeof page === 'string' ? response(url, page) : page;
    throw new Error('Unexpected synthetic request; no live fallback.');
  });
  const resolve = vi.fn(async (url: string) => verified(url));
  return { transport: { get }, get, resolve };
}
afterEach(() => vi.useRealTimers());

describe('bounded origin discovery from synthetic listing records', () => {
  it('validates real 32-byte base58 keys, counts distinct CAs, and deduplicates without changing case', async () => {
    const io = harness([pair(A), pair(B)]);
    for (const cas of [[], [A], [A, A], [A, '0'.repeat(32)], [A, 'z'.repeat(44)], [A, '1'.repeat(33)], [A, ` ${B}`], Array(11).fill(A)]) {
      expect((await discoverOrigin(cas, config, io)).resolution.needs_review).toBe(true);
    }
    expect(io.get).not.toHaveBeenCalled();
    expect(io.resolve).not.toHaveBeenCalled();
    const result = await discoverOrigin([B, A, B], config, io);
    expect(result.resolution.needs_review).toBe(false);
    expect(io.get).toHaveBeenCalledExactlyOnceWith(endpoint(), { allowRedirects: false });
    expect(io.resolve).toHaveBeenCalledExactlyOnceWith(post, config);
    expect(result.candidates[0]?.coin_cas).toEqual([A, B].sort());
  });

  it('crosschecks chain and exact base mint, never quote tokens or listing names', async () => {
    const io = harness([pair(A), { ...pair(C), quoteToken: { address: B } },
      { ...pair(B), chainId: 'ethereum' }, pair(B.toLowerCase())]);
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution).toMatchObject({ meme: null, endorsements: [], needs_review: true });
    expect(result.candidates[0]?.coin_cas).toEqual([A]);
    expect(result.resolution.reasons.join(' ')).toContain(`No Solana base-token pair returned for ${B}`);
    expect(result.candidates[0]?.discovered_via).toEqual([endpoint()]);
    expect(result.candidates[0]?.reasons.join(' ')).toContain(`exact Solana base mint ${A}`);
  });

  it('reports zero results and a missing info URL without fabricating source facts', async () => {
    for (const payload of [[], [pair(A, []), pair(B, [])], [
      { chainId: 'solana', baseToken: { address: A }, url: post, name: 'Official', info: { imageUrl: post } },
    ]]) {
      const io = harness(payload);
      const result = await discoverOrigin([A, B], config, io);
      expect(result.resolution).toMatchObject({ meme: null, endorsements: [], needs_review: true });
      expect(result.candidates).toEqual([]);
      expect(io.resolve).not.toHaveBeenCalled();
    }
  });

  it('accepts only actual social URL fields and excludes profiles, unsafe URLs and missing fields', async () => {
    const urls = [post, `${post}#quoted`, undefined, '', 'javascript:alert(1)', 'http://127.0.0.1/private',
      'https://user:secret@example.com/', 'https://x.com/synthetic', 'https://youtube.com/@synthetic',
      'https://t.me/synthetic', 'https://dexscreener.com/solana/synthetic'];
    const io = harness([pair(A, urls), { chainId: 'solana', baseToken: { address: B }, info: { socials: [
      { platform: 'twitter', handle: 'synthetic' }, { type: 'twitter', url: post }, { website: other },
    ] } }]);
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.needs_review).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(io.resolve).toHaveBeenCalledExactlyOnceWith(post, config);
    expect(result.notes.join(' ')).toMatch(/handles are never converted/);
    expect(JSON.stringify(result)).not.toContain('user:secret');
    expect(result.resolution.meme?.canonical_name).toBe('Synthetic original');
    expect(result.resolution.meme?.evidence).toEqual([post]);
  });

  it('requires independent complete verification even for a unanimous frequently linked URL', async () => {
    for (const resolution of [review(), { ...verified(), needs_review: true },
      verified(post, { resolved: false }), verified(post, { resolved: undefined }), { ...verified(), meme: null }]) {
      const io = harness([pair(A, [post, post]), pair(B, [post, post])]);
      io.resolve.mockResolvedValue(resolution);
      const result = await discoverOrigin([A, B], config, io);
      expect(result.resolution).toMatchObject({ meme: null, endorsements: [], needs_review: true });
      expect(result.candidates[0]?.status).toBe('needs_review');
      expect(result.candidates[0]?.reasons).toContain('The authority resolver did not independently confirm complete source metadata.');
    }
  });

  it('compares every confirmed source, including sources supported by only one CA', async () => {
    for (const patch of [{ canonical_name: 'Other' }, { canonical_ticker: 'OTHER' }, { scope: 'concept' as const },
      { subject_handle: 'other' }, { home_chain: 'bnb' }, { implied_pair: 'TSLA' }, { beneficiary_wallet: C },
      { source_image_hash: 'fedcba9876543210' }]) {
      const io = harness([pair(A, [post, other]), pair(B)]);
      io.resolve.mockImplementation(async url => verified(url, url === other ? patch : {}));
      const result = await discoverOrigin([A, B], config, io);
      expect(result.resolution).toMatchObject({ meme: null, endorsements: [], needs_review: true });
      expect(result.resolution.reasons.join(' ')).toContain('conflicting identities');
      expect(result.candidates.every(candidate => candidate.status === 'confirmed')).toBe(true);
    }
  });

  it('does not pool different URLs merely because their verified strings agree', async () => {
    const result = await discoverOrigin([A, B], config, harness([pair(A), pair(B, [other])]));
    expect(result.resolution.needs_review).toBe(true);
    expect(result.resolution.reasons.join(' ')).toContain('No independently verified source URL is supported by every supplied CA');
  });

  it('retains only the deterministically chosen verified resolution and its endorsements', async () => {
    const io = harness([pair(A, [other, post]), pair(B, [other, post])]);
    io.resolve.mockImplementation(async url => ({ ...verified(url), endorsements: verified(url).endorsements.map(e => ({ ...e, coin_ca: url === post ? A : B })) }));
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution).toEqual(verified(post));
    expect(result.candidates).toHaveLength(2);
    expect(result.resolution.endorsements).toHaveLength(1);
  });

  it('blocks automatic readiness when another candidate remains unresolved', async () => {
    const io = harness([pair(A, [post, other]), pair(B)]);
    io.resolve.mockImplementation(async url => url === post ? verified(url) : review());
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.needs_review).toBe(true);
    expect(result.candidates[0]?.status).toBe('confirmed');
    expect(result.notes.join(' ')).toContain('Synthetic source authority is unknown');
  });

  it('rejects unobserved resolver source URL changes instead of transferring CA support', async () => {
    const io = harness([pair(A), pair(B)]);
    io.resolve.mockResolvedValue(verified(other));
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.needs_review).toBe(true);
    expect(result.candidates[0]?.reasons.join(' ')).toContain('no observed direct, redirect or one-hop provenance');
  });

  it('sorts and deduplicates verifier reasons without mixing in listing authority', async () => {
    const io = harness([pair(A), pair(B)]);
    io.resolve.mockResolvedValue({ ...verified(), reasons: ['Z note', 'A note', 'Z note'] });
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.reasons).toEqual(['A note', 'Z note']);
    expect(result.candidates[0]?.reasons).toEqual([...new Set(result.candidates[0]?.reasons)].sort());
    expect(result.resolution.meme?.evidence).toEqual([post]);
  });
});

describe('one-hop source references and authority isolation', () => {
  async function saved() {
    const data = await jsonFixture('origin-discovery.synthetic.json') as { pairs: unknown[] };
    return harness(data.pairs, { [rootA]: await fixture('origin-coin-a.synthetic.html'),
      [rootB]: await fixture('origin-coin-b.synthetic.html'), [site]: await fixture('origin-source.synthetic.html') });
  }

  it('finds a shared independently verified source via two HTML sites with per-CA paths', async () => {
    const io = await saved();
    const provider = createSourceProvider({ transport: io.transport, authorities: [authority(site)], imageHasher: async () => '0123456789abcdef' });
    const resolve = vi.fn(provider.resolve);
    const result = await discoverOrigin([A, B], config, { transport: io.transport, resolve });
    expect(result.resolution.needs_review).toBe(false);
    expect(result.resolution.meme).toMatchObject({ canonical_name: 'Synthetic original', source_url: site });
    const source = result.candidates.find(candidate => candidate.url === site)!;
    expect(source.coin_cas).toEqual([A, B].sort());
    expect(source.discovered_via).toEqual([endpoint(), rootA, rootB].sort());
    expect(source.reasons).toContain(`Discovery path for ${A}: ${rootA} -> ${rootA} -> ${site} (explicit source link, not authority).`);
    expect(source.reasons).toContain(`Discovery path for ${B}: ${rootB} -> ${rootB} -> ${site} (explicit source link, not authority).`);
    for (const candidate of result.candidates) for (const via of candidate.discovered_via) expect(new URL(via).href).toBe(via);
    expect(result.candidates.filter(candidate => candidate.status === 'confirmed')).toHaveLength(1);
    expect(result.resolution.meme?.evidence).not.toContain(endpoint());
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(io.get.mock.calls.some(([url]) => url.includes('unvisited') || url.includes('127.0.0.1'))).toBe(false);
  });

  it('never promotes self-declared metadata, linked claims or malicious page instructions to authority', async () => {
    const io = await saved();
    const provider = createSourceProvider({ transport: io.transport, imageHasher: async () => '0123456789abcdef' });
    const result = await discoverOrigin([A, B], config, { transport: io.transport, resolve: provider.resolve });
    expect(result.resolution).toMatchObject({ meme: null, endorsements: [], needs_review: true });
    expect(result.candidates.every(candidate => candidate.status !== 'confirmed')).toBe(true);
    expect(io.get.mock.calls.some(([url]) => url.includes('second-hop'))).toBe(false);
  });

  it('does not propagate a CA through two hops when another CA lists the middle site directly', async () => {
    const io = harness([pair(A, [rootA]), pair(B, [rootB])], {
      [rootA]: `<a href="${rootB}">Origin</a>`, [rootB]: `<a href="${post}">Source</a>`,
    });
    io.resolve.mockImplementation(async url => url === post ? verified(url) : review());
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.needs_review).toBe(true);
    expect(result.candidates.find(candidate => candidate.url === post)?.coin_cas).toEqual([B]);
  });

  it('resolves relative links against observed redirects; ignores page-supplied base/canonical URLs', async () => {
    const finalUrl = 'https://landing.example.com/meme/';
    const target = 'https://landing.example.com/origin';
    const io = harness([pair(A, [rootA]), pair(B, [rootA])], { [rootA]: response(finalUrl,
      '<base href="http://127.0.0.1/"><link rel="canonical" href="https://fake.example.com/"><a href="../origin">Origin</a>') });
    io.resolve.mockImplementation(async url => url === target ? verified(url) : review());
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.meme?.source_url).toBe(target);
    expect(result.candidates.find(candidate => candidate.url === target)?.discovered_via).toEqual([endpoint(), rootA, finalUrl].sort());
    expect(io.get).toHaveBeenCalledTimes(2); // API + root; never crawls the target.
  });

  it('allows an observed public redirect to support the final verified source URL', async () => {
    const io = harness([pair(A, [rootA]), pair(B, [rootB])], {
      [rootA]: response(site, '<p>Synthetic</p>'), [rootB]: response(site, '<p>Synthetic</p>'),
    });
    io.resolve.mockResolvedValue(verified(site));
    expect((await discoverOrigin([A, B], config, io)).resolution.needs_review).toBe(false);
  });

  it('preserves unsafe explicit-reference failures despite another common verified source', async () => {
    const io = harness([pair(A, [rootA, post]), pair(B)], { [rootA]: '<a href="http://127.0.0.1/secret">Origin</a>' });
    const result = await discoverOrigin([A, B], config, io);
    expect(result.resolution.needs_review).toBe(true);
    expect(result.resolution.reasons.join(' ')).toContain('unsafe or unsupported explicit source link');
    expect(io.get.mock.calls.some(([url]) => url.includes('127.0.0.1'))).toBe(false);
  });

  it('caps candidates introduced by one-hop links and never resolves omitted evidence', async () => {
    const urls = Array.from({ length: 15 }, (_, i) => `https://x.com/synthetic/status/${1000 + i}`);
    const io = harness([pair(A, [rootA]), pair(B, [rootA])], {
      [rootA]: urls.map(url => `<a href="${url}">Source</a>`).join(''),
    });
    const result = await discoverOrigin([A, B], config, io);
    expect(result.candidates).toHaveLength(10);
    expect(io.resolve).toHaveBeenCalledTimes(10);
    expect(io.get).toHaveBeenCalledTimes(2);
    expect(result.resolution).toMatchObject({ needs_review: true, endorsements: [] });
    expect(result.resolution.reasons.join(' ')).toContain('truncated');
  });
});

describe('failures, deterministic limits and deadlines', () => {
  it('returns sanitized provider/HTTP/parse errors, not server bodies or exception secrets', async () => {
    const secret = 'credential=NEVER_ECHO_THIS';
    for (const result of [new Error(secret), new SourceError('HTTP', secret),
      response(endpoint(), secret, 'application/json', 429), response(endpoint(), '{', 'application/json'),
      response(endpoint(), '{}', 'application/json'), response(endpoint(), '[]', 'text/html'),
      response('https://elsewhere.example.com/', '[]', 'application/json'),
      response(endpoint(), '[]', 'application/json', 206),
      { ...response(endpoint(), '[]', 'application/json'), headers: { 'content-length': '10', 'content-type': 'application/json' } },
      response(endpoint(), 'x'.repeat(1024 * 1024 + 1), 'application/json')]) {
      const resolve = vi.fn(async () => verified());
      const transport: SourceTransport = { get: async () => { if (result instanceof Error) throw result; return result; } };
      const output = await discoverOrigin([A, B], config, { transport, resolve });
      expect(output.resolution.needs_review).toBe(true);
      expect(output.resolution.reasons.join(' ')).toContain('DexScreener discovery unavailable');
      expect(JSON.stringify(output)).not.toContain(secret);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('uses safe DNS and rejects private redirects even when a shared candidate verifies', async () => {
    const exchange = vi.fn(async ({ url }: { url: URL }) => url.href === endpoint()
      ? response(url.href, JSON.stringify([pair(A, [rootA, post]), pair(B)]), 'application/json')
      : { ...response(url.href, '', 'text/html', 302), headers: { location: 'https://private.example.com/' } });
    const transport = createPublicTransport({ timeoutMs: 4_000, maxBytes: 1024 * 1024,
      lookup: async host => [{ address: host === 'private.example.com' ? '10.0.0.1' : '93.184.216.34', family: 4 }], exchange });
    const result = await discoverOrigin([A, B], config, { transport, resolve: async url => verified(url) });
    expect(result.resolution.needs_review).toBe(true);
    expect(result.resolution.reasons.join(' ')).toContain('non-public DNS address rejected');
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(result.candidates.find(candidate => candidate.url === rootA)?.status).toBe('needs_review');
  });

  it('preserves candidate errors and partial results without leaking thrown secrets', async () => {
    const io = harness([pair(A, [post, other]), pair(B)]);
    io.resolve.mockImplementation(async url => { if (url === other) throw new Error('secret=NEVER'); return verified(url); });
    const result = await discoverOrigin([A, B], config, io);
    expect(result.candidates.find(candidate => candidate.url === post)?.status).toBe('confirmed');
    expect(result.resolution).toMatchObject({ needs_review: true, endorsements: [] });
    expect(JSON.stringify(result)).not.toContain('secret=NEVER');
  });

  it('resolves at most ten candidates, reports truncation and sorts results independent of input order', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x.com/synthetic/status/${1000 + i}`);
    const io = harness([pair(A, urls), pair(B, urls)]);
    const first = await discoverOrigin([A, B], config, io);
    const reversed = harness([pair(B, [...urls].reverse()), pair(A, [...urls].reverse())]);
    const second = await discoverOrigin([B, A], config, reversed);
    expect(second).toEqual(first);
    expect(first.candidates).toHaveLength(10);
    expect(io.resolve).toHaveBeenCalledTimes(10);
    expect(first.resolution.needs_review).toBe(true);
    expect(first.resolution.reasons.join(' ')).toContain('Discovery truncated');
    expect(first.candidates.map(candidate => candidate.url)).toEqual([...urls].sort().slice(0, 10));
    expect(first.notes).toEqual([...first.notes].sort());
    expect(JSON.stringify(first)).not.toMatch(/discovered_at|fetched_at|elapsed|duration/);
  });

  it('detects truncated pair, field and HTML scans even if surviving data verifies', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `${post}?ref=${i}`);
    const inputs = [harness([...Array.from({ length: 100 }, () => pair(A)), pair(B)]),
      harness([pair(A, urls), pair(B, urls)]), harness([pair(A, [rootA]), pair(B, [rootA])], {
        [rootA]: `<a href="${post}">Origin</a>` + '<a href="/shop">Shop</a>'.repeat(500),
      })];
    for (const io of inputs) {
      const result = await discoverOrigin([A, B], config, io);
      expect(result.resolution.needs_review).toBe(true);
      expect(result.resolution.reasons.join(' ')).toContain('truncated');
    }
  });

  it('caps resolution concurrency at three', async () => {
    let active = 0; let maximum = 0;
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.com/synthetic/status/${1000 + i}`);
    const io = harness([pair(A, urls), pair(B, urls)]);
    io.resolve.mockImplementation(async url => {
      active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setTimeout(resolve, 1)); active--; return verified(url);
    });
    expect((await discoverOrigin([A, B], config, io)).resolution.needs_review).toBe(false);
    expect(maximum).toBe(3);
  });

  it('enforces a four-second metadata deadline for injected transports', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const resolve = vi.fn(async () => verified());
    const pending = discoverOrigin([A, B], config, { transport: { get: async () => new Promise(() => {}) }, resolve });
    await vi.advanceTimersByTimeAsync(4_001);
    expect((await pending).resolution.reasons.join(' ')).toContain('deadline exceeded');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('caps link network concurrency at three, applies four-second deadlines, and skips timed-out roots', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const urls = Array.from({ length: 10 }, (_, i) => `https://root-${i}.example.com/`);
    const io = harness([pair(A, urls), pair(B, urls)]);
    const original = io.get.getMockImplementation()!;
    let active = 0; let maximum = 0;
    io.get.mockImplementation(async (url, options) => {
      if (url === endpoint()) return original(url, options);
      active++; maximum = Math.max(active, maximum);
      return new Promise(() => {});
    });
    const pending = discoverOrigin([A, B], config, io);
    await vi.advanceTimersByTimeAsync(4_001);
    const result = await pending;
    expect(maximum).toBe(3);
    expect(io.get).toHaveBeenCalledTimes(4); // metadata plus only three stalled roots
    expect(io.resolve).not.toHaveBeenCalled();
    expect(result.resolution.needs_review).toBe(true);
    expect(result.resolution.reasons.join(' ')).toContain('link inspection skipped');
  });

  it('schedules the same HTML roots when listing and CA order change, including partial timeout results', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const urls = Array.from({ length: 5 }, (_, i) => `https://root-${i}.example.com/`);
    const outputs = [];
    for (const reversed of [false, true]) {
      const ordered = reversed ? [...urls].reverse() : urls;
      const io = harness(reversed ? [pair(B, ordered), pair(A, ordered)] : [pair(A, ordered), pair(B, ordered)]);
      const original = io.get.getMockImplementation()!;
      io.get.mockImplementation(async (url, options) => url === endpoint() ? original(url, options) : new Promise(() => {}));
      const pending = discoverOrigin(reversed ? [B, A] : [A, B], config, io);
      await vi.advanceTimersByTimeAsync(4_001);
      outputs.push(await pending);
      expect(io.get.mock.calls.map(([url]) => url)).toEqual([endpoint(), ...urls.slice(0, 3)]);
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });

  it('stops launching callbacks after timeouts, and reports every skipped candidate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.com/synthetic/status/${1000 + i}`);
    const io = harness([pair(A, urls), pair(B, urls)]);
    io.resolve.mockImplementation(async () => new Promise(() => {}));
    const pending = discoverOrigin([A, B], config, io);
    await vi.advanceTimersByTimeAsync(9_001);
    const result = await pending;
    expect(io.resolve).toHaveBeenCalledTimes(3);
    expect(result.resolution.needs_review).toBe(true);
    expect(result.candidates.filter(candidate => candidate.status === 'unverified')).toHaveLength(7);
    expect(result.resolution.reasons.join(' ')).toContain('candidate resolution skipped');
  });

  it('returns within the 28-second global budget and never auto-readies a partial search', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.com/synthetic/status/${1000 + i}`);
    const io = harness([pair(A, urls), pair(B, urls)]);
    io.resolve.mockImplementation(async url => { await new Promise(resolve => setTimeout(resolve, 8_500)); return verified(url); });
    const pending = discoverOrigin([A, B], config, io);
    await vi.advanceTimersByTimeAsync(28_001);
    const result = await pending;
    expect(result.resolution).toMatchObject({ needs_review: true, endorsements: [] });
    expect(result.candidates.filter(candidate => candidate.status === 'confirmed')).toHaveLength(9);
    expect(result.resolution.reasons.join(' ')).toContain('deadline exceeded');
  });
});
