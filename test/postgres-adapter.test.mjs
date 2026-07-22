import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createPostgresCaseflow } from "@homenshum/nodekit/adapters/postgres";

test("PostgreSQL adapter is available through the supported package entry point", () => {
  assert.equal(typeof createPostgresCaseflow, "function");
  assert.throws(() => createPostgresCaseflow(), /query-capable pool/);
  assert.throws(() => createPostgresCaseflow({ pool: { query() {} } }), /ownerId/);
});

test("PostgreSQL migration defines the complete owner-scoped Caseflow record set", async () => {
  const sql = await readFile(path.resolve("adapters/postgres/001_caseflow.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`create table if not exists nodekit\\.${table}`));
  }
  assert.match(sql, /owner_id text not null/);
  assert.match(sql, /create or replace function nodekit\.apply_proposal/);
  assert.match(sql, /proposal_row\.base_version <> artifact_row\.canonical_version/);
  assert.match(sql, /approval_row\.decision <> requested_decision/);
});

test("Supabase profile extends the complete portable record set with owner RLS", async () => {
  const sql = await readFile(path.resolve("adapters/supabase/001_profile.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`alter table nodekit\\.${table} enable row level security`));
  }
  assert.match(sql, /owner_id = auth\.uid\(\)::text/);
  assert.match(sql, /pg_publication_tables/);
});
