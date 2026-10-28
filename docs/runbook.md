# PvP Referee operations

## Runtime and deployment

Use Node **22.13+** (tested with **22.22.3**) and the repository-pinned pnpm. Install from the root, apply the existing ingest migrations, then run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @pvp/web build`. Tests deny fetch, sockets and DNS; integration tests require their explicit flags and credentials. No live warming occurs in tests or builds.

`pnpm --filter @pvp/web dev` is the local development server. `pnpm --filter @pvp/web start` runs the generated standalone server: `apps/web/.next/standalone/apps/web/server.js`. Before launch, `apps/web/scripts/start.mjs` copies `.next/static` and any `public` assets into that generated standalone app directory. It writes only under `.next/standalone`; it does not change source assets. This avoids the unsupported `next start` warning with `output: standalone`. Rebuild before starting after source changes. The script defaults to `127.0.0.1`; set `WEB_HOST=0.0.0.0` only for a container/host behind the configured ingress. `PORT` defaults to Next's 3000. Do not run a production build while a dev server uses the same `.next` tree.

For an artifact-only deployment, prepare assets using the same copy layout, ship the **entire** `.next/standalone` tree (including traced packages/native bindings), and run `node apps/web/server.js` from its root. Set `HOSTNAME` explicitly in that deployment; the repository start wrapper uses `WEB_HOST`. Do not ship just server.js. Vercel's Next integration manages its own artifact layout. Fonts are embedded; card assets/native libraries remain traced by Next.

Scripts load the repository root `.env` using Node's `--env-file-if-exists`. Production should inject secrets through its secret manager. Never commit a populated environment file or print provider URLs containing keys. Stored permalink rendering requires Postgres, but no Helius credential. Source resolution is independent of ingest and does not require Helius.

## Environment

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact public origin, e.g. `https://pvp.example`, with no trailing slash/path. Required in production for mutations/login; never derived from Host/forwarded headers. Development alone defaults to `http://localhost:3000`. |
| `ADMIN_EMAIL` | Brian's single configured login email. Exact comparison. There is no signup or first-user fallback. |
| `SOURCE_ADMIN_ACTOR` | Brian's fixed audit identity, obtained only from the validated server session. Never taken from form fields. Changing it revokes sessions. |
| `ADMIN_PASSWORD_HASH` | `scrypt$<32 hex salt>$<128 hex key>` from the hash helper. Scrypt N=65536, r=8, p=1, 64-byte key. |
| `SESSION_SECRET` | At least 32 bytes of cryptographically random secret material; use a secret manager. Signs sessions. |
| `RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN` | Production shared Redis REST endpoint and write token supporting EVAL/INCR/EXPIRE/TTL. HTTPS only. Missing/malformed/unreachable backend fails expensive requests closed. |
| `RATE_LIMIT_CLIENT_SECRET` | Optional separate random secret of at least 32 characters for an ingress-signed client key. Without valid signatures every request uses a shared global bucket. |
| `DATABASE_URL` | Postgres; required for persistence, admin review/reruns and the warming CLI. Use the existing five-table ingest schema and migrations. |
| `HELIUS_API_KEY` / `HELIUS_RPC_URL`, `BIRDEYE_API_KEY`, `INGEST_TIMEOUT_MS`, `PUMP_API_BASE_URL`, `BIRDEYE_API_BASE_URL` | Existing ingest settings. A complete historical ledger adapter is still required for attested historical reconstruction; credentials alone do not provide one. |
| `X_BEARER_TOKEN`, `YOUTUBE_API_KEY`, `SOURCE_AUTHORITIES` | Existing source settings. Authority bindings must be documented, not inferred from token/site names. |
| `WARMING_ADAPTER_MODULE` | Absolute path to a reviewed, operator-owned local ESM/TS module exporting `createWarmingAdapter(env)`. See warming below. Never accepted from public requests. |
| `WARM_AT` | Optional single whole-second UTC checkpoint (`2026-10-28T12:00:00Z` or `.000Z`) for all warmed mints. Defaults to current time rounded down to a whole second. |
| `WEB_HOST`, `PORT` | Standalone start wrapper bind address/port. No auth or proxy trust is inferred from them. |

The legacy `ADMIN_PASSWORD` is deliberately **not read**, including in development. Generate a hash with `pnpm --filter @pvp/web admin:hash`, supplying the password via private stdin/password-manager piping (not a literal CLI argument or shell-history command). The helper reads to EOF and prints only the hash. Use a random password of at least 16 characters; the helper caps input at 1024 bytes. Store the resulting hash as a secret too. Missing any auth setting fails closed; configuring the actor alone never grants access.

## Administrator review

