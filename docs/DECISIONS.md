# Implementation decisions

These choices fill gaps in the supplied plan; they do not amend the rule order or settled decisions.

- 2026-10-28: Install the supplied build plan as root AGENTS.md with numbered sections because the remote and workspace were empty; the user's orchestrated waves supersede its older one-task-at-a-time instructions.
- 2026-10-28: Use all nine named fixture rows (plus variants), despite prose saying eight, because each dispute is a required acceptance case.
- 2026-10-28: Initial numeric config defaults are 3 distinct buyers within 300 seconds, $100 cap above launch, and 64-bit perceptual hash Hamming distance <=10; the spec settles their meaning but supplies no numbers. These are published, hashed v1 parameters, not empirically calibrated claims.
- 2026-10-28: Initial press allowlist is reuters.com, apnews.com, bbc.com, theguardian.com, cnn.com; count distinct cited article URLs only and preserve ties as unresolved, because the spec supplies no source list.
- 2026-10-28: Unknown evidence stays null/unresolved and adapters fail explicitly on incomplete historical coverage; never silently substitute current prices for historical prices.
- 2026-10-28: No real fixture contract addresses are provided; offline fixtures use explicit synthetic identifiers and live verification requires user-supplied CAs in environment variables.
- 2026-10-28: Store frozen raw facts, override audit, and config payloads in JSON columns on the specified five tables rather than add tables, preserving the data model while making replay and audit possible.
