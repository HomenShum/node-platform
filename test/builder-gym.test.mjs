import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymContext,
  builderGymStatus,
  createBuilderGymLock,
  evaluateBuilderGym,
  initializeBuilderGym,
  inspectBuilderGymVerdict,
  inspectNodeTraceTrajectory,
  recordNodeTraceTrajectory,
  sealNodeTraceTrajectory,
  verifyBuilderGymVerdict,
  verifyBuilderGymLock,
  verifyNodeTraceTrajectory,
} from "../src/lib/builder-gym.mjs";
import { compileModelIntelligence, initializeHarness } from "../src/lib/model-intelligence.mjs";
import {
  benchmarkSkillCandidate,
  computeSkillEvidenceClosure,
  harnessStatus,
  promoteSkillCandidate,
  reviewSkillCandidate,
  sealSkillEvaluatorReceipt,
  sealSkillIntegrityReceipt,
  sealSkillPromotionApproval,
  verifyCanary,
  verifySkillBenchmarkVerdict,
} from "../src/lib/harness-gym.mjs";
import { createProject } from "../src/lib/scaffold.mjs";

const fixtureRoot = path.resolve("test", "fixtures", "builder-gym");
const HASH_A = "a".repeat(64);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceFixtureHashes(value, replacements) {
  let serialized = JSON.stringify(value);
  for (const [from, to] of Object.entries(replacements)) serialized = serialized.replaceAll(from, to);
  return JSON.parse(serialized);
}

async function preparedBuilderGym(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-builder-gym-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "gym-lab", target: root });
  const initialized = await initializeHarness(root);
  assert.equal(initialized.builder.automaticPromotion, false);
  const taskIndex = JSON.parse(await readFile(path.join(fixtureRoot, "protected-task-index.json"), "utf8"));
  await writeFile(path.join(root, "harness", "tasks", "heldout", "index.json"), `${JSON.stringify(taskIndex, null, 2)}\n`);
  const evidenceContent = "deterministic Builder Gym evidence\n";
  await mkdir(path.join(root, "proof", "builder-gym"), { recursive: true });
  await writeFile(path.join(root, "proof", "builder-gym", "evidence.txt"), evidenceContent);
  const baselineChangeSet = { schemaVersion: "nodekit.builder-change-set/v1", generatedBy: "external-orchestrator", baseRevision: "repository-parent", candidateRevision: "repository-baseline", lockHash: null, changedPaths: [] };
  const baselineChangeSetBytes = `${JSON.stringify(baselineChangeSet, null, 2)}\n`;
  await writeFile(path.join(root, "proof", "builder-gym", "baseline-change-set.json"), baselineChangeSetBytes);
  const context = await builderGymContext(root);
  const raw = JSON.parse(await readFile(path.join(fixtureRoot, "trajectory-template.json"), "utf8"));
  const baseline = sealNodeTraceTrajectory(replaceFixtureHashes(raw, {
    ["b".repeat(64)]: context.protectedTaskSetHash,
    ["e".repeat(64)]: context.evaluator.hash,
    ["f".repeat(64)]: digest(evidenceContent),
    ["8".repeat(64)]: digest(baselineChangeSetBytes),
  }));
  const lock = await createBuilderGymLock(root, baseline);
  const candidateInput = structuredClone(baseline);
  delete candidateInput.trajectoryId;
  delete candidateInput.trajectoryHash;
  candidateInput.arm = "candidate";
  candidateInput.runId = "builder-run-candidate";
  candidateInput.candidateId = "builder-h1-candidate";
  candidateInput.harness.builderHash = HASH_A;
  candidateInput.changedPaths = ["AGENTS.md"];
  const candidateChangeSet = { schemaVersion: "nodekit.builder-change-set/v1", generatedBy: "external-orchestrator", baseRevision: "repository-baseline", candidateRevision: "repository-candidate", lockHash: lock.lockHash, changedPaths: ["AGENTS.md"] };
  const candidateChangeSetBytes = `${JSON.stringify(candidateChangeSet, null, 2)}\n`;
  const candidateChangeSetHash = digest(candidateChangeSetBytes);
  await writeFile(path.join(root, "proof", "builder-gym", "candidate-change-set.json"), candidateChangeSetBytes);
  const { schemaVersion: _candidateSchemaVersion, ...candidateChangeSetBinding } = candidateChangeSet;
  candidateInput.changeSet = { ...candidateChangeSetBinding, evidencePath: "proof/builder-gym/candidate-change-set.json", evidenceHash: candidateChangeSetHash };
  candidateInput.evidence.push({ kind: "trace", path: "proof/builder-gym/candidate-change-set.json", sha256: candidateChangeSetHash });
  candidateInput.verdicts.task.score = 0.9;
  candidateInput.verdicts.artifact.score = 0.9;
  candidateInput.verdicts.ui.score = 0.85;
  candidateInput.verdicts.efficiency.score = 0.9;
  candidateInput.verdicts.efficiency.metrics.durationMs = 50000;
  candidateInput.verdicts.efficiency.metrics.tokensOut = 800;
  candidateInput.proofReceiptId = "nodeproof-builder-candidate";
  const candidate = sealNodeTraceTrajectory(candidateInput);
  return { baseline, candidate, context, lock, root };
}

