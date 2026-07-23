import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, open, cp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  evidenceContractPasses,
  evaluateSubmissionManifest,
  parseGitStatusZ,
  portableEvidencePath,
  readSubmissionEvidenceFile,
  requiredSubmissionGates,
  resolveSubmissionEvidenceClosure,
  submissionEvidenceRootSha256,
  transitiveSubmissionEvidence,
  validateSubmissionScreenshotPng,
} from "../src/lib/submission-gate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { knowledgeRuntimeHash } from "../src/lib/knowledge-runtime.mjs";
import { exactSubmissionVerdicts, submissionEvidenceFixtureBytes, submissionEvidenceFixtureClosure, submissionFixtureTrustedKeys } from "./submission-fixtures.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
let testPngCrcTable;
function testPngCrc32(bytes) {
  testPngCrcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = testPngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function testPngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(testPngCrc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return chunk;
}
const canonicalGatePaths = {
  developerTimingMatrix: "proof/ease/developer-timing-verdict.json",
  freshAgentHeldout: "proof/ease/fresh-agent-verdict.json",
  freshHumanUsability: "proof/ease/fresh-users-verdict.json",
  threeConvexConsumers: "proof/convex-consumers-verdict.json",
  previewDeployment: "proof/preview-verdict.json",
  managedSupabasePortability: "proof/managed-supabase-portability-verdict.json",
  knowledgeEvolutionAdoption: "proof/knowledge-evolution-adoption-verdict.json",
  modelIntelligenceHarness: "proof/model-intelligence-harness-verdict.json",
  engineeringHealth: "proof/engineering-health-verdict.json",
  proofloopEaseVerification: "proof/proofloop-final.json",
  packageInstallProof: "proof/package-install-verdict.json",
  publicationApproval: "proof/publication-approval.json",
};

async function writeGateEvidence(root, id, value, relative = canonicalGatePaths[id], { includeBrowserClosure = true } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), bytes);
  const evidence = [{ path: relative, sha256: digest(bytes) }];
  const deferredBrowserClosure = [];
  const deferredProtectedManifests = [];
  for (const reference of transitiveSubmissionEvidence(id, value)) {
    const candidateCommit = value.nodekitCommit ?? value.candidateCommit ?? value.subject?.repository?.candidateCommit;
    const sourceHash = value.nodekitSourceHash ?? value.subject?.repository?.nodekitSourceHash;
    const isDecisiveCrossReference = Object.values(canonicalGatePaths).includes(reference.path);
    const nestedBytes = isDecisiveCrossReference ? null : submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    if (nestedBytes) {
      await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
      await writeFile(path.join(root, reference.path), nestedBytes);
    }
    evidence.push({ path: reference.path, sha256: reference.sha256 });
    // Candidate-authored browser bytes are diagnostic only for freshAgentHeldout:
    // the decisive UI closure hangs off the protected evaluator instead, so
    // declaring these children would surface as undeclared extra evidence.
    if (includeBrowserClosure && reference.kind === "screenshot-manifest" && id !== "freshAgentHeldout") {
      for (const child of submissionEvidenceFixtureClosure(reference.path, candidateCommit, sourceHash)) {
        const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), childBytes);
        deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
      }
    }
    // The protected browser manifest is synthesized by the closure walker from
    // the protected evaluation rather than named by the verdict, so it has to be
    // materialized here even though nothing in the verdict points at it.
    if (includeBrowserClosure && id === "freshAgentHeldout" && reference.kind === "protected-evaluation") {
      const evaluation = JSON.parse(submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash).toString("utf8"));
      deferredProtectedManifests.push(path.posix.join(path.posix.dirname(reference.path), evaluation.protectedBrowserManifestFile));
    }
    if (reference.kind === "protected-comparison") {
      for (const child of submissionEvidenceFixtureClosure(reference.path, candidateCommit, sourceHash)) {
        const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), childBytes);
        deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
      }
    }
  }
  // The walker only discovers these while draining the direct references, so
  // they land after all of them and ahead of their own screenshot children.
  for (const protectedManifestPath of deferredProtectedManifests) {
    const candidateCommit = value.nodekitCommit ?? value.candidateCommit ?? value.subject?.repository?.candidateCommit;
    const sourceHash = value.nodekitSourceHash ?? value.subject?.repository?.nodekitSourceHash;
    const protectedManifestBytes = submissionEvidenceFixtureBytes(protectedManifestPath, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, protectedManifestPath)), { recursive: true });
    await writeFile(path.join(root, protectedManifestPath), protectedManifestBytes);
    evidence.push({ path: protectedManifestPath, sha256: digest(protectedManifestBytes) });
    for (const child of submissionEvidenceFixtureClosure(protectedManifestPath, candidateCommit, sourceHash)) {
      const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
      await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
      await writeFile(path.join(root, child.path), childBytes);
      deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
    }
  }
  evidence.push(...deferredBrowserClosure);
  return evidence;
}

