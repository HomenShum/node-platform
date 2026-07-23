import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import path from "node:path";

export const SUBMISSION_ATTESTATION_SCHEMA_VERSION = "nodekit.detached-attestation/v1";
export const PROOFLOOP_EASE_PAYLOAD_SCHEMA_VERSION = "nodekit.proofloop-ease-verification-attestation-payload/v1";
export const PUBLICATION_APPROVAL_PAYLOAD_SCHEMA_VERSION = "nodekit.publication-approval-attestation-payload/v1";
export const EXTERNAL_GATE_PAYLOAD_SCHEMA_VERSION = "nodekit.external-gate-verification-attestation-payload/v1";
export const SUBMISSION_ATTESTATION_ALGORITHM = "Ed25519";
export const SUBMISSION_ATTESTATION_SIGNATURE_ENCODING = "base64url";

const PROOFLOOP_PAYLOAD_TYPE = "proofloopEaseVerification";
const PUBLICATION_PAYLOAD_TYPE = "publicationApproval";
export const EXTERNALLY_OBSERVED_GATE_TYPES = Object.freeze([
  "developerTimingMatrix",
  "freshAgentHeldout",
  "freshHumanUsability",
  "threeConvexConsumers",
  "previewDeployment",
  "managedSupabasePortability",
  "knowledgeEvolutionAdoption",
  "modelIntelligenceHarness",
]);
export const SUBMISSION_ATTESTATION_PURPOSES = Object.freeze([
  ...EXTERNALLY_OBSERVED_GATE_TYPES,
  PROOFLOOP_PAYLOAD_TYPE,
  PUBLICATION_PAYLOAD_TYPE,
]);
const EXTERNAL_GATE_PAYLOAD_TYPES = new Set(EXTERNALLY_OBSERVED_GATE_TYPES);
const ATTESTATION_PURPOSES = new Set(SUBMISSION_ATTESTATION_PURPOSES);
const SIGNING_DOMAIN = "NODEKIT-DETACHED-ATTESTATION-V1\0";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const SCOPE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ENVELOPE_KEYS = Object.freeze([
  "algorithm",
  "keyId",
  "payloadSha256",
  "payloadType",
  "schemaVersion",
  "signature",
  "signatureEncoding",
  "signedAt",
]);

function fail(message) {
  throw new TypeError(message);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value, label) {
  if (!isPlainRecord(value)) fail(`${label} must be a plain object`);
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} must not contain symbol keys`);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
}

function assertSha256(value, label) {
  if (!SHA256.test(value ?? "")) fail(`${label} must be a lowercase SHA-256 digest`);
}

function assertCandidateIdentity(candidateCommit, nodekitSourceHash, nodekitTarballSha256) {
  if (!COMMIT.test(candidateCommit ?? "")) fail("candidateCommit must be a lowercase 40-character Git commit");
  assertSha256(nodekitSourceHash, "nodekitSourceHash");
  assertSha256(nodekitTarballSha256, "nodekitTarballSha256");
}

function assertCanonicalEvidencePath(value, label) {
  assertString(value, label);
  if (
    value.includes("\\")
    || value.startsWith("/")
    || value.startsWith("./")
    || /^[A-Za-z]:/.test(value)
    || path.posix.normalize(value) !== value
    || value === "."
    || value.endsWith("/")
  ) {
    fail(`${label} must be a canonical repository-relative path`);
  }
}

function evidenceReference(value, label) {
  assertExactKeys(value, ["path", "sha256"], label);
  assertCanonicalEvidencePath(value.path, `${label}.path`);
  assertSha256(value.sha256, `${label}.sha256`);
  return Object.freeze({ path: value.path, sha256: value.sha256 });
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertCanonicalTimestamp(value, label = "signedAt") {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) {
    fail(`${label} must be a canonical UTC timestamp with milliseconds`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${label} is not a valid timestamp`);
  }
  return milliseconds;
}