async function writeSkillFixture(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(target, bytes);
  return { path: relativePath, sha256: digest(bytes), bytes: bytes.length };
}

function skillSigningFixture() {
  const evaluator = generateKeyPairSync("ed25519");
  const canary = generateKeyPairSync("ed25519");
  const integrity = generateKeyPairSync("ed25519");
  const approval = generateKeyPairSync("ed25519");
  const evaluatorKeyId = "protected-skill-evaluator-fixture";
  const canaryKeyId = "protected-skill-canary-fixture";
  const integrityKeyId = "independent-nodeproof-fixture";
  const approvalKeyId = "human-skill-promotion-approval-fixture";
  return {
    evaluator: {
      keyId: evaluatorKeyId,
      privateKey: evaluator.privateKey.export({ format: "pem", type: "pkcs8" }),
    },
    canary: {
      keyId: canaryKeyId,
      privateKey: canary.privateKey.export({ format: "pem", type: "pkcs8" }),
    },
    integrity: {
      keyId: integrityKeyId,
      privateKey: integrity.privateKey.export({ format: "pem", type: "pkcs8" }),
    },
    approval: {
      keyId: approvalKeyId,
      privateKey: approval.privateKey.export({ format: "pem", type: "pkcs8" }),
    },
    trustedKeys: {
      [evaluatorKeyId]: {
        publicKey: evaluator.publicKey.export({ format: "pem", type: "spki" }),
        purposes: ["skill-benchmark"],
      },
      [canaryKeyId]: {
        publicKey: canary.publicKey.export({ format: "pem", type: "spki" }),
        purposes: ["skill-canary"],
      },
      [integrityKeyId]: {
        publicKey: integrity.publicKey.export({ format: "pem", type: "spki" }),
        purposes: ["skill-integrity"],
      },
      [approvalKeyId]: {
        publicKey: approval.publicKey.export({ format: "pem", type: "spki" }),
        purposes: ["skill-promotion-approval"],
      },
    },
  };
}

async function writeSkillPromotionApproval(root, fixture, { verdictHash, canaryHash, integrityHash }) {
  const current = JSON.parse(await readFile(path.join(root, "harness", "versions", "current.json"), "utf8"));
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const approval = sealSkillPromotionApproval({
    schemaVersion: "nodekit.skill-promotion-approval/v1",
    purpose: "skill-promotion-approval",
    candidateId: fixture.candidateId,
    candidateSkillHash: fixture.reviewed.skillHash,
    benchmarkVerdictHash: verdictHash,
    canaryReceiptHash: canaryHash,
    integrityReceiptHash: integrityHash,
    currentHarnessVersion: current.version,
    currentHarnessManifestHash: current.manifestHash,
    approvedBy: "human-reviewer",
    nonce: "builder-approval-nonce-0001",
    issuedAt,
    expiresAt,
  }, { ...fixture.signing.approval, signedAt: issuedAt });
  const reference = await writeSkillFixture(root, "proof/skill-integrity/promotion-approval.json", approval);
  return path.join(root, ...reference.path.split("/"));
}

function protectedMetrics(success, targetFailureObserved) {
  return {
    success,
    targetFailureObserved,
    accuracy: 0.9,
    safety: 1,
    editability: 0.9,
    exportQuality: 0.9,
    userCompletion: 0.9,
    latencyMs: 1000,
    costUsd: 0.1,
  };
}

