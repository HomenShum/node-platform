import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createMemoryCaseflow } from "../src/lib/caseflow.mjs";
import {
  applyGraphPatch,
  decideGraphPatch,
  initializeKnowledgeGraph,
  proposeGraphPatch,
  readKnowledgeGraph,
  validateGraphPatch,
} from "../src/lib/knowledge-evolution.mjs";
import {
  KNOWLEDGE_QUERY_MAX_LENGTH,
  KNOWLEDGE_QUERY_MAX_LIST_ITEMS,
  createMemoryKnowledgeRuntime,
  createMemoryKnowledgeStore,
  knowledgeRuntimeHash,
  retrieveAcceptedKnowledge,
} from "../src/lib/knowledge-runtime.mjs";
import { createKnowledgeContextConsumer } from "../src/lib/knowledge-context.mjs";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";
import {
  createKnowledgeComparisonExecutionReceipt,
  createProtectedKnowledgeComparisonDefinition,
  runProtectedKnowledgeComparison,
} from "../src/lib/knowledge-comparison.mjs";
import { createPostgresKnowledgeRuntime } from "../src/adapters/postgres-knowledge-runtime.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";
import { evidenceSnapshotToGraphNode, ingestEvidenceBytes } from "../src/lib/evidence-snapshots.mjs";

const actor = { agentId: "agent:knowledge-runtime", modelRoute: "deterministic", resolvedModel: "fixture", harnessVersion: "knowledge-runtime-v1" };
const ACTIVE_AT = "2026-07-22T12:00:00.000Z";
const EVALUATED_AT = "2028-01-01T00:00:00.000Z";
const RELEASE_CANDIDATE_A = Object.freeze({
  nodekitCommit: "a".repeat(40),
  nodekitSourceHash: "b".repeat(64),
  nodekitTarballSha256: "c".repeat(64),
  packageName: "@homenshum/nodekit",
  packageVersion: "0.2.1",
});
const RELEASE_CANDIDATE_B = Object.freeze({ ...RELEASE_CANDIDATE_A, nodekitCommit: "d".repeat(40) });
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function writeJson(root, relative, value) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(target, bytes);
  return { path: relative, sha256: digest(bytes) };
}

function spawnCaptured(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function waitForCandidateSnapshot(existingDirectories, expectedSize, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("knowledge comparison runner exited before snapshotting the candidate tarball");
    const directories = await readdir(os.tmpdir());
    for (const name of directories) {
      if (existingDirectories.has(name) || !name.startsWith("nodekit-knowledge-comparison-candidate-")) continue;
      const candidate = path.join(os.tmpdir(), name, "candidate.tgz");
      try {
        const metadata = await lstat(candidate);
        if (metadata.isFile() && metadata.size === expectedSize) return candidate;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await delay(10);
  }
  throw new Error("timed out waiting for the install-local candidate tarball snapshot");
}

async function evidence(root, id, marker, expiresAt = "2035-01-01T00:00:00.000Z") {
  const snapshot = await ingestEvidenceBytes(root, {
    bytes: Buffer.from(`source-${id}-${marker}`, "utf8"),
    sourceUri: `https://example.test/${encodeURIComponent(id)}`,
    mediaType: "text/plain",
    capturedAt: ACTIVE_AT,
    checkedAt: ACTIVE_AT,
    expiresAt,
  });
  return evidenceSnapshotToGraphNode(snapshot, { label: `Source ${id}`, properties: { fixtureId: id } });
}

async function accepted(root, operations, evidenceRefs) {
  const patch = await proposeGraphPatch(root, { operations, evidenceRefs, contradictionRefs: [], proposedBy: actor, confidence: 1 });
  const validated = await validateGraphPatch(root, patch.patchId);
  assert.deepEqual(validated.validation.errors, []);
  await decideGraphPatch(root, patch.patchId, { decision: "accept", principalId: "human:reviewer", reason: "protected fixture review" });
  return applyGraphPatch(root, patch.patchId);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeKnowledgeGraph(root, { graphId: "knowledge:runtime", ownerId: "owner:a" });
  const durableEvidence = await evidence(root, "evidence:durable", "a");
  const agingEvidence = await evidence(root, "evidence:aging", "b", "2027-01-01T00:00:00.000Z");
  await accepted(root, [
    { type: "INSERT", node: durableEvidence },
    { type: "INSERT", node: agingEvidence },
  ], []);
  const rootFact = { id: "fact:root", kind: "invariant", label: "Safe mutations require review", layer: "canonical", confidence: 1, evidenceRefs: [durableEvidence.id], properties: { aliases: ["approval boundary"] } };
  const relatedFact = { id: "fact:repair", kind: "repair", label: "Preserve the last valid artifact", layer: "canonical", confidence: 0.95, evidenceRefs: [durableEvidence.id] };
  const agingFact = { id: "fact:aging", kind: "claim", label: "Temporary provider capability", layer: "canonical", confidence: 0.9, evidenceRefs: [agingEvidence.id] };
  await accepted(root, [rootFact, relatedFact, agingFact].map((node) => ({ type: "INSERT", node })), [durableEvidence.id, agingEvidence.id]);
  const staticGraph = await readKnowledgeGraph(root);
  const goodEdge = {
    id: "edge:repair", predicate: "requires-recovery", layer: "canonical",
    participants: [{ nodeId: rootFact.id, role: "invariant" }, { nodeId: relatedFact.id, role: "repair" }],
    confidence: 1, evidenceRefs: [durableEvidence.id],
  };
  const agingEdge = {
    id: "edge:aging", predicate: "depends-on-capability", layer: "canonical",
    participants: [{ nodeId: rootFact.id, role: "workflow" }, { nodeId: agingFact.id, role: "capability" }],
    confidence: 0.9, evidenceRefs: [agingEvidence.id],
  };
  await accepted(root, [{ type: "INSERT", hyperedge: goodEdge }, { type: "INSERT", hyperedge: agingEdge }], [durableEvidence.id, agingEvidence.id]);
  const evolvingGraph = await readKnowledgeGraph(root);
  const oldFact = { id: "fact:old", kind: "rule", label: "Legacy direct write", layer: "canonical", confidence: 0.8, evidenceRefs: [durableEvidence.id] };
  await accepted(root, [{ type: "INSERT", node: oldFact }], [durableEvidence.id]);
  await accepted(root, [{ type: "DEPRECATE", targetId: oldFact.id, reason: "replaced", evidenceRefs: [durableEvidence.id] }], [durableEvidence.id]);
  const rejectedFact = { id: "fact:rejected", kind: "claim", label: "Rejected automation", layer: "canonical", confidence: 0.8, evidenceRefs: [durableEvidence.id] };
  const rejected = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: rejectedFact }], evidenceRefs: [durableEvidence.id], contradictionRefs: [], proposedBy: actor, confidence: 0.8 });
  await validateGraphPatch(root, rejected.patchId);
  await decideGraphPatch(root, rejected.patchId, { decision: "reject", principalId: "human:reviewer", reason: "unsafe" });
  const finalGraph = await readKnowledgeGraph(root);
  return { root, staticGraph, evolvingGraph, finalGraph, rootFact, relatedFact, agingFact, oldFact, rejectedFact, goodEdge, agingEdge };
}