function assertKeyId(value) {
  if (!KEY_ID.test(value ?? "")) fail("keyId must be a stable external trust-store identifier");
}

function assertJsonString(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} contains an unpaired Unicode surrogate`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(`${label} contains an unpaired Unicode surrogate`);
    }
  }
}

function canonicalJson(value, ancestors, label) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertJsonString(value, label);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} must contain only finite numbers`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail(`${label} contains a non-JSON value`);
  if (ancestors.has(value)) fail(`${label} must not contain cycles`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${label} must not contain sparse arrays`);
        entries.push(canonicalJson(value[index], ancestors, `${label}[${index}]`));
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        fail(`${label} arrays must not contain named properties`);
      }
      if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} arrays must not contain symbol properties`);
      return `[${entries.join(",")}]`;
    }

    assertPlainRecord(value, label);
    if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} must not contain symbol keys`);
    return `{${Object.keys(value).sort().map((key) => {
      assertJsonString(key, `${label} key`);
      return `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors, `${label}.${key}`)}`;
    }).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Return the deterministic UTF-8 JSON representation used for hashes and
 * signatures. Only lossless JSON values are accepted.
 */
export function canonicalizeAttestationPayload(payload) {
  return canonicalJson(payload, new Set(), "payload");
}

export function hashAttestationPayload(payload) {
  return createHash("sha256").update(canonicalizeAttestationPayload(payload), "utf8").digest("hex");
}

/**
 * Hash the exact evidence references underlying one externally observed gate.
 * The decisive verdict itself is deliberately excluded to avoid a signature
 * cycle. Its complete non-attestation body is bound separately.
 */
export function externalGateEvidenceRootSha256(references) {
  if (!Array.isArray(references) || references.length === 0) fail("external gate evidence must be a non-empty array");
  const seenPaths = new Set();
  const entries = references.map((reference, index) => {
    assertPlainRecord(reference, `evidence[${index}]`);
    assertCanonicalEvidencePath(reference.path, `evidence[${index}].path`);
    assertSha256(reference.sha256, `evidence[${index}].sha256`);
    if (seenPaths.has(reference.path)) fail(`external gate evidence repeats path: ${reference.path}`);
    seenPaths.add(reference.path);
    if (reference.kind !== undefined && (typeof reference.kind !== "string" || !SCOPE.test(reference.kind))) {
      fail(`evidence[${index}].kind must be a stable lowercase identifier when present`);
    }
    if (reference.bytes !== undefined && (!Number.isInteger(reference.bytes) || reference.bytes < 0)) {
      fail(`evidence[${index}].bytes must be a non-negative integer when present`);
    }
    return {
      bytes: reference.bytes ?? null,
      kind: reference.kind ?? null,
      path: reference.path,
      sha256: reference.sha256,
    };
  });
  entries.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.kind ?? "", right.kind ?? "")
    || compareCodeUnits(left.sha256, right.sha256));
  return hashAttestationPayload({
    entries,
    schemaVersion: "nodekit.external-gate-evidence-root/v1",
  });
}

export function proofLoopEvidenceRootSha256(references) {
  if (!Array.isArray(references) || references.length === 0) fail("ProofLoop decisive evidence must be a non-empty array");
  const seenKinds = new Set();
  const seenPaths = new Set();
  const entries = references.map((reference, index) => {
    assertExactKeys(reference, ["kind", "path", "sha256"], `decisiveEvidence[${index}]`);
    if (typeof reference.kind !== "string" || !SCOPE.test(reference.kind)) fail(`decisiveEvidence[${index}].kind is invalid`);
    assertCanonicalEvidencePath(reference.path, `decisiveEvidence[${index}].path`);
    assertSha256(reference.sha256, `decisiveEvidence[${index}].sha256`);
    if (seenKinds.has(reference.kind)) fail(`ProofLoop decisive evidence repeats kind: ${reference.kind}`);
    if (seenPaths.has(reference.path)) fail(`ProofLoop decisive evidence repeats path: ${reference.path}`);
    seenKinds.add(reference.kind);
    seenPaths.add(reference.path);
    return { kind: reference.kind, path: reference.path, sha256: reference.sha256 };
  });
  return hashAttestationPayload({
    entries,
    schemaVersion: "nodekit.proofloop-decisive-evidence-root/v1",
  });
}

