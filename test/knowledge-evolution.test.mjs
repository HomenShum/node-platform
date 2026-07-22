import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  applyGraphPatch,
  benchmarkKnowledgeRetrieval,
  createMemoryKnowledgeGraphAdapter,
  createKnowledgeState,
  decideGraphPatch,
  diffKnowledgeGraph,
  initializeKnowledgeGraph,
  inspectKnowledgeGaps,
  proposeGraphPatch,
  queryKnowledgeGraph,
  readKnowledgeGraph,
  recordKnowledgeAction,
  replayKnowledgeGraph,
  validateGraphPatch,
} from "../src/lib/knowledge-evolution.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";
import { createProject } from "../src/lib/scaffold.mjs";
import { initializeHarness } from "../src/lib/model-intelligence.mjs";
import { proposeHarnessKnowledgePatch } from "../src/lib/harness-knowledge.mjs";

const actor = {
  agentId: "agent:test",
  modelRoute: "deterministic",
  resolvedModel: "fixture",
  harnessVersion: "h0",
};
const execFileAsync = promisify(execFile);

const evidence = {
  id: "evidence:paper",
  kind: "evidence",
  label: "EvoGraph-R1 paper",
  layer: "source",
  confidence: 1,
  evidenceRefs: [],
  contentHash: "a".repeat(64),
  sourceUri: "https://arxiv.org/pdf/2607.12764",
  capturedAt: "2026-07-21T00:00:00.000Z",
  freshness: { checkedAt: "2026-07-21T00:00:00.000Z", expiresAt: "2027-07-21T00:00:00.000Z" },
};

async function rootFor(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await initializeKnowledgeGraph(root, { graphId: "knowledge:test" });
  return root;
}

async function proposeValidateAcceptApply(root, input, principalId = "human:reviewer") {
  const patch = await proposeGraphPatch(root, { proposedBy: actor, confidence: 0.95, ...input });
  const validated = await validateGraphPatch(root, patch.patchId);
  assert.deepEqual(validated.validation.errors, []);
  await decideGraphPatch(root, patch.patchId, { decision: "accept", principalId, reason: "reviewed fixture" });
  return applyGraphPatch(root, patch.patchId);
}

test("initializes a backend-neutral six-layer graph with proposal-only authority", async (t) => {
  const root = await rootFor(t);
  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.schemaVersion, "nodekit.knowledge-graph/v1");
  assert.equal(graph.authority.canonicalMutation, "accepted-patch-only");
  assert.equal(graph.authority.destructiveDelete, false);
  assert.deepEqual(graph.layers.map((layer) => layer.id), ["source", "derived", "working", "proposal", "canonical", "hypothesis"]);
  assert.match(graph.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await validateSchema("nodekit.knowledge-graph.v1.schema.json", graph, "graph"), []);

  const persisted = JSON.parse(await readFile(path.join(root, ".nodeagent", "knowledge", "graph.json"), "utf8"));
  assert.equal(persisted.graphId, "knowledge:test");

  const adapter = createMemoryKnowledgeGraphAdapter(graph);
  assert.equal((await adapter.readGraph()).version, 0);
  const stale = await adapter.compareAndSwap(1, graph);
  assert.deepEqual(stale, { applied: false, actualVersion: 0 });
  assert.match(await adapter.exportDocument(), /nodekit\.knowledge-graph\/v1/);
});

test("ingests immutable multimodal evidence only through an accepted patch", async (t) => {
  const root = await rootFor(t);
  const proposed = await proposeGraphPatch(root, {
    operations: [{ type: "INSERT", node: evidence }],
    evidenceRefs: [],
    contradictionRefs: [],
    proposedBy: actor,
    confidence: 1,
  });
  let graph = await readKnowledgeGraph(root);
  assert.equal(graph.nodes.length, 0, "a proposal must not mutate canonical graph state");
  assert.equal(proposed.status, "pending");

  const validated = await validateGraphPatch(root, proposed.patchId);
  assert.equal(validated.validation.sourceGrounded, true);
  assert.deepEqual(await validateSchema("nodekit.graph-patch.v1.schema.json", validated, "patch"), []);
  await decideGraphPatch(root, proposed.patchId, { decision: "accept", principalId: "human:reviewer" });
  const { receipt } = await applyGraphPatch(root, proposed.patchId);
  graph = await readKnowledgeGraph(root);
  assert.equal(graph.version, 1);
  assert.equal(graph.nodes[0].id, evidence.id);
  assert.match(receipt.beforeHash, /^[a-f0-9]{64}$/);
  assert.match(receipt.afterHash, /^[a-f0-9]{64}$/);
  assert.notEqual(receipt.beforeHash, receipt.afterHash);
});

