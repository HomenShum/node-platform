import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  benchmarkSkillCandidate,
  compileRoutingPolicy,
  evaluateTournament,
  promoteSkillCandidate,
  proposeSkillCandidates,
  reviewSkillCandidate,
  rollbackHarness,
} from "../src/lib/harness-gym.mjs";
import { compileModelIntelligence, initializeHarness } from "../src/lib/model-intelligence.mjs";
import { createProject } from "../src/lib/scaffold.mjs";

const HASH = "b".repeat(64);

function failure(id, taskId) {
  return {
    failureId: id,
    failureClass: "NO_RESULT_INSPECTION",
    severity: "P1",
    model: "exact-model-1",
    taskId,
    harnessVersion: "h0",
    behavior: "Declared completion before inspecting the result",
    expectedBehavior: "Inspect the result before completion",
    probableCause: "model",
    evidenceRefs: [`proof/${id}.json`],
  };
}

function observation(run, taskId, failureId) {
  return {
    schemaVersion: "nodekit.model-observation/v1",
    runId: run,
    applicationId: "gym-lab",
    taskId,
    taskFamily: "bounded-repair",
    model: { requestedRoute: "provider/alias", resolvedProvider: "provider", resolvedModel: "exact-model-1", modelRevision: "r1" },
    harness: { version: "h0", hash: HASH, toolSurfaceHash: HASH, contextPolicyHash: HASH, skillStackHash: HASH },
    budgets: { maximumTokens: 1000, maximumCostUsd: 1, maximumDurationMs: 10000 },
    cognitive: { briefUnderstanding: 0.8, decomposition: 0.8, constraintRetention: 0.8, ambiguityDetection: 0.8, referenceUse: 0.8, repairReasoning: 0.8 },
    execution: { toolSelection: 0.8, validArguments: 0.8, toolOrdering: 0.8, resultInspection: 0.2, recovery: 0.7, scopedChanges: 0.9, completion: 0.7 },
    artifact: { correctness: 0.8, usability: 0.8, domainQuality: 0.8, evidenceIntegrity: 0.8 },
    efficiency: { latencyMs: 1000, costUsd: 0.1, toolCalls: 3, retries: 0 },
    failures: [failure(failureId, taskId)],
    evidenceRefs: [`proof/${failureId}.json`],
    proofReceiptId: `receipt-${run}`,
  };
}

