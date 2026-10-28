import { expect, it } from 'vitest';
import { createPipeline } from '@pvp/pipeline';
import { rule } from '@pvp/rules';
import { fixtures } from '@pvp/rules/fixtures';
import type { Ruling, Snapshot } from '@pvp/shared';
import { ReplyPlanner } from './replies';
import { Worker } from './worker';
import { StateStore } from './state';
import { config, fakeApi, me, mention, signal, statePath } from './test-support';
import { vi } from 'vitest';

it('synthetic dispute reaches shared pipeline, immutable repository, real shared PNG renderer and injected X reply', async () => {
  const fixture = structuredClone(fixtures.find(item => item.name === 'robotaxi')!);
  const saved: Ruling[] = [];
  const pipeline = createPipeline({
    ingest: {
      coinFacts: async ca => structuredClone(fixture.coins.find(coin => coin.ca === ca)!),
      snapshotAt: async (ca, at): Promise<Snapshot> => structuredClone(fixture.coins.find(coin => coin.ca === ca)!.snapshots.find(snapshot => snapshot.at === at) ?? {
        id: 'synthetic-missing', coin_ca: ca, at, mcap_usd: null, holders: null, distinct_buyers_lifetime: null,
        last_trade_at: null, source: 'Synthetic missing checkpoint', complete: false, evidence: [],
      }),
    },
    source: { resolve: async () => ({ meme: fixture.meme, endorsements: [], needs_review: false, reasons: [] }) },
    repository: { save: async ruling => { saved.push(ruling); }, findBySlug: async () => null }, judge: rule,
  });
  const plan = new ReplyPlanner(config(), async () => ({ pipeline, close: async () => undefined }));
  const api = fakeApi();
  vi.mocked(api.mentions).mockResolvedValueOnce({ data: [{ ...mention, text: `@${me.username} ${fixture.coins.map(coin => coin.ca).join(' ')}` }] });
  const store = await StateStore.open(await statePath(), 'send');
  const worker = new Worker(config(), api, store, plan);
  await worker.initialize(signal()); await worker.tick(signal());
  expect(saved).toHaveLength(1); expect(saved[0]!.winner_ca).toBe(fixture.expected.winner_ca);
  const card = vi.mocked(api.upload).mock.calls[0]![0];
  expect(card.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(card.readUInt32BE(16)).toBe(1200); expect(card.readUInt32BE(20)).toBe(675);
  expect(vi.mocked(api.reply).mock.calls[0]![1]).toContain(`/ruling/${saved[0]!.share_slug}`);
  await plan.close(); await store.close();
});
