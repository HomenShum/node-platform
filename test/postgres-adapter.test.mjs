import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createPostgresCaseflow,
  rehashLegacyPostgresProposalPatches,
} from "@homenshum/nodekit/adapters/postgres";
import { contentHash } from "@homenshum/nodekit/caseflow";

test("PostgreSQL adapter is available through the supported package entry point", () => {
  assert.equal(typeof createPostgresCaseflow, "function");
  assert.equal(typeof rehashLegacyPostgresProposalPatches, "function");
  assert.throws(() => createPostgresCaseflow(), /query-capable pool/);
  assert.throws(() => createPostgresCaseflow({ pool: { query() {} } }), /ownerId/);
  assert.throws(() => rehashLegacyPostgresProposalPatches(), /query-capable pool/);
  assert.throws(
    () => rehashLegacyPostgresProposalPatches({ pool: { query() {} }, ownerId: "owner", batchSize: 0 }),
    /batchSize must be an integer from 1 through 1000/,
  );
});

test("PostgreSQL legacy proposal rehash uses NodeKit canonical contentHash in an atomic owner batch", async () => {
  const patch = { z: [3, 2, 1], a: { stable: true } };
  const calls = [];
  let released = false;
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text === "begin" || text === "commit" || text === "rollback") return { rowCount: null, rows: [] };
      if (text.includes("select proposal_id, patch")) {
        return { rowCount: 1, rows: [{ patch, proposal_id: "proposal_legacy" }] };
      }
      if (text.includes("update nodekit.proposals set patch_hash")) {
        return { rowCount: 1, rows: [{ proposal_id: "proposal_legacy" }] };
      }
      if (text.includes("count(*)::integer as remaining")) {
        return { rowCount: 1, rows: [{ remaining: 0 }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { released = true; },
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rowCount: 0, rows: [] }; },
  };

  const result = await rehashLegacyPostgresProposalPatches({
    batchSize: 25,
    ownerId: "owner_legacy",
    pool,
  });

  assert.deepEqual(result, {
    complete: true,
    ownerId: "owner_legacy",
    rehashed: [{ patchHash: contentHash(patch), proposalId: "proposal_legacy" }],
    remaining: 0,
    schemaVersion: "nodekit.postgres-legacy-patch-rehash/v1",
  });
  const select = calls.find((entry) => entry.text.includes("select proposal_id, patch"));
  assert.deepEqual(select.values, ["owner_legacy", 25]);
  assert.match(select.text, /patch_hash is null/);
  assert.match(select.text, /for update skip locked/);
  const update = calls.find((entry) => entry.text.includes("update nodekit.proposals set patch_hash"));
  assert.deepEqual(update.values, [contentHash(patch), "owner_legacy", "proposal_legacy"]);
  assert.equal(calls.at(-1).text, "commit");
  assert.equal(released, true);
});

test("PostgreSQL legacy proposal rehash rolls back a non-portable legacy patch", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(text) {
      calls.push(text);
      if (text === "begin" || text === "rollback") return { rowCount: null, rows: [] };
      if (text.includes("select proposal_id, patch")) {
        return { rowCount: 1, rows: [{ patch: { "legacy-key": true }, proposal_id: "proposal_bad" }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { released = true; },
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rowCount: 0, rows: [] }; },
  };

  await assert.rejects(
    rehashLegacyPostgresProposalPatches({ ownerId: "owner_legacy", pool }),
    /object key must be a portable value; keys must use Convex-compatible ASCII identifiers/,
  );
  assert.equal(calls.includes("rollback"), true);
  assert.equal(calls.includes("commit"), false);
  assert.equal(calls.some((text) => text.includes("update nodekit.proposals set patch_hash")), false);
  assert.equal(released, true);
});

