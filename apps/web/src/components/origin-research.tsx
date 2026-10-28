import React from "react";
import type { ComparisonInput } from "../lib/input";
import { reviewUrl } from "../lib/input";
import type { WebResolution } from "../lib/workflow";
import { EvidenceLink } from "./evidence";

export function OriginResearch({ input, discovery }: {
  input: ComparisonInput;
  discovery: NonNullable<WebResolution["discovery"]>;
}) {
  return (
    <details className="content-section raw-data origin-research">
      <summary>Research trail · {discovery.candidates.length} candidate source links</summary>
      <p className="muted">Token listings and their links are leads, not proof of the original meme. Only independently verified source facts can support a ruling.</p>
      {discovery.notes.length > 0 && <ul>{discovery.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {discovery.candidates.length === 0 ? <p>No usable source links were found for these contracts.</p> : (
        <ol>
          {discovery.candidates.map(candidate => (
            <li key={candidate.url} className="content-section">
              <EvidenceLink value={candidate.url} />
              <p className="metadata">
                {candidate.status === "confirmed" ? "Source facts verified — shared origin still subject to the checks above" : "Unverified origin lead"}
                {" · Linked from "}{candidate.coin_cas.length} of {input.cas.length} contracts
              </p>
              <details>
                <summary>Discovery evidence</summary>
                <ul>{candidate.discovered_via.map(url => <li key={url}><EvidenceLink value={url} /></li>)}</ul>
                <ul>{candidate.coin_cas.map(ca => <li key={ca}><code>{ca}</code></li>)}</ul>
              </details>
              {candidate.reasons.length > 0 && <ul>{candidate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
              <a href={reviewUrl({ ...input, source_url: candidate.url })}>Inspect this source →</a>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** Optional recovery only; the main comparison never requires the checker to research a URL. */
export function OriginRecovery({ input }: { input: ComparisonInput }) {
  return (
    <section className="content-section origin-recovery">
      <div className="action-row">
        <a className="button primary" href={reviewUrl({ ...input, source_url: "" })}>Retry automatic lookup</a>
        <a className="button secondary" href="/">Change contracts</a>
      </div>
      <details className="raw-data">
        <summary>Already have an original source link? (Optional)</summary>
        <p>This can help when a token has no usable links. A supplied URL is checked, never treated as proof by itself.</p>
        <form action="/resolve" method="get">
          <input type="hidden" name="cas" value={input.cas.join("\n")} />
          <input type="hidden" name="version" value={input.version} />
          <label htmlFor="source-hint">Original post or source page</label>
          <input id="source-hint" type="url" name="source_url" required maxLength={2048} autoCapitalize="none" spellCheck={false} />
          <button type="submit" className="button secondary">Check this source</button>
        </form>
      </details>
    </section>
  );
}
