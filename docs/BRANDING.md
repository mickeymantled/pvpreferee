# PvP Referee branding

The approved mark is the black-and-white robotic referee supplied by Brian on 2026-10-28 as `ref.jpg`. It replaces the temporary arrow/stripe brand marks. The previously supplied watermarked human-referee image was explicitly rejected by Brian and is not included.

The approved source is a 1408 × 1408 JPEG with SHA-256:

```text
49bca3cde17a8bc4d5c94ddfec127dc4e7063db27dad5138b946952d21327fb1
```

Preserve the supplied artwork and its proportions. No generated reinterpretation, background removal, recoloring or bitmap retouching is part of this integration. The black background is intentional. The subsequent [sleek redesign](DESIGN.md) uses neutral black/white interactions; muted colors are reserved for actual result states.

The web app serves a versioned local copy for the header and browser icon. The shared card renderer embeds the same JPEG bytes so both web and bot cards work without fetching remote branding or resolving runtime asset paths. Asset-integrity tests pin the approved bytes; changing the logo requires an intentional update to the source, embedding and tests.

Card preview and download URLs introduced the renderer revision `referee-logo-v1` with the logo; the subsequent monochrome redesign advances it to `sleek-v1`. This prevents previously cached images from hiding presentation updates. These are presentation revisions only: no rulebook, stored evidence, shared data contract, ruling hash or verdict changes. Previously downloaded/shared images remain unchanged. Keep the published `v0.1` tag fixed; branding is a subsequent code revision.

Original branding verification: 444 offline tests passed, with the same four opt-in live tests skipped. The original-file hash matches both checked-in JPEG copies and the decoded card embedding. Browser review confirmed the header and a branded card served through the web route; HTTP checks confirmed favicon metadata, exact asset bytes, revised card URLs, 1200 × 675 PNG output and immutable cache headers. All ten dispute fixtures and ten-candidate card layouts retain their evidence and verdict content. The sample cards contain synthetic test data, not verified on-chain claims. The subsequent redesign verification is recorded in [DESIGN.md](DESIGN.md).
