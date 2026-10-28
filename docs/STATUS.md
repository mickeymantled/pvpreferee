# PvP Referee v0.1 status

Verified locally on 2026-10-28 with Node 22.22.3, pnpm 11.3.0 and Postgres 16.14. This is an implemented, tested **pre-production release**, not a claim of verified live historical rulings. The missing production adapters and live acceptance gates below are material.

## Implemented

- Phase 0: strict TypeScript pnpm workspace, shared ESLint/tsconfig/Vitest/CI, frozen `@pvp/shared` contracts, typed and hashed eight-rule config, CONTRIBUTING and `phase-0` tag. `AGENTS.md`, shared contracts and the v1 JSON have not changed since that tag.
- Rules: eight pure rule modules, ordered elimination, separate-meme handling, per-rule evidence/grid and display-only flags. All nine named acceptance rows plus the conditional same-meme Tilcayo case are covered (10 fixtures). Tests assert winners and each loser's eliminating rule; there is no rule-engine I/O.
- Ingest: Helius metadata/authorities, finalized pump.fun curve decoding and creator provenance, exact-time Birdeye pricing, injectable complete historical-ledger replay, distinct-buyer first-real-buy calculation, owner-aggregated historical holders, attested snapshots and Drizzle/Postgres caching. Incomplete coverage stays unknown. The five-table schema retains immutable coin observations, snapshots, endorsements and frozen rulings; SQL rejects updates/deletes/truncation of immutable records. Migrations are idempotent.
- Source: reviewed URL/subject authority bindings, X/YouTube/site metadata adapters, source-tier precedence, exact canonical fields, verified-subject CA-post detection, canonical-name press-count tiebreak, raster perceptual hashes and administrator-only field-level audited overrides. URL fetching has public-IP/DNS pinning, redirect, credential, timeout and size protections.
- Shared pipeline: source/coin/snapshot/image evidence gathering, bounded concurrency, source-review revalidation, deterministic judging and immutable persistence. Web and bot share this implementation. UUIDs/timestamps/I/O stay outside the engine.
- Web: Next 15 `/`, `/resolve`, `/ruling/[slug]`, `/rulebook`, version-specific rulebooks and PNG card route. Dark responsive UI, explicit assumptions, read-only public canonical fields, full evidence grid, source audit, frozen facts/hash and shareable permalinks. Provider failures never become invented rulings.
- Cards: shared Satori/resvg package; deterministic 1200×675 PNGs, bundled licensed fonts, winner/full CA, loser/rule/reason, version/hash, all ruling states and 2–10 candidates. Ten fixture image snapshots and layout checks are included. Unsupported glyph substitution is disclosed on the card; full text remains on the ruling page.
- Bot: OAuth user-authenticated X mentions worker, 2–10 actual 32-byte base58 CAs, one-parent context, source-review fallback link, shared pipeline/card/permalink replies, persistent dedupe/cursor/outbox/quotas and rate-limit backoff. Ambiguous reply delivery is held for operator reconciliation, never blindly retried. Default mode does not post.
- Hardening: single-admin scrypt login, signed eight-hour secure session, exact-origin mutation checks, audited source review, shared Redis production rate limits, append-only config registry, `/admin/rerun` with grid diff/new immutable rows, bounded cache-warming adapter/CLI and operations runbook. No v2 policy has been invented or published.

## Stubbed, limited or not live-verified

