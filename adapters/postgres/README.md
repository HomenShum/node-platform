# PostgreSQL adapter contract

This directory contains the provider-native persistence contract for a future `@nodekit/adapter-postgres` package. The checked-in SQL establishes portable NodeKit IDs, append-only events, canonical artifact versions, pending proposals, and a conditional proposal-apply function.

`apply_proposal` is the critical semantic boundary: it locks the artifact row, compares the proposal base version to the canonical version, records a conflict when stale, and advances exactly one version when current. Applications must authorize the principal before calling it.

This is a migration and conformance foundation, not evidence of a deployed PostgreSQL adapter.
