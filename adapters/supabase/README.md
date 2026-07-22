# Supabase managed profile

NodeKit is Convex-first, not Convex-locked. This directory maps the portable
Caseflow contract onto Supabase's managed PostgreSQL features without turning
Supabase mechanics into NodeKit semantics.

## Installation

1. Apply `../postgres/001_caseflow.sql`.
2. Create a **private** Storage bucket named `nodekit-artifacts` through the
   Storage API or Dashboard. Do not insert into `storage.buckets` directly.
3. Apply `001_profile.sql`.
4. Add the `nodekit` schema to the Data API's exposed schemas when browser reads
   are required. RLS and authenticated-only `SELECT` grants remain authoritative.
5. Apply `002_workers.sql` only when the application's capability plan requires
   durable jobs or schedules.

Published package paths:

```text
@homenshum/nodekit/adapters/postgres/migration.sql
@homenshum/nodekit/adapters/supabase/profile.sql
@homenshum/nodekit/adapters/supabase/workers.sql
```

## Security boundary

`001_profile.sql` gives browser clients owner-scoped reads and refuses direct
lifecycle DML. `public.nodekit_apply_proposal` is a narrow `SECURITY INVOKER`
RPC. It delegates to a non-exposed `SECURITY DEFINER` function that derives the
owner from `auth.uid()` and supplies server time. The artifact digest is fixed
on the protected proposal when it is created. Owner, time, and next-artifact
hash are therefore never accepted as client authority. The underlying portable functions are revoked from browser
roles. Additional lifecycle RPCs must use the same pattern or remain trusted
server-only wrappers.

Storage policies restrict the private bucket to `<auth.uid()>/...`. The SQL
only creates policies; object and bucket operations still go through the
Storage API because Supabase documents Storage metadata as read-only.

The core reactive baseline is RLS-filtered Postgres Changes for the nine
Caseflow tables. Supabase recommends Broadcast for higher-scale workloads;
Broadcast and Presence are application-level accelerators, not prerequisites
for portable Caseflow correctness.

`002_workers.sql` enables `pgmq` and `pg_cron`, creates one durable
`nodekit_jobs` queue, and keeps it server-only. It intentionally does not expose
`pgmq_public`, grant queue access to end-user JWT roles, or schedule a fake job.
Applications declare their bounded worker and schedule separately.

The core SQL can be executed against a disposable local PostgreSQL database
with Supabase-compatible Auth/Storage stubs. This proves SQL execution, owner
RLS, denied direct DML, the principal-derived proposal RPC, and Storage folder
isolation without claiming a managed-service pass:

```bash
NODEKIT_SUPABASE_LOCAL_URL=postgresql://... npm run conformance:supabase-local
```

Official references:

- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage schema](https://supabase.com/docs/guides/storage/schema/design)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Realtime database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Queues](https://supabase.com/docs/guides/queues/quickstart)
- [Cron](https://supabase.com/docs/guides/cron)

## Evidence boundary

The checked-in SQL and deterministic tests prove the intended local contract,
not a deployed service. A live claim still requires a provisioned Supabase
project, two authenticated owners, real Storage bytes, Realtime delivery,
server-only queue consumption, a bounded Cron invocation, and deployment-bound
receipts. Until then the Supabase live-conformance gate remains open.