test("supports source-grounded hyperedges, retrieval, gaps, actions, replay, and benchmark", async (t) => {
  const root = await rootFor(t);
  await proposeValidateAcceptApply(root, {
    operations: [{ type: "INSERT", node: evidence }],
    evidenceRefs: [],
    contradictionRefs: [],
  });
  const claim = {
    id: "claim:governed-evolution",
    kind: "claim",
    label: "Canonical graph changes require governed patches",
    layer: "canonical",
    confidence: 0.95,
    evidenceRefs: [evidence.id],
    properties: { owner: "NodeKit", status: "verified" },
  };
  const task = {
    id: "task:harness-gym",
    kind: "task",
    label: "Harness Gym graph-assisted canary",
    layer: "working",
    confidence: 0.8,
    evidenceRefs: [evidence.id],
  };
  const relationship = {
    id: "hyperedge:evidence-claim-task",
    predicate: "supports-under-task",
    layer: "canonical",
    participants: [
      { nodeId: evidence.id, role: "source" },
      { nodeId: claim.id, role: "claim" },
      { nodeId: task.id, role: "task" },
    ],
    confidence: 0.95,
    evidenceRefs: [evidence.id],
  };
  await proposeValidateAcceptApply(root, {
    operations: [
      { type: "INSERT", node: claim },
      { type: "INSERT", node: task },
      { type: "INSERT", hyperedge: relationship },
    ],
    evidenceRefs: [evidence.id],
    contradictionRefs: [],
  });
  await recordKnowledgeAction(root, {
    type: "EXTERNAL_RESEARCH",
    runId: "run:1",
    caseId: "case:1",
    actorId: "agent:test",
    input: { query: "dynamic hypergraph" },
    outputRefs: [evidence.id],
    evidenceRefs: [evidence.id],
    status: "completed",
  });

  const graph = await readKnowledgeGraph(root);
  const query = queryKnowledgeGraph(graph, "governed harness task");
  assert.ok(query.results.some((entry) => entry.entity.id === task.id));
  assert.ok(query.supportingHyperedges.some((edge) => edge.id === relationship.id));
  assert.equal(inspectKnowledgeGaps(graph).unsupported.length, 0);
  const state = createKnowledgeState(graph, { caseId: "case:1", runId: "run:1", goal: "Improve harness" });
  assert.equal(state.schemaVersion, "nodekit.knowledge-state/v1");
  assert.deepEqual(await validateSchema("nodekit.knowledge-state.v1.schema.json", state, "state"), []);

  const replayed = replayKnowledgeGraph(graph, 1);
  assert.equal(replayed.version, 1);
  assert.deepEqual(replayed.nodes.map((node) => node.id), [evidence.id]);
  const diff = diffKnowledgeGraph(graph, 0, 2);
  assert.equal(diff.patchIds.length, 2);
  assert.equal(diff.operations.length, 4);
  const benchmark = benchmarkKnowledgeRetrieval(graph, [{ caseId: "case:query", query: "governed canonical graph", expectedEntityIds: [claim.id] }]);
  assert.equal(benchmark.results.evolvingGraph.averageRecall, 1);
  assert.equal(benchmark.ablations.insert, true);
  assert.equal(benchmark.ablations.externalResearch, true);
});

test("blocks ungrounded, stale, and direct source mutations while retaining deprecated history", async (t) => {
  const root = await rootFor(t);
  const ungrounded = await proposeGraphPatch(root, {
    operations: [{ type: "INSERT", node: { id: "claim:unsupported", kind: "claim", label: "Unsupported", layer: "canonical", confidence: 0.5, evidenceRefs: [] } }],
    evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 0.5,
  });
  const invalid = await validateGraphPatch(root, ungrounded.patchId);
  assert.ok(invalid.validation.errors.some((error) => error.includes("not grounded")));
  await assert.rejects(() => decideGraphPatch(root, ungrounded.patchId, { decision: "accept", principalId: "human:reviewer" }), /failed validation/);

  await proposeValidateAcceptApply(root, { operations: [{ type: "INSERT", node: evidence }], evidenceRefs: [], contradictionRefs: [] });
  const sourceUpdate = await proposeGraphPatch(root, {
    operations: [{ type: "UPDATE", targetId: evidence.id, patch: { label: "Changed source" }, evidenceRefs: [evidence.id] }],
    evidenceRefs: [evidence.id], contradictionRefs: [], proposedBy: actor, confidence: 1,
  });
  const sourceInvalid = await validateGraphPatch(root, sourceUpdate.patchId);
  assert.ok(sourceInvalid.validation.errors.some((error) => error.includes("immutable source")));

  const claim = { id: "claim:old", kind: "claim", label: "Old claim", layer: "canonical", confidence: 0.8, evidenceRefs: [evidence.id] };
  await proposeValidateAcceptApply(root, { operations: [{ type: "INSERT", node: claim }], evidenceRefs: [evidence.id], contradictionRefs: [] });
  await proposeValidateAcceptApply(root, {
    operations: [{ type: "DEPRECATE", targetId: claim.id, reason: "superseded", evidenceRefs: [evidence.id] }],
    evidenceRefs: [evidence.id], contradictionRefs: [],
  });
  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.nodes.find((node) => node.id === claim.id).deprecationReason, "superseded");
  assert.equal(queryKnowledgeGraph(graph, "old claim").results.length, 0);
});

