# PostgreSQL adapter contract

This directory contains the provider-native persistence contract used by NodeKit's exported
PostgreSQL adapter surface. The checked-in SQL establishes portable NodeKit IDs, append-only events,
canonical artifact versions, pending proposals, and a conditional proposal-apply function. A later
standalone `@nodekit/adapter-postgres` package may extract this surface without changing the contract.

`apply_proposal` is the critical semantic boundary: it locks the artifact row, compares the proposal base version to the canonical version, records a conflict when stale, and advances exactly one version when current. The canonical content digest is stored with the protected proposal at creation and reused during apply; apply accepts no caller-selected next-artifact hash. Applications must authorize the principal before calling it.

## Legacy proposal digest upgrade

`jsonb::text` is not NodeKit's canonical portable serialization. The migration
therefore never derives `patch_hash` in SQL. If it encounters proposals created
before digests were stored, it leaves those rows quarantined with a null hash,
installs a `NOT VALID` constraint that rejects new null writes, and makes
`apply_proposal` fail closed for the affected rows.

An authorized operator must explicitly rehash each owner through NodeKit:

```js
import { rehashLegacyPostgresProposalPatches } from "@homenshum/nodekit/adapters/postgres";

let result;
do {
  result = await rehashLegacyPostgresProposalPatches({
    pool,
    ownerId: "the-authorized-owner-id",
    batchSize: 100,
  });
} while (!result.complete);
```

Repeat for every owner with legacy proposals, then rerun `001_caseflow.sql`.
Only when no null digest remains does the migration validate the canonical hash
constraint and promote `patch_hash` to `NOT NULL`. If a legacy patch is outside
NodeKit's portable value boundary, the entire batch rolls back for manual repair.

This is a migration and conformance foundation, not evidence of a deployed PostgreSQL adapter.
