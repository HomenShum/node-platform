import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compileModelIntelligence,
  diagnoseModelFailures,
  initializeHarness,
  MODEL_FAILURE_CLASSES,
  writeModelBaseline,
} from "../src/lib/model-intelligence.mjs";
import { createProject } from "../src/lib/scaffold.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const HASH = "a".repeat(64);

function observation(overrides = {}) {
  const taskId = overrides.taskId ?? "task-1";
  return {
    schemaVersion: "nodekit.model-observation/v1",
    runId: overrides.runId ?? "run-1",
    applicationId: "model-lab",
    taskId,
    taskFamily: overrides.taskFamily ?? "bounded-repair",
    model: {
      requestedRoute: "openrouter/free",
      resolvedProvider: "example-provider",
      resolvedModel: "exact-model-1",
      modelRevision: "2026-07-21",
    },
    harness: {
      version: "h0",
      hash: HASH,
      toolSurfaceHash: HASH,
      contextPolicyHash: HASH,
      skillStackHash: HASH,
    },
    budgets: { maximumTokens: 1000, maximumCostUsd: 0, maximumDurationMs: 10000 },
    cognitive: {
      briefUnderstanding: 0.8,
      decomposition: 0.8,
      constraintRetention: 0.9,
      ambiguityDetection: 0.7,
      referenceUse: 0.8,
      repairReasoning: 0.7,
    },
    execution: {
      toolSelection: 0.8,
      validArguments: 0.9,
      toolOrdering: 0.8,
      resultInspection: 0.5,
      recovery: 0.7,
      scopedChanges: 0.9,
      completion: 0.8,
    },
    artifact: { correctness: 0.8, usability: 0.8, domainQuality: 0.7, evidenceIntegrity: 0.9 },
    efficiency: { latencyMs: 1000, toolCalls: 3, retries: 0, costUsd: 0 },
    failures: overrides.failures ?? [],
    evidenceRefs: ["proof/run-1.json"],
    proofReceiptId: "receipt-1",
  };
}

function capabilityCard() {
  return {
    schemaVersion: "nodekit.model-capability-card/v1",
    model: {
      requestedRoute: "openrouter/free",
      resolvedProvider: "example-provider",
      resolvedModel: "exact-model-1",
      modelRevision: "2026-07-21",
    },
    scope: { level: "project", applicationId: "model-lab", taskFamilies: ["bounded-repair"] },
    evidenceWindow: { from: "2026-07-01", to: "2026-07-21", benchmarkRuns: 1, taskCount: 1, harnessVersions: ["h0"] },
    strengths: ["bounded typed changes"],
    weaknesses: ["inconsistent result inspection"],
    bestRoles: ["bounded-editor"],
    avoidRoles: ["final-proof-authority"],
    requiredScaffolding: ["inspect-tool-result"],
    metrics: { briefAdherence: 0.8, validToolCalls: 0.9, medianLatencyMs: 1000, costPerSuccessUsd: 0 },
    confidence: { level: "low", reason: "One controlled run; provisional only" },
    expiresWhen: ["model revision changes", "harness major version changes"],
    evidenceRefs: ["proof/run-1.json"],
    status: "provisional",
  };
}

test("model observation and capability-card schemas require exact resolved identity", async () => {
  assert.deepEqual(await validateSchema("nodekit.model-observation.v1.schema.json", observation(), "observation"), []);
  assert.deepEqual(await validateSchema("nodekit.model-capability-card.v1.schema.json", capabilityCard(), "card"), []);
  const invalid = observation();
  delete invalid.model.resolvedModel;
  assert.match(
    (await validateSchema("nodekit.model-observation.v1.schema.json", invalid, "observation")).join("\n"),
    /resolvedModel/,
  );
  assert.equal(MODEL_FAILURE_CLASSES.includes("FALSE_COMPLETION"), true);
  assert.equal(MODEL_FAILURE_CLASSES.includes("AUTHORITY_VIOLATION"), true);
});

