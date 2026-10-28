# PvP Referee

A published, versioned referee for competing memecoin contracts. Every ruling includes a per-rule evidence grid and frozen facts. It never produces a trading score. The rulebook and fixture acceptance cases are in [AGENTS.md](AGENTS.md).

v0.1 is a tested pre-production implementation. Live historical acceptance is not complete: the production historical-ledger and chain-verification adapters, real fixture addresses and deployment credentials are still required. Missing evidence remains unknown; see the release limits in [STATUS.md](docs/STATUS.md).

## Development

Requires Node.js 22.13+, pnpm 11.3.0, and Postgres. Install with `pnpm install`. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` for offline verification. Live integrations are opt-in and require credentials and actual fixture addresses.

For a local database, run `docker compose up -d postgres` and use `postgres://pvp:pvp-local-only@localhost:5432/pvpreferee` as DATABASE_URL. Copy `.env.example` to `.env` and fill the required values. Never use the local database password in a hosted environment.

See [docs/STATUS.md](docs/STATUS.md) for implemented features, external integration limitations, environment variables, and exact run commands. See [docs/runbook.md](docs/runbook.md) for operations and [docs/DECISIONS.md](docs/DECISIONS.md) for implementation choices omitted from the brief.

The approved robotic-referee logo and its presentation-only integration are documented in [docs/BRANDING.md](docs/BRANDING.md).

## Workspace

- `packages/shared`: frozen TypeScript data contracts.
- `config`: validated, content-hashed rulebook versions.
- `packages/rules`: pure rules and explicitly synthetic dispute fixtures.
- `packages/ingest`: provider adapters, historical snapshots, and immutable Postgres storage.
- `packages/source`: cited source resolution, endorsement detection, image comparison, and audited overrides.
- `packages/pipeline`: the evidence-freezing workflow shared by web and bot.
- `packages/card`: deterministic Satori ruling images.
- `apps/web`: Next.js web app.
- `apps/bot`: X mention worker.

All test fixtures are labeled synthetic unless an explicitly captured provider fixture says otherwise. Passing fixture tests is not a claim that historical on-chain acceptance cases have been independently verified.