1. **Complete production historical ledger is not implemented.** The default `UnavailableHistoricalLedger` returns unavailable coverage. Helius mint-address transaction history is not attested mint-wide history; it is not substituted for one. Consequently default live `first_real_buy_at` is unknown and historical snapshots are incomplete. Provide a reviewed `HistoricalLedger` to `createIngestFromEnv` / `createRuntime({env, ledger})` and wire it into the deployment composition before historical rules can reliably resolve live disputes. API keys alone do not fix this.
2. **Chain endorsement/holdings and beneficiary verification need adapters.** Source post identity/explicit CA text can be verified, but wallet ownership, subject-held supply, claimable fee routing and public beneficiary ties need independent chain evidence through `verifyChainEvidence`/ingest seams. These are not inferred from an unverified creator label. No automatic QR, OCR, audio/transcript or semantic meme interpretation is implemented. KIMCHI QR/supply scenarios are synthetic acceptance tests, not live decoded evidence.
3. **Provider coverage is bounded.** Pump curve data is checked against its program/IDL; a completed/migrated curve does not establish its current pool pair. Unsupported token extensions, unknown pools/pairs and non-Solana production chains remain unknown. Birdeye accepts only an exact whole-second returned timestamp, not a nearest/current quote. API plans, historical depth and production responses still need live validation.
4. **Source identity needs reviewed inputs.** `SOURCE_AUTHORITIES` pins exact source URLs to reviewed tiers/subject identities; naming a handle or token is not authority. Automatic extraction uses explicit source metadata/text, not general NLP. Press tiebreaks use supplied article URLs from allowed publishers, not web-wide discovery. pHash is a bounded DCT similarity signal, not a guarantee of arbitrary crop recognition or unique images. Manual reviews remain the fallback.
5. **Trending feed is unsupported by default.** `cache:warm` exits 2 with `status: unsupported` until a reviewed local `WARMING_ADAPTER_MODULE` supplies a documented top-50 ranking and complete ledger. It does not silently use newest tokens as trending. One exact checkpoint is warmed and verified in Postgres, not all possible rival-first-buy times. No scheduler is installed.
6. **Live credentials, fixture CAs and deployment were not supplied.** No Helius/Birdeye/X/YouTube authenticated live acceptance run, live Redis test, X upload/reply, production deployment, or full-ingest <15-second latency validation was performed. Bot OAuth acquisition/refresh is external; send mode requires a reviewed public HTTPS origin and the appropriate X account scopes/access. The worker is single-process on a persistent local POSIX volume, not a distributed queue.
7. **Config reruns do not invent historical observations.** Only v1 is published. Compatible later configs can derive snapshots from frozen values while preserving the full originals and provenance; derived rows do not enter the observed cache. Changing distinct-buyer count or first-buy window requires fresh ingest and is rejected by historical rerun. The synthetic v2 used in tests is not a policy release.

Live KIMCHI, invisible-cat and robotaxi end-to-end acceptance is **blocked, not passed**. The brief supplied scenario names but no verifiable contract addresses. Repeated-letter CAs and `example.invalid`/`synthetic_fixture` URLs in fixtures are explicitly synthetic; never use them as real-chain addresses or evidence. The live tests also include SOLCAT. Their required environment values are listed below.

## Verification performed

- Full offline suite: **435 passed, 4 intentionally skipped live integration tests** across 35 passing test files and one skipped file. Default tests deny fetch, sockets and DNS. Typecheck, ESLint, Next production build and full `pnpm audit` passed; audit reported no known vulnerabilities at verification time.
- All 10 acceptance fixtures passed through the real shared pipeline into an isolated local Postgres database, then reloaded and replayed with matching winners/eliminating rules. The harness checked all five tables, raw JSON/hash roundtrips, idempotent persistence/migrations and immutable-row rejection.
- Manual browser checks: home/resolve validation and missing-provider states; stored KIMCHI ruling/grid/card; synthetic administrator sign-in, an audited source-record creation (eight field entries), same-version KIMCHI rerun with a new permalink and unchanged facts hash/verdict, sign-out/access restriction. A missing-provider issue attempt saved no ruling.
- HTTP checks on stored **synthetic** KIMCHI, invisible-cat and robotaxi cases returned pages and 1200×675 PNGs with immutable cache headers. Standalone production assets/pages were checked; production expensive routes fail closed without Redis. In a streamed Next response, unauthenticated redirects may be HTML redirects rather than HTTP 307; protected controls are not rendered.
- Bot without its required token exited with a sanitized configuration error; default warming exited unsupported without fabricating a feed. Neither action posted or manufactured production data. Offline bot tests exercise the real shared pipeline and renderer.

Local synthetic QA data remains in a dedicated test database for inspection; no production database was used. Temporary test servers and ephemeral admin settings are not deployment configuration. Run CI and the live acceptance gates again with the deployment environment; local checks are not a substitute.

## Exact local commands

