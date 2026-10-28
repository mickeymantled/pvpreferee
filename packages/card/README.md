# @pvp/card

Shared Node.js renderer for the web server and bot worker. The only public API is:

```ts
import { renderRulingCard } from '@pvp/card';
import type { Ruling } from '@pvp/shared';

const png: Buffer = await renderRulingCard(ruling as Ruling);
```

It consumes the immutable ruling without re-running rules, modifying facts, fetching evidence, or interpreting display-only flags. Satori produces an SVG with outlined text, then `@resvg/resvg-js` rasterizes a 1200x675 PNG on its async native worker. Every render disables system font loading. No transport is needed: the renderer never fetches images, fonts, URLs, or chain data.

## Integration

Use a Node.js route handler, server action, or worker. In a Next route, declare `export const runtime = 'nodejs'`. Send `new Uint8Array(png)` as a response body with `Content-Type: image/png`; clients only need the image URL. The browser conditional export contains an actionable throwing stub with no native renderer, font or brand asset imports. This is not an Edge-runtime package.

For this source-exporting workspace package, merge the following into the **web owner's** Next config:

```js
{
  transpilePackages: ['@pvp/card'],
  serverExternalPackages: ['@resvg/resvg-js'],
  // Use the absolute monorepo root when the app root is apps/web:
  outputFileTracingRoot: monorepoRoot,
}
```

Keep the other packages/settings already required by the app. Externalizing the native addon prevents the bundler from treating `.node` files as JavaScript. The deployed server needs the resvg binary for its target OS/architecture; install production dependencies for that target, including optional dependencies. Next's [serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) and [output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) documentation cover these settings.

Fonts and the referee logo are imported as static base64 JSON data, so bundlers can inline them and file tracers can include the JSON. There is no `process.cwd()`, runtime `new URL(..., import.meta.url)`, asset-file read, `/_next/static/media` dependency, or asset-path setting to break when the server is relocated. The original WOFFs and JPEG remain in `assets/` for provenance and reproducible regeneration; `pnpm --filter @pvp/card fonts:bundle` and `pnpm --filter @pvp/card brand:bundle` generate the checked-in JSON. The originals need not be read by a deployed server. Satori embeds the logo as a JPEG data URI in the SVG, with no remote image references to resolve.

The offline packaging test traces the actual conditional export, both embedded JSON assets, and installed native binary with `@vercel/nft`. It also verifies the browser graph excludes Satori, resvg and all card assets, and the server trace does not require the original JPEG or bundling scripts. This is a package-level tracing check, **not** a claim that a complete Next production build or Linux deployment has been tested; those belong to web integration.

## Presentation and limits

- Brand, canonical meme name, full winner CA, winner chain, every other candidate's eliminating rule and reason, rulebook version, and a 12-character config-hash prefix are displayed.
- The supplied robotic referee fills a 58x58 black badge at the top left. The square image uses `objectFit: contain` to preserve the full artwork and proportions; only display scaling is applied. The adjacent brand text moves right within the existing header; the divider and all verdict, candidate and footer geometry stay fixed.
- All 2–10 candidates fit. Nine or ten rows use 16px reason text in 26px/24px rows. Smaller sets use 18px reason text with more space. Every text color passes 4.5:1 contrast on the used backgrounds; explicit WINNER/FAIL/OPEN/N/A labels supplement the colors.
- Names, tickers and reasons are measured with the bundled font and ellipsized to one line. The rule number and name lead each failure. The full winner address is never ellipsized. Other addresses show six leading and trailing characters; colliding abbreviations receive their 1-based position in `ruling.coin_cas` (`#1`, `#2`, etc.). Long abbreviated labels can be shortened further to fit, keeping the distinguishing index visible.
- `unresolved`, `separate_memes`, and `no_winner` have distinct status panels. Unresolved survivors stay OPEN; existing eliminations stay FAIL. Separate memes are N/A with no winner or invented ranking.
- The Inter Latin subset supports common Latin text. Unsupported characters, including emoji and CJK, become `?`, with a visible footer notice. Controls/bidi formatting are removed from labels. This is a display fallback only; frozen facts are untouched and the full ruling retains original text.
- The image is a summary. It omits the full evidence URLs, pass/fail grid, thresholds and display-only warnings, which remain in the ruling page. It does not generate a score, infer a verdict, or manufacture live evidence.
- Malformed statuses, missing coin/grid facts, impossible winner/elimination combinations, counts outside 2–10, and non-alphanumeric or over-64-character addresses reject with an actionable error. The address check is a display constraint, not chain address validation.
- Fixed layout, pinned fonts/renderers, and no current clock/random values make repeated same-environment renders byte-identical. Cross-platform PNG byte equality is not claimed; checked snapshots record visible content and Satori geometry instead.

