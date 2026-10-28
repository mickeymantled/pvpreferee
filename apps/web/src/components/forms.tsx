"use client";

import React, { useActionState, useState } from "react";
import type { MemeRecord } from "@pvp/shared";
import { beginReview, issueRuling } from "../app/actions";
import type { ActionState, Review } from "../lib/workflow";
import { CaInputs } from "./ca-inputs";

const INITIAL: ActionState = { status: "idle" };
function FormNotice({ state }: { state: ActionState }) {
  return state.status === "idle" ? null : (
    <div className="notice" role="alert">
      <p>{state.message}</p>
      {state.review_url && (
        <a href={state.review_url}>Review current source →</a>
      )}
    </div>
  );
}

export function ComparisonForm({ versions = ['v1'] }: { versions?: string[] }) {
  const [state, action, pending] = useActionState(beginReview, INITIAL);
  const [version, setVersion] = useState(versions[0] ?? 'v1');
  return (
    <form action={action} className="comparison-form" aria-busy={pending}>
      <CaInputs disabled={pending} />
      <p id="origin-help" className="field-help">
        PvP Referee looks up token-linked sources to find the meme origin. If the
        origin cannot be verified, we stop and explain what is missing.
      </p>
      <div className="version-control">
        <label htmlFor="comparison-version">Rulebook</label>
        <select id="comparison-version" name="version" value={version} onChange={event => setVersion(event.target.value)}>{versions.map(item => <option key={item}>{item}</option>)}</select>
        <a className="text-link" href={'/rulebook/' + version}>View rules</a>
      </div>
      <FormNotice state={state} />
      <button type="submit" disabled={pending} className="button primary" aria-describedby="origin-help">
        {pending ? "Finding the meme origin…" : "Find the meme origin"}{" "}
        <span aria-hidden="true">→</span>
      </button>
      <p className="form-footnote">
        Missing evidence stays unknown. No single score.
      </p>
    </form>
  );
}

export function SourceFields({ meme, editable = false }: { meme: MemeRecord | null; editable?: boolean }) {
  const prefix = editable ? 'edit-' : '';
  const fields: [keyof MemeRecord, string][] = [
    ["canonical_name", "Canonical name"],
    ["canonical_ticker", "Canonical ticker"],
    ["subject_handle", "Subject handle"],
    ["implied_pair", "Implied pair"],
    ["home_chain", "Home chain"],
    ["source_launchpad", "Source launchpad"],
    ["beneficiary_wallet", "Beneficiary wallet"],
    ["beneficiary_tie_at", "Beneficiary tie timestamp"],
    ["source_image_url", "Source image URL"],
    ["source_image_hash", "Source image hash (64-bit hex)"],
  ];
  return (
    <fieldset className="source-fields" disabled={!editable} aria-describedby={editable ? undefined : 'override-lock'}>
      <legend>Canonical fields</legend>
      <div className="field-grid">
        {fields.map(([field, label]) => (
          <div key={field}>
            <label htmlFor={prefix + field}>{label}</label>
            <input
              id={prefix + field}
              name={field}
              maxLength={field === 'source_image_url' ? 2048 : 256}
              defaultValue={
                typeof meme?.[field] === "string" ? (meme[field] as string) : ""
              }
              placeholder="Unknown"
            />
          </div>
        ))}
        <div>
          <label htmlFor={prefix + 'scope'}>Meme scope</label>
          <select id={prefix + 'scope'} name="scope" defaultValue={meme?.scope ?? ""}>
            <option value="">Unknown</option>
            <option value="artifact">Specific artifact</option>
            <option value="concept">General concept</option>
          </select>
        </div>
        <div>
          <label htmlFor={prefix + 'source_tier'}>Source tier</label>
          <select
            id={prefix + 'source_tier'}
            name="source_tier"
            defaultValue={meme?.source_tier ?? ""}
          >
            <option value="">Unknown</option>
            <option value="subject_post">Subject’s own post</option>
            <option value="official_asset">Official asset</option>
            <option value="site_text">Trailer or site text</option>
            <option value="wiki">Wiki / KYM</option>
          </select>
        </div>
      </div>
    </fieldset>
  );
}

export function ReviewForm({ review }: { review: Review }) {
  const [state, action, pending] = useActionState(issueRuling, INITIAL);
  return (
    <form action={action} className="content-section review-form" aria-busy={pending}>
      <SourceFields meme={review.resolution.meme} />
      <p className="notice subtle" id="override-lock">
        Source edits are locked for public comparisons. These fields show the inferred facts or an existing audited review. <a href="/admin/login">Administrator sign-in</a>
      </p>
      <input type="hidden" name="cas" value={review.input.cas.join("\n")} />
      <input type="hidden" name="source_url" value={review.input.source_url} />
      <input type="hidden" name="version" value={review.input.version} />
      <input type="hidden" name="review_hash" value={review.fingerprint} />
      <FormNotice state={state} />
      <div className="action-row">
        <button
          className="button primary"
          type="submit"
          disabled={!review.ready || pending}
        >
          {pending ? "Gathering frozen evidence…" : "Issue ruling"}{" "}
          <span aria-hidden="true">→</span>
        </button>
        <a className="button secondary" href="/">
          Change comparison
        </a>
      </div>
      <p className="field-help" role="status">
        {pending
          ? "Rechecking the source, reconstructing rival-time snapshots, and saving the ruling. This may take longer on a cold cache."
          : review.ready
            ? "The server rechecks these source facts before fetching coin data. Each submission saves a new immutable ruling."
            : "A confirmed source is required. No winner will be guessed."}
      </p>
    </form>
  );
}