Run from the repository root. Requires Node **22.13+**, pnpm **11.3.0**, and Postgres (Docker optional). If port 5432 is already occupied, use the existing local Postgres or deliberately change the compose port and URL.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
```

Edit `.env`: for this local compose database set `DATABASE_URL=postgres://pvp:pvp-local-only@localhost:5432/pvpreferee`; supply provider settings as appropriate. Never use this development password in hosting. Then:

```sh
pnpm db:migrate
pnpm dev:web
```

Open `http://localhost:3000`. Source pages can explain missing metadata without Helius; issuing rulings needs database/ingest configuration. Unknown history remains unknown with the default ledger. On another port, update both the command and `APP_ORIGIN`, e.g. `APP_ORIGIN=http://localhost:3001 pnpm dev:web --port 3001`.

For administrator review, configure all four admin values below and generate the hash with `pnpm --filter @pvp/web admin:hash`. Supply the password via private stdin/password-manager piping, finish stdin with EOF, and put only the resulting hash in `.env`. Do not place a password in shell history. Visit `/admin/login`. Use localhost for local secure-cookie handling; production requires HTTPS.

In a second terminal, after setting the bot's user token and local origin:

```sh
BOT_SEND=false pnpm dev:bot
```

This is dry-run, **not offline**: it reads X and can fetch/persist rulings. It never uploads/posts. Do not enable send mode merely to test startup. See [the bot runbook](../apps/bot/README.md) for OAuth scopes, cursor review, durable-state recovery and the explicit production send switch.

Stop dev before using the same `.next` tree for a production build:

```sh
pnpm build
pnpm --filter @pvp/web start
```

The production server can render stored pages with Postgres, but protected mutations require production HTTPS `APP_ORIGIN`, and expensive routes require shared Redis. It intentionally does not fall back to local memory in production. `WEB_HOST` defaults to `127.0.0.1` and `PORT` to 3000. Local development is the normal HTTP workflow.