async function createSignedSkillRun(root, fixture, {
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
  const output = await writeSkillFixture(root, `proof/skill-evaluator/${runId}/output.json`, { runId, arm, result: metrics.success ? "completed" : "failed-safely" });
  const evaluation = await writeSkillFixture(root, `proof/skill-evaluator/${runId}/evaluation.json`, { runId, metrics, evaluator: fixture.context.evaluatorHash });
  const evidence = [
    { kind: "task", ...taskEvidence },
    { kind: "input", ...input },
    { kind: "output", ...output },
    { kind: "evaluation", ...evaluation },
  ];
  const closure = await computeSkillEvidenceClosure(root, evidence);
  const issuedAt = "2026-07-22T12:00:00.000Z";
  const receipt = sealSkillEvaluatorReceipt({
    schemaVersion: "nodekit.skill-evaluator-receipt/v1",
    purpose,
    candidateId: fixture.candidateId,
    arm,
    runId,
    benchmarkHash: fixture.context.benchmarkHash,
    harnessHash: fixture.context.harnessHash,
    evaluatorHash: fixture.context.evaluatorHash,
    resolvedModel: fixture.context.resolvedModel,
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
  const reference = await writeSkillFixture(root, `proof/skill-evaluator/receipts/${runId}.json`, receipt);
  return { receipt, reference: { path: reference.path, sha256: reference.sha256 } };
}

async function preparedProtectedSkillBenchmark(t) {
  const { root } = await preparedBuilderGym(t);
  const taskIndexPath = path.join(root, "harness", "tasks", "heldout", "index.json");
  const taskIndex = JSON.parse(await readFile(taskIndexPath, "utf8"));
  taskIndex.tasks.push({ id: "builder-task-2", family: "repository-legibility", title: "Verify a second fixed protected task" });
  await writeFile(taskIndexPath, `${JSON.stringify(taskIndex, null, 2)}\n`);

  const [compiled, gym] = await Promise.all([
    compileModelIntelligence(root, { write: false }),
    builderGymContext(root),
  ]);
  const candidateId = "skill-candidate-protected-receipts";
  const candidateRoot = path.join(root, "harness", "candidates", candidateId);
  await mkdir(candidateRoot, { recursive: true });
  const candidate = {
    schemaVersion: "nodekit.skill-candidate/v1",
    candidateId,
    status: "proposed",
    hypothesis: "Protected evaluator receipts will prove a bounded inspection guardrail.",
    expectedImpact: "Reduce uninspected completion while preserving protected dimensions.",
    risks: ["The guardrail may add bounded inspection latency."],
    sourceCluster: {
      failureClass: "NO_RESULT_INSPECTION",
      probableCause: "skill",
      model: "provider/exact-model-1",
      count: 3,
      taskIds: ["builder-task-1", "builder-task-2"],
      taskFamilies: ["repository-legibility"],
      evidenceRefs: ["proof/builder-gym/evidence.txt"],
    },
    skillFile: "skill.yaml",
    protectedBenchmarkHash: compiled.resolved.benchmarkHash,
    createdFromEvidence: true,
  };
  const skill = {
    schemaVersion: "nodekit.skill/v1",
    id: "protected-result-inspection",
    version: 1,
    kind: "guardrail",
    triggers: { taskFamilies: ["repository-legibility"], failureClasses: ["NO_RESULT_INSPECTION"], models: ["provider/exact-model-1"] },
    inputs: ["task", "result"],
    requiredTools: [],
    procedure: ["Inspect the produced result before declaring completion."],
    constraints: ["Never modify protected evaluator inputs."],
    completionChecks: ["The result has protected evaluator evidence."],
    failureBehavior: ["Fail safely and preserve the previous canonical artifact."],
    positiveExamples: ["Inspect, verify, then complete."],
    negativeExamples: ["Declare completion without reading the result."],
    expectedToolTraces: ["artifact inspection before completion"],
    testFixtures: ["builder-task-1", "builder-task-2"],
    evidenceRefs: ["proof/builder-gym/evidence.txt"],
  };
  await writeFile(path.join(candidateRoot, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
  await writeFile(path.join(candidateRoot, "skill.yaml"), `${JSON.stringify(skill, null, 2)}\n`);
  const reviewed = await reviewSkillCandidate(root, candidateId);
  const signing = skillSigningFixture();
  const fixture = {
    candidateId,
    context: {
      benchmarkHash: compiled.resolved.benchmarkHash,
      harnessHash: compiled.resolved.harnessHash,
      evaluatorHash: gym.evaluator.hash,
      resolvedModel: "provider/exact-model-1",
    },
    root,
    reviewed,
    signing,
  };
  const tasks = {
    "builder-task-1": await writeSkillFixture(root, "proof/skill-evaluator/tasks/builder-task-1.json", { taskId: "builder-task-1", instruction: "Inspect a bounded repository change." }),
    "builder-task-2": await writeSkillFixture(root, "proof/skill-evaluator/tasks/builder-task-2.json", { taskId: "builder-task-2", instruction: "Verify a bounded repository change." }),
  };
  tasks["builder-task-1"].taskId = "builder-task-1";
  tasks["builder-task-2"].taskId = "builder-task-2";
  const inputs = {
    "builder-task-1": await writeSkillFixture(root, "proof/skill-evaluator/inputs/builder-task-1.json", { taskId: "builder-task-1", input: "fixture-a" }),
    "builder-task-2": await writeSkillFixture(root, "proof/skill-evaluator/inputs/builder-task-2.json", { taskId: "builder-task-2", input: "fixture-b" }),
  };

  const baselineSkillHash = digest("immutable-baseline-skill");
  const plan = ["builder-task-1", "builder-task-1", "builder-task-2"];
  const arms = { baseline: [], candidate: [] };
  for (const [index, taskId] of plan.entries()) {
    const baseline = await createSignedSkillRun(root, fixture, {
      arm: "baseline",
      input: inputs[taskId],
      metrics: protectedMetrics(index !== 1, index === 1),
      runId: `baseline-${index + 1}`,
      skillHash: baselineSkillHash,
      task: tasks[taskId],
    });
    const improved = await createSignedSkillRun(root, fixture, {
      arm: "candidate",
      input: inputs[taskId],
      metrics: protectedMetrics(true, false),
      runId: `candidate-${index + 1}`,
      skillHash: reviewed.skillHash,
      task: tasks[taskId],
    });
    arms.baseline.push(baseline.reference);
    arms.candidate.push(improved.reference);
  }
  const comparison = {
    schemaVersion: "nodekit.skill-benchmark-input/v1",
    candidateId,
    ...fixture.context,
    baselineSkillHash,
    candidateSkillHash: reviewed.skillHash,
    taskInputs: Object.entries(tasks).map(([taskId, task]) => ({ taskId, taskHash: task.sha256, inputHash: inputs[taskId].sha256 })),
    arms,
  };
  const comparisonPath = path.join(root, "protected-comparison.json");
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  return { ...fixture, arms, baselineSkillHash, comparison, comparisonPath, inputs, tasks };
}

test("Harness Gym initializes one protected Builder Gym with seven explicit NodeTrace verdict dimensions", async (t) => {
  const { context, root } = await preparedBuilderGym(t);
  const repeated = await initializeBuilderGym(root);
  assert.deepEqual(repeated.created, []);
  assert.equal(repeated.evaluatorHash, context.evaluator.hash);
  const status = await builderGymStatus(root);
  assert.deepEqual(status.dimensions, NODETRACE_VERDICT_DIMENSIONS);
  assert.equal(status.protectedTaskCount, 1);
  assert.equal(status.mechanicsReady, true);
  assert.equal(status.realWorldEvidence, false);
  assert.equal(status.promotionAuthorized, false);
  const integrated = await harnessStatus(root);
  assert.equal(integrated.builderGym.mechanicsReady, true);
  assert.equal(integrated.builderGym.evaluatorHash, context.evaluator.hash);
  for (const candidateRoot of status.candidateWriteRoots) {
    assert.equal(status.protectedRoots.some((protectedRoot) => candidateRoot === protectedRoot || candidateRoot.startsWith(`${protectedRoot}/`) || protectedRoot.startsWith(`${candidateRoot}/`)), false);
  }
});

test("NodeTrace trajectories are content addressed and reject tampering or missing verdict evidence", async (t) => {
  const { baseline } = await preparedBuilderGym(t);
  const verified = await verifyNodeTraceTrajectory(baseline);
  assert.equal(verified.trajectoryHash, baseline.trajectoryHash);
  assert.equal(baseline.trajectoryId, `nodetrace:sha256:${baseline.trajectoryHash}`);
  assert.deepEqual(Object.keys(baseline.verdicts), NODETRACE_VERDICT_DIMENSIONS);
  assert.deepEqual(baseline.measurementAuthority, {
    dimensionVerdicts: "trajectory-self-reported",
    proofReceiptId: "trajectory-self-reported",
    protectedEvaluatorDerived: false,
  });

  const tampered = structuredClone(baseline);
  tampered.verdicts.task.score = 0;
  await assert.rejects(() => verifyNodeTraceTrajectory(tampered), /content hash mismatch/);

  const undeclaredEvidence = structuredClone(baseline);
  delete undeclaredEvidence.trajectoryId;
  delete undeclaredEvidence.trajectoryHash;
  undeclaredEvidence.verdicts.task.evidenceHashes = [HASH_A];
  await assert.rejects(() => verifyNodeTraceTrajectory(sealNodeTraceTrajectory(undeclaredEvidence)), /undeclared evidence hash/);

  const nonTerminal = structuredClone(baseline);
  delete nonTerminal.trajectoryId;
  delete nonTerminal.trajectoryHash;
  nonTerminal.events.at(-1).type = "verification";
  await assert.rejects(() => verifyNodeTraceTrajectory(sealNodeTraceTrajectory(nonTerminal)), /terminal completion event/);

  const invalidTime = structuredClone(baseline);
  delete invalidTime.trajectoryId;
  delete invalidTime.trajectoryHash;
  invalidTime.recordedAt = "not-a-time";
  await assert.rejects(() => verifyNodeTraceTrajectory(sealNodeTraceTrajectory(invalidTime)), /canonical UTC ISO-8601/);

  const falseEvaluatorAuthority = structuredClone(baseline);
  delete falseEvaluatorAuthority.trajectoryId;
  delete falseEvaluatorAuthority.trajectoryHash;
  falseEvaluatorAuthority.measurementAuthority.protectedEvaluatorDerived = true;
  await assert.rejects(() => verifyNodeTraceTrajectory(sealNodeTraceTrajectory(falseEvaluatorAuthority)), /must be equal to constant|self-reported/);
});

test("NodeTrace record and inspect reopen evidence bytes and preserve the immutable address", async (t) => {
  const { baseline, root } = await preparedBuilderGym(t);
  const recorded = await recordNodeTraceTrajectory(root, baseline);
  assert.match(recorded.output, new RegExp(`${baseline.trajectoryHash}\\.json$`));
  const inspected = await inspectNodeTraceTrajectory(root, baseline.trajectoryId);
  assert.equal(inspected.verified, true);
  assert.equal(inspected.trajectoryHash, baseline.trajectoryHash);

  await writeFile(path.join(root, "proof", "builder-gym", "evidence.txt"), "tampered\n");
  await assert.rejects(() => inspectNodeTraceTrajectory(root, baseline.trajectoryHash), /evidence hash mismatch/);
});

test("Builder Gym compares only the builder harness and keeps real-world claims and promotion disabled", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t);
  const verdict = await evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: lock.lockHash });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.outcome, "improved");
  assert.equal(verdict.protectedEvaluatorUnchanged, true);
  assert.equal(verdict.fixedInputsHeld, true);
  assert.equal(verdict.dimensions.task.outcome, "improved");
  assert.equal(verdict.dimensions.safety.outcome, "held");
  assert.equal(verdict.dimensions.efficiency.outcome, "improved");
  assert.equal(verdict.dimensions.humanPreference.outcome, "unmeasured");
  assert.equal(verdict.measurementAuthority, "trajectory-self-reported");
  assert.equal(verdict.protectedEvaluationPassed, false);
  assert.equal(verdict.realWorldClaimAuthorized, false);
  assert.equal(verdict.promotionAuthorized, false);
  assert.match(verdict.comparisonId, /^builder-gym:sha256:[a-f0-9]{64}$/);
  const inspected = await inspectBuilderGymVerdict(root, verdict.comparisonId);
  assert.equal(inspected.verified, true);
  const tamperedVerdict = structuredClone(inspected.verdict);
  tamperedVerdict.outcome = "held";
  await assert.rejects(() => verifyBuilderGymVerdict(tamperedVerdict), /content hash mismatch/);
  const falseProtectedPass = structuredClone(inspected.verdict);
  delete falseProtectedPass.comparisonId;
  delete falseProtectedPass.verdictHash;
  falseProtectedPass.protectedEvaluationPassed = true;
  await assert.rejects(() => verifyBuilderGymVerdict(falseProtectedPass), /must be equal to constant/);
});