function submissionManifest(candidateCommit, candidateSourceHash, gates, releaseCandidate = null) {
  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    candidateSourceHash,
    releaseCandidate: releaseCandidate ?? {
      nodekitCommit: candidateCommit,
      nodekitSourceHash: candidateSourceHash,
      nodekitTarballSha256: "0".repeat(64),
      packageName: "@homenshum/nodekit",
      packageVersion: "0.0.0-unverified",
    },
    gates,
  };
  return { ...manifest, evidenceRootSha256: submissionEvidenceRootSha256(gates) };
}

test("decisive evidence contracts reject shallow counts and unproven live adoption", () => {
  const candidateCommit = "a".repeat(40);
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  for (const id of requiredSubmissionGates) assert.equal(evidenceContractPasses(id, verdicts[id]), true, id);
  for (const id of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    const unsigned = structuredClone(exactSubmissionVerdicts(candidateCommit)[id]);
    delete unsigned.attestationPayload;
    delete unsigned.attestation;
    assert.equal(evidenceContractPasses(id, unsigned), false, `${id} accepted candidate-authored evidence without external trust`);
  }
  assert.equal(evidenceContractPasses("developerTimingMatrix", { schemaVersion: "nodekit.developer-timing-verdict/v1", passed: true, observedRuns: 60 }), false);
  assert.equal(evidenceContractPasses("freshHumanUsability", { schemaVersion: "nodekit.fresh-user-verdict/v1", passed: true, metrics: { participantCount: 5 } }), false);
  const aggregateOnlyTiming = structuredClone(verdicts.developerTimingMatrix);
  delete aggregateOnlyTiming.selectedRuns;
  assert.equal(evidenceContractPasses("developerTimingMatrix", aggregateOnlyTiming), false);
  const unboundHumanEvidence = structuredClone(verdicts.freshHumanUsability);
  unboundHumanEvidence.selectedParticipants[0].evidenceRefs = [];
  assert.equal(evidenceContractPasses("freshHumanUsability", unboundHumanEvidence), false);
  assert.equal(evidenceContractPasses("threeConvexConsumers", { schemaVersion: "nodekit.convex-consumers-verdict/v1", candidateCommit, passed: true, qualifyingConsumers: 3 }), false);
  verdicts.freshAgentHeldout.selectedRuns.pop();
  verdicts.freshAgentHeldout.observedTrials = 14;
  assert.equal(evidenceContractPasses("freshAgentHeldout", verdicts.freshAgentHeldout), false);
  verdicts.freshAgentHeldout = exactSubmissionVerdicts(candidateCommit).freshAgentHeldout;
  verdicts.freshAgentHeldout.selectedRuns.find((entry) => entry.agentProfile === "lower-cost").agentModel = null;
  assert.equal(evidenceContractPasses("freshAgentHeldout", verdicts.freshAgentHeldout), false);
  verdicts.threeConvexConsumers.consumers[0].liveFlowAdoption.passed = false;
  assert.equal(evidenceContractPasses("threeConvexConsumers", verdicts.threeConvexConsumers), false);
  const packageProof = exactSubmissionVerdicts(candidateCommit).packageInstallProof;
  packageProof.checks.candidateIdentityStable = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.checks.candidateIdentityStable = true;
  packageProof.checks.unreportedCheck = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  delete packageProof.checks.unreportedCheck;
  packageProof.distributionChecks.convexComponentRuntime = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.distributionChecks.convexComponentRuntime = true;
  packageProof.distributionChecks.builderGym = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.distributionChecks.builderGym = true;
  packageProof.supportingEvidence.pop();
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  const timing = exactSubmissionVerdicts(candidateCommit).developerTimingMatrix;
  timing.supportingEvidence = [];
  assert.equal(evidenceContractPasses("developerTimingMatrix", timing), false);
  const preview = exactSubmissionVerdicts(candidateCommit).previewDeployment;
  preview.screenshotCount = 12;
  assert.equal(evidenceContractPasses("previewDeployment", preview), false);
  const supabase = exactSubmissionVerdicts(candidateCommit).managedSupabasePortability;
  supabase.exportImport.targetReceiptSha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("managedSupabasePortability", supabase), false, "managed portability must preserve exact receipt identity");
  const selfHostedLookalike = exactSubmissionVerdicts(candidateCommit).managedSupabasePortability;
  selfHostedLookalike.projectUrl = "https://supabase.example.test";
  assert.equal(evidenceContractPasses("managedSupabasePortability", selfHostedLookalike), false, "the managed-service gate cannot be satisfied by an arbitrary HTTPS endpoint");
  const evolution = exactSubmissionVerdicts(candidateCommit).knowledgeEvolutionAdoption;
  evolution.comparison.evolvingGraphScore = 0.6;
  assert.equal(evidenceContractPasses("knowledgeEvolutionAdoption", evolution), false, "evolving knowledge must not underperform either protected baseline");
  const model = exactSubmissionVerdicts(candidateCommit).modelIntelligenceHarness;
  model.promotionStatus = "promoted";
  assert.equal(evidenceContractPasses("modelIntelligenceHarness", model), false, "an observation cannot self-promote a model");
  const engineering = exactSubmissionVerdicts(candidateCommit).engineeringHealth;
  engineering.unresolved.p1 = 1;
  assert.equal(evidenceContractPasses("engineeringHealth", engineering), false, "engineering health requires zero unresolved P0/P1 issues");
  for (const [id, field] of [
    ["managedSupabasePortability", "testedAt"],
    ["knowledgeEvolutionAdoption", "completedAt"],
    ["modelIntelligenceHarness", "observedAt"],
    ["engineeringHealth", "completedAt"],
  ]) {
    const invalidTimestamp = exactSubmissionVerdicts(candidateCommit)[id];
    invalidTimestamp[field] = "2026-02-30T00:00:00.000Z";
    assert.equal(evidenceContractPasses(id, invalidTimestamp), false, `${id} accepted a non-existent calendar timestamp`);
  }
  const alteredHumanOutcome = exactSubmissionVerdicts(candidateCommit).freshHumanUsability;
  alteredHumanOutcome.selectedParticipants[0].wrongTurns = 1;
  assert.equal(evidenceContractPasses("freshHumanUsability", alteredHumanOutcome), false, "signed verdict body cannot be rewritten");
  const alteredConsumerEvidence = exactSubmissionVerdicts(candidateCommit).threeConvexConsumers;
  alteredConsumerEvidence.consumers[0].evidence[1].sha256 = "f".repeat(64);
  alteredConsumerEvidence.consumers[0].verdictSha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("threeConvexConsumers", alteredConsumerEvidence), false, "signed evidence root cannot be rewritten");
  const proofLoop = exactSubmissionVerdicts(candidateCommit).proofloopEaseVerification;
  proofLoop.extensions.decisiveEvidence[0].sha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("proofloopEaseVerification", proofLoop), false, "ProofLoop signature must bind the ordered decisive evidence set");
  const malformedProofLoop = exactSubmissionVerdicts(candidateCommit).proofloopEaseVerification;
  malformedProofLoop.extensions.decisiveEvidence[0].candidateAuthoredKey = true;
  assert.equal(evidenceContractPasses("proofloopEaseVerification", malformedProofLoop), false, "malformed ProofLoop evidence must fail closed without throwing");
});