Visit `/admin/login`. Sessions last eight hours and use a host-only `__Host-` cookie with Secure, HttpOnly, SameSite=Strict and Path=/. Secure cookies require HTTPS in production; local development uses localhost browser secure-cookie handling. Non-local HTTP is unsupported. Login has a global five-attempts-per-15-minute budget before expensive password hashing. All failures, including valid credentials, consume an attempt. Do not reset this budget automatically after login.

Every mutation requires an exact `Origin` match to `APP_ORIGIN`; missing Origin and cross-site Fetch Metadata fail closed. Next's server-action checks are additional protection. There are no user-provided redirect destinations. Logout clears the cookie; session/credential rotation revokes copied tokens. Stateless tokens cannot otherwise be revoked individually before expiry. No secrets, hash or session token are serialized into UI/action errors.

Open `/resolve` with the desired comparison after signing in. The administrator review form is rendered only for a valid admin session; public fields remain read-only. The server independently loads the current database meme (or a fresh source resolver record), binds it to a review fingerprint, validates form fields, and calls `@pvp/source`'s manual override service. Missing source metadata can be created from explicitly supplied canonical fields, scope, tier and cited evidence. Existing records preserve IDs, original creator and prior audit; each changed field appends its previous/value/actor/time/reason. Source URL is fixed to the reviewed comparison. Press candidates are optional structured JSON, e.g. `[{"value":"Name","articles":["https://publisher.example/article"]}]`.

The action freshly reloads the baseline and rejects stale reviews. Repository optimistic concurrency/row locking rejects simultaneous edits to an existing record; it is never safe to pass a browser-supplied baseline to persistence. For a previously absent source, this URL-based UI assigns a stable new ID/slug from the source URL after source-service validation, so the repository's existing unique-ID constraint rejects a concurrent second creation. Existing identities never change. A source URL with multiple existing memes intentionally fails closed for manual resolution outside this UI. No sixth domain table is introduced. Provider/config/database outages are surfaced, never replaced with guessed facts.

## Rate limiting and ingress trust

Budgets are in `apps/web/src/server/rate-limit.ts`: comparison 12/minute, source resolution 30/minute, card rendering 30/minute, admin writes 15/minute, login 5/15 minutes. Source limits run before resolver work, comparison limits before server-action work, and card limits before DB/rendering. Card rejections are uncacheable 429/503 with Retry-After. Client form disabling is only UI feedback. Configure ingress body-size/concurrency limits too; Next server actions retain their bounded default request body.

