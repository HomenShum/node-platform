-- Existing rows must be explicitly backfilled by an application-owned migration before
-- owner_id is made NOT NULL. Never infer ownership for legacy rows.
alter table nodekit.artifacts add column if not exists owner_id uuid;
alter table nodekit.proposals add column if not exists owner_id uuid;

alter table nodekit.artifacts enable row level security;
alter table nodekit.proposals enable row level security;
alter table nodekit.artifact_versions enable row level security;

create policy nodekit_artifact_owner on nodekit.artifacts
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy nodekit_proposal_owner on nodekit.proposals
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy nodekit_artifact_version_owner on nodekit.artifact_versions
  using (exists (select 1 from nodekit.artifacts a where a.artifact_id = artifact_versions.artifact_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from nodekit.artifacts a where a.artifact_id = artifact_versions.artifact_id and a.owner_id = auth.uid()));

-- Realtime publication is provider-native and intentionally explicit.
alter publication supabase_realtime add table nodekit.artifacts;
alter publication supabase_realtime add table nodekit.proposals;
