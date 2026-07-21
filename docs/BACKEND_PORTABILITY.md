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

`runCaseflowConformance()` is the executable behavioral boundary. Provider-specific optimizations are additive and cannot weaken it.

## Capability negotiation

Adapters disclose transactions, optimistic concurrency, subscription mode, durable-job mode, file storage, presence, and provider identity. NodeKit uses a native implementation, a documented fallback, or fails clearly. It does not silently claim equivalent behavior.

Shared UI consumes normalized NodeKit view models. It must not import Convex hooks, Supabase clients, or database row/document types.

## Authority

Each deployment has one authoritative backend for cases, runs, canonical artifact versions, proposals, approvals, exceptions, and receipts. Other systems may be tools, sources, indexes, analytics stores, or migration targets, but NodeKit does not introduce active-active writes across authorities.