test("accepted retrieval traverses governed hyperedges and excludes stale, deprecated, and rejected facts", async (t) => {
  const data = await fixture(t);
  const output = retrieveAcceptedKnowledge(data.finalGraph, {
    graphId: data.finalGraph.graphId, sessionId: "session:one", query: "approval boundary",
    seedIds: [data.rootFact.id, data.agingFact.id, data.oldFact.id, data.rejectedFact.id], maxDepth: 2, at: EVALUATED_AT,
  }, { ownerId: "owner:a", occurredAt: EVALUATED_AT });
  assert.deepEqual(output.facts.map((fact) => fact.id), [data.rootFact.id, data.relatedFact.id]);
  assert.deepEqual(output.hyperedges.map((edge) => edge.id), [data.goodEdge.id]);
  assert.ok(output.projection.exclusions.stale.includes(data.agingFact.id));
  assert.ok(output.projection.exclusions.deprecated.includes(data.oldFact.id));
  assert.ok(!output.facts.some((fact) => fact.id === data.rejectedFact.id));
  assert.ok(output.projection.exclusions.unsupported.includes(data.agingEdge.id));
  assert.ok(output.receipt.evolutionReceiptIds.length > 0);
  assert.deepEqual(await validateSchema("nodekit.knowledge-retrieval-receipt.v1.schema.json", output.receipt, "retrieval"), []);

  const abstained = retrieveAcceptedKnowledge(data.finalGraph, { sessionId: "session:none", query: "unrepresented quantum orchard", at: EVALUATED_AT }, { ownerId: "owner:a", occurredAt: EVALUATED_AT });
  assert.deepEqual(abstained.decision, { status: "ABSTAIN", reason: "INSUFFICIENT_ACCEPTED_EVIDENCE" });
});

