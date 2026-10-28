# Shared ruling pipeline

Both web and bot use `createPipeline`. Provider interfaces come from the phase-0 shared contracts. `run` requires a confirmed source; ambiguity throws NeedsResolutionError. `runResolved` accepts a trusted confirmed MemeRecord and must only be called after the application's admin gate for edited source fields. It fetches coin facts, reconstructs exact rival-time snapshots with bounded concurrency, evaluates the frozen rules, and persists a new immutable ruling. Tests inject providers; production adapters never fabricate evidence.

`parseCas` / `validateCas` validate actual 32-byte base58 addresses, not just string length. The rules engine itself accepts synthetic fixture identifiers.
