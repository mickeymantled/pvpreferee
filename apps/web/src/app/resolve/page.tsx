import React from "react";
import type { Metadata } from "next";
import { loadRulebook } from "@pvp/config";
import { InvalidInputError } from "@pvp/pipeline";
import { parseComparison, queryForm, reviewUrl } from "../../lib/input";
import { reviewComparison, type Review } from "../../lib/workflow";
import { webServices } from "../../server/services";
import { ReviewForm } from "../../components/forms";
import { SourceAssumptions, SourceAudit } from "../../components/source-audit";
import { ServiceNotice } from "../../components/service-notice";
import { EvidenceLink } from "../../components/evidence";
import { currentAdmin, protectRequest } from '../../server/security';
import { RateLimitError } from '../../server/rate-limit';
import { loadOverrideReview } from '../../server/overrides';
import { OverrideForm } from '../../components/admin-forms';
import { CaseSteps } from '../../components/case-steps';
import { OriginRecovery, OriginResearch } from '../../components/origin-research';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Meme origin",
  robots: { index: false, follow: false },
};
export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let review: Review;
  try {
    await protectRequest('source');
    review = await reviewComparison(
      parseComparison(queryForm(await searchParams)),
      webServices,
    );
  } catch (error) {
    return (
      <ServiceNotice
        title={
          error instanceof InvalidInputError || error instanceof RateLimitError
            ? "Check the comparison."
            : "Origin lookup is unavailable."
        }
        message={
          error instanceof InvalidInputError || error instanceof RateLimitError
            ? error.message
            : "We could not complete source research and load any saved reviews. Check source-provider and database access, then retry. No ruling was issued."
        }
      />
    );
  }
  const { meme, reasons } = review.resolution;
  const automatic = !review.input.source_url;
  let adminReview: Awaited<ReturnType<typeof loadOverrideReview>> | null = null;
  let adminReviewError = false;
  if (!automatic && await currentAdmin()) {
    try { adminReview = await loadOverrideReview(review.input); }
    catch { adminReviewError = true; }
  }
  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1>{automatic ? "Meme origin." : "Review the source."}</h1>
        <p className="lede">
          {automatic
            ? "We look up the contracts’ published links and check the source behind the meme. Token claims alone are not evidence of its origin."
            : "The ruling depends on the original source’s exact name, ticker, scope, and chain context."}
        </p>
        <p className="metadata">
          Comparing {review.input.cas.length} contracts · Rulebook{" "}
          {review.input.version}
        </p>
      </header>
      <CaseSteps current="Source" />
      {meme ? (
        <SourceAssumptions
          meme={meme}
          defaultPair={
            loadRulebook(review.input.version).config.pair.default_asset
          }
        />
      ) : (
        <div className="assumptions">
          <h2>Assumptions not yet established</h2>
          <p>
            {automatic ? "No verified shared origin yet" : <>Source: <EvidenceLink value={review.input.source_url} /></>} · Tier:
            unknown · Scope: unknown · Pair: unknown · Home chain: unknown
          </p>
        </div>
      )}
      <section
        className={"notice " + (review.ready ? "confirmed" : "")}
        aria-labelledby="review-status"
      >
        <h2 id="review-status">
          {review.ready ? "Source ready for comparison" : automatic ? "Origin not confirmed" : "Source needs review"}
        </h2>
        <p>
          {review.ready
            ? "The resolver or an existing audited review supplied a confirmed meme record. Check the assumptions before continuing."
            : automatic
              ? "Automatic research could not verify one shared origin. You do not need to supply a source to start a comparison, but we will not guess a winner from incomplete or conflicting evidence."
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
      {review.resolution.discovery && <OriginResearch input={review.input} discovery={review.resolution.discovery} />}
      {(meme || !automatic) && <ReviewForm review={review} />}
      {!review.ready && <OriginRecovery input={review.input} />}
      {automatic && meme && <p className="metadata"><a href={reviewUrl({ ...review.input, source_url: meme.source_url })}>Inspect or administer the discovered source →</a></p>}
      {adminReview && <OverrideForm input={review.input} previous={adminReview.previous} fingerprint={adminReview.fingerprint} />}
      {adminReviewError && <p role="alert">Administrator review could not load its current record. Check database access and reload.</p>}
      <details className="content-section raw-data">
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