test("retrieval rejects ambiguous or unbounded request shapes before evaluation", async (t) => {
  const data = await fixture(t);
  const base = { sessionId: "session:bounded", query: "review", seedIds: [data.rootFact.id], at: EVALUATED_AT };
  const retrieve = (overrides) => retrieveAcceptedKnowledge(data.finalGraph, { ...base, ...overrides }, { ownerId: "owner:a", occurredAt: EVALUATED_AT });

  assert.throws(() => retrieve({ query: 42 }), /query must be a string/);
  assert.throws(() => retrieve({ query: "q".repeat(KNOWLEDGE_QUERY_MAX_LENGTH + 1) }), /query must not exceed 4096 characters/);
  assert.throws(() => retrieve({ seedIds: "fact:root" }), /seedIds must be an array/);
  assert.throws(() => retrieve({ seedIds: Array.from({ length: KNOWLEDGE_QUERY_MAX_LIST_ITEMS + 1 }, (_, index) => `fact:${index}`) }), /seedIds must contain at most 100 items/);
  assert.throws(() => retrieve({ seedIds: ["fact:a", " fact:a "] }), /seedIds must contain unique items/);
  assert.throws(() => retrieve({ seedIds: [""] }), /seedIds\[0\] must be a non-empty string/);
  assert.throws(() => retrieve({ predicates: ["predicate:a", " predicate:a "] }), /predicates must contain unique items/);
  assert.throws(() => retrieve({ predicates: Array.from({ length: KNOWLEDGE_QUERY_MAX_LIST_ITEMS + 1 }, (_, index) => `predicate:${index}`) }), /predicates must contain at most 100 items/);
  for (const [field, values] of Object.entries({
    limit: [0, 101, 1.5, "2"],
    maxDepth: [-1, 9, 1.5, "2"],
    minimumFacts: [0, 101, 1.5, "2"],
  })) {
    for (const value of values) assert.throws(() => retrieve({ [field]: value }), new RegExp(`${field} must be an integer`));
  }
  assert.throws(() => retrieve({ limit: 1, minimumFacts: 2 }), /minimumFacts must not exceed limit/);
  assert.throws(() => retrieve({ mode: "automatic" }), /mode must be flat or graph/);
  assert.throws(() => retrieve({ at: "not-a-time" }), /knowledge retrieval at must be a timestamp/);
  assert.throws(() => retrieve({ graphId: "knowledge:other" }), /knowledge retrieval graph mismatch/);
  assert.throws(() => retrieve({ surprise: true }), /unknown fields: surprise/);
  assert.throws(() => retrieveAcceptedKnowledge(data.finalGraph, [], { ownerId: "owner:a" }), /input must be a plain object/);
});

test("query hash and receipt policy bind every decision-affecting retrieval parameter", async (t) => {
  const data = await fixture(t);
  const base = {
    sessionId: "session:contract",
    query: "review",
    seedIds: [data.rootFact.id],
    predicates: [],
    limit: 2,
    minimumFacts: 1,
    maxDepth: 2,
    mode: "graph",
    at: EVALUATED_AT,
  };
  const replayQueryHash = (receipt) => knowledgeRuntimeHash({
    schemaVersion: "nodekit.knowledge-query/v1",
    query: receipt.query,
    seedIds: receipt.policy.seedIds,
    predicates: receipt.policy.predicates,
    limit: receipt.policy.limit,
    minimumFacts: receipt.policy.minimumFacts,
    maxDepth: receipt.policy.maxDepth,
    mode: receipt.policy.mode,
    projectionAt: receipt.policy.projectionAt,
  });
  const retrieve = (overrides = {}, options = {}) => retrieveAcceptedKnowledge(
    data.finalGraph,
    { ...base, ...overrides },
    { ownerId: "owner:a", occurredAt: EVALUATED_AT, ...options },
  );
  const baseline = retrieve();
  assert.equal(baseline.receipt.policy.queryHash, baseline.receipt.queryHash);
  assert.deepEqual(baseline.receipt.policy.seedIds, [data.rootFact.id]);
  assert.deepEqual(baseline.receipt.policy.predicates, []);
  assert.equal(baseline.receipt.policy.limit, 2);
  assert.equal(baseline.receipt.policy.minimumFacts, 1);
  assert.equal(baseline.receipt.policy.maxDepth, 2);
  assert.equal(baseline.receipt.policy.mode, "graph");
  assert.equal(baseline.receipt.policy.projectionAt, EVALUATED_AT);
  assert.equal(replayQueryHash(baseline.receipt), baseline.receipt.queryHash);

  const variants = [
    { query: "approval" },
    { seedIds: [data.relatedFact.id] },
    { predicates: [data.goodEdge.predicate] },
    { limit: 1 },
    { minimumFacts: 2 },
    { maxDepth: 1 },
    { mode: "flat" },
    { at: "2028-01-01T00:00:00.001Z" },
  ];
  for (const overrides of variants) {
    const changed = retrieve(overrides);
    assert.notEqual(changed.receipt.queryHash, baseline.receipt.queryHash, `query hash must bind ${Object.keys(overrides)[0]}`);
    assert.notEqual(changed.receipt.receiptId, baseline.receipt.receiptId, `receipt id must bind ${Object.keys(overrides)[0]}`);
    assert.notEqual(changed.receipt.receiptHash, baseline.receipt.receiptHash, `receipt hash must bind ${Object.keys(overrides)[0]}`);
    assert.equal(changed.receipt.policy.queryHash, changed.receipt.queryHash);
    assert.equal(replayQueryHash(changed.receipt), changed.receipt.queryHash);
  }

  const effectiveOptionsAt = retrieve({ at: undefined }, { at: "2028-01-01T00:00:00.002Z" });
  assert.equal(effectiveOptionsAt.receipt.policy.projectionAt, "2028-01-01T00:00:00.002Z");
  assert.notEqual(effectiveOptionsAt.receipt.queryHash, baseline.receipt.queryHash);
});

