create schema if not exists nodekit;

create table if not exists nodekit.cases (
  case_id text primary key,
  owner_id text not null,
  title text not null,
  primary_job text not null,
  status text not null check (status in ('ready', 'in_progress', 'completed')),
  current_run_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists nodekit.runs (
  run_id text primary key,
  owner_id text not null,
  case_id text not null references nodekit.cases(case_id),
  status text not null check (status in ('active', 'blocked', 'cancelled', 'completed', 'failed_safely')),
  current_stage_id text not null,
  next_action text not null,
  next_action_owner text not null,
  stages jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

do $$ begin
  alter table nodekit.cases add constraint nodekit_cases_current_run_fk
    foreign key (current_run_id) references nodekit.runs(run_id);
exception when duplicate_object then null;
end $$;

create table if not exists nodekit.artifacts (
  artifact_id text primary key,
  owner_id text not null,
  case_id text not null references nodekit.cases(case_id),
  run_id text not null references nodekit.runs(run_id),
  kind text not null,
  title text not null,
  canonical_version integer not null check (canonical_version >= 1),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists nodekit.artifact_versions (
  artifact_id text not null references nodekit.artifacts(artifact_id),
  version integer not null check (version >= 1),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  proposal_id text,
  created_at timestamptz not null,
  primary key (artifact_id, version)
);

create table if not exists nodekit.proposals (
  proposal_id text primary key,
  owner_id text not null,
  artifact_id text not null references nodekit.artifacts(artifact_id),
  base_version integer not null check (base_version >= 1),
  patch jsonb not null,
  patch_hash text not null constraint nodekit_proposals_patch_hash_sha256
    check (patch_hash ~ '^[a-f0-9]{64}$'),
  rationale text not null default '',
  status text not null check (status in ('pending', 'accepted', 'rejected', 'conflicted')),
  created_at timestamptz not null,
  decided_at timestamptz
);

create table if not exists nodekit.approvals (
  approval_id text primary key,
  owner_id text not null,
  proposal_id text not null unique references nodekit.proposals(proposal_id),
  decision text not null check (decision in ('accepted', 'rejected')),
  comment text not null default '',
  decided_at timestamptz not null
);

create table if not exists nodekit.exceptions (
  exception_id text primary key,
  owner_id text not null,
  run_id text not null references nodekit.runs(run_id),
  code text not null,
  message text not null,
  preserved_state jsonb not null,
  status text not null check (status in ('open', 'resolved')),
  resolution text,
  raised_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists nodekit.receipts (
  receipt_id text primary key,
  owner_id text not null,
  run_id text not null unique references nodekit.runs(run_id),
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  body jsonb not null,
  generated_at timestamptz not null
);

create table if not exists nodekit.events (
  event_id text primary key,
  owner_id text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  sequence integer not null,
  event_type text not null,
  actor jsonb not null,
  payload jsonb not null,
  idempotency_key text,
  request_hash text,
  result jsonb,
  occurred_at timestamptz not null,
  unique (aggregate_id, sequence)
);

alter table nodekit.events add column if not exists idempotency_key text;
alter table nodekit.events add column if not exists request_hash text;
alter table nodekit.events add column if not exists result jsonb;

-- The proposal owns the digest that will become the canonical artifact digest.
-- PostgreSQL jsonb::text is not NodeKit's portable canonical serialization, so
-- this migration must never invent a digest for a legacy row. A NOT VALID
-- constraint quarantines existing nulls while still rejecting every new null
-- write. Operators explicitly rehash legacy patches through NodeKit's
-- contentHash implementation, then rerun this migration to validate/finalize.
alter table nodekit.proposals add column if not exists patch_hash text;
do $$ begin
  alter table nodekit.proposals add constraint nodekit_proposals_patch_hash_canonical_required
    check (patch_hash is not null and patch_hash ~ '^[a-f0-9]{64}$') not valid;
exception when duplicate_object then null;
end $$;
do $$
declare
  legacy_patch_count bigint;
begin
  select count(*) into legacy_patch_count from nodekit.proposals where patch_hash is null;
  if legacy_patch_count = 0 then
    alter table nodekit.proposals validate constraint nodekit_proposals_patch_hash_canonical_required;
    alter table nodekit.proposals alter column patch_hash set not null;
  else
    raise notice '% legacy NodeKit proposal patch(es) require explicit canonical rehash; proposal decisions remain fail-closed until then', legacy_patch_count;
  end if;
end $$;

create index if not exists nodekit_cases_owner on nodekit.cases(owner_id, created_at);
create index if not exists nodekit_runs_owner_case on nodekit.runs(owner_id, case_id, created_at);
create index if not exists nodekit_artifacts_owner_run on nodekit.artifacts(owner_id, run_id, created_at);
create index if not exists nodekit_proposals_owner_artifact on nodekit.proposals(owner_id, artifact_id, created_at);
create index if not exists nodekit_exceptions_owner_run on nodekit.exceptions(owner_id, run_id, raised_at);
create index if not exists nodekit_events_owner_aggregate on nodekit.events(owner_id, aggregate_id, sequence);
create unique index if not exists nodekit_events_owner_idempotency
  on nodekit.events(owner_id, idempotency_key) where idempotency_key is not null;

-- Remove the legacy overload that accepted a caller-controlled artifact hash.
-- CASCADE removes any old Supabase wrappers; the managed profile recreates only
-- the safe four-argument public RPC after this migration is applied.
drop function if exists nodekit.apply_proposal(text, text, text, text, text, text, timestamptz) cascade;

create or replace function nodekit.apply_proposal(
  requested_owner_id text,
  requested_proposal_id text,
  requested_decision text,
  requested_approval_id text,
  requested_comment text,
  requested_at timestamptz
) returns table(status text, previous_version integer, next_version integer, approval_id text, reused boolean)
language plpgsql
as $$
declare
  proposal_row nodekit.proposals%rowtype;
  artifact_row nodekit.artifacts%rowtype;
  approval_row nodekit.approvals%rowtype;
  artifact_run_status text;
begin
  if requested_decision not in ('accepted', 'rejected') then
    raise exception 'decision must be accepted or rejected';
  end if;

  select * into proposal_row from nodekit.proposals
    where proposal_id = requested_proposal_id and owner_id = requested_owner_id for update;
  if not found then raise exception 'proposal not found: %', requested_proposal_id; end if;
  if proposal_row.patch_hash is null then
    raise exception 'legacy proposal % has no canonical patch hash; run the explicit NodeKit legacy proposal rehash before deciding it', requested_proposal_id
      using errcode = '23514';
  end if;

  select * into artifact_row from nodekit.artifacts
    where artifact_id = proposal_row.artifact_id and owner_id = requested_owner_id for update;
  if not found then raise exception 'artifact not found: %', proposal_row.artifact_id; end if;

  if proposal_row.status <> 'pending' then
    select * into approval_row from nodekit.approvals
      where proposal_id = requested_proposal_id and owner_id = requested_owner_id;
    if not found or approval_row.decision <> requested_decision
      or approval_row.comment <> coalesce(requested_comment, '')
      or not (proposal_row.status = requested_decision or (proposal_row.status = 'conflicted' and requested_decision = 'accepted')) then
      raise exception 'proposal retry does not match original decision request; proposal is already %', proposal_row.status;
    end if;
    return query select proposal_row.status, artifact_row.canonical_version, artifact_row.canonical_version,
      approval_row.approval_id, true;
    return;
  end if;

  select r.status into artifact_run_status from nodekit.runs r
    where r.run_id = artifact_row.run_id and r.owner_id = requested_owner_id for update;
  if not found then raise exception 'run not found: %', artifact_row.run_id; end if;
  if artifact_run_status <> 'active' then
    if artifact_run_status in ('cancelled', 'completed', 'failed_safely') then
      raise exception 'run is terminal: %', artifact_run_status;
    end if;
    raise exception 'run is not active: %', artifact_run_status;
  end if;

  insert into nodekit.approvals (approval_id, owner_id, proposal_id, decision, comment, decided_at)
  values (requested_approval_id, requested_owner_id, requested_proposal_id, requested_decision, coalesce(requested_comment, ''), requested_at);

  if requested_decision = 'rejected' then
    update nodekit.proposals set status = 'rejected', decided_at = requested_at
      where proposal_id = requested_proposal_id;
    return query select 'rejected'::text, artifact_row.canonical_version, artifact_row.canonical_version,
      requested_approval_id, false;
    return;
  end if;

  if proposal_row.base_version <> artifact_row.canonical_version then
    update nodekit.proposals set status = 'conflicted', decided_at = requested_at
      where proposal_id = requested_proposal_id;
    return query select 'conflicted'::text, artifact_row.canonical_version, null::integer,
      requested_approval_id, false;
    return;
  end if;

  insert into nodekit.artifact_versions (artifact_id, version, content, content_hash, proposal_id, created_at)
  values (artifact_row.artifact_id, artifact_row.canonical_version + 1, proposal_row.patch, proposal_row.patch_hash,
    requested_proposal_id, requested_at);
  update nodekit.artifacts set canonical_version = canonical_version + 1, updated_at = requested_at
    where artifact_id = artifact_row.artifact_id;
  update nodekit.proposals set status = 'accepted', decided_at = requested_at
    where proposal_id = requested_proposal_id;
  return query select 'accepted'::text, artifact_row.canonical_version, artifact_row.canonical_version + 1,
    requested_approval_id, false;
end;
$$;
