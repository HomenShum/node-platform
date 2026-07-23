import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify as verifySignature } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { builderGymContext, builderGymStatus } from "./builder-gym.mjs";
import { compileModelIntelligence, diagnoseModelFailures } from "./model-intelligence.mjs";
import { pathExists, readJson, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SKILL_ATTESTATION_SCHEMA_VERSION = "nodekit.skill-detached-attestation/v1";
const SKILL_ATTESTATION_DOMAIN = "NODEKIT-SKILL-EVALUATOR-RECEIPT-V1\0";
const SKILL_RECEIPT_PURPOSES = new Set(["skill-benchmark", "skill-canary", "skill-integrity", "skill-promotion-approval"]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new Error(`${label} must be canonical UTC ISO-8601 with milliseconds`);
  }
  return value;
}

function skillRecordBody(value) {
  const body = structuredClone(value);
  delete body.receiptId;
  delete body.receiptHash;
  delete body.verdictId;
  delete body.verdictHash;
  delete body.attestation;
  delete body.output;
  return body;
}

function attestationStatement({ keyId, payloadSha256, purpose, signedAt }) {
  return {
    algorithm: "Ed25519",
    keyId,
    payloadSha256,
    purpose,
    schemaVersion: SKILL_ATTESTATION_SCHEMA_VERSION,
    signatureEncoding: "base64url",
    signedAt,
  };
}

function attestationBytes(statement) {
  return Buffer.from(`${SKILL_ATTESTATION_DOMAIN}${canonical(statement)}`, "utf8");
}