test("evidence paths are canonical and browser certification closes over every byte", async () => {
  for (const alias of ["./proof/x", "proof/./x", "proof//x", "proof/x/", "proof/../x", "C:/proof/x", "proof\\x"]) {
    assert.equal(portableEvidencePath(alias), false, alias);
  }
  assert.equal(portableEvidencePath("proof/browser/screenshot-manifest.json"), true);

  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-browser-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const manifestPath = "proof/preview/browser/screenshot-manifest.json";
  const manifestBytes = submissionEvidenceFixtureBytes(manifestPath, candidateCommit, sourceHash);
  await mkdir(path.dirname(path.join(root, manifestPath)), { recursive: true });
  await writeFile(path.join(root, manifestPath), manifestBytes);
  const children = submissionEvidenceFixtureClosure(manifestPath, candidateCommit, sourceHash);
  await Promise.all(children.map(async (child) => {
    const bytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
    await writeFile(path.join(root, child.path), bytes);
  }));
  const browserManifest = JSON.parse(manifestBytes.toString("utf8"));
  const value = {
    applicationHash: browserManifest.applicationHash,
    configHash: browserManifest.configHash,
    deploymentCommit: browserManifest.generatedCandidateCommit,
    evidence: [{ kind: "screenshot-manifest", path: manifestPath, sha256: digest(manifestBytes) }],
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${sourceHash}`,
    nodekitSourceHash: sourceHash,
    releaseCandidate: {
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitTarballSha256: browserManifest.nodekitTarballSha256,
      packageName: "@homenshum/nodekit",
      packageVersion: "0.2.1",
    },
  };
  const closure = await resolveSubmissionEvidenceClosure(root, "previewDeployment", value);
  assert.equal(closure.length, 1 + 180 * 2 + 5);
  const tampered = children.find((entry) => entry.path.endsWith("first_arrival--desktop--light.png"));
  await writeFile(path.join(root, tampered.path), "tampered\n");
  await assert.rejects(() => resolveSubmissionEvidenceClosure(root, "previewDeployment", value), /hash mismatch/);
});

test("engineering health recomputes command identity and unresolved P0/P1 from machine evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-engineering-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).engineeringHealth;
  for (const reference of transitiveSubmissionEvidence("engineeringHealth", verdict)) {
    const bytes = submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
    await writeFile(path.join(root, reference.path), bytes);
  }
  assert.equal((await resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict)).length, 11);

  const command = verdict.commands[0];
  const validCommandBytes = submissionEvidenceFixtureBytes(command.path, candidateCommit, sourceHash);
  const invalidCommandReceipt = JSON.parse(validCommandBytes.toString("utf8"));
  invalidCommandReceipt.startedAt = "2026-02-30T00:00:00.000Z";
  const invalidCommandBytes = Buffer.from(`${JSON.stringify(invalidCommandReceipt)}\n`);
  await writeFile(path.join(root, command.path), invalidCommandBytes);
  command.sha256 = digest(invalidCommandBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /engineering check receipt does not match/,
  );
  await writeFile(path.join(root, command.path), validCommandBytes);
  command.sha256 = digest(validCommandBytes);

  const invalidTimestampInventory = {
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    generatedAt: "2026-02-30T00:00:00.000Z",
    counts: { p0: 0, p1: 0 },
    issues: [],
  };
  const invalidTimestampInventoryBytes = Buffer.from(`${JSON.stringify(invalidTimestampInventory)}\n`);
  await writeFile(path.join(root, verdict.issueInventory.path), invalidTimestampInventoryBytes);
  verdict.issueInventory.sha256 = digest(invalidTimestampInventoryBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /does not prove zero unresolved/,
  );

  const inventory = {
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    generatedAt: "2026-07-22T00:00:01.000Z",
    counts: { p0: 0, p1: 1 },
    issues: [{ id: "P1-OPEN", severity: "p1", status: "open", source: "independent issue inventory" }],
  };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory)}\n`);
  await writeFile(path.join(root, verdict.issueInventory.path), inventoryBytes);
  verdict.issueInventory.sha256 = digest(inventoryBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /does not prove zero unresolved P0\/P1 issues/,
  );
});

