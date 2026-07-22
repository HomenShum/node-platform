# NodeKit backend portability

NodeKit is Convex-first, not Convex-locked. The application experience and lifecycle remain stable while one authoritative transactional backend implements them.

## Portable semantics

```text
Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
```

Every adapter must preserve:

- NodeKit-owned public IDs;
- proposal-before-mutation;
- canonical artifact versions;
- stale-proposal conflict instead of overwrite;
- explicit next-action ownership;
- safe exception recovery;
- one terminal run state;
- portable, content-addressed receipts;
- a normalized event envelope.

Mechanics remain provider-native. Memory uses in-process compare-and-swap. Convex should use transactional mutations and reactive queries. PostgreSQL should use transactions and conditional updates. Supabase should build on PostgreSQL plus its managed Auth, Storage, Realtime, queue, and function capabilities.

The checked-in Supabase mapping is split intentionally. The core profile grants
authenticated owner reads, derives mutation authority from `auth.uid()`, applies
private-bucket Storage policies, and publishes the Caseflow tables to Postgres
Changes. The opt-in worker profile enables server-only PGMQ and pg_cron only for
applications whose capability plans require them. Neither file is live-provider
evidence; authenticated multi-owner conformance remains a separate gate.

`runCaseflowConformance()` is the executable behavioral boundary. Provider-specific optimizations are additive and cannot weaken it.

PostgreSQL proposal hashes always use NodeKit's provider-neutral `contentHash`.
The SQL migration never hashes `jsonb::text`: legacy null hashes are quarantined,
cannot be applied, and require an explicit owner-scoped rehash through
`rehashLegacyPostgresProposalPatches()`. This keeps migration success from
silently manufacturing a provider-specific digest. Live PostgreSQL conformance
also requires the exact distributable path set from `package.json` to be clean;
that includes the packaged Evolution Ledger, even though ordinary non-packaged
proof and documentation files are not part of the source candidate.

## Portable value boundary

Caseflow content, patches, preserved exception state, actors, and event payloads
use one conservative intersection that all supported adapters can represent.
`normalizePortableValue()` accepts JSON primitives, dense arrays, and plain
objects, normalizes negative zero, and rejects representation drift before
hashing or storage. Object keys must be Convex-compatible ASCII identifiers;
`__proto__`, NUL, unpaired surrogates, accessors, exotic prototypes, and
non-JSON values fail closed. User-authored artifact content, proposal patches,
and preserved exception state are limited to 12 nesting levels. This reserves
three levels for Caseflow result/event envelopes and one level for Convex's
document root, staying within Convex's 16-level document limit. Internal
portable envelopes are capped at 15 levels. The remaining shared limits are
8,192 array items, 1,024 object fields, 1,024 characters per key, and 768 KiB
of encoded user value. Larger payloads and arbitrary-key formats belong in the
artifact/file layer and enter Caseflow by content-addressed reference. Both
the provider-neutral conformance suite and the real Convex component test
exercise the exact accepted payload boundary and reject one additional level.

## Capability negotiation

Adapters disclose transactions, optimistic concurrency, subscription mode, durable-job mode, file storage, presence, and provider identity. NodeKit uses a native implementation, a documented fallback, or fails clearly. It does not silently claim equivalent behavior.

Shared UI consumes normalized NodeKit view models. It must not import Convex hooks, Supabase clients, or database row/document types.

## Authority

Each deployment has one authoritative backend for cases, runs, canonical artifact versions, proposals, approvals, exceptions, and receipts. Other systems may be tools, sources, indexes, analytics stores, or migration targets, but NodeKit does not introduce active-active writes across authorities.
