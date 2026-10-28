# Contributing

Use a branch named `agent/<scope>` in a separate checkout. Each agent edits only the paths assigned by the orchestrator. Commit your work and report the commit SHA, files, tests, and limitations; the orchestrator reviews and merges it. Never merge another agent's branch yourself.

Read the assigned AGENTS.md sections, the frozen `packages/shared/src/index.ts` contract, and the config. Do not change packages/shared without sending the orchestrator an explicit proposed contract change; all dependents must be updated together. Ask the orchestrator about ambiguities, not the user. Keep the rulebook and data model fixed.

Every package ships with meaningful offline Vitest tests that pass in CI. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. No network in default tests. Saved fixtures are labeled synthetic unless they are captured source data. Integration tests require `RUN_INTEGRATION=1` and explicit credentials/CAs. Missing data is unknown, never zero, fabricated evidence, or a guessed ruling.

Use TypeScript strict, explicit interfaces for providers, timeouts, and actionable errors. Never commit secrets or node_modules. Add package dependencies only to your owned package manifest; the orchestrator regenerates the root lockfile after merging. Use apply_patch for file edits.