test("knowledge adoption closure recomputes protected cases, aggregates, and execution bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).knowledgeEvolutionAdoption;
  await writeGateEvidence(root, "knowledgeEvolutionAdoption", verdict);
  const complete = await resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict);
  assert.equal(complete.length, 18);

  const comparisonPath = path.join(root, "proof/evolution/protected-comparison.json");
  const comparison = JSON.parse(await readFile(comparisonPath, "utf8"));
  comparison.profiles.flat.successRate = 0.5;
  const { resultSha256: ignoredResultSha256, ...comparisonBody } = comparison;
  comparison.resultSha256 = knowledgeRuntimeHash(comparisonBody);
  const alteredBytes = Buffer.from(`${JSON.stringify(comparison)}\n`);
  await writeFile(comparisonPath, alteredBytes);
  verdict.evidence.find((entry) => entry.kind === "protected-comparison").sha256 = digest(alteredBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict),
    /not reproducible from its exact graph, definition, and execution receipts|aggregate does not match its cases/,
  );

  const originalBytes = submissionEvidenceFixtureBytes("proof/evolution/protected-comparison.json", candidateCommit, sourceHash);
  await writeFile(comparisonPath, originalBytes);
  verdict.evidence.find((entry) => entry.kind === "protected-comparison").sha256 = digest(originalBytes);
  const executionPath = path.join(root, "proof/evolution/executions/flat-direct-fact.json");
  await writeFile(executionPath, "tampered execution\n");
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict),
    /execution receipt evidence hash mismatch|evidence closure hash mismatch/,
  );
});