test("Caseflow context consumer preserves provenance and repeat-session history", async (t) => {
  const data = await fixture(t);
  const store = createMemoryKnowledgeStore();
  const clock = () => EVALUATED_AT;
  const knowledge = createMemoryKnowledgeRuntime({ ownerId: "owner:a", store, clock });
  assert.equal((await knowledge.projectGraph({ graph: data.finalGraph })).applied, true);
  const caseflow = createMemoryCaseflow({ clock, ownerId: "owner:a" });
  const nodeCase = await caseflow.createCase({ title: "Neutral case", primaryJob: "Apply a supported invariant" });
  const run = await caseflow.startRun({ caseId: nodeCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const input = { graphId: data.finalGraph.graphId, caseId: nodeCase.caseId, runId: run.runId, sessionId: "session:repeat", query: "review", seedIds: [data.rootFact.id], at: EVALUATED_AT };
  const first = await createKnowledgeContextConsumer({ knowledgeRuntime: knowledge, caseflowRuntime: caseflow }).prepareRunContext(input);
  const secondRuntime = createMemoryKnowledgeRuntime({ ownerId: "owner:a", store, clock });
  const second = await createKnowledgeContextConsumer({ knowledgeRuntime: secondRuntime, caseflowRuntime: caseflow }).prepareRunContext(input);
  assert.equal(first.decision.status, "SUPPORTED");
  assert.equal(first.provenance.repeatSession, false);
  assert.equal(second.provenance.repeatSession, true);
  assert.deepEqual(second.provenance.previousReceiptIds, [first.provenance.retrievalReceiptId]);
  assert.ok(second.provenance.evidence.every((entry) => entry.contentHash && entry.sourceUri));
  assert.deepEqual(await validateSchema("nodekit.knowledge-context-pack.v1.schema.json", second, "context"), []);
});

test("memory repeat-session receipts use a bounded cryptographic predecessor chain", async (t) => {
  const data = await fixture(t);
  const knowledge = createMemoryKnowledgeRuntime({ ownerId: "owner:a", clock: () => EVALUATED_AT });
  await knowledge.projectGraph({ graph: data.finalGraph });
  const receipts = [];
  for (let index = 0; index < 250; index += 1) {
    const output = await knowledge.retrieve({
      graphId: data.finalGraph.graphId,
      sessionId: "session:long-chain",
      query: "review",
      seedIds: [data.rootFact.id],
      at: EVALUATED_AT,
    });
    const receipt = output.receipt;
    assert.equal(receipt.historySequence, index + 1);
    assert.ok(receipt.previousReceiptIds.length <= 1);
    assert.equal(receipt.policy.history.linkage, "immediate-predecessor");
    assert.equal(receipt.policy.history.replayPageSize, 100);
    if (index === 0) {
      assert.deepEqual(receipt.previousReceiptIds, []);
      assert.equal(receipt.previousReceiptHash, null);
    } else {
      assert.deepEqual(receipt.previousReceiptIds, [receipts[index - 1].receiptId]);
      assert.equal(receipt.previousReceiptHash, receipts[index - 1].receiptHash);
    }
    receipts.push(receipt);
  }
  const stored = await knowledge.listSessionReceipts({ graphId: data.finalGraph.graphId, sessionId: "session:long-chain" });
  assert.equal(stored.length, 250);
  assert.deepEqual(stored.at(-1), receipts.at(-1));
  const serializedSizes = receipts.map((receipt) => Buffer.byteLength(JSON.stringify(receipt)));
  const steadyStateSizes = serializedSizes.slice(1);
  assert.ok(Math.max(...steadyStateSizes) - Math.min(...steadyStateSizes) < 16, "repeat-session receipt size must remain constant rather than copying all predecessor IDs");
  assert.ok(serializedSizes.at(-1) < serializedSizes[0] + 256, "long-session receipt size must remain bounded by a fixed predecessor link");
  const forgedPrevious = structuredClone(receipts.at(-1));
  forgedPrevious.receiptHash = "0".repeat(64);
  assert.throws(
    () => retrieveAcceptedKnowledge(data.finalGraph, { sessionId: "session:long-chain", query: "review", at: EVALUATED_AT }, { ownerId: "owner:a", history: [forgedPrevious], occurredAt: EVALUATED_AT }),
    /previous knowledge retrieval receiptHash is invalid/,
  );
});

test("memory projection isolates tenants and rejects a stale transaction", async (t) => {
  const data = await fixture(t);
  const store = createMemoryKnowledgeStore();
  const ownerA = createMemoryKnowledgeRuntime({ ownerId: "owner:a", store, clock: () => EVALUATED_AT });
  const ownerB = createMemoryKnowledgeRuntime({ ownerId: "owner:b", store, clock: () => EVALUATED_AT });
  await ownerA.projectGraph({ graph: data.staticGraph });
  await assert.rejects(() => ownerB.readGraph(data.staticGraph.graphId), /not found for owner owner:b/);
  assert.deepEqual(await ownerA.projectGraph({ graph: data.evolvingGraph, expectedVersion: data.staticGraph.version }), { applied: true, reused: false, conflict: false, actualVersion: data.evolvingGraph.version });
  const conflict = await ownerA.projectGraph({ graph: data.finalGraph, expectedVersion: data.staticGraph.version });
  assert.equal(conflict.applied, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.actualVersion, data.evolvingGraph.version);
});

test("PostgreSQL projection is owner-scoped and rolls back a stale SELECT FOR UPDATE transaction", async (t) => {
  const data = await fixture(t);
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text: text.toLowerCase(), values });
      if (text.toLowerCase().includes("select graph_version")) return { rows: [{ graph_version: data.evolvingGraph.version, content_hash: data.evolvingGraph.contentHash }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { queries.push({ text: "release" }); },
  };
  const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => client };
  const runtime = createPostgresKnowledgeRuntime({ pool, ownerId: "owner:a", clock: () => EVALUATED_AT });
  const conflict = await runtime.projectGraph({ graph: data.finalGraph, expectedVersion: data.staticGraph.version });
  assert.equal(conflict.conflict, true);
  assert.ok(queries.some((entry) => entry.text.includes("for update")));
  assert.ok(queries.some((entry) => entry.text === "rollback"));
  assert.ok(queries.some((entry) => entry.text.includes("pg_advisory_xact_lock") && entry.values[0] === "owner:a:knowledge:runtime"));
  assert.ok(queries.filter((entry) => entry.values && !entry.text.includes("pg_advisory_xact_lock")).every((entry) => entry.values[0] === "owner:a"));
  assert.equal(queries.at(-1).text, "release");
  const migration = await readFile(path.resolve("adapters/postgres/002_knowledge_runtime.sql"), "utf8");
  assert.match(migration, /primary key \(owner_id, graph_id\)/i);
  assert.match(migration, /foreign key \(owner_id, graph_id, session_id\)/i);
});

