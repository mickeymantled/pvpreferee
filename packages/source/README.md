# @pvp/source

Server-side source resolution for PvP Referee, implementing the frozen `SourceProvider` contract. It returns exact supported strings, cited evidence and review reasons. Missing facts are not filled from page titles, token tickers, badges, or market activity. Every saved test record in this package is explicitly **synthetic**; none is a captured API response or a verified claim about DACITY, Tilcayo/Tigrino, or another real dispute.

## Pipeline integration

```ts
import { createSourceFromEnv, hashImageFromUrl, imageDistance } from '@pvp/source';

const source = createSourceFromEnv(); // implements SourceProvider
const resolution = await source.resolve(sourceUrl, config);
// Respect resolution.needs_review and meme.resolved before issuing a ruling.
// A null meme means required name/ticker/scope could not be established.
// Endorsements can still contain independently verified subject CA posts.

const coinImageHash = await hashImageFromUrl(coin.image_url);
const distance = imageDistance(coinImageHash, resolution.meme.source_image_hash);
```

The example's nullable inputs must be checked by the calling pipeline. Image failures throw; preserve the hash as `null` and record the error. Do not replace an unknown hash with zero. `hashImageFromUrl(url, { transport })` accepts an injectable fixture transport. `@pvp/source/image` provides image helpers without loading the HTML parser. Neither importing that subpath nor importing `imageDistance` from the main entrypoint loads native `sharp`; decoding imports it lazily.

`createSourceProvider(options)` exposes `resolve(url, config)`, `resolveMany(urls, config)` and `inspect(url)`. `inspect` returns parsed observations, including unverified candidates, for a review form. Only `resolve`/`resolveMany` decide which observations are usable. Pure parsing helpers `parseSiteHtml`, `parseXPost` and `parseYouTubeVideo` are also exported. Their authority parameters must come from trusted server configuration.

`resolveSource(url, config, options)` and `resolveSources(urls, config, options)` are convenience wrappers. `SourceOptions.relatedSources` maps an exact primary URL to additional URLs for the same meme; otherwise a single `resolve` inspects only the supplied URL. There is no link crawler. At most ten sources are accepted. `pressArticleUrls` supplies up to fifty scoped articles for a canonical-name dispute. There is no automatic search or promise that those articles represent all press coverage.

## Verification and environment

| Variable | Purpose |
| --- | --- |
| `X_BEARER_TOKEN` | X API v2 read access; never sent to supplied source or image hosts |
| `YOUTUBE_API_KEY` | YouTube Data API v3 `videos.list` access |
| `SOURCE_AUTHORITIES` | JSON array of server-maintained source identity attestations |
| `SOURCE_ADMIN_ACTOR` | Single authenticated admin identity used only by manual override service |

A source authority has `{ url, tier, verifiedBy, evidenceUrl, subject? }`. URLs match exactly after ordinary URL parsing and fragment removal. Duplicate bindings are rejected. `subject` has `{ handle, xUserId?, youtubeChannelId? }`. At least one provider account ID is required if a subject is specified. Example **synthetic configuration**:

```json
[
  {
    "url": "https://x.com/synthetic_subject/status/1001",
    "tier": "subject_post",
    "verifiedBy": "synthetic-admin",
    "evidenceUrl": "https://sources.example.com/identity-proof",
    "subject": { "handle": "synthetic_subject", "xUserId": "501" }
  }
]
```

For X, the authenticated API response must match both the pinned author ID and the subject username. A badge is irrelevant. A repost never establishes the subject's own metadata/endorsement. Quote post expansions are not ingested; only the author's own returned text is parsed. For YouTube, the snippet's channel ID must match the configured subject channel. Its title is never used as the canonical name. A website binding attests the exact page as the declared `official_asset`, `site_text`, or `wiki` tier. A site cannot self-assert `subject_post` verification. A redirect needs an authority binding for its final URL.

Automatic resolution of verified, complete metadata **does not require caller admin authentication**. These authority bindings are configuration supplied by a trusted server, not form fields. Unknown identities require review. Discovering/proving real-world identities automatically is not implemented. In production, populate bindings from reviewed identity evidence or provide a trusted upstream provisioning flow. The package does not contain real subject bindings.

`createSourceFromEnv(env?, options?)` can receive a fixture transport and explicit authorities/credentials. Defaults use the current process environment and public transport. Invalid authority configuration fails with a non-secret error. Provider failures become `needs_review` reasons; missing access is never converted to a synthetic API record.

## Extraction, source precedence, and press contract

Explicit line labels are recognized in X text, YouTube descriptions and site body text:

