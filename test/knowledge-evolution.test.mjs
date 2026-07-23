import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  applyGraphPatch,
  benchmarkKnowledgeRetrieval,
  createFileKnowledgeGraphAdapter,
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
import { evidenceSnapshotToGraphNode, ingestEvidenceBytes } from "../src/lib/evidence-snapshots.mjs";
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

async function storedEvidence(root, {
  bytes = Buffer.from("EvoGraph-R1 evidence bytes", "utf8"),
  label = "EvoGraph-R1 paper",
  sourceUri = "https://arxiv.org/pdf/2607.12764",
  expiresAt = "2027-07-21T00:00:00.000Z",
  capturedAt = "2026-07-21T00:00:00.000Z",
  checkedAt = "2026-07-21T00:00:00.000Z",
} = {}) {
  const snapshot = await ingestEvidenceBytes(root, {
    bytes,
    sourceUri,
    mediaType: "text/plain",
    capturedAt,
    checkedAt,
    expiresAt,
  });
  return evidenceSnapshotToGraphNode(snapshot, { label });
}

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
  const evidence = await storedEvidence(root);
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
  const evidence = await storedEvidence(root);
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
  const actionReceipt = await recordKnowledgeAction(root, {
    type: "EXTERNAL_RESEARCH",
    runId: "run:1",
    caseId: "case:1",
    actorId: "agent:test",
    input: { query: "dynamic hypergraph" },
    outputRefs: [evidence.id],
    evidenceRefs: [evidence.id],
    status: "completed",
  });
  assert.deepEqual(await validateSchema("nodekit.knowledge-action-receipt.v1.schema.json", actionReceipt, "knowledge action receipt"), []);

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
  const evidence = await storedEvidence(root);
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

test("reserves the source layer exclusively for authenticated evidence snapshots", async (t) => {
  const root = await rootFor(t);
  await assert.rejects(() => proposeGraphPatch(root, {
    operations: [{ type: "INSERT", node: { id: "claim:laundered", kind: "claim", label: "Laundered claim", layer: "source", confidence: 1, evidenceRefs: [] } }],
    evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1,
  }), /source layer is reserved/);
  await assert.rejects(() => proposeGraphPatch(root, {
    operations: [{ type: "INSERT", node: { id: "evidence:misplaced", kind: "evidence", label: "Misplaced evidence", layer: "derived", confidence: 1, evidenceRefs: [] } }],
    evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1,
  }), /evidence nodes must remain in the source layer/);
  await assert.rejects(() => proposeGraphPatch(root, {
    operations: [{ type: "INSERT", hyperedge: {
      id: "hyperedge:laundered", predicate: "pretends-to-be-source", layer: "source",
      participants: [{ nodeId: "a", role: "left" }, { nodeId: "b", role: "right" }], confidence: 1, evidenceRefs: [],
    } }],
    evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1,
  }), /source layer is reserved/);

  const evidence = await storedEvidence(root);
  await proposeValidateAcceptApply(root, { operations: [{ type: "INSERT", node: evidence }], evidenceRefs: [], contradictionRefs: [] });
  const claim = { id: "claim:canonical", kind: "claim", label: "Canonical claim", layer: "canonical", confidence: 1, evidenceRefs: [evidence.id] };
  await proposeValidateAcceptApply(root, { operations: [{ type: "INSERT", node: claim }], evidenceRefs: [evidence.id], contradictionRefs: [] });
  await assert.rejects(() => proposeGraphPatch(root, {
    operations: [{ type: "UPDATE", targetId: claim.id, patch: { layer: "source" }, evidenceRefs: [evidence.id] }],
    evidenceRefs: [evidence.id], contradictionRefs: [], proposedBy: actor, confidence: 1,
  }), /cannot promote an entity into the immutable source layer/);
});

