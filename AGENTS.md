# PvP Referee build plan for Codex

Oct 28, 2026 · @Brian

## 1. What it is

PvP Referee takes a set of competing Solana memecoin contract addresses for the same meme and rules which one is the correct version, using a published, versioned rulebook with every check linked to on-chain or source evidence. The output is a ranked list with a pass/fail grid per coin and a plain-language reason for each failure, never a single score.

Non-goals for v1: no bundle detection, no serial-rugger scoring, no price prediction, no live trading hooks, no mobile app. Bundle and creator-wallet history appear as display-only warnings and never change the verdict. Market cap is displayed but is only an input through the participation snapshot (section 2, rule 6).

Users: trenches traders mid-argument. Primary surface is a web page that accepts 2 to 10 CAs and returns a shareable ruling card. Secondary surface is an X bot that answers the same question when tagged with CAs.

## 2. Rulebook v1

Rules run in precedence order. A coin eliminated by an earlier rule is not rescued by a later one. Every rule is a pure function of a coin, the meme record, and the frozen snapshot, so rulings are reproducible. Thresholds live in a versioned config file and are shown on every ruling.

| # | Rule | Test | Evidence | Beats a live earlier coin? |
| --- | --- | --- | --- | --- |
| 1 | Subject endorsement | Subject posted the CA, received supply to a verified wallet, or claimed creator fees. Among endorsed coins, the one holding the most subject-held supply wins | Source post URL, wallet label, fee claim tx | Yes. A later endorsement with less subject-held supply does not transfer |
| 2 | Identity | Name and ticker scored separately against the canonical string from the source hierarchy: subject's own post > official asset > trailer or site text > wiki/KYM. When two strings compete (species vs pet, nickname vs full name), the one used more in press and articles is canonical. Exact spelling including source typos. A later coin whose image is noticeably similar to an earlier alive coin's image is a copy | Source URL, string diff, press count, image hash distance | No, but a failed identity eliminates |
| 3 | Meme scope | Meme tagged as specific artifact or general concept. A differently named concept derivative is a separate meme and gets no ruling | Meme record | n/a |
| 4 | Chain fit | Chain-native memes (CZ tweet, RH stock memes) must be on the source's home chain. Otherwise chain is not scored | Meme record chain field | No |
| 5 | Launchpad and pair | Pair must be the correct pair for the meme (robotaxi to TSLA, Litecoin meme to LTC, generic to SOL). A later coin with the correct pair beats an earlier coin with the wrong pair. A port to another launchpad is a vamp unless the source points there | Pool data, pad data | Yes, on pair. No, on launchpad alone |
| 6 | Beneficiary fees | When the meme has a natural beneficiary (subject, charity, artist, repo), fees routed to that beneficiary rank higher, counted only if the tie was public before the rival's first real buying and the beneficiary can actually claim | Fee wallet, tie timestamp, claimability check | Yes, with the pre-tie condition |
| 7 | Participation snapshot | Frozen at the instant of the rival's first real buy. The earlier coin must already have real participation at that instant. Nothing after counts. If nobody was in it until the rival ran, it is dead. No PvP grace window: once a coin has volume, anything launched after is a vamp unless an earlier rule finds the first one wrong | Historical trades, holder count at T | Defines alive |
| 8 | Precedence | Among coins equal on 1 to 7, earliest real participation wins. Deploy time is never used | First real buy timestamp | Tiebreaker only |

Display-only flags, never verdict-changing: top-10 holder percentage, creator wallet launch count last 30 days, dev sold, CTO status, dex paid, third-party verified badges.

Thresholds to publish in config: minimum distinct buyers and minimum cap above launch that count as real participation at the snapshot instant (set low, the rule is binary), image hash distance for noticeably similar (set so recolors and crops still match), press count source list for canonical string ties.

## 3. Architecture

Monorepo, TypeScript end to end, deployed as one Next.js app plus a worker. Rules engine is a pure package with no I/O so it can be unit tested against fixtures and reused by the X bot.

