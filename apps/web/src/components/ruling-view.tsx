import React from "react";
import type { DisplayFlags, Ruling, RulingStatus } from "@pvp/shared";
import { cardImageUrl } from "../lib/card-url";
import {
  displayValue,
  shortCa,
  snapshotAnchor,
  utcTime,
} from "../lib/evidence";
import { ConfigView } from "./config-view";
import { EvidenceList } from "./evidence";
import { SourceAssumptions, SourceAudit } from "./source-audit";
import { ShareButton } from "./share";
import { CardPreview } from "./card-preview";
import type { DerivedSnapshot } from '../server/rerun';

const STATUS_TEXT: Record<
  RulingStatus,
  { title: string; description: string }
> = {
  resolved: {
    title: "The ruling is in.",
    description: "A winner under the frozen facts and published rules below.",
  },
  unresolved: {
    title: "Evidence is incomplete.",
    description:
      "No confirmed winner. Missing or conflicting evidence prevents a reliable ruling. Read the checks below for what remains unknown.",
  },
  separate_memes: {
    title: "Different memes. Separate cases.",
    description:
      "These coins do not describe the same meme. A comparative winner would be misleading; compare coins within one confirmed scope.",
  },
  no_winner: {
    title: "No winner under these rules.",
    description:
      "The stored evaluation does not establish a winner. The checks below explain the eliminations or unresolved tie.",
  },
};
const FLAG_FIELDS: [keyof DisplayFlags, string][] = [
  ["top10_pct", "Top 10 holders (%)"],
  ["creator_launches_30d", "Creator launches / 30 days"],
  ["dev_sold", "Developer sold"],
  ["cto", "CTO"],
  ["dex_paid", "Dex paid"],
  ["verified_badges", "Third-party badges"],
  ["bundled", "Bundle warning"],
  ["warnings", "Other warnings"],
];