test("rejects stale accepted proposals instead of overwriting a newer graph version", async (t) => {
  const root = await rootFor(t);
  const first = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: evidence }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  const secondEvidence = { ...evidence, id: "evidence:second", label: "Second source", contentHash: "b".repeat(64) };
  const second = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: secondEvidence }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  await validateGraphPatch(root, first.patchId);
  await decideGraphPatch(root, first.patchId, { decision: "accept", principalId: "human:reviewer" });
  await applyGraphPatch(root, first.patchId);
  const stale = await validateGraphPatch(root, second.patchId);
  assert.equal(stale.status, "conflicted");
  await assert.rejects(() => applyGraphPatch(root, second.patchId), /only accepted/);
  assert.equal((await readKnowledgeGraph(root)).nodes.length, 1);
});

test("projects evaluated Harness Gym observations as a proposal, never as an automatic promotion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-harness-knowledge-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "knowledge-gym", target: root });
  await initializeHarness(root);
  await initializeKnowledgeGraph(root, { graphId: "knowledge:gym" });
  const hash = "c".repeat(64);
  const observation = {
    schemaVersion: "nodekit.model-observation/v1",
    runId: "run-graph-1",
    applicationId: "knowledge-gym",
    taskId: "task-graph-1",
    taskFamily: "graph-retrieval",
    model: { requestedRoute: "provider/alias", resolvedProvider: "provider", resolvedModel: "exact-model" },
    harness: { version: "h0", hash, toolSurfaceHash: hash, contextPolicyHash: hash, skillStackHash: hash },
    budgets: { maximumTokens: 1000, maximumCostUsd: 1, maximumDurationMs: 10000 },
    cognitive: { briefUnderstanding: 0.8, decomposition: 0.8, constraintRetention: 0.8, ambiguityDetection: 0.8, referenceUse: 0.8, repairReasoning: 0.8 },
    execution: { toolSelection: 0.8, validArguments: 0.8, toolOrdering: 0.8, resultInspection: 0.3, recovery: 0.7, scopedChanges: 0.9, completion: 0.7 },
    artifact: { correctness: 0.8, usability: 0.8, domainQuality: 0.8, evidenceIntegrity: 0.8 },
    efficiency: { latencyMs: 1000, toolCalls: 2, retries: 0 },
    failures: [{
      failureId: "failure-graph-1", failureClass: "NO_RESULT_INSPECTION", severity: "P1", model: "exact-model",
      taskId: "task-graph-1", harnessVersion: "h0", behavior: "Stopped before inspecting graph results",
      expectedBehavior: "Inspect graph results", probableCause: "model", evidenceRefs: ["proof/run-graph-1.json"],
    }],
    evidenceRefs: ["proof/run-graph-1.json"],
    proofReceiptId: "receipt-run-graph-1",
  };
  await writeFile(path.join(root, ".qa", "models", "observations", "run-graph-1.json"), `${JSON.stringify(observation, null, 2)}\n`);
  const projection = await proposeHarnessKnowledgePatch(root);
  assert.equal(projection.unchanged, false);
  assert.equal(projection.patch.status, "pending");
  assert.ok(projection.patch.operations.some((operation) => operation.hyperedge?.predicate === "model-performed-task-under-harness"));
  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.nodes.length, 0, "Harness projection cannot mutate canonical graph without approval");
  const validated = await validateGraphPatch(root, projection.patch.patchId);
  assert.deepEqual(validated.validation.errors, []);
});

test("CLI exposes the complete safe graph lifecycle", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-cli-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const cli = path.resolve("src", "cli.mjs");
  const run = async (...args) => JSON.parse((await execFileAsync(process.execPath, [cli, ...args, "--repo-root", root, "--json"])).stdout);
  const initialized = await run("graph", "init", "--graph-id", "knowledge:cli");
  assert.equal(initialized.graphVersion, 0);
  const inputPath = path.join(root, "evidence.json");
  await writeFile(inputPath, `${JSON.stringify({ nodes: [evidence] }, null, 2)}\n`);
  const ingest = await run("graph", "ingest", "--input", "evidence.json");
  assert.equal(ingest.proposalOnly, true);
  const validated = await run("graph", "validate", "--patch", ingest.patch.patchId);
  assert.equal(validated.passed, true);
  const applied = await run("graph", "apply", "--patch", ingest.patch.patchId, "--approved-by", "human:cli-reviewer");
  assert.equal(applied.receipt.toVersion, 1);
  const queried = await run("graph", "query", "EvoGraph paper");
  assert.equal(queried.results[0].entity.id, evidence.id);
  const inspected = await run("graph", "inspect");
  assert.equal(inspected.nodes, 1);
});
