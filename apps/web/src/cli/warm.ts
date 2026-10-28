import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashRulebook, loadRulebook } from '@pvp/config';
import { createIngestFromEnv, createPostgresSnapshotCache, type HistoricalLedger } from '@pvp/ingest';
import { UnsupportedTrendingProvider, warmTrending, type TrendingProvider } from '../server/warming';

/** Trusted operator-owned local module; never loaded from a browser request. */
export interface WarmingAdapter { trending: TrendingProvider; ledger: HistoricalLedger }
async function main() {
  const modulePath = process.env.WARMING_ADAPTER_MODULE;
  if (!modulePath) {
    console.log(JSON.stringify(await new UnsupportedTrendingProvider().top50()));
    process.exitCode = 2; return;
  }
  if (!isAbsolute(modulePath) || !process.env.DATABASE_URL) throw new Error('An absolute WARMING_ADAPTER_MODULE and DATABASE_URL are required.');
  const module = await import(pathToFileURL(modulePath).href) as { createWarmingAdapter(env: NodeJS.ProcessEnv): Promise<WarmingAdapter> };
  const adapter = await module.createWarmingAdapter(process.env);
  if (!adapter.trending?.top50 || !adapter.ledger?.page) throw new Error('Adapter must supply a trending provider and a complete historical ledger.');
  const cache = createPostgresSnapshotCache(process.env.DATABASE_URL);
  try {
    const ingest = createIngestFromEnv({ env: process.env, ledger: adapter.ledger, cache });
    try {
      const persisted = { ...ingest, async snapshotAt(ca: string, at: string, config: Parameters<typeof ingest.snapshotAt>[2]) {
        const snapshot = await ingest.snapshotAt(ca, at, config);
        if (snapshot.complete) {
          const stored = await cache.get(ca, at, hashRulebook(config));
          if (!stored?.complete || stored.id !== snapshot.id) throw new Error('Snapshot cache verification failed');
        }
        return snapshot;
      } };
      const report = await warmTrending(adapter.trending, persisted, loadRulebook(process.argv[2] || 'v1').config, process.env.WARM_AT || new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
      console.log(JSON.stringify({ ...report, cache_backend: 'postgres', ready_results_verified_in_cache: true }));
      if (report.status !== 'complete') process.exitCode = report.status === 'unsupported' ? 2 : 1;
    } finally { await ingest.close(); }
  } finally { await cache.close(); }
}
main().catch(() => { console.error('Warming failed. Verify the local adapter, provider credentials, config version and database access.'); process.exitCode = 1; });