| Component | Responsibility | Tech |
| --- | --- | --- |
| `packages/rules` | Pure rules engine: takes CoinFacts[] + MemeRecord + Config, returns Ruling. No network calls | TypeScript, Vitest |
| `packages/ingest` | Fetches on-chain facts per CA: metadata, pool, pair, fee wallet, first real buy time, holders and cap at timestamp T | Helius RPC + DAS, pump.fun public API, Jupiter price API |
| `packages/source` | Resolves the meme source: canonical name and ticker, source image, subject handle, beneficiary tie timestamp | X API v2 for posts, manual override form, image perceptual hash |
| `apps/web` | Input form (2 to 10 CAs), meme resolver UI, ruling card, shareable permalink, rulebook page with versioned config | Next.js 15, Postgres via Drizzle, Vercel |
| `apps/bot` | X bot: when tagged with CAs, runs the same pipeline and replies with the ruling card image | Node worker, X API v2, Satori for card render |
| `config/rulebook.v1.json` | All thresholds and precedence, versioned, hashed into every ruling | JSON, committed |

Data sources and what each provides:

- Helius: token metadata, mint and freeze authority, holder count, creator wallet, transaction history for first-buy and snapshot reconstruction.
- pump.fun API: bonding curve state, pair asset, creator fee wallet, launch timestamp.
- Jupiter or Birdeye: historical price and market cap at a timestamp.
- X API: source post lookup by URL, subject handle verification, endorsement post detection.

Snapshot reconstruction is the hardest piece. Holder count and cap at timestamp T are rebuilt from the transaction log up to T, cached per CA and T in Postgres so repeat rulings are instant.

Every ruling stores the raw facts it was computed from, the config hash, and the rules version, so a ruling can be replayed and the page can show exactly why.

## 4. Data model

Five tables. Facts are immutable once fetched; rulings reference the facts and config they used.

| Table | Key fields | Notes |
| --- | --- | --- |
| `memes` | id, slug, scope (artifact or concept), canonical_name, canonical_ticker, source_url, source_tier, source_image_hash, subject_handle, home_chain (nullable), implied_pair (nullable), beneficiary_wallet (nullable), beneficiary_tie_at (nullable), created_by | One row per meme. Resolved from the source post. Manual override fields logged with who set them |
| `coins` | ca, meme_id, chain, launchpad, pair_asset, name, ticker, image_hash, creator_wallet, fee_wallet, deployed_at, first_real_buy_at, bonded_at (nullable) | first_real_buy_at = first buy after which the config minimum of distinct buyers is reached within the config window |
| `snapshots` | coin_ca, at, mcap_usd, holders, distinct_buyers_lifetime, last_trade_at, source | Cached reconstruction of a coin's state at timestamp `at` |
| `endorsements` | coin_ca, kind (ca_post, majority_supply, fee_claim), evidence_url, evidence_tx, at, verified_by | Multiple per coin allowed; conflict logic lives in rules |
| `rulings` | id, meme_id, coin_cas[], winner_ca, grid (JSON per coin per rule: pass, fail, na, reason, evidence), flags (JSON), config_hash, rules_version, facts_hash, created_at, share_slug | Immutable. Rerun creates a new ruling |

Ruling grid shape:

```json
{
  "coin": "<ca>",
  "eliminated_by": 2,
  "rules": {
    "1": { "result": "na" },
    "2": { "result": "fail", "reason": "Ticker KIO does not match canonical KIONGOZI from subject post", "evidence": ["https://x.com/..."] },
    "7": { "result": "pass", "reason": "Alive at rival first buy: $48K cap, 212 buyers", "evidence": ["snapshot:<id>"] }
  },
  "flags": { "top10_pct": 31.2, "creator_launches_30d": 14 }
}
```

## 5. Build phases

Six phases, each a separate Codex task with a definition of done. Phase 1 has no network dependency so it can be verified entirely with fixtures before any API keys exist.

