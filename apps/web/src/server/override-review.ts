import { createHash } from 'node:crypto';
import { canonicalJson, type MemeRecord } from '@pvp/shared';
import { createManualOverrideServiceFromEnv, type CallerAuthContext, type OverrideRequest } from '@pvp/source';
import type { ComparisonInput } from '../lib/input';
import { AccessError } from './auth-core';

export function overrideFingerprint(input: ComparisonInput, previous: MemeRecord | null): string {
  return createHash('sha256').update(canonicalJson({ input, previous })).digest('hex');
}
export interface OverrideDependencies {
  load(): Promise<MemeRecord | null>;
  persist(previous: MemeRecord | null, current: MemeRecord): Promise<void>;
}
/** Auth is server-constructed. Baseline is always freshly loaded, never client JSON. */
export async function commitReviewedOverride(input: ComparisonInput, fingerprint: string, request: OverrideRequest, auth: CallerAuthContext, deps: OverrideDependencies, env: NodeJS.ProcessEnv = process.env) {
  if (!auth?.authenticated || !env.SOURCE_ADMIN_ACTOR || auth.actor !== env.SOURCE_ADMIN_ACTOR) throw new AccessError('Administrator sign-in is required.');
  const previous = await deps.load();
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== overrideFingerprint(input, previous)) throw new AccessError('Source facts changed since review. Reload the source before saving.');
  // The reviewed URL is immutable in this UI. All other fields are validated by @pvp/source.
  const patch = { ...request.patch, source_url: input.source_url };
  // For this URL-based UI, deterministic creation identity lets the repository's
  // unique ID/slug constraint reject parallel null-baseline creates atomically.
  // The service still validates every field and generates the full audit. No
  // existing identity or creator is changed, and no extra domain table is used.
  const creationId = 'manual_' + createHash('sha256').update(input.source_url).digest('hex');
  const identify = (current: MemeRecord): MemeRecord => previous ? current : { ...current, id: creationId, slug: creationId };
  const current = await createManualOverrideServiceFromEnv(commit => deps.persist(commit.previous, identify(commit.current)), env).apply(previous, { ...request, patch }, auth);
  return identify(current);
}
