import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  canonicalizeAttestationPayload,
  createExternalGateVerificationPayload,
  createProofLoopEaseVerificationPayload,
  createPublicationApprovalPayload,
  hashAttestationPayload,
  externalGateEvidenceRootSha256,
  externalGateVerdictBodySha256,
  proofLoopEvidenceRootSha256,
  parseTrustedAttestationKeysJson,
  signDetachedAttestation,
  verifyDetachedAttestation,
} from "../src/lib/submission-attestation.mjs";

const COMMIT = "a".repeat(40);
const SOURCE_HASH = "b".repeat(64);
const TARBALL_HASH = "c".repeat(64);
const SUBJECT_HASH = "d".repeat(64);
const SIGNED_AT = "2026-07-22T12:34:56.000Z";
const NOW = "2026-07-22T12:35:00.000Z";
const DECISIVE_EVIDENCE = [
  { kind: "package", path: "proof/package.json", sha256: "1".repeat(64) },
  { kind: "timing", path: "proof/timing.json", sha256: "2".repeat(64) },
];
const EXTERNAL_EVIDENCE = [
  { kind: "session-log", path: "proof/humans/session.json", sha256: "3".repeat(64) },
  { kind: "screenshot", path: "proof/humans/completion.png", sha256: "4".repeat(64) },
];

const trust = (publicKey, ...purposes) => ({ publicKey, purposes });

function proofLoopPayload(overrides = {}) {
  return createProofLoopEaseVerificationPayload({
    candidateCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    nodekitTarballSha256: TARBALL_HASH,
    decisiveEvidence: DECISIVE_EVIDENCE,
    verification: { path: "proof/proofloop-final.json", sha256: SUBJECT_HASH },
    ...overrides,
  });
}

function externalPayload(type = "freshHumanUsability") {
  const verdict = {
    schemaVersion: "fixture/v1",
    nodekitCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    passed: true,
    evidence: EXTERNAL_EVIDENCE,
  };
  return createExternalGateVerificationPayload({
    type,
    candidateCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    nodekitTarballSha256: TARBALL_HASH,
    evidence: EXTERNAL_EVIDENCE,
    verdict,
  });
}

function publicationPayload(overrides = {}) {
  return createPublicationApprovalPayload({
    candidateCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    nodekitTarballSha256: TARBALL_HASH,
    submissionManifest: { path: "proof/submission-manifest.json", sha256: SUBJECT_HASH },
    scopes: ["npm-publish", "convex-directory-submit"],
    ...overrides,
  });
}

test("canonical payload encoding and hashing are independent of object key insertion order", () => {
  const left = { z: [1, true, null], a: { beta: "β", alpha: -0 } };
  const right = { a: { alpha: 0, beta: "β" }, z: [1, true, null] };
  assert.equal(canonicalizeAttestationPayload(left), '{"a":{"alpha":0,"beta":"β"},"z":[1,true,null]}');
  assert.equal(canonicalizeAttestationPayload(left), canonicalizeAttestationPayload(right));
  assert.equal(hashAttestationPayload(left), hashAttestationPayload(right));
});

test("canonical payload encoding rejects lossy, cyclic, sparse, or non-plain values", () => {
  assert.throws(() => canonicalizeAttestationPayload({ bad: undefined }), /non-JSON/);
  assert.throws(() => canonicalizeAttestationPayload({ bad: Number.NaN }), /finite/);
  assert.throws(() => canonicalizeAttestationPayload([, 1]), /sparse/);
  assert.throws(() => canonicalizeAttestationPayload(new Date()), /plain object/);
  assert.throws(() => canonicalizeAttestationPayload({ bad: "\ud800" }), /unpaired Unicode surrogate/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeAttestationPayload(cyclic), /cycles/);
});

test("payload factories bind exact candidate identity and canonical evidence references", () => {
  const proof = proofLoopPayload();
  assert.equal(proof.type, "proofloopEaseVerification");
  assert.equal(proof.verdict, "passed");
  assert.equal(proof.nodekitTarballSha256, TARBALL_HASH);
  assert.equal(proof.decisiveEvidenceRootSha256, proofLoopEvidenceRootSha256(DECISIVE_EVIDENCE));

  const external = externalPayload();
  assert.equal(external.type, "freshHumanUsability");
  assert.equal(external.evidenceRootSha256, externalGateEvidenceRootSha256(EXTERNAL_EVIDENCE));
  assert.match(external.verdictBodySha256, /^[a-f0-9]{64}$/);

  const approval = publicationPayload();
  assert.equal(approval.type, "publicationApproval");
  assert.equal(approval.decision, "approved");
  assert.deepEqual(approval.scopes, ["convex-directory-submit", "npm-publish"]);

  assert.throws(() => proofLoopPayload({ verification: { path: "proof/./proofloop-final.json", sha256: SUBJECT_HASH } }), /canonical repository-relative/);
  assert.throws(() => publicationPayload({ scopes: ["npm-publish", "npm-publish"] }), /duplicates/);
  assert.throws(() => proofLoopPayload({ nodekitTarballSha256: "not-a-hash" }), /SHA-256/);
  assert.throws(() => externalGateEvidenceRootSha256([...EXTERNAL_EVIDENCE, EXTERNAL_EVIDENCE[0]]), /repeats path/);
});