Verification commands:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm audit
pnpm --filter @pvp/card samples
```

For database smoke verification, create a separate synthetic-only database first. For the compose instance:

```sh
docker compose exec postgres createdb -U pvp pvpreferee_smoke
TEST_DATABASE_URL=postgres://pvp:pvp-local-only@localhost:5432/pvpreferee_smoke PVP_ALLOW_SYNTHETIC_DB=1 pnpm --filter @pvp/pipeline verify:db
```

The harness prints saved fixture slugs. To view those records locally, use that **test** database URL for the web process. Never seed them into the live database. The harness does not delete existing data or clean up its immutable rows.

After supplying real credentials/CAs, opt into the provider checks explicitly (test scripts otherwise do not load `.env`):

```sh
RUN_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run packages/ingest
```

Those four tests verify available provider metadata and honest incomplete default history; they are **not** full historical acceptance. Complete production adapters, independently verified original sources/holdings, and real multi-CA disputes are still required for the final live KIMCHI/invisible-cat/robotaxi runs.

## Environment inventory

Root `.env` is loaded by web/bot/migration operational scripts; inherited environment takes precedence. Tests do not silently load it. No credentials are bundled. Optional bot overrides must be omitted rather than set to empty strings.

| Variable | Requirement / default |
| --- | --- |
| `DATABASE_URL` | Postgres URL for persistence, admin, migrations, saved pages and candidate-source rulings. |
| `HELIUS_API_KEY` or `HELIUS_RPC_URL` | One required for live ingest; explicit RPC URL takes precedence. A complete ledger remains separate. |
| `BIRDEYE_API_KEY` | Historical USD price lookup; missing/inexact prices remain unavailable. |
| `INGEST_TIMEOUT_MS` | Provider HTTP timeout; default `10000`. |
| `PUMP_API_BASE_URL` | Default `https://frontend-api-v3.pump.fun`. Operator-controlled endpoint, not a public form input. |
| `BIRDEYE_API_BASE_URL` | Default `https://public-api.birdeye.so`. |
| `X_BEARER_TOKEN` | Source-post lookup token; separate from the bot user token. |
| `YOUTUBE_API_KEY` | YouTube source lookup. |
| `SOURCE_AUTHORITIES` | Reviewed JSON authority bindings; default empty. See source README; no guessed identity grants. |
| `APP_ORIGIN` | Exact web origin for mutation checks; local dev defaults to `http://localhost:3000`; required HTTPS in production. |
| `ADMIN_EMAIL` | Single administrator login email; required with the following three values for admin access. |
| `SOURCE_ADMIN_ACTOR` | Fixed server-derived identity recorded in override audits. |
| `ADMIN_PASSWORD_HASH` | Hash from `admin:hash`; legacy plaintext `ADMIN_PASSWORD` is not read. |
| `SESSION_SECRET` | At least 32 bytes of cryptographically random material; signs sessions. |
| `RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN` | Required production shared Redis HTTPS REST service supporting atomic EVAL/INCR/EXPIRE/TTL. |
| `RATE_LIMIT_CLIENT_SECRET` | Optional ≥32-character trusted-ingress signing key; without valid edge signatures, clients share a global budget. |
| `WEB_HOST`, `PORT` | Standalone bind address `127.0.0.1` / port `3000`. |
| `X_USER_ACCESS_TOKEN` | Bot OAuth 2.0 PKCE user access token; required even for dry-run reads. |
| `BOT_PUBLIC_BASE_URL` | Required bot link origin. Public HTTPS for sending; localhost HTTP allowed in dry-run. |
| `BOT_USERNAME` | Expected authenticated account, default `pvpreferee`. |
| `BOT_SEND` | Default `false`; only exact `true` enables uploads/replies. |
| `BOT_STATE_PATH` | Default `apps/bot/var/dry-run.json` or `send.json` under package scripts; deployment requires a persistent local POSIX volume. |
| `BOT_SINCE_ID` | Optional exclusive initial mention cursor, only for a new state file. |
| `BOT_RULEBOOK_VERSION` | Default `v1`; must be published in the registry. |
| `BOT_POLL_MS` | `60000`. |
| `BOT_HTTP_TIMEOUT_MS` | `15000`. |
| `BOT_HTTP_RETRIES` | `3` additional read/media attempts, never blind reply retries. |
| `BOT_BACKOFF_MS`, `BOT_MAX_BACKOFF_MS` | `1000`, `60000`; provider reset deadlines remain authoritative. |
| `BOT_REQUEST_INTERVAL_MS` | `1000`. |
| `BOT_PIPELINE_TIMEOUT_MS`, `BOT_SHUTDOWN_MS` | `120000`, `30000`. |
| `BOT_PAGE_SIZE`, `BOT_PAGES_PER_TICK`, `BOT_JOBS_PER_TICK` | `100`, `10`, `20`. |
| `BOT_MAX_STORED_MENTIONS`, `BOT_JOB_ATTEMPTS` | `100000`, `3`. |
| `BOT_QUOTA_WINDOW_MS` | `86400000`. |
| `BOT_REPLY_QUOTA`, `BOT_AUTHOR_QUOTA`, `BOT_REPLY_INTERVAL_MS` | `100`, `3`, `60000`; application safeguards, not X plan guarantees. |
| `WARMING_ADAPTER_MODULE` | Optional absolute path to reviewed operator-owned module returning trending + ledger adapters. Missing means unsupported. |
| `WARM_AT` | Optional single whole-second UTC checkpoint; defaults to current time floored to a whole second. |
| `RUN_INTEGRATION` | Only `1` enables the four live ingest checks; default off. |
| `FIXTURE_KIMCHI_CA`, `FIXTURE_INVISIBLE_CAT_CA`, `FIXTURE_SOLCAT_CA`, `FIXTURE_ROBOTAXI_CA` | Real independently verified mints for opt-in live checks; none were supplied. |
| `TEST_DATABASE_URL`, `PVP_ALLOW_SYNTHETIC_DB` | Isolated smoke database and explicit `1` opt-in for synthetic persistence verification. |

Next manages `NODE_ENV` for dev/build/start; do not force development security in a production deployment. `NEXT_TELEMETRY_DISABLED=1` optionally disables Next telemetry. Standard host variables are not credentials or additional application integrations.

See [DECISIONS.md](DECISIONS.md), [runbook.md](runbook.md), [source integration notes](../packages/source/README.md), [ingest coverage notes](../packages/ingest/README.md) and [bot operations](../apps/bot/README.md) before enabling live traffic.
