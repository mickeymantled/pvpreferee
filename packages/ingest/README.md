# @pvp/ingest

Read-only provider adapters, strict historical replay, and PostgreSQL persistence for PvP Referee. All shared phase-0 interfaces are unchanged. Default tests use explicitly synthetic saved fixtures and no network.

## Pipeline entry points

```ts
import { createIngestFromEnv, createRulingRepository } from '@pvp/ingest';

const ingest = createIngestFromEnv();
const coin = await ingest.coinFacts(ca, config);
const snapshot = await ingest.snapshotAt(ca, rival.first_real_buy_at, config);
const repository = createRulingRepository(databaseUrl);
await repository.save(ruling);
const saved = await repository.findBySlug(slug);
await ingest.close();
await repository.close();
```

These factories do not connect or migrate on construction. `createIngestFromEnv()` implements the frozen `IngestProvider`; `createRulingRepository(url)` implements `RulingRepository` plus `applyMemeOverride(previous, current)` and `close()`. Run the migration explicitly before using persistence:

```sh
DATABASE_URL=... pnpm --filter @pvp/ingest db:migrate
```

`migrateIngest(url)` runs `migrations/0001_ingest.sql` atomically under an advisory lock. It records its version in a table comment, creates exactly five tables, and rejects an existing unrecognized/partial schema. It does not create an extra migration-history table. Use this migration rather than schema-push: SQL includes immutability and audit triggers that are not expressed in the Drizzle column definitions.

## What works live and what remains unknown

| Evidence | Adapter behavior |
| --- | --- |
| Helius DAS + finalized RPC | Token name, ticker, image URL and mint/freeze authorities. Missing authority keys are errors, never inferred revocation. Current supply/price are retained raw but never used for history. |
| Helius `getTransactionsForAddress` | `addressHistoryPage` exposes full transactions, cursor and bounded time filter for indexer implementers. It explicitly returns `mint_wide_complete: false`. An owner filter covers accounts owned by that address, not every holder of a mint. |
| Pump public `coins-v2/{mint}` | Creator record and retained raw payload. Record mint and bonding curve must match. HTTP errors are explicit. |
| Pump finalized bonding curve | Program ownership, discriminator and documented Borsh layout establish launchpad, quote mint, completion state and current creator fee recipient. SOL/USDC are mapped by known quote addresses. Custom quote symbols require an explicit verified map as the final `PumpFunAdapter` constructor argument; otherwise `pair_asset` is null. |
| Birdeye `historical_price_unix` | Uses `updateUnixTime`, `value`, raw unit mode and Solana headers. Missing data, nearby/future prices, scaled UI tokens and subsecond requests fail closed. A matching historical checkpoint is usable. |
| Complete mint history | **Not supplied by the built-in APIs.** Inject a complete `HistoricalLedger` indexer. Default `first_real_buy_at` and historical cap stay null; `snapshotAt` returns `complete: false` and null historical fields with a diagnostic. |

No production complete-ledger provider is implemented, and the integration tests do not pretend to prove historical reconstruction. No real acceptance CAs or credentials were supplied. Pump HTTP creation timestamp is retained without guessing its unit; deployment and bonding timestamps require historical events. A currently complete curve does not establish *when* it completed. Migrated-pool verification, fee-sharing beneficiaries/claimability, source ties/endorsements, image hashing, display flags and non-Solana ingest are not implemented here. Source-dependent fields stay null/empty. A custom pair is not classified by an unverified ticker. No current holder count, price, supply or later market cap is substituted for history.

## Historical ledger contract and replay

`HistoricalLedger.page(ca, through, cursor)` returns `LedgerPage`. Each page must provide the same `LedgerCoverage` attestation for **that mint and exact UTC instant**, with finality, coverage from mint initialization, all token accounts (including closed and non-associated accounts), every balance/supply change and classified trade, no gaps, and no unsupported token extensions. The trusted indexer is responsible for substantiating that attestation with source evidence; setting flags is not an independent proof of coverage. Failed transactions must be excluded. Helius address pages alone cannot meet this contract.