test("rejects fabricated source anchors and every stale reference location", async (t) => {
  const root = await rootFor(t);
  const fabricated = await proposeGraphPatch(root, {
    operations: [{ type: "INSERT", node: {
      id: "evidence_fabricated0000000000000",
      kind: "evidence",
      label: "Fabricated source",
      layer: "source",
      confidence: 1,
      evidenceRefs: [],
      contentHash: "a".repeat(64),
      sourceUri: "https://example.test/fabricated",
      capturedAt: "2026-07-21T00:00:00.000Z",
      freshness: { checkedAt: "2026-07-21T00:00:00.000Z", expiresAt: "2027-07-21T00:00:00.000Z" },
      properties: { snapshotId: "evidence_000000000000000000000000", snapshotContentHash: "b".repeat(64) },
    } }],
    evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1,
  });
  const fabricatedValidation = await validateGraphPatch(root, fabricated.patchId);
  assert.ok(fabricatedValidation.validation.errors.some((error) => error.includes("authentication failed")));

  const expiresAt = new Date(Date.now() + 2_000).toISOString();
  const durable = await storedEvidence(root, { bytes: Buffer.from("durable freshness source"), sourceUri: "https://example.test/durable-freshness", expiresAt: "2035-01-01T00:00:00.000Z" });
  const expiring = await storedEvidence(root, { bytes: Buffer.from("expiring source"), sourceUri: "https://example.test/expiring", expiresAt });
  await proposeValidateAcceptApply(root, {
    operations: [{ type: "INSERT", node: durable }, { type: "INSERT", node: expiring }],
    evidenceRefs: [], contradictionRefs: [],
  });
  const target = { id: "claim:freshness-target", kind: "claim", label: "Target", layer: "canonical", confidence: 1, evidenceRefs: [durable.id] };
  await proposeValidateAcceptApply(root, { operations: [{ type: "INSERT", node: target }], evidenceRefs: [durable.id], contradictionRefs: [] });
  await delay(2_100);

  const cases = [
    await proposeGraphPatch(root, {
      operations: [{ type: "INSERT", node: { id: "claim:patch-stale", kind: "claim", label: "Patch stale", layer: "canonical", confidence: 1, evidenceRefs: [] } }],
      evidenceRefs: [expiring.id], contradictionRefs: [], proposedBy: actor, confidence: 1,
    }),
    await proposeGraphPatch(root, {
      operations: [{ type: "INSERT", node: { id: "claim:entity-stale", kind: "claim", label: "Entity stale", layer: "canonical", confidence: 1, evidenceRefs: [expiring.id] } }],
      evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1,
    }),
    await proposeGraphPatch(root, {
      operations: [{ type: "UPDATE", targetId: target.id, patch: { label: "Changed" }, evidenceRefs: [expiring.id] }],
      evidenceRefs: [durable.id], contradictionRefs: [], proposedBy: actor, confidence: 1,
    }),
  ];
  for (const patch of cases) {
    const validation = await validateGraphPatch(root, patch.patchId);
    assert.ok(validation.validation.errors.some((error) => error.includes(`evidence is stale: ${expiring.id}`)));
    assert.equal(validation.validation.freshnessValid, false);
  }
});

test("rejects stale accepted proposals instead of overwriting a newer graph version", async (t) => {
  const root = await rootFor(t);
  const evidence = await storedEvidence(root);
  const first = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: evidence }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  const secondEvidence = await storedEvidence(root, { bytes: Buffer.from("second source", "utf8"), label: "Second source", sourceUri: "https://example.test/second" });
  const second = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: secondEvidence }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  await validateGraphPatch(root, first.patchId);
  await decideGraphPatch(root, first.patchId, { decision: "accept", principalId: "human:reviewer" });
  await applyGraphPatch(root, first.patchId);
  const stale = await validateGraphPatch(root, second.patchId);
  assert.equal(stale.status, "conflicted");
  await assert.rejects(() => applyGraphPatch(root, second.patchId), /only accepted/);
  assert.equal((await readKnowledgeGraph(root)).nodes.length, 1);
});

test("serializes same-base applies and concurrent action receipts without lost updates", async (t) => {
  const root = await rootFor(t);
  const evidenceA = await storedEvidence(root, { bytes: Buffer.from("race source a", "utf8"), label: "Race source A", sourceUri: "https://example.test/race-a" });
  const evidenceB = await storedEvidence(root, { bytes: Buffer.from("race source b", "utf8"), label: "Race source B", sourceUri: "https://example.test/race-b" });
  const first = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: evidenceA }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  const second = await proposeGraphPatch(root, { operations: [{ type: "INSERT", node: evidenceB }], evidenceRefs: [], contradictionRefs: [], proposedBy: actor, confidence: 1 });
  await validateGraphPatch(root, first.patchId);
  await validateGraphPatch(root, second.patchId);
  await decideGraphPatch(root, first.patchId, { decision: "accept", principalId: "human:race" });
  await decideGraphPatch(root, second.patchId, { decision: "accept", principalId: "human:race" });

  const outcomes = await Promise.all([
    applyGraphPatch(root, first.patchId),
    applyGraphPatch(root, second.patchId),
  ]);
  assert.deepEqual(outcomes.map((entry) => entry.status).sort(), ["applied", "conflicted"]);
  let graph = await readKnowledgeGraph(root);
  assert.equal(graph.version, 1);
  assert.equal(graph.evolutionReceipts.length, 1);
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.proposals.map((entry) => entry.status).sort(), ["applied", "conflicted"]);

  await Promise.all(Array.from({ length: 12 }, (_, index) => recordKnowledgeAction(root, {
    type: "INSPECT_ARTIFACT",
    receiptId: `knowledge_action_race_${index}`,
    runId: "run:race",
    caseId: "case:race",
    actorId: `agent:${index}`,
  })));
  graph = await readKnowledgeGraph(root);
  assert.equal(graph.actionReceipts.filter((entry) => entry.runId === "run:race").length, 12);
  assert.deepEqual(graph.actionReceipts.map((entry) => entry.sequence), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(graph.actionReceipts[0].previousReceiptHash, null);
  for (let index = 1; index < graph.actionReceipts.length; index += 1) {
    assert.equal(graph.actionReceipts[index].previousReceiptHash, graph.actionReceipts[index - 1].receiptHash);
  }
});

