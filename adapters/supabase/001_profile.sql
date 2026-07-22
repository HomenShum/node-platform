-- Apply adapters/postgres/001_caseflow.sql first. NodeKit keeps owner IDs as text so
-- portable exports do not depend on provider-native primary-key types. Supabase
-- wrappers must pass auth.uid()::text as the owner authority.

alter table nodekit.cases enable row level security;
alter table nodekit.runs enable row level security;
alter table nodekit.artifacts enable row level security;
alter table nodekit.artifact_versions enable row level security;
alter table nodekit.proposals enable row level security;
alter table nodekit.approvals enable row level security;
alter table nodekit.exceptions enable row level security;
alter table nodekit.receipts enable row level security;
alter table nodekit.events enable row level security;

drop policy if exists nodekit_case_owner on nodekit.cases;
create policy nodekit_case_owner on nodekit.cases
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_run_owner on nodekit.runs;
create policy nodekit_run_owner on nodekit.runs
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_artifact_owner on nodekit.artifacts;
create policy nodekit_artifact_owner on nodekit.artifacts
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_artifact_version_owner on nodekit.artifact_versions;
create policy nodekit_artifact_version_owner on nodekit.artifact_versions
  using (exists (
    select 1 from nodekit.artifacts a
    where a.artifact_id = artifact_versions.artifact_id and a.owner_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from nodekit.artifacts a
    where a.artifact_id = artifact_versions.artifact_id and a.owner_id = auth.uid()::text
  ));

drop policy if exists nodekit_proposal_owner on nodekit.proposals;
create policy nodekit_proposal_owner on nodekit.proposals
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_approval_owner on nodekit.approvals;
create policy nodekit_approval_owner on nodekit.approvals
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_exception_owner on nodekit.exceptions;
create policy nodekit_exception_owner on nodekit.exceptions
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_receipt_owner on nodekit.receipts;
create policy nodekit_receipt_owner on nodekit.receipts
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists nodekit_event_owner on nodekit.events;
create policy nodekit_event_owner on nodekit.events
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

-- Realtime publication is provider-native and intentionally explicit. The DO
-- blocks make repeated local/profile setup idempotent.
do $$
declare table_name text;
begin
  foreach table_name in array array['cases', 'runs', 'artifacts', 'proposals', 'approvals', 'exceptions', 'receipts']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'nodekit' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table nodekit.%I', table_name);
    end if;
  end loop;
end $$;
