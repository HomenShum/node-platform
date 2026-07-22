import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./schema-validation.mjs";

export const requiredSubmissionGates = Object.freeze([
  "developerTimingMatrix",
  "freshAgentHeldout",
  "freshHumanUsability",
  "threeConvexConsumers",
  "previewDeployment",
  "proofloopEaseVerification",
  "packageInstallProof",
  "publicationApproval",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function evaluateSubmissionManifest(repoRoot, manifestPath = "proof/submission-manifest.json") {
  const absolute = path.resolve(repoRoot, manifestPath);
  const manifest = JSON.parse(await readFile(absolute, "utf8"));
  const schemaErrors = await validateSchema("nodekit.submission-manifest.v1.schema.json", manifest, manifestPath);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const errors = [];
  const ids = manifest.gates.map((gate) => gate.id);
  for (const id of requiredSubmissionGates) {
    if (ids.filter((candidate) => candidate === id).length !== 1) errors.push(`${id}: required exactly once`);
  }
  for (const gate of manifest.gates) {
    if (gate.passed !== true) errors.push(`${gate.id}: not passed`);
    for (const evidence of gate.evidence) {
      const evidencePath = path.resolve(repoRoot, evidence.path);
      if (!evidencePath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) {
        errors.push(`${gate.id}: evidence escapes repository: ${evidence.path}`);
        continue;
      }
      try {
        const bytes = await readFile(evidencePath);
        if (sha256(bytes) !== evidence.sha256) errors.push(`${gate.id}: evidence hash mismatch: ${evidence.path}`);
      } catch {
        errors.push(`${gate.id}: evidence missing: ${evidence.path}`);
      }
    }
  }
  return {
    candidateCommit: manifest.candidateCommit,
    errors,
    passed: errors.length === 0,
    schemaVersion: "nodekit.submission-verdict/v1",
    submissionReady: errors.length === 0,
  };
}
