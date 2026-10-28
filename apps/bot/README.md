# PvP Referee X worker

Single-process Node worker for explicit mentions of `@pvpreferee`. Uses the public `@pvp/pipeline/runtime` lazy factory and `@pvp/card` renderer. No rulebook or data-model changes, extra database table, live trading, guessed identity, or fabricated provider evidence.

This implementation has offline fixture coverage, including a complete synthetic dispute through the real shared pipeline and 1200×675 PNG renderer. It has **not** been deployed or verified with live credentials or live posts.

## Run

Use Node **22.13+** and the repository's pnpm version. From the repository root, install the merged dependencies/lockfile, configure the root `.env`, then:

```sh
pnpm --filter @pvp/bot dev
pnpm --filter @pvp/bot start
pnpm --filter @pvp/bot test
pnpm --filter @pvp/bot typecheck
pnpm --filter @pvp/bot lint
```

Both worker scripts run `node --env-file-if-exists=../../.env --import tsx src/run.ts` from `apps/bot`. Existing environment values take precedence. `dev` deliberately does not hot-restart a worker during a possible post. Test/typecheck/lint do not load `.env`. During scoped implementation, use `pnpm --config.verify-deps-before-run=false ...` to keep pnpm 11 from regenerating the parent's lockfile before scripts.

`BOT_SEND` defaults to `false`. Dry-run reads X, resolves sources, and may fetch chain data and persist rulings through the pipeline, but **never uploads media or posts to X**. Its jobs finish as `dry_run`, never `sent`. Dry-run and send use different default state files; a state file is permanently bound to its mode and authenticated account. Reusing a dry-run file for send fails. Production starts its own cursor, so review `BOT_SINCE_ID` before explicitly setting `BOT_SEND=true`; initial startup otherwise drains the history that the mentions endpoint makes available.

For a local web preview, dry-run permits `BOT_PUBLIC_BASE_URL=http://localhost:3000` or `http://127.0.0.1:3000`. Send mode requires a public HTTPS hostname without a custom port. Missing credentials/configuration fail with named environment variables and no credential values. Startup rejects unpublished rulebook versions before reading mentions.

## Authentication and endpoints

Use an **OAuth 2.0 Authorization Code with PKCE user access token for the bot account**, not an app-only bearer token. Grant `tweet.read users.read tweet.write media.write`. `offline.access` is needed only by the external OAuth/token-refresh service; this worker does not perform OAuth authorization or refresh tokens. Supply a refreshed access token and restart when it expires. The shared source resolver separately consumes `X_BEARER_TOKEN` for source-post lookups; do not confuse the two settings.

Official X documentation checked on 2026-10-28:

