-- NodeKit Supabase managed profile (core).
--
-- Apply adapters/postgres/001_caseflow.sql first. Create a private Storage
-- bucket named `nodekit-artifacts` through the Storage API before applying this
-- file. Storage object bytes must never be provisioned by writing its metadata
-- tables directly.
--
-- NodeKit keeps owner IDs as text so portable exports do not depend on
-- provider-native primary-key types. Supabase derives that authority from
-- auth.uid(); no browser-callable function accepts an owner ID.

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    raise exception 'NodeKit Supabase profile requires Supabase Auth (auth.uid)';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'NodeKit Supabase profile requires Supabase Storage';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'nodekit-artifacts' and public is false
  ) then
    raise exception 'Create the private nodekit-artifacts bucket through the Storage API first';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'NodeKit Supabase profile requires the supabase_realtime publication';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'nodekit' and p.proname = 'apply_proposal'
  ) then
    raise exception 'Apply the NodeKit PostgreSQL Caseflow migration first';
  end if;
end $$;

alter table nodekit.cases enable row level security;
alter table nodekit.runs enable row level security;
alter table nodekit.artifacts enable row level security;
alter table nodekit.artifact_versions enable row level security;
alter table nodekit.proposals enable row level security;
alter table nodekit.approvals enable row level security;
alter table nodekit.exceptions enable row level security;
alter table nodekit.receipts enable row level security;
alter table nodekit.events enable row level security;

-- Browser clients receive owner-scoped reactive reads only. Revoke direct DML
-- even though RLS is enabled: an owner-only write policy would still let a
-- client skip proposal, version, terminal-state, and receipt invariants.
revoke all on schema nodekit from anon, authenticated;
grant usage on schema nodekit to authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema nodekit from anon, authenticated;
grant select on all tables in schema nodekit to authenticated, service_role;

drop policy if exists nodekit_case_owner on nodekit.cases;
create policy nodekit_case_owner on nodekit.cases for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_run_owner on nodekit.runs;
create policy nodekit_run_owner on nodekit.runs for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_artifact_owner on nodekit.artifacts;
create policy nodekit_artifact_owner on nodekit.artifacts for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_artifact_version_owner on nodekit.artifact_versions;
create policy nodekit_artifact_version_owner on nodekit.artifact_versions for select to authenticated
  using (exists (
    select 1 from nodekit.artifacts a
    where a.artifact_id = artifact_versions.artifact_id
      and a.owner_id = (select auth.uid())::text
  ));

drop policy if exists nodekit_proposal_owner on nodekit.proposals;
create policy nodekit_proposal_owner on nodekit.proposals for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_approval_owner on nodekit.approvals;
create policy nodekit_approval_owner on nodekit.approvals for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_exception_owner on nodekit.exceptions;
create policy nodekit_exception_owner on nodekit.exceptions for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_receipt_owner on nodekit.receipts;
create policy nodekit_receipt_owner on nodekit.receipts for select to authenticated
  using (owner_id = (select auth.uid())::text);

drop policy if exists nodekit_event_owner on nodekit.events;
create policy nodekit_event_owner on nodekit.events for select to authenticated
  using (owner_id = (select auth.uid())::text);

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- ambient authority from the portable implementation before exposing the one
-- narrow authenticated RPC below. Trusted server roles may still call the
-- portable functions through a direct database connection.
revoke all on all functions in schema nodekit from public, anon, authenticated;
grant execute on all functions in schema nodekit to service_role;

-- Supabase recommends keeping SECURITY DEFINER functions outside exposed Data
-- API schemas. The private function owns the privilege boundary; the public
-- SECURITY INVOKER wrapper is the only browser-callable mutation in this core
-- profile. Additional lifecycle RPCs must follow the same pattern.
create schema if not exists nodekit_private;
revoke all on schema nodekit_private from public, anon, authenticated;
grant usage on schema nodekit_private to authenticated, service_role;

-- Remove the pre-v1 overloads so a previously deployed profile cannot retain
-- a browser-callable path that accepts a caller-selected artifact hash.
drop function if exists public.nodekit_apply_proposal(text, text, text, text, text);
drop function if exists nodekit_private.apply_proposal_authenticated(text, text, text, text, text);

create or replace function nodekit_private.apply_proposal_authenticated(
  requested_proposal_id text,
  requested_decision text,
  requested_approval_id text,
  requested_comment text
) returns table(
  status text,
  previous_version integer,
  next_version integer,
  approval_id text,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  principal_id uuid := (select auth.uid());
begin
  if principal_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return query
    select applied.status, applied.previous_version, applied.next_version,
      applied.approval_id, applied.reused
    from nodekit.apply_proposal(
      principal_id::text,
      requested_proposal_id,
      requested_decision,
      requested_approval_id,
      coalesce(requested_comment, ''),
      statement_timestamp()
    ) as applied;
end;
$$;

revoke all on function nodekit_private.apply_proposal_authenticated(text, text, text, text)
  from public, anon;
grant execute on function nodekit_private.apply_proposal_authenticated(text, text, text, text)
  to authenticated, service_role;

create or replace function public.nodekit_apply_proposal(
  requested_proposal_id text,
  requested_decision text,
  requested_approval_id text,
  requested_comment text
) returns table(
  status text,
  previous_version integer,
  next_version integer,
  approval_id text,
  reused boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from nodekit_private.apply_proposal_authenticated(
    requested_proposal_id,
    requested_decision,
    requested_approval_id,
    requested_comment
  );
$$;

revoke all on function public.nodekit_apply_proposal(text, text, text, text)
  from public, anon;
grant execute on function public.nodekit_apply_proposal(text, text, text, text)
  to authenticated, service_role;

-- Postgres Changes is the minimal provider-native reactive baseline. The
-- explicit list keeps setup repeatable and avoids publishing unrelated tables.
-- Applications may add Broadcast/Presence without changing Caseflow semantics.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cases', 'runs', 'artifacts', 'artifact_versions', 'proposals',
    'approvals', 'exceptions', 'receipts', 'events'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'nodekit'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table nodekit.%I', table_name);
    end if;
  end loop;
end $$;

-- The bucket itself is created as private through the Storage API. These RLS
-- policies restrict every object operation to `<auth.uid()>/...` in that
-- bucket. They intentionally do not write storage.buckets or storage.objects.
drop policy if exists nodekit_artifacts_select on storage.objects;
create policy nodekit_artifacts_select on storage.objects for select to authenticated
  using (
    bucket_id = 'nodekit-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists nodekit_artifacts_insert on storage.objects;
create policy nodekit_artifacts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nodekit-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists nodekit_artifacts_update on storage.objects;
create policy nodekit_artifacts_update on storage.objects for update to authenticated
  using (
    bucket_id = 'nodekit-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'nodekit-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists nodekit_artifacts_delete on storage.objects;
create policy nodekit_artifacts_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'nodekit-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