function signSkillRecord(payloadSha256, purpose, { privateKey, keyId, signedAt = new Date().toISOString() }) {
  if (!SKILL_RECEIPT_PURPOSES.has(purpose)) throw new Error(`unsupported skill receipt purpose: ${purpose}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(keyId ?? "")) throw new Error("skill evaluator keyId is invalid");
  canonicalTimestamp(signedAt, "signedAt");
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("skill evaluator private key must be Ed25519");
  const statement = attestationStatement({ keyId, payloadSha256, purpose, signedAt });
  return {
    ...statement,
    signature: sign(null, attestationBytes(statement), key).toString("base64url"),
  };
}

function trustedSkillKeys(options = {}) {
  if (options.trustedKeys) return options.trustedKeys;
  const encoded = process.env.NODEKIT_SKILL_EVALUATOR_TRUSTED_KEYS_JSON;
  if (!encoded) throw new Error("trusted skill evaluator keys are required; set NODEKIT_SKILL_EVALUATOR_TRUSTED_KEYS_JSON or pass trustedKeys");
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`trusted skill evaluator keys JSON is invalid: ${error.message}`);
  }
  return parsed;
}

function verifySkillAttestation(attestation, payloadSha256, purpose, options = {}) {
  exactKeys(attestation, ["algorithm", "keyId", "payloadSha256", "purpose", "schemaVersion", "signature", "signatureEncoding", "signedAt"], "skill receipt attestation");
  if (attestation.schemaVersion !== SKILL_ATTESTATION_SCHEMA_VERSION
    || attestation.algorithm !== "Ed25519"
    || attestation.signatureEncoding !== "base64url"
    || attestation.purpose !== purpose
    || attestation.payloadSha256 !== payloadSha256) {
    throw new Error("skill receipt attestation is not bound to the exact payload and purpose");
  }
  canonicalTimestamp(attestation.signedAt, "attestation.signedAt");
  const keys = trustedSkillKeys(options);
  const entry = keys?.[attestation.keyId];
  exactKeys(entry, ["publicKey", "purposes"], `trusted skill evaluator key ${attestation.keyId}`);
  if (!Array.isArray(entry.purposes) || !entry.purposes.includes(purpose)) {
    throw new Error(`trusted skill evaluator key ${attestation.keyId} is not authorized for ${purpose}`);
  }
  const publicKey = createPublicKey(entry.publicKey);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("trusted skill evaluator public key must be Ed25519");
  const signature = Buffer.from(attestation.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== attestation.signature
    || !verifySignature(null, attestationBytes(attestationStatement(attestation)), publicKey, signature)) {
    throw new Error("skill receipt attestation signature verification failed");
  }
  return attestation.keyId;
}

function normalizeEvidenceReference(reference, label) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error(`${label} must be an object`);
  const normalized = normalizeRepositoryPath(reference.path, `${label}.path`);
  if (!SHA256.test(reference.sha256 ?? "")) throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  if (reference.bytes !== undefined && (!Number.isInteger(reference.bytes) || reference.bytes < 0)) throw new Error(`${label}.bytes must be a non-negative integer`);
  if (reference.kind !== undefined && (typeof reference.kind !== "string" || !/^[a-z][a-z0-9-]*$/.test(reference.kind))) {
    throw new Error(`${label}.kind is invalid`);
  }
  return { bytes: reference.bytes, kind: reference.kind, path: normalized, sha256: reference.sha256 };
}

async function stableEvidenceFile(repoRoot, relativePath, label) {
  const target = await resolveSafe(repoRoot, relativePath, label);
  const pathBefore = await lstat(target, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1n) throw new Error(`${label} must be one regular unaliased non-symlink file`);
  const physicalBeforeValue = path.normalize(await realpath(target));
  let handle;
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  try { handle = await open(target, fsConstants.O_RDONLY | noFollow); }
  catch (error) {
    if (!noFollow || !["EINVAL", "ENOTSUP", "UNKNOWN"].includes(error?.code)) throw error;
    handle = await open(target, "r");
  }
  try {
    const openedBefore = await handle.stat({ bigint: true });
    const sameOpenedFile = pathBefore.ino > 0n && openedBefore.ino > 0n
      ? pathBefore.dev === openedBefore.dev && pathBefore.ino === openedBefore.ino
      : pathBefore.size === openedBefore.size
        && pathBefore.mtimeNs === openedBefore.mtimeNs
        && pathBefore.birthtimeNs === openedBefore.birthtimeNs;
    if (!sameOpenedFile || !openedBefore.isFile() || openedBefore.nlink !== 1n) throw new Error(`${label} changed before its stable descriptor opened or has multiple hard links`);
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    if (openedBefore.size !== openedAfter.size || openedBefore.mtimeNs !== openedAfter.mtimeNs || openedBefore.ctimeNs !== openedAfter.ctimeNs) {
      throw new Error(`${label} changed while its stable descriptor was read`);
    }
    const [pathAfter, physicalAfterValue] = await Promise.all([lstat(target, { bigint: true }), realpath(target)]);
    const pathStillNamesOpenedFile = openedAfter.ino > 0n && pathAfter.ino > 0n
      ? openedAfter.dev === pathAfter.dev && openedAfter.ino === pathAfter.ino
      : openedAfter.size === pathAfter.size
        && openedAfter.mtimeNs === pathAfter.mtimeNs
        && openedAfter.birthtimeNs === pathAfter.birthtimeNs;
    if (!pathStillNamesOpenedFile || pathAfter.isSymbolicLink() || pathAfter.nlink !== 1n || path.normalize(physicalAfterValue) !== physicalBeforeValue) {
      throw new Error(`${label} path changed while its stable descriptor was read`);
    }
    const physical = process.platform === "win32" ? physicalBeforeValue.toLowerCase() : physicalBeforeValue;
    const inode = openedAfter.ino > 0n ? `${openedAfter.dev}:${openedAfter.ino}` : null;
    return { bytes, inode, metadata: openedAfter, physical, target };
  } finally {
    await handle.close();
  }
}

function nestedEvidenceReferences(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return [];
  }
  const nested = [];
  for (const key of ["evidence", "evidenceRefs"]) {
    if (value?.[key] === undefined) continue;
    if (!Array.isArray(value[key])) throw new Error(`${label}.${key} must be an array when present`);
    for (const [index, reference] of value[key].entries()) {
      if (typeof reference === "string") throw new Error(`${label}.${key}[${index}] is an unhashed evidence reference`);
      if (reference && typeof reference === "object" && typeof reference.path === "string" && typeof reference.sha256 === "string") {
        nested.push(normalizeEvidenceReference(reference, `${label}.${key}[${index}]`));
      }
    }
  }
  return nested;
}

export async function computeSkillEvidenceClosure(repoRoot, references) {
  if (!Array.isArray(references) || references.length === 0) throw new Error("skill evidence must be a non-empty array");
  const queue = references.map((reference, index) => normalizeEvidenceReference(reference, `evidence[${index}]`));
  const byPath = new Map();
  const physicalPaths = new Map();
  const physicalInodes = new Map();
  while (queue.length > 0) {
    const reference = queue.shift();
    const prior = byPath.get(reference.path);
    if (prior) {
      if (prior.sha256 !== reference.sha256) throw new Error(`skill evidence path has conflicting hashes: ${reference.path}`);
      if (reference.bytes !== undefined && prior.bytes !== reference.bytes) throw new Error(`skill evidence path has conflicting byte counts: ${reference.path}`);
      if (reference.kind !== undefined && prior.kind !== null && prior.kind !== reference.kind) throw new Error(`skill evidence path has conflicting kinds: ${reference.path}`);
      continue;
    }
    const file = await stableEvidenceFile(repoRoot, reference.path, `skill evidence ${reference.path}`);
    const actualHash = createHash("sha256").update(file.bytes).digest("hex");
    if (actualHash !== reference.sha256) throw new Error(`skill evidence hash mismatch: ${reference.path}`);
    if (reference.bytes !== undefined && reference.bytes !== file.bytes.length) throw new Error(`skill evidence byte count mismatch: ${reference.path}`);
    const physicalPrior = physicalPaths.get(file.physical);
    if (physicalPrior && physicalPrior !== reference.path) throw new Error(`skill evidence aliases one physical file: ${reference.path}`);
    const inodePrior = file.inode ? physicalInodes.get(file.inode) : null;
    if (inodePrior && inodePrior !== reference.path) throw new Error(`skill evidence reuses one physical inode: ${reference.path}`);
    physicalPaths.set(file.physical, reference.path);
    if (file.inode) physicalInodes.set(file.inode, reference.path);
    const entry = {
      bytes: file.bytes.length,
      kind: reference.kind ?? null,
      path: reference.path,
      sha256: actualHash,
    };
    byPath.set(reference.path, entry);
    queue.push(...nestedEvidenceReferences(file.bytes, reference.path));
  }
  const entries = [...byPath.values()].sort((left, right) => compareCodeUnits(left.path, right.path));
  return {
    entries,
    rootHash: hash({ entries, schemaVersion: "nodekit.skill-evidence-closure/v1" }),
  };
}

export function sealSkillEvaluatorReceipt(input, signingOptions) {
  const body = skillRecordBody(input);
  const receiptHash = hash(body);
  const receipt = {
    ...body,
    receiptId: `skill-evaluator:sha256:${receiptHash}`,
    receiptHash,
  };
  return { ...receipt, attestation: signSkillRecord(receiptHash, body.purpose, signingOptions) };
}

export function sealSkillIntegrityReceipt(input, signingOptions) {
  const body = skillRecordBody(input);
  const receiptHash = hash(body);
  const receipt = {
    ...body,
    receiptId: `skill-integrity:sha256:${receiptHash}`,
    receiptHash,
  };
  return { ...receipt, attestation: signSkillRecord(receiptHash, "skill-integrity", signingOptions) };
}

function skillPromotionApprovalBody(value) {
  const body = structuredClone(value);
  delete body.approvalId;
  delete body.approvalHash;
  delete body.attestation;
  delete body.output;
  return body;
}

export function sealSkillPromotionApproval(input, signingOptions) {
  const body = skillPromotionApprovalBody(input);
  const approvalHash = hash(body);
  const approval = {
    ...body,
    approvalId: `skill-promotion-approval:sha256:${approvalHash}`,
    approvalHash,
  };
  return { ...approval, attestation: signSkillRecord(approvalHash, "skill-promotion-approval", signingOptions) };
}

export async function verifySkillEvaluatorReceipt(repoRoot, receiptValue, options = {}) {
  const receipt = structuredClone(receiptValue);
  delete receipt.output;
  await validateOrThrow("nodekit.skill-evaluator-receipt.v1.schema.json", receipt, "skill evaluator receipt");
  const expectedHash = hash(skillRecordBody(receipt));
  if (receipt.receiptHash !== expectedHash || receipt.receiptId !== `skill-evaluator:sha256:${expectedHash}`) {
    throw new Error("skill evaluator receipt content address mismatch");
  }
  const keyId = verifySkillAttestation(receipt.attestation, expectedHash, receipt.purpose, options);
  if (receipt.attestation.signedAt !== receipt.issuedAt) throw new Error("skill evaluator receipt issuedAt differs from its signedAt");
  const closure = await computeSkillEvidenceClosure(repoRoot, receipt.evidence);
  if (closure.rootHash !== receipt.evidenceRootSha256) throw new Error("skill evaluator receipt evidence root mismatch");
  const directByKind = new Map(receipt.evidence.map((entry) => [entry.kind, entry]));
  for (const kind of ["task", "input", "output", "evaluation"]) {
    if (!directByKind.has(kind)) throw new Error(`skill evaluator receipt is missing ${kind} evidence`);
  }
  if (directByKind.get("task").sha256 !== receipt.taskHash || directByKind.get("input").sha256 !== receipt.inputHash) {
    throw new Error("skill evaluator receipt task/input hashes do not match their evidence bytes");
  }
  return { closure, keyId, receipt, receiptHash: expectedHash, verified: true };
}

export async function verifySkillIntegrityReceipt(repoRoot, receiptValue, options = {}) {
  const receipt = structuredClone(receiptValue);
  delete receipt.output;
  await validateOrThrow("nodekit.skill-integrity-receipt.v1.schema.json", receipt, "skill integrity receipt");
  const expectedHash = hash(skillRecordBody(receipt));
  if (receipt.receiptHash !== expectedHash || receipt.receiptId !== `skill-integrity:sha256:${expectedHash}`) {
    throw new Error("skill integrity receipt content address mismatch");
  }
  const keyId = verifySkillAttestation(receipt.attestation, expectedHash, "skill-integrity", options);
  if (receipt.attestation.signedAt !== receipt.issuedAt) throw new Error("skill integrity receipt issuedAt differs from its signedAt");
  const closure = await computeSkillEvidenceClosure(repoRoot, receipt.evidence);
  if (closure.rootHash !== receipt.evidenceRootSha256) throw new Error("skill integrity receipt evidence root mismatch");
  return { closure, keyId, receipt, receiptHash: expectedHash, verified: true };
}

export async function verifySkillPromotionApproval(receiptValue, expected, options = {}) {
  const approval = structuredClone(receiptValue);
  delete approval.output;
  await validateOrThrow("nodekit.skill-promotion-approval.v1.schema.json", approval, "skill promotion approval");
  exactKeys(approval, [
    "approvalHash", "approvalId", "approvedBy", "attestation", "benchmarkVerdictHash",
    "candidateId", "candidateSkillHash", "canaryReceiptHash", "currentHarnessManifestHash",
    "currentHarnessVersion", "expiresAt", "integrityReceiptHash", "issuedAt", "nonce",
    "purpose", "schemaVersion",
  ], "skill promotion approval");
  if (approval.schemaVersion !== "nodekit.skill-promotion-approval/v1" || approval.purpose !== "skill-promotion-approval") {
    throw new Error("skill promotion approval schema or purpose is invalid");
  }
  for (const field of ["candidateId", "candidateSkillHash", "benchmarkVerdictHash", "canaryReceiptHash", "integrityReceiptHash", "currentHarnessVersion", "currentHarnessManifestHash", "approvedBy"]) {
    if (typeof approval[field] !== "string" || approval[field].trim() === "") throw new Error(`skill promotion approval ${field} is required`);
  }
  for (const field of ["candidateSkillHash", "benchmarkVerdictHash", "canaryReceiptHash", "integrityReceiptHash", "currentHarnessManifestHash"]) {
    if (!SHA256.test(approval[field])) throw new Error(`skill promotion approval ${field} must be a SHA-256 digest`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{15,127}$/u.test(approval.nonce ?? "")) throw new Error("skill promotion approval nonce is invalid");
  canonicalTimestamp(approval.issuedAt, "skill promotion approval issuedAt");
  canonicalTimestamp(approval.expiresAt, "skill promotion approval expiresAt");
  const issuedAt = Date.parse(approval.issuedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  const at = options.at ?? Date.now();
  if (issuedAt > at + 5 * 60_000) throw new Error("skill promotion approval is not yet valid");
  if (expiresAt <= at) throw new Error("skill promotion approval has expired");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 24 * 60 * 60_000) throw new Error("skill promotion approval validity window must be positive and at most 24 hours");
  const expectedHash = hash(skillPromotionApprovalBody(approval));
  if (approval.approvalHash !== expectedHash || approval.approvalId !== `skill-promotion-approval:sha256:${expectedHash}`) {
    throw new Error("skill promotion approval content address mismatch");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (approval[field] !== value) throw new Error(`skill promotion approval ${field} does not bind the exact promotion input`);
  }
  const keyId = verifySkillAttestation(approval.attestation, expectedHash, "skill-promotion-approval", options);
  if (approval.attestation.signedAt !== approval.issuedAt) throw new Error("skill promotion approval issuedAt differs from its signedAt");
  return { approval, approvalHash: expectedHash, keyId, verified: true };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeRepositoryPath(value, label) {
  const input = String(value ?? "");
  if (!input || input.includes("\\") || path.posix.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path`);
  }
  const normalized = path.posix.normalize(input);
  if (normalized !== input || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path`);
  }
  return normalized;
}

async function resolveSafe(repoRoot, relative, label, { allowMissing = false } = {}) {
  const root = path.resolve(repoRoot);
  const physicalRoot = await realpath(root);
  const normalized = normalizeRepositoryPath(relative, label);
  const target = path.resolve(root, ...normalized.split("/"));
  const relation = path.relative(root, target);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error(`${label} escapes the repository`);
  let cursor = root;
  for (const segment of relation.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return target;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`${label} traverses a symlink or junction`);
    const physical = await realpath(cursor);
    const physicalRelation = path.relative(physicalRoot, physical);
    if (physicalRelation === ".." || physicalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelation)) {
      throw new Error(`${label} resolves outside the repository`);
    }
  }
  return target;
}

function candidateRoot(repoRoot, candidateId) {
  if (!/^skill-candidate-[a-z0-9-]+$/.test(candidateId)) throw new Error(`invalid candidate id: ${candidateId}`);
  return path.join(repoRoot, "harness", "candidates", candidateId);
}

async function validateOrThrow(schema, value, label) {
  const errors = await validateSchema(schema, value, label);
  if (errors.length > 0) throw new Error(`${label} validation failed:\n${errors.join("\n")}`);
}

function skillFromCluster(candidateId, cluster) {
  const skillId = `guardrail.${slug(cluster.failureClass)}`;
  return {
    schemaVersion: "nodekit.skill/v1",
    id: skillId,
    version: 1,
    kind: "guardrail",
    triggers: {
      taskFamilies: cluster.taskFamilies,
      failureClasses: [cluster.failureClass],
      models: [cluster.model],
    },
    inputs: ["task", "artifact", "execution_trace"],
    requiredTools: [],
    procedure: [
      `Check for ${cluster.failureClass} before reporting completion`,
      "Inspect the cited tool results and artifact evidence",
      "Return a bounded proposal or typed failure instead of mutating canonical state",
    ],
    constraints: [
      "Do not modify protected tasks, decisive judges, or proof thresholds",
      "Do not claim success when a completion assertion is unsupported",
    ],
    completionChecks: [
      `${cluster.failureClass} is absent from the evaluated result`,
      "Evidence references and canonical-state protections remain intact",
    ],
    failureBehavior: [
      `Emit ${cluster.failureClass} with evidence when the guardrail cannot recover`,
      "Preserve the previous canonical artifact and request bounded review",
    ],
    positiveExamples: [`Candidate ${candidateId} inspects evidence before producing a reviewable proposal`],
    negativeExamples: [cluster.failureClass],
    expectedToolTraces: ["artifact inspection before completion"],
    testFixtures: cluster.taskIds,
    evidenceRefs: cluster.evidenceRefs,
  };
}

export async function proposeSkillCandidates(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const clusters = diagnoseModelFailures(compiled.observations).filter((cluster) => cluster.skillCandidateEligible);
  const proposed = [];
  for (const cluster of clusters) {
    const candidateId = `skill-candidate-${slug(cluster.failureClass)}-${hash({ model: cluster.model, taskIds: cluster.taskIds }).slice(0, 10)}`;
    const root = candidateRoot(repoRoot, candidateId);
    const skill = skillFromCluster(candidateId, cluster);
    const candidate = {
      schemaVersion: "nodekit.skill-candidate/v1",
      candidateId,
      status: "proposed",
      hypothesis: `A focused ${cluster.failureClass} guardrail will reduce the repeated failure without changing the model, tools, protected tasks, or decisive evaluator.`,
      expectedImpact: `Reduce ${cluster.failureClass} on ${cluster.taskFamilies.join(", ")} while holding safety, correctness, editability, export, cost, and latency within the protected comparison thresholds.`,
      risks: ["The guardrail may over-constrain valid behavior", "Additional inspection may increase latency or cost"],
      sourceCluster: {
        failureClass: cluster.failureClass,
        probableCause: cluster.probableCause,
        model: cluster.model,
        count: cluster.count,
        taskIds: cluster.taskIds,
        taskFamilies: cluster.taskFamilies,
        evidenceRefs: cluster.evidenceRefs,
      },
      skillFile: "skill.yaml",
      protectedBenchmarkHash: compiled.resolved.benchmarkHash,
      createdFromEvidence: true,
    };
    await validateOrThrow("nodekit.skill.v1.schema.json", skill, "generated skill");
    await validateOrThrow("nodekit.skill-candidate.v1.schema.json", candidate, "generated skill candidate");
    await ensureSecureHarnessDirectory(repoRoot, root, "skill candidate directory");
    if (!(await pathExists(path.join(root, "candidate.json")))) {
      await atomicWriteFile(repoRoot, path.join(root, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`, "skill candidate record");
      await atomicWriteFile(repoRoot, path.join(root, "skill.yaml"), stringifyYaml(skill), "skill candidate source");
      await atomicWriteFile(repoRoot, path.join(root, "hypothesis.yaml"), stringifyYaml({ schemaVersion: "nodekit.skill-hypothesis/v1", hypothesis: candidate.hypothesis, evidenceRefs: cluster.evidenceRefs }), "skill candidate hypothesis");
      await atomicWriteFile(repoRoot, path.join(root, "expected-impact.yaml"), stringifyYaml({ schemaVersion: "nodekit.expected-impact/v1", expectedImpact: candidate.expectedImpact }), "skill candidate expected impact");
      await atomicWriteFile(repoRoot, path.join(root, "risks.yaml"), stringifyYaml({ schemaVersion: "nodekit.candidate-risks/v1", risks: candidate.risks }), "skill candidate risks");
    } else {
      Object.assign(candidate, await readJson(path.join(root, "candidate.json")));
      Object.assign(skill, await readYaml(path.join(root, candidate.skillFile)));
    }
    proposed.push({ candidate, skill, root });
  }
  return { applicationId: compiled.harness.applicationId, benchmarkHash: compiled.resolved.benchmarkHash, candidates: proposed };
}

