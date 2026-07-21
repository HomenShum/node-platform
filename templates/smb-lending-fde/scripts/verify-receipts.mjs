import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireCurrentApplicationIdentity } from "./lib/application-identity.mjs";
import { requireCleanCandidate } from "./lib/candidate.mjs";

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function readJson(relativePath) { return JSON.parse(await readFile(path.resolve(relativePath), "utf8")); }
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function verifyReceiptDigest(name, receipt) {
  const clone = structuredClone(receipt);
  const claimed = clone.receiptDigest;
  delete clone.receiptDigest;
  requireCondition(typeof claimed === "string" && claimed === digest(clone), `${name} receiptDigest does not match content`);
}
function verifyCandidateAndIdentity(name, receipt, candidate, identity) {
  requireCondition(receipt.candidate?.commit === candidate.commit && receipt.candidate?.dirty === false, `${name} is not bound to the clean candidate commit`);
  requireCondition(receipt.configHash === identity.configHash && receipt.applicationHash === identity.applicationHash, `${name} is not bound to the compiled application identity`);
}
async function verifyFixtureReference(sourceRef) {
  requireCondition(typeof sourceRef?.path === "string" && !sourceRef.path.includes(".."), "invalid fixture source path");
  const raw = await readFile(path.resolve(sourceRef.path), "utf8");
  requireCondition(createHash("sha256").update(raw).digest("hex") === sourceRef.sha256, `fixture hash mismatch for ${sourceRef.path}`);
}

const identity = requireCurrentApplicationIdentity();
const candidate = requireCleanCandidate();
const [demo, evaluation, conformance] = await Promise.all([
  readJson("proof/demo-receipt.json"), readJson("proof/eval-receipt.json"), readJson("proof/benchmark-receipt.json"),
]);
for (const [name, receipt] of [["demo", demo], ["evaluation", evaluation], ["conformance", conformance]]) {
  verifyReceiptDigest(name, receipt); verifyCandidateAndIdentity(name, receipt, candidate, identity);
}
requireCondition(demo.schemaVersion === "nodekit.smb-lending-receipt/v1", "demo receipt schema is invalid");
requireCondition(demo.sessionDigest === digest(demo.sessionSnapshot), "demo sessionDigest does not match the stored session snapshot");
requireCondition(evaluation.schemaVersion === "nodekit.smb-lending-eval-receipt/v1" && evaluation.passed === true, "evaluation receipt is not passing");
requireCondition(conformance.schemaVersion === "nodekit.smb-lending-conformance/v1" && conformance.passed === true, "conformance receipt is not passing");
for (const sourceRef of demo.sourcePackets ?? []) await verifyFixtureReference(sourceRef);
for (const result of conformance.conformance ?? []) await verifyFixtureReference(result.sourcePacket);
console.log(JSON.stringify({ applicationHash: identity.applicationHash, candidateCommit: candidate.commit, checks: { conformance: true, demo: true, evaluation: true, fixtureHashes: true, receiptDigests: true, sessionDigest: true }, passed: true, schemaVersion: "nodekit.local-receipt-verification/v1" }, null, 2));