test("trusted detached Ed25519 attestations verify only through purpose-scoped trust entries", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  for (const payload of [
    proofLoopPayload(), publicationPayload(), externalPayload("developerTimingMatrix"), externalPayload("freshAgentHeldout"), externalPayload(),
    externalPayload("threeConvexConsumers"), externalPayload("previewDeployment"), externalPayload("managedSupabasePortability"),
    externalPayload("knowledgeEvolutionAdoption"), externalPayload("modelIntelligenceHarness"),
  ]) {
    const attestation = signDetachedAttestation({ payload, privateKey, keyId: "release-owner-2026", signedAt: SIGNED_AT });
    const result = verifyDetachedAttestation({
      payload,
      attestation,
      trustedKeys: new Map([["release-owner-2026", trust(publicKey, payload.type)]]),
      expectedPayloadType: payload.type,
      now: NOW,
    });
    assert.deepEqual(result, {
      verified: true,
      algorithm: "Ed25519",
      keyId: "release-owner-2026",
      payloadSha256: hashAttestationPayload(payload),
      payloadType: payload.type,
      signedAt: SIGNED_AT,
    });
  }
});

test("external gate payload binds exact verdict body and canonical underlying evidence root", () => {
  const verdict = { passed: true, metric: 5 };
  const payload = createExternalGateVerificationPayload({
    type: "developerTimingMatrix",
    candidateCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    nodekitTarballSha256: TARBALL_HASH,
    evidence: EXTERNAL_EVIDENCE,
    verdict,
  });
  assert.equal(payload.verdictBodySha256, externalGateVerdictBodySha256(verdict));
  assert.notEqual(payload.verdictBodySha256, externalGateVerdictBodySha256({ ...verdict, metric: 6 }));
  assert.equal(payload.evidenceRootSha256, externalGateEvidenceRootSha256([...EXTERNAL_EVIDENCE].reverse()));
  assert.notEqual(payload.evidenceRootSha256, externalGateEvidenceRootSha256([
    { ...EXTERNAL_EVIDENCE[0], sha256: "5".repeat(64) },
    EXTERNAL_EVIDENCE[1],
  ]));
});

test("ProofLoop evidence roots bind decisive-evidence order", () => {
  assert.notEqual(proofLoopEvidenceRootSha256(DECISIVE_EVIDENCE), proofLoopEvidenceRootSha256([...DECISIVE_EVIDENCE].reverse()));
});

test("trusted-key env JSON requires externally supplied, purpose-scoped Ed25519 public PEM values", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ format: "pem", type: "spki" });
  const entry = { publicKey: pem, purposes: ["freshHumanUsability"] };
  assert.deepEqual(parseTrustedAttestationKeysJson(JSON.stringify({ "human-review-2026": entry })), { "human-review-2026": entry });
  assert.throws(() => parseTrustedAttestationKeysJson("not-json"), /JSON is invalid/);
  assert.throws(() => parseTrustedAttestationKeysJson(JSON.stringify({ bare: pem })), /must explicitly declare publicKey and purposes/);
  assert.throws(() => parseTrustedAttestationKeysJson(JSON.stringify({ bad: { publicKey: "not a key", purposes: ["freshHumanUsability"] } })), /trusted public key is invalid/);
  assert.throws(() => parseTrustedAttestationKeysJson(JSON.stringify({ "bad key id": entry })), /keyId/);
  assert.throws(() => parseTrustedAttestationKeysJson(JSON.stringify({ bad: { publicKey: pem, purposes: [] } })), /purposes/);
});

test("verification rejects payload and signed-metadata tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = proofLoopPayload();
  const attestation = signDetachedAttestation({ payload, privateKey, keyId: "proofloop-ci", signedAt: SIGNED_AT });
  const trustedKeys = { "proofloop-ci": trust(publicKey, "proofloopEaseVerification") };

  assert.throws(() => verifyDetachedAttestation({
    payload: { ...payload, nodekitSourceHash: "e".repeat(64) }, attestation, trustedKeys, now: NOW,
  }), /payloadSha256 does not match/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation: { ...attestation, signedAt: "2026-07-22T12:34:55.000Z" }, trustedKeys, now: NOW,
  }), /signature verification failed/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation: { ...attestation, algorithm: "Ed448" }, trustedKeys, now: NOW,
  }), /algorithm must be Ed25519/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation: { ...attestation, payloadSha256: "f".repeat(64) }, trustedKeys, now: NOW,
  }), /payloadSha256 does not match/);
});