```text
Name: Exact source spelling, including typos
Ticker: EXACT
Scope: artifact
Home chain: bnb
Implied pair: BNB
Source launchpad: specified-pad
CA: <Solana public key>
My wallet: <Solana public key>
Fee claim transaction: <transaction signature>
```

`Canonical name`, `Canonical ticker`, `Meme scope`, `Pair asset`, `Contract address`, `Wallet`, and `Subject wallet` are supported aliases. These labels are a deliberately narrow parser convention, not a claim that providers publish those fields natively. Unsupported natural-language statements require review. Label separators and surrounding whitespace are removed; spelling, case, punctuation and internal whitespace are preserved.

Sites can supply `pvp:canonical_name`, `pvp:canonical_ticker`, `pvp:scope`, `pvp:home_chain`, `pvp:implied_pair`, and `pvp:source_launchpad` meta fields. These are the application's explicit metadata convention. They have authority only when the page itself is trusted. `og:image`/`twitter:image`, X photo attachments, and YouTube thumbnails supply image candidates. HTML titles, OG titles, unsigned handles, scripts, navigation and blockquotes do not establish identity.

The precedence contract is `subject_post > official_asset > site_text > wiki`. The config must publish exactly that order. Each field uses its highest available verified tier; lower-tier disagreements do not replace a higher-tier value. Same-tier conflicting tickers require review. A name conflict uses only names at the highest applicable tier and can be resolved by the press count. Conflicting artifact/concept scopes remain unresolved because they may describe separate memes. No ticker or scope is inferred from a chosen name.

Home chain, implied pair and source launchpad come from trusted explicit fields using the same precedence. With no explicit pair, an **exact**, case-sensitive key in `config.pair.meme_pairs` supplies the published pair (`robotaxi` maps to `TSLA` in v1). Conflicting explicit pairs remain unknown and reviewable; they do not fall back to the map. No generic default is inferred here. Beneficiary wallet/tie timestamps remain null without manual override: page metadata and a wallet mention do not establish a public fee-routing tie or claimability.

`canonicalArticleUrl` defines the citation contract for integration with rules:

1. Require an absolute public HTTP(S) URL and remove its fragment.
2. Remove parameters matching `utm_*`, `fbclid`, `gclid`, `mc_cid`, or `mc_eid`, case-insensitively.
3. Preserve every other parameter and value, including repeated parameters; sort by parameter key.
4. Strip leading `www.` and trailing path slashes except at the root. Preserve path case and HTTP versus HTTPS.

`countPressCandidates` fetches only config-allowlisted publisher domains (including their subdomains), checks the final redirect domain, and reads `article` or `main` text. Off-list input URLs are excluded. A same-host canonical link can supply the citation. Articles are deduplicated by normalized request/final/canonical URL and by exact article text after whitespace normalization, even across publishers. Distinct stories at `?id=one` and `?id=two` remain distinct. Candidate matching is case-sensitive, exact, Unicode-aware whole-string matching. Repeated mentions count once; an article mentioning both candidates counts once for each. Navigation is excluded. Fetch failures make the counts incomplete and block automatic selection. Zero counts or equal leaders remain unresolved.

Returned `meme.press_candidates[].articles` are already canonical and deduplicated. Downstream rules should count the distinct supplied citations using **this same normalization**; dropping all query strings can change the winner. A press tie has `meme: null`, so candidate details are available by calling `countPressCandidates` or inspecting sources, not by inventing required fields in the frozen `MemeRecord`.

## Endorsements

A syntactically valid explicitly labeled CA in a verified subject's own post/video, with the provider's publication timestamp, creates `ca_post`. Unknown supply stays null. The package does not infer that a generic address is a CA rather than a wallet, nor infer supply from text. Provider dates must be valid UTC timestamps.

`inspect().references` exposes wallet and fee-transaction references with their source URL, timestamp and verified-subject state. These references alone do not generate `majority_supply` or `fee_claim`. The optional trusted `verifyChainEvidence(reference, observation)` adapter must return `VerifiedChainEvidence` with the coin, subject wallet, actual transaction, observation timestamp, verifier and optional verified supply percentage. The package checks the reference match and required fields before emitting an endorsement. A wallet attestation requires a positive observed supply, with no arbitrary majority threshold despite the frozen enum name `majority_supply`. Fee claims need not include supply. The callback is never invoked for an unverified subject. There is no bundled chain client in this package; the chain verifier is an explicit integration seam.

## Manual overrides / Wave3 HARDEN

