import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  evidenceCandidateCommit,
  evidenceContractPasses,
  evidenceSourceHash,
  createSubmissionCandidateRecord,
  parseGitStatusZ,
  readSubmissionEvidenceFile,
  releaseCandidateBinding,
  requiredSubmissionGates,
  resolveSubmissionEvidenceClosure,
  portableEvidencePath,
  submissionEvidenceRootSha256,
  submissionCandidateEvidencePath,
  submissionGateSchemas,
  transitiveSubmissionEvidence,
  validatePackageArchiveEvidence,
} from "./submission-gate.mjs";
import { computeNodeKitSourceHash } from "./source-hash.mjs";
import { validateSchema } from "./schema-validation.mjs";
import { EXTERNALLY_OBSERVED_GATE_TYPES, verifyDetachedAttestation } from "./submission-attestation.mjs";

const ZERO_HASH = "0".repeat(64);
const SHA256 = /^[a-f0-9]{64}$/;

export const canonicalSubmissionEvidence = Object.freeze([
  Object.freeze({ id: "developerTimingMatrix", path: "proof/ease/developer-timing-verdict.json" }),
  Object.freeze({ id: "freshAgentHeldout", path: "proof/ease/fresh-agent-verdict.json" }),
  Object.freeze({ id: "freshHumanUsability", path: "proof/ease/fresh-users-verdict.json" }),
  Object.freeze({ id: "threeConvexConsumers", path: "proof/convex-consumers-verdict.json" }),
  Object.freeze({ id: "previewDeployment", path: "proof/preview-verdict.json" }),
  Object.freeze({ id: "managedSupabasePortability", path: "proof/managed-supabase-portability-verdict.json" }),
  Object.freeze({ id: "knowledgeEvolutionAdoption", path: "proof/knowledge-evolution-adoption-verdict.json" }),
  Object.freeze({ id: "modelIntelligenceHarness", path: "proof/model-intelligence-harness-verdict.json" }),
  Object.freeze({ id: "engineeringHealth", path: "proof/engineering-health-verdict.json" }),
  Object.freeze({ id: "proofloopEaseVerification", path: "proof/proofloop-final.json" }),
  Object.freeze({ id: "packageInstallProof", path: "proof/package-install-verdict.json" }),
  Object.freeze({ id: "publicationApproval", path: "proof/publication-approval.json" }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validEvidenceReference(reference) {
  return portableEvidencePath(reference?.path)
    && SHA256.test(reference.sha256 ?? "");
}

// Node defaults execFileSync to a 1 MB buffer, which a large or dirty working tree
// overflows (ENOBUFS). Bound it explicitly so preparation fails on evidence problems,
// not on how many paths happen to be in the tree.
function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changedSourcePaths(repoRoot, candidateCommit) {
  const committed = git(repoRoot, ["diff", "--name-only", "-z", "--no-renames", `${candidateCommit}..HEAD`], null)
    .toString("utf8").split("\0").filter(Boolean);
  const working = parseGitStatusZ(git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], null));
  return [...new Set([...committed, ...working])]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !/^(?:proof|docs)\//.test(file));
}

export function resolveCandidateCommit(repoRoot, candidateRef = "HEAD") {
  const root = path.resolve(repoRoot);
  const commit = git(root, ["rev-parse", "--verify", `${candidateRef}^{commit}`]).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Unable to resolve candidate commit: ${candidateRef}`);
  return commit;
}

export async function prepareSubmissionManifest({
  repoRoot,
  candidateRef = "HEAD",
  outputPath = "proof/submission-manifest.json",
  trustedAttestationKeys,
  now = Date.now(),
} = {}) {
  const root = path.resolve(repoRoot ?? ".");
  const candidateCommit = resolveCandidateCommit(root, candidateRef);
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const sourceChanges = changedSourcePaths(root, candidateCommit);
  const sourceIsExact = sourceChanges.length === 0;
  const configuredGateIds = canonicalSubmissionEvidence.map((gate) => gate.id);
  if (configuredGateIds.join("\n") !== requiredSubmissionGates.join("\n")) {
    throw new Error("canonical submission evidence paths drifted from the required gate contract");
  }
  const gates = [];
  let releaseCandidate = null;
  let submissionCandidate = null;
  let submissionCandidateSha256 = null;

  for (const gate of canonicalSubmissionEvidence) {
    if (gate.id === "publicationApproval") {
      const boundReleaseCandidate = releaseCandidate ?? {
        nodekitCommit: candidateCommit,
        nodekitSourceHash: candidateSourceHash,
        nodekitTarballSha256: ZERO_HASH,
        packageName: "@homenshum/nodekit",
        packageVersion: "0.0.0-unverified",
      };
      if (sourceIsExact && gates.length === requiredSubmissionGates.length - 1 && gates.every((candidateGate) => candidateGate.passed === true)) {
        submissionCandidate = createSubmissionCandidateRecord({
          candidateCommit,
          candidateSourceHash,
          gates,
          releaseCandidate: boundReleaseCandidate,
        });
        const candidateBytes = Buffer.from(`${JSON.stringify(submissionCandidate, null, 2)}\n`, "utf8");
        const candidatePath = path.resolve(root, submissionCandidateEvidencePath);
        await mkdir(path.dirname(candidatePath), { recursive: true });
        await writeFile(candidatePath, candidateBytes);
        submissionCandidateSha256 = sha256(candidateBytes);
      }
    }
    let digest = ZERO_HASH;
    let passed = false;
    let nestedEvidence = [];
    try {
      const bytes = await readSubmissionEvidenceFile(root, gate.path);
      digest = sha256(bytes);
      const value = JSON.parse(bytes.toString("utf8"));
      const schemaValid = (await validateSchema(submissionGateSchemas[gate.id], value, gate.path)).length === 0;
      if (gate.id === "packageInstallProof") releaseCandidate = releaseCandidateBinding(value);
      passed = schemaValid
        && sourceIsExact
        && evidenceCandidateCommit(value) === candidateCommit
        && evidenceSourceHash(value) === candidateSourceHash
        && evidenceContractPasses(gate.id, value);
      if (gate.id === "publicationApproval" && !submissionCandidate) passed = false;
      if (passed && (EXTERNALLY_OBSERVED_GATE_TYPES.includes(gate.id) || gate.id === "proofloopEaseVerification" || gate.id === "publicationApproval")) {
        const payload = gate.id === "proofloopEaseVerification" ? value.extensions.attestationPayload : value.attestationPayload;
        const attestation = gate.id === "proofloopEaseVerification" ? value.extensions.attestation : value.attestation;
        try {
          verifyDetachedAttestation({ attestation, expectedPayloadType: gate.id, now, payload, trustedKeys: trustedAttestationKeys });
        } catch {
          passed = false;
        }
      }
      let references;
      try {
        references = await resolveSubmissionEvidenceClosure(root, gate.id, value);
      } catch {
        passed = false;
        references = transitiveSubmissionEvidence(gate.id, value);
      }
      const seen = new Set([gate.path]);
      const validReferences = references.filter((reference) => {
        if (!validEvidenceReference(reference) || seen.has(reference.path)) {
          passed = false;
          return false;
        }
        seen.add(reference.path);
        return true;
      });
      nestedEvidence = await Promise.all(validReferences.map(async (reference) => {
        try {
          const evidenceBytes = await readSubmissionEvidenceFile(root, reference.path);
          const actualHash = sha256(evidenceBytes);
          if (actualHash !== reference.sha256) passed = false;
          if (Number.isInteger(reference.bytes) && evidenceBytes.length !== reference.bytes) passed = false;
          return { path: reference.path, sha256: actualHash };
        } catch {
          passed = false;
          return { path: reference.path, sha256: ZERO_HASH };
        }
      }));
      if (passed && gate.id === "packageInstallProof") {
        try {
          await validatePackageArchiveEvidence(root, value);
        } catch {
          passed = false;
        }
      }
    } catch {
      passed = false;
    }
    gates.push({
      id: gate.id,
      passed,
      evidence: [{ path: gate.path, sha256: digest }, ...nestedEvidence],
    });
  }

  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    candidateSourceHash,
    releaseCandidate: releaseCandidate ?? {
      nodekitCommit: candidateCommit,
      nodekitSourceHash: candidateSourceHash,
      nodekitTarballSha256: ZERO_HASH,
      packageName: "@homenshum/nodekit",
      packageVersion: "0.0.0-unverified",
    },
    evidenceRootSha256: submissionEvidenceRootSha256(gates),
    gates,
  };
  const absoluteOutputPath = path.resolve(root, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    outputPath: path.relative(root, absoluteOutputPath).replaceAll("\\", "/"),
    submissionCandidate,
    submissionCandidatePath: submissionCandidateEvidencePath,
    submissionCandidateSha256,
    sourceChanges,
    sourceIsExact,
  };
}