test("Builder Gym rejects protected writes, evaluator drift, fixed-input drift, and safety regression", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t);
  await assert.rejects(() => evaluateBuilderGym(root, { baseline, candidate }), /protected pre-candidate lock/);
  await assert.rejects(() => evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: HASH_A }), /externally pinned identity/);
  const tamperedLock = structuredClone(lock);
  delete tamperedLock.output;
  tamperedLock.evaluatorHash = HASH_A;
  await assert.rejects(() => verifyBuilderGymLock(tamperedLock), /content hash mismatch/);

  const substitutedBaseline = structuredClone(baseline);
  delete substitutedBaseline.trajectoryId;
  delete substitutedBaseline.trajectoryHash;
  substitutedBaseline.runId = "substituted-baseline";
  await assert.rejects(() => evaluateBuilderGym(root, { baseline: sealNodeTraceTrajectory(substitutedBaseline), candidate, lock, expectedLockHash: lock.lockHash }), /does not match the protected lock/);
  const protectedWrite = structuredClone(candidate);
  delete protectedWrite.trajectoryId;
  delete protectedWrite.trajectoryHash;
  protectedWrite.changedPaths = ["harness/tasks/heldout/index.json"];
  const protectedChangeSet = { schemaVersion: "nodekit.builder-change-set/v1", generatedBy: "external-orchestrator", baseRevision: "repository-baseline", candidateRevision: "repository-protected-write", lockHash: lock.lockHash, changedPaths: protectedWrite.changedPaths };
  const protectedChangeSetBytes = `${JSON.stringify(protectedChangeSet, null, 2)}\n`;
  const protectedChangeSetHash = digest(protectedChangeSetBytes);
  await writeFile(path.join(root, "proof", "builder-gym", "protected-change-set.json"), protectedChangeSetBytes);
  const { schemaVersion: _protectedSchemaVersion, ...protectedChangeSetBinding } = protectedChangeSet;
  protectedWrite.changeSet = { ...protectedChangeSetBinding, evidencePath: "proof/builder-gym/protected-change-set.json", evidenceHash: protectedChangeSetHash };
  protectedWrite.evidence.push({ kind: "trace", path: "proof/builder-gym/protected-change-set.json", sha256: protectedChangeSetHash });
  await assert.rejects(() => recordNodeTraceTrajectory(root, sealNodeTraceTrajectory(protectedWrite)), /protected evaluator path/);

  const evaluatorDrift = structuredClone(candidate);
  delete evaluatorDrift.trajectoryId;
  delete evaluatorDrift.trajectoryHash;
  evaluatorDrift.evaluator.hash = HASH_A;
  await assert.rejects(() => recordNodeTraceTrajectory(root, sealNodeTraceTrajectory(evaluatorDrift)), /evaluator hash mismatch/);

  const modelDrift = structuredClone(candidate);
  delete modelDrift.trajectoryId;
  delete modelDrift.trajectoryHash;
  modelDrift.model.resolvedModel = "different-model";
  await assert.rejects(() => evaluateBuilderGym(root, { baseline, candidate: sealNodeTraceTrajectory(modelDrift), lock, expectedLockHash: lock.lockHash }), /protected fixed input/);

  const unsafe = structuredClone(candidate);
  delete unsafe.trajectoryId;
  delete unsafe.trajectoryHash;
  unsafe.runId = "builder-run-unsafe";
  unsafe.verdicts.safety.score = 0.9;
  const verdict = await evaluateBuilderGym(root, { baseline, candidate: sealNodeTraceTrajectory(unsafe), lock, expectedLockHash: lock.lockHash });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.regressedDimensions, ["safety"]);
  assert.equal(verdict.promotionAuthorized, false);

  const evaluatorPath = path.join(root, "harness", "evaluators", "builder", "protected-evaluator.json");
  const evaluator = JSON.parse(await readFile(evaluatorPath, "utf8"));
  evaluator.thresholds.maxTurnIncrease += 1;
  await writeFile(evaluatorPath, `${JSON.stringify(evaluator, null, 2)}\n`);
  await assert.rejects(() => evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: lock.lockHash }), /protected evaluator hash changed/);
});

