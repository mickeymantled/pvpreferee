import React from "react";
import type { MemeRecord } from "@pvp/shared";
import { displayValue, utcTime } from "../lib/evidence";
import { EvidenceLink, EvidenceList } from "./evidence";

export function SourceAssumptions({
  meme,
  defaultPair,
}: {
  meme: MemeRecord;
  defaultPair: string;
}) {
  return (
    <div className="assumptions">
      <h2>Comparison assumptions</h2>
      <p className="assumption-source">
        Source: <EvidenceLink value={meme.source_url} />
      </p>
      <dl className="assumption-fields">
        <div><dt>Source tier</dt><dd>{meme.source_tier.replaceAll("_", " ")}</dd></div>
        <div><dt>Scope</dt><dd>{meme.scope}</dd></div>
        <div><dt>Pair</dt><dd>{meme.implied_pair ?? `${defaultPair} (rulebook default)`}</dd></div>
        <div><dt>Home chain</dt><dd>{meme.home_chain ?? "Not specified — chain not scored"}</dd></div>
      </dl>
    </div>
  );
}

export function SourceAudit({ meme }: { meme: MemeRecord }) {
  return (
    <section className="content-section" id="source-audit" aria-labelledby="source-title">
      <h2 id="source-title">Source &amp; review history</h2>
      <dl className="facts-list">
        <div>
          <dt>Canonical name</dt>
          <dd>{meme.canonical_name}</dd>
        </div>
        <div>
          <dt>Canonical ticker</dt>
          <dd>{meme.canonical_ticker}</dd>
        </div>
        <div>
          <dt>Subject handle</dt>
          <dd>{displayValue(meme.subject_handle)}</dd>
        </div>
        <div>
          <dt>Source image</dt>
          <dd>
            {meme.source_image_url ? (
              <EvidenceLink value={meme.source_image_url} />
            ) : (
              "Unknown"
            )}
          </dd>
        </div>
        <div>
          <dt>Source image hash</dt>
          <dd>
            <code>{displayValue(meme.source_image_hash)}</code>
          </dd>
        </div>
        <div>
          <dt>Source launchpad</dt>
          <dd>{displayValue(meme.source_launchpad)}</dd>
        </div>
        <div>
          <dt>Beneficiary wallet</dt>
          <dd>
            <code>{displayValue(meme.beneficiary_wallet)}</code>
          </dd>
        </div>
        <div>
          <dt>Public beneficiary tie</dt>
          <dd>{utcTime(meme.beneficiary_tie_at)}</dd>
        </div>
        <div>
          <dt>Record created by</dt>
          <dd>{meme.created_by}</dd>
        </div>
      </dl>
      <h3>Source citations</h3>
      <EvidenceList values={[meme.source_url, ...meme.evidence]} />
      {!!meme.press_candidates?.length && (
        <>
          <h3>Canonical-name press evidence</h3>
          {meme.press_candidates.map((candidate) => (
            <div key={candidate.value}>
              <h4>
                {candidate.value} · {new Set(candidate.articles).size} cited
                articles
              </h4>
              <EvidenceList values={candidate.articles} />
            </div>
          ))}
        </>
      )}
      <h3>Manual source audit</h3>
      {meme.overrides.length ? (
        <ol className="audit-list">
          {meme.overrides.map((entry, index) => (
            <li key={index}>
              <p>
                <strong>{entry.field}</strong>: {displayValue(entry.previous)} →{" "}
                {displayValue(entry.value)}
              </p>
              <p>{entry.reason}</p>
              <p className="muted">
                {entry.actor} · {utcTime(entry.at)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No manual source overrides were recorded.</p>
      )}
    </section>
  );
}