/**
 * Hash every decisive claim except the detached payload and envelope. This
 * prevents a candidate from retaining a valid evidence signature while
 * rewriting participant outcomes, timing metrics, consumer checks, or hosted
 * deployment identity.
 */
export function externalGateVerdictBodySha256(verdict) {
  assertPlainRecord(verdict, "external gate verdict");
  const {
    attestation: _attestation,
    attestationPayload: _attestationPayload,
    ...body
  } = verdict;
  return hashAttestationPayload(body);
}

export function createExternalGateVerificationPayload({
  type,
  candidateCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  evidence,
  verdict,
}) {
  if (!EXTERNAL_GATE_PAYLOAD_TYPES.has(type)) fail(`unsupported external gate payload type: ${type ?? "missing"}`);
  assertCandidateIdentity(candidateCommit, nodekitSourceHash, nodekitTarballSha256);
  const payload = {
    schemaVersion: EXTERNAL_GATE_PAYLOAD_SCHEMA_VERSION,
    type,
    candidateCommit,
    nodekitSourceHash,
    nodekitTarballSha256,
    verdict: "passed",
    evidenceRootSha256: externalGateEvidenceRootSha256(evidence),
    verdictBodySha256: externalGateVerdictBodySha256(verdict),
  };
  validateSubmissionAttestationPayload(payload);
  return Object.freeze(payload);
}

export const createDeveloperTimingMatrixPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "developerTimingMatrix" });
export const createFreshAgentHeldoutPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "freshAgentHeldout" });
export const createFreshHumanUsabilityPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "freshHumanUsability" });
export const createThreeConvexConsumersPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "threeConvexConsumers" });
export const createPreviewDeploymentPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "previewDeployment" });
export const createManagedSupabasePortabilityPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "managedSupabasePortability" });
export const createKnowledgeEvolutionAdoptionPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "knowledgeEvolutionAdoption" });
export const createModelIntelligenceHarnessPayload = (options) => createExternalGateVerificationPayload({ ...options, type: "modelIntelligenceHarness" });

export function createProofLoopEaseVerificationPayload({
  candidateCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  decisiveEvidence,
  verification,
}) {
  assertCandidateIdentity(candidateCommit, nodekitSourceHash, nodekitTarballSha256);
  const normalizedVerification = evidenceReference(verification, "verification");
  const payload = {
    schemaVersion: PROOFLOOP_EASE_PAYLOAD_SCHEMA_VERSION,
    type: PROOFLOOP_PAYLOAD_TYPE,
    candidateCommit,
    nodekitSourceHash,
    nodekitTarballSha256,
    verdict: "passed",
    decisiveEvidenceRootSha256: proofLoopEvidenceRootSha256(decisiveEvidence),
    verification: normalizedVerification,
  };
  validateSubmissionAttestationPayload(payload);
  return Object.freeze(payload);
}

export function createPublicationApprovalPayload({
  candidateCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  submissionManifest,
  scopes,
}) {
  assertCandidateIdentity(candidateCommit, nodekitSourceHash, nodekitTarballSha256);
  const normalizedManifest = evidenceReference(submissionManifest, "submissionManifest");
  if (!Array.isArray(scopes) || scopes.length === 0) fail("scopes must be a non-empty array");
  if (!scopes.every((scope) => typeof scope === "string" && SCOPE.test(scope))) {
    fail("scopes must contain stable lowercase scope identifiers");
  }
  if (new Set(scopes).size !== scopes.length) fail("scopes must not contain duplicates");
  const normalizedScopes = Object.freeze([...scopes].sort());
  const payload = {
    schemaVersion: PUBLICATION_APPROVAL_PAYLOAD_SCHEMA_VERSION,
    type: PUBLICATION_PAYLOAD_TYPE,
    candidateCommit,
    nodekitSourceHash,
    nodekitTarballSha256,
    decision: "approved",
    scopes: normalizedScopes,
    submissionManifest: normalizedManifest,
  };
  validateSubmissionAttestationPayload(payload);
  return Object.freeze(payload);
}