test("rejects tampered, dropped, and reordered action receipt histories", async (t) => {
  const root = await rootFor(t);
  for (const index of [1, 2, 3]) {
    await recordKnowledgeAction(root, {
      type: "INSPECT_ARTIFACT", receiptId: `knowledge_action_chain_${index}`,
      runId: "run:chain", caseId: "case:chain", actorId: "agent:chain", input: { index },
    });
  }
  const graphPath = path.join(root, ".nodeagent", "knowledge", "graph.json");
  const originalBytes = await readFile(graphPath);
  const original = JSON.parse(originalBytes.toString("utf8"));

  const tampered = structuredClone(original);
  tampered.actionReceipts[1].input.index = 999;
  await writeFile(graphPath, `${JSON.stringify(tampered, null, 2)}\n`);
  await assert.rejects(() => readKnowledgeGraph(root), /actionReceipts\[1\]\.receiptHash/);

  const dropped = structuredClone(original);
  dropped.actionReceipts.splice(1, 1);
  await writeFile(graphPath, `${JSON.stringify(dropped, null, 2)}\n`);
  await assert.rejects(() => readKnowledgeGraph(root), /sequence|previousReceiptHash/);

  const reordered = structuredClone(original);
  [reordered.actionReceipts[0], reordered.actionReceipts[1]] = [reordered.actionReceipts[1], reordered.actionReceipts[0]];
  await writeFile(graphPath, `${JSON.stringify(reordered, null, 2)}\n`);
  await assert.rejects(() => readKnowledgeGraph(root), /sequence|previousReceiptHash/);
  await writeFile(graphPath, originalBytes);
  assert.deepEqual(await readKnowledgeGraph(root), original);
});

test("file adapter keeps the prior valid bytes when atomic persistence fails before rename", async (t) => {
  const root = await rootFor(t);
  const graphPath = path.join(root, ".nodeagent", "knowledge", "graph.json");
  const beforeBytes = await readFile(graphPath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  const next = structuredClone(before);
  next.genesis.atomicWriteProbe = "must-not-land";
  const adapter = createFileKnowledgeGraphAdapter(root, {
    beforeAtomicRename: async () => { throw new Error("injected-before-rename"); },
  });
  await assert.rejects(
    () => adapter.compareAndSwap({ version: before.version, contentHash: before.contentHash }, next),
    /injected-before-rename/,
  );
  assert.deepEqual(await readFile(graphPath), beforeBytes);
  assert.deepEqual(await readKnowledgeGraph(root), before);
});

test("rejects graph symlink, hard-link, and target-swap filesystem attacks", async (t) => {
  const parentRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-path-"));
  t.after(() => rm(parentRoot, { force: true, recursive: true }));
  const redirectedRoot = path.join(parentRoot, "redirected");
  const symlinkRoot = path.join(parentRoot, "symlink-repo");
  await mkdir(path.join(symlinkRoot, ".nodeagent"), { recursive: true });
  await mkdir(redirectedRoot, { recursive: true });
  try {
    await symlink(redirectedRoot, path.join(symlinkRoot, ".nodeagent", "knowledge"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => initializeKnowledgeGraph(symlinkRoot, { graphId: "knowledge:redirected" }), /symbolic link|unsafe parent/);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
  }

  const root = await rootFor(t);
  const graphPath = path.join(root, ".nodeagent", "knowledge", "graph.json");
  const aliasPath = path.join(root, "graph-alias.json");
  try {
    await link(graphPath, aliasPath);
    await assert.rejects(() => readKnowledgeGraph(root), /regular unaliased file/);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await rm(aliasPath, { force: true });
  }

  const outside = path.join(root, "outside-graph.json");
  const beforeBytes = await readFile(graphPath);
  await writeFile(outside, beforeBytes);
  await rm(graphPath);
  try {
    await symlink(outside, graphPath, "file");
    await assert.rejects(() => readKnowledgeGraph(root), /symbolic link|regular unaliased file/);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await rm(graphPath, { force: true });
    await writeFile(graphPath, beforeBytes);
  }

  const alternate = path.join(root, ".nodeagent", "knowledge", "alternate.json");
  const next = JSON.parse(beforeBytes.toString("utf8"));
  next.genesis.targetSwapProbe = true;
  const adapter = createFileKnowledgeGraphAdapter(root, {
    beforeAtomicRename: async ({ target }) => {
      await writeFile(alternate, "alternate-target\n");
      await rename(target, `${target}.displaced`);
      await rename(alternate, target);
    },
  });
  await assert.rejects(
    () => adapter.compareAndSwap({ version: next.version, contentHash: next.contentHash }, next),
    /target identity changed/,
  );
  assert.equal(await readFile(graphPath, "utf8"), "alternate-target\n");
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
  const evidence = await storedEvidence(root);
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