test("NodeTrace rejects evidence paths that traverse a symlink or junction ancestor", async (t) => {
  const { baseline, root } = await preparedBuilderGym(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-builder-outside-"));
  t.after(() => rm(outside, { force: true, recursive: true }));
  await writeFile(path.join(outside, "evidence.txt"), "deterministic Builder Gym evidence\n");
  const link = path.join(root, "proof", "builder-gym", "linked-outside");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip(`link creation unavailable: ${error.code}`);
    throw error;
  }
  const escaped = structuredClone(baseline);
  delete escaped.trajectoryId;
  delete escaped.trajectoryHash;
  escaped.evidence[0].path = "proof/builder-gym/linked-outside/evidence.txt";
  await assert.rejects(() => recordNodeTraceTrajectory(root, sealNodeTraceTrajectory(escaped)), /symlink or junction/);
});

test("Builder Gym rejects hard-linked aliases inside protected evaluator roots", async (t) => {
  const { baseline, root } = await preparedBuilderGym(t);
  const evaluator = path.join(root, "harness", "evaluators", "builder", "protected-evaluator.json");
  const alias = path.join(root, "harness", "evaluators", "builder", "protected-evaluator-alias.json");
  try {
    await link(evaluator, alias);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error?.code)) return t.skip(`hard-link creation unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => createBuilderGymLock(root, baseline), /reuse one physical file|multiple hard links/);
});

test("concurrent Builder Gym fixtures do not confuse distinct Windows file identities", async (t) => {
  const fixtures = await Promise.all(Array.from({ length: 4 }, () => preparedBuilderGym(t)));
  assert.equal(fixtures.length, 4);
  assert.equal(fixtures.every((fixture) => fixture.lock.lockHash.length === 64), true);
  assert.equal(new Set(fixtures.map((fixture) => fixture.root)).size, fixtures.length);
});

test("content-addressed trajectory writes are exclusive, byte-idempotent, and reject prepared addresses", async (t) => {
  const { baseline, root } = await preparedBuilderGym(t);
  const output = path.join(root, "harness", "trajectories", "builder", "sha256", `${baseline.trajectoryHash}.json`);
  await writeFile(output, "prepared collision\n");
  await assert.rejects(() => recordNodeTraceTrajectory(root, baseline), /already exists with different bytes/);

  await rm(output, { force: true });
  const [first, second] = await Promise.all([
    recordNodeTraceTrajectory(root, baseline),
    recordNodeTraceTrajectory(root, baseline),
  ]);
  assert.equal(first.output, second.output);
  assert.equal(await readFile(output, "utf8"), `${JSON.stringify(baseline, null, 2)}\n`);
});

test("content-addressed trajectory writes reject a symlink or junction at the final address", async (t) => {
  const { baseline, root } = await preparedBuilderGym(t);
  const output = path.join(root, "harness", "trajectories", "builder", "sha256", `${baseline.trajectoryHash}.json`);
  await rm(output, { force: true });
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-builder-cas-outside-"));
  t.after(() => rm(outside, { force: true, recursive: true }));
  try {
    await symlink(outside, output, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip(`link creation unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => recordNodeTraceTrajectory(root, baseline), /symlink or junction/);
});

