"use client";

import React, { useActionState, useState } from "react";
import type { MemeRecord } from "@pvp/shared";
import { beginReview, issueRuling } from "../app/actions";
import type { ActionState, Review } from "../lib/workflow";

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
  const [cas, setCas] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [version, setVersion] = useState(versions[0] ?? 'v1');
  return (
    <form action={action} className="comparison-form" aria-busy={pending}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / Open a case</p>
          <h2>Which coin is the original?</h2>
        </div>
        <span className="tag">2–10 coins</span>
      </div>
      <label htmlFor="cas">Contract addresses</label>
      <textarea
        id="cas"
        name="cas"
        value={cas}
        onChange={event => setCas(event.target.value)}
        placeholder="Paste one Solana contract address per line"
        required
        rows={5}
        maxLength={1024}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-describedby="cas-help"
      />
      <p id="cas-help" className="field-help">
        Separate with a new line, space, or comma. Duplicate addresses count
        once.
      </p>
      <label htmlFor="source_url">Original meme source</label>
      <input
        id="source_url"
        name="source_url"
        value={sourceUrl}
        onChange={event => setSourceUrl(event.target.value)}
        type="url"
        required
        maxLength={2048}
        placeholder="https://x.com/… or the original source page"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby="source-help"
      />
      <p id="source-help" className="field-help">
        A subject post, official asset, video, or source page. You’ll review its
        assumptions next.
      </p>
      <label htmlFor="comparison-version">Rulebook version</label>
      <select id="comparison-version" name="version" value={version} onChange={event => setVersion(event.target.value)}>{versions.map(item => <option key={item}>{item}</option>)}</select>
      <FormNotice state={state} />
      <button type="submit" disabled={pending} className="button primary">
        {pending ? "Opening source review…" : "Review the source"}{" "}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="form-footnote">
        Published rules. Linked evidence. No single score.
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
    <fieldset disabled={!editable} aria-describedby={editable ? undefined : 'override-lock'}>
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
    <form action={action} className="panel review-form" aria-busy={pending}>
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
