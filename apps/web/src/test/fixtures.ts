import { loadRulebook } from "@pvp/config";
import type {
  CoinFacts,
  MemeRecord,
  RuleCheck,
  RuleId,
  Ruling,
  SourceResolution,
} from "@pvp/shared";
import type { ComparisonInput } from "../lib/input";

/** Entirely synthetic records. Public keys are syntax-only test inputs, not live token evidence. */
export const CAS = [
  "11111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
];
export const INPUT: ComparisonInput = {
  cas: CAS,
  source_url: "https://source.example/meme",
  version: "v1",
};
export const MEME: MemeRecord = {
  id: "synthetic-meme",
  slug: "synthetic",
  scope: "artifact",
  canonical_name: "Synthetic Cat",
  canonical_ticker: "SCAT",
  source_url: INPUT.source_url,
  source_tier: "subject_post",
  source_image_hash: null,
  source_image_url: null,
  subject_handle: "synthetic_subject",
  home_chain: null,
  implied_pair: "SOL",
  beneficiary_wallet: null,
  beneficiary_tie_at: null,
  created_by: "synthetic-fixture",
  source_launchpad: null,
  overrides: [],
  evidence: ["https://source.example/proof"],
  resolved: true,
};
export function resolution(): SourceResolution {
  return {
    meme: structuredClone(MEME),
    endorsements: [
      {
        coin_ca: CAS[0]!,
        kind: "ca_post",
        evidence_url: INPUT.source_url,
        evidence_tx: null,
        at: "2026-10-01T00:00:00Z",
        verified_by: "synthetic-verifier",
        subject_wallet: null,
        subject_held_supply_pct: null,
      },
    ],
    needs_review: false,
    reasons: [],
  };
}
function coin(ca: string): CoinFacts {
  return {
    ca,
    meme_id: MEME.id,
    chain: "solana",
    launchpad: "synthetic-pad",
    pair_asset: "SOL",
    name: MEME.canonical_name,
    ticker: MEME.canonical_ticker,
    image_hash: null,
    image_url: null,
    creator_wallet: null,
    fee_wallet: null,
    deployed_at: null,
    first_real_buy_at: "2026-10-01T01:00:00Z",
    bonded_at: null,
    mint_authority: null,
    freeze_authority: null,
    launch_mcap_usd: null,
    beneficiary_claimable: null,
    fee_tie_at: null,
    subject_held_supply_pct: null,
    endorsements: [],
    snapshots: [],
    flags: {},
    evidence: [],
    observed_at: "2026-10-01T02:00:00Z",
  };
}
export function ruling(): Ruling {
  const { config, hash } = loadRulebook();
  const coins = CAS.map(coin);
  coins[0]!.snapshots = [
    {
      id: "synthetic:one/a b",
      coin_ca: CAS[0]!,
      at: "2026-10-01T01:00:00Z",
      mcap_usd: null,
      holders: null,
      distinct_buyers_lifetime: null,
      last_trade_at: null,
      source: "Synthetic offline test",
      complete: false,
      evidence: ["https://source.example/snapshot"],
    },
  ];
  return {
    id: "synthetic-ruling",
    meme_id: MEME.id,
    coin_cas: [...CAS],
    ranked_cas: [...CAS],
    winner_ca: CAS[0]!,
    status: "resolved",
    grid: CAS.map((ca, index) => ({
      coin: ca,
      eliminated_by: index === 1 ? 7 : null,
      rules: Object.fromEntries(
        config.rules.map((rule) => [
          rule.id,
          {
            result: index === 1 && rule.id === 7 ? "fail" : "pass",
            reason:
              index === 1 && rule.id === 7
                ? "Synthetic earlier coin was alive at the snapshot."
                : "Synthetic check passed.",
            evidence: rule.id === 7 ? ["snapshot:synthetic:one/a b"] : [],
          },
        ]),
      ) as Record<RuleId, RuleCheck>,
      flags: { bundled: true },
    })),
    flags: { [CAS[0]!]: { bundled: true } },
    config_hash: hash,
    rules_version: config.version,
    facts_hash: "synthetic-facts-hash",
    created_at: "2026-10-01T02:00:00Z",
    share_slug: "synthetic-ruling",
    facts: { coins, meme: structuredClone(MEME), config },
  };
}
export function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  Object.entries({
    cas: CAS.join("\n"),
    source_url: INPUT.source_url,
    version: "v1",
    ...extra,
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}