test("Builder Gym CLI exposes the same Harness Gym status instead of a second platform", async (t) => {
  const { baseline, candidate, root } = await preparedBuilderGym(t);
  const output = execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "builder", "status", "--repo-root", root, "--json"], { encoding: "utf8" });
  const status = JSON.parse(output);
  assert.equal(status.gymId, "nodekit-builder");
  assert.equal(status.mechanicsReady, true);
  assert.equal(status.realWorldEvidence, false);

  const baselinePath = path.join(root, "baseline-trajectory.json");
  const candidatePath = path.join(root, "candidate-trajectory.json");
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  const recorded = JSON.parse(execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "trajectory", "record", "--file", baselinePath, "--repo-root", root, "--json"], { encoding: "utf8" }));
  assert.equal(recorded.trajectoryHash, baseline.trajectoryHash);
  const traceInspection = JSON.parse(execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "trajectory", "inspect", "--ref", baseline.trajectoryId, "--repo-root", root, "--json"], { encoding: "utf8" }));
  assert.equal(traceInspection.verified, true);
  const lock = JSON.parse(execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "builder", "lock", "--baseline", baselinePath, "--repo-root", root, "--json"], { encoding: "utf8" }));
  const verdict = JSON.parse(execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "builder", "evaluate", "--lock", lock.lockId, "--expected-lock-hash", lock.lockHash, "--baseline", baselinePath, "--candidate", candidatePath, "--repo-root", root, "--json"], { encoding: "utf8" }));
  assert.equal(verdict.passed, true);
  const verdictInspection = JSON.parse(execFileSync(process.execPath, [path.resolve("src", "cli.mjs"), "harness", "builder", "inspect", "--ref", verdict.comparisonId, "--repo-root", root, "--json"], { encoding: "utf8" }));
  assert.equal(verdictInspection.verified, true);
});

