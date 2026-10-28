# @pvp/rules

Pure TypeScript implementation of the frozen PvP Referee v1 rulebook. There is no
network, database, clock read, randomness, ingestion, or source resolution here.
Only `packages/rules` is owned by this implementation.

```ts
import { loadRulebook } from '@pvp/config';
import { rule } from '@pvp/rules';
import { fixtures } from '@pvp/rules/fixtures';

const fixture = fixtures[0]!; // Explicitly synthetic test records, not real coins.
const ruling = rule(fixture.coins, fixture.meme, loadRulebook().config);
```

## Public exports

- `@pvp/rules`: `rule(coins: CoinFacts[], meme: MemeRecord, config: Rulebook): Ruling`.
- `@pvp/rules/fixtures`: `fixtures: RuleFixture[]`. Contains all nine named dispute
  rows and `tilcayo_same_meme`. Every fixture has `synthetic: true`; fake CAs,
  wallets, image hashes, evidence, dates, and unspecified numerical values are
  invented for offline tests. Press URLs with `synthetic-pvp-fixture` paths are
  synthetic identifiers, not captured articles or claims about those publishers.

Types come from `@pvp/shared`. Configuration validation and hashing come from
`@pvp/config`; the package does not edit or extend the frozen contracts or config.

## Evaluation and evidence

The eight rules each live in their own file under `src/rules`. A failed rule sets
the coin's exact `eliminated_by` and later rules cannot restore it. Every grid has
all eight checks. Checks skipped after elimination say why they were skipped.
Display flags are copied into the output and never used to select a winner.

A verified subject endorsement is decisive at rule 1. A sole endorsed coin needs
no measured supply percentage and there is no percentage minimum. When multiple
coins are endorsed, all require known holdings to select the unique maximum.
Lower-supply endorsements are explicit conflicts. Equal holdings or contradictory
holdings remain unresolved. An endorsement must identify its CA, have a verifier
and dated source/transaction evidence, and not postdate observation; a supply
transfer also needs the subject wallet. Old endorsement measurements are not
maximized; conflicting latest endorsement measurements remain unresolved.

Separate meme IDs, or a differently named concept/artifact scope, trigger a
comparability gate before elimination. The result is `separate_memes`, with no
winner, ranking, or eliminating rule. Null meme assignments remain `unresolved`;
the pipeline must attach the resolved meme ID while preserving explicit
mismatches. The engine does not decide that two different memes are one.

Names and tickers are tested independently and exactly, including source typos.
The resolver provides the canonical source and tier; the engine cannot fetch or
reconstruct the hierarchy. When press candidates are supplied, it counts distinct
URLs on the configured domains, deduplicates `www`, trailing slashes, fragments,
and tracking parameters, and preserves meaningful query parameters. Ties and
zero eligible counts remain unresolved. Content deduplication must already have
been performed by the resolver; these contracts contain URLs, not article bodies.

Image comparison accepts 16 hexadecimal digits or 64 binary digits. It only
compares supplied hashes and only fails a later coin against an earlier alive
coin, with an exact snapshot proving life. Null or invalid hashes are unknown,
never assumed similar or dissimilar. Missing image evidence is irrelevant where
an earlier rival is proved dead or no earlier rival exists. All fixture hashes
are deliberately synthetic and are not assertions about the real memes' images.

`meme.implied_pair` is authoritative; null uses `config.pair.default_asset`.
`config.pair.meme_pairs` supplies resolver hints, not a reason to infer a pair from
a display slug. This preserves the explicit distinction between generic
`robotaxi` and `robotaxi_tsla`. A correct pair beats a wrong pair even on another
launchpad. A source-approved launchpad avoids the port failure but does not by
itself defeat an earlier surviving participant.

Beneficiary priority requires a matching fee wallet, explicit claimability, and
both the source tie and the fee routing tie strictly before the rival's first
real buy. Equality is not "before." Missing qualifying evidence remains unknown;
known late, non-beneficiary, or unclaimable routing provides no advantage.

Participation is evaluated chronologically in groups of equal first-buy times.
Only surviving contenders may defeat new entrants. Thus if A is alive at B's
entry, B is eliminated permanently; if A is dead when C enters, C can win even
if the eliminated B now has volume. Tied timestamps are never broken by CA order
or deployment time. A genuinely unresolved transition stops later comparisons.

Participation requires a complete snapshot **at exactly the rival's
`first_real_buy_at`**, with a matching CA, evidence, source, known holders and
distinct buyers, known cap and launch baseline, and no future trade. Optional
snapshot config hashes must match. No nearest, earlier, future, or post-rival
snapshot is substituted. Both minima are inclusive:

```text
distinct_buyers_lifetime >= min_distinct_buyers
mcap_usd - launch_mcap_usd >= min_cap_above_launch_usd
```

There is no grace period, recency threshold, absolute market-cap scoring, or
post-rival revival. `first_real_buy_at` is supplied by ingest, which must implement
the configured buyer window from the actual trade history. This package has no
raw trades with which to derive or independently audit that timestamp.

Missing required evidence produces `status: 'unresolved'` and no winner. Because
the frozen grid supports only `pass | fail | na`, unknown checks use `na` with an
`Unresolved:` reason. A known false condition is a failure, not unknown. If every
coin is conclusively eliminated the status is `no_winner`. Equal maximum
endorsement holdings and equal surviving first-buy times remain unresolved;
the rulebook specifies no further tiebreak. Ranking sorts by surviving precedence
gates, with CA order used only to serialize tied ranks, never to choose a winner.

## Reproducibility

The input set is copied and sorted by CA. `facts_hash` is SHA-256 of shared
`canonicalJson({ coins, meme, config })`, including all supplied raw facts,
evidence, display flags, and config. `config_hash` is from `hashRulebook`.
`created_at` is the maximum supplied `observed_at`, normalized to UTC.
The full facts hash forms `ruling_<hash>` and `r-<hash>` IDs/slugs. Reordering the
coin input set does not change output; modifying evidence or flags changes
provenance even when the verdict does not change. Nested source arrays are
preserved as supplied. The pipeline may assign unique persisted run IDs.

Inputs must contain 2–10 unique, nonempty CAs, a valid config, and valid UTC
`observed_at` values; invalid API shape/provenance throws an actionable error.
Missing facts within a valid contract return unresolved rather than invented
values. Inputs are never mutated and output facts do not alias the inputs.

## Verification and limits

From the repository root: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
For this package alone: `pnpm --filter @pvp/rules test` (uses the root no-network
setup), `pnpm --filter @pvp/rules typecheck`, `pnpm --filter @pvp/rules lint`.

Tests assert every fixture's winner, status, and every exact eliminating rule;
all coin-order permutations; precedence immunity; display flag independence;
unknown/future/conflicting evidence; endorsements with missing, equal, greater,
and conflicting holdings; source URL normalization; exact snapshot thresholds;
ties; chronological three-coin regressions; and the ten-coin limit.

No live claims are verified here. The frozen contracts lack per-field provenance,
article content, image pixels, endorsement search completeness, and raw trades.
The engine trusts supplied verified labels and evidence references; it cannot
authenticate them, compute perceptual hashes, prove no omitted endorsement exists,
or reconstruct snapshots. Those are ingest/source/pipeline responsibilities.
