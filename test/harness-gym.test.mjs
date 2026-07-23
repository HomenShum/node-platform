import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { link, mkdtemp, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  benchmarkSkillCandidate,
  compileRoutingPolicy,
  computeSkillEvidenceClosure,
  evaluateTournament,
  promoteSkillCandidate,
  proposeSkillCandidates,
  reviewSkillCandidate,
  rollbackHarness,
  sealSkillEvaluatorReceipt,
  sealSkillIntegrityReceipt,
  sealSkillPromotionApproval,
} from "../src/lib/harness-gym.mjs";
import { builderGymContext } from "../src/lib/builder-gym.mjs";
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
  await writeFile(path.join(root, "harness", "tasks", "heldout", "index.json"), `${JSON.stringify({
    schemaVersion: "nodekit.task-index/v1",
    taskClass: "heldout",
    protected: true,
    tasks: [
      { id: "task-1", family: "bounded-repair", title: "Inspect the first fixed skill task" },
      { id: "task-2", family: "bounded-repair", title: "Inspect the second fixed skill task" },
    ],
  }, null, 2)}\n`);
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

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("skill evidence closure rejects hard-link aliases with lossless filesystem identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-skill-hardlink-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const first = await writeProtectedFixture(root, "proof/first.json", { value: 1 });
  const aliasPath = path.join(root, "proof", "alias.json");
  try {
    await link(path.join(root, ...first.path.split("/")), aliasPath);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip(`hard links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(
    () => computeSkillEvidenceClosure(root, [first, { ...first, path: "proof/alias.json" }]),
    /reuses one physical inode|multiple hard links|regular unaliased/,
  );
});

test("skill evidence closure rejects a single in-repository path hard-linked to outside mutable bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-skill-external-hardlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-skill-external-source-"));
  t.after(() => Promise.all([rm(root, { force: true, recursive: true }), rm(outside, { force: true, recursive: true })]));
  const outsidePath = path.join(outside, "mutable-evidence.json");
  const bytes = Buffer.from("{\"trusted\":true}\n", "utf8");
  await writeFile(outsidePath, bytes);
  await mkdir(path.join(root, "proof"), { recursive: true });
  const insidePath = path.join(root, "proof", "evidence.json");
  try {
    await link(outsidePath, insidePath);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error?.code)) return t.skip(`hard links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(
    () => computeSkillEvidenceClosure(root, [{ path: "proof/evidence.json", sha256: digest(bytes), bytes: bytes.length }]),
    /regular unaliased|multiple hard links/,
  );
});

async function writeProtectedFixture(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(target, bytes);
  return { path: relativePath, sha256: digest(bytes), bytes: bytes.length };
}

function protectedSigningKeys() {
  const evaluator = generateKeyPairSync("ed25519");
  const canary = generateKeyPairSync("ed25519");
  const integrity = generateKeyPairSync("ed25519");
  const approval = generateKeyPairSync("ed25519");
  const evaluatorKeyId = "skill-evaluator-test-key";
  const canaryKeyId = "skill-canary-test-key";
  const integrityKeyId = "skill-integrity-test-key";
  const approvalKeyId = "skill-promotion-approval-test-key";
  return {
    evaluator: { keyId: evaluatorKeyId, privateKey: evaluator.privateKey.export({ type: "pkcs8", format: "pem" }) },
    canary: { keyId: canaryKeyId, privateKey: canary.privateKey.export({ type: "pkcs8", format: "pem" }) },
    integrity: { keyId: integrityKeyId, privateKey: integrity.privateKey.export({ type: "pkcs8", format: "pem" }) },
    approval: { keyId: approvalKeyId, privateKey: approval.privateKey.export({ type: "pkcs8", format: "pem" }) },
    trustedKeys: {
      [evaluatorKeyId]: {
        publicKey: evaluator.publicKey.export({ type: "spki", format: "pem" }),
        purposes: ["skill-benchmark"],
      },
      [canaryKeyId]: {
        publicKey: canary.publicKey.export({ type: "spki", format: "pem" }),
        purposes: ["skill-canary"],
      },
      [integrityKeyId]: {
        publicKey: integrity.publicKey.export({ type: "spki", format: "pem" }),
        purposes: ["skill-integrity"],
      },
      [approvalKeyId]: {
        publicKey: approval.publicKey.export({ type: "spki", format: "pem" }),
        purposes: ["skill-promotion-approval"],
      },
    },
  };
}

async function promotionApprovalFixture(root, {
  candidateId, candidateSkillHash, verdictHash, canaryHash, integrityHash, signing, suffix = "valid",
  issuedAt = new Date(Date.now() - 1_000).toISOString(),
  expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(),
}) {
  const current = JSON.parse(await readFile(path.join(root, "harness", "versions", "current.json"), "utf8"));
  const approval = sealSkillPromotionApproval({
    schemaVersion: "nodekit.skill-promotion-approval/v1",
    purpose: "skill-promotion-approval",
    candidateId,
    candidateSkillHash,
    benchmarkVerdictHash: verdictHash,
    canaryReceiptHash: canaryHash,
    integrityReceiptHash: integrityHash,
    currentHarnessVersion: current.version,
    currentHarnessManifestHash: current.manifestHash,
    approvedBy: "human-reviewer",
    nonce: `approval-nonce-${suffix}-0001`,
    issuedAt,
    expiresAt,
  }, { ...signing.approval, signedAt: issuedAt });
  const reference = await writeProtectedFixture(root, `proof/skill-runs/promotion-approval-${suffix}.json`, approval);
  return { approval, path: path.join(root, ...reference.path.split("/")) };
}

function skillMetrics({ safety = 1, success, targetFailureObserved }) {
  return {
    success,
    targetFailureObserved,
    accuracy: 0.8,
    safety,
    editability: 0.8,
    exportQuality: 0.8,
    userCompletion: 0.8,
    latencyMs: 1000,
    costUsd: 0.1,
  };
}

async function signedSkillRun(root, fixture, {
  arm,
  canary,
  input,
  metrics,
  purpose = "skill-benchmark",
  runId,
  skillHash,
  task,
}) {
  const { taskId, ...taskEvidence } = task;
  const output = await writeProtectedFixture(root, `proof/skill-runs/${runId}/output.json`, { runId, completed: metrics.success });
  const evaluation = await writeProtectedFixture(root, `proof/skill-runs/${runId}/evaluation.json`, { runId, metrics });
  const evidence = [
    { kind: "task", ...taskEvidence },
    { kind: "input", ...input },
    { kind: "output", ...output },
    { kind: "evaluation", ...evaluation },
  ];
  const closure = await computeSkillEvidenceClosure(root, evidence);
  const issuedAt = "2026-07-22T14:00:00.000Z";
  const receipt = sealSkillEvaluatorReceipt({
    schemaVersion: "nodekit.skill-evaluator-receipt/v1",
    purpose,
    candidateId: fixture.candidateId,
    arm,
    runId,
    benchmarkHash: fixture.benchmarkHash,
    harnessHash: fixture.harnessHash,
    evaluatorHash: fixture.evaluatorHash,
    resolvedModel: fixture.resolvedModel,
    taskId,
    taskHash: task.sha256,
    inputHash: input.sha256,
    skillHash,
    metrics,
    ...(canary ? { canary } : {}),
    evidence,
    evidenceRootSha256: closure.rootHash,
    measurementAuthority: "protected-evaluator-signed",
    candidateAuthored: false,
    issuedAt,
  }, { ...(purpose === "skill-canary" ? fixture.signing.canary : fixture.signing.evaluator), signedAt: issuedAt });
  const stored = await writeProtectedFixture(root, `proof/skill-runs/receipts/${runId}.json`, receipt);
  return { receipt, reference: { path: stored.path, sha256: stored.sha256 } };
}

async function protectedSkillComparison(root, candidateId, signing, { candidateSafety = 1, suffix }) {
  const [compiled, gym, reviewed] = await Promise.all([
    compileModelIntelligence(root, { write: false }),
    builderGymContext(root),
    reviewSkillCandidate(root, candidateId),
  ]);
  const fixture = {
    benchmarkHash: compiled.resolved.benchmarkHash,
    candidateId,
    evaluatorHash: gym.evaluator.hash,
    harnessHash: compiled.resolved.harnessHash,
    resolvedModel: "provider/exact-model-1",
    signing,
  };
  const tasks = {};
  const inputs = {};
  for (const taskId of ["task-1", "task-2"]) {
    tasks[taskId] = { taskId, ...await writeProtectedFixture(root, `proof/skill-runs/${suffix}/${taskId}-task.json`, { taskId, fixed: true }) };
    inputs[taskId] = await writeProtectedFixture(root, `proof/skill-runs/${suffix}/${taskId}-input.json`, { taskId, input: "fixed" });
  }
  const baselineSkillHash = digest("baseline-skill-v1");
  const arms = { baseline: [], candidate: [] };
  const repeatedTasks = ["task-1", "task-1", "task-2"];
  for (const [index, taskId] of repeatedTasks.entries()) {
    const baseline = await signedSkillRun(root, fixture, {
      arm: "baseline",
      input: inputs[taskId],
      metrics: skillMetrics({ success: index !== 1, targetFailureObserved: index === 1 }),
      runId: `${suffix}-baseline-${index + 1}`,
      skillHash: baselineSkillHash,
      task: tasks[taskId],
    });
    const candidate = await signedSkillRun(root, fixture, {
      arm: "candidate",
      input: inputs[taskId],
      metrics: skillMetrics({ safety: candidateSafety, success: true, targetFailureObserved: false }),
      runId: `${suffix}-candidate-${index + 1}`,
      skillHash: reviewed.skillHash,
      task: tasks[taskId],
    });
    arms.baseline.push(baseline.reference);
    arms.candidate.push(candidate.reference);
  }
  const comparison = {
    schemaVersion: "nodekit.skill-benchmark-input/v1",
    candidateId,
    benchmarkHash: fixture.benchmarkHash,
    harnessHash: fixture.harnessHash,
    evaluatorHash: fixture.evaluatorHash,
    resolvedModel: fixture.resolvedModel,
    baselineSkillHash,
    candidateSkillHash: reviewed.skillHash,
    taskInputs: ["task-1", "task-2"].map((taskId) => ({ taskId, taskHash: tasks[taskId].sha256, inputHash: inputs[taskId].sha256 })),
    arms,
  };
  const comparisonPath = path.join(root, `${suffix}-comparison.json`);
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  return { ...fixture, arms, comparisonPath, inputs, reviewed, tasks };
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
  const signing = protectedSigningKeys();
  const passingComparison = await protectedSkillComparison(root, candidateId, signing, { suffix: "passing", candidateSafety: 1 });
  const passed = await benchmarkSkillCandidate(root, candidateId, passingComparison.comparisonPath, { trustedKeys: signing.trustedKeys });
  assert.equal(passed.passed, true);
  assert.equal(passed.measurementAuthority, "protected-evaluator-signed");

  const regressedComparison = await protectedSkillComparison(root, candidateId, signing, { suffix: "regressed", candidateSafety: 0.9 });
  const failed = await benchmarkSkillCandidate(root, candidateId, regressedComparison.comparisonPath, { trustedKeys: signing.trustedKeys });
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
  const signing = protectedSigningKeys();
  const comparison = await protectedSkillComparison(root, candidateId, signing, { suffix: "promotion", candidateSafety: 1 });
  const verdict = await benchmarkSkillCandidate(root, candidateId, comparison.comparisonPath, { trustedKeys: signing.trustedKeys });
  const canary = await signedSkillRun(root, comparison, {
    arm: "canary",
    canary: { freshContext: true, humanReprompts: 0, substantiveChanges: true, checksPassed: true },
    input: comparison.inputs["task-1"],
    metrics: skillMetrics({ success: true, targetFailureObserved: false }),
    purpose: "skill-canary",
    runId: "promotion-canary",
    skillHash: comparison.reviewed.skillHash,
    task: comparison.tasks["task-1"],
  });
  const canaryPath = path.join(root, ...canary.reference.path.split("/"));
  const proofEvidence = await writeProtectedFixture(root, "proof/skill-runs/promotion-integrity-evidence.json", { candidateId, verified: true });
  const integrityEvidence = [{ kind: "nodeproof", ...proofEvidence }];
  const integrityClosure = await computeSkillEvidenceClosure(root, integrityEvidence);
  const issuedAt = "2026-07-22T14:05:00.000Z";
  const proof = sealSkillIntegrityReceipt({
    schemaVersion: "nodekit.skill-integrity-receipt/v1",
    candidateId,
    benchmarkVerdictHash: verdict.verdictHash,
    canaryReceiptHash: canary.receipt.receiptHash,
    passed: true,
    integrityVerified: true,
    measurementAuthority: "independent-nodeproof-signed",
    candidateAuthored: false,
    evidence: integrityEvidence,
    evidenceRootSha256: integrityClosure.rootHash,
    issuedAt,
  }, { ...signing.integrity, signedAt: issuedAt });
  const proofReference = await writeProtectedFixture(root, "proof/skill-runs/promotion-integrity-receipt.json", proof);
  const proofPath = path.join(root, ...proofReference.path.split("/"));
  const approval = await promotionApprovalFixture(root, {
    candidateId,
    candidateSkillHash: comparison.reviewed.skillHash,
    verdictHash: verdict.verdictHash,
    canaryHash: canary.receipt.receiptHash,
    integrityHash: proof.receiptHash,
    signing,
  });

  await assert.rejects(() => promoteSkillCandidate(root, candidateId, { canaryPath, proofPath, trustedKeys: signing.trustedKeys }), /detached skill promotion approval/);
  const tamperedApproval = structuredClone(approval.approval);
  tamperedApproval.approvedBy = "agent-self-asserted-reviewer";
  const tamperedApprovalReference = await writeProtectedFixture(root, "proof/skill-runs/promotion-approval-tampered.json", tamperedApproval);
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath, proofPath,
    approvalPath: path.join(root, ...tamperedApprovalReference.path.split("/")),
    trustedKeys: signing.trustedKeys,
  }), /content address mismatch/);
  const expiredApproval = await promotionApprovalFixture(root, {
    candidateId,
    candidateSkillHash: comparison.reviewed.skillHash,
    verdictHash: verdict.verdictHash,
    canaryHash: canary.receipt.receiptHash,
    integrityHash: proof.receiptHash,
    signing,
    suffix: "expired",
    issuedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  });
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath, proofPath, approvalPath: expiredApproval.path, trustedKeys: signing.trustedKeys,
  }), /has expired/);
  const overlappingTrustedKeys = structuredClone(signing.trustedKeys);
  overlappingTrustedKeys[signing.evaluator.keyId].purposes.push("skill-canary");
  const reusedSignerCanary = await signedSkillRun(root, {
    ...comparison,
    signing: { ...signing, canary: signing.evaluator },
  }, {
    arm: "canary",
    canary: { freshContext: true, humanReprompts: 0, substantiveChanges: true, checksPassed: true },
    input: comparison.inputs["task-1"],
    metrics: skillMetrics({ success: true, targetFailureObserved: false }),
    purpose: "skill-canary",
    runId: "promotion-reused-signer-canary",
    skillHash: comparison.reviewed.skillHash,
    task: comparison.tasks["task-1"],
  });
  const reusedSignerProof = sealSkillIntegrityReceipt({
    schemaVersion: "nodekit.skill-integrity-receipt/v1",
    candidateId,
    benchmarkVerdictHash: verdict.verdictHash,
    canaryReceiptHash: reusedSignerCanary.receipt.receiptHash,
    passed: true,
    integrityVerified: true,
    measurementAuthority: "independent-nodeproof-signed",
    candidateAuthored: false,
    evidence: integrityEvidence,
    evidenceRootSha256: integrityClosure.rootHash,
    issuedAt,
  }, { ...signing.integrity, signedAt: issuedAt });
  const reusedSignerProofReference = await writeProtectedFixture(root, "proof/skill-runs/promotion-reused-signer-integrity-receipt.json", reusedSignerProof);
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath: path.join(root, ...reusedSignerCanary.reference.path.split("/")),
    proofPath: path.join(root, ...reusedSignerProofReference.path.split("/")),
    approvalPath: approval.path,
    trustedKeys: overlappingTrustedKeys,
  }), /independent trusted signing keys/);
  const redirectedApproval = await promotionApprovalFixture(root, {
    candidateId,
    candidateSkillHash: comparison.reviewed.skillHash,
    verdictHash: verdict.verdictHash,
    canaryHash: canary.receipt.receiptHash,
    integrityHash: proof.receiptHash,
    signing,
    suffix: "redirected-version",
  });
  const outsideHarness = await mkdtemp(path.join(os.tmpdir(), "nodekit-harness-redirect-"));
  const redirectedVersion = path.join(root, "harness", "versions", "h1");
  await symlink(outsideHarness, redirectedVersion, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath,
    proofPath,
    approvalPath: redirectedApproval.path,
    trustedKeys: signing.trustedKeys,
  }), /symlink|junction|unsafe/i);
  assert.deepEqual(await readdir(outsideHarness), []);
  assert.equal(JSON.parse(await readFile(path.join(root, "harness", "versions", "current.json"), "utf8")).version, "h0");
  await unlink(redirectedVersion);
  await rm(outsideHarness, { recursive: true, force: true });
  const promoted = await promoteSkillCandidate(root, candidateId, { canaryPath, proofPath, approvalPath: approval.path, trustedKeys: signing.trustedKeys });
  assert.equal(promoted.nextVersion, "h1");
  assert.equal(promoted.promotion.automatic, false);
  assert.equal(promoted.promotion.rollbackVersion, "h0");
  assert.notEqual(promoted.promotion.attestationKeyIds.benchmark[0], promoted.promotion.attestationKeyIds.canary);
  assert.notEqual(promoted.promotion.attestationKeyIds.canary, promoted.promotion.attestationKeyIds.integrity);
  assert.notEqual(promoted.promotion.attestationKeyIds.integrity, promoted.promotion.attestationKeyIds.approval);
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath, proofPath, approvalPath: approval.path, trustedKeys: signing.trustedKeys,
  }), /requires benchmark-passed candidate status/);
  const promotedManifest = JSON.parse(await readFile(path.join(root, "harness", "versions", "h1", "manifest.json"), "utf8"));
  assert.equal(promotedManifest.activeSkillBindings.length, 1);
  assert.equal(promotedManifest.activeSkills[0].startsWith("harness/versions/h1/skills/"), true);
  const routingCard = {
    schemaVersion: "nodekit.model-capability-card/v1",
    model: { requestedRoute: "provider/alias", resolvedProvider: "provider", resolvedModel: "exact-model-1", modelRevision: "r1" },
    scope: { level: "project", applicationId: "gym-lab", taskFamilies: ["bounded-repair"] },
    evidenceWindow: { from: "2026-07-01", to: "2026-07-22", benchmarkRuns: 3, taskCount: 2, harnessVersions: ["h0", "h1"] },
    strengths: ["bounded typed repair"], weaknesses: ["result inspection"], bestRoles: ["bounded-editor"], avoidRoles: ["proof-authority"],
    requiredScaffolding: ["inspect-tool-result"],
    metrics: { briefAdherence: 0.8, validToolCalls: 0.8, firstPassAcceptance: 0.7, repairSuccess: 0.8, medianLatencyMs: 1000, costPerSuccessUsd: 0.1 },
    confidence: { level: "medium", reason: "Three controlled runs across two tasks" },
    expiresWhen: ["model revision changes", "harness changes"], evidenceRefs: ["proof/f-1.json", "proof/f-2.json", "proof/f-3.json"], status: "provisional",
  };
  const cardRoot = path.join(root, "harness", "models", "cards", "project");
  await mkdir(cardRoot, { recursive: true });
  await writeFile(path.join(cardRoot, "promotion-route.json"), `${JSON.stringify(routingCard, null, 2)}\n`);
  const promotedPolicy = await compileRoutingPolicy(root);
  assert.equal(promotedPolicy.compiledFrom.harnessVersion, "h1");
  const promotedRoute = promotedPolicy.routes.find((route) => route.taskFamily === "bounded-repair");
  const promotedCandidate = promotedRoute?.candidates.find((candidate) => candidate.resolvedModel === "exact-model-1");
  assert.ok(
    promotedCandidate?.guardrails.includes(comparison.reviewed.skill.id),
    JSON.stringify({ promotedSkill: comparison.reviewed.skill, routes: promotedPolicy.routes }, null, 2),
  );
  const activeSkillPath = path.join(root, ...promotedManifest.activeSkillBindings[0].path.split("/"));
  const activeSkillBytes = await readFile(activeSkillPath);
  await writeFile(activeSkillPath, "tampered: true\n");
  await assert.rejects(() => compileRoutingPolicy(root), /active skill snapshot hash mismatch/);
  await writeFile(activeSkillPath, activeSkillBytes);
  const rollback = await rollbackHarness(root);
  assert.deepEqual({ from: rollback.from, to: rollback.to }, { from: "h1", to: "h0" });
  assert.equal(JSON.parse(await readFile(path.join(root, "harness", "versions", "current.json"), "utf8")).version, "h0");
  const rolledBackPolicy = await compileRoutingPolicy(root);
  assert.equal(rolledBackPolicy.compiledFrom.harnessVersion, "h0");
  const rolledBackRoute = rolledBackPolicy.routes.find((route) => route.taskFamily === "bounded-repair");
  const rolledBackCandidate = rolledBackRoute?.candidates.find((candidate) => candidate.resolvedModel === "exact-model-1");
  assert.equal(rolledBackCandidate?.guardrails.includes(comparison.reviewed.skill.id), false);
  assert.equal(JSON.parse(await readFile(path.join(comparison.reviewed.root, "candidate.json"), "utf8")).status, "proposed");
  await benchmarkSkillCandidate(root, candidateId, comparison.comparisonPath, { trustedKeys: signing.trustedKeys });
  await assert.rejects(() => promoteSkillCandidate(root, candidateId, {
    canaryPath, proofPath, approvalPath: approval.path, trustedKeys: signing.trustedKeys,
  }), /promotion approval was already consumed/);
});