test("skill benchmark verdicts are derived only from signed protected-evaluator receipts and recursive evidence", async (t) => {
  const fixture = await preparedProtectedSkillBenchmark(t);
  const selfAsserted = {
    schemaVersion: "nodekit.skill-comparison/v1",
    candidateId: fixture.candidateId,
    benchmarkHash: fixture.context.benchmarkHash,
    harnessHash: fixture.context.harnessHash,
    resolvedModel: fixture.context.resolvedModel,
    taskIds: ["builder-task-1", "builder-task-2"],
    baseline: { passed: false },
    candidate: { passed: true },
    protectedEvaluatorUnchanged: true,
  };
  const selfAssertedPath = path.join(fixture.root, "self-asserted-comparison.json");
  await writeFile(selfAssertedPath, `${JSON.stringify(selfAsserted, null, 2)}\n`);
  await assert.rejects(
    () => benchmarkSkillCandidate(fixture.root, fixture.candidateId, selfAssertedPath, { trustedKeys: fixture.signing.trustedKeys }),
    /skill benchmark input validation failed/,
  );

  const verdict = await benchmarkSkillCandidate(
    fixture.root,
    fixture.candidateId,
    fixture.comparisonPath,
    { trustedKeys: fixture.signing.trustedKeys },
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.measurementAuthority, "protected-evaluator-signed");
  assert.equal(verdict.protectedEvaluationPassed, true);
  assert.equal(verdict.promotionAuthorized, false);
  assert.equal(verdict.evaluatorReceipts.length, 6);
  assert.deepEqual(verdict.trustedKeyIds, [fixture.signing.evaluator.keyId]);
  assert.equal((await verifySkillBenchmarkVerdict(fixture.root, verdict, { trustedKeys: fixture.signing.trustedKeys })).verified, true);

  const firstReceipt = JSON.parse(await readFile(path.join(fixture.root, ...fixture.arms.candidate[0].path.split("/")), "utf8"));
  const outputReference = firstReceipt.evidence.find((entry) => entry.kind === "output");
  const outputPath = path.join(fixture.root, ...outputReference.path.split("/"));
  const originalOutput = await readFile(outputPath);
  await writeFile(outputPath, "tampered candidate output\n");
  await assert.rejects(
    () => verifySkillBenchmarkVerdict(fixture.root, verdict, { trustedKeys: fixture.signing.trustedKeys }),
    /skill evidence hash mismatch/,
  );
  await writeFile(outputPath, originalOutput);

  const forged = structuredClone(verdict);
  forged.arms.candidate.successRate = 0;
  await assert.rejects(
    () => verifySkillBenchmarkVerdict(fixture.root, forged, { trustedKeys: fixture.signing.trustedKeys }),
    /content address mismatch/,
  );
});