- [Authentication mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping) and [official media sample scopes](https://github.com/xdevplatform/samples/blob/main/python/media/media_upload_v2.py).
- [`GET /2/users/me`](https://docs.x.com/x-api/users/get-my-user) verifies account ID and username before polling. A mismatch with `BOT_USERNAME` or the stored account stops the worker.
- [Mentions quickstart](https://docs.x.com/x-api/posts/timelines/quickstart/user-mention-quickstart) and [mentions reference](https://docs.x.com/x-api/users/get-mentions): `GET /2/users/:id/mentions`, `tweet.fields=author_id,entities,referenced_tweets`, `since_id`, fixed `until_id`, `pagination_token`, and configurable `max_results` from 5–100. The quickstart uses `tweet.fields`, while the generated reference displays newer post terminology; the decoder also accepts `referenced_posts`. A referenced parent is read with `GET /2/tweets/:id` and the same fields.
- [Upload media](https://docs.x.com/x-api/media/upload-media): `POST /2/media/upload` with JSON `{media: <base64 PNG>, media_category: "tweet_image"}`. The returned `data.id` is attached to the reply. Only PNGs up to 5 MB are accepted; a pending/failed processing state is not published.
- [Create post](https://docs.x.com/x-api/posts/create-post): authenticated `POST /2/tweets`, with `reply.in_reply_to_tweet_id`, text, and optional `media.media_ids`. [Reply restrictions](https://docs.x.com/x-api/posts/manage-tweets/integrate) require being summoned. This worker additionally requires a foreign author, a matching mention entity and a visible exact handle; it skips self mentions, reposts, implicit replies and invalid requests.
- [Rate-limit headers](https://docs.x.com/x-api/fundamentals/rate-limits): respect `x-rate-limit-reset`, `x-rate-limit-remaining` and `Retry-After`. Endpoint access and purchased quotas depend on the account; configurable application budgets below are local safeguards, not claims about an X plan.

## Source and ruling behavior

Extract whole alphanumeric tokens from the mention and its single replied-to/quoted parent, ignoring URLs and handles. Filter for 32-byte base58 public keys, then use shared `parseCas`/`validateCas` to require 2–10 distinct keys. Unrelated long prose and malformed tokens are ignored, and valid substrings are never salvaged. On-chain mint validity remains the ingest provider's responsibility.

A unique expanded/unwound HTTP(S) link is a source candidate after excluding trading sites, local/IP URLs and the bot's own site. Multiple competing links are ambiguous. A foreign parent without contract-like tokens can itself be a candidate; parent traversal is limited to one level. No author, ticker or username is used to infer a subject. Every candidate goes through the shared pipeline/source authority checks; the bot never confirms manual overrides.

When there is no unambiguous candidate, `/resolve` receives the valid CAs, rulebook version and the parent/mention URL as **explicitly unverified context**. The reply asks for the original source. This avoids the web page's missing-`source_url` error without asserting that the author is the subject. This path does not construct a runtime or require database/Helius settings. `NeedsResolutionError` produces a candidate-source review link too. Actual infrastructure errors are deferred/failed jobs, not invented source decisions.

Persisted rulings get the shared PNG and `/ruling/:share_slug`. Reply wording distinguishes `resolved`, `unresolved`, `separate_memes` and `no_winner`; incomplete evidence is never advertised as a definitive winner. Text uses one link and no copied user text/handles/cashtags. Long `/resolve` query URLs rely on X's normal URL shortening for post-length accounting.

## Persistence, delivery and recovery

Run **one worker against one persistent, local POSIX volume**. Atomic same-directory rename plus file/directory fsync are required; do not use ephemeral container storage, NFS, or a shared/multi-replica deployment. All processes for this account must share this state path; a different path cannot detect another worker. State files contain public mention text, reply plans and temporary base64 cards; treat them as private operational data. Defaults are under ignored `apps/bot/var/`; when overriding the path, keep it outside tracked files.

The exclusive `.lock` records PID/host/start time. A duplicate worker fails before making API requests. Clean shutdown releases it. A crash or uncertain state-write failure leaves it in place: verify the recorded process is dead on that host, preserve state, then remove only that specific lock. Locks are never automatically stolen (PID reuse and shared hosts make that unsafe). Checksummed state rejects corruption instead of resetting dedupe. Back up state while stopped; restoring an older backup can lose receipts, so reconcile any posts since that backup before restarting.

Each scan freezes `since_id` and a clock-derived `until_id`. A page's inbox and next token are atomically committed together. The high-water cursor advances only after all pages finish; page limits defer remaining pages to the next tick. Failed/expired tokens retain the same bounds and inbox; a rejected token restarts that scan with dedupe. New mentions beyond the upper bound wait for the next scan. X's available timeline history is finite: long downtime/high traffic can exceed retention; the worker cannot reconstruct posts the API no longer returns. Keep the host clock synchronized.

Outbox transitions: `queued → pending → submitted → sent`. `pending` contains the exact reply/card and survives restart without rerunning the pipeline. `submitted` is fsynced **before** the non-idempotent reply request. A connection failure, timeout, abort, 5xx, or missing success ID leaves `submitted` for operator reconciliation and is never automatically reposted. This intentionally prefers a possibly missed reply over a duplicate; X does not offer a usable idempotency key here. An explicit 429 rejection returns to `pending` after reset; other explicit 4xx replies fail. Media uploads/read operations have bounded retries; a repeated media upload may leave an unused asset, but cannot duplicate a reply.

While stopped, inspect the bot's actual X replies and the state, then use the same mode/path settings:

```sh
# Mark a submitted mention sent ONLY after independently verifying its actual reply ID.
BOT_SEND=true pnpm --filter @pvp/bot start --ack-post MENTION_ID VERIFIED_REPLY_ID
# Resolve an uncertain submission without ever reposting it.
BOT_SEND=true pnpm --filter @pvp/bot start --abandon MENTION_ID
# Optional: back up first, then remove only sent/skipped/dry_run records at/below committed cursor.
BOT_SEND=true pnpm --filter @pvp/bot start --prune-terminal
```

These maintenance commands are local, acquire the same lock, preserve account/mode/cursor/quotas, and make no X calls. They still validate configuration. Failed and submitted records are retained by pruning. There is deliberately no automatic/manual blind-retry command. `failed` jobs keep a sanitized reason and are not advertised as delivered. Storage capacity exhaustion stops ingestion before advancing a page; raise the capacity or prune reviewed completed entries.

SIGINT/SIGTERM aborts polling, HTTP requests and waits, then closes the lazily created runtime and state. Abort during a reply remains `submitted`. The shared pipeline has no cancellation parameter: a preparation deadline fails that job without posting; shutdown allows outstanding work to settle until `BOT_SHUTDOWN_MS`, then exits with its lock retained for inspection. Logs contain controlled event names, status diagnostics and numeric mention IDs, never tokens, headers, provider bodies, source URLs or raw exception strings.

## Environment contract for the parent

| Variable | Default / requirement |
| --- | --- |
| `X_USER_ACCESS_TOKEN` | Required OAuth 2.0 user token, even in dry-run (reads X). |
| `BOT_PUBLIC_BASE_URL` | Required public HTTPS web origin; local HTTP allowed only in dry-run. |
| `BOT_USERNAME` | `pvpreferee`; verified against `/users/me`. |
| `BOT_SEND` | `false`; exactly `true` opts into uploads/replies. |
| `BOT_STATE_PATH` | `./var/dry-run.json` or `./var/send.json`, relative to `apps/bot` under package scripts. Use absolute persistent path in deployment. |
| `BOT_SINCE_ID` | Optional initial exclusive mention cursor; used only for a new state file. |
| `BOT_RULEBOOK_VERSION` | `v1`; must be in `listRulebooks()`. |
| `BOT_POLL_MS` | `60000`. |
| `BOT_HTTP_TIMEOUT_MS` | `15000` per request including body read. |
| `BOT_HTTP_RETRIES` | `3` additional read/media attempts; range 0–10. Non-idempotent replies never retry inside HTTP. |
| `BOT_BACKOFF_MS` / `BOT_MAX_BACKOFF_MS` | `1000` / `60000`; exponential retry delay. Provider reset deadlines are not shortened by this cap. |
| `BOT_REQUEST_INTERVAL_MS` | `1000` minimum between HTTP requests. |
| `BOT_PIPELINE_TIMEOUT_MS` | `120000` preparation deadline (includes card). |
| `BOT_SHUTDOWN_MS` | `30000` maximum shutdown grace. |
| `BOT_PAGE_SIZE` | `100`; range 5–100. |
| `BOT_PAGES_PER_TICK` / `BOT_JOBS_PER_TICK` | `10` / `20`; each range 1–100. |
| `BOT_MAX_STORED_MENTIONS` | `100000`; hard stop before discarding history. |
| `BOT_JOB_ATTEMPTS` | `3`; bounded preparation/upload attempts, excluding 429 waits. |
| `BOT_QUOTA_WINDOW_MS` | `86400000`; persisted rolling reply-attempt window. |
| `BOT_REPLY_QUOTA` / `BOT_AUTHOR_QUOTA` | `100` / `3` attempts per window overall/per requesting author. Ambiguous/rejected attempts conservatively consume quota. |
| `BOT_REPLY_INTERVAL_MS` | `60000` minimum between reply submissions. |

Pipeline-only settings: `DATABASE_URL` plus `HELIUS_API_KEY` **or** `HELIUS_RPC_URL` are required only when preparing a candidate-source ruling. Source lookups may require `X_BEARER_TOKEN`, `YOUTUBE_API_KEY`, and the existing `SOURCE_AUTHORITIES` authority registry/reviewed meme records. Ingest also exposes `BIRDEYE_API_KEY`, `INGEST_TIMEOUT_MS`, `PUMP_API_BASE_URL`, and `BIRDEYE_API_BASE_URL`; the worker passes the supplied environment through unchanged. It neither reads credentials from elsewhere nor invents missing provider results.

Current shared ingest composition uses an unavailable historical ledger unless an implementation is injected. This worker cannot claim live historical snapshots or reliable live winners from that composition. Embedders can inject `BotRuntime`/`RuntimeFactory` (e.g. compose `createRuntime({env, ledger})`), `XApi`/HTTP `Transport`, `Clock`, and the card renderer. These are explicit seams, not synthetic production fallbacks. Saved X fixtures in `src/fixtures/x.synthetic.json` and all test-generated replies/facts are labeled synthetic. Default root tests deny fetch, sockets and DNS; no test here bypasses that guard or loads real credentials.
