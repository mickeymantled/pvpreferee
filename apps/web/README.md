# PvP Referee web

Next.js 15 App Router UI. From the repository root run `pnpm dev:web` or `pnpm --filter @pvp/web build` / `start`. Node 22 scripts load `../../.env` with `--env-file-if-exists`; tests never load it. Next 15.5.28 is pinned to the latest 15.x patch reported by npm on 2026-10-28 ([official October advisory](https://nextjs.org/blog/nextjs-security-update-october-14-2026)). React 19.3.1 satisfies Next's React 19 peer range.

## Request flow

- `/` validates 2–10 distinct 32-byte Solana public keys and an HTTP(S) source URL in a server action, then redirects to `/resolve`.
- `/resolve` uses `createSourceFromEnv()` independently of Helius. If a database is configured, a stored audited source override takes precedence. A configured database lookup failure fails closed. Missing or conflicting source facts are shown for review; no ingest occurs.
- The issue action accepts only addresses, source URL, version, and a review fingerprint. It independently resolves the source again, including saved reviews. A changed fingerprint requires another review. The hash detects changes, **not authorization**. Client meme objects, canonical edits, endorsements, actor/auth flags, duplicate fields and unrecognized fields are rejected. Verified endorsements from the server resolution are passed to `pipeline.runResolved` unchanged.
- The pipeline owns fact collection, scoring, and immutable persistence. The action redirects only after persistence succeeds. `/ruling/[slug]` reads the saved payload from the repository, with no re-scoring, provider lookup or Helius requirement.
- `/rulebook` renders the committed live config without provider credentials. Stored rulings display their frozen config instead of loading today's version.
- `/api/card/[slug]` calls the agreed `@pvp/card` export lazily and serves an immutable PNG. Missing rulings return 404; repository/renderer failures return a sanitized, uncacheable 503. The UI handles image failure and still permits permalink sharing. Tests inject a renderer; they never invoke the CARD scaffold.

Database pools/runtime resources are request-scoped and closed in `finally`. There are no connections or credential checks at module import. Root and rulebook are statically renderable. No remote fonts, source images, or demo/live evidence are fetched at build time. The web host pins sharp 0.35.5 and resvg 2.6.2 and explicitly externalizes their native bindings. Native dependencies and the card package's `assets/` and `fonts/` folders are traced for standalone builds; embedded fonts require no runtime file paths. Workspace `.js` import specifiers resolve to TypeScript through webpack's extension aliases.

## HARDEN extension seam

`src/server/overrides.ts` exports `requireAdminForOverride()` and `applyReviewedOverride(previous, request)`. The gate **always throws** in this release, even with `SOURCE_ADMIN_ACTOR` configured. No public override server action exists; the canonical fieldset is disabled. Wave3 must implement the gate using a validated server session and a fixed administrator identity, then add authenticated/CSRF-protected action wiring and concurrency review. The helper calls the source override service and repository's transactional `applyMemeOverride`; never build its auth context or baseline meme from browser input. Existing audited database reviews can already be displayed and used.

## Verification

`pnpm --filter @pvp/web test`, `typecheck`, and `lint` cover inputs, server actions, stale reviews, arbitrary-field rejection, disabled admin seam, provider/repository lifecycle, source override precedence, verified endorsement preservation, safe evidence rendering, all ruling statuses, frozen thresholds, and mocked card responses. Tests use synthetic fixtures and the root network/DNS/socket denial setup. No live source claim or local Postgres smoke row is used.

Warm-cache latency under 15 seconds is a target, not a measurement from this implementation. Source resolution is deliberately repeated at submission, cold reconstruction may take longer, and the upstream ledger/provider capabilities determine whether a complete ruling is possible. Authentication, rate limits, and production credentials belong to later integration work.
