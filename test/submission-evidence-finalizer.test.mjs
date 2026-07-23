import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FINALIZABLE_EXTERNAL_GATES,
  FINALIZABLE_SUBMISSION_GATES,
  finalizeSubmissionEvidence,
  SIGNING_KEY_POLICY_SCHEMA_VERSION,
} from "../src/lib/submission-evidence-finalizer.mjs";
import { evidenceContractPasses, transitiveSubmissionEvidence } from "../src/lib/submission-gate.mjs";
import { verifyDetachedAttestation } from "../src/lib/submission-attestation.mjs";
import {
  exactSubmissionVerdicts,
  submissionEvidenceFixtureBytes,
  submissionEvidenceFixtureClosure,
} from "./submission-fixtures.mjs";

const candidateCommit = "a".repeat(40);
const sourceHash = "b".repeat(64);
const signedAt = "2026-07-22T12:34:56.000Z";

test("one-purpose policy schema enumerates every and only supported finalization mode", async () => {
  const schema = JSON.parse(await readFile("schemas/nodekit.attestation-signing-key-policy.v1.schema.json", "utf8"));
  assert.deepEqual(schema.properties.purposes.items.enum, FINALIZABLE_SUBMISSION_GATES);
  assert.equal(schema.properties.purposes.minItems, 1);
  assert.equal(schema.properties.purposes.maxItems, 1);
});

function unsigned(value) {
  const copy = structuredClone(value);
  delete copy.attestationPayload;
  delete copy.attestation;
  return copy;
}

function releaseIdentity(value) {
  return {
    candidateCommit: value.releaseCandidate.nodekitCommit,
    nodekitSourceHash: value.releaseCandidate.nodekitSourceHash,
    nodekitTarballSha256: value.releaseCandidate.nodekitTarballSha256,
    packageName: value.releaseCandidate.packageName,
    packageVersion: value.releaseCandidate.packageVersion,
  };
}

function keyMaterial(gate) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    policy: {
      schemaVersion: SIGNING_KEY_POLICY_SCHEMA_VERSION,
      keyId: `${gate}-reviewer`,
      publicKey: publicKey.export({ format: "pem", type: "spki" }),
      purposes: [gate],
    },
  };
}

async function materializeEvidence(root, gate, value) {
  for (const reference of transitiveSubmissionEvidence(gate, value)) {
    await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
    const directBytes = submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    await writeFile(path.join(root, reference.path), directBytes);
    if (reference.kind === "protected-comparison"
      || (reference.kind === "screenshot-manifest" && gate !== "freshAgentHeldout")) {
      for (const child of submissionEvidenceFixtureClosure(reference.path, candidateCommit, sourceHash)) {
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash));
      }
    }
    if (gate === "freshAgentHeldout" && reference.kind === "protected-evaluation") {
      const evaluation = JSON.parse(directBytes.toString("utf8"));
      const protectedManifestPath = path.posix.join(path.posix.dirname(reference.path), evaluation.protectedBrowserManifestFile);
      const protectedManifestBytes = submissionEvidenceFixtureBytes(protectedManifestPath, candidateCommit, sourceHash);
      await mkdir(path.dirname(path.join(root, protectedManifestPath)), { recursive: true });
      await writeFile(path.join(root, protectedManifestPath), protectedManifestBytes);
      for (const child of submissionEvidenceFixtureClosure(protectedManifestPath, candidateCommit, sourceHash)) {
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash));
      }
    }
  }
}

