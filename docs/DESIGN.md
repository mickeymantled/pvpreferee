# Visual direction: sleek, evidence-first

Brian requested a sleeker design on 2026-10-28. This replaces the original green-accented marketing layout with a restrained monochrome product interface and matching ruling cards.

## Direction

- Near-black canvas, neutral surfaces, off-white text and hairline dividers. No lime branding, colored verdict slabs, gradients or glow effects.
- Locally bundled Inter, a controlled type scale, small secondary metadata and deliberate whitespace.
- A focused, single-column comparison flow on the home page. The contract/source inputs and one primary action take priority over promotional copy.
- Flat evidence sections and quiet navigation, not a stack of decorative cards. Raw detail can use disclosures, but every rule, reason, source, snapshot, flag, audit and config remains inspectable.
- A white primary action with dark text. Muted green/red/amber are reserved for actual labeled result states, never decorative activity or implied live health.
- The approved robotic-referee JPEG stays unchanged. Its black background fits the interface; there is no generated replacement or image retouching.

## Guardrails

The redesign changes presentation only. Rules, precedence, canonical facts, source trust, input validation, authentication, immutable persistence and failure behavior are unchanged. Do not claim an operation succeeded because a polished screen exists. Missing evidence remains unknown, and synthetic samples remain synthetic.

Keep readable contrast, visible keyboard focus, explicit labels, ≥44px primary controls and a usable layout down to 320px. Rule tables may scroll inside a labeled keyboard-accessible region; the page itself should not overflow. Respect reduced motion. Use local fonts/assets without browser calls to font or image CDNs.

Ruling cards remain 1200 × 675 with every candidate represented, the complete winner CA, eliminating rules/reasons and the rulebook version/hash. Cards are shared by web and bot. The web preview/download renderer revision is `sleek-v1`; stored ruling hashes and the published `v0.1` tag do not change.

## Verification

The separately scoped web and card branches were reviewed and merged. Browser checks covered the desktop home page, 320px/390px layouts, keyboard focus, invalid-address feedback, the source-review transition and honest missing-provider state, the stored synthetic KIMCHI ruling, and the rulebook. The ruling table scrolls within its own labeled region; the page has no horizontal overflow. All evidence, audit, flags, exact configuration and frozen facts remain available.

HTTP checks returned the exact approved logo bytes, both local Inter fonts and a 1200 × 675 PNG from the revised card URL. All ten dispute fixtures and the ten-candidate card samples render offline. These are synthetic test cases, not new on-chain verification. The full suite passes with 448 tests and the same four opt-in live tests skipped.

Frozen-lockfile installation, workspace typechecking, ESLint, Next production build and the full dependency audit also passed; no known vulnerabilities were reported. No new package dependencies or network-loaded fonts were added.

## Follow-up: CA-first comparison

Brian subsequently requested one CA per box and origin research by the app. The home form now starts with two individually labeled address inputs, supports adding/removing up to ten, and has no source-URL field. Automatic research is a functional follow-up, not part of the presentation-only changes above. Preserve the same monochrome visual language; keep research provenance in readable disclosures and optional source hints only as recovery. Never imply that a discovered token link proves the original meme or that unverified research produced a ruling.