Events use decimal-string atomic amounts and explicit `(slot, transaction_index, event_index)` order. Initialization supplies historical decimals. Supply deltas record mint/burn; balance events record an account's absolute post-event amount and owner (including owner changes). Close events require zero balances. Trade events require the actual buyer/seller, classified side and nonzero token/quote amounts; transfers and airdrops are not buys. A transaction can span pages; reconciliation occurs after complete transaction groups. Unsupported extensions such as confidential transfers or withheld/unaccounted fees must make the indexer refuse completeness.

`replayLedger` consumes all cursor pages, rejects repeated cursors/duplicate events/ambiguous order/contradictory certificates, excludes events after T, and reconciles total account balances to historical minted supply at transaction boundaries. It aggregates positive balances by owner: multiple accounts owned by the same wallet count once. Pool/program-owned balances count as holders; no unapproved exclusion heuristic is introduced. Distinct buyers are lifetime buyers through T, even if they later sell/burn. Last trade counts buys and sells, not transfers. Atomic arithmetic uses `bigint`; only final USD valuation uses the shared numeric field.

`firstRealBuyAt(events, config, through)` is the **threshold-crossing buy**, when distinct buyers in the trailing inclusive config window first reach the minimum. It does not backdate to the first buyer of that window. The window is used to establish this timestamp only; there is no PvP grace/post-rival window. Market cap is not part of this timestamp definition; the rules engine applies the cap-above-launch test separately. Supply and price at launch are independently reconstructed for `launch_mcap_usd`.

Inject dependencies for a real complete-ledger deployment:

```ts
const ingest = createIngestFromEnv({ ledger: completeMintIndexer });
// Or new IngestService({ metadata, launch, ledger, prices, cache, now }).
```

`Transport` is injectable for HTTP/RPC tests. The built-in fetch transport enforces a timeout, rejects redirects, and omits credential-bearing URLs and response bodies from errors. There is no automatic retry storm; callers may back off on provider errors.

## Exact cache and immutable evidence

Snapshots are keyed by `(coin_ca, at, config_hash)`; timestamps normalize to UTC milliseconds and the hash is SHA-256 of shared `canonicalJson(config)`. Only complete snapshots are cached. No nearest-time lookup or negative permanent cache is used. Config changes produce independent entries. Concurrent fetches with equal historical values retain the first stored raw envelope and return that canonical stored payload; a change in historical values raises `IMMUTABLE_CONFLICT`.

`IngestedCoinFacts` and `ReconstructedSnapshot` extend the shared shapes **inside this package only**, adding `raw_ingest` JSON with provider payloads, observed times, historical supply/price or explicit diagnostics. Preserve these extensions through pipeline cloning/spreading and hashing. `save` serializes the entire ruling, frozen facts and config, including these extensions and snapshots; it never refetches evidence. API keys and request headers are not included. The facts/config hashes must match the shared canonical serialization. The ordered `coin_cas` must match frozen `facts.coins`.

Five tables: `memes`, `coins`, `snapshots`, `endorsements`, `rulings`. `coins` uses **composite `(ca, facts_hash)` immutable observed versions**, with config included in the version hash; it is not one mutable latest row per CA. Ruling JSON preserves the selected coin and meme versions. `separate_memes` rulings may include cross-meme coin facts; the indexed coin `meme_id` is null for an unstored external meme while the original value remains in `raw_facts` and the ruling. Cross-meme facts in other statuses are rejected.

PostgreSQL triggers reject UPDATE, DELETE and TRUNCATE on coin facts, snapshots, endorsements and rulings. Inserts with existing ruling IDs/slugs are idempotent only for identical content; conflicts roll back the entire save. Database owners/superusers can still alter schema or disable triggers; these protections are for ordinary application writes, not privileged operator tampering.

## Standalone source override review