Development/test may use process-local memory; this is **not distributed** and resets on restart. Production requires shared Redis or returns a safe 503. Redis INCR+expiry+TTL executes as one atomic EVAL with a three-second HTTP timeout. The adapter uses the documented [Upstash REST command-array format](https://upstash.com/docs/redis/features/restapi), not a non-atomic pipeline. This adapter is offline-tested with labeled synthetic responses; no live Redis service was contacted in verification.

Arbitrary `X-Forwarded-For`, `X-Real-IP` and forwarding host headers are never trusted. With no validated client identity, the fail-safe global bucket protects backend cost but can allow one client to exhaust the site's budget. To provide per-client budgets, configure a trusted ingress that strips all inbound `x-pvp-client*` headers, obtains its own verified network/client key, and sends:

- `x-pvp-client`: 1–128 characters from letters, digits, `:._-`.
- `x-pvp-client-at`: current Unix seconds (10 digits, accepted within 60 seconds).
- `x-pvp-client-signature`: hex HMAC-SHA256 using `RATE_LIMIT_CLIENT_SECRET` over `timestamp + "\n" + clientKey`.

The app hashes accepted keys before storing counter keys. Missing, forged or stale signatures fall back to the global bucket. The signature is an edge-to-app mechanism, never a browser API. Prevent direct origin bypass, strip incoming signed headers and do not expose signatures/secrets to clients. Login remains global regardless. These are documented deployment requirements, not a claim that generic forwarded headers are verified by Vercel or another host.

## Config publication and historical reruns

`config/rulebook.v1.json` is unchanged. Its canonical SHA-256 is `7eb4b1e1f6b71878ec7f264b719ab69bf2b3a0a4517b35af2b3171d65dc83e84`.

To publish a real policy update, commit a **new** `config/rulebook.v2.json` containing the approved complete rulebook and its new version. Add its static import to `config/src/index.ts` and append it to `createRulebookRegistry([v1, v2])`. Never replace an old entry or edit published values. Duplicate versions throw; callers receive detached copies. Keep a hash regression assertion for every published version. The static registry works in Next bundles and drives comparison, published `/rulebook/[version]` pages and the admin selector. The default comparison remains v1 until an intentional approved default change. The synthetic v2 in tests is not a published policy or JSON file.

Visit `/admin/rerun`, enter a stored slug and select a committed version. This reads immutable frozen facts, verifies their canonical hash/config consistency, runs the pure engine, creates a new UUID/time outside the engine, recalculates the canonical facts hash and saves a new ruling. The UI links both rulings and shows winner/status/ranking, eliminating-rule and per-rule result/reason/evidence differences. Old facts, timestamps and rulings are untouched.

Changing `min_distinct_buyers` or `first_buy_window_seconds` is **fresh-ingest-required**: first_real_buy_at and rival snapshot instants can change, and the frozen contract does not attest a replayable complete ledger. This implementation does not attempt to reconstruct arbitrary raw envelopes. Incompatible original snapshot config stamps also require fresh ingest. The page reports the reason and saves nothing. Run a new comparison through a complete ingest adapter instead.

For compatible changes (including a cap threshold), copies of frozen snapshot values receive deterministic **derivation** IDs/config stamps and a source description saying “Historical re-evaluation … no new observation”. Each carries a `reevaluation` extension with the full original snapshot envelope, original config stamp/ID, original ruling slug and facts hash. Observed times, historical values, completeness and original provider payloads are retained. Missing data remains missing. These derived snapshots are embedded in the new frozen ruling only; they are never inserted into the observed snapshot cache. The pure engine can replay the new frozen facts exactly. The ruling UI exposes the original snapshot envelope and links its ruling. Differences in evidence IDs can appear even when the verdict is unchanged.

This approach evaluates the frozen source/meme record; it does not fetch today's source metadata, update a source audit or turn historical values into new observations. Raw ingest config stamps inside the original provider envelopes remain their original values. No policy thresholds are invented by the registry/rerun UI.

## Single-run cache warming

`pnpm --filter @pvp/web cache:warm [v1]` runs once, loads the root environment and exits. Without `WARMING_ADAPTER_MODULE`, it prints `status: unsupported` and exits 2 **before** creating provider/database clients. There is no built-in top-50 endpoint: a documented pump.fun trending ranking has not been verified for this implementation, and launch recency is not treated as trending. No scheduler is installed.

The reviewed local adapter must export `createWarmingAdapter(env)` returning `{ trending, ledger }`. `trending.top50(signal)` must respect the 10-second AbortSignal and return either `{status:'unsupported', reason}` or `{status:'ok', mints, asOf, evidence, methodology}`. Supply at most 50 distinct actual 32-byte Solana mint addresses in the provider's documented rank order. Evidence and methodology must describe how the provider established that ranking; do not label arbitrary recency or market-cap sorting as pump.fun trending. `ledger` must satisfy `@pvp/ingest`'s complete `HistoricalLedger` contract. Keys alone cannot replace this adapter.

The CLI explicitly constructs a Postgres snapshot cache, injects it into `createIngestFromEnv`, calls snapshotAt for each mint at **one shared whole-second UTC checkpoint**, then reads each complete result back from the exact cache key to verify persistence. Concurrency defaults to 3 (library maximum 5), failures are isolated, incomplete history is not cached, and all pools close in finally. No scores, trades, artificial histories or meme assignments are created. Reports exclude raw provider errors/credentials. The generic injectable warm function labels complete returns `ready`, which by itself does not prove cache persistence; the operational CLI separately identifies verified Postgres results. Partial/failure exits 1; full success exits 0.

Cache keys are `(CA, exact T, config hash)`. Warming “now” **does not** prewarm arbitrary rival-first-buy timestamps, earlier points or another config. It provides only checkpoint coverage for the selected T. It does not issue 50×50 reconstructions, guarantee the web latency target, or cache current facts as historical observations. Set `WARM_AT` deliberately when a known checkpoint is useful; fractional timestamps are rejected because the historical price adapter requires whole seconds. No live warming was run during implementation.

## Rotation, failures and recovery

Rotate provider/database/Redis credentials at the provider, update the secret manager and restart/redeploy all consumers. Confirm a read-only health check and an authorized operation, then revoke the old credentials. Never include credentials in public error text, screenshots or incident logs. Coordinate bot-specific credentials and limits with the bot worker's own configuration; web changes do not protect its entrypoints.

Rotate `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `ADMIN_EMAIL` or `SOURCE_ADMIN_ACTOR` to invalidate every existing admin session. Sign in again and verify an audited source review or rerun; do not rewrite old audit actors. Rotate the edge signing secret in both ingress and app; mismatches safely fall back to the global bucket until both sides agree. Redis outages fail closed: restore the backend instead of enabling production memory fallback.

Back up Postgres and retain immutable rows/config commits. Roll back an application release without deleting new rulings; deploy historical config entries together so saved versions remain selectable. A rerun that fails integrity or concurrency checks should be investigated and retried from a fresh review, never repaired by overwriting facts or hashes. Real provider coverage, live Redis credentials, live historical ledger and production latency are operational prerequisites/validation still outstanding, not simulated successes.
