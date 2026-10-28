import { createIngestFromEnv, createRulingRepository, type HistoricalLedger } from '@pvp/ingest';
import { createSourceFromEnv, hashImageFromUrl } from '@pvp/source';
import { rule } from '@pvp/rules';
import { createPipeline } from './index';

export interface RuntimeOptions { env?: NodeJS.ProcessEnv; ledger?: HistoricalLedger }
/** Server-only composition shared by Next.js and the worker. No connections on import. */
export function createRuntime(options: RuntimeOptions = {}) {
  const env = options.env ?? process.env;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to save reproducible rulings.');
  const ingest = createIngestFromEnv({ env, ledger: options.ledger });
  const repository = createRulingRepository(env.DATABASE_URL);
  const discovered = createSourceFromEnv(env);
  const source = { ...discovered, async resolve(url: string, config: Parameters<typeof discovered.resolve>[1]) {
    const [resolution, reviewed] = await Promise.all([discovered.resolve(url, config), repository.findMemeBySourceUrl(url)]);
    if (!reviewed?.overrides.length) return resolution;
    return { meme: reviewed, endorsements: resolution.endorsements, needs_review: reviewed.resolved !== true,
      reasons: reviewed.resolved === true ? [] : ['The stored source review is not confirmed.'] };
  } };
  const pipeline = createPipeline({ ingest, source, repository, judge: rule, hashImage: hashImageFromUrl });
  return { pipeline, ingest, source, repository, async close() { await Promise.all([ingest.close(), repository.close()]); } };
}
export type Runtime = ReturnType<typeof createRuntime>;
