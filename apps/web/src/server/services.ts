import "server-only";
import { loadRulebook } from "@pvp/config";
import type { Ruling } from "@pvp/shared";
import type { IngestRulingRepository } from "@pvp/ingest";
import type { WebServices } from "../lib/workflow";
import { isShareSlug } from "../lib/input";

/** Request-scoped pools are always closed. No provider or DB is created at module load. */
export async function withRepository<T>(
  work: (repository: IngestRulingRepository) => Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured.");
  const { createRulingRepository } = await import("@pvp/ingest");
  const repository = createRulingRepository(process.env.DATABASE_URL);
  try {
    return await work(repository);
  } finally {
    await repository.close();
  }
}

export const webServices: WebServices = {
  async resolve(input) {
    // Discovery needs public token links, not full historical ingest or Helius credentials.
    const { createSourceFromEnv, createPublicTransport, discoverOrigin } = await import("@pvp/source");
    const source = input.source_url ? createSourceFromEnv() : createSourceFromEnv(process.env, {
      transport: createPublicTransport({ timeoutMs: 4_000, maxBytes: 1024 * 1024 }),
    });
    const config = loadRulebook(input.version).config;
    const resolveOne = async (url: string) => {
      const resolution = await source.resolve(url, config);
      if (!process.env.DATABASE_URL) return resolution;
      // A configured but inaccessible repository must never silently discard an audited override.
      const reviewed = await withRepository(repository => repository.findMemeBySourceUrl(url));
      if (!reviewed?.overrides.length) return resolution;
      return {
        meme: reviewed,
        endorsements: resolution.endorsements,
        needs_review: reviewed.resolved !== true,
        reasons: reviewed.resolved === true ? [] : ["The stored source review is not confirmed."],
      };
    };
    if (input.source_url) return resolveOne(input.source_url);
    const { resolution, ...discovery } = await discoverOrigin(input.cas, config, { resolve: resolveOne });
    return { ...resolution, discovery };
  },
  async run(input, meme, endorsements) {
    const { createRuntime } = await import("@pvp/pipeline/runtime");
    const runtime = createRuntime();
    try {
      return await runtime.pipeline.runResolved({
        cas: input.cas,
        meme,
        version: input.version,
        endorsements,
      });
    } finally {
      await runtime.close();
    }
  },
};

/** Read the frozen payload only. A permalink never re-ingests or re-scores. */
export async function findStoredRuling(slug: string): Promise<Ruling | null> {
  if (!isShareSlug(slug)) return null;
  return withRepository((repository) => repository.findBySlug(slug));
}
