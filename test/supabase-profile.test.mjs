import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("Supabase core profile keeps browser lifecycle access read-only and owner-scoped", async () => {
  const sql = await read("adapters/supabase/001_profile.sql");
  const tables = [
    "cases", "runs", "artifacts", "artifact_versions", "proposals",
    "approvals", "exceptions", "receipts", "events",
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table nodekit\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`'${table}'`), `${table} must be in the explicit Realtime set`);
  }

  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger\s+on all tables in schema nodekit from anon, authenticated/);
  assert.match(sql, /grant select on all tables in schema nodekit to authenticated, service_role/);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /\(select auth\.uid\(\)\)::text/);
  assert.doesNotMatch(sql, /create policy nodekit_\w+_owner[^;]*for (insert|update|delete)/);
});

test("Supabase mutation RPC derives authority, time, and artifact hash instead of accepting them", async () => {
  const sql = await read("adapters/supabase/001_profile.sql");
  const publicRpc = sql.slice(sql.indexOf("create or replace function public.nodekit_apply_proposal"));
  const publicSignature = publicRpc.slice(0, publicRpc.indexOf(") returns table"));
  const privateRpc = sql.slice(
    sql.indexOf("create or replace function nodekit_private.apply_proposal_authenticated"),
    sql.indexOf("revoke all on function nodekit_private.apply_proposal_authenticated"),
  );

  assert.match(sql, /revoke all on all functions in schema nodekit from public, anon, authenticated/);
  assert.match(privateRpc, /security definer\s+set search_path = ''/);
  assert.match(privateRpc, /principal_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(privateRpc, /statement_timestamp\(\)/);
  assert.doesNotMatch(privateRpc.slice(0, privateRpc.indexOf(") returns table")), /owner/i);
  assert.doesNotMatch(privateRpc.slice(0, privateRpc.indexOf(") returns table")), /requested_at/i);
  assert.doesNotMatch(privateRpc.slice(0, privateRpc.indexOf(") returns table")), /hash/i);
  assert.match(publicRpc, /security invoker\s+set search_path = ''/);
  assert.doesNotMatch(publicSignature, /owner/i);
  assert.doesNotMatch(publicSignature, /requested_at/i);
  assert.doesNotMatch(publicSignature, /hash/i);
  assert.doesNotMatch(publicRpc, /next_content_hash/);
  assert.match(sql, /drop function if exists public\.nodekit_apply_proposal\(text, text, text, text, text\)/);
  assert.match(sql, /grant execute on function public\.nodekit_apply_proposal\(text, text, text, text\)\s+to authenticated, service_role/);
});

test("Supabase local proof rejects the obsolete caller-controlled hash overload", async () => {
  const source = await read("scripts/run-supabase-local-conformance.mjs");

  assert.match(source, /expectUndefinedFunction/);
  assert.match(source, /callerControlledArtifactHashRejected: true/);
  assert.match(source, /storedProposalHashApplied: true/);
  assert.match(source, /assert\.equal\(appliedVersion\.rows\[0\]\?\.content_hash, proposalPatchHash\)/);
  assert.match(source, /assert\.notEqual\(appliedVersion\.rows\[0\]\?\.content_hash, attackerSelectedHash\)/);
});

test("Supabase Storage policy is private-owner-folder scoped and never mutates metadata", async () => {
  const sql = await read("adapters/supabase/001_profile.sql");

  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`create policy nodekit_artifacts_${operation} on storage\\.objects for ${operation} to authenticated`));
  }
  assert.match(sql, /bucket_id = 'nodekit-artifacts'/);
  assert.match(sql, /from storage\.buckets\s+where id = 'nodekit-artifacts' and public is false/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.doesNotMatch(sql, /insert\s+into\s+storage\./i);
  assert.doesNotMatch(sql, /update\s+storage\./i);
  assert.doesNotMatch(sql, /delete\s+from\s+storage\./i);
  assert.doesNotMatch(sql, /alter\s+table\s+storage\./i);
});

test("Supabase worker module is opt-in, durable, server-only, and schedule-neutral", async () => {
  const sql = await read("adapters/supabase/002_workers.sql");
  const packageJson = JSON.parse(await read("package.json"));

  assert.match(sql, /create extension if not exists pgmq/);
  assert.match(sql, /create extension if not exists pg_cron/);
  assert.match(sql, /perform pgmq\.create\('nodekit_jobs'\)/);
  assert.match(sql, /revoke all on schema pgmq from public, anon, authenticated/);
  assert.match(sql, /grant execute on all functions in schema pgmq to service_role/);
  assert.match(sql, /revoke all on schema cron from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create\s+schema[^;]*pgmq_public|grant[^;]*pgmq_public/i);
  assert.doesNotMatch(sql, /cron\.schedule\s*\(/i);
  assert.equal(
    packageJson.exports["./adapters/supabase/workers.sql"],
    "./adapters/supabase/002_workers.sql",
  );
  assert.equal(
    packageJson.scripts["conformance:supabase-local"],
    "node scripts/run-supabase-local-conformance.mjs",
  );
});
