create schema if not exists nodekit;

create table if not exists nodekit.knowledge_projections (
  owner_id text not null,
  graph_id text not null,
  graph_version integer not null check (graph_version >= 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  graph_document jsonb not null,
  updated_at timestamptz not null,
  primary key (owner_id, graph_id)
);

create table if not exists nodekit.knowledge_sessions (
  owner_id text not null,
  graph_id text not null,
  session_id text not null,
  last_sequence integer not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null,
  primary key (owner_id, graph_id, session_id),
  foreign key (owner_id, graph_id)
    references nodekit.knowledge_projections(owner_id, graph_id) on delete cascade
);

create table if not exists nodekit.knowledge_retrieval_receipts (
  owner_id text not null,
  graph_id text not null,
  session_id text not null,
  sequence integer not null check (sequence >= 1),
  receipt_id text not null,
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null,
  occurred_at timestamptz not null,
  primary key (owner_id, graph_id, session_id, sequence),
  unique (owner_id, receipt_id),
  foreign key (owner_id, graph_id, session_id)
    references nodekit.knowledge_sessions(owner_id, graph_id, session_id) on delete cascade
);

create index if not exists nodekit_knowledge_projection_version
  on nodekit.knowledge_projections(owner_id, graph_id, graph_version);
create index if not exists nodekit_knowledge_receipts_session
  on nodekit.knowledge_retrieval_receipts(owner_id, graph_id, session_id, sequence);

-- The adapter performs projection CAS under SELECT ... FOR UPDATE and advances
-- one version per transaction. Every primary/foreign key begins with owner_id,
-- making accidental cross-owner joins fail closed at the storage boundary.