```ts
import { createManualOverrideServiceFromEnv } from '@pvp/source';

const overrides = createManualOverrideServiceFromEnv(async commit => {
  // In one database transaction:
  // 1. Check current record/version equals commit.previous (optimistic concurrency).
  // 2. Persist commit.current and commit.entries atomically.
});

const updated = await overrides.apply(previousMemeOrNull, {
  patch: { canonical_name: 'Exact Nmae', resolved: true },
  reason: 'Verified exact spelling against the cited subject post.',
}, { authenticated: true, actor: validatedServerSession.subject });
```

`createManualOverrideService({ adminActor, persist, clock? })` is the explicit factory. `adminActor` is one fixed server identity. An authenticated caller context is mandatory; the web layer must build it from its verified session and must not accept `authenticated`/`actor` from JSON. Wave3 supplies the sign-in gate, CSRF protection, rate limits, actual database transaction and concurrency check. A failed persistence callback rejects the operation; it never returns success. The callback receives cloned values, and inputs are not mutated.

Each changed field logs `actor`, UTC `at`, `previous`, `value`, and a nonempty `reason`; existing history is preserved. No-op fields create no entry. Only documented editable meme fields are accepted; IDs, creators and audit history cannot be patched. `resolved` itself is audited. Changing the image URL clears the stale image hash unless the patch supplies a new hash, and logs that clearing. Null-base creation requires explicit canonical name, ticker, scope, source URL, tier and cited evidence; optional unknown fields remain null. The service generates only an internal identifier/slug. Set `resolved: true` explicitly after manual review; it is false for newly created records by default.

## Public transport and image limits

`createPublicTransport` uses Node HTTP(S), validates every redirect, resolves every hostname to public-only addresses, and pins a checked address for the socket while preserving hostname/SNI and TLS certificate checks. It rejects credentials in URLs, nonstandard ports, local/private/reserved/translation addresses, mixed public/private DNS answers, redirect loops and HTTPS downgrades. Provider requests disallow redirects; generic cross-origin redirects drop headers. The default deadline is 8 seconds including DNS, body and all hops; response budget is 8 MiB and redirect limit is four. Compressed responses are rejected (identity encoding is requested). Failures are actionable `SourceError`s. Direct `publicUrl` is only a syntactic check; DNS protection lives in the transport.

Injecting `SourceTransport`, DNS lookup, socket exchange, image hashing or on-chain verification replaces a trusted implementation boundary. These are server/test dependencies, never user-supplied functions. The fixture dispatcher has no live fallback. Tests mock the low-level public-transport boundary and never contact a network.

`hashImage` applies EXIF orientation, white alpha flattening, a 32×32 grayscale resize and low-frequency 8×8 DCT thresholding. It returns 16 hexadecimal digits (64 bits, DC bit fixed to zero). Raster signatures/content types are checked; SVG is rejected. Limits: 8 MiB input, 25 million pixels, first animation frame, 5-second native processing timeout. `imageDistance` is Hamming distance and validates both hashes. The synthetic scene stays within v1's distance threshold after recoloring, resize/JPEG compression, or a 2-pixel symmetric crop. Heavy/asymmetric crops, rotation, contrast inversion, overlays and arbitrary recolors are **not** guaranteed to match. Flat colors can collide. This is a heuristic with tested limitations, not a crop-invariant identity proof.

## Verification and remaining capabilities

Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` from the repository root, or `pnpm --filter @pvp/source test`. All default source tests use saved synthetic HTML/JSON, generated synthetic image pixels, or injected transport/DNS responses. Tests include DACITY spelling, Tilcayo/Tigrino press wins and ties, conflicting scope, trusted chain/pair fields, configured pair mapping, unauthorized third-party endorsements, override audit persistence, SSRF, deadlines, image tolerance/failure cases, and lazy native imports.

No live provider validation was performed. X/YouTube require access credentials and supported labeled metadata. This implementation has no natural-language/vision model, OCR/QR recognition, video transcripts, JavaScript page rendering, paywall access, source discovery, chain reconstruction, independent wallet ownership proof, broad press search, or persistent source/override database. Those gaps produce review or require the documented upstream adapters. The DACITY and Tilcayo/Tigrino cases prove behavior for synthetic records, not resolution of real posts that were not supplied.

Official references checked during implementation:

- [X post lookup and expansions](https://docs.x.com/x-api/posts/lookup/quickstart)
- [YouTube videos.list](https://developers.google.com/youtube/v3/videos/list) and [video snippet fields](https://developers.google.com/youtube/v3/videos)
- [Node HTTP request/lookup controls](https://nodejs.org/api/http.html)
- [sharp resize/extract](https://sharp.pixelplumbing.com/api-resize/), [raw output](https://sharp.pixelplumbing.com/api-output/), and [constructor limits](https://sharp.pixelplumbing.com/api-constructor/)
- [ipaddr.js address classification](https://github.com/whitequark/ipaddr.js)