test("submission gate requires all evidence, hashes, and explicit approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  const freshAgentSources = [
    "evals/ease/heldout-tasks.json",
    "scripts/run-agent-ease-trial.mjs",
    "scripts/run-protected-browser-lane.mjs",
    "scripts/run-agent-provider-broker.mjs",
    "scripts/run-protected-agent-evaluator.mjs",
  ];
  for (const relative of freshAgentSources) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), submissionEvidenceFixtureBytes(relative));
  }
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json", ...freshAgentSources], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) {
    gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id]) });
  }
  const manifest = submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate);
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const ready = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(ready.submissionReady, true, ready.errors.join("\n"));
  const noTrustStore = await evaluateSubmissionManifest(root, "proof/submission-manifest.json");
  assert.equal(noTrustStore.submissionReady, false);
  for (const id of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    assert.match(noTrustStore.errors.join("\n"), new RegExp(`${id}: trusted detached attestation failed`));
  }
  const candidatePath = path.join(root, "proof", "submission-candidate.json");
  const candidateBytes = await readFile(candidatePath);
  await writeFile(candidatePath, `${candidateBytes.toString("utf8").trim()} \n`);
  const candidateTampered = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(candidateTampered.submissionReady, false);
  assert.match(candidateTampered.errors.join("\n"), /submission-candidate\.json|signed submission candidate/);
  await writeFile(candidatePath, candidateBytes);
  manifest.gates.at(-1).passed = false;
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const blocked = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(blocked.submissionReady, false);
  assert.match(blocked.errors.join("\n"), /publicationApproval: not passed/);
});

test("submission gate rejects stale source revisions and evidence without decisive contracts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-stale-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "changed.mjs"), "export default true;\n");
  execFileSync("git", ["add", "src/changed.mjs"], { cwd: root });
  execFileSync("git", ["commit", "-m", "source changed"], { cwd: root, stdio: "ignore" });
  const evidence = Buffer.from(`${JSON.stringify({ schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit: candidateCommit, passed: true, observedRuns: 60 })}\n`);
  await writeFile(path.join(root, "proof", "shared.json"), evidence);
  const manifest = submissionManifest(candidateCommit, candidateSourceHash,
    requiredSubmissionGates.map((id) => ({ id, passed: true, evidence: [{ path: "proof/shared.json", sha256: digest(evidence) }] })));
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const verdict = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /candidateCommit is stale/);
  assert.match(verdict.errors.join("\n"), /requires exactly one exact-candidate decisive verdict/);
});

test("submission gate rejects uncommitted source and incomplete package proof", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-dirty-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  verdicts.packageInstallProof.checks = {};
  const gates = [];
  for (const id of requiredSubmissionGates) {
    gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  }
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  await writeFile(path.join(root, "src", "dirty.mjs"), "export default true;\n");
  const verdict = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /working tree contains uncommitted source changes/);
  assert.match(verdict.errors.join("\n"), /packageInstallProof: requires exactly one exact-candidate decisive verdict/);
});