## Verification and samples

```sh
pnpm --filter @pvp/card test
pnpm --filter @pvp/card typecheck
pnpm --filter @pvp/card lint
pnpm --filter @pvp/card samples
```

Tests run under the repository's network/socket/DNS denial setup. There is one structural content/layout snapshot plus a real PNG render for every one of the ten `@pvp/rules/fixtures` exports, using `@pvp/rules` and `@pvp/config`. Snapshots include the badge geometry and logo asset hash without platform-specific golden PNG hashes. Every inspected SVG contains exactly the embedded original JPEG, outlined text, and no unresolved image references. Additional coverage includes all statuses at ten coins, all intermediate counts, long/unsupported text, exact winner addresses, colliding abbreviations, PNG magic and dimensions, repeat/concurrent determinism, mutation protection, ignored image/evidence URLs, markup, contrast, font and logo integrity, and deployment tracing.

Samples are generated in ignored `packages/card/.artifacts/`. All sample data is **synthetic**, not captured on-chain evidence. The script produces all ten fixture PNGs, four `ten-coins-<status>.png` files and `long-text-ten-coins.png`. Useful visual review starting points are `kimchi_qr.png`, `ten-coins-resolved.png`, `ten-coins-unresolved.png`, and `long-text-ten-coins.png`.

## Brand asset provenance

Brian supplied `/Users/brianbaldocchi/Desktop/ref.jpg` on 2026-10-28 as the approved PvP Referee artwork: a black-and-white robotic referee on black, 1408x1408 JPEG. [assets/ref.jpg](assets/ref.jpg) is a byte-for-byte copy. The image has not been generated, repainted, cropped, recompressed, recolored or had its background removed. It is user-supplied project artwork; no separate third-party license was supplied or inferred.

```text
SHA-256: 49bca3cde17a8bc4d5c94ddfec127dc4e7063db27dad5138b946952d21327fb1
```

[scripts/bundle-brand.ts](scripts/bundle-brand.ts) verifies that hash before producing `assets/brand.json`, which records the MIME type, dimensions, hash and lossless base64 encoding of the original file. Regenerate it with `pnpm --filter @pvp/card brand:bundle`. The offline integrity test checks the original hash, exact decoded-byte equality, metadata and deterministic JSON serialization. Only Satori/resvg's normal display scaling changes the pixels in the final 58px badge; the embedded source bytes remain identical.

## Dependencies and licenses

| Component | Pinned version | License / purpose |
| --- | --- | --- |
| [Satori](https://github.com/vercel/satori) | 0.63.2 | MPL-2.0; SVG layout and outlined glyphs |
| [resvg-js](https://github.com/thx/resvg-js) | 2.6.2 | MPL-2.0; native PNG rendering |
| [opentype.js](https://github.com/opentypejs/opentype.js) | 1.3.4 | MIT; deterministic glyph availability and text measurement |
| [Inter](https://github.com/rsms/inter), via `@fontsource/inter` | 5.3.0 asset distribution | SIL OFL 1.1; 400/600 Latin normal WOFFs |
| `@vercel/nft` (dev) | 1.11.0 | MIT; deployment tracing checks |
| `@types/opentype.js` (dev) | 1.3.10 | MIT; font parser types |

Inter copyright: **Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)**. Original fonts are unmodified; encoding into JSON does not alter their bytes. The full supplied license is [assets/OFL.txt](assets/OFL.txt). Provenance: `https://registry.npmjs.org/@fontsource/inter/-/inter-5.3.0.tgz`, paths `package/files/inter-latin-{400,600}-normal.woff`. Integrity tests pin these SHA-256 hashes:

```text
400: e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45
600: 6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd
```

No Sharp dependency is introduced. Satori 0.63.2 and resvg 2.6.2 were the current registry releases at implementation. The root pnpm policy overrides Satori's transitive `fflate` 0.7.3 dependency to patched 0.7.5 for **GHSA-px8p-9vwx-vf98** (malformed ZIP64 handling in `unzipSync`). This renderer accepts no ZIPs or untrusted font bytes and does not call `unzipSync`; the override also removes the vulnerable dependency from the installed graph.