test("harness init is additive and baseline fails closed to an unmeasured registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-model-intelligence-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "model-lab", target: root });
  assert.equal(await readFile(path.join(root, "README.md"), "utf8").then((text) => text.includes("harness/models")), false);

  const first = await initializeHarness(root);
  const second = await initializeHarness(root);
  assert.equal(first.created.includes("harness/harness.yaml"), true);
  assert.equal(second.created.length, 0);
  const { receipt } = await writeModelBaseline(root);
  assert.equal(receipt.status, "unmeasured");
  assert.equal(receipt.providerCallsMade, 0);
  assert.equal(receipt.capabilityClaimsCertified, false);
  assert.equal(receipt.routingCertified, false);
});

test("compiler validates observations and cards and keeps requested aliases separate from resolved models", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-model-registry-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "model-lab", target: root });
  await initializeHarness(root);
  await writeFile(path.join(root, ".qa", "models", "observations", "run-1.json"), `${JSON.stringify(observation(), null, 2)}\n`);
  const cardRoot = path.join(root, "harness", "models", "cards", "project");
  await mkdir(cardRoot, { recursive: true });
  await writeFile(path.join(cardRoot, "exact-model-1.json"), `${JSON.stringify(capabilityCard(), null, 2)}\n`);

  const compiled = await compileModelIntelligence(root);
  assert.equal(compiled.registry.status, "profiled");
  assert.deepEqual(compiled.registry.requestedRoutes, ["openrouter/free"]);
  assert.deepEqual(compiled.registry.models, ["example-provider/exact-model-1"]);
  assert.equal(compiled.registry.routingCertified, false);
  assert.match(await readFile(path.join(root, ".nodekit", "harness", "harness-hash.txt"), "utf8"), /^[a-f0-9]{64}\n$/);
});

test("compiler rejects escaped evidence roots and unsupported project-card claims", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-model-integrity-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "model-lab", target: root });
  await initializeHarness(root);
  const harnessPath = path.join(root, "harness", "harness.yaml");
  const originalHarness = await readFile(harnessPath, "utf8");
  await writeFile(harnessPath, originalHarness.replace("observationRoot: .qa/models/observations", "observationRoot: ../outside"));
  await assert.rejects(() => compileModelIntelligence(root, { write: false }), /observationRoot must stay within the repository/);
  await writeFile(harnessPath, originalHarness);

  await writeFile(path.join(root, ".qa", "models", "observations", "run-1.json"), `${JSON.stringify(observation(), null, 2)}\n`);
  const unsupported = capabilityCard();
  unsupported.evidenceWindow.benchmarkRuns = 2;
  const cardRoot = path.join(root, "harness", "models", "cards", "project");
  await mkdir(cardRoot, { recursive: true });
  await writeFile(path.join(cardRoot, "unsupported.json"), `${JSON.stringify(unsupported, null, 2)}\n`);
  await assert.rejects(() => compileModelIntelligence(root, { write: false }), /claims 2 runs but only 1 matching observations exist/);
});

test("failure diagnosis only marks repeated multi-brief findings as skill candidates", () => {
  const failure = (id, taskId) => ({
    failureId: id,
    failureClass: "NO_RESULT_INSPECTION",
    severity: "P1",
    model: "exact-model-1",
    taskId,
    harnessVersion: "h0",
    behavior: "Declared completion before inspecting the tool result",
    expectedBehavior: "Inspect the tool result before completion",
    probableCause: "model",
    evidenceRefs: [`proof/${id}.json`],
  });
  const observations = [
    observation({ runId: "run-1", taskId: "task-1", failures: [failure("f-1", "task-1")] }),
    observation({ runId: "run-2", taskId: "task-1", failures: [failure("f-2", "task-1")] }),
    observation({ runId: "run-3", taskId: "task-2", failures: [failure("f-3", "task-2")] }),
  ];
  const [cluster] = diagnoseModelFailures(observations);
  assert.equal(cluster.count, 3);
  assert.deepEqual(cluster.taskIds, ["task-1", "task-2"]);
  assert.equal(cluster.skillCandidateEligible, true);
});