test("submission gate rejects tampered, omitted, and extra transitive evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-transitive-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  const manifestPath = path.join(root, "proof", "submission-manifest.json");
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  const packageGate = gates.find((gate) => gate.id === "packageInstallProof");
  const tamperedPath = verdicts.packageInstallProof.supportingEvidence[0].path;
  await writeFile(path.join(root, tamperedPath), "tampered\n");
  let result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /evidence hash mismatch/);
  await writeFile(path.join(root, tamperedPath), submissionEvidenceFixtureBytes(tamperedPath));
  packageGate.evidence = packageGate.evidence.filter((entry) => entry.path !== tamperedPath);
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /transitive evidence is missing from the submission manifest/);
  packageGate.evidence.push({ path: "proof/extra.txt", sha256: digest("extra\n") });
  await writeFile(path.join(root, "proof", "extra.txt"), "extra\n");
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /undeclared extra evidence/);
});

test("submission gate rejects evidence reached through an escaping junction", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-symlink-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  const target = verdicts.previewDeployment.evidence.at(-1);
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-outside-"));
  await writeFile(path.join(outside, "cleanup-receipt.json"), submissionEvidenceFixtureBytes(target.path));
  const parent = path.dirname(path.join(root, target.path));
  await rm(parent, { recursive: true, force: true });
  try {
    await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  const result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /symlink escapes repository|evidence unavailable/);
});

test("submission evidence reader rejects a single hard-linked path to outside mutable bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-hardlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-hardlink-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const source = path.join(outside, "outside.json");
  const target = path.join(root, "evidence.json");
  await writeFile(source, "{\"forged\":true}\n");
  try {
    await link(source, target);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error?.code)) return t.skip(`hard links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => readSubmissionEvidenceFile(root, "evidence.json"), /regular unaliased|multiple hard links/);
});

test("submission evidence reader rejects oversized sparse files before reading their bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-evidence-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "proof"), { recursive: true });
  const target = path.join(root, "proof", "oversized.bin");
  const handle = await open(target, "w");
  try {
  await handle.truncate((32 * 1024 * 1024) + 1);
  } finally {
    await handle.close();
  }
  await assert.rejects(
    () => readSubmissionEvidenceFile(root, "proof/oversized.bin"),
    /exceeds the 33554432-byte verifier limit/,
  );
});

test("screenshot validation canonicalizes metadata-only PNG changes to one decoded pixel identity", () => {
  const original = submissionEvidenceFixtureBytes("proof/preview/browser/screenshots/first_arrival--desktop--light.png");
  const iend = original.subarray(original.length - 12);
  const changedMetadata = Buffer.concat([
    original.subarray(0, original.length - 12),
    testPngChunk("tEXt", Buffer.from("extra-proof-label\0different-file-bytes", "utf8")),
    iend,
  ]);
  assert.notEqual(digest(original), digest(changedMetadata));
  const expectation = { tuple: "first_arrival/desktop/light", screenshot: { viewport: { width: 1440, height: 900 } } };
  assert.equal(
    validateSubmissionScreenshotPng(original, expectation).pixelSha256,
    validateSubmissionScreenshotPng(changedMetadata, expectation).pixelSha256,
  );
});

test("screenshot validation rejects oversized PNG input before decoding or concatenating chunks", () => {
  const oversized = Buffer.alloc((25 * 1024 * 1024) + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);
  assert.throws(
    () => validateSubmissionScreenshotPng(oversized, { tuple: "oversized/desktop/light", screenshot: { viewport: { width: 1440, height: 900 } } }),
    /exceeds the 26214400-byte verifier limit/,
  );
});

test("null-delimited Git status parsing preserves rename endpoints and embedded newlines", () => {
  const paths = parseGitStatusZ(Buffer.from("R  docs/new\nname.txt\0src/old name.txt\0?? src/untracked\nfile.mjs\0"));
  assert.deepEqual(paths, ["docs/new\nname.txt", "src/old name.txt", "src/untracked\nfile.mjs"]);
});