export async function reviewSkillCandidate(repoRoot, candidateId) {
  const root = candidateRoot(repoRoot, candidateId);
  const candidatePath = path.relative(repoRoot, path.join(root, "candidate.json")).replaceAll("\\", "/");
  const candidateFile = await stableEvidenceFile(repoRoot, candidatePath, "skill candidate record");
  const candidate = JSON.parse(candidateFile.bytes.toString("utf8"));
  const skillPath = path.relative(repoRoot, path.join(root, candidate.skillFile)).replaceAll("\\", "/");
  const skillFile = await stableEvidenceFile(repoRoot, skillPath, "skill candidate source");
  const skill = parseYaml(skillFile.bytes.toString("utf8"));
  await validateOrThrow("nodekit.skill-candidate.v1.schema.json", candidate, "skill candidate");
  await validateOrThrow("nodekit.skill.v1.schema.json", skill, "skill");
  return { candidate, skill, candidateHash: hash(candidate), skillHash: hash(skill), root };
}

function acceptableIncrease(candidate, baseline) {
  if (baseline === 0) return candidate === 0;
  return candidate <= baseline * 1.25;
}

async function existingStatus(target, options) {
  try { return await lstat(target, options); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function repositoryRelativeTarget(repoRoot, target, label) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(target);
  const relation = path.relative(root, absolute);
  if (!relation || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return { absolute, relative: relation.replaceAll("\\", "/"), root };
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  if (left.ino > 0n && right.ino > 0n) return left.dev === right.dev && left.ino === right.ino;
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.birthtimeNs === right.birthtimeNs;
}

async function ensureSecureHarnessDirectory(repoRoot, directory, label) {
  const root = path.resolve(repoRoot);
  const rootStatus = await lstat(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) throw new Error(`${label} repository root must be a regular directory`);
  const physicalRoot = await realpath(root);
  const relation = path.relative(root, path.resolve(directory));
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error(`${label} directory escapes the repository`);
  let cursor = root;
  for (const segment of relation.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let status = await existingStatus(cursor);
    if (!status) {
      try { await mkdir(cursor); } catch (error) { if (error?.code !== "EEXIST") throw error; }
      status = await lstat(cursor);
    }
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`${label} traverses an unsafe symlink, junction, or non-directory`);
    const physical = await realpath(cursor);
    const physicalRelation = path.relative(physicalRoot, physical);
    if (physicalRelation === ".." || physicalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelation)) {
      throw new Error(`${label} directory resolves outside the repository`);
    }
  }
  return lstat(path.resolve(directory), { bigint: true });
}

async function syncDirectory(directory) {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Directory fsync is unavailable on some Windows/filesystem combinations.
  }
}

async function writeImmutableJson(repoRoot, target, value, label) {
  const bytes = Buffer.from(`${canonical(value)}\n`, "utf8");
  return writeImmutableBytes(repoRoot, target, bytes, label);
}