```ts
await repository.applyMemeOverride(previousMeme, reviewedMeme);
```

This works before any ingest or ruling exists. It creates the initial resolver meme if absent, locks the row, requires its complete JSON to equal `previousMeme`, then applies the new version. Every changed field needs a matching appended `{field, previous, value, actor, at, reason}` audit entry. A stale review fails with `IMMUTABLE_CONFLICT`; reload before retrying. Indexed columns must match audited JSON. SQL triggers prohibit editing/removing earlier audit entries and deleting/truncating memes. Old rulings keep their original source version. Saving an older ruling never rolls back the current meme.

**The caller must authenticate and authorize Brian before calling this helper.** The persistence layer records the supplied actor and enforces concurrency/audit integrity; it does not implement sign-in or trust an actor string as authentication. No additional audit table is created.

## Environment for the parent package

| Variable | Purpose |
| --- | --- |
| `HELIUS_API_KEY` or `HELIUS_RPC_URL` | Required for the env factory; full RPC URL takes precedence. |
| `BIRDEYE_API_KEY` | Required when historical valuation is attempted. |
| `DATABASE_URL` | Optional env snapshot cache; explicit repository/migration URL otherwise. |
| `INGEST_TIMEOUT_MS` | Optional positive request timeout, default 10000. |
| `PUMP_API_BASE_URL` | Optional server endpoint override; default `https://frontend-api-v3.pump.fun`. |
| `BIRDEYE_API_BASE_URL` | Optional override; default `https://public-api.birdeye.so`. |
| `RUN_INTEGRATION` | Exactly `1` enables live tests. |
| `FIXTURE_KIMCHI_CA`, `FIXTURE_SOLCAT_CA`, `FIXTURE_ROBOTAXI_CA` | Must be supplied explicitly for integration. Intentionally no defaults or similarly named substitutes. |

Default `pnpm test`, `pnpm typecheck`, `pnpm lint` cover saved synthetic ledger/API transports and offline PGlite PostgreSQL semantics, including real SQL migration/triggers, frozen raw round trips, separate memes, audit concurrency and exact cache behavior. Local PostgreSQL daemon verification is separately expected during parent integration. PGlite is dev-only. The Solana dependency's optional `bufferutil`/`utf-8-validate` native accelerators are unnecessary for these read-only adapters; where pnpm 11 blocks their unapproved builds, use `pnpm --config.strict-dep-builds=false install --ignore-scripts` without granting new build permissions. Parent regenerates the root lockfile; only this package is committed.

## Official provider references checked 2026-10-28

- [Helius DAS getAsset](https://www.helius.dev/docs/api-reference/das/getasset)
- [Helius address history and owner-token-account filter](https://www.helius.dev/docs/rpc/gettransactionsforaddress)
- [Solana getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo)
- [Pump's public coin-data endpoint example](https://github.com/pump-fun/pump-fun-skills/blob/main/create-coin/SKILL.md#get-coin-data-http) (consulted as provider documentation, not executed as a skill)
- [Pump program account layout](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md), [official IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json), [creator-fee semantics](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_CREATOR_FEE_README.md)
- [Birdeye historical Unix checkpoint](https://data.birdeye.so/docs/data-api/price-ohlcv/get-defi-historical-price-unix.md) (the response schema describes `updateUnixTime` as the matched nearby record; exact equality is enforced here)

Public exports: env/provider factories; `IngestService`; `HeliusAdapter`, `PumpFunAdapter`, `BirdeyeHistoricalPrice`; `FetchTransport`, `JsonRpcClient`; `HistoricalLedger` and all package-local contracts; `replayLedger`, `firstRealBuyAt`, `historicalCap`, `UnavailableHistoricalLedger`; `DrizzleRulingRepository`, `PostgresSnapshotCache`, `createPostgresSnapshotCache`; `schema`; `migrateIngest`; `IngestError`; `decodePumpCurve`, `PUMP_PROGRAM`.