test("skill promotion reopens benchmark canary and independent integrity evidence before any write", async (t) => {
  const fixture = await preparedProtectedSkillBenchmark(t);
  const verdict = await benchmarkSkillCandidate(
    fixture.root,
    fixture.candidateId,
    fixture.comparisonPath,
    { trustedKeys: fixture.signing.trustedKeys },
  );
  const canaryResult = await createSignedSkillRun(fixture.root, fixture, {
    arm: "canary",
    canary: { freshContext: true, humanReprompts: 0, substantiveChanges: true, checksPassed: true },
    input: fixture.inputs["builder-task-1"],
    metrics: protectedMetrics(true, false),
    purpose: "skill-canary",
    runId: "canary-1",
    skillHash: fixture.reviewed.skillHash,
    task: fixture.tasks["builder-task-1"],
  });
  const canaryPath = path.join(fixture.root, ...canaryResult.reference.path.split("/"));
  assert.equal((await verifyCanary(fixture.root, canaryPath, { trustedKeys: fixture.signing.trustedKeys })).verified, true);

  const oldCanaryPath = path.join(fixture.root, "self-asserted-canary.json");
  await writeFile(oldCanaryPath, `${JSON.stringify({ schemaVersion: "nodekit.canary-receipt/v1", candidateId: fixture.candidateId, passed: true, checksPassed: true }, null, 2)}\n`);
  await assert.rejects(
    () => verifyCanary(fixture.root, oldCanaryPath, { trustedKeys: fixture.signing.trustedKeys }),
    /skill evaluator receipt validation failed/,
  );

  const forgedCanary = structuredClone(canaryResult.receipt);
  forgedCanary.metrics.accuracy = 0.1;
  const forgedCanaryPath = path.join(fixture.root, "forged-canary.json");
  await writeFile(forgedCanaryPath, `${JSON.stringify(forgedCanary, null, 2)}\n`);
  await assert.rejects(
    () => verifyCanary(fixture.root, forgedCanaryPath, { trustedKeys: fixture.signing.trustedKeys }),
    /content address mismatch/,
  );

  const leaf = await writeSkillFixture(fixture.root, "proof/skill-integrity/leaf.json", { independentCheck: "passed", candidateId: fixture.candidateId });
  const report = await writeSkillFixture(fixture.root, "proof/skill-integrity/report.json", {
    schemaVersion: "nodeproof.skill-integrity-evidence/v1",
    evidence: [{ kind: "independent-check", ...leaf }],
  });
  const integrityEvidence = [{ kind: "nodeproof-report", ...report }];
  const integrityClosure = await computeSkillEvidenceClosure(fixture.root, integrityEvidence);
  const issuedAt = "2026-07-22T12:05:00.000Z";
  const integrityReceipt = sealSkillIntegrityReceipt({
    schemaVersion: "nodekit.skill-integrity-receipt/v1",
    candidateId: fixture.candidateId,
    benchmarkVerdictHash: verdict.verdictHash,
    canaryReceiptHash: canaryResult.receipt.receiptHash,
    passed: true,
    integrityVerified: true,
    measurementAuthority: "independent-nodeproof-signed",
    candidateAuthored: false,
    evidence: integrityEvidence,
    evidenceRootSha256: integrityClosure.rootHash,
    issuedAt,
  }, { ...fixture.signing.integrity, signedAt: issuedAt });
  const proofReference = await writeSkillFixture(fixture.root, "proof/skill-integrity/receipt.json", integrityReceipt);
  const proofPath = path.join(fixture.root, ...proofReference.path.split("/"));
  const approvalPath = await writeSkillPromotionApproval(fixture.root, fixture, {
    verdictHash: verdict.verdictHash,
    canaryHash: canaryResult.receipt.receiptHash,
    integrityHash: integrityReceipt.receiptHash,
  });

  await assert.rejects(
    () => promoteSkillCandidate(fixture.root, fixture.candidateId, { canaryPath, proofPath, trustedKeys: fixture.signing.trustedKeys }),
    /detached skill promotion approval/,
  );
  const originalLeaf = await readFile(path.join(fixture.root, ...leaf.path.split("/")));
  await writeFile(path.join(fixture.root, ...leaf.path.split("/")), "tampered independent proof\n");
  await assert.rejects(
    () => promoteSkillCandidate(fixture.root, fixture.candidateId, {
      approvalPath,
      canaryPath,
      proofPath,
      trustedKeys: fixture.signing.trustedKeys,
    }),
    /skill evidence hash mismatch/,
  );
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, "harness", "versions", "current.json"), "utf8")).version, "h0");
  await writeFile(path.join(fixture.root, ...leaf.path.split("/")), originalLeaf);

  const promoted = await promoteSkillCandidate(fixture.root, fixture.candidateId, {
    approvalPath,
    canaryPath,
    proofPath,
    trustedKeys: fixture.signing.trustedKeys,
  });
  assert.equal(promoted.nextVersion, "h1");
  assert.equal(promoted.promotion.automatic, false);
  assert.equal(promoted.promotion.nodeProofVerified, true);
});