async function writeImmutableBytes(repoRoot, target, bytes, label) {
  const resolved = repositoryRelativeTarget(repoRoot, target, label);
  const parent = path.dirname(resolved.absolute);
  const parentBefore = await ensureSecureHarnessDirectory(repoRoot, parent, label);
  const existing = await existingStatus(resolved.absolute, { bigint: true });
  if (existing) {
    const stable = await stableEvidenceFile(repoRoot, resolved.relative, label);
    if (!stable.bytes.equals(bytes)) throw new Error(`${label} immutable address already contains different bytes`);
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  const temporary = `${resolved.absolute}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await resolveSafe(repoRoot, resolved.relative, label, { allowMissing: true });
    const parentAfter = await lstat(parent, { bigint: true });
    if (!sameFileIdentity(parentBefore, parentAfter)) throw new Error(`${label} parent identity changed before immutable install`);
    if (await existingStatus(resolved.absolute)) throw new Error(`${label} immutable address appeared before install`);
    await link(temporary, resolved.absolute);
    await rm(temporary);
    const installed = await stableEvidenceFile(repoRoot, resolved.relative, label);
    if (!installed.bytes.equals(bytes)) throw new Error(`${label} immutable install bytes changed`);
    await syncDirectory(parent);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const stable = await stableEvidenceFile(repoRoot, resolved.relative, label);
      if (!stable.bytes.equals(bytes)) throw new Error(`${label} immutable address already contains different bytes`);
    } else throw error;
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function atomicWriteFile(repoRoot, target, bytes, label = "harness atomic write") {
  const resolved = repositoryRelativeTarget(repoRoot, target, label);
  const parent = path.dirname(resolved.absolute);
  const parentBefore = await ensureSecureHarnessDirectory(repoRoot, parent, label);
  const targetBefore = await existingStatus(resolved.absolute, { bigint: true });
  if (targetBefore && (targetBefore.isSymbolicLink() || !targetBefore.isFile() || targetBefore.nlink !== 1n)) {
    throw new Error(`${label} target must be one regular unaliased file`);
  }
  const temporary = `${resolved.absolute}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await resolveSafe(repoRoot, resolved.relative, label, { allowMissing: true });
    const parentAfter = await lstat(parent, { bigint: true });
    if (!sameFileIdentity(parentBefore, parentAfter)) throw new Error(`${label} parent identity changed before commit`);
    const targetAfter = await existingStatus(resolved.absolute, { bigint: true });
    if (Boolean(targetBefore) !== Boolean(targetAfter) || (targetBefore && !sameFileIdentity(targetBefore, targetAfter))) {
      throw new Error(`${label} target identity changed before commit`);
    }
    await rename(temporary, resolved.absolute);
    const installed = await stableEvidenceFile(repoRoot, resolved.relative, label);
    if (!installed.bytes.equals(Buffer.from(bytes))) throw new Error(`${label} committed bytes changed`);
    await syncDirectory(parent);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function withHarnessMutationLock(repoRoot, operation) {
  const lockPath = path.join(repoRoot, "harness", "versions", ".mutation.lock");
  await ensureSecureHarnessDirectory(repoRoot, path.dirname(lockPath), "harness mutation lock");
  let handle;
  const token = randomBytes(24).toString("hex");
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another harness promotion or rollback is already in progress");
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token })}\n`);
    await handle.sync();
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    const lock = JSON.parse((await stableEvidenceFile(repoRoot, "harness/versions/.mutation.lock", "harness mutation lock release")).bytes.toString("utf8"));
    if (lock.token !== token) throw new Error("harness mutation lock identity changed before release");
    await rm(lockPath);
  }
}

function versionedSkillTail(reference) {
  const normalized = String(reference).replaceAll("\\", "/");
  const marker = "/skills/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0 || index + marker.length >= normalized.length) {
    throw new Error(`active skill is not rooted under an immutable skills directory: ${reference}`);
  }
  const tail = normalized.slice(index + marker.length);
  if (tail.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`active skill path is not canonical: ${reference}`);
  }
  return tail;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregateSkillArm(records) {
  const successes = records.filter((entry) => entry.receipt.metrics.success).length;
  if (successes === 0) throw new Error("protected evaluator arm has no successful run, so cost per success is undefined");
  const average = (name) => records.reduce((total, entry) => total + entry.receipt.metrics[name], 0) / records.length;
  return {
    runs: records.length,
    successRate: successes / records.length,
    targetFailureRate: records.filter((entry) => entry.receipt.metrics.targetFailureObserved).length / records.length,
    accuracy: average("accuracy"),
    safety: average("safety"),
    editability: average("editability"),
    exportQuality: average("exportQuality"),
    userCompletion: average("userCompletion"),
    medianLatencyMs: median(records.map((entry) => entry.receipt.metrics.latencyMs)),
    costPerSuccessUsd: records.reduce((total, entry) => total + entry.receipt.metrics.costUsd, 0) / successes,
  };
}

async function loadSkillReceiptReference(repoRoot, reference, options) {
  const normalized = normalizeEvidenceReference(reference, "skill evaluator receipt reference");
  const file = await stableEvidenceFile(repoRoot, normalized.path, `skill evaluator receipt ${normalized.path}`);
  const actualHash = createHash("sha256").update(file.bytes).digest("hex");
  if (actualHash !== normalized.sha256) throw new Error(`skill evaluator receipt file hash mismatch: ${normalized.path}`);
  let receipt;
  try {
    receipt = JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`skill evaluator receipt is invalid JSON: ${normalized.path}: ${error.message}`);
  }
  const verified = await verifySkillEvaluatorReceipt(repoRoot, receipt, options);
  return { ...verified, path: normalized.path, sha256: actualHash };
}

async function deriveSkillBenchmarkVerdict(repoRoot, reviewed, comparison, comparisonReference, options = {}) {
  await validateOrThrow("nodekit.skill-benchmark-input.v1.schema.json", comparison, "skill benchmark input");
  const [compiled, protectedGym] = await Promise.all([
    compileModelIntelligence(repoRoot, { write: false }),
    builderGymContext(repoRoot),
  ]);
  if (comparison.candidateId !== reviewed.candidate.candidateId) throw new Error("skill benchmark candidateId mismatch");
  if (comparison.benchmarkHash !== reviewed.candidate.protectedBenchmarkHash || comparison.benchmarkHash !== compiled.resolved.benchmarkHash) {
    throw new Error("protected benchmark hash changed during skill comparison");
  }
  if (comparison.harnessHash !== compiled.resolved.harnessHash) throw new Error("harness hash changed during skill comparison");
  if (comparison.evaluatorHash !== protectedGym.evaluator.hash) throw new Error("protected evaluator hash changed during skill comparison");
  if (comparison.candidateSkillHash !== reviewed.skillHash) throw new Error("candidate skill hash differs from the reviewed skill");
  if (comparison.baselineSkillHash === comparison.candidateSkillHash) throw new Error("skill comparison arms must have distinct immutable skill hashes");
  const protectedTaskIds = new Set(protectedGym.protectedTaskIds);
  const taskInputs = new Map();
  for (const fixed of comparison.taskInputs) {
    if (taskInputs.has(fixed.taskId)) throw new Error(`skill benchmark repeats fixed task id: ${fixed.taskId}`);
    if (!protectedTaskIds.has(fixed.taskId)) throw new Error(`skill benchmark task is outside the protected task set: ${fixed.taskId}`);
    taskInputs.set(fixed.taskId, fixed);
  }
  const runIds = new Set();
  const paths = new Set();
  const arms = { baseline: [], candidate: [] };
  const counts = { baseline: new Map(), candidate: new Map() };
  for (const arm of ["baseline", "candidate"]) {
    for (const reference of comparison.arms[arm]) {
      if (paths.has(reference.path)) throw new Error(`skill benchmark reuses one receipt path: ${reference.path}`);
      paths.add(reference.path);
      const record = await loadSkillReceiptReference(repoRoot, reference, options);
      const receipt = record.receipt;
      if (receipt.purpose !== "skill-benchmark" || receipt.arm !== arm) throw new Error(`skill evaluator receipt arm/purpose mismatch: ${record.path}`);
      if (receipt.candidateId !== comparison.candidateId
        || receipt.benchmarkHash !== comparison.benchmarkHash
        || receipt.harnessHash !== comparison.harnessHash
        || receipt.evaluatorHash !== comparison.evaluatorHash
        || receipt.resolvedModel !== comparison.resolvedModel) {
        throw new Error(`skill evaluator receipt changed a fixed comparison identity: ${record.path}`);
      }
      const expectedSkillHash = arm === "baseline" ? comparison.baselineSkillHash : comparison.candidateSkillHash;
      if (receipt.skillHash !== expectedSkillHash) throw new Error(`skill evaluator receipt changed its immutable ${arm} skill hash`);
      const fixed = taskInputs.get(receipt.taskId);
      if (!fixed || fixed.taskHash !== receipt.taskHash || fixed.inputHash !== receipt.inputHash) {
        throw new Error(`skill evaluator receipt changed a fixed task/input: ${record.path}`);
      }
      if (runIds.has(receipt.runId)) throw new Error(`skill benchmark repeats runId: ${receipt.runId}`);
      runIds.add(receipt.runId);
      const pair = `${receipt.taskId}\0${receipt.taskHash}\0${receipt.inputHash}`;
      counts[arm].set(pair, (counts[arm].get(pair) ?? 0) + 1);
      arms[arm].push(record);
    }
  }
  if (canonical([...counts.baseline.entries()].sort()) !== canonical([...counts.candidate.entries()].sort())) {
    throw new Error("skill benchmark arms do not contain the same fixed task/input repetitions");
  }
  if ([...taskInputs.values()].some((fixed) => !counts.baseline.has(`${fixed.taskId}\0${fixed.taskHash}\0${fixed.inputHash}`))) {
    throw new Error("skill benchmark omits a declared fixed task/input");
  }
  const baseline = aggregateSkillArm(arms.baseline);
  const candidate = aggregateSkillArm(arms.candidate);
  const nonRegression = {
    accuracy: candidate.accuracy >= baseline.accuracy,
    safety: candidate.safety >= baseline.safety,
    editability: candidate.editability >= baseline.editability,
    exportQuality: candidate.exportQuality >= baseline.exportQuality,
    userCompletion: candidate.userCompletion >= baseline.userCompletion,
    latency: acceptableIncrease(candidate.medianLatencyMs, baseline.medianLatencyMs),
    cost: acceptableIncrease(candidate.costPerSuccessUsd, baseline.costPerSuccessUsd),
  };
  const meaningfulImprovement = candidate.successRate > baseline.successRate
    && candidate.targetFailureRate < baseline.targetFailureRate;
  const passed = meaningfulImprovement && Object.values(nonRegression).every(Boolean);
  const allReferences = [...comparison.arms.baseline, ...comparison.arms.candidate];
  const closure = await computeSkillEvidenceClosure(repoRoot, allReferences);
  const evaluatorReceipts = [...arms.baseline.map((entry) => ({ ...entry, arm: "baseline" })), ...arms.candidate.map((entry) => ({ ...entry, arm: "candidate" }))]
    .map((entry) => ({ arm: entry.arm, path: entry.path, receiptHash: entry.receiptHash, runId: entry.receipt.runId, sha256: entry.sha256, taskId: entry.receipt.taskId }))
    .sort((left, right) => compareCodeUnits(left.arm, right.arm) || compareCodeUnits(left.runId, right.runId));
  const trustedKeyIds = [...new Set([...arms.baseline, ...arms.candidate].map((entry) => entry.keyId))].sort();
  const body = {
    schemaVersion: "nodekit.skill-benchmark-verdict/v1",
    candidateId: comparison.candidateId,
    benchmarkHash: comparison.benchmarkHash,
    harnessHash: comparison.harnessHash,
    evaluatorHash: comparison.evaluatorHash,
    resolvedModel: comparison.resolvedModel,
    baselineSkillHash: comparison.baselineSkillHash,
    candidateSkillHash: comparison.candidateSkillHash,
    fixedTaskInputHash: hash([...taskInputs.values()].sort((left, right) => compareCodeUnits(left.taskId, right.taskId))),
    benchmarkInput: comparisonReference,
    evaluatorReceipts,
    evidenceClosureRootSha256: closure.rootHash,
    trustedKeyIds,
    arms: { baseline, candidate },
    meaningfulImprovement,
    nonRegression,
    passed,
    measurementAuthority: "protected-evaluator-signed",
    protectedEvaluationPassed: true,
    promotionAuthorized: false,
  };
  const verdictHash = hash(body);
  const verdict = { ...body, verdictId: `skill-benchmark:sha256:${verdictHash}`, verdictHash };
  await validateOrThrow("nodekit.skill-benchmark-verdict.v1.schema.json", verdict, "skill benchmark verdict");
  return verdict;
}

export async function verifySkillBenchmarkVerdict(repoRoot, verdictValue, options = {}) {
  const verdict = structuredClone(verdictValue);
  delete verdict.output;
  await validateOrThrow("nodekit.skill-benchmark-verdict.v1.schema.json", verdict, "skill benchmark verdict");
  const expectedHash = hash(skillRecordBody(verdict));
  if (verdict.verdictHash !== expectedHash || verdict.verdictId !== `skill-benchmark:sha256:${expectedHash}`) {
    throw new Error("skill benchmark verdict content address mismatch");
  }
  const inputFile = await stableEvidenceFile(repoRoot, verdict.benchmarkInput.path, "skill benchmark input");
  const inputSha256 = createHash("sha256").update(inputFile.bytes).digest("hex");
  if (inputSha256 !== verdict.benchmarkInput.sha256) throw new Error("skill benchmark input hash mismatch");
  const comparison = JSON.parse(inputFile.bytes.toString("utf8"));
  const reviewed = await reviewSkillCandidate(repoRoot, verdict.candidateId);
  const derived = await deriveSkillBenchmarkVerdict(repoRoot, reviewed, comparison, verdict.benchmarkInput, options);
  if (canonical(derived) !== canonical(verdict)) throw new Error("skill benchmark verdict differs from protected evaluator receipts");
  return { verdict, verdictHash: expectedHash, verified: true };
}

export async function benchmarkSkillCandidate(repoRoot, candidateId, comparisonPath, options = {}) {
  const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
  const source = path.resolve(comparisonPath);
  const sourceRelative = repositoryRelativeTarget(repoRoot, source, "skill benchmark input").relative;
  const sourceStable = await stableEvidenceFile(repoRoot, sourceRelative, "skill benchmark input");
  const comparison = JSON.parse(sourceStable.bytes.toString("utf8"));
  await validateOrThrow("nodekit.skill-benchmark-input.v1.schema.json", comparison, "skill benchmark input");
  const inputHash = hash(comparison);
  const inputTarget = path.join(repoRoot, "harness", "receipts", "skill-benchmarks", "inputs", `${inputHash}.json`);
  const storedInput = await writeImmutableJson(repoRoot, inputTarget, comparison, "skill benchmark input");
  const comparisonReference = {
    path: path.relative(repoRoot, inputTarget).replaceAll("\\", "/"),
    sha256: storedInput.sha256,
  };
  const verdict = await deriveSkillBenchmarkVerdict(repoRoot, reviewed, comparison, comparisonReference, options);
  const verdictTarget = path.join(repoRoot, "harness", "receipts", "skill-benchmarks", "verdicts", `${verdict.verdictHash}.json`);
  await writeImmutableJson(repoRoot, verdictTarget, verdict, "skill benchmark verdict");
  reviewed.candidate.status = verdict.passed ? "benchmark-passed" : "benchmark-failed";
  await atomicWriteFile(repoRoot, path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`, "skill candidate benchmark state");
  await atomicWriteFile(repoRoot, path.join(reviewed.root, "benchmark-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`, "skill candidate benchmark verdict");
  return { ...verdict, output: path.relative(repoRoot, verdictTarget).replaceAll("\\", "/") };
}

export async function evaluateTournament(repoRoot, manifestPath) {
  const manifestRelative = repositoryRelativeTarget(repoRoot, path.resolve(manifestPath), "skill tournament manifest").relative;
  const manifestStable = await stableEvidenceFile(repoRoot, manifestRelative, "skill tournament manifest");
  const tournament = JSON.parse(manifestStable.bytes.toString("utf8"));
  await validateOrThrow("nodekit.tournament.v1.schema.json", tournament, "tournament");
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  if (tournament.benchmarkHash !== compiled.resolved.benchmarkHash || tournament.harnessHash !== compiled.resolved.harnessHash) {
    throw new Error("tournament is not bound to the current protected benchmark and harness");
  }
  const wins = Object.fromEntries(tournament.candidates.map((candidate) => [candidate, 0]));
  for (const result of tournament.pairwiseResults) {
    if (!tournament.candidates.includes(result.left) || !tournament.candidates.includes(result.right)) throw new Error("pairwise result references an unknown candidate");
    if (![result.left, result.right].includes(result.winner)) throw new Error("pairwise winner must be one of the compared candidates");
    if ([result.left, result.right].includes(result.criticId)) throw new Error("candidate cannot serve as its own decisive critic");
    wins[result.winner] += 1;
  }
  const ranked = Object.entries(wins).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const decisive = ranked.length > 1 && ranked[0][1] > ranked[1][1];
  const verdict = {
    schemaVersion: "nodekit.tournament-verdict/v1",
    tournamentId: tournament.tournamentId,
    tournamentHash: hash(tournament),
    wins,
    winner: decisive ? ranked[0][0] : null,
    decisive,
    promotionAuthorized: false,
  };
  const root = path.join(repoRoot, "harness", "tournaments", tournament.tournamentId);
  await ensureSecureHarnessDirectory(repoRoot, root, "skill tournament directory");
  await atomicWriteFile(repoRoot, path.join(root, "manifest.json"), manifestStable.bytes, "skill tournament manifest snapshot");
  await atomicWriteFile(repoRoot, path.join(root, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`, "skill tournament verdict");
  return verdict;
}

const scopePriority = { project: 3, domain: 2, ecosystem: 1 };
const confidencePriority = { high: 3, medium: 2, low: 1 };

export async function loadActiveHarnessVersion(repoRoot) {
  const currentFile = await stableEvidenceFile(repoRoot, "harness/versions/current.json", "current harness pointer");
  const current = JSON.parse(currentFile.bytes.toString("utf8"));
  exactKeys(current, ["manifestHash", "schemaVersion", "version"], "current harness pointer");
  if (current.schemaVersion !== "nodekit.harness-current/v1" || !/^h\d+$/u.test(current.version) || !SHA256.test(current.manifestHash)) {
    throw new Error("current harness pointer is invalid");
  }
  const manifestPath = `harness/versions/${current.version}/manifest.json`;
  const manifestFile = await stableEvidenceFile(repoRoot, manifestPath, "active harness manifest");
  const manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  if (manifest.schemaVersion !== "nodekit.harness-version/v1" || manifest.version !== current.version || hash(manifest) !== current.manifestHash) {
    throw new Error("current harness pointer does not bind its version manifest");
  }
  if (!Array.isArray(manifest.activeSkills) || !Array.isArray(manifest.activeSkillBindings)
    || canonical(manifest.activeSkills) !== canonical(manifest.activeSkillBindings.map((entry) => entry.path))) {
    throw new Error("active harness manifest does not bind every skill path");
  }
  const skills = [];
  const seenIds = new Set();
  const expectedPrefix = `harness/versions/${current.version}/skills/`;
  for (const [index, binding] of manifest.activeSkillBindings.entries()) {
    const reference = normalizeEvidenceReference(binding, `activeSkillBindings[${index}]`);
    if (!reference.path.startsWith(expectedPrefix)) throw new Error(`active skill is outside immutable version ${current.version}: ${reference.path}`);
    const file = await stableEvidenceFile(repoRoot, reference.path, `active skill ${reference.path}`);
    if (createHash("sha256").update(file.bytes).digest("hex") !== reference.sha256) throw new Error(`active skill snapshot hash mismatch: ${reference.path}`);
    const skill = parseYaml(file.bytes.toString("utf8"));
    await validateOrThrow("nodekit.skill.v1.schema.json", skill, `active skill ${reference.path}`);
    if (seenIds.has(skill.id)) throw new Error(`active harness contains duplicate skill id: ${skill.id}`);
    seenIds.add(skill.id);
    skills.push({ binding: reference, skill });
  }
  return {
    current,
    manifest,
    manifestPath,
    skills,
    skillStackHash: hash({
      activeSkillBindings: manifest.activeSkillBindings,
      harnessVersion: current.version,
      manifestHash: current.manifestHash,
    }),
  };
}

function applicableSkills(stack, taskFamily, model) {
  const modelSelectors = new Set([
    model.requestedRoute,
    model.resolvedModel,
    `${model.resolvedProvider}/${model.resolvedModel}`,
  ]);
  return stack.skills.map((entry) => entry.skill).filter((skill) => {
    const taskFamilies = skill.triggers.taskFamilies ?? [];
    const models = skill.triggers.models ?? [];
    return (taskFamilies.length === 0 || taskFamilies.includes(taskFamily))
      && (models.length === 0 || models.some((selector) => modelSelectors.has(selector)));
  });
}

export async function compileRoutingPolicy(repoRoot) {
  const [compiled, activeHarness] = await Promise.all([
    compileModelIntelligence(repoRoot, { write: false }),
    loadActiveHarnessVersion(repoRoot),
  ]);
  const cards = compiled.cards.filter((card) => card.status !== "expired");
  const byFamily = new Map();
  for (const card of cards) {
    for (const family of card.scope.taskFamilies) {
      const entries = byFamily.get(family) ?? [];
      entries.push(card);
      byFamily.set(family, entries);
    }
  }
  const routes = [...byFamily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([taskFamily, entries]) => {
    const sorted = entries.sort((left, right) =>
      scopePriority[right.scope.level] - scopePriority[left.scope.level]
      || confidencePriority[right.confidence.level] - confidencePriority[left.confidence.level]
      || (right.metrics.firstPassAcceptance ?? 0) - (left.metrics.firstPassAcceptance ?? 0)
      || left.model.resolvedModel.localeCompare(right.model.resolvedModel));
    return {
      taskFamily,
      requiredCapabilities: [...new Set(sorted.flatMap((card) => card.strengths))].sort(),
      candidates: sorted.map((card, index) => {
        const active = applicableSkills(activeHarness, taskFamily, card.model);
        const ids = (kinds) => active.filter((skill) => kinds.includes(skill.kind)).map((skill) => skill.id);
        return {
          requestedRoute: card.model.requestedRoute,
          resolvedProvider: card.model.resolvedProvider,
          resolvedModel: card.model.resolvedModel,
          scope: card.scope.level,
          confidence: card.confidence.level,
          priority: index + 1,
          roleSkills: [...new Set([...card.bestRoles, ...ids(["role", "domain-role"])])].sort(),
          domainSkills: [...new Set(ids(["domain", "domain-role"]))].sort(),
          modelAdapters: [...new Set(ids(["model-adapter"]))].sort(),
          guardrails: [...new Set([...card.requiredScaffolding, ...ids(["guardrail", "recovery"])])].sort(),
          evidenceRefs: [...new Set([...card.evidenceRefs, ...active.flatMap((skill) => skill.evidenceRefs)])].sort(),
        };
      }),
      fallback: { type: "deterministic", skill: "nodekit.unprofiled-safe-fallback" },
      completion: { requireProposal: true, requireArtifactInspection: true, directMutation: false },
    };
  });
  const policy = {
    schemaVersion: "nodekit.routing-policy/v1",
    applicationId: compiled.harness.applicationId,
    status: "provisional",
    evidencePrecedence: ["project", "domain", "ecosystem", "unprofiled-fallback"],
    routes,
    automaticPromotion: false,
    compiledFrom: {
      activeSkillHashes: activeHarness.skills.map((entry) => entry.binding.sha256).sort(),
      harnessHash: compiled.resolved.harnessHash,
      harnessVersion: activeHarness.current.version,
      harnessVersionManifestHash: activeHarness.current.manifestHash,
      skillStackHash: activeHarness.skillStackHash,
      benchmarkHash: compiled.resolved.benchmarkHash,
      cardHashes: cards.map(hash).sort(),
    },
  };
  await validateOrThrow("nodekit.routing-policy.v1.schema.json", policy, "routing policy");
  const root = path.join(repoRoot, ".nodekit", "harness");
  await ensureSecureHarnessDirectory(repoRoot, root, "routing compiler output");
  await atomicWriteFile(repoRoot, path.join(root, "resolved-routing-policy.json"), `${JSON.stringify(policy, null, 2)}\n`, "resolved routing policy");
  await atomicWriteFile(repoRoot, path.join(root, "routing-decision-receipt.json"), `${JSON.stringify({
    schemaVersion: "nodekit.routing-decision-receipt/v1",
    applicationId: policy.applicationId,
    policyHash: hash(policy),
    routeCount: policy.routes.length,
    evidencePrecedence: policy.evidencePrecedence,
    provisional: true,
    promotionAuthorized: false,
  }, null, 2)}\n`, "routing decision receipt");
  return policy;
}

async function readStableJsonFile(repoRoot, file, label) {
  const relative = repositoryRelativeTarget(repoRoot, path.resolve(file), label).relative;
  const stable = await stableEvidenceFile(repoRoot, relative, label);
  try {
    return { bytes: stable.bytes, value: JSON.parse(stable.bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

export async function verifyCanary(repoRoot, canaryPath, options = {}) {
  const source = await readStableJsonFile(repoRoot, canaryPath, "skill canary receipt");
  const verified = await verifySkillEvaluatorReceipt(repoRoot, source.value, options);
  const canary = verified.receipt;
  if (canary.purpose !== "skill-canary" || canary.arm !== "canary") throw new Error("skill canary requires a canary-purpose protected evaluator receipt");
  if (canary.canary?.freshContext !== true
    || canary.canary?.humanReprompts !== 0
    || canary.canary?.substantiveChanges !== true
    || canary.canary?.checksPassed !== true
    || canary.metrics.success !== true
    || canary.metrics.targetFailureObserved !== false
    || canary.metrics.safety !== 1) {
    throw new Error("skill canary did not satisfy protected fresh-context, safety, and completion checks");
  }
  const [compiled, gym, reviewed] = await Promise.all([
    compileModelIntelligence(repoRoot, { write: false }),
    builderGymContext(repoRoot),
    reviewSkillCandidate(repoRoot, canary.candidateId),
  ]);
  if (canary.benchmarkHash !== compiled.resolved.benchmarkHash
    || canary.harnessHash !== compiled.resolved.harnessHash
    || canary.evaluatorHash !== gym.evaluator.hash
    || canary.skillHash !== reviewed.skillHash) {
    throw new Error("skill canary is not bound to the current protected benchmark, harness, evaluator, and reviewed skill");
  }
  const output = path.join(repoRoot, "harness", "receipts", "canaries", `${canary.receiptHash}.json`);
  await writeImmutableJson(repoRoot, output, canary, "skill canary receipt");
  return {
    ...canary,
    output: path.relative(repoRoot, output).replaceAll("\\", "/"),
    trustedKeyId: verified.keyId,
    verified: true,
  };
}

async function verifyAndStoreSkillIntegrity(repoRoot, proofPath, options = {}) {
  const source = await readStableJsonFile(repoRoot, proofPath, "skill integrity receipt");
  const verified = await verifySkillIntegrityReceipt(repoRoot, source.value, options);
  const output = path.join(repoRoot, "harness", "receipts", "skill-integrity", `${verified.receiptHash}.json`);
  await writeImmutableJson(repoRoot, output, verified.receipt, "skill integrity receipt");
  return {
    ...verified.receipt,
    output: path.relative(repoRoot, output).replaceAll("\\", "/"),
    trustedKeyId: verified.keyId,
    verified: true,
  };
}

async function verifyAndStoreSkillPromotionApproval(repoRoot, approvalPath, expected, options = {}) {
  const source = await readStableJsonFile(repoRoot, approvalPath, "skill promotion approval");
  const verified = await verifySkillPromotionApproval(source.value, expected, options);
  const output = path.join(repoRoot, "harness", "receipts", "skill-approvals", `${verified.approvalHash}.json`);
  await writeImmutableJson(repoRoot, output, verified.approval, "skill promotion approval");
  return {
    ...verified.approval,
    output: path.relative(repoRoot, output).replaceAll("\\", "/"),
    trustedKeyId: verified.keyId,
    verified: true,
  };
}

function skillDirectory(kind) {
  if (kind === "role") return "roles";
  if (kind === "domain" || kind === "domain-role") return "domains";
  if (kind === "model-adapter") return "models";
  if (kind === "recovery") return "recovery";
  return "guardrails";
}

export async function promoteSkillCandidate(repoRoot, candidateId, { approvalPath, canaryPath, proofPath, trustedKeys } = {}) {
  if (!String(approvalPath ?? "").trim()) throw new Error("a detached skill promotion approval is required; automatic promotion is prohibited");
  return withHarnessMutationLock(repoRoot, async () => {
    const verificationOptions = { trustedKeys };
    const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
    if (reviewed.candidate.status !== "benchmark-passed") {
      throw new Error(`skill promotion requires benchmark-passed candidate status, got ${reviewed.candidate.status}`);
    }
    const verdictSource = await readStableJsonFile(repoRoot, path.join(reviewed.root, "benchmark-verdict.json"), "skill benchmark verdict");
    const benchmarkVerification = await verifySkillBenchmarkVerdict(repoRoot, verdictSource.value, verificationOptions);
    const verdict = benchmarkVerification.verdict;
    if (verdict.passed !== true) throw new Error("skill benchmark has not passed");
    if (verdict.candidateSkillHash !== reviewed.skillHash || verdict.protectedEvaluationPassed !== true) {
      throw new Error("skill benchmark is not protected-evaluator derived for the reviewed skill");
    }
    const canary = await verifyCanary(repoRoot, canaryPath, verificationOptions);
    if (canary.candidateId !== candidateId) throw new Error("canary candidateId mismatch");
    if (canary.benchmarkHash !== verdict.benchmarkHash
      || canary.harnessHash !== verdict.harnessHash
      || canary.evaluatorHash !== verdict.evaluatorHash
      || canary.resolvedModel !== verdict.resolvedModel) {
      throw new Error("skill canary changed a protected benchmark identity");
    }
    const proof = await verifyAndStoreSkillIntegrity(repoRoot, proofPath, verificationOptions);
    if (proof.candidateId !== candidateId
      || proof.benchmarkVerdictHash !== verdict.verdictHash
      || proof.canaryReceiptHash !== canary.receiptHash
      || proof.passed !== true
      || proof.integrityVerified !== true) {
      throw new Error("a matching trusted, evidence-bound skill integrity receipt is required");
    }
    const benchmarkKeys = new Set(verdict.trustedKeyIds);
    if (benchmarkKeys.has(canary.trustedKeyId)
      || benchmarkKeys.has(proof.trustedKeyId)
      || canary.trustedKeyId === proof.trustedKeyId) {
      throw new Error("benchmark, canary, and integrity attestations require independent trusted signing keys");
    }

    const currentPath = path.join(repoRoot, "harness", "versions", "current.json");
    const currentStable = await stableEvidenceFile(repoRoot, "harness/versions/current.json", "current harness pointer");
    const currentBytes = currentStable.bytes;
    const current = JSON.parse(currentBytes.toString("utf8"));
    const previousManifestPath = `harness/versions/${current.version}/manifest.json`;
    const previousManifestStable = await stableEvidenceFile(repoRoot, previousManifestPath, "current harness manifest");
    const previousManifest = JSON.parse(previousManifestStable.bytes.toString("utf8"));
    if (current.manifestHash !== hash(previousManifest)) throw new Error("current harness pointer does not bind its version manifest");
    const approvalExpected = {
      benchmarkVerdictHash: verdict.verdictHash,
      candidateId,
      candidateSkillHash: reviewed.skillHash,
      canaryReceiptHash: canary.receiptHash,
      currentHarnessManifestHash: current.manifestHash,
      currentHarnessVersion: current.version,
      integrityReceiptHash: proof.receiptHash,
    };
    const approval = await verifyAndStoreSkillPromotionApproval(repoRoot, approvalPath, approvalExpected, verificationOptions);
    if (benchmarkKeys.has(approval.trustedKeyId)
      || [canary.trustedKeyId, proof.trustedKeyId].includes(approval.trustedKeyId)) {
      throw new Error("promotion approval requires a fourth independent trusted signing key");
    }
    const approvalConsumptionRef = `harness/receipts/skill-approvals/consumed/${approval.approvalHash}.json`;
    const approvalConsumptionPath = path.join(repoRoot, ...approvalConsumptionRef.split("/"));
    if (await existingStatus(approvalConsumptionPath)) throw new Error("skill promotion approval was already consumed");

    // Reopen the immutable copies and their transitive evidence immediately
    // before the first promotion write. A candidate cannot win a TOCTOU race by
    // replacing the original benchmark, canary, proof, or evidence files.
    await verifySkillBenchmarkVerdict(repoRoot, verdict, verificationOptions);
    await verifyCanary(repoRoot, path.join(repoRoot, ...canary.output.split("/")), verificationOptions);
    await verifyAndStoreSkillIntegrity(repoRoot, path.join(repoRoot, ...proof.output.split("/")), verificationOptions);
    await verifySkillPromotionApproval(
      JSON.parse((await stableEvidenceFile(repoRoot, approval.output, "immutable skill promotion approval")).bytes.toString("utf8")),
      approvalExpected,
      verificationOptions,
    );
    const nextNumber = Number(String(current.version).replace(/^h/, "")) + 1;
    if (!Number.isInteger(nextNumber)) throw new Error(`current harness version is invalid: ${current.version}`);
    const nextVersion = `h${nextNumber}`;
    const versionRoot = path.join(repoRoot, "harness", "versions", nextVersion);
    const promotionId = `promotion-${candidateId}-${nextVersion}`;
    const approvalConsumption = {
      schemaVersion: "nodekit.skill-promotion-approval-consumption/v1",
      approvalId: approval.approvalId,
      approvalHash: approval.approvalHash,
      approvalNonce: approval.nonce,
      candidateId,
      promotionId,
      targetHarnessVersion: nextVersion,
      consumedAt: new Date().toISOString(),
    };
    await validateOrThrow(
      "nodekit.skill-promotion-approval-consumption.v1.schema.json",
      approvalConsumption,
      "skill promotion approval consumption",
    );
    await writeImmutableJson(repoRoot, approvalConsumptionPath, approvalConsumption, "skill promotion approval consumption");

    const skillSnapshots = new Map();
    for (const binding of previousManifest.activeSkillBindings ?? []) {
      const stable = await stableEvidenceFile(repoRoot, binding.path, `active skill ${binding.path}`);
      const actual = createHash("sha256").update(stable.bytes).digest("hex");
      if (actual !== binding.sha256) throw new Error(`active skill snapshot hash mismatch: ${binding.path}`);
      skillSnapshots.set(versionedSkillTail(binding.path), stable.bytes);
    }
    if ((previousManifest.activeSkills ?? []).length !== skillSnapshots.size) {
      throw new Error("previous harness manifest does not content-bind every active skill");
    }
    const promotedTail = `${skillDirectory(reviewed.skill.kind)}/${reviewed.skill.id}.yaml`;
    skillSnapshots.set(promotedTail, Buffer.from(stringifyYaml(reviewed.skill), "utf8"));
    const activeSkillBindings = [];
    for (const [tail, bytes] of [...skillSnapshots.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
      const target = path.join(versionRoot, "skills", ...tail.split("/"));
      const stored = await writeImmutableBytes(repoRoot, target, bytes, `harness ${nextVersion} skill ${tail}`);
      activeSkillBindings.push({
        path: path.relative(repoRoot, target).replaceAll("\\", "/"),
        sha256: stored.sha256,
      });
    }
    const activeSkills = activeSkillBindings.map((entry) => entry.path);
    const benchmarkVerdictRef = `harness/receipts/skill-benchmarks/verdicts/${verdict.verdictHash}.json`;
    await verifySkillBenchmarkVerdict(repoRoot, JSON.parse((await stableEvidenceFile(repoRoot, benchmarkVerdictRef, "immutable skill benchmark verdict")).bytes.toString("utf8")), verificationOptions);
    const promotion = {
      schemaVersion: "nodekit.promotion-receipt/v1",
      promotionId,
      candidateId,
      kind: "skill",
      benchmarkVerdictRef,
      canaryReceiptRef: canary.output,
      nodeProofReceiptRef: proof.output,
      approvalReceiptRef: approval.output,
      approvalReceiptHash: approval.approvalHash,
      approvalConsumptionRef,
      nodeProofVerified: true,
      rollbackVersion: current.version,
      automatic: false,
      approvedBy: approval.approvedBy,
      promotedHash: reviewed.skillHash,
      attestationKeyIds: {
        benchmark: [...benchmarkKeys].sort(compareCodeUnits),
        canary: canary.trustedKeyId,
        integrity: proof.trustedKeyId,
        approval: approval.trustedKeyId,
      },
    };
    await validateOrThrow("nodekit.promotion-receipt.v1.schema.json", promotion, "promotion receipt");
    const manifest = {
      schemaVersion: "nodekit.harness-version/v1",
      version: nextVersion,
      previousVersion: current.version,
      status: "promoted",
      activeSkills,
      activeSkillBindings,
      promotionReceiptId: promotion.promotionId,
    };
    await writeImmutableJson(repoRoot, path.join(versionRoot, "manifest.json"), manifest, `harness ${nextVersion} manifest`);
    const receiptPath = path.join(repoRoot, "harness", "receipts", "skill-promotions", `${promotion.promotionId}.json`);
    await writeImmutableJson(repoRoot, receiptPath, promotion, "skill promotion receipt");
    reviewed.candidate.status = "promoted";
    await atomicWriteFile(repoRoot, path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`, "skill candidate promotion state");
    const compiledRoot = path.join(repoRoot, ".nodekit", "harness");
    await atomicWriteFile(repoRoot, path.join(compiledRoot, "resolved-skill-stack.json"), `${JSON.stringify({ schemaVersion: "nodekit.resolved-skill-stack/v1", harnessVersion: nextVersion, activeSkills, activeSkillBindings, promotionReceiptId: promotion.promotionId }, null, 2)}\n`, "resolved skill stack promotion");
    if (!(await stableEvidenceFile(repoRoot, "harness/versions/current.json", "current harness pointer before promotion commit")).bytes.equals(currentBytes)) throw new Error("current harness pointer changed during promotion");
    await atomicWriteFile(repoRoot, currentPath, `${JSON.stringify({ schemaVersion: "nodekit.harness-current/v1", version: nextVersion, manifestHash: hash(manifest) }, null, 2)}\n`, "current harness promotion pointer");
    return { promotion, nextVersion, receiptPath };
  });
}

