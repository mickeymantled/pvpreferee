import { randomUUID } from 'node:crypto';
import { canonicalJson, type MemeRecord, type OverrideEntry } from '@pvp/shared';
import { isSolanaAddress, SOURCE_HIERARCHY, timestamp } from './parse.js';
import { publicUrl, SourceError } from './transport.js';

const editableFields = [
  'scope', 'canonical_name', 'canonical_ticker', 'source_url', 'source_tier', 'source_image_hash',
  'source_image_url', 'subject_handle', 'home_chain', 'implied_pair', 'beneficiary_wallet',
  'beneficiary_tie_at', 'source_launchpad', 'evidence', 'press_candidates', 'resolved',
] as const;
export type ManualOverridePatch = Partial<Pick<MemeRecord, typeof editableFields[number]>>;
/** Construct from a server-validated session; never accept this object from the form body. */
export interface CallerAuthContext { authenticated: true; actor: string }
export interface OverrideRequest { patch: ManualOverridePatch; reason: string }
export interface OverrideCommit { previous: MemeRecord | null; current: MemeRecord; entries: OverrideEntry[] }
export interface ManualOverrideServiceOptions {
  /** Single immutable server-side identity (Brian's login subject); no array or first-user fallback. */
  adminActor: string;
  /** Persist record and audit entries atomically, with concurrency checks. Throw on failure. */
  persist: (commit: OverrideCommit) => Promise<void>;
  clock?: () => Date;
}
export interface ManualOverrideService {
  apply(previous: MemeRecord | null, request: OverrideRequest, auth: CallerAuthContext): Promise<MemeRecord>;
}

function validateMeme(meme: MemeRecord): void {
  for (const field of ['canonical_name', 'canonical_ticker', 'source_url'] as const) {
    if (typeof meme[field] !== 'string' || !meme[field].trim()) throw new SourceError('OVERRIDE', `${field} must be explicitly supplied and nonempty.`);
  }
  if (!['artifact', 'concept'].includes(meme.scope) || !SOURCE_HIERARCHY.includes(meme.source_tier)) throw new SourceError('OVERRIDE', 'Valid source_tier and scope are required.');
  publicUrl(meme.source_url);
  if (meme.source_image_url !== null) publicUrl(meme.source_image_url);
  if (meme.source_image_hash !== null && !/^[a-f\d]{16}$/i.test(meme.source_image_hash)) throw new SourceError('OVERRIDE', 'source_image_hash must be null or a 64-bit hexadecimal hash.');
  if (meme.source_image_hash && !meme.source_image_url) throw new SourceError('OVERRIDE', 'A source image hash requires its evidence URL.');
  for (const field of ['subject_handle', 'home_chain', 'implied_pair', 'beneficiary_wallet', 'source_launchpad'] as const) {
    if (meme[field] !== null && (typeof meme[field] !== 'string' || !meme[field]!.trim())) throw new SourceError('OVERRIDE', `${field} must be a nonempty string or null.`);
  }
  if (meme.beneficiary_wallet !== null && !isSolanaAddress(meme.beneficiary_wallet)) throw new SourceError('OVERRIDE', 'beneficiary_wallet must be a Solana public key.');
  if (meme.beneficiary_tie_at !== null && !timestamp(meme.beneficiary_tie_at)) throw new SourceError('OVERRIDE', 'beneficiary_tie_at must be a UTC ISO timestamp or null.');
  if (!Array.isArray(meme.evidence) || !meme.evidence.length) throw new SourceError('OVERRIDE', 'Manual resolution requires cited evidence URLs.');
  meme.evidence.forEach(publicUrl);
  if (meme.resolved !== undefined && typeof meme.resolved !== 'boolean') throw new SourceError('OVERRIDE', 'resolved must be boolean.');
  if (meme.press_candidates !== undefined) {
    if (!Array.isArray(meme.press_candidates)) throw new SourceError('OVERRIDE', 'press_candidates must be an array.');
    for (const candidate of meme.press_candidates) {
      if (!candidate || typeof candidate.value !== 'string' || !candidate.value.trim() || !Array.isArray(candidate.articles)) throw new SourceError('OVERRIDE', 'Invalid press candidate.');
      candidate.articles.forEach(publicUrl);
    }
  }
}

export function createManualOverrideService(options: ManualOverrideServiceOptions): ManualOverrideService {
  if (!options.adminActor?.trim() || typeof options.persist !== 'function') throw new SourceError('CONFIG', 'Manual overrides require one configured adminActor and an atomic persistence callback.');
  const adminActor = options.adminActor;
  return {
    async apply(previous, request, auth) {
      if (!auth || auth.authenticated !== true || auth.actor !== adminActor) throw new SourceError('FORBIDDEN', 'Manual source overrides require the configured admin’s authenticated session.');
      if (!request || typeof request.reason !== 'string' || !request.reason.trim()) throw new SourceError('OVERRIDE', 'Every override requires a nonempty reason.');
      if (!request.patch || typeof request.patch !== 'object' || Array.isArray(request.patch)) throw new SourceError('OVERRIDE', 'Override patch must be an object.');
      const at = (options.clock ?? (() => new Date()))().toISOString();
      const patch = structuredClone(request.patch);
      for (const key of Object.keys(patch)) {
        if (!(editableFields as readonly string[]).includes(key) || patch[key as keyof ManualOverridePatch] === undefined) throw new SourceError('OVERRIDE', `Field ${key} cannot be overridden or set to undefined.`);
      }
      // A changed image cannot retain the previous image's hash accidentally.
      if ('source_image_url' in patch && patch.source_image_url !== previous?.source_image_url && !('source_image_hash' in patch)) patch.source_image_hash = null;
      const id = previous?.id ?? `manual_${randomUUID()}`;
      const current = {
        id, slug: previous?.slug ?? id, source_image_hash: null, source_image_url: null,
        subject_handle: null, home_chain: null, implied_pair: null, beneficiary_wallet: null,
        beneficiary_tie_at: null, source_launchpad: null, created_by: auth.actor,
        evidence: [], overrides: [], resolved: false,
        ...(previous ? structuredClone(previous) : {}), ...patch,
      } as MemeRecord;
      validateMeme(current);
      const entries: OverrideEntry[] = [];
      for (const field of Object.keys(patch) as (keyof ManualOverridePatch)[]) {
        const before = previous?.[field] ?? null;
        const value = current[field] ?? null;
        if (canonicalJson(before) !== canonicalJson(value)) entries.push({ field, previous: structuredClone(before), value: structuredClone(value), actor: auth.actor, at, reason: request.reason.trim() });
      }
      current.overrides = [...current.overrides, ...entries];
      if (!previous || entries.length) await options.persist(structuredClone({ previous, current, entries }));
      return current;
    },
  };
}

export function createManualOverrideServiceFromEnv(
  persist: ManualOverrideServiceOptions['persist'], env: NodeJS.ProcessEnv = process.env,
  clock?: () => Date,
): ManualOverrideService {
  return createManualOverrideService({ adminActor: env.SOURCE_ADMIN_ACTOR ?? '', persist, clock });
}
