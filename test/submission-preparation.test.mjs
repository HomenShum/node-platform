import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalSubmissionEvidence,
  prepareSubmissionManifest,
} from "../src/lib/submission-preparation.mjs";
import { transitiveSubmissionEvidence } from "../src/lib/submission-gate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { exactSubmissionVerdicts, submissionEvidenceFixtureBytes, submissionEvidenceFixtureClosure, submissionFixtureTrustedKeys } from "./submission-fixtures.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createRepository(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt"] })}\n`);
  git(root, ["add", "candidate.txt", "package.json"]);
  git(root, ["commit", "-m", "candidate"]);
  return { root, candidateCommit: git(root, ["rev-parse", "HEAD"]), candidateSourceHash: await computeNodeKitSourceHash(root) };
}

function exactVerdicts(candidateCommit, candidateSourceHash) {
  return exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
}

async function writeVerdicts(root, verdicts) {
  for (const gate of canonicalSubmissionEvidence) {
    for (const evidence of transitiveSubmissionEvidence(gate.id, verdicts[gate.id])) {
      const candidateCommit = verdicts[gate.id].nodekitCommit ?? verdicts[gate.id].candidateCommit ?? verdicts[gate.id].subject?.repository?.candidateCommit;
      const sourceHash = verdicts[gate.id].nodekitSourceHash ?? verdicts[gate.id].subject?.repository?.nodekitSourceHash;
      const isDecisiveCrossReference = canonicalSubmissionEvidence.some((entry) => entry.path === evidence.path);
      if (!isDecisiveCrossReference) {
        await mkdir(path.dirname(path.join(root, evidence.path)), { recursive: true });
        await writeFile(path.join(root, evidence.path), submissionEvidenceFixtureBytes(evidence.path, candidateCommit, sourceHash));
      }
      if (evidence.kind === "screenshot-manifest" && gate.id === "previewDeployment") {
        for (const child of submissionEvidenceFixtureClosure(evidence.path, candidateCommit, sourceHash)) {
          await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
          await writeFile(path.join(root, child.path), submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash));
        }
      }
    }
    await mkdir(path.dirname(path.join(root, gate.path)), { recursive: true });
    await writeFile(path.join(root, gate.path), `${JSON.stringify(verdicts[gate.id])}\n`);
  }
}

test("submission preparation emits every distinct fail-closed gate when evidence is missing", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-missing-");
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.manifest.candidateCommit, candidateCommit);
  assert.equal(result.manifest.candidateSourceHash, candidateSourceHash);
  assert.equal(result.manifest.gates.length, canonicalSubmissionEvidence.length);
  assert.equal(new Set(result.manifest.gates.map((gate) => gate.evidence[0].path)).size, canonicalSubmissionEvidence.length);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === false), true);
  assert.equal(result.submissionCandidate, null);
  assert.equal(result.submissionCandidateSha256, null);
  assert.equal(result.manifest.gates.every((gate) => gate.evidence[0].sha256 === "0".repeat(64)), true);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "proof", "submission-manifest.json"), "utf8")),
    result.manifest,
  );
});

test("submission preparation passes only exact-candidate decisive evidence", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-pass-");
  await writeVerdicts(root, exactVerdicts(candidateCommit, candidateSourceHash));
  const untrusted = await prepareSubmissionManifest({ repoRoot: root, candidateRef: candidateCommit });
  for (const id of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    assert.equal(untrusted.manifest.gates.find((gate) => gate.id === id).passed, false, `${id} passed without caller-owned trusted keys`);
  }
  assert.equal(untrusted.submissionCandidate, null);
  const result = await prepareSubmissionManifest({ repoRoot: root, candidateRef: candidateCommit, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.sourceIsExact, true);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === true), true);
  assert.equal(result.submissionCandidatePath, "proof/submission-candidate.json");
  assert.match(result.submissionCandidateSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.submissionCandidate.schemaVersion, "nodekit.submission-candidate/v1");
  assert.deepEqual(result.submissionCandidate.gates, result.manifest.gates.slice(0, -1));
  assert.equal(
    createHash("sha256").update(await readFile(path.join(root, result.submissionCandidatePath))).digest("hex"),
    result.submissionCandidateSha256,
  );
  for (const gate of result.manifest.gates) {
    const bytes = await readFile(path.join(root, gate.evidence[0].path));
    assert.equal(gate.evidence[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

test("submission preparation never upgrades stale, invalid, or unapproved evidence", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-blocked-");
  const verdicts = exactVerdicts(candidateCommit, candidateSourceHash);
  verdicts.developerTimingMatrix.nodekitCommit = "a".repeat(40);
  verdicts.publicationApproval.approved = false;
  verdicts.publicationApproval.approvedBy = "";
  verdicts.publicationApproval.scopes = [];
  await writeVerdicts(root, verdicts);
  await writeFile(path.join(root, canonicalSubmissionEvidence.find((gate) => gate.id === "freshAgentHeldout").path), "not json\n");
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  const byId = Object.fromEntries(result.manifest.gates.map((gate) => [gate.id, gate]));
  assert.equal(byId.developerTimingMatrix.passed, false);
  assert.equal(byId.freshAgentHeldout.passed, false);
  assert.equal(byId.publicationApproval.passed, false);
  assert.match(byId.freshAgentHeldout.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(byId.freshAgentHeldout.evidence[0].sha256, "0".repeat(64));
});

test("submission preparation never overwrites a decisive schema failure with hand-coded checks", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-schema-invalid-");
  const verdicts = exactVerdicts(candidateCommit, candidateSourceHash);
  // The semantic contract deliberately ignores unknown fields, while every
  // decisive schema is strict. This guards the accumulator against upgrading
  // a schema-invalid verdict after the semantic check succeeds.
  verdicts.developerTimingMatrix.unexpectedCandidateAuthoredField = true;
  await writeVerdicts(root, verdicts);
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.manifest.gates.find((gate) => gate.id === "developerTimingMatrix").passed, false);
  assert.equal(result.submissionCandidate, null);
  assert.equal(result.submissionCandidateSha256, null);
});

test("submission preparation blocks otherwise passing evidence while source is dirty", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-dirty-");
  await writeVerdicts(root, exactVerdicts(candidateCommit, candidateSourceHash));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "uncommitted.mjs"), "export default true;\n");
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.sourceIsExact, false);
  assert.deepEqual(result.sourceChanges, ["src/uncommitted.mjs"]);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === false), true);
});

