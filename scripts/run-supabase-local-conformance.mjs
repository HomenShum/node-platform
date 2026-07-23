#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { contentHash } from "../src/lib/caseflow.mjs";

const connectionString = process.env.NODEKIT_SUPABASE_LOCAL_URL;
if (!connectionString) {
  throw new Error(
    "NODEKIT_SUPABASE_LOCAL_URL is required and must point to a disposable local PostgreSQL database",
  );
}

const { Client } = pg;
const client = new Client({ connectionString });
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

async function expectDenied(sql, params = []) {
  await client.query("savepoint expected_denial");
  try {
    await client.query(sql, params);
    assert.fail(`expected database operation to be denied: ${sql}`);
  } catch (error) {
    assert.match(String(error?.code ?? ""), /42501|P0001/);
  } finally {
    await client.query("rollback to savepoint expected_denial");
    await client.query("release savepoint expected_denial");
  }
}

async function expectUndefinedFunction(sql, params = []) {
  await client.query("savepoint expected_undefined_function");
  try {
    await client.query(sql, params);
    assert.fail(`expected obsolete function signature to be absent: ${sql}`);
  } catch (error) {
    assert.equal(String(error?.code ?? ""), "42883");
  } finally {
    await client.query("rollback to savepoint expected_undefined_function");
    await client.query("release savepoint expected_undefined_function");
  }
}

try {
  await client.connect();
  await client.query("begin");
  await client.query(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable
      set search_path = ''
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      public boolean not null default false
    );
    create table if not exists storage.objects (
      id bigint generated always as identity primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    insert into storage.buckets (id, public) values ('nodekit-artifacts', false)
      on conflict (id) do update set public = excluded.public;
    grant usage on schema storage to authenticated, service_role;
    grant select, insert, update, delete on storage.objects to authenticated, service_role;
    grant usage, select on sequence storage.objects_id_seq to authenticated, service_role;
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable
      set search_path = ''
      as $$ select regexp_split_to_array(name, '/') $$;

    do $$ begin
      create publication supabase_realtime;
    exception when duplicate_object then null;
    end $$;
  `);

  const migration = await readFile(path.resolve("adapters/postgres/001_caseflow.sql"), "utf8");
  const profile = await readFile(path.resolve("adapters/supabase/001_profile.sql"), "utf8");
  await client.query(migration);
  await client.query(profile);

  const now = new Date("2026-07-22T00:00:00.000Z");
  const stages = JSON.stringify([{ id: "work", label: "Work", owner: "agent" }]);
  for (const [ownerId, suffix] of [[ownerA, "a"], [ownerB, "b"]]) {
    await client.query(
      `insert into nodekit.cases
        (case_id, owner_id, title, primary_job, status, current_run_id, created_at, updated_at)
       values ($1, $2, $3, 'prove portability', 'in_progress', null, $4, $4)`,
      [`case_${suffix}`, ownerId, `Case ${suffix.toUpperCase()}`, now],
    );
    await client.query(
      `insert into nodekit.runs
        (run_id, owner_id, case_id, status, current_stage_id, next_action, next_action_owner, stages, created_at, updated_at)
       values ($1, $2, $3, 'active', 'work', 'Review', 'user', $4::jsonb, $5, $5)`,
      [`run_${suffix}`, ownerId, `case_${suffix}`, stages, now],
    );
    await client.query(
      "update nodekit.cases set current_run_id = $1 where case_id = $2",
      [`run_${suffix}`, `case_${suffix}`],
    );
  }

  await client.query(
    `insert into nodekit.artifacts
      (artifact_id, owner_id, case_id, run_id, kind, title, canonical_version, created_at, updated_at)
     values ('artifact_a', $1, 'case_a', 'run_a', 'document', 'Result', 1, $2, $2)`,
    [ownerA, now],
  );
  await client.query(
    `insert into nodekit.artifact_versions
      (artifact_id, version, content, content_hash, proposal_id, created_at)
     values ('artifact_a', 1, '{"version":1}', $1, null, $2)`,
    ["a".repeat(64), now],
  );
  const proposalPatch = { version: 2 };
  const proposalPatchHash = contentHash(proposalPatch);
  await client.query(
    `insert into nodekit.proposals
      (proposal_id, owner_id, artifact_id, base_version, patch, patch_hash, rationale, status, created_at)
     values ('proposal_a', $1, 'artifact_a', 1, $2::jsonb, $3, 'Improve result', 'pending', $4)`,
    [ownerA, JSON.stringify(proposalPatch), proposalPatchHash, now],
  );

  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerA]);

  const visibleCases = await client.query("select case_id from nodekit.cases order by case_id");
  assert.deepEqual(visibleCases.rows.map((row) => row.case_id), ["case_a"]);

  await expectDenied(
    `insert into nodekit.cases
      (case_id, owner_id, title, primary_job, status, created_at, updated_at)
     values ('case_direct', $1, 'Direct', 'bypass lifecycle', 'ready', $2, $2)`,
    [ownerA, now],
  );

  const attackerSelectedHash = "b".repeat(64);
  await expectUndefinedFunction(
    "select * from public.nodekit_apply_proposal($1, $2, $3, $4, $5)",
    ["proposal_a", "accepted", "approval_tamper", "Approved", attackerSelectedHash],
  );

  const applied = await client.query(
    "select * from public.nodekit_apply_proposal($1, $2, $3, $4)",
    ["proposal_a", "accepted", "approval_a", "Approved"],
  );
  assert.equal(applied.rows[0]?.status, "accepted");
  assert.equal(applied.rows[0]?.previous_version, 1);
  assert.equal(applied.rows[0]?.next_version, 2);
  const appliedVersion = await client.query(
    `select content, content_hash from nodekit.artifact_versions
      where artifact_id = 'artifact_a' and version = 2`,
  );
  assert.deepEqual(appliedVersion.rows[0]?.content, proposalPatch);
  assert.equal(appliedVersion.rows[0]?.content_hash, proposalPatchHash);
  assert.notEqual(appliedVersion.rows[0]?.content_hash, attackerSelectedHash);

  await client.query(
    "insert into storage.objects (bucket_id, name) values ('nodekit-artifacts', $1)",
    [`${ownerA}/receipt.json`],
  );
  await expectDenied(
    "insert into storage.objects (bucket_id, name) values ('nodekit-artifacts', $1)",
    [`${ownerB}/stolen.json`],
  );

  const visibleObjects = await client.query("select name from storage.objects order by name");
  assert.deepEqual(visibleObjects.rows.map((row) => row.name), [`${ownerA}/receipt.json`]);

  process.stdout.write(`${JSON.stringify({
    checks: {
      authenticatedRpc: true,
      callerControlledArtifactHashRejected: true,
      directLifecycleDmlDenied: true,
      ownerScopedReads: true,
      ownerScopedStorage: true,
      profileApplied: true,
      storedProposalHashApplied: true,
    },
    liveSupabaseConformance: false,
    passed: true,
    schemaVersion: "nodekit.supabase-local-contract/v1",
  }, null, 2)}\n`);
} finally {
  try {
    await client.query("reset role");
    await client.query("rollback");
  } catch {
    // The disposable database may already have closed after a setup failure.
  }
  await client.end().catch(() => {});
}
