create schema if not exists nodekit;

create table if not exists nodekit.artifacts (
  artifact_id text primary key,
  case_id text not null,
  run_id text not null,
  kind text not null,
  title text not null,
  canonical_version integer not null check (canonical_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nodekit.artifact_versions (
  artifact_id text not null references nodekit.artifacts(artifact_id),
  version integer not null check (version >= 1),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  proposal_id text,
  created_at timestamptz not null default now(),
  primary key (artifact_id, version)
);

create table if not exists nodekit.proposals (
  proposal_id text primary key,
  artifact_id text not null references nodekit.artifacts(artifact_id),
  base_version integer not null check (base_version >= 1),
  patch jsonb not null,
  rationale text not null default '',
  status text not null check (status in ('pending', 'accepted', 'rejected', 'conflicted')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists nodekit.events (
  event_id text primary key,
  aggregate_type text not null,
  aggregate_id text not null,
  sequence integer not null,
  event_type text not null,
  actor jsonb not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  unique (aggregate_id, sequence)
);

create or replace function nodekit.apply_proposal(
  requested_proposal_id text,
  next_content_hash text,
  decided_by jsonb
) returns table(status text, previous_version integer, next_version integer)
language plpgsql
as $$
declare
  proposal_row nodekit.proposals%rowtype;
  artifact_row nodekit.artifacts%rowtype;
begin
  select * into proposal_row from nodekit.proposals where proposal_id = requested_proposal_id for update;
  if not found then raise exception 'proposal not found: %', requested_proposal_id; end if;
  if proposal_row.status <> 'pending' then raise exception 'proposal is already %', proposal_row.status; end if;

  select * into artifact_row from nodekit.artifacts where artifact_id = proposal_row.artifact_id for update;
  if proposal_row.base_version <> artifact_row.canonical_version then
    update nodekit.proposals set status = 'conflicted', decided_at = now() where proposal_id = requested_proposal_id;
    return query select 'conflicted'::text, artifact_row.canonical_version, null::integer;
    return;
  end if;

  insert into nodekit.artifact_versions (artifact_id, version, content, content_hash, proposal_id)
  values (artifact_row.artifact_id, artifact_row.canonical_version + 1, proposal_row.patch, next_content_hash, requested_proposal_id);
  update nodekit.artifacts set canonical_version = canonical_version + 1, updated_at = now() where artifact_id = artifact_row.artifact_id;
  update nodekit.proposals set status = 'accepted', decided_at = now() where proposal_id = requested_proposal_id;
  return query select 'accepted'::text, artifact_row.canonical_version, artifact_row.canonical_version + 1;
end;
$$;
