import type { IngestProvider, Rulebook } from '@pvp/shared';
import { isAddress } from '@solana/addresses';

/** Provider must attest the actual trending ranking, not substitute recently created mints. */
export type TrendingResult = { status: 'ok'; mints: string[]; asOf: string; evidence: string; methodology: string } | { status: 'unsupported'; reason: string };
export interface TrendingProvider { top50(signal: AbortSignal): Promise<TrendingResult> }
export class UnsupportedTrendingProvider implements TrendingProvider {
  async top50(): Promise<TrendingResult> {
    return { status: 'unsupported', reason: 'No verified pump.fun top-50 trending adapter is installed. Configure a reviewed TrendingProvider and a complete historical ledger; recency order is not a trending ranking.' };
  }
}
export interface WarmReport {
  status: 'complete' | 'partial' | 'unsupported' | 'failed';
  reason?: string; ranking?: { asOf: string; evidence: string; methodology: string };
  // `ready` means complete facts returned. Only the CLI's Postgres adapter attests a cache write/read.
  results: { ca: string; status: 'ready' | 'incomplete' | 'failed' }[];
}
export async function warmTrending(provider: TrendingProvider, ingest: IngestProvider, config: Rulebook, at: string, concurrency = 3): Promise<WarmReport> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error('Warming concurrency must be 1–5.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString().replace('.000Z', 'Z') !== at.replace('.000Z', 'Z')) throw new Error('Warming requires a valid whole-second UTC timestamp.');
  let ranking: TrendingResult;
  try { ranking = await provider.top50(AbortSignal.timeout(10000)); }
  catch { return { status: 'failed', reason: 'Trending provider failed; no warming attempted.', results: [] }; }
  if (ranking.status === 'unsupported') return { ...ranking, results: [] };
  if (!ranking.evidence || !ranking.methodology || !Number.isFinite(Date.parse(ranking.asOf)) || ranking.mints.length === 0 || ranking.mints.length > 50 || new Set(ranking.mints).size !== ranking.mints.length || ranking.mints.some(ca => !isAddress(ca))) {
    return { status: 'failed', reason: 'Trending provider returned an invalid or undocumented ranking.', results: [] };
  }
  const results: WarmReport['results'] = new Array(ranking.mints.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, ranking.mints.length) }, async () => {
    while (cursor < ranking.mints.length) {
      const index = cursor++, ca = ranking.mints[index]!;
      try {
        // The operational CLI supplies a Postgres-backed snapshotAt adapter.
        // No invented meme assignment or ruling is needed to warm a historical instant.
        const snapshot = await ingest.snapshotAt(ca, at, config);
        if (snapshot.coin_ca !== ca || Date.parse(snapshot.at) !== Date.parse(at)) throw new Error('Mismatched snapshot');
        results[index] = { ca, status: snapshot.complete ? 'ready' : 'incomplete' };
      } catch { results[index] = { ca, status: 'failed' }; }
    }
  }));
  return { status: results.every(row => row.status === 'ready') ? 'complete' : 'partial', ranking: { asOf: ranking.asOf, evidence: ranking.evidence, methodology: ranking.methodology }, results };
}
