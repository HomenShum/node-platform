import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeAttestationPayload,
  createExternalGateVerificationPayload,
  createProofLoopEaseVerificationPayload,
  createPublicationApprovalPayload,
  EXTERNALLY_OBSERVED_GATE_TYPES,
  parseTrustedAttestationKeysJson,
  signDetachedAttestation,
  verifyDetachedAttestation,
} from "./submission-attestation.mjs";
import {
  evidenceContractPasses,
  resolveSubmissionEvidenceClosure,
  transitiveSubmissionEvidence,
} from "./submission-gate.mjs";
import { createSchemaAjv } from "./schema-validation.mjs";

export const FINALIZABLE_EXTERNAL_GATES = EXTERNALLY_OBSERVED_GATE_TYPES;
export const FINALIZABLE_SUBMISSION_GATES = Object.freeze([
  ...FINALIZABLE_EXTERNAL_GATES,
  "proofloopEaseVerification",
  "publicationApproval",
]);

export const SIGNING_KEY_POLICY_SCHEMA_VERSION = "nodekit.attestation-signing-key-policy/v1";

const SCHEMA_BY_GATE = Object.freeze({
  developerTimingMatrix: "nodekit.developer-timing-verdict.v1.schema.json",
  freshAgentHeldout: "nodekit.fresh-agent-verdict.v2.schema.json",
  freshHumanUsability: "nodekit.fresh-user-verdict.v1.schema.json",
  threeConvexConsumers: "nodekit.convex-consumers-verdict.v1.schema.json",
  previewDeployment: "nodekit.preview-verdict.v1.schema.json",
  managedSupabasePortability: "nodekit.managed-supabase-portability-verdict.v1.schema.json",
  knowledgeEvolutionAdoption: "nodekit.knowledge-evolution-adoption-verdict.v1.schema.json",
  modelIntelligenceHarness: "nodekit.model-intelligence-harness-verdict.v1.schema.json",
  proofloopEaseVerification: "nodekit.proofloop-ease-verification.v1.schema.json",
  publicationApproval: "nodekit.publication-approval.v1.schema.json",
});
const SCHEMA_VERSION_BY_GATE = Object.freeze({
  developerTimingMatrix: "nodekit.developer-timing-verdict/v1",
  freshAgentHeldout: "nodekit.fresh-agent-verdict/v2",
  freshHumanUsability: "nodekit.fresh-user-verdict/v1",
  threeConvexConsumers: "nodekit.convex-consumers-verdict/v1",
  previewDeployment: "nodekit.preview-verdict/v1",
  managedSupabasePortability: "nodekit.managed-supabase-portability-verdict/v1",
  knowledgeEvolutionAdoption: "nodekit.knowledge-evolution-adoption-verdict/v1",
  modelIntelligenceHarness: "nodekit.model-intelligence-harness-verdict/v1",
  publicationApproval: "nodekit.publication-approval/v1",
});
const PACKAGE_NAME = "@homenshum/nodekit";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  throw new TypeError(message);
}

function plainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainRecord(value)) fail(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function assertIdentity(value, identity, gate) {
  const { candidateCommit, nodekitSourceHash, nodekitTarballSha256, packageName, packageVersion } = identity;
  if (!COMMIT.test(candidateCommit ?? "")) fail("candidateCommit must be a lowercase 40-character Git commit");
  if (!SHA256.test(nodekitSourceHash ?? "")) fail("nodekitSourceHash must be a lowercase SHA-256 digest");
  if (!SHA256.test(nodekitTarballSha256 ?? "")) fail("nodekitTarballSha256 must be a lowercase SHA-256 digest");
  if (packageName !== PACKAGE_NAME) fail(`packageName must be ${PACKAGE_NAME}`);
  if (!PACKAGE_VERSION.test(packageVersion ?? "")) fail("packageVersion must be a semantic package version");

  const observedCommit = value.nodekitCommit ?? value.candidateCommit ?? value.subject?.repository?.candidateCommit;
  const observedSourceHash = value.nodekitSourceHash ?? value.subject?.repository?.nodekitSourceHash;
  if (observedCommit !== candidateCommit) fail("raw verdict candidate commit does not match the exact candidate commit");
  if (observedSourceHash !== nodekitSourceHash) fail("raw verdict source hash does not match the exact source hash");
  if (gate !== "proofloopEaseVerification" && value.nodekitIdentity !== `${candidateCommit}/${nodekitSourceHash}`) {
    fail("raw verdict nodekitIdentity is not exact");
  }
  const release = value.releaseCandidate;
  if (!plainRecord(release)
    || release.nodekitCommit !== candidateCommit
    || release.nodekitSourceHash !== nodekitSourceHash
    || release.nodekitTarballSha256 !== nodekitTarballSha256
    || release.packageName !== packageName
    || release.packageVersion !== packageVersion) {
    fail("raw verdict releaseCandidate does not match the exact candidate/package identity");
  }
  if (value.nodekitTarballSha256 !== undefined && value.nodekitTarballSha256 !== nodekitTarballSha256) {
    fail("raw verdict top-level tarball hash does not match the exact package identity");
  }
}

function normalizeRawVerdict(rawVerdict, gate) {
  if (!FINALIZABLE_SUBMISSION_GATES.includes(gate)) fail(`unsupported finalizable gate: ${gate ?? "missing"}`);
  if (!plainRecord(rawVerdict)) fail("raw verdict must be a plain object");
  if (gate === "proofloopEaseVerification") {
    if (!plainRecord(rawVerdict.extensions?.attestationPayload) || Object.hasOwn(rawVerdict.extensions, "attestation")) {
      fail("ProofLoop draft must contain its reviewed attestationPayload and must not contain an attestation");
    }
    if (rawVerdict.verdict?.status !== "passed"
      || rawVerdict.extensions?.easeCertified !== true
      || rawVerdict.extensions?.independentVerifier !== true) {
      fail("ProofLoop finalization requires an already-passing independent verification draft");
    }
  } else if (gate === "publicationApproval") {
    if (!plainRecord(rawVerdict.attestationPayload) || Object.hasOwn(rawVerdict, "attestation")) {
      fail("publication draft must contain its reviewed attestationPayload and must not contain an attestation");
    }
    if (rawVerdict.approved !== true || typeof rawVerdict.approvedBy !== "string" || rawVerdict.approvedBy.length === 0) {
      fail("publication finalization requires an already-approved owner-authored decision");
    }
  } else if (Object.hasOwn(rawVerdict, "attestationPayload") || Object.hasOwn(rawVerdict, "attestation")) {
    fail("raw verdict must be unsigned and must not contain attestationPayload or attestation");
  }
  if (gate !== "proofloopEaseVerification" && rawVerdict.schemaVersion !== SCHEMA_VERSION_BY_GATE[gate]) {
    fail(`raw verdict schemaVersion is not valid for ${gate}`);
  }
  if (FINALIZABLE_EXTERNAL_GATES.includes(gate) && rawVerdict.passed !== true) fail("only a passing evaluator verdict can be finalized");
  if (FINALIZABLE_EXTERNAL_GATES.includes(gate)
    && rawVerdict.errors !== undefined
    && (!Array.isArray(rawVerdict.errors) || rawVerdict.errors.length !== 0)) {
    fail("a raw verdict with evaluator errors cannot be finalized");
  }
  // Reject non-JSON, lossy, cyclic, or prototype-bearing inputs and return a
  // detached plain copy so callers cannot mutate the signed body concurrently.
  return JSON.parse(canonicalizeAttestationPayload(rawVerdict));
}

function normalizeSigningPolicy(policy, gate) {
  exactKeys(policy, ["schemaVersion", "keyId", "publicKey", "purposes"], "signing key policy");
  if (policy.schemaVersion !== SIGNING_KEY_POLICY_SCHEMA_VERSION) fail("signing key policy schemaVersion is invalid");
  if (!Array.isArray(policy.purposes) || policy.purposes.length !== 1 || policy.purposes[0] !== gate) {
    fail(`signing key policy must authorize exactly one purpose: ${gate}`);
  }
  const trusted = parseTrustedAttestationKeysJson(JSON.stringify({
    [policy.keyId]: { publicKey: policy.publicKey, purposes: policy.purposes },
  }));
  return { keyId: policy.keyId, publicKey: policy.publicKey, trusted };
}

function assertPrivateKeyMatchesPolicy(privateKey, policyPublicKey) {
  let derived;
  let expected;
  try {
    const privateObject = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
    derived = createPublicKey(privateObject).export({ format: "der", type: "spki" });
    expected = createPublicKey(policyPublicKey).export({ format: "der", type: "spki" });
  } catch (error) {
    fail(`unable to compare signing key with key policy: ${error.message}`);
  }
  if (!derived.equals(expected)) fail("private signing key does not match the public key in the purpose-scoped policy");
}

async function validateDecisiveSchema(gate, verdict, schemasRoot) {
  const schemaPath = path.join(schemasRoot, SCHEMA_BY_GATE[gate]);
  let schema;
  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    throw new Error(`unable to load decisive verdict schema ${schemaPath}: ${error.message}`);
  }
  const validate = createSchemaAjv().compile(schema);
  if (!validate(verdict)) {
    throw new Error(`decisive ${gate} verdict failed its typed schema: ${JSON.stringify(validate.errors ?? [])}`);
  }
}

/**
 * Turn one already-measured, passing evaluator body into a decisive verdict.
 * This function does not run measurements, alter thresholds, establish trust,
 * or accept candidate-provided evidence. It reopens every referenced file,
 * binds the exact release identity, signs through a one-purpose key policy,
 * validates the decisive schema, and self-verifies the detached signature.
 */
