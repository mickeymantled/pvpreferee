# Implementation decisions

These choices fill gaps in the supplied plan; they do not amend the rule order or settled decisions.

- 2026-10-28: Install the supplied build plan as root AGENTS.md with numbered sections because the remote and workspace were empty; the user's orchestrated waves supersede its older one-task-at-a-time instructions.
- 2026-10-28: Use all nine named fixture rows (plus variants), despite prose saying eight, because each dispute is a required acceptance case.
- 2026-10-28: Initial numeric config defaults are 3 distinct buyers within 300 seconds, $100 cap above launch, and 64-bit perceptual hash Hamming distance <=10; the spec settles their meaning but supplies no numbers. These are published, hashed v1 parameters, not empirically calibrated claims.
- 2026-10-28: Initial press allowlist is reuters.com, apnews.com, bbc.com, theguardian.com, cnn.com; count distinct cited article URLs only and preserve ties as unresolved, because the spec supplies no source list.
- 2026-10-28: Unknown evidence stays null/unresolved and adapters fail explicitly on incomplete historical coverage; never silently substitute current prices for historical prices.
- 2026-10-28: No real fixture contract addresses are provided; offline fixtures use explicit synthetic identifiers and live verification requires user-supplied CAs in environment variables.
- 2026-10-28: Store frozen raw facts, override audit, and config payloads in JSON columns on the specified five tables rather than add tables, preserving the data model while making replay and audit possible.
- 2026-10-28: Represent immutable observations using `(ca,facts_hash)` coin versions and `(coin_ca,at,config_hash)` snapshot keys inside the same five domain tables, so config changes and later observations cannot overwrite past evidence.
- 2026-10-28: Define first_real_buy_at at the threshold-crossing buy in the trailing inclusive buyer window; this avoids backdating participation using future buyers.
- 2026-10-28: Compare separate meme assignments before issuing any comparative verdict; separate memes have no winner or elimination ranking.
- 2026-10-28: A sole verified subject endorsement needs no supply percentage; multiple endorsed coins require known comparable holdings. Unspecified ties remain unresolved.
- 2026-10-28: Process participation chronologically so an eliminated vamp cannot eliminate a later entrant; later activity cannot revive a previously eliminated coin.
- 2026-10-28: Require reviewed source-authority bindings and explicit supported metadata for automatic resolution; unknown identities and unsupported natural-language extraction go to the admin review path.
- 2026-10-28: Press counts use cited, allowlisted, deduplicated articles and retain meaningful query parameters; no complete press census is claimed.
- 2026-10-28: Keep the production mint-wide historical ledger and chain endorsement verification behind injectable interfaces, because the available address-history APIs do not establish complete mint-wide coverage and no verified fixture CAs or credentials were supplied.
- 2026-10-28: Store manual source review independently of a ruling, including creation when no canonical meme could be resolved, so missing ingest does not block the admin workflow.
- 2026-10-28: Use patched Drizzle 0.45.4 and sharp 0.35.5, and the address-only official Solana package instead of the legacy Web3 RPC stack; the production dependency audit identified vulnerabilities in the initial versions.
- 2026-10-28: Bundle licensed Inter font data locally for deterministic offline cards; unsupported glyphs are visibly marked and full original text remains in the ruling. Override vulnerable transitive fflate and PostCSS versions to patched compatible releases.
- 2026-10-28: Upgrade the test runner to patched Vitest 4.1.12 after the full development-dependency audit identified worker and mock-server advisories; retain the same offline tests and snapshots, which pass unchanged.
- 2026-10-28: Default the bot to a separate dry-run state; require explicit send opt-in and a public HTTPS origin. Persist an outbox marker before posting and hold ambiguous submissions for operator reconciliation because X has no usable reply idempotency key.
- 2026-10-28: Use a single-worker atomic POSIX state file for bot cursors, quotas and delivery receipts, preserving the five-table domain model; multi-replica delivery is out of scope.
- 2026-10-28: Use a single configured administrator, scrypt password hashes, signed eight-hour secure sessions, strict origin checks and audited source review. Deterministic URL-derived IDs prevent concurrent first-time manual review from creating duplicate records through this UI.
- 2026-10-28: Require an atomic shared Redis REST counter in production and fail expensive requests closed if it is unavailable; unsigned client identity uses a safe global bucket instead of trusting arbitrary forwarding headers.
- 2026-10-28: Keep v1 published unchanged and make the config registry append-only. A synthetic v2 proves coexistence in tests without publishing an unapproved policy.
- 2026-10-28: Reruns preserve original snapshot envelopes inside explicit historical derivations and never rewrite observed cache entries. Buyer-count/window changes require fresh ingest because they can change first-real-buy and rival snapshot instants.
- 2026-10-28: Leave trending-provider discovery behind an explicit unsupported adapter until its ranking is verified. Warming targets one whole-second checkpoint for up to 50 mints and verifies Postgres cache persistence; it does not claim to prewarm arbitrary rival instants.
- 2026-10-28: Use Brian's approved robotic-referee JPEG unchanged for web and card branding; embed it locally for offline rendering and version card image URLs so pre-logo caches cannot hide the update. Ruling facts/config and the published v0.1 tag remain unchanged.
- 2026-10-28: Brian requested a very sleek design; adopt a monochrome, typography-led interface and matching cards with a focused comparison flow, local fonts and fewer decorative panels. Retain the approved artwork, every evidence surface and all behavior; bump the presentation cache revision to sleek-v1.
