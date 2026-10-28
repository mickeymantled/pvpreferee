import React from "react";
import type { Metadata } from "next";
import { loadRulebook } from "@pvp/config";
import { InvalidInputError } from "@pvp/pipeline";
import { parseComparison, queryForm } from "../../lib/input";
import { reviewComparison, type Review } from "../../lib/workflow";
import { webServices } from "../../server/services";
import { ReviewForm } from "../../components/forms";
import { SourceAssumptions, SourceAudit } from "../../components/source-audit";
import { ServiceNotice } from "../../components/service-notice";
import { EvidenceLink } from "../../components/evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Review the source",
  robots: { index: false, follow: false },
};
export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let review: Review;
  try {
    review = await reviewComparison(
      parseComparison(queryForm(await searchParams)),
      webServices,
    );
  } catch (error) {
    return (
      <ServiceNotice
        title={
          error instanceof InvalidInputError
            ? "Check the comparison."
            : "Source review is unavailable."
        }
        message={
          error instanceof InvalidInputError
            ? error.message
            : "We could not load the source and any saved reviews. Check source-provider and database access, then retry. No coin data has been fetched."
        }
      />
    );
  }
  const { meme, reasons } = review.resolution;
  return (
    <div className="page-stack">
      <header className="page-heading">
        <p className="eyebrow">02 / Confirm the source</p>
        <h1>
          Agree on the meme.
          <br />
          <span>Then compare the coins.</span>
        </h1>
        <p className="lede">
          The ruling depends on the original source’s exact name, ticker, scope,
          and chain context.
        </p>
        <p className="muted">
          Comparing {review.input.cas.length} contracts · Rulebook{" "}
          {review.input.version}
        </p>
      </header>
      {meme ? (
        <SourceAssumptions
          meme={meme}
          defaultPair={
            loadRulebook(review.input.version).config.pair.default_asset
          }
        />
      ) : (
        <div className="assumptions">
          <p className="eyebrow">Assumptions not yet established</p>
          <p>
            Source: <EvidenceLink value={review.input.source_url} /> · Tier:
            unknown · Scope: unknown · Pair: unknown · Home chain: unknown
          </p>
        </div>
      )}
      <section
        className={"notice " + (review.ready ? "confirmed" : "")}
        aria-labelledby="review-status"
      >
        <h2 id="review-status">
          {review.ready ? "Source ready for comparison" : "Source needs review"}
        </h2>
        <p>
          {review.ready
            ? "The resolver or an existing audited review supplied a confirmed meme record. Check the assumptions before continuing."
            : "We cannot establish a reliable shared identity yet. Different names may describe different memes; that ambiguity needs review before comparing."}
        </p>
        {!!reasons.length && (
          <ul>
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        )}
      </section>
      <ReviewForm review={review} />
      <details className="panel raw-data">
        <summary>Contracts in this comparison</summary>
        <ol>
          {review.input.cas.map((ca) => (
            <li key={ca}>
              <code>{ca}</code>
            </li>
          ))}
        </ol>
      </details>
      {meme && <SourceAudit meme={meme} />}
    </div>
  );
}
