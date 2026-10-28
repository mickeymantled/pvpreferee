import React from "react";
import type { Rulebook } from "@pvp/shared";
import { displayValue } from "../lib/evidence";

export function ConfigView({
  config,
  hash,
  frozen = false,
}: {
  config: Rulebook;
  hash: string;
  frozen?: boolean;
}) {
  const thresholds: [string, unknown][] = [
    ["Minimum distinct buyers", config.participation.min_distinct_buyers],
    [
      "First-buy window (seconds)",
      config.participation.first_buy_window_seconds,
    ],
    [
      "Minimum cap above launch (USD)",
      config.participation.min_cap_above_launch_usd,
    ],
    ["PvP grace period (seconds)", config.participation.pvp_grace_seconds],
    [
      "Post-rival window (seconds)",
      config.participation.post_rival_window_seconds,
    ],
    ["Image hash size (bits)", config.identity.hash_bits],
    ["Maximum image hash distance", config.identity.max_image_hamming_distance],
    ["Exact source spelling required", config.identity.exact_spelling],
    ["Source hierarchy", config.identity.source_hierarchy.join(" → ")],
    ["Press-count publishers", config.identity.press_sources],
    [
      "Endorsement selection",
      config.endorsement.selection.replaceAll("_", " "),
    ],
    [
      "Fixed minimum subject supply",
      config.endorsement.fixed_minimum_supply_pct === null
        ? "None — compare subject-held supply"
        : config.endorsement.fixed_minimum_supply_pct,
    ],
    ["Default pair", config.pair.default_asset],
    ...Object.entries(config.pair.meme_pairs).map(
      ([meme, pair]): [string, unknown] => [`Pair for ${meme}`, pair],
    ),
    [
      "Beneficiary tie must predate rival",
      config.beneficiary.require_pre_rival_tie,
    ],
    ["Beneficiary must be able to claim", config.beneficiary.require_claimable],
  ];
  return (
    <section className="panel" aria-labelledby="config-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Published parameters</p>
          <h2 id="config-title">
            {frozen ? "Frozen rulebook" : "Rulebook"}{" "}
            <span className="tag">{config.version}</span>
          </h2>
        </div>
      </div>
      <p className="muted">
        {frozen
          ? "These are the exact rules and thresholds stored with this ruling."
          : "Checks run in this order. An earlier elimination cannot be rescued by a later rule."}
      </p>
      <ol className="rule-list">
        {config.rules.map((rule) => (
          <li key={rule.id}>
            <span className="rule-number">
              {String(rule.id).padStart(2, "0")}
            </span>
            <div>
              <h3>{rule.name}</h3>
              <p>{rule.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3>Thresholds &amp; precedence</h3>
      <dl className="facts-list">
        {thresholds.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="hash-block">
        <span>Config SHA-256</span>
        <code>{hash}</code>
      </div>
      <details className="raw-data">
        <summary>View exact configuration JSON</summary>
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </details>
    </section>
  );
}
