import { describe, expect, it, vi } from 'vitest';
import type { CoinFacts, MemeRecord, Ruling, Snapshot } from '@pvp/shared';
import { loadRulebook } from '@pvp/config';
import { createPipeline, NeedsResolutionError, parseCas, validateCas } from './index';

// Synthetic fixtures use valid public-key encodings, never claimed token identities.
const cas = ['11111111111111111111111111111112', '11111111111111111111111111111113'];
const t0 = '2026-01-01T00:00:00.000Z';
const t1 = '2026-01-01T00:10:00.000Z';
const meme: MemeRecord = { id:'synthetic', slug:'synthetic', scope:'artifact', canonical_name:'Synthetic', canonical_ticker:'SYN', source_url:'https://example.com/synthetic', source_tier:'site_text', source_image_hash:null, source_image_url:null, subject_handle:null, home_chain:null, implied_pair:'SOL', beneficiary_wallet:null, beneficiary_tie_at:null, created_by:'test', source_launchpad:null, overrides:[], evidence:[], resolved:true };
function coin(ca: string): CoinFacts { return { ca, meme_id:meme.id, chain:'solana', launchpad:'pump.fun', pair_asset:'SOL', name:'Synthetic', ticker:'SYN', image_hash:null, image_url:null, creator_wallet:null, fee_wallet:null, deployed_at:t0, first_real_buy_at:ca===cas[0]?t0:t1, bonded_at:null, mint_authority:null, freeze_authority:null, launch_mcap_usd:1000, beneficiary_claimable:null, fee_tie_at:null, subject_held_supply_pct:null, endorsements:[], snapshots:[], flags:{}, evidence:[], observed_at:t1 }; }
function setup() {
  const originals = cas.map(coin);
  const save = vi.fn(async (_r: Ruling) => {});
  const snapshotAt = vi.fn(async (ca: string, at: string): Promise<Snapshot> => ({ id:ca+at, coin_ca:ca, at, mcap_usd:2000, holders:5, distinct_buyers_lifetime:5, last_trade_at:at, source:'synthetic', complete:true, evidence:[] }));
  const judge = vi.fn((coins, m, config): Ruling => ({ id:'pure', meme_id:m.id, coin_cas:cas, winner_ca:cas[0]!, ranked_cas:cas, status:'resolved', grid:[], flags:{}, config_hash:loadRulebook().hash, rules_version:config.version, facts_hash:'pending', created_at:t1, share_slug:'pure', facts:{coins,meme:m,config} }));
  const deps = { ingest:{ coinFacts:vi.fn(async (ca:string) => originals.find(c=>c.ca===ca)!), snapshotAt }, source:{resolve:vi.fn(async () => ({meme, endorsements:[], needs_review:false, reasons:[]}))}, repository:{save,findBySlug:vi.fn(async()=>null)}, judge, newId:()=> 'persisted-run', now:()=>new Date(t1) };
  return {deps, originals, pipeline:createPipeline(deps), judge, save, snapshotAt};
}
describe('shared pipeline', () => {
  it('freezes exact rival-time snapshots and does not mutate cached facts', async () => {
    const {pipeline, originals, snapshotAt, save, judge} = setup();
    const result = await pipeline.run({cas,source_url:meme.source_url});
    expect(snapshotAt).toHaveBeenCalledTimes(4);
    expect(judge.mock.calls[0]![0][0].snapshots.map((s:Snapshot)=>s.at).sort()).toEqual([t0,t1]);
    expect(originals[0]!.snapshots).toEqual([]);
    expect(result.id).toBe('persisted-run');
    expect(result.facts_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(save).toHaveBeenCalledWith(result);
  });
  it('does not ingest or persist when source needs review', async () => {
    const {deps} = setup();
    deps.source.resolve.mockResolvedValue({meme,endorsements:[],needs_review:true,reasons:[]});
    await expect(createPipeline(deps).run({cas,source_url:meme.source_url})).rejects.toBeInstanceOf(NeedsResolutionError);
    expect(deps.ingest.coinFacts).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });
  it('rejects mismatched provider snapshots before saving', async () => {
    const {deps} = setup();
    deps.ingest.snapshotAt.mockImplementation(async (ca,at)=>({id:'bad',coin_ca:ca,at:t0===at?t1:t0,mcap_usd:null,holders:null,distinct_buyers_lifetime:null,last_trade_at:null,source:'synthetic',complete:false,evidence:[]}));
    await expect(createPipeline(deps).run({cas,source_url:meme.source_url})).rejects.toThrow('mismatched');
    expect(deps.repository.save).not.toHaveBeenCalled();
  });
  it('validates actual base58 key size, deduplicates, and bounds input', () => {
    expect(parseCas(cas.join(',\n'))).toEqual(cas);
    expect(()=>validateCas([cas[0]!,cas[0]!])).toThrow();
    expect(()=>validateCas(['z'.repeat(44),cas[0]!])).toThrow();
    expect(()=>parseCas('0x123 garbage')).toThrow();
  });
});
