import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  evidenceCandidateCommit,
  evidenceContractPasses,
  requiredSubmissionGates,
} from "./submission-gate.mjs";

const ZERO_HASH = "0".repeat(64);

export const canonicalSubmissionEvidence = Object.freeze([
  Object.freeze({ id: "developerTimingMatrix", path: "proof/ease/developer-timing-verdict.json" }),
  Object.freeze({ id: "freshAgentHeldout", path: "proof/ease/fresh-agent-verdict.json" }),
  Object.freeze({ id: "freshHumanUsability", path: "proof/ease/fresh-users-verdict.json" }),
  Object.freeze({ id: "threeConvexConsumers", path: "proof/convex-consumers-verdict.json" }),
  Object.freeze({ id: "previewDeployment", path: "proof/preview-verdict.json" }),
  Object.freeze({ id: "proofloopEaseVerification", path: "proof/proofloop-final.json" }),
  Object.freeze({ id: "packageInstallProof", path: "proof/package-install-verdict.json" }),
  Object.freeze({ id: "publicationApproval", path: "proof/publication-approval.json" }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function changedSourcePaths(repoRoot, candidateCommit) {
  const committed = git(repoRoot, ["diff", "--name-only", `${candidateCommit}..HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  const working = git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1));
  return [...new Set([...committed, ...working])]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !/^(?:proof|docs|evolution)\//.test(file));
}

export function resolveCandidateCommit(repoRoot, candidateRef = "HEAD") {
  const root = path.resolve(repoRoot);
  const commit = git(root, ["rev-parse", "--verify", `${candidateRef}^{commit}`]).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Unable to resolve candidate commit: ${candidateRef}`);
  return commit;
}

export async function prepareSubmissionManifest({
  repoRoot,
  candidateRef = "HEAD",
  outputPath = "proof/submission-manifest.json",
} = {}) {
  const root = path.resolve(repoRoot ?? ".");
  const candidateCommit = resolveCandidateCommit(root, candidateRef);
  const sourceChanges = changedSourcePaths(root, candidateCommit);
  const sourceIsExact = sourceChanges.length === 0;
  const configuredGateIds = canonicalSubmissionEvidence.map((gate) => gate.id);
  if (configuredGateIds.join("\n") !== requiredSubmissionGates.join("\n")) {
    throw new Error("canonical submission evidence paths drifted from the required gate contract");
  }
  const gates = [];

  for (const gate of canonicalSubmissionEvidence) {
    const absoluteEvidencePath = path.resolve(root, gate.path);
    let digest = ZERO_HASH;
    let passed = false;
    try {
      const bytes = await readFile(absoluteEvidencePath);
      digest = sha256(bytes);
      const value = JSON.parse(bytes.toString("utf8"));
      passed = sourceIsExact
        && evidenceCandidateCommit(value) === candidateCommit
        && evidenceContractPasses(gate.id, value);
    } catch {
      passed = false;
    }
    gates.push({
      id: gate.id,
      passed,
      evidence: [{ path: gate.path, sha256: digest }],
    });
  }

  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    gates,
  };
  const absoluteOutputPath = path.resolve(root, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    outputPath: path.relative(root, absoluteOutputPath).replaceAll("\\", "/"),
    sourceChanges,
    sourceIsExact,
  };
}
