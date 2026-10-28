import { describe, expect, it } from 'vitest';
import { fixtures } from '@pvp/rules/fixtures';
import { rule } from '@pvp/rules';
import type { Ruling, Snapshot } from '@pvp/shared';
import { createPipeline } from './index';

describe('synthetic disputes through the shared pipeline', () => {
  for (const fixture of fixtures) it(fixture.name, async () => {
    const saved: Ruling[] = [];
    const pipeline = createPipeline({
      ingest: {
        coinFacts: async ca => structuredClone(fixture.coins.find(c => c.ca === ca)!),
        snapshotAt: async (ca, at): Promise<Snapshot> => structuredClone(fixture.coins.find(c => c.ca === ca)!.snapshots.find(s => s.at === at) ?? {
          id: 'synthetic-unavailable', coin_ca: ca, at, mcap_usd: null, holders: null, distinct_buyers_lifetime: null,
          last_trade_at: null, source: 'Synthetic fixture has no checkpoint at this instant', complete: false, evidence: [],
        }),
      },
      source: { resolve: async () => ({ meme: structuredClone(fixture.meme), endorsements: [], needs_review: false, reasons: [] }) },
      repository: { save: async ruling => { saved.push(ruling); }, findBySlug: async () => null },
      judge: rule,
    });
    const result = await pipeline.run({ cas: fixture.coins.map(c => c.ca).reverse(), source_url: fixture.meme.source_url });
    expect(result.winner_ca).toBe(fixture.expected.winner_ca);
    expect(result.status).toBe(fixture.expected.status);
    expect(Object.fromEntries(result.grid.map(row => [row.coin, row.eliminated_by]))).toEqual(fixture.expected.eliminated_by);
    expect(result.coin_cas).toEqual(result.facts.coins.map(c => c.ca));
    expect(saved).toEqual([result]);
  });
  it('uses verified source supply measurements when ingest has no subject label', async () => {
    const fixture = structuredClone(fixtures.find(f => f.name === 'kimchi_qr')!);
    const endorsements = fixture.coins.flatMap(c => c.endorsements);
    fixture.coins.forEach(c => { c.endorsements = []; c.subject_held_supply_pct = null; });
    const pipeline = createPipeline({
      ingest: {
        coinFacts: async ca => fixture.coins.find(c => c.ca === ca)!,
        snapshotAt: async (ca, at) => ({ id:'synthetic-unavailable',coin_ca:ca,at,mcap_usd:null,holders:null,distinct_buyers_lifetime:null,last_trade_at:null,source:'synthetic missing checkpoint',complete:false,evidence:[] }),
      },
      source: { resolve: async () => ({ meme:fixture.meme,endorsements,needs_review:false,reasons:[] }) },
      repository: { save:async()=>{},findBySlug:async()=>null }, judge:rule,
    });
    const result = await pipeline.run({cas:fixture.coins.map(c=>c.ca),source_url:fixture.meme.source_url});
    expect(result.winner_ca).toBe(fixture.expected.winner_ca);
    expect(result.facts.coins.find(c=>c.ca===fixture.expected.winner_ca)!.subject_held_supply_pct).toBe(75);
  });
});