export function validateSubmissionAttestationPayload(payload) {
  assertPlainRecord(payload, "payload");
  if (EXTERNAL_GATE_PAYLOAD_TYPES.has(payload.type)) {
    assertExactKeys(payload, [
      "candidateCommit", "evidenceRootSha256", "nodekitSourceHash", "nodekitTarballSha256",
      "schemaVersion", "type", "verdict", "verdictBodySha256",
    ], `${payload.type} payload`);
    if (payload.schemaVersion !== EXTERNAL_GATE_PAYLOAD_SCHEMA_VERSION) fail(`${payload.type} payload schemaVersion is invalid`);
    if (payload.verdict !== "passed") fail(`${payload.type} verdict must be passed`);
    assertCandidateIdentity(payload.candidateCommit, payload.nodekitSourceHash, payload.nodekitTarballSha256);
    assertSha256(payload.evidenceRootSha256, "payload.evidenceRootSha256");
    assertSha256(payload.verdictBodySha256, "payload.verdictBodySha256");
  } else if (payload.type === PROOFLOOP_PAYLOAD_TYPE) {
    assertExactKeys(payload, [
      "candidateCommit", "decisiveEvidenceRootSha256", "nodekitSourceHash", "nodekitTarballSha256", "schemaVersion", "type", "verdict", "verification",
    ], "proofloopEaseVerification payload");
    if (payload.schemaVersion !== PROOFLOOP_EASE_PAYLOAD_SCHEMA_VERSION) fail("proofloopEaseVerification payload schemaVersion is invalid");
    if (payload.verdict !== "passed") fail("proofloopEaseVerification verdict must be passed");
    assertCandidateIdentity(payload.candidateCommit, payload.nodekitSourceHash, payload.nodekitTarballSha256);
    assertSha256(payload.decisiveEvidenceRootSha256, "payload.decisiveEvidenceRootSha256");
    evidenceReference(payload.verification, "payload.verification");
  } else if (payload.type === PUBLICATION_PAYLOAD_TYPE) {
    assertExactKeys(payload, [
      "candidateCommit", "decision", "nodekitSourceHash", "nodekitTarballSha256", "schemaVersion", "scopes", "submissionManifest", "type",
    ], "publicationApproval payload");
    if (payload.schemaVersion !== PUBLICATION_APPROVAL_PAYLOAD_SCHEMA_VERSION) fail("publicationApproval payload schemaVersion is invalid");
    if (payload.decision !== "approved") fail("publicationApproval decision must be approved");
    assertCandidateIdentity(payload.candidateCommit, payload.nodekitSourceHash, payload.nodekitTarballSha256);
    evidenceReference(payload.submissionManifest, "payload.submissionManifest");
    if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) fail("publicationApproval scopes must be non-empty");
    if (!payload.scopes.every((scope) => typeof scope === "string" && SCOPE.test(scope))) fail("publicationApproval scopes are invalid");
    if (new Set(payload.scopes).size !== payload.scopes.length) fail("publicationApproval scopes must be unique");
    if (payload.scopes.some((scope, index) => index > 0 && payload.scopes[index - 1] >= scope)) {
      fail("publicationApproval scopes must use canonical code-unit order");
    }
  } else {
    fail(`unsupported attestation payload type: ${payload.type ?? "missing"}`);
  }
  canonicalizeAttestationPayload(payload);
  return payload;
}