test("finalizer supports every externally observed gate without inventing observations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-all-"));
  const verdicts = exactSubmissionVerdicts(candidateCommit, sourceHash);
  assert.deepEqual(FINALIZABLE_EXTERNAL_GATES, [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers",
    "previewDeployment", "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]);

  for (const gate of FINALIZABLE_EXTERNAL_GATES) {
    const raw = unsigned(verdicts[gate]);
    await materializeEvidence(root, gate, raw);
    const key = keyMaterial(gate);
    const result = await finalizeSubmissionEvidence({
      gate,
      rawVerdict: raw,
      releaseIdentity: releaseIdentity(raw),
      repoRoot: root,
      privateKey: key.privateKey,
      signingKeyPolicy: key.policy,
      signedAt,
    });
    if (gate === "freshAgentHeldout") {
      for (const run of raw.selectedRuns) {
        const protectedEvaluationRef = run.evidence.find((entry) => entry.kind === "protected-evaluation");
        const evaluation = JSON.parse((await readFile(path.join(root, protectedEvaluationRef.path))).toString("utf8"));
        const protectedManifestPath = path.posix.join(path.posix.dirname(protectedEvaluationRef.path), evaluation.protectedBrowserManifestFile);
        const protectedManifest = JSON.parse((await readFile(path.join(root, protectedManifestPath))).toString("utf8"));
        assert.notEqual(evaluation.protectedTaskInput.inputToken, run.runId, "protected certification ID must be independent of the coding-agent trial ID");
        assert.equal(protectedManifest.runId, evaluation.protectedTaskInput.inputToken, "protected browser evidence must bind the evaluator-owned certification ID");
      }
    }
    assert.equal(evidenceContractPasses(gate, result.verdict), true, gate);
    assert.equal(result.attestationPayload.type, gate);
    assert.equal(result.attestation.payloadType, gate);
    assert.equal(result.submissionTrustEvaluated, false);
    assert.equal(result.evidenceCount >= transitiveSubmissionEvidence(gate, raw).length, true);
    assert.throws(() => verifyDetachedAttestation({
      payload: result.attestationPayload,
      attestation: result.attestation,
      trustedKeys: {},
      now: signedAt,
    }), /unknown attestation keyId/, `${gate} key became trusted implicitly`);
  }
});

test("ProofLoop and publication modes only sign complete independent or owner-authored drafts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-authority-"));
  const verdicts = exactSubmissionVerdicts(candidateCommit, sourceHash);
  const pathToGate = {
    "proof/package-install-verdict.json": "packageInstallProof",
    "proof/ease/developer-timing-verdict.json": "developerTimingMatrix",
    "proof/ease/fresh-agent-verdict.json": "freshAgentHeldout",
    "proof/ease/fresh-users-verdict.json": "freshHumanUsability",
    "proof/convex-consumers-verdict.json": "threeConvexConsumers",
    "proof/preview-verdict.json": "previewDeployment",
    "proof/managed-supabase-portability-verdict.json": "managedSupabasePortability",
    "proof/knowledge-evolution-adoption-verdict.json": "knowledgeEvolutionAdoption",
    "proof/model-intelligence-harness-verdict.json": "modelIntelligenceHarness",
    "proof/engineering-health-verdict.json": "engineeringHealth",
  };
  const proofDraft = structuredClone(verdicts.proofloopEaseVerification);
  delete proofDraft.extensions.attestation;
  for (const reference of transitiveSubmissionEvidence("proofloopEaseVerification", proofDraft)) {
    await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
    const referencedGate = pathToGate[reference.path];
    const bytes = referencedGate
      ? Buffer.from(`${JSON.stringify(verdicts[referencedGate])}\n`)
      : submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    await writeFile(path.join(root, reference.path), bytes);
  }
  const proofKey = keyMaterial("proofloopEaseVerification");
  const proofResult = await finalizeSubmissionEvidence({
    gate: "proofloopEaseVerification",
    rawVerdict: proofDraft,
    releaseIdentity: releaseIdentity(proofDraft),
    repoRoot: root,
    privateKey: proofKey.privateKey,
    signingKeyPolicy: proofKey.policy,
    signedAt,
  });
  assert.equal(evidenceContractPasses("proofloopEaseVerification", proofResult.verdict), true);
  assert.equal(proofResult.verdict.extensions.attestation.payloadType, "proofloopEaseVerification");

  const incompleteProof = structuredClone(proofDraft);
  incompleteProof.extensions.independentVerifier = false;
  await assert.rejects(finalizeSubmissionEvidence({
    gate: "proofloopEaseVerification",
    rawVerdict: incompleteProof,
    releaseIdentity: releaseIdentity(incompleteProof),
    repoRoot: root,
    privateKey: proofKey.privateKey,
    signingKeyPolicy: proofKey.policy,
    signedAt,
  }), /already-passing independent verification/);

  const publicationDraft = structuredClone(verdicts.publicationApproval);
  delete publicationDraft.attestation;
  await materializeEvidence(root, "publicationApproval", publicationDraft);
  const publicationKey = keyMaterial("publicationApproval");
  const publicationResult = await finalizeSubmissionEvidence({
    gate: "publicationApproval",
    rawVerdict: publicationDraft,
    releaseIdentity: releaseIdentity(publicationDraft),
    repoRoot: root,
    privateKey: publicationKey.privateKey,
    signingKeyPolicy: publicationKey.policy,
    signedAt,
  });
  assert.equal(evidenceContractPasses("publicationApproval", publicationResult.verdict), true);
  assert.equal(publicationResult.verdict.approvedBy, publicationDraft.approvedBy);

  const noOwner = structuredClone(publicationDraft);
  delete noOwner.approvedBy;
  await assert.rejects(finalizeSubmissionEvidence({
    gate: "publicationApproval",
    rawVerdict: noOwner,
    releaseIdentity: releaseIdentity(noOwner),
    repoRoot: root,
    privateKey: publicationKey.privateKey,
    signingKeyPolicy: publicationKey.policy,
    signedAt,
  }), /owner-authored decision/);
  const extraScope = structuredClone(publicationDraft);
  extraScope.scopes.push("unreviewed-scope");
  await assert.rejects(finalizeSubmissionEvidence({
    gate: "publicationApproval",
    rawVerdict: extraScope,
    releaseIdentity: releaseIdentity(extraScope),
    repoRoot: root,
    privateKey: publicationKey.privateKey,
    signingKeyPolicy: publicationKey.policy,
    signedAt,
  }), /explicitly approve exactly/);
});

