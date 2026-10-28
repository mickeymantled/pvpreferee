import { describe, expect, it, vi } from 'vitest';
import { createSourceFromEnv, createSourceProvider, parseSiteHtml, parseXPost, resolveSource, resolveSources, type SourceTransport } from '../src/index.js';
import { authority, config, fixture, fixtureTransport, jsonFixture, response, siteA, siteB, sourceOptions, xUrl, youtubeUrl } from './helpers.js';

describe('source resolution from explicitly synthetic saved records', () => {
  it('resolves DACITY with exact typo/case and an evidence-backed provider author, without admin auth', async () => {
    const provider = createSourceFromEnv({ X_BEARER_TOKEN: 'synthetic', SOURCE_AUTHORITIES: JSON.stringify([authority(xUrl, 'subject_post')]) }, sourceOptions());
    const result = await provider.resolve(xUrl, config);
    expect(result.needs_review).toBe(false);
    expect(result.meme).toMatchObject({ canonical_name: 'Da Ctiy', canonical_ticker: 'DACITY', scope: 'artifact',
      source_tier: 'subject_post', subject_handle: 'synthetic_subject', source_image_hash: '0123456789abcdef',
      beneficiary_wallet: null, beneficiary_tie_at: null, home_chain: null, implied_pair: null });
    expect(result.endorsements).toEqual([{ coin_ca: '11111111111111111111111111111111', kind: 'ca_post', evidence_url: xUrl,
      evidence_tx: null, at: '2026-10-20T12:00:00.000Z', verified_by: 'synthetic-admin', subject_wallet: null, subject_held_supply_pct: null }]);
    expect(result.meme?.evidence).toContain('https://sources.example.com/identity-proof');
  });

  it('does not turn a verified badge, unsigned handle or third-party CA mention into endorsement', async () => {
    const url = 'https://x.com/synthetic_subject/status/1002';
    const result = await resolveSource(url, config, sourceOptions({ authorities: [authority(url, 'subject_post')] }));
    expect(result).toMatchObject({ meme: null, endorsements: [], needs_review: true });
  });

  it('does not trust even complete labeled source metadata without a configured authority', async () => {
    const result = await resolveSource(siteB, config, sourceOptions());
    expect(result).toMatchObject({ meme: null, needs_review: true });
    const observed = await createSourceProvider(sourceOptions()).inspect(siteB);
    expect(observed.names).toEqual(['Tigrino']);
    expect(observed.subjectHandle).toBeNull();
  });

  it('never promotes an arbitrary title or quoted text to canonical metadata', async () => {
    const url = 'https://sources.example.com/ambiguous';
    const html = await fixture('ambiguous.html');
    expect(parseSiteHtml(html, url, authority(url)).names).toEqual([]);
    const result = await resolveSource(url, config, sourceOptions({ authorities: [authority(url)] }));
    expect(result).toMatchObject({ meme: null, needs_review: true });
  });

  it('resolves a verified YouTube channel description and thumbnail, ignoring the title', async () => {
    const result = await resolveSource(youtubeUrl, config, sourceOptions({ authorities: [authority(youtubeUrl, 'official_asset')] }));
    expect(result.needs_review).toBe(false);
    expect(result.meme).toMatchObject({ canonical_name: 'Tigrino', canonical_ticker: 'TIGRINO', source_tier: 'official_asset', subject_handle: 'synthetic_subject' });
  });

  it('rejects the wrong YouTube channel even with a trusted URL', async () => {
    const binding = authority(youtubeUrl, 'official_asset');
    binding.subject!.youtubeChannelId = 'different-channel';
    expect(await resolveSource(youtubeUrl, config, sourceOptions({ authorities: [binding] }))).toMatchObject({ meme: null, needs_review: true });
  });

  it('follows strict source hierarchy, independently for name and ticker', async () => {
    const result = await resolveSources([siteB, xUrl], config, sourceOptions({ authorities: [authority(siteB, 'wiki'), authority(xUrl, 'subject_post')] }));
    expect(result.needs_review).toBe(false);
    expect(result.meme).toMatchObject({ canonical_name: 'Da Ctiy', canonical_ticker: 'DACITY', source_tier: 'subject_post' });
    const unsupported = structuredClone(config);
    unsupported.identity.source_hierarchy.reverse();
    expect(await resolveSource(xUrl, unsupported, sourceOptions())).toMatchObject({ meme: null, needs_review: true });
  });

  it('resolves same-meme Tilcayo/Tigrino by cited allowlisted press counts', async () => {
    const result = await resolveSources([siteA, siteB], config, sourceOptions({ authorities: [authority(siteA), authority(siteB)],
      pressArticleUrls: ['https://reuters.com/world/pet-one', 'https://www.reuters.com/world/pet-one/?utm_source=x#top',
        'https://apnews.com/article/pet-two', 'https://bbc.com/news/pet-three'] }));
    expect(result.needs_review).toBe(false);
    expect(result.meme?.canonical_name).toBe('Tigrino');
    expect(result.meme?.press_candidates).toEqual([
      { value: 'Tigrino', articles: ['https://reuters.com/world/pet-one', 'https://apnews.com/article/pet-two'] },
      { value: 'Tilcayo', articles: ['https://bbc.com/news/pet-three'] },
    ]);
  });

  it('leaves a press tie unresolved and never breaks it by URL or input order', async () => {
    const options = sourceOptions({ authorities: [authority(siteA), authority(siteB)], pressArticleUrls: ['https://reuters.com/world/pet-one', 'https://bbc.com/news/pet-three'] });
    const result = await resolveSources([siteA, siteB], config, options);
    expect(result).toMatchObject({ meme: null, needs_review: true });
    expect(result.reasons.join(' ')).toMatch(/tied/);
    expect(await resolveSources([siteB, siteA], config, options)).toEqual(result);
  });

  it('requires scope review for species/concept versus specific pet/artifact', async () => {
    const html = (await fixture('tilcayo.html')).replace('content="artifact"', 'content="concept"');
    const result = await resolveSources([siteA, siteB], config, sourceOptions({ authorities: [authority(siteA), authority(siteB)],
      transport: fixtureTransport({ [siteA]: response(siteA, html) }) }));
    expect(result.meme).toBeNull();
    expect(result.reasons.join(' ')).toContain('separate memes');
  });

  it('detects wallet and fee references without inventing holdings or claims', async () => {
    const url = 'https://x.com/synthetic_subject/status/1003';
    const provider = createSourceProvider(sourceOptions({ authorities: [authority(url, 'subject_post')] }));
    const observed = await provider.inspect(url);
    expect(observed.references.map(ref => ref.kind)).toEqual(['wallet', 'fee_claim']);
    expect((await provider.resolve(url, config)).endorsements).toEqual([]);
    const verifyChainEvidence = vi.fn(async () => null);
    const thirdParty = 'https://x.com/synthetic_subject/status/1002';
    await resolveSource(thirdParty, config, sourceOptions({ verifyChainEvidence, authorities: [authority(thirdParty, 'subject_post')] }));
    expect(verifyChainEvidence).not.toHaveBeenCalled();
  });

  it('accepts only matched external attestations for wallet holdings and fee claims', async () => {
    const url = 'https://x.com/synthetic_subject/status/1003';
    const result = await resolveSource(url, config, sourceOptions({ authorities: [authority(url, 'subject_post')],
      verifyChainEvidence: async ref => ({ kind: ref.kind === 'wallet' ? 'majority_supply' : 'fee_claim',
        coin_ca: '11111111111111111111111111111111', subject_wallet: '11111111111111111111111111111111',
        subject_held_supply_pct: ref.kind === 'wallet' ? 75 : null, evidence_tx: '1'.repeat(64),
        at: '2026-10-20T14:00:00.000Z', verified_by: 'synthetic-chain-verifier' }),
    }));
    expect(result.endorsements.map(e => e.kind)).toEqual(['majority_supply', 'fee_claim']);
    expect(result.endorsements[0]?.subject_held_supply_pct).toBe(75);
  });

  it('does not treat a repost as the subject’s own assertion or infer a missing timestamp', async () => {
    const payload = await jsonFixture('dacity.x.json') as { data: Record<string, unknown> };
    payload.data.referenced_tweets = [{ type: 'retweeted', id: '123' }];
    expect(parseXPost(payload, xUrl, '1001', authority(xUrl, 'subject_post')).verified).toBe(false);
    delete payload.data.referenced_tweets; delete payload.data.created_at;
    const transport: SourceTransport = { get: async url => response(url, JSON.stringify(payload), 'application/json') };
    const result = await resolveSource(xUrl, config, sourceOptions({ transport, authorities: [authority(xUrl, 'subject_post')] }));
    expect(result.endorsements).toEqual([]);
    expect(result.needs_review).toBe(true);
    payload.data.created_at = '2026-02-30T12:00:00Z';
    expect(parseXPost(payload, xUrl, '1001', authority(xUrl, 'subject_post')).publishedAt).toBeNull();
  });

  it('fails closed on missing credentials, provider errors and unsafe URLs', async () => {
    const provider = createSourceFromEnv({}, { transport: fixtureTransport() });
    expect(await provider.resolve(xUrl, config)).toMatchObject({ meme: null, needs_review: true });
    expect(await provider.resolve('http://127.0.0.1/private', config)).toMatchObject({ meme: null, needs_review: true });
    const transport: SourceTransport = { get: async () => { throw new Error('secret-api-key=DO-NOT-LEAK'); } };
    const result = await resolveSource(siteA, config, { transport });
    expect(result.reasons.join(' ')).not.toContain('DO-NOT-LEAK');
    expect(() => createSourceFromEnv({ SOURCE_AUTHORITIES: 'invalid' })).toThrow(/SOURCE_AUTHORITIES/);
  });

  it('uses documented provider fields, auth headers, and disallows API redirects', async () => {
    const fixtureGet = fixtureTransport().get;
    const get = vi.fn(fixtureGet);
    const provider = createSourceProvider(sourceOptions({ transport: { get } }));
    await provider.inspect(xUrl);
    const [url, options] = get.mock.calls[0]!;
    expect(new URL(url).searchParams.get('expansions')).toBe('author_id,attachments.media_keys');
    expect(options).toMatchObject({ allowRedirects: false, headers: { Authorization: 'Bearer synthetic-not-a-secret' } });
    await provider.inspect(youtubeUrl);
    expect(new URL(get.mock.calls[1]![0]).searchParams.get('part')).toBe('snippet');
  });

  it('does not transfer site authority through a redirect', async () => {
    const result = await resolveSource(siteB, config, sourceOptions({ authorities: [authority(siteB)],
      transport: fixtureTransport({ [siteB]: response('https://untrusted.example.com/pet', await fixture('tigrino.html')) }) }));
    expect(result).toMatchObject({ meme: null, needs_review: true });
  });

  it('keeps image failures unknown and reviewable', async () => {
    const result = await resolveSource(siteB, config, sourceOptions({ authorities: [authority(siteB)], imageHasher: async () => { throw new Error('no image'); } }));
    expect(result.meme?.source_image_hash).toBeNull();
    expect(result.meme?.resolved).toBe(false);
    expect(result.needs_review).toBe(true);
  });

  it('extracts explicit trusted chain, pair and launchpad without inferring beneficiary timing', async () => {
    const result = await resolveSource(siteB, config, sourceOptions({ authorities: [authority(siteB)],
      transport: fixtureTransport({ [siteB]: 'chain-pair.html' }) }));
    expect(result.needs_review).toBe(false);
    expect(result.meme).toMatchObject({ canonical_name: 'robotaxi', home_chain: 'bnb', implied_pair: 'BNB',
      source_launchpad: 'synthetic-pad', beneficiary_tie_at: null, beneficiary_wallet: null });
  });

  it('uses only an exact published pair-map key when explicit source pairing is absent', async () => {
    const original = await fixture('chain-pair.html');
    const html = original.replace('<p>Implied pair: BNB</p>', '');
    const options = sourceOptions({ authorities: [authority(siteB)], transport: fixtureTransport({ [siteB]: response(siteB, html) }) });
    expect((await resolveSource(siteB, config, options)).meme?.implied_pair).toBe('TSLA');
    const differentCase = { ...options, transport: fixtureTransport({ [siteB]: response(siteB, html.replace('Name: robotaxi', 'Name: Robotaxi')) }) };
    expect((await resolveSource(siteB, config, differentCase)).meme?.implied_pair).toBeNull();
  });

  it('uses source precedence for explicit chain/pair fields and leaves conflicts unresolved', async () => {
    const html = await fixture('chain-pair.html');
    const altered = html.replace('content="bnb"', 'content="solana"').replace('Implied pair: BNB', 'Implied pair: SOL');
    const transport = fixtureTransport({ [siteA]: response(siteA, altered), [siteB]: response(siteB, html) });
    const result = await resolveSources([siteA, siteB], config, sourceOptions({ transport, authorities: [authority(siteA, 'wiki'), authority(siteB, 'official_asset')] }));
    expect(result.meme).toMatchObject({ home_chain: 'bnb', implied_pair: 'BNB' });
    const conflict = await resolveSources([siteA, siteB], config, sourceOptions({ transport, authorities: [authority(siteA), authority(siteB)] }));
    expect(conflict.needs_review).toBe(true);
    expect(conflict.meme).toMatchObject({ home_chain: null, implied_pair: null });
  });
});