export function RulingView({ ruling }: { ruling: Ruling }) {
  const { config, meme, coins } = ruling.facts;
  const status = STATUS_TEXT[ruling.status];
  const winner =
    ruling.status === "resolved"
      ? coins.find((coin) => coin.ca === ruling.winner_ca)
      : undefined;
  const orderedCas = [...new Set([...ruling.ranked_cas, ...ruling.coin_cas])];
  const snapshots = [
    ...new Map(
      coins
        .flatMap((coin) => coin.snapshots)
        .map((snapshot) => [snapshot.id, snapshot]),
    ).values(),
  ];
  const allReferences = [
    ...meme.evidence,
    ...coins.flatMap((coin) => [
      ...coin.evidence,
      ...coin.snapshots.flatMap((s) => s.evidence),
    ]),
    ...ruling.grid.flatMap((row) =>
      Object.values(row.rules).flatMap((check) => check.evidence ?? []),
    ),
  ];
  const missingSnapshots = [
    ...new Set(
      allReferences
        .filter((ref) => ref.startsWith("snapshot:"))
        .map((ref) => ref.slice(9)),
    ),
  ].filter((id) => !snapshots.some((snapshot) => snapshot.id === id || ('reevaluation' in snapshot && (snapshot as DerivedSnapshot).reevaluation.original.id === id)));
  return (
    <div className="page-stack">
      <section className={"verdict panel " + (winner ? "winner-panel" : "")}>
        <div className="section-heading">
          <p className="eyebrow">Case / {shortCa(ruling.share_slug)}</p>
          <span className={"tag status-" + ruling.status}>
            {ruling.status.replaceAll("_", " ")}
          </span>
        </div>
        <h1>{status.title}</h1>
        <p className="lede">{status.description}</p>
        {winner && (
          <div className="winner">
            <span className="eyebrow">Winning contract</span>
            <h2>
              {winner.name} <span className="ticker">${winner.ticker}</span>
            </h2>
            <code>{winner.ca}</code>
          </div>
        )}
        <p className="muted">
          {utcTime(ruling.created_at)} · Rulebook {ruling.rules_version} ·{" "}
          {ruling.coin_cas.length} coins
        </p>
        <div className="action-row">
          <ShareButton slug={ruling.share_slug} />
          <a
            className="button secondary"
            href={cardImageUrl(ruling.share_slug)}
          >
            Open ruling image
          </a>
          <a className="text-link" href="/">
            Open another case →
          </a>
        </div>
        <p className="field-help">
          This permalink preserves the original facts and verdict. A new
          evaluation creates a new ruling.
        </p>
      </section>
      <SourceAssumptions meme={meme} defaultPair={config.pair.default_asset} />
      <section className="panel" aria-labelledby="rank-title">
        <p className="eyebrow">The comparison</p>
        <h2 id="rank-title">Ranked coins</h2>
        {ruling.status !== "resolved" && (
          <p className="muted">
            Stored order is shown for inspection; it does not declare a winner.
          </p>
        )}
        <ol className="ranking">
          {orderedCas.map((ca, index) => {
            const coin = coins.find((c) => c.ca === ca),
              row = ruling.grid.find((r) => r.coin === ca);
            return (
              <li key={ca}>
                <span className="rank-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="rank-identity">
                  <h3>
                    {coin?.name ?? "Unknown coin"}{" "}
                    <span className="ticker">
                      {coin?.ticker ? "$" + coin.ticker : "Unknown ticker"}
                    </span>
                  </h3>
                  <code>{ca}</code>
                  <p className="muted">
                    {coin?.chain ?? "Unknown chain"} ·{" "}
                    {coin?.pair_asset ?? "Unknown pair"} · First real
                    participation: {utcTime(coin?.first_real_buy_at ?? null)}
                  </p>
                </div>
                <div className="rank-result">
                  <span
                    className={
                      "tag " +
                      (winner?.ca === ca
                        ? "pass"
                        : row?.eliminated_by
                          ? "fail"
                          : "")
                    }
                  >
                    {winner?.ca === ca
                      ? "Winner"
                      : row?.eliminated_by
                        ? "Eliminated · rule " + row.eliminated_by
                        : "Not eliminated"}
                  </span>
                  {row?.eliminated_by && (
                    <p>
                      {row.rules[row.eliminated_by]?.reason ??
                        "No reason recorded."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="panel grid-panel" aria-labelledby="grid-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Every check, in order</p>
            <h2 id="grid-title">Pass / fail grid</h2>
          </div>
          <span className="muted">Pass · Fail · N/A</span>
        </div>
        <p className="muted">
          No single score. Open a cell for its reason and linked evidence. On
          small screens, scroll the table horizontally.
        </p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable rule results"
        >
          <table className="rule-grid">
            <caption className="sr-only">
              Every stored rule result for each compared coin
            </caption>
            <thead>
              <tr>
                <th scope="col">Coin</th>
                {config.rules.map((rule) => (
                  <th key={rule.id} scope="col">
                    <span className="eyebrow">
                      {String(rule.id).padStart(2, "0")}
                    </span>
                    {rule.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedCas.map((ca) => {
                const row = ruling.grid.find((r) => r.coin === ca),
                  coin = coins.find((c) => c.ca === ca);
                return (
                  <tr key={ca}>
                    <th scope="row">
                      {coin?.ticker ?? "Unknown"}
                      <small>
                        <code>{shortCa(ca)}</code>
                      </small>
                    </th>
                    {config.rules.map((rule) => {
                      const check = row?.rules[rule.id];
                      return (
                        <td key={rule.id}>
                          <details open={check?.result === "fail"}>
                            <summary>
                              <span
                                className={"result " + (check?.result ?? "na")}
                              >
                                {check
                                  ? check.result === "na"
                                    ? "N/A"
                                    : check.result.toUpperCase()
                                  : "Unknown"}
                              </span>
                            </summary>
                            <p>{check?.reason ?? "No reason recorded."}</p>
                            <EvidenceList values={check?.evidence ?? []} />
                          </details>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" aria-labelledby="flags-title">
        <p className="eyebrow">Context, not verdict</p>
        <h2 id="flags-title">Display-only flags</h2>
        <p className="muted">
          These flags never change the ruling. Unknown values are not treated as
          zero or false.
        </p>
        <div className="flag-grid">
          {orderedCas.map((ca) => (
            <div key={ca} className="flag-card">
              <h3>{coins.find((c) => c.ca === ca)?.ticker ?? shortCa(ca)}</h3>
              <code className="muted">{shortCa(ca)}</code>
              <dl className="facts-list">
                {FLAG_FIELDS.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {displayValue(
                        ruling.flags[ca]?.[key] ??
                          ruling.grid.find((row) => row.coin === ca)?.flags[
                            key
                          ],
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="snapshots-title">
        <p className="eyebrow">Frozen at the rival’s first real buy</p>
        <h2 id="snapshots-title">Participation evidence</h2>
        {!snapshots.length && (
          <p className="muted">
            No participation snapshots were recorded. No later market activity
            has been substituted.
          </p>
        )}
        <div className="snapshot-grid">
          {snapshots.map((snapshot) => (
            <article
              key={snapshot.id}
              id={snapshotAnchor(snapshot.id)}
              className="snapshot"
            >
              <h3>{shortCa(snapshot.coin_ca)}</h3>
              <p>
                <time>{utcTime(snapshot.at)}</time>{" "}
                <span className={"tag " + (snapshot.complete ? "pass" : "na")}>
                  {snapshot.complete ? "Complete" : "Incomplete"}
                </span>
              </p>
              <dl className="facts-list">
                <div>
                  <dt>Market cap (USD)</dt>
                  <dd>{displayValue(snapshot.mcap_usd)}</dd>
                </div>
                <div>
                  <dt>Holders</dt>
                  <dd>{displayValue(snapshot.holders)}</dd>
                </div>
                <div>
                  <dt>Distinct buyers, lifetime</dt>
                  <dd>{displayValue(snapshot.distinct_buyers_lifetime)}</dd>
                </div>
                <div>
                  <dt>Last trade</dt>
                  <dd>{utcTime(snapshot.last_trade_at)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{snapshot.source}</dd>
                </div>
                <div>
                  <dt>Snapshot ID</dt>
                  <dd>
                    <code>{snapshot.id}</code>
                  </dd>
                </div>
              </dl>
              <EvidenceList values={snapshot.evidence} />
              {'reevaluation' in snapshot && <div className="notice">
                <p>Historical re-evaluation, with no new observation. <a href={'/ruling/' + (snapshot as DerivedSnapshot).reevaluation.from_ruling}>View the original ruling</a>.</p>
                <p id={snapshotAnchor((snapshot as DerivedSnapshot).reevaluation.original.id)}>Original snapshot: <code>{(snapshot as DerivedSnapshot).reevaluation.original.id}</code> · Config: <code>{(snapshot as DerivedSnapshot).reevaluation.original.config_hash ?? 'Not stamped in original'}</code></p>
                <details><summary>Exact original snapshot envelope</summary><pre>{JSON.stringify((snapshot as DerivedSnapshot).reevaluation.original, null, 2)}</pre></details>
              </div>}
            </article>
          ))}
        </div>
        {missingSnapshots.map((id) => (
          <p key={id} id={snapshotAnchor(id)} className="notice">
            Snapshot {id} was referenced, but its payload is absent from the
            stored facts. This evidence cannot be inspected.
          </p>
        ))}
        {coins.map((coin) => (
          <details key={coin.ca} className="raw-data">
            <summary>
              Coin evidence &amp; endorsements · {coin.ticker} (
              {shortCa(coin.ca)})
            </summary>
            <EvidenceList values={coin.evidence} />
            {coin.endorsements.length ? (
              coin.endorsements.map((endorsement, index) => (
                <div className="endorsement" key={index}>
                  <p>
                    {endorsement.kind.replaceAll("_", " ")} ·{" "}
                    {utcTime(endorsement.at)}
                  </p>
                  <p>
                    Verified by: {displayValue(endorsement.verified_by)} ·
                    Subject-held supply:{" "}
                    {displayValue(endorsement.subject_held_supply_pct)}%
                  </p>
                  <p>
                    Subject wallet:{" "}
                    <code>{displayValue(endorsement.subject_wallet)}</code>
                  </p>
                  <EvidenceList
                    values={
                      endorsement.evidence_url ? [endorsement.evidence_url] : []
                    }
                  />
                  <p>
                    Transaction:{" "}
                    <code>{displayValue(endorsement.evidence_tx)}</code>
                  </p>
                </div>
              ))
            ) : (
              <p>No endorsements recorded.</p>
            )}
          </details>
        ))}
      </section>
      <SourceAudit meme={meme} />
      <ConfigView config={config} hash={ruling.config_hash} frozen />
      <section className="panel">
        <p className="eyebrow">Reproducible record</p>
        <h2>Frozen facts</h2>
        <div className="hash-block">
          <span>Facts SHA-256</span>
          <code>{ruling.facts_hash}</code>
        </div>
        <details className="raw-data">
          <summary>Inspect the exact saved facts</summary>
          <pre>{JSON.stringify(ruling.facts, null, 2)}</pre>
        </details>
      </section>
      <CardPreview slug={ruling.share_slug} />
    </div>
  );
}