async function preparedGym(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-gym-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "gym-lab", target: root });
  await initializeHarness(root);
  const observations = [
    observation("run-1", "task-1", "f-1"),
    observation("run-2", "task-1", "f-2"),
    observation("run-3", "task-2", "f-3"),
  ];
  for (const entry of observations) {
    await writeFile(path.join(root, ".qa", "models", "observations", `${entry.runId}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  }
  return root;
}

test("skill compiler proposes only evidence-threshold candidates with executable contracts", async (t) => {
  const root = await preparedGym(t);
  const proposed = await proposeSkillCandidates(root);
  assert.equal(proposed.candidates.length, 1);
  const candidateId = proposed.candidates[0].candidate.candidateId;
  const reviewed = await reviewSkillCandidate(root, candidateId);
  assert.equal(reviewed.candidate.sourceCluster.count, 3);
  assert.equal(reviewed.candidate.sourceCluster.taskIds.length, 2);
  assert.equal(reviewed.skill.kind, "guardrail");
  assert.equal(reviewed.skill.positiveExamples.length > 0, true);
  assert.equal(reviewed.skill.negativeExamples.length > 0, true);
  assert.equal(reviewed.skill.completionChecks.length > 0, true);
  assert.equal(reviewed.skill.failureBehavior.length > 0, true);
});

test("skill benchmark holds model harness and protected benchmark fixed and rejects regressions", async (t) => {
  const root = await preparedGym(t);
  const proposed = await proposeSkillCandidates(root);
  const candidateId = proposed.candidates[0].candidate.candidateId;
  const compiled = await compileModelIntelligence(root, { write: false });
  const comparison = {
    schemaVersion: "nodekit.skill-comparison/v1",
    candidateId,
    benchmarkHash: compiled.resolved.benchmarkHash,
    harnessHash: compiled.resolved.harnessHash,
    resolvedModel: "provider/exact-model-1",
    taskIds: ["task-1", "task-2"],
    baseline: { runs: 3, successRate: 0.5, targetFailureRate: 0.5, accuracy: 0.8, safety: 1, editability: 0.8, exportQuality: 0.8, userCompletion: 0.8, medianLatencyMs: 1000, costPerSuccessUsd: 0.1 },
    candidate: { runs: 3, successRate: 0.8, targetFailureRate: 0.1, accuracy: 0.8, safety: 1, editability: 0.8, exportQuality: 0.8, userCompletion: 0.8, medianLatencyMs: 1100, costPerSuccessUsd: 0.11 },
    protectedEvaluatorUnchanged: true,
  };
  const comparisonPath = path.join(root, "comparison.json");
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  const passed = await benchmarkSkillCandidate(root, candidateId, comparisonPath);
  assert.equal(passed.passed, true);

  comparison.candidate.safety = 0.9;
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  const failed = await benchmarkSkillCandidate(root, candidateId, comparisonPath);
  assert.equal(failed.passed, false);
  assert.equal(failed.nonRegression.safety, false);
});

test("routing compiler honors project evidence and remains provisional", async (t) => {
  const root = await preparedGym(t);
  const card = {
    schemaVersion: "nodekit.model-capability-card/v1",
    model: { requestedRoute: "provider/alias", resolvedProvider: "provider", resolvedModel: "exact-model-1", modelRevision: "r1" },
    scope: { level: "project", applicationId: "gym-lab", taskFamilies: ["bounded-repair"] },
    evidenceWindow: { from: "2026-07-01", to: "2026-07-22", benchmarkRuns: 3, taskCount: 2, harnessVersions: ["h0"] },
    strengths: ["bounded typed repair"],
    weaknesses: ["result inspection"],
    bestRoles: ["bounded-editor"],
    avoidRoles: ["proof-authority"],
    requiredScaffolding: ["inspect-tool-result"],
    metrics: { briefAdherence: 0.8, validToolCalls: 0.8, firstPassAcceptance: 0.7, repairSuccess: 0.8, medianLatencyMs: 1000, costPerSuccessUsd: 0.1 },
    confidence: { level: "medium", reason: "Three controlled runs across two tasks" },
    expiresWhen: ["model revision changes", "harness changes"],
    evidenceRefs: ["proof/f-1.json", "proof/f-2.json", "proof/f-3.json"],
    status: "provisional",
  };
  const cardRoot = path.join(root, "harness", "models", "cards", "project");
  await mkdir(cardRoot, { recursive: true });
  await writeFile(path.join(cardRoot, "model.json"), `${JSON.stringify(card, null, 2)}\n`);
  const policy = await compileRoutingPolicy(root);
  assert.equal(policy.status, "provisional");
  assert.equal(policy.automaticPromotion, false);
  assert.equal(policy.routes[0].candidates[0].scope, "project");
  assert.equal(policy.routes[0].fallback.type, "deterministic");
  assert.equal(policy.routes[0].completion.directMutation, false);
});

test("tournament rejects self-judging and never authorizes promotion", async (t) => {
  const root = await preparedGym(t);
  const compiled = await compileModelIntelligence(root, { write: false });
  const tournament = {
    schemaVersion: "nodekit.tournament/v1",
    tournamentId: "tournament-1",
    benchmarkHash: compiled.resolved.benchmarkHash,
    harnessHash: compiled.resolved.harnessHash,
    candidates: ["candidate-a", "candidate-b"],
    pairwiseResults: [
      { taskId: "task-1", left: "candidate-a", right: "candidate-b", winner: "candidate-b", criticId: "independent-critic", criticIndependent: true, deterministicChecksPassed: true, evidenceRefs: ["proof/pair-1.json"] },
    ],
    protectedEvaluatorUnchanged: true,
  };
  const file = path.join(root, "tournament.json");
  await writeFile(file, `${JSON.stringify(tournament, null, 2)}\n`);
  const verdict = await evaluateTournament(root, file);
  assert.equal(verdict.winner, "candidate-b");
  assert.equal(verdict.promotionAuthorized, false);

  tournament.pairwiseResults[0].criticId = "candidate-b";
  await writeFile(file, `${JSON.stringify(tournament, null, 2)}\n`);
  await assert.rejects(() => evaluateTournament(root, file), /cannot serve as its own decisive critic/);
});

test("manual promotion requires benchmark canary and NodeProof and remains reversible", async (t) => {
  const root = await preparedGym(t);
  const proposed = await proposeSkillCandidates(root);
  const candidateId = proposed.candidates[0].candidate.candidateId;
  const compiled = await compileModelIntelligence(root, { write: false });
  const comparison = {
    schemaVersion: "nodekit.skill-comparison/v1", candidateId,
    benchmarkHash: compiled.resolved.benchmarkHash, harnessHash: compiled.resolved.harnessHash,
    resolvedModel: "provider/exact-model-1", taskIds: ["task-1", "task-2"], protectedEvaluatorUnchanged: true,
    baseline: { runs: 3, successRate: 0.4, targetFailureRate: 0.6, accuracy: 0.8, safety: 1, editability: 0.8, exportQuality: 0.8, userCompletion: 0.8, medianLatencyMs: 1000, costPerSuccessUsd: 0.1 },
    candidate: { runs: 3, successRate: 0.8, targetFailureRate: 0.1, accuracy: 0.8, safety: 1, editability: 0.8, exportQuality: 0.8, userCompletion: 0.8, medianLatencyMs: 1000, costPerSuccessUsd: 0.1 },
  };
  const comparisonPath = path.join(root, "comparison.json");
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await benchmarkSkillCandidate(root, candidateId, comparisonPath);
  const canaryPath = path.join(root, "canary.json");
  await writeFile(canaryPath, `${JSON.stringify({ schemaVersion: "nodekit.canary-receipt/v1", canaryId: "canary-1", candidateId, freshContext: true, humanReprompts: 0, substantiveChanges: true, protectedEvaluatorUnchanged: true, checksPassed: true, evidenceRefs: ["proof/canary.json"], passed: true }, null, 2)}\n`);
  const proofPath = path.join(root, "nodeproof.json");
  await writeFile(proofPath, `${JSON.stringify({ schemaVersion: "nodeproof.integrity-receipt/v1", candidateId, passed: true, integrityVerified: true }, null, 2)}\n`);

  await assert.rejects(() => promoteSkillCandidate(root, candidateId, { canaryPath, proofPath }), /approvedBy/);
  const promoted = await promoteSkillCandidate(root, candidateId, { canaryPath, proofPath, approvedBy: "human-reviewer" });
  assert.equal(promoted.nextVersion, "h1");
  assert.equal(promoted.promotion.automatic, false);
  assert.equal(promoted.promotion.rollbackVersion, "h0");
  const rollback = await rollbackHarness(root);
  assert.deepEqual({ from: rollback.from, to: rollback.to }, { from: "h1", to: "h0" });
  assert.equal(JSON.parse(await readFile(path.join(root, "harness", "versions", "current.json"), "utf8")).version, "h0");
});