test("submission preparation byte-verifies every transitive reference and package tarball", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-transitive-");
  const verdicts = exactVerdicts(candidateCommit, candidateSourceHash);
  await writeVerdicts(root, verdicts);
  const target = verdicts.packageInstallProof.supportingEvidence[0].path;
  await writeFile(path.join(root, target), "tampered\n");
  const tampered = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(tampered.manifest.gates.find((gate) => gate.id === "packageInstallProof").passed, false);
  const tarball = tampered.manifest.gates.find((gate) => gate.id === "packageInstallProof").evidence.find((entry) => entry.path === verdicts.packageInstallProof.tarball);
  assert.ok(tarball, "the package tarball must be included in the prepared evidence closure");
  assert.equal(tampered.manifest.gates.find((gate) => gate.id === "freshAgentHeldout").evidence.length, 1 + (15 * 17));
});

test("submission preparation fails closed for missing transitive evidence", async () => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-transitive-missing-");
  const verdicts = exactVerdicts(candidateCommit, candidateSourceHash);
  await writeVerdicts(root, verdicts);
  const missing = verdicts.previewDeployment.evidence.at(-1).path;
  await import("node:fs/promises").then(({ rm }) => rm(path.join(root, missing)));
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  const gate = result.manifest.gates.find((entry) => entry.id === "previewDeployment");
  assert.equal(gate.passed, false);
  assert.equal(gate.evidence.find((entry) => entry.path === missing).sha256, "0".repeat(64));
});

test("submission preparation rejects a transitive evidence path through an escaping junction", async (t) => {
  const { root, candidateCommit, candidateSourceHash } = await createRepository("nodekit-prepare-symlink-");
  const verdicts = exactVerdicts(candidateCommit, candidateSourceHash);
  const evidence = verdicts.previewDeployment.evidence.at(-1);
  evidence.path = "proof/preview/escape/cleanup-receipt.json";
  evidence.sha256 = createHash("sha256").update(submissionEvidenceFixtureBytes(evidence.path)).digest("hex");
  await writeVerdicts(root, verdicts);
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-evidence-outside-"));
  await writeFile(path.join(outside, "cleanup-receipt.json"), submissionEvidenceFixtureBytes(evidence.path));
  const link = path.join(root, "proof", "preview", "escape");
  await import("node:fs/promises").then(({ rm }) => rm(link, { force: true, recursive: true }));
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.manifest.gates.find((entry) => entry.id === "previewDeployment").passed, false);
});

test("submission preparation treats both sides of a Git rename as changed source", async () => {
  const { root } = await createRepository("nodekit-prepare-rename-");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "candidate.mjs"), "export default true;\n");
  git(root, ["add", "src/candidate.mjs"]);
  git(root, ["commit", "-m", "tracked source"]);
  const candidateCommit = git(root, ["rev-parse", "HEAD"]);
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  await writeVerdicts(root, exactVerdicts(candidateCommit, candidateSourceHash));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await rename(path.join(root, "src", "candidate.mjs"), path.join(root, "docs", "candidate.mjs"));
  git(root, ["add", "-A"]);
  const result = await prepareSubmissionManifest({ repoRoot: root, trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(result.sourceIsExact, false);
  assert.ok(result.sourceChanges.includes("src/candidate.mjs"));
});