test("finalizer refuses missing or changed evidence before returning a verdict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-evidence-"));
  const raw = unsigned(exactSubmissionVerdicts(candidateCommit, sourceHash).freshHumanUsability);
  await materializeEvidence(root, "freshHumanUsability", raw);
  const key = keyMaterial("freshHumanUsability");
  const evidencePath = path.join(root, raw.selectedParticipants[0].evidenceRefs[0].path);
  await writeFile(evidencePath, "tampered\n");
  await assert.rejects(finalizeSubmissionEvidence({
    gate: "freshHumanUsability",
    rawVerdict: raw,
    releaseIdentity: releaseIdentity(raw),
    repoRoot: root,
    privateKey: key.privateKey,
    signingKeyPolicy: key.policy,
    signedAt,
  }), /evidence closure hash mismatch/);

  await rm(evidencePath);
  await assert.rejects(finalizeSubmissionEvidence({
    gate: "freshHumanUsability",
    rawVerdict: raw,
    releaseIdentity: releaseIdentity(raw),
    repoRoot: root,
    privateKey: key.privateKey,
    signingKeyPolicy: key.policy,
    signedAt,
  }), /unable to read evidence|ENOENT/);
});

test("finalizer refuses identity drift, failed raw verdicts, resigned verdicts, and unscoped keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-policy-"));
  const exact = exactSubmissionVerdicts(candidateCommit, sourceHash).developerTimingMatrix;
  const raw = unsigned(exact);
  await materializeEvidence(root, "developerTimingMatrix", raw);
  const key = keyMaterial("developerTimingMatrix");
  const base = {
    gate: "developerTimingMatrix",
    rawVerdict: raw,
    releaseIdentity: releaseIdentity(raw),
    repoRoot: root,
    privateKey: key.privateKey,
    signingKeyPolicy: key.policy,
    signedAt,
  };
  await assert.rejects(finalizeSubmissionEvidence({
    ...base,
    releaseIdentity: { ...base.releaseIdentity, nodekitTarballSha256: "f".repeat(64) },
  }), /releaseCandidate does not match/);
  await assert.rejects(finalizeSubmissionEvidence({
    ...base,
    rawVerdict: { ...raw, passed: false, errors: ["real failure"] },
  }), /only a passing evaluator verdict/);
  await assert.rejects(finalizeSubmissionEvidence({ ...base, rawVerdict: exact }), /must be unsigned/);
  await assert.rejects(finalizeSubmissionEvidence({
    ...base,
    signingKeyPolicy: { ...key.policy, purposes: ["freshHumanUsability"] },
  }), /authorize exactly one purpose/);
  const other = keyMaterial("developerTimingMatrix");
  await assert.rejects(finalizeSubmissionEvidence({ ...base, privateKey: other.privateKey }), /does not match/);
});