export async function finalizeSubmissionEvidence({
  gate,
  rawVerdict,
  releaseIdentity,
  repoRoot,
  privateKey,
  signingKeyPolicy,
  signedAt = new Date().toISOString(),
  schemasRoot = path.join(moduleRoot, "schemas"),
}) {
  const root = path.resolve(repoRoot);
  const raw = normalizeRawVerdict(rawVerdict, gate);
  assertIdentity(raw, releaseIdentity, gate);
  const policy = normalizeSigningPolicy(signingKeyPolicy, gate);
  assertPrivateKeyMatchesPolicy(privateKey, policy.publicKey);

  const evidence = transitiveSubmissionEvidence(gate, raw);
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${gate} raw verdict contains no decisive evidence references`);
  const reopenedEvidence = await resolveSubmissionEvidenceClosure(root, gate, raw);
  if (reopenedEvidence.length < evidence.length) fail(`${gate} evidence closure changed while it was reopened`);

  let attestationPayload;
  if (gate === "proofloopEaseVerification") {
    const decisiveEvidence = raw.extensions?.decisiveEvidence;
    if (!Array.isArray(decisiveEvidence) || decisiveEvidence.length !== 11) {
      fail("ProofLoop draft must contain exactly 11 decisive evidence references");
    }
    attestationPayload = createProofLoopEaseVerificationPayload({
      candidateCommit: releaseIdentity.candidateCommit,
      nodekitSourceHash: releaseIdentity.nodekitSourceHash,
      nodekitTarballSha256: releaseIdentity.nodekitTarballSha256,
      decisiveEvidence,
      verification: raw.extensions.attestationPayload.verification,
    });
    if (canonicalizeAttestationPayload(attestationPayload) !== canonicalizeAttestationPayload(raw.extensions.attestationPayload)) {
      fail("ProofLoop draft attestation payload does not match its canonical evidence and verification references");
    }
  } else if (gate === "publicationApproval") {
    const scopes = raw.scopes;
    if (!Array.isArray(scopes)
      || scopes.length !== 2
      || !scopes.includes("npm-publish")
      || !scopes.includes("convex-directory-submit")) {
      fail("publication draft must explicitly approve exactly npm-publish and convex-directory-submit");
    }
    if (raw.attestationPayload.submissionManifest?.path !== "proof/submission-candidate.json") {
      fail("publication draft must reference the already-prepared proof/submission-candidate.json");
    }
    attestationPayload = createPublicationApprovalPayload({
      candidateCommit: releaseIdentity.candidateCommit,
      nodekitSourceHash: releaseIdentity.nodekitSourceHash,
      nodekitTarballSha256: releaseIdentity.nodekitTarballSha256,
      submissionManifest: raw.attestationPayload.submissionManifest,
      scopes,
    });
    if (canonicalizeAttestationPayload(attestationPayload) !== canonicalizeAttestationPayload(raw.attestationPayload)) {
      fail("publication draft attestation payload does not match its canonical candidate reference and scopes");
    }
  } else {
    attestationPayload = createExternalGateVerificationPayload({
      type: gate,
      candidateCommit: releaseIdentity.candidateCommit,
      nodekitSourceHash: releaseIdentity.nodekitSourceHash,
      nodekitTarballSha256: releaseIdentity.nodekitTarballSha256,
      evidence,
      verdict: raw,
    });
  }
  const attestation = signDetachedAttestation({
    payload: attestationPayload,
    privateKey,
    keyId: policy.keyId,
    signedAt,
  });
  const verdict = gate === "proofloopEaseVerification"
    ? { ...raw, extensions: { ...raw.extensions, attestationPayload, attestation } }
    : { ...raw, attestationPayload, attestation };

  await validateDecisiveSchema(gate, verdict, path.resolve(schemasRoot));
  if (!evidenceContractPasses(gate, verdict)) fail(`decisive ${gate} verdict failed the submission evidence contract`);
  const localCryptographicVerification = verifyDetachedAttestation({
    payload: attestationPayload,
    attestation,
    trustedKeys: policy.trusted,
    expectedPayloadType: gate,
    now: signedAt,
    maxFutureSkewMs: 0,
  });
  // Reopen after all computation so a file changed during finalization cannot
  // produce a verdict in this process. Submission preparation reopens again.
  await resolveSubmissionEvidenceClosure(root, gate, verdict);

  return Object.freeze({
    verdict: Object.freeze(verdict),
    attestationPayload,
    attestation,
    evidenceCount: reopenedEvidence.length,
    reopenedEvidence: Object.freeze(reopenedEvidence.map((entry) => Object.freeze({ ...entry }))),
    localCryptographicVerification,
    submissionTrustEvaluated: false,
  });
}
