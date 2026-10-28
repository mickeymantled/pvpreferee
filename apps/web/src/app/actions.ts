"use server";

import { redirect } from "next/navigation";
import { InvalidInputError } from "@pvp/pipeline";
import { parseComparison, reviewUrl } from "../lib/input";
import { submitComparison, type ActionState } from "../lib/workflow";
import { webServices } from "../server/services";
import { protectRequest } from '../server/security';
import { AccessError } from '../server/auth-core';
import { RateLimitError } from '../server/rate-limit';

export async function beginReview(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let url: string;
  try {
    await protectRequest('comparison', true);
    url = reviewUrl(parseComparison(form));
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof InvalidInputError || error instanceof AccessError || error instanceof RateLimitError
          ? error.message
          : "Check the contract addresses and source URL.",
    };
  }
  redirect(url);
}

export async function issueRuling(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try { await protectRequest('comparison', true); }
  catch (error) { return { status: 'error', message: error instanceof AccessError || error instanceof RateLimitError ? error.message : 'Request protection is unavailable.' }; }
  const result = await submitComparison(form, webServices);
  // Keep Next's redirect exception outside service error handling.
  if (result.status === "success")
    redirect("/ruling/" + encodeURIComponent(result.slug));
  return result;
}