test("verification rejects unknown keys and never accepts an embedded candidate key", () => {
  const trusted = generateKeyPairSync("ed25519");
  const attacker = generateKeyPairSync("ed25519");
  const payload = proofLoopPayload();
  const attestation = signDetachedAttestation({ payload, privateKey: attacker.privateKey, keyId: "attacker", signedAt: SIGNED_AT });

  assert.throws(() => verifyDetachedAttestation({
    payload, attestation, trustedKeys: { trusted: trust(trusted.publicKey, "proofloopEaseVerification") }, now: NOW,
  }), /unknown attestation keyId/);
  assert.throws(() => verifyDetachedAttestation({
    payload,
    attestation: { ...attestation, publicKey: attacker.publicKey.export({ format: "pem", type: "spki" }) },
    trustedKeys: { attacker: trust(trusted.publicKey, "proofloopEaseVerification") },
    now: NOW,
  }), /must contain exactly/);
});

test("verification rejects malformed timestamps, malformed signatures, and future attestations", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = publicationPayload();
  const attestation = signDetachedAttestation({ payload, privateKey, keyId: "owner", signedAt: SIGNED_AT });
  const trustedKeys = { owner: trust(publicKey, "publicationApproval") };

  assert.throws(() => signDetachedAttestation({
    payload, privateKey, keyId: "owner", signedAt: "2026-07-22 12:34:56Z",
  }), /canonical UTC timestamp/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation: { ...attestation, signedAt: "2026-02-30T12:34:56.000Z" }, trustedKeys, now: NOW,
  }), /not a valid timestamp/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation: { ...attestation, signature: "not_base64url" }, trustedKeys, now: NOW,
  }), /canonical Ed25519 base64url/);
  assert.throws(() => verifyDetachedAttestation({
    payload, attestation, trustedKeys, now: "2026-07-22T12:00:00.000Z", maxFutureSkewMs: 0,
  }), /far in the future/);
});

test("verification enforces the caller's expected attestation purpose", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = proofLoopPayload();
  const attestation = signDetachedAttestation({ payload, privateKey, keyId: "owner", signedAt: SIGNED_AT });
  assert.throws(() => verifyDetachedAttestation({
    payload,
    attestation,
    trustedKeys: { owner: trust(publicKey, "proofloopEaseVerification") },
    expectedPayloadType: "publicationApproval",
    now: NOW,
  }), /payloadType must be publicationApproval/);
});

test("a valid signature is rejected when its key is not trusted for that payload purpose", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = externalPayload("managedSupabasePortability");
  const attestation = signDetachedAttestation({ payload, privateKey, keyId: "portability-reviewer", signedAt: SIGNED_AT });
  assert.throws(() => verifyDetachedAttestation({
    payload,
    attestation,
    trustedKeys: { "portability-reviewer": trust(publicKey, "previewDeployment") },
    now: NOW,
  }), /not authorized for purpose managedSupabasePortability/);
});

test("offline commands sign from a private-key file and verify from the external trust env", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-attestation-cli-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const payloadPath = path.join(root, "payload.json");
  const keyPath = path.join(root, "private.pem");
  const attestationPath = path.join(root, "attestation.json");
  await writeFile(payloadPath, `${JSON.stringify(externalPayload("previewDeployment"), null, 2)}\n`);
  await writeFile(keyPath, privatePem, { mode: 0o600 });
  const signOutput = execFileSync(process.execPath, [
    "scripts/sign-submission-attestation.mjs",
    "--payload", payloadPath,
    "--output", attestationPath,
    "--key-id", "preview-reviewer",
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, NODEKIT_ATTESTATION_PRIVATE_KEY_FILE: keyPath },
  });
  assert.doesNotMatch(signOutput, /BEGIN PRIVATE KEY/);
  const attestation = JSON.parse(await readFile(attestationPath, "utf8"));
  assert.equal(attestation.payloadType, "previewDeployment");
  const verifyOutput = execFileSync(process.execPath, [
    "scripts/verify-submission-attestation.mjs",
    "--payload", payloadPath,
    "--attestation", attestationPath,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON: JSON.stringify({
        "preview-reviewer": { publicKey: publicPem, purposes: ["previewDeployment"] },
      }),
    },
  });
  assert.equal(JSON.parse(verifyOutput).verified, true);
});
