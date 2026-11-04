# Usage

Phase 3 introduces the tenant-scoped UsageRecord ledger. The AI processor writes one row per attempt before calling the provider, reserves token/cost budgets, and settles known usage. Ambiguous/crashed calls retain UNKNOWN outcome/cost and conservative reservations. Mock calls are explicitly marked with zero external cost. Aggregate usage endpoints/UI remain Phase 9.