test("PostgreSQL receipt construction normalizes provider query results before hashing", async () => {
  const source = await readFile(path.resolve("src/adapters/postgres-caseflow.mjs"), "utf8");
  assert.match(source, /import \{ normalizeReceiptBindings \} from "\.\.\/lib\/receipt-bindings\.mjs"/);
  assert.match(source, /normalizeReceiptBindings\(\{\s*approvalBindings: rawApprovalBindings,\s*artifactBindings: rawArtifactBindings,\s*eventBindings: rawEventBindings,\s*proposalBindings: rawProposalBindings,/s);
  assert.match(source, /eventIds,\s*generatedAt: now,/s);
  assert.doesNotMatch(source, /where a\.owner_id = \$1 and a\.run_id = \$2 order by a\.created_at/);
  assert.doesNotMatch(source, /aggregate_id = any\(\$2::text\[\]\) order by occurred_at/);
});

test("portable and component receipt hashing share a fixed-ID fixed-clock golden vector", () => {
  const fixedReceiptBody = {
    approvalBindings: [{ approvalId: "approval_1", commentHash: "a".repeat(64), decision: "accepted", proposalId: "proposal_1" }],
    artifactBindings: [{ artifactId: "artifact_1", canonicalVersion: 2, contentHash: "b".repeat(64) }],
    artifactIds: ["artifact_1"],
    caseHash: "c".repeat(64),
    caseId: "case_1",
    eventBindings: [{ actorHash: "d".repeat(64), aggregateId: "run_1", aggregateType: "run", eventId: "event_1", eventType: "run.completed", payloadHash: "e".repeat(64), sequence: 1 }],
    eventIds: ["event_1"],
    generatedAt: "2026-07-21T00:00:00.000Z",
    proposalBindings: [{ artifactId: "artifact_1", baseVersion: 1, patchHash: "f".repeat(64), proposalId: "proposal_1", status: "accepted" }],
    proposalIds: ["proposal_1"],
    runHash: "0".repeat(64),
    runId: "run_1",
    schemaVersion: "nodekit.receipt/v2",
    status: "completed",
  };
  assert.equal(contentHash(fixedReceiptBody), "ba7fa48da69643eccb656f75375168470f0c57fb5c400a4bb50b800f0e01f1d7");
});

test("PostgreSQL migration defines the complete owner-scoped Caseflow record set", async () => {
  const sql = await readFile(path.resolve("adapters/postgres/001_caseflow.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`create table if not exists nodekit\\.${table}`));
  }
  assert.match(sql, /owner_id text not null/);
  assert.match(sql, /create or replace function nodekit\.apply_proposal/);
  assert.match(sql, /patch_hash text not null constraint nodekit_proposals_patch_hash_sha256/);
  assert.match(sql, /nodekit_proposals_patch_hash_canonical_required/);
  assert.match(sql, /check \(patch_hash is not null and patch_hash ~ '\^\[a-f0-9\]\{64\}\$'\) not valid/);
  assert.match(sql, /legacy_patch_count = 0/);
  assert.match(sql, /alter column patch_hash set not null/);
  assert.match(sql, /legacy proposal % has no canonical patch hash/);
  assert.doesNotMatch(sql, /patch::text/);
  assert.doesNotMatch(sql, /sha256\s*\(\s*convert_to/i);
  assert.doesNotMatch(sql, /update nodekit\.proposals\s+set patch_hash\s*=/i);
  assert.match(sql, /proposal_row\.patch_hash/);
  assert.match(sql, /drop function if exists nodekit\.apply_proposal\(text, text, text, text, text, text, timestamptz\) cascade/);
  assert.doesNotMatch(sql, /next_content_hash/);
  assert.match(sql, /proposal_row\.base_version <> artifact_row\.canonical_version/);
  assert.match(sql, /approval_row\.decision <> requested_decision/);
  assert.match(sql, /idempotency_key text/);
  assert.match(sql, /nodekit_events_owner_idempotency/);
  assert.match(sql, /artifact_run_status in \('cancelled', 'completed', 'failed_safely'\)/);
  assert.match(sql, /artifact_run_status <> 'active'/);
  assert.match(sql, /select r\.status into artifact_run_status from nodekit\.runs r/);
});

test("PostgreSQL adapter stores the canonical proposal digest once and never sends a hash to apply", async () => {
  const source = await readFile(path.resolve("src/adapters/postgres-caseflow.mjs"), "utf8");

  assert.match(source, /const patchHash = contentHash\(portablePatch\)/);
  assert.match(source, /patch, patch_hash, rationale/);
  assert.match(source, /select \* from nodekit\.apply_proposal\(\$1, \$2, \$3, \$4, \$5, \$6\)/);
  assert.match(source, /patchHash: row\.patch_hash/);
  assert.doesNotMatch(source, /nextContentHash|next_content_hash/);
});

test("live PostgreSQL proof exercises a two-client artifact-versus-completion lock barrier", async () => {
  const source = await readFile(path.resolve("scripts/run-postgres-conformance.mjs"), "utf8");
  assert.match(source, /const \[lateArtifactResult, completionResult\] = await Promise\.allSettled/);
  assert.match(source, /artifactCompletionRaceAtomic/);
  assert.match(source, /receipt\.artifactIds\.includes\(lateArtifactResult\.value\.artifactId\)/);
  assert.match(source, /run is terminal: completed/);
  assert.match(source, /distributablePathspecs\(packageJson\)/);
  assert.match(source, /assertCleanDistributablePaths\(dirtySource, "PostgreSQL conformance"\)/);
  assert.doesNotMatch(source, /NODEKIT_ALLOW_DIRTY_CONFORMANCE/);
  assert.doesNotMatch(source, /\(\?:proof\|docs\|evolution\)/);
});

test("Supabase profile extends the complete portable record set with owner RLS", async () => {
  const sql = await readFile(path.resolve("adapters/supabase/001_profile.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`alter table nodekit\\.${table} enable row level security`));
  }
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /create policy nodekit_case_owner on nodekit\.cases for select to authenticated/);
  assert.doesNotMatch(sql, /create policy nodekit_\w+_owner[^;]*for (insert|update|delete)/);
  assert.match(sql, /Revoke direct DML\s+-- even though RLS is enabled/);
  assert.match(sql, /pg_publication_tables/);
});