1. Rules engine with fixtures. Scaffold the monorepo, write `config/rulebook.v1.json`, implement `packages/rules` as pure functions, and encode the eight test cases from section 7 as fixtures. Done when all fixtures produce the expected winner and grid.
2. Ingest. Implement `packages/ingest` against Helius and pump.fun: metadata, pair, fee wallet, creator wallet, deploy time, first_real_buy_at, and snapshot reconstruction at an arbitrary T. Done when the KIMCHI, SOLCAT, and robotaxi CAs produce correct facts matching the brief.
3. Source resolver. Implement `packages/source`: given a source URL, extract canonical name and ticker, source image, subject handle, and tier; perceptual hash the image; detect endorsement posts. Include a manual override path. Done when the DACITY and Tilcayo/Tigrino memes resolve correctly.
4. Web app. Input form, meme resolver step, ruling card, permalink, rulebook page that renders the live config. Done when a user can paste CAs and get a shareable ruling in under 15 seconds.
5. Ruling card image and X bot. Render the card with Satori, deploy the bot worker, reply when tagged with CAs. Done when a tag produces a reply with the image.
6. Hardening. Rate limits, cache warming, abuse controls on the override form, config versioning UI, and an admin page to re-run a ruling under a new config version. Done when a config bump reruns a stored ruling and shows the diff.

Sequencing: 1 and 3 can run in parallel. 2 blocks 4. 5 and 6 follow 4.

## 6. Codex task prompts

Paste this doc's sections 1, 2, 4, and 7 into `AGENTS.md` at the repo root first so every task has the rulebook and fixtures in context. Then run the prompts in order, one per Codex session.

**Phase 1**

```markdown
Scaffold a pnpm monorepo named pvp-referee with packages/rules, packages/ingest, packages/source, apps/web, apps/bot, and config/. TypeScript strict everywhere, Vitest for tests. Read AGENTS.md for the rulebook and data model.

In config/rulebook.v1.json encode the eight rules in precedence order and every threshold named in AGENTS.md with placeholder values I can tune. Export a typed loader that hashes the config.

In packages/rules implement `rule(coins: CoinFacts[], meme: MemeRecord, config: Rulebook): Ruling`. Pure, no I/O. Each rule is its own file returning {result, reason, evidence}. Elimination order follows precedence. Output the grid JSON shape from AGENTS.md.

Encode the eight test cases from AGENTS.md section 7 as fixtures in packages/rules/fixtures, with the facts stated there and reasonable invented values where the brief is silent. Write a test per fixture asserting winner and the eliminating rule for each loser. All tests must pass. Do not add network code.
```

**Phase 2**

```markdown
Implement packages/ingest. Given a Solana CA, fetch via Helius (RPC + DAS) and the pump.fun public API: name, ticker, image URL, chain, launchpad, pair asset, creator wallet, fee wallet, deployed_at, bonded_at, mint and freeze authority. Compute first_real_buy_at as defined in AGENTS.md. Implement `snapshotAt(ca, t)` that reconstructs mcap_usd, holders, distinct_buyers_lifetime, and last_trade_at at timestamp t by replaying the transaction log, using Jupiter or Birdeye for historical price. Cache snapshots in Postgres via Drizzle using the data model in AGENTS.md. Read API keys from env. Write an integration test behind an env flag that runs against the three CAs in .env.example. Return typed CoinFacts matching packages/rules.
```

**Phase 3**

```markdown
Implement packages/source. Given a source URL (X post, YouTube, site), extract canonical name, ticker, source image, subject handle, and tier; perceptual hash the image; detect endorsement posts. Include a manual override path. Write unit tests with saved HTML and JSON fixtures, no live network in the default test run.
```

**Phase 4**

```markdown
Build apps/web in Next.js 15 with the app router. Pages: / with a form for 2 to 10 CAs and a source URL, /resolve showing the inferred meme record with editable fields and the assumption line (meme source, implied pair, home chain), /ruling/[slug] showing the winner, the per-coin pass/fail grid with reasons and evidence links, display-only flags, the config version and hash, and a share button, and /rulebook rendering the live config as a readable table. Wire ingest, source, and rules through a server action. Persist rulings as immutable rows. Target under 15 seconds end to end with warm cache. Minimal styling, dark theme, mobile first.
```