function signingStatement(attestation) {
  return {
    algorithm: attestation.algorithm,
    keyId: attestation.keyId,
    payloadSha256: attestation.payloadSha256,
    payloadType: attestation.payloadType,
    schemaVersion: attestation.schemaVersion,
    signatureEncoding: attestation.signatureEncoding,
    signedAt: attestation.signedAt,
  };
}

function signingBytes(attestation) {
  return Buffer.from(`${SIGNING_DOMAIN}${canonicalizeAttestationPayload(signingStatement(attestation))}`, "utf8");
}

function ed25519PrivateKey(value) {
  let key;
  try {
    key = value instanceof KeyObject ? value : createPrivateKey(value);
  } catch (error) {
    throw new TypeError(`privateKey is invalid: ${error.message}`);
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") fail("privateKey must be an Ed25519 private key");
  return key;
}

function ed25519PublicKey(value) {
  let key;
  try {
    key = value instanceof KeyObject && value.type === "public" ? value : createPublicKey(value);
  } catch (error) {
    throw new TypeError(`trusted public key is invalid: ${error.message}`);
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") fail("trusted public key must be an Ed25519 public key");
  return key;
}

function validateTrustedKeyEntry(entry, keyId) {
  if (!isPlainRecord(entry)) fail(`trusted attestation key ${keyId} must explicitly declare publicKey and purposes`);
  assertExactKeys(entry, ["publicKey", "purposes"], `trusted attestation key ${keyId}`);
  if (!Array.isArray(entry.purposes) || entry.purposes.length === 0) fail(`trusted attestation key ${keyId} purposes must be non-empty`);
  if (new Set(entry.purposes).size !== entry.purposes.length) fail(`trusted attestation key ${keyId} purposes must be unique`);
  for (const purpose of entry.purposes) {
    if (typeof purpose !== "string" || !ATTESTATION_PURPOSES.has(purpose)) {
      fail(`trusted attestation key ${keyId} contains unsupported purpose: ${purpose ?? "missing"}`);
    }
  }
  ed25519PublicKey(entry.publicKey);
  return entry;
}

function trustedKey(trustedKeys, keyId, purpose) {
  let entry;
  if (trustedKeys instanceof Map) {
    if (!trustedKeys.has(keyId)) fail(`unknown attestation keyId: ${keyId}`);
    entry = trustedKeys.get(keyId);
  } else if (isPlainRecord(trustedKeys) && Object.hasOwn(trustedKeys, keyId)) {
    entry = trustedKeys[keyId];
  } else {
    fail(`unknown attestation keyId: ${keyId}`);
  }
  const validated = validateTrustedKeyEntry(entry, keyId);
  if (!validated.purposes.includes(purpose)) fail(`attestation keyId ${keyId} is not authorized for purpose ${purpose}`);
  return validated.publicKey;
}

/** Parse the fail-closed env representation used by submission commands. */
export function parseTrustedAttestationKeysJson(encoded = "{}") {
  if (typeof encoded !== "string") fail("trusted attestation keys JSON must be a string");
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new TypeError(`trusted attestation keys JSON is invalid: ${error.message}`);
  }
  assertPlainRecord(parsed, "trusted attestation keys");
  const normalized = {};
  for (const [keyId, entry] of Object.entries(parsed)) {
    assertKeyId(keyId);
    if (!isPlainRecord(entry)) fail(`trusted attestation key ${keyId} must explicitly declare publicKey and purposes; bare keys are not accepted`);
    assertExactKeys(entry, ["publicKey", "purposes"], `trusted attestation key ${keyId}`);
    if (typeof entry.publicKey !== "string" || entry.publicKey.length === 0) fail(`trusted attestation key ${keyId} publicKey must be a non-empty PEM string`);
    const purposes = Array.isArray(entry.purposes) ? [...entry.purposes] : entry.purposes;
    validateTrustedKeyEntry({ publicKey: entry.publicKey, purposes }, keyId);
    normalized[keyId] = Object.freeze({ publicKey: entry.publicKey, purposes: Object.freeze(purposes) });
  }
  return Object.freeze(normalized);
}

function validateAttestationEnvelope(attestation) {
  assertExactKeys(attestation, ENVELOPE_KEYS, "attestation");
  if (attestation.schemaVersion !== SUBMISSION_ATTESTATION_SCHEMA_VERSION) fail("attestation schemaVersion is invalid");
  if (attestation.algorithm !== SUBMISSION_ATTESTATION_ALGORITHM) fail("attestation algorithm must be Ed25519");
  if (attestation.signatureEncoding !== SUBMISSION_ATTESTATION_SIGNATURE_ENCODING) fail("attestation signatureEncoding must be base64url");
  assertKeyId(attestation.keyId);
  assertCanonicalTimestamp(attestation.signedAt);
  assertSha256(attestation.payloadSha256, "attestation.payloadSha256");
  if (!ATTESTATION_PURPOSES.has(attestation.payloadType)) fail("attestation payloadType is invalid");
  if (typeof attestation.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature)) {
    fail("attestation signature must be a canonical Ed25519 base64url signature");
  }
  const signature = Buffer.from(attestation.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== attestation.signature) {
    fail("attestation signature is not canonical base64url");
  }
  return signature;
}

