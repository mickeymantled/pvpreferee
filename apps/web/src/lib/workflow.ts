import { createHash } from "node:crypto";
import {
  canonicalJson,
  type Endorsement,
  type MemeRecord,
  type Ruling,
  type SourceResolution,
} from "@pvp/shared";
import { InvalidInputError, NeedsResolutionError } from "@pvp/pipeline";
import type { OriginDiscoveryResult } from "@pvp/source";
import {
  parseComparison,
  reviewUrl,
  textField,
  type ComparisonInput,
  type FormValues,
} from "./input";

export const SERVICE_MESSAGE =
  "The ruling service is unavailable. We could not confirm a saved ruling. Check that the server has database and data-provider access, then try again.";
export const OVERRIDE_MESSAGE =
  "Source edits are locked until administrator sign-in is available. Only verified source facts or an existing audited review can be used.";
export interface WebServices {
  resolve(input: ComparisonInput): Promise<WebResolution>;
  run(
    input: ComparisonInput,
    meme: MemeRecord,
    endorsements: Endorsement[],
  ): Promise<Ruling>;
}
/** Research is presentation metadata, not a change to the frozen shared domain contract. */
export interface WebResolution extends SourceResolution {
  discovery?: Omit<OriginDiscoveryResult, "resolution">;
}
export interface ActionState {
  status: "idle" | "error" | "review";
  message?: string;
  review_url?: string;
}
export type Submission = ActionState | { status: "success"; slug: string };
export interface Review {
  input: ComparisonInput;
  resolution: WebResolution;
  fingerprint: string;
  ready: boolean;
}

export function reviewFingerprint(
  input: ComparisonInput,
  resolution: SourceResolution,
): string {
  return createHash("sha256")
    .update(canonicalJson({ input, resolution }))
    .digest("hex");
}

export async function reviewComparison(
  input: ComparisonInput,
  services: WebServices,
): Promise<Review> {
  const resolution = await services.resolve(input);
  return {
    input,
    resolution,
    fingerprint: reviewFingerprint(input, resolution),
    ready:
      !!resolution.meme &&
      !resolution.needs_review &&
      resolution.meme.resolved !== false,
  };
}

/** Only addresses, an optional source hint and a review digest cross the browser boundary. */
export async function submitComparison(
  form: FormValues,
  services: WebServices,
): Promise<Submission> {
  try {
    const allowed = new Set(["ca", "cas", "source_url", "version", "review_hash"]);
    if (
      [...form.keys()].some(
        (key) => !allowed.has(key) && !key.startsWith("$ACTION_"),
      )
    ) {
      return { status: "error", message: OVERRIDE_MESSAGE };
    }
    const input = parseComparison(form);
    const fingerprint = textField(form, "review_hash", 64);
    if (!/^[a-f0-9]{64}$/.test(fingerprint))
      return {
        status: "review",
        message: "Review the source before requesting a ruling.",
        review_url: reviewUrl(input),
      };
    // Never trust a client-supplied MemeRecord or endorsements, even if a digest is supplied.
    const review = await reviewComparison(input, services);
    if (!review.ready)
      return {
        status: "review",
        message:
          "This source needs administrator review before a ruling can be issued.",
        review_url: reviewUrl(input),
      };
    if (fingerprint !== review.fingerprint)
      return {
        status: "review",
        message:
          "The source facts changed since this page was opened. Review the updated assumptions first.",
        review_url: reviewUrl(input),
      };
    const ruling = await services.run(
      input,
      review.resolution.meme!,
      review.resolution.endorsements,
    );
    return { status: "success", slug: ruling.share_slug };
  } catch (error) {
    if (error instanceof NeedsResolutionError)
      return {
        status: "error",
        message:
          "The source could not be confirmed. Return to source review before trying again.",
      };
    return {
      status: "error",
      message:
        error instanceof InvalidInputError ? error.message : SERVICE_MESSAGE,
    };
  }
}
