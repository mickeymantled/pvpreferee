import "server-only";
import { loadRulebook } from '@pvp/config';
import type { CallerAuthContext, OverrideRequest } from "@pvp/source";
import type { IngestRulingRepository } from '@pvp/ingest';
import type { ComparisonInput } from '../lib/input';
import { withRepository } from "./services";
import { requireAdmin } from './security';
import { commitReviewedOverride, overrideFingerprint } from './override-review';

/** Server-validated session + fixed admin check.
 * Never accept actor/authenticated from FormData, JSON, query parameters or headers.
 */
export async function requireAdminForOverride(): Promise<CallerAuthContext> {
  return requireAdmin();
}

/** Called only by the authenticated, origin-checked server action. */
export async function applyReviewedOverride(
  input: ComparisonInput,
  fingerprint: string,
  request: OverrideRequest,
) {
  const auth = await requireAdminForOverride();
  return withRepository((repository) =>
    commitReviewedOverride(input, fingerprint, request, auth, {
      load: () => loadPrevious(input, repository),
      persist: (previous, current) => repository.applyMemeOverride(previous, current),
    }),
  );
}

async function loadPrevious(input: ComparisonInput, repository: IngestRulingRepository) {
  const stored = await repository.findMemeBySourceUrl(input.source_url);
  if (stored) return stored;
  const { createSourceFromEnv } = await import('@pvp/source');
  const resolution = await createSourceFromEnv().resolve(input.source_url, loadRulebook(input.version).config);
  return resolution.meme;
}
export async function loadOverrideReview(input: ComparisonInput) {
  await requireAdminForOverride();
  return withRepository(async repository => {
    const previous = await loadPrevious(input, repository);
    return { previous, fingerprint: overrideFingerprint(input, previous) };
  });
}