export function signDetachedAttestation({ payload, privateKey, keyId, signedAt = new Date().toISOString() }) {
  validateSubmissionAttestationPayload(payload);
  assertKeyId(keyId);
  assertCanonicalTimestamp(signedAt);
  const unsigned = {
    schemaVersion: SUBMISSION_ATTESTATION_SCHEMA_VERSION,
    algorithm: SUBMISSION_ATTESTATION_ALGORITHM,
    keyId,
    signedAt,
    payloadType: payload.type,
    payloadSha256: hashAttestationPayload(payload),
    signatureEncoding: SUBMISSION_ATTESTATION_SIGNATURE_ENCODING,
  };
  const signature = sign(null, signingBytes(unsigned), ed25519PrivateKey(privateKey)).toString("base64url");
  return Object.freeze({ ...unsigned, signature });
}

/**
 * Verify a detached submission attestation against caller-owned trust state.
 * Public keys supplied by the candidate or embedded in an envelope are never
 * consulted; unknown envelope fields are rejected.
 */
export function verifyDetachedAttestation({
  payload,
  attestation,
  trustedKeys,
  expectedPayloadType = undefined,
  now = Date.now(),
  maxFutureSkewMs = 300_000,
}) {
  validateSubmissionAttestationPayload(payload);
  const signature = validateAttestationEnvelope(attestation);
  if (expectedPayloadType !== undefined && attestation.payloadType !== expectedPayloadType) {
    fail(`attestation payloadType must be ${expectedPayloadType}`);
  }
  if (attestation.payloadType !== payload.type) fail("attestation payloadType does not match payload");
  const actualHash = hashAttestationPayload(payload);
  if (attestation.payloadSha256 !== actualHash) fail("attestation payloadSha256 does not match payload");

  const nowMs = now instanceof Date ? now.getTime() : typeof now === "string" ? Date.parse(now) : now;
  if (!Number.isFinite(nowMs)) fail("now must be a valid Date, timestamp, or date string");
  if (!Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) fail("maxFutureSkewMs must be a non-negative number");
  const signedAtMs = assertCanonicalTimestamp(attestation.signedAt);
  if (signedAtMs > nowMs + maxFutureSkewMs) fail("attestation signedAt is unacceptably far in the future");

  const publicKey = ed25519PublicKey(trustedKey(trustedKeys, attestation.keyId, payload.type));
  if (!verify(null, signingBytes(attestation), publicKey, signature)) fail("attestation signature verification failed");
  return Object.freeze({
    verified: true,
    algorithm: attestation.algorithm,
    keyId: attestation.keyId,
    payloadSha256: actualHash,
    payloadType: payload.type,
    signedAt: attestation.signedAt,
  });
}