test("packed-style CLI emits decisive, payload, and detached envelope files without conferring trust", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-cli-"));
  const secretsRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-finalize-secrets-"));
  const raw = unsigned(exactSubmissionVerdicts(candidateCommit, sourceHash).freshHumanUsability);
  await materializeEvidence(root, "freshHumanUsability", raw);
  const key = keyMaterial("freshHumanUsability");
  const input = path.join(root, "raw.json");
  const policy = path.join(root, "reviewer-policy.json");
  const privatePem = path.join(secretsRoot, "reviewer-private.pem");
  const output = path.join(root, "decisive.json");
  const payload = path.join(root, "payload.json");
  const attestation = path.join(root, "attestation.json");
  await writeFile(input, `${JSON.stringify(raw, null, 2)}\n`);
  await writeFile(policy, `${JSON.stringify(key.policy, null, 2)}\n`);
  await writeFile(privatePem, key.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });

  const commonArgs = [
    "scripts/finalize-submission-evidence.mjs",
    "--gate", "freshHumanUsability",
    "--input", input,
    "--repo-root", root,
    "--candidate-commit", candidateCommit,
    "--source-hash", sourceHash,
    "--tarball-sha256", raw.releaseCandidate.nodekitTarballSha256,
    "--package-name", raw.releaseCandidate.packageName,
    "--package-version", raw.releaseCandidate.packageVersion,
    "--key-policy", policy,
    "--signed-at", signedAt,
  ];
  const executionOptions = {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, NODEKIT_ATTESTATION_PRIVATE_KEY_FILE: privatePem },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const stdout = execFileSync(process.execPath, [
    ...commonArgs,
    "--output", output,
    "--payload-output", payload,
    "--attestation-output", attestation,
  ], executionOptions);
  const summary = JSON.parse(stdout);
  const decisive = JSON.parse(await readFile(output, "utf8"));
  assert.equal(summary.submissionTrustEvaluated, false);
  assert.equal(summary.trustNotice.includes("external trust registry"), true);
  assert.deepEqual(decisive.attestationPayload, JSON.parse(await readFile(payload, "utf8")));
  assert.deepEqual(decisive.attestation, JSON.parse(await readFile(attestation, "utf8")));
  assert.equal(evidenceContractPasses("freshHumanUsability", decisive), true);

  const protectedEvidence = path.join(root, raw.selectedParticipants[0].evidenceRefs[0].path);
  const protectedBytes = await readFile(protectedEvidence);
  assert.throws(() => execFileSync(process.execPath, [
    ...commonArgs,
    "--output", protectedEvidence,
  ], executionOptions), /refusing to overwrite evidence/);
  assert.deepEqual(await readFile(protectedEvidence), protectedBytes);

  assert.throws(() => execFileSync(process.execPath, [
    ...commonArgs,
    "--output", input,
  ], executionOptions), /overwrite a finalization input/);
  assert.throws(() => execFileSync(process.execPath, [
    ...commonArgs,
    "--output", privatePem,
  ], executionOptions), /overwrite a finalization input or private key/);
  assert.throws(() => execFileSync(process.execPath, [
    ...commonArgs,
    "--output", output,
  ], executionOptions), /overwrite an existing finalization output/);

  const unsafePrivatePem = path.join(root, "unsafe-private.pem");
  await writeFile(unsafePrivatePem, key.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  assert.throws(() => execFileSync(process.execPath, [
    ...commonArgs,
    "--output", path.join(root, "unsafe-output.json"),
  ], {
    ...executionOptions,
    env: { ...process.env, NODEKIT_ATTESTATION_PRIVATE_KEY_FILE: unsafePrivatePem },
  }), /must remain outside the evidence repository/);
});
