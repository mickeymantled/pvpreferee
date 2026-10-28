import "server-only";
import type { MemeRecord } from "@pvp/shared";
import type { CallerAuthContext, OverrideRequest } from "@pvp/source";
import { OVERRIDE_MESSAGE } from "../lib/workflow";
import { withRepository } from "./services";

/** HARDEN seam: replace the body with a server-validated session + fixed admin check.
 * Never accept actor/authenticated from FormData, JSON, query parameters or headers.
 */
export async function requireAdminForOverride(): Promise<CallerAuthContext> {
  throw new Error(OVERRIDE_MESSAGE);
}

/** Not a public server action. Wave3 must add authenticated, CSRF-protected UI wiring.
 * `previous` must be freshly loaded by the server, never deserialized from a client.
 */
export async function applyReviewedOverride(
  previous: MemeRecord | null,
  request: OverrideRequest,
): Promise<MemeRecord> {
  const auth = await requireAdminForOverride();
  const { createManualOverrideServiceFromEnv } = await import("@pvp/source");
  return withRepository((repository) =>
    createManualOverrideServiceFromEnv((commit) =>
      repository.applyMemeOverride(commit.previous, commit.current),
    ).apply(previous, request, auth),
  );
}
