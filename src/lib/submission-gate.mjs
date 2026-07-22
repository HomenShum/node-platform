import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function evidenceCandidateCommit(value) {
  if (typeof value?.candidateCommit === "string") return value.candidateCommit;
  if (typeof value?.nodekitCommit === "string") return value.nodekitCommit;
  if (typeof value?.subject?.repository?.candidateCommit === "string") return value.subject.repository.candidateCommit;
  if (typeof value?.nodekitIdentity === "string") return value.nodekitIdentity.split("/")[0];
  return null;
}

export function evidenceContractPasses(gateId, value) {
  switch (gateId) {
    case "developerTimingMatrix": return value?.schemaVersion === "nodekit.developer-timing-verdict/v1" && value.passed === true && value.observedRuns >= 60;
    case "freshAgentHeldout": return value?.schemaVersion === "nodekit.fresh-agent-verdict/v1" && value.passed === true && value.selectedRuns?.length === 3;
    case "freshHumanUsability": return value?.schemaVersion === "nodekit.fresh-user-verdict/v1" && value.passed === true && value.metrics?.participantCount >= 5;
    case "threeConvexConsumers": return value?.schemaVersion === "nodekit.convex-consumers-verdict/v1" && value.passed === true && value.qualifyingConsumers === 3;
    case "previewDeployment": return value?.schemaVersion === "nodekit.preview-verdict/v1" && value.passed === true && value.freshIdentity === true && value.exportReopenPassed === true && value.cleanupPassed === true;
    case "proofloopEaseVerification": return value?.verdict?.status === "passed" && value?.extensions?.easeCertified === true;
    case "packageInstallProof": {
      const requiredChecks = ["freshConsumerInstall", "packagedCliCreate", "compile", "check", "demo", "eval"];
      return value?.schemaVersion === "nodekit.package-install-proof/v1"
        && value.passed === true
        && requiredChecks.every((check) => value?.checks?.[check] === true)
        && /^[a-f0-9]{64}$/.test(value?.tarballSha256 ?? "");
    }
    case "publicationApproval": return value?.schemaVersion === "nodekit.publication-approval/v1" && value.approved === true && Array.isArray(value.scopes) && value.scopes.includes("npm-publish") && value.scopes.includes("convex-directory-submit") && typeof value.approvedBy === "string" && value.approvedBy.length > 0;
    default: return false;
  }
}

export async function evaluateSubmissionManifest(repoRoot, manifestPath = "proof/submission-manifest.json") {
  const absolute = path.resolve(repoRoot, manifestPath);
  const manifest = JSON.parse(await readFile(absolute, "utf8"));
  const schemaErrors = await validateSchema("nodekit.submission-manifest.v1.schema.json", manifest, manifestPath);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const errors = [];
  const root = path.resolve(repoRoot);
  try {
    git(root, ["cat-file", "-e", `${manifest.candidateCommit}^{commit}`]);
    git(root, ["merge-base", "--is-ancestor", manifest.candidateCommit, "HEAD"]);
    const postCandidateChanges = git(root, ["diff", "--name-only", `${manifest.candidateCommit}..HEAD`]).split(/\r?\n/).filter(Boolean);
    const disallowed = postCandidateChanges.filter((file) => !/^(?:proof|docs|evolution)\//.test(file.replaceAll("\\", "/")));
    if (disallowed.length > 0) errors.push(`candidateCommit is stale; source changed afterward: ${disallowed.join(", ")}`);
    const dirtyPaths = git(root, ["status", "--porcelain", "--untracked-files=all"])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, "").replaceAll("\\", "/"));
    const dirtySource = dirtyPaths.filter((file) => !/^(?:proof|docs|evolution)\//.test(file));
    if (dirtySource.length > 0) errors.push(`working tree contains uncommitted source changes: ${dirtySource.join(", ")}`);
  } catch {
    errors.push(`candidateCommit is not an ancestor of repository HEAD: ${manifest.candidateCommit}`);
  }
  const ids = manifest.gates.map((gate) => gate.id);
  for (const id of requiredSubmissionGates) {
    if (ids.filter((candidate) => candidate === id).length !== 1) errors.push(`${id}: required exactly once`);
  }
  const evidenceOwners = new Map();
  for (const gate of manifest.gates) {
    if (gate.passed !== true) errors.push(`${gate.id}: not passed`);
    let contractEvidence = false;
    for (const evidence of gate.evidence) {
      const priorOwner = evidenceOwners.get(evidence.path);
      if (priorOwner && priorOwner !== gate.id) errors.push(`${gate.id}: evidence path is reused by ${priorOwner}: ${evidence.path}`);
      evidenceOwners.set(evidence.path, gate.id);
      const evidencePath = path.resolve(repoRoot, evidence.path);
      if (!evidencePath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) {
        errors.push(`${gate.id}: evidence escapes repository: ${evidence.path}`);
        continue;
      }
      try {
        const bytes = await readFile(evidencePath);
        if (sha256(bytes) !== evidence.sha256) errors.push(`${gate.id}: evidence hash mismatch: ${evidence.path}`);
        try {
          const value = JSON.parse(bytes.toString("utf8"));
          const boundCommit = evidenceCandidateCommit(value);
          if (boundCommit && boundCommit !== manifest.candidateCommit) errors.push(`${gate.id}: evidence is bound to ${boundCommit}, expected ${manifest.candidateCommit}: ${evidence.path}`);
          if (boundCommit === manifest.candidateCommit && evidenceContractPasses(gate.id, value)) contractEvidence = true;
        } catch {
          // Binary and supporting evidence are allowed, but cannot be the decisive gate verdict.
        }
      } catch {
        errors.push(`${gate.id}: evidence missing: ${evidence.path}`);
      }
    }
    if (!contractEvidence) errors.push(`${gate.id}: no exact-candidate decisive verdict satisfies the gate contract`);
  }
  return {
    candidateCommit: manifest.candidateCommit,
    errors,
    passed: errors.length === 0,
    schemaVersion: "nodekit.submission-verdict/v1",
    submissionReady: errors.length === 0,
  };
}