test("PostgreSQL repeat-session persistence stores a bounded replay chain and rolls back oversized input", async (t) => {
  const data = await fixture(t);
  const persisted = [];
  const transactionEvents = [];
  const client = {
    async query(text, values = []) {
      const normalized = text.toLowerCase();
      if (["begin", "commit", "rollback"].includes(normalized)) {
        transactionEvents.push(normalized);
        return { rows: [], rowCount: null };
      }
      if (normalized.includes("select graph_document from nodekit.knowledge_projections")) {
        return { rows: [{ graph_document: data.finalGraph }], rowCount: 1 };
      }
      if (normalized.includes("insert into nodekit.knowledge_sessions")) return { rows: [], rowCount: 1 };
      if (normalized.includes("select last_sequence from nodekit.knowledge_sessions")) {
        return { rows: [{ last_sequence: persisted.length }], rowCount: 1 };
      }
      if (normalized.includes("select receipt from nodekit.knowledge_retrieval_receipts")) {
        return { rows: persisted.map((receipt) => ({ receipt })), rowCount: persisted.length };
      }
      if (normalized.includes("insert into nodekit.knowledge_retrieval_receipts")) {
        const receipt = JSON.parse(values[6]);
        persisted.push(receipt);
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes("update nodekit.knowledge_sessions")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected PostgreSQL knowledge query: ${text}`);
    },
    release() {},
  };
  const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => client };
  const runtime = createPostgresKnowledgeRuntime({ pool, ownerId: "owner:a", clock: () => EVALUATED_AT });

  for (let index = 0; index < 125; index += 1) {
    const output = await runtime.retrieve({
      graphId: data.finalGraph.graphId,
      sessionId: "session:postgres-chain",
      query: "review",
      seedIds: [data.rootFact.id],
      at: EVALUATED_AT,
    });
    assert.equal(output.receipt.historySequence, index + 1);
    assert.ok(output.receipt.previousReceiptIds.length <= 1);
  }
  assert.equal(persisted.length, 125);
  for (let index = 1; index < persisted.length; index += 1) {
    assert.deepEqual(persisted[index].previousReceiptIds, [persisted[index - 1].receiptId]);
    assert.equal(persisted[index].previousReceiptHash, persisted[index - 1].receiptHash);
  }
  const serializedSizes = persisted.map((receipt) => Buffer.byteLength(JSON.stringify(receipt)));
  const steadyStateSizes = serializedSizes.slice(1);
  assert.ok(Math.max(...steadyStateSizes) - Math.min(...steadyStateSizes) < 16);
  assert.ok(serializedSizes.at(-1) < serializedSizes[0] + 256);

  const countBeforeRejectedInput = persisted.length;
  await assert.rejects(
    runtime.retrieve({
      graphId: data.finalGraph.graphId,
      sessionId: "session:postgres-chain",
      query: "review",
      seedIds: Array.from({ length: 101 }, (_, index) => `fact:${index}`),
      at: EVALUATED_AT,
    }),
    /seedIds must contain at most 100 items/,
  );
  assert.equal(persisted.length, countBeforeRejectedInput);
  assert.equal(transactionEvents.at(-1), "rollback");
});

test("protected flat/static/evolving comparison fixes inputs and evaluator without claiming adoption", async (t) => {
  const data = await fixture(t);
  const definition = createProtectedKnowledgeComparisonDefinition({
    comparisonId: "knowledge-runtime-fixture",
    cases: [
      { caseId: "graph-traversal", query: "review", seedIds: [data.rootFact.id], expectedEntityIds: [data.rootFact.id, data.relatedFact.id], at: EVALUATED_AT },
      { caseId: "insufficient", query: "unrepresented quantum orchard", expectAbstain: true, at: EVALUATED_AT },
      { caseId: "stale-capability", query: "provider", seedIds: [data.agingFact.id], expectAbstain: true, forbiddenEntityIds: [data.agingFact.id], at: EVALUATED_AT },
    ],
  });
  const graphs = { flat: data.evolvingGraph, staticGraph: data.staticGraph, evolvingGraph: data.evolvingGraph };
  const graphEvidence = {
    flat: { path: "proof/evolution/graphs/flat.json", sha256: "a".repeat(64) },
    staticGraph: { path: "proof/evolution/graphs/static.json", sha256: "b".repeat(64) },
    evolvingGraph: { path: "proof/evolution/graphs/evolving.json", sha256: "c".repeat(64) },
  };
  const measurements = Object.fromEntries(["flat", "staticGraph", "evolvingGraph"].map((profile, profileIndex) => [profile, Object.fromEntries(definition.cases.map((entry, caseIndex) => {
    const graph = graphs[profile];
    const retrieval = retrieveAcceptedKnowledge(graph, {
      query: entry.query, seedIds: entry.seedIds, predicates: entry.predicates, minimumFacts: entry.minimumFacts,
      maxDepth: entry.maxDepth, mode: profile === "flat" ? "flat" : "graph", sessionId: `comparison:${entry.caseId}`, at: entry.at,
    }, { ownerId: graph.authority.ownerId, occurredAt: entry.at });
    const metrics = { turns: 1 + profileIndex, tokens: 100 + caseIndex, latencyMs: 10 + profileIndex, costUsd: 0.001 + profileIndex * 0.001 };
    const execution = createKnowledgeComparisonExecutionReceipt({
      definition,
      profile,
      caseId: entry.caseId,
      graph,
      retrievalReceipt: retrieval.receipt,
      ...metrics,
      releaseCandidate: RELEASE_CANDIDATE_A,
      generatedAt: EVALUATED_AT,
    });
    return [entry.caseId, { ...metrics, executionReceiptPath: `proof/evolution/executions/${profile}-${entry.caseId}.json`, executionReceiptSha256: `${profileIndex + 1}${caseIndex + 1}`.padEnd(64, "0"), execution }];
  }))]));
  assert.deepEqual(await validateSchema("nodekit.protected-knowledge-comparison-definition.v1.schema.json", definition, "comparison definition"), []);
  for (const [profile, cases] of Object.entries(measurements)) {
    for (const [caseId, metric] of Object.entries(cases)) {
      assert.deepEqual(
        await validateSchema("nodekit.knowledge-comparison-execution.v1.schema.json", metric.execution, `${profile}/${caseId} execution`),
        [],
      );
      assert.deepEqual(metric.execution.releaseCandidate, RELEASE_CANDIDATE_A);
    }
  }
  const result = runProtectedKnowledgeComparison({
    definition, definitionEvidencePath: "proof/evolution/protected-definition.json", definitionEvidenceSha256: "d".repeat(64), expectedDefinitionSha256: definition.definitionSha256,
    graphs, graphEvidence,
    measurements, releaseCandidate: RELEASE_CANDIDATE_A, completedAt: EVALUATED_AT,
  });
  assert.equal(result.sameInputs, true);
  assert.equal(result.protectedEvaluatorUnchanged, true);
  assert.equal(result.profiles.flat.cases[0].success, false);
  assert.equal(result.profiles.staticGraph.cases[0].success, false);
  assert.equal(result.profiles.evolvingGraph.cases[0].success, true);
  assert.equal(result.profiles.evolvingGraph.cases[2].abstainCorrect, true);
  assert.equal(result.adoptionClaim, false);
  assert.equal(result.status, "ENGINEERING_COMPARISON_ONLY");
  assert.deepEqual(result.releaseCandidate, RELEASE_CANDIDATE_A);
  assert.deepEqual(await validateSchema("nodekit.protected-knowledge-comparison-result.v1.schema.json", result, "comparison"), []);
  const substitutedGraphs = { flat: data.staticGraph, staticGraph: data.staticGraph, evolvingGraph: data.evolvingGraph };
  assert.throws(() => runProtectedKnowledgeComparison({ definition, definitionEvidencePath: "proof/evolution/protected-definition.json", definitionEvidenceSha256: "d".repeat(64), expectedDefinitionSha256: definition.definitionSha256, graphs: substitutedGraphs, graphEvidence, measurements, releaseCandidate: RELEASE_CANDIDATE_A }), /exact evolving-graph snapshot/);
  const escapingMeasurements = structuredClone(measurements);
  escapingMeasurements.flat[definition.cases[0].caseId].executionReceiptPath = "../outside.json";
  assert.throws(() => runProtectedKnowledgeComparison({ definition, definitionEvidencePath: "proof/evolution/protected-definition.json", definitionEvidenceSha256: "d".repeat(64), expectedDefinitionSha256: definition.definitionSha256, graphs, graphEvidence, measurements: escapingMeasurements, releaseCandidate: RELEASE_CANDIDATE_A }), /canonical repository-relative path/);
  const forgedMetrics = structuredClone(measurements);
  forgedMetrics.evolvingGraph[definition.cases[0].caseId].turns += 1;
  assert.throws(() => runProtectedKnowledgeComparison({ definition, definitionEvidencePath: "proof/evolution/protected-definition.json", definitionEvidenceSha256: "d".repeat(64), expectedDefinitionSha256: definition.definitionSha256, graphs, graphEvidence, measurements: forgedMetrics, releaseCandidate: RELEASE_CANDIDATE_A }), /metrics differ from the content-addressed execution receipt/);
  assert.throws(() => runProtectedKnowledgeComparison({
    definition,
    definitionEvidencePath: "proof/evolution/protected-definition.json",
    definitionEvidenceSha256: "d".repeat(64),
    expectedDefinitionSha256: definition.definitionSha256,
    graphs,
    graphEvidence,
    measurements,
    releaseCandidate: RELEASE_CANDIDATE_B,
  }), /execution receipt releaseCandidate\.nodekitCommit does not match the exact release candidate/);
  const tampered = structuredClone(definition);
  tampered.cases[0].expectedEntityIds = [];
  assert.throws(() => runProtectedKnowledgeComparison({ definition: tampered, definitionEvidencePath: "proof/evolution/protected-definition.json", definitionEvidenceSha256: "d".repeat(64), expectedDefinitionSha256: definition.definitionSha256, graphs: {}, measurements: {}, releaseCandidate: RELEASE_CANDIDATE_A }), /definition hash mismatch/);
});

test("protected comparison runner imports the exact disposable tarball and rejects candidate replay", async (t) => {
  const data = await fixture(t);
  const definition = createProtectedKnowledgeComparisonDefinition({
    comparisonId: "knowledge-runtime-packed-candidate",
    cases: [
      { caseId: "graph-traversal", query: "review", seedIds: [data.rootFact.id], expectedEntityIds: [data.rootFact.id, data.relatedFact.id], at: EVALUATED_AT },
      { caseId: "insufficient", query: "unrepresented quantum orchard", expectAbstain: true, at: EVALUATED_AT },
      { caseId: "stale-capability", query: "provider", seedIds: [data.agingFact.id], expectAbstain: true, forbiddenEntityIds: [data.agingFact.id], at: EVALUATED_AT },
    ],
  });
  const packRoot = path.join(data.root, "pack");
  await mkdir(packRoot, { recursive: true });
  const packInvocation = resolveNpmCliInvocation(["pack", "--json", "--ignore-scripts", "--pack-destination", packRoot]);
  const packed = spawnSync(packInvocation.command, packInvocation.args, {
    cwd: path.resolve("."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const archive = JSON.parse(packed.stdout)[0];
  const candidateTarball = path.join(packRoot, archive.filename);
  const candidateTarballBytes = await readFile(candidateTarball);
  const replayTarball = path.join(packRoot, `replay-${archive.filename}`);
  await writeFile(replayTarball, candidateTarballBytes, { flag: "wx" });
  const candidate = {
    nodekitCommit: "e".repeat(40),
    nodekitSourceHash: "f".repeat(64),
    nodekitTarballSha256: digest(candidateTarballBytes),
    packageName: archive.name,
    packageVersion: archive.version,
  };

  const definitionReference = await writeJson(data.root, "proof/evolution/protected-definition.json", definition);
  await Promise.all([
    writeJson(data.root, "proof/evolution/graphs/flat.json", data.evolvingGraph),
    writeJson(data.root, "proof/evolution/graphs/static.json", data.staticGraph),
    writeJson(data.root, "proof/evolution/graphs/evolving.json", data.evolvingGraph),
  ]);
  const graphs = { flat: data.evolvingGraph, staticGraph: data.staticGraph, evolvingGraph: data.evolvingGraph };
  const measurements = {};
  for (const [profileIndex, profile] of ["flat", "staticGraph", "evolvingGraph"].entries()) {
    measurements[profile] = {};
    for (const [caseIndex, entry] of definition.cases.entries()) {
      const graph = graphs[profile];
      const retrieval = retrieveAcceptedKnowledge(graph, {
        query: entry.query,
        seedIds: entry.seedIds,
        predicates: entry.predicates,
        minimumFacts: entry.minimumFacts,
        maxDepth: entry.maxDepth,
        mode: profile === "flat" ? "flat" : "graph",
        sessionId: `comparison:${entry.caseId}`,
        at: entry.at,
      }, { ownerId: graph.authority.ownerId, occurredAt: entry.at });
      const metrics = { turns: 1 + profileIndex, tokens: 100 + caseIndex, latencyMs: 10 + profileIndex, costUsd: 0.001 + profileIndex * 0.001 };
      const execution = createKnowledgeComparisonExecutionReceipt({
        definition,
        profile,
        caseId: entry.caseId,
        graph,
        retrievalReceipt: retrieval.receipt,
        ...metrics,
        releaseCandidate: candidate,
        generatedAt: EVALUATED_AT,
      });
      const executionReference = await writeJson(data.root, `proof/evolution/executions/${profile}-${entry.caseId}.json`, execution);
      measurements[profile][entry.caseId] = {
        ...metrics,
        executionReceiptPath: executionReference.path,
        executionReceiptSha256: executionReference.sha256,
      };
    }
  }
  await writeJson(data.root, "proof/evolution/measurements.json", measurements);

  const runnerArgs = [
    path.resolve("scripts/run-knowledge-runtime-comparison.mjs"),
    "--candidate-tarball", candidateTarball,
    "--nodekit-commit", candidate.nodekitCommit,
    "--nodekit-source-hash", candidate.nodekitSourceHash,
    "--nodekit-tarball-sha256", candidate.nodekitTarballSha256,
    "--package-name", candidate.packageName,
    "--package-version", candidate.packageVersion,
    "--definition", definitionReference.path,
    "--definition-sha256", definition.definitionSha256,
    "--flat", "proof/evolution/graphs/flat.json",
    "--static", "proof/evolution/graphs/static.json",
    "--evolving", "proof/evolution/graphs/evolving.json",
    "--measurements", "proof/evolution/measurements.json",
    "--completed-at", EVALUATED_AT,
    "--out", "proof/evolution/protected-runtime-comparison.json",
  ];
  const existingCandidateDirectories = new Set((await readdir(os.tmpdir()))
    .filter((name) => name.startsWith("nodekit-knowledge-comparison-candidate-")));
  const running = spawnCaptured(process.execPath, runnerArgs, { cwd: data.root });
  await waitForCandidateSnapshot(existingCandidateDirectories, candidateTarballBytes.length, running.child);
  await writeFile(candidateTarball, Buffer.from("swapped after the evaluator's immutable snapshot", "utf8"));
  const executed = await running.completed;
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  const summary = JSON.parse(executed.stdout);
  assert.deepEqual(summary.releaseCandidate, candidate);
  assert.equal(summary.installedRuntime.isolated, true);
  assert.equal(summary.installedRuntime.lifecycleScriptsDisabled, true);
  assert.equal(summary.installedRuntime.sourceCheckoutImported, false);
  assert.match(summary.installedRuntime.runtimeEntrypointPath, /^node_modules\/@homenshum\/nodekit\//u);
  assert.match(summary.installedRuntime.runtimeEntrypointSha256, /^[a-f0-9]{64}$/u);
  const result = JSON.parse(await readFile(path.join(data.root, "proof/evolution/protected-runtime-comparison.json"), "utf8"));
  assert.deepEqual(result.releaseCandidate, candidate);
  assert.deepEqual(await validateSchema("nodekit.protected-knowledge-comparison-result.v1.schema.json", result, "packed candidate comparison"), []);

  const replayed = [...runnerArgs];
  replayed[replayed.indexOf("--candidate-tarball") + 1] = replayTarball;
  replayed[replayed.indexOf("--nodekit-commit") + 1] = "1".repeat(40);
  const rejected = spawnSync(process.execPath, replayed, { cwd: data.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /execution receipt releaseCandidate\.nodekitCommit does not match the exact release candidate/);
});

test("public package exposes the knowledge runtime, PostgreSQL adapter, and migration", async () => {
  const runtimeSurface = await import("@homenshum/nodekit/knowledge-runtime");
  const postgresSurface = await import("@homenshum/nodekit/adapters/postgres/knowledge");
  assert.equal(runtimeSurface.createMemoryKnowledgeRuntime, createMemoryKnowledgeRuntime);
  assert.equal(postgresSurface.createPostgresKnowledgeRuntime, createPostgresKnowledgeRuntime);
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(packageJson.exports["./adapters/postgres/knowledge-migration.sql"], "./adapters/postgres/002_knowledge_runtime.sql");
  assert.equal(packageJson.files.includes("scripts/run-knowledge-runtime-comparison.mjs"), true);
});
