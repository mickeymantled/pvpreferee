import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, type CoinFacts, type IngestProvider, type MemeRecord, type Ruling, type RulingRepository, type Rulebook, type SourceProvider, type SourceResolution } from '@pvp/shared';
import { loadRulebook } from '@pvp/config';

export class NeedsResolutionError extends Error {
  constructor(public readonly resolution: SourceResolution) { super(resolution.reasons.join('; ') || 'The meme needs source review.'); this.name = 'NeedsResolutionError'; }
}
export class InvalidInputError extends Error { override name = 'InvalidInputError'; }
export interface RulingInput { cas: string[]; source_url: string; version?: string }
export interface ResolvedRulingInput { cas: string[]; meme: MemeRecord; version?: string }
export interface PipelineDependencies {
  ingest: IngestProvider; source: SourceProvider; repository: RulingRepository;
  judge: (coins: CoinFacts[], meme: MemeRecord, config: Rulebook) => Ruling;
  hashImage?: (url: string) => Promise<string>;
  now?: () => Date; newId?: () => string;
}
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function validateCas(cas: string[]): string[] {
  const unique = [...new Set(cas.map(ca => ca.trim()).filter(Boolean))];
  if (unique.length < 2 || unique.length > 10) throw new InvalidInputError('Enter 2 to 10 distinct Solana contract addresses.');
  if (unique.some(ca => !BASE58.test(ca) || decodedLength(ca) !== 32)) throw new InvalidInputError('Each contract address must be a valid 32-byte Solana public key.');
  return unique;
}
function decodedLength(input: string): number {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of input) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (n > 0n) { bytes++; n >>= 8n; }
  return bytes + (input.match(/^1*/)?.[0].length ?? 0);
}
export function parseCas(input: string): string[] { return validateCas(input.split(/[\s,;]+/)); }
export function validateSourceUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new InvalidInputError('Enter a valid source URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new InvalidInputError('Source must be a public HTTP or HTTPS URL.');
  return url.href;
}
async function parallelMap<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; results[index] = await fn(values[index]!); }
  }));
  return results;
}
export function createPipeline(deps: PipelineDependencies) {
  async function resolveSource(sourceUrl: string, version = 'v1'): Promise<SourceResolution> {
    return deps.source.resolve(validateSourceUrl(sourceUrl), loadRulebook(version).config);
  }
  async function runResolved(input: ResolvedRulingInput): Promise<Ruling> {
    const cas = validateCas(input.cas);
    const { config, hash } = loadRulebook(input.version);
    const meme = structuredClone(input.meme);
    validateSourceUrl(meme.source_url);
    if (meme.resolved === false || !meme.canonical_name || !meme.canonical_ticker) {
      throw new NeedsResolutionError({ meme, endorsements: [], needs_review: true, reasons: ['A confirmed canonical name and ticker are required.'] });
    }
    const coins = await parallelMap(cas, 5, async ca => structuredClone(await deps.ingest.coinFacts(ca, config)));
    const times = [...new Set(coins.flatMap(coin => coin.first_real_buy_at ? [coin.first_real_buy_at] : []))];
    const tasks = coins.flatMap(coin => times.map(at => ({ coin, at })));
    await parallelMap(tasks, 6, async ({ coin, at }) => {
      const snapshot = await deps.ingest.snapshotAt(coin.ca, at, config);
      if (snapshot.coin_ca !== coin.ca || snapshot.at !== at) throw new Error('Snapshot provider returned a mismatched CA or timestamp.');
      coin.snapshots = [...coin.snapshots.filter(s => s.at !== at), snapshot];
    });
    if (deps.hashImage) await parallelMap(coins, 3, async coin => {
      if (!coin.image_hash && coin.image_url) {
        try { coin.image_hash = await deps.hashImage!(coin.image_url); }
        catch { coin.flags.warnings = [...(coin.flags.warnings ?? []), 'Image comparison unavailable.']; }
      }
    });
    const computed = deps.judge(coins, meme, config);
    if (computed.config_hash !== hash) throw new Error('Rules returned a different config hash.');
    const id = (deps.newId ?? randomUUID)();
    const ruling: Ruling = { ...computed, id, share_slug: id, created_at: (deps.now ?? (() => new Date()))().toISOString() };
    // Bind the persisted payload to the exact evidence and configuration used.
    ruling.facts = structuredClone({ coins, meme, config });
    ruling.facts_hash = createHash('sha256').update(canonicalJson(ruling.facts)).digest('hex');
    await deps.repository.save(ruling);
    return ruling;
  }
  async function run(input: RulingInput): Promise<Ruling> {
    validateCas(input.cas);
    const resolution = await resolveSource(input.source_url, input.version);
    if (!resolution.meme || resolution.needs_review) throw new NeedsResolutionError(resolution);
    const originalIngest = deps.ingest;
    // Endorsements discovered from the cited source become frozen evidence on the matching coin.
    const enriched = createPipeline({ ...deps, ingest: {
      snapshotAt: (ca, at, config) => originalIngest.snapshotAt(ca, at, config),
      coinFacts: async (ca, config) => {
        const coin = await originalIngest.coinFacts(ca, config);
        return { ...coin, endorsements: [...coin.endorsements, ...resolution.endorsements.filter(e => e.coin_ca === ca)] };
      },
    } });
    return enriched.runResolved({ cas: input.cas, meme: resolution.meme, version: input.version });
  }
  return { resolveSource, run, runResolved, findBySlug: (slug: string) => deps.repository.findBySlug(slug) };
}
export type Pipeline = ReturnType<typeof createPipeline>;
