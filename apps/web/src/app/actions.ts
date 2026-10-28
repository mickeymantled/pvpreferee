"use server";

import { redirect } from "next/navigation";
import { InvalidInputError } from "@pvp/pipeline";
import { parseComparison, reviewUrl } from "../lib/input";
import { submitComparison, type ActionState } from "../lib/workflow";
import { webServices } from "../server/services";

export async function beginReview(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let url: string;
  try {
    url = reviewUrl(parseComparison(form));
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof InvalidInputError
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
  const result = await submitComparison(form, webServices);
  // Keep Next's redirect exception outside service error handling.
  if (result.status === "success")
    redirect("/ruling/" + encodeURIComponent(result.slug));
  return result;
}