export async function rejectSkillCandidate(repoRoot, candidateId, reason) {
  if (!String(reason ?? "").trim()) throw new Error("rejection reason is required");
  const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
  reviewed.candidate.status = "rejected";
  await atomicWriteFile(repoRoot, path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`, "rejected skill candidate state");
  const verdict = { schemaVersion: "nodekit.skill-rejection/v1", candidateId, reason: String(reason).trim(), candidateHash: reviewed.candidateHash };
  await atomicWriteFile(repoRoot, path.join(reviewed.root, "rejection.json"), `${JSON.stringify(verdict, null, 2)}\n`, "skill rejection record");
  return verdict;
}

export async function rollbackHarness(repoRoot) {
  return withHarnessMutationLock(repoRoot, async () => {
    const currentPath = path.join(repoRoot, "harness", "versions", "current.json");
    const currentBytes = (await stableEvidenceFile(repoRoot, "harness/versions/current.json", "current harness rollback pointer")).bytes;
    const current = JSON.parse(currentBytes.toString("utf8"));
    const manifest = JSON.parse((await stableEvidenceFile(repoRoot, `harness/versions/${current.version}/manifest.json`, "current harness rollback manifest")).bytes.toString("utf8"));
    if (current.manifestHash !== hash(manifest)) throw new Error("current harness pointer does not bind its version manifest");
    if (!manifest.previousVersion) throw new Error(`${current.version} has no previous version to roll back to`);
    const previous = JSON.parse((await stableEvidenceFile(repoRoot, `harness/versions/${manifest.previousVersion}/manifest.json`, "target harness rollback manifest")).bytes.toString("utf8"));
    for (const binding of previous.activeSkillBindings ?? []) {
      const stable = await stableEvidenceFile(repoRoot, binding.path, `rollback skill ${binding.path}`);
      if (createHash("sha256").update(stable.bytes).digest("hex") !== binding.sha256) throw new Error(`rollback skill snapshot hash mismatch: ${binding.path}`);
    }
    if ((previous.activeSkills ?? []).length !== (previous.activeSkillBindings ?? []).length) {
      throw new Error("rollback manifest does not content-bind every active skill");
    }
    const compiledRoot = path.join(repoRoot, ".nodekit", "harness");
    await atomicWriteFile(repoRoot, path.join(compiledRoot, "resolved-skill-stack.json"), `${JSON.stringify({ schemaVersion: "nodekit.resolved-skill-stack/v1", harnessVersion: manifest.previousVersion, activeSkills: previous.activeSkills ?? [], activeSkillBindings: previous.activeSkillBindings ?? [], rolledBackFrom: current.version }, null, 2)}\n`, "resolved skill stack rollback");
    const receipt = { schemaVersion: "nodekit.harness-rollback/v1", from: current.version, to: manifest.previousVersion, preservedVersions: true };
    await writeImmutableJson(repoRoot, path.join(repoRoot, "harness", "receipts", `rollback-${current.version}-to-${manifest.previousVersion}.json`), receipt, "harness rollback receipt");
    if (manifest.promotionReceiptId) {
      const promotionPath = `harness/receipts/skill-promotions/${manifest.promotionReceiptId}.json`;
      const promotion = JSON.parse((await stableEvidenceFile(repoRoot, promotionPath, "rolled-back promotion receipt")).bytes.toString("utf8"));
      const reviewed = await reviewSkillCandidate(repoRoot, promotion.candidateId);
      reviewed.candidate.status = "proposed";
      await atomicWriteFile(repoRoot, path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`, "rolled-back skill candidate state");
    }
    if (!(await stableEvidenceFile(repoRoot, "harness/versions/current.json", "current harness pointer before rollback commit")).bytes.equals(currentBytes)) throw new Error("current harness pointer changed during rollback");
    await atomicWriteFile(repoRoot, currentPath, `${JSON.stringify({ schemaVersion: "nodekit.harness-current/v1", version: manifest.previousVersion, manifestHash: hash(previous) }, null, 2)}\n`, "current harness rollback pointer");
    return receipt;
  });
}

export async function harnessStatus(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const current = await readJson(path.join(repoRoot, "harness", "versions", "current.json"));
  const proposed = await proposeSkillCandidates(repoRoot);
  const builder = await builderGymStatus(repoRoot);
  return {
    schemaVersion: "nodekit.harness-status/v1",
    applicationId: compiled.harness.applicationId,
    version: current.version,
    harnessHash: compiled.resolved.harnessHash,
    benchmarkHash: compiled.resolved.benchmarkHash,
    observations: compiled.observations.length,
    capabilityCards: compiled.cards.length,
    builderGym: {
      automaticPromotion: builder.automaticPromotion,
      evaluatorHash: builder.evaluatorHash,
      mechanicsReady: builder.mechanicsReady,
      promotionAuthorized: builder.promotionAuthorized,
      realWorldEvidence: builder.realWorldEvidence,
      trajectories: builder.trajectoryCount,
      verdicts: builder.verdictCount,
    },
    skillCandidates: proposed.candidates.map(({ candidate }) => ({ id: candidate.candidateId, status: candidate.status })),
    routingCertified: false,
    automaticPromotion: false,
  };
}