**Phase 5**

```markdown
Add card rendering with Satori producing a 1200x675 PNG of a ruling: winner, each loser with its eliminating rule in one line, config version. Build apps/bot as a Node worker that polls X mentions, extracts 2 to 10 Solana CAs from the tweet or its parent, runs the same pipeline as apps/web, and replies with the card and the permalink. If the meme cannot be resolved automatically, reply with the /resolve link instead of guessing. Handle rate limits and dedupe mentions.
```

**Phase 6**

```markdown
Hardening: add rate limiting on the form and bot, require sign-in for manual source overrides and log them, add config versioning so rulebook.v2.json can coexist, add /admin/rerun that recomputes a stored ruling under a chosen config version and shows the grid diff, and add cache warming for the top 50 trending pump.fun CAs. Write a runbook in docs/ covering key rotation and config bumps.
```

## 7. Test cases

Each row is a fixture in `packages/rules/fixtures`. Market caps are as posters claimed on X and only matter through the snapshot rule. The expected winner must come out of the rules alone; if a fixture fails, the rulebook changes, not the fixture.

| Fixture | Setup | Expected winner | Why | Rule exercised |
| --- | --- | --- | --- | --- |
| robotaxi | A: correct identity, SOL pair, alive. B: launched after A was running, identical identity, higher cap | A | B fixes nothing | 7, 8 |
| robotaxi_tsla | A: correct identity, SOL pair, alive. B: same identity, TSLA pair, launched after | B | Correct pair wins regardless of when the pair became available | 5 |
| invisible_cat | A: deployed 19 days earlier, $2K cap, no trades, revived after B ran. B: $200K, correct identity | B | A was not alive at B's first real buy; A's later volume is post-rival burst | 7 |
| kimchi | A: live OG at $7M for months. B: new mint, 75% supply to subject-labeled wallet, subject posted video linking wallet | B | Endorsement outranks a live earlier coin | 1 |
| kimchi_qr | As kimchi, plus C: subject later posts QR to a third CA while B is alive | B | Second endorsement does not transfer; C marked conflict | 1 |
| kiongozi | A: ticker KIONGOZI matching subject post, charity fees tied before B, $25K alive. B: ticker KIO, $1.5M | A | B fails ticker against canonical string; A alive | 2, 6 |
| tilcayo | A: name Tilcayo (species, concept), first. B: name Tigrino (the specific pet, artifact), fees to the shelter tied before A ran | Separate memes, or B if scoped as same meme | Canonical name is whichever is used more in press; if same meme, B also wins on beneficiary fees | 3, 6 |
| solcat | A: dead OG, bundled and dumped, revived after B. B: $400K runner | B | Clean dead-OG case; bundle flag shown but not used | 7 |
| cz_bnb | A: CZ tweet meme on Solana paired to SOL, first. B: same meme on BNB chain | B | Chain-native meme belongs on the source's home chain | 4 |

Add a fixture per new real dispute going forward. The fixture file is the public changelog of what the referee believes.

## 8. Open decisions

Settled 2026-10-28. Remaining unchecked items are still open.

- [x] Alive threshold: binary, frozen at the rival's first real buy. If nobody cared until the new one ran, the earlier coin is not valid
- [x] Post-rival burst window: not needed, nothing after the snapshot instant counts
- [x] PvP window: none. Once a coin has volume, anything after is a vamp unless the first one was wrong
- [x] Endorsement: no fixed percentage, the coin with the most subject-held supply wins
- [x] Image hash distance: noticeably similar counts as a copy
- [x] Correct pair wins over an earlier coin with the wrong pair (robotaxi_tsla fixture: B wins)
- [x] Competing canonical names (Tilcayo vs Tigrino): whichever is used more in articles and news
- [x] Manual source overrides: Brian only at launch
- [x] Ship the web app and the X bot in the same release
- [x] Name: PvP Referee, handle pvpreferee in full (pvpref reads like a referral code)
