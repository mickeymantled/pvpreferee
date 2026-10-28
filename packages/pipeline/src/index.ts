import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, type CoinFacts, type Endorsement, type IngestProvider, type MemeRecord, type Ruling, type RulingRepository, type Rulebook, type SourceProvider, type SourceResolution } from '@pvp/shared';
import { loadRulebook } from '@pvp/config';

export class NeedsResolutionError extends Error {
  constructor(public readonly resolution: SourceResolution) { super(resolution.reasons.join('; ') || 'The meme needs source review.'); this.name = 'NeedsResolutionError'; }
}
export class InvalidInputError extends Error { override name = 'InvalidInputError'; }
export interface RulingInput { cas: string[]; source_url: string; version?: string }
export interface ResolvedRulingInput { cas: string[]; meme: MemeRecord; version?: string; endorsements?: Endorsement[] }
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
  let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length && !failure) {
      const index = cursor++;
      try { results[index] = await fn(values[index]!); }
      catch (error) { failure ??= { error }; }
    }
  }));
  // Drain already-started provider calls before callers close runtime/DB resources.
  if (failure) throw failure.error;
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
    const coins = await parallelMap(cas, 5, async ca => {
      const coin = structuredClone(await deps.ingest.coinFacts(ca, config));
      if (coin.ca !== ca) throw new Error('Coin provider returned a mismatched CA.');
      coin.meme_id ??= meme.id;
      coin.endorsements.push(...structuredClone((input.endorsements ?? []).filter(e => e.coin_ca === ca)));
      if (coin.subject_held_supply_pct === null) {
        const measurements = coin.endorsements.filter(e => e.verified_by && (e.evidence_tx || e.evidence_url) &&
          e.subject_held_supply_pct !== null && Number.isFinite(e.subject_held_supply_pct) &&
          e.subject_held_supply_pct >= 0 && e.subject_held_supply_pct <= 100 && Date.parse(e.at) <= Date.parse(coin.observed_at));
        const latestAt = Math.max(...measurements.map(e => Date.parse(e.at)));
        const latest = [...new Set(measurements.filter(e => Date.parse(e.at) === latestAt).map(e => e.subject_held_supply_pct!))];
        if (latest.length === 1) coin.subject_held_supply_pct = latest[0]!;
      }
      return coin;
    });
    const tasks = coins.flatMap(coin => [...new Set(coins.filter(rival => rival.ca !== coin.ca)
      .flatMap(rival => rival.first_real_buy_at ? [rival.first_real_buy_at] : []))].map(at => ({ coin, at })));
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
    coins.sort((a, b) => a.ca < b.ca ? -1 : a.ca > b.ca ? 1 : 0);
    for (const coin of coins) coin.snapshots.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
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
    return runResolved({ cas: input.cas, meme: resolution.meme, version: input.version, endorsements: resolution.endorsements });
  }
  return { resolveSource, run, runResolved, findBySlug: (slug: string) => deps.repository.findBySlug(slug) };
}
export type Pipeline = ReturnType<typeof createPipeline>;
