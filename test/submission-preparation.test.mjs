import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalSubmissionEvidence,
  prepareSubmissionManifest,
} from "../src/lib/submission-preparation.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createRepository(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  git(root, ["add", "candidate.txt"]);
  git(root, ["commit", "-m", "candidate"]);
  return { root, candidateCommit: git(root, ["rev-parse", "HEAD"]) };
}

function exactVerdicts(candidateCommit) {
  return {
    developerTimingMatrix: { schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit: candidateCommit, passed: true, observedRuns: 60 },
    freshAgentHeldout: { schemaVersion: "nodekit.fresh-agent-verdict/v1", nodekitCommit: candidateCommit, passed: true, selectedRuns: [{}, {}, {}] },
    freshHumanUsability: { schemaVersion: "nodekit.fresh-user-verdict/v1", nodekitCommit: candidateCommit, passed: true, metrics: { participantCount: 5 } },
    threeConvexConsumers: { schemaVersion: "nodekit.convex-consumers-verdict/v1", candidateCommit, passed: true, qualifyingConsumers: 3 },
    previewDeployment: { schemaVersion: "nodekit.preview-verdict/v1", candidateCommit, passed: true, freshIdentity: true, exportReopenPassed: true, cleanupPassed: true },
    proofloopEaseVerification: { subject: { repository: { candidateCommit } }, verdict: { status: "passed" }, extensions: { easeCertified: true } },
    packageInstallProof: {
      schemaVersion: "nodekit.package-install-proof/v1",
      candidateCommit,
      passed: true,
      tarballSha256: "a".repeat(64),
      checks: { freshConsumerInstall: true, packagedCliCreate: true, compile: true, check: true, demo: true, eval: true },
    },
    publicationApproval: { schemaVersion: "nodekit.publication-approval/v1", candidateCommit, approved: true, approvedBy: "owner", scopes: ["npm-publish", "convex-directory-submit"] },
  };
}

async function writeVerdicts(root, verdicts) {
  for (const gate of canonicalSubmissionEvidence) {
    await mkdir(path.dirname(path.join(root, gate.path)), { recursive: true });
    await writeFile(path.join(root, gate.path), `${JSON.stringify(verdicts[gate.id])}\n`);
  }
}

test("submission preparation emits eight distinct fail-closed gates when evidence is missing", async () => {
  const { root, candidateCommit } = await createRepository("nodekit-prepare-missing-");
  const result = await prepareSubmissionManifest({ repoRoot: root });
  assert.equal(result.manifest.candidateCommit, candidateCommit);
  assert.equal(result.manifest.gates.length, 8);
  assert.equal(new Set(result.manifest.gates.map((gate) => gate.evidence[0].path)).size, 8);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === false), true);
  assert.equal(result.manifest.gates.every((gate) => gate.evidence[0].sha256 === "0".repeat(64)), true);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "proof", "submission-manifest.json"), "utf8")),
    result.manifest,
  );
});

test("submission preparation passes only exact-candidate decisive evidence", async () => {
  const { root, candidateCommit } = await createRepository("nodekit-prepare-pass-");
  await writeVerdicts(root, exactVerdicts(candidateCommit));
  const result = await prepareSubmissionManifest({ repoRoot: root, candidateRef: candidateCommit });
  assert.equal(result.sourceIsExact, true);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === true), true);
  for (const gate of result.manifest.gates) {
    const bytes = await readFile(path.join(root, gate.evidence[0].path));
    assert.equal(gate.evidence[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

test("submission preparation never upgrades stale, invalid, or unapproved evidence", async () => {
  const { root, candidateCommit } = await createRepository("nodekit-prepare-blocked-");
  const verdicts = exactVerdicts(candidateCommit);
  verdicts.developerTimingMatrix.nodekitCommit = "a".repeat(40);
  verdicts.publicationApproval.approved = false;
  verdicts.publicationApproval.approvedBy = "";
  verdicts.publicationApproval.scopes = [];
  await writeVerdicts(root, verdicts);
  await writeFile(path.join(root, canonicalSubmissionEvidence.find((gate) => gate.id === "freshAgentHeldout").path), "not json\n");
  const result = await prepareSubmissionManifest({ repoRoot: root });
  const byId = Object.fromEntries(result.manifest.gates.map((gate) => [gate.id, gate]));
  assert.equal(byId.developerTimingMatrix.passed, false);
  assert.equal(byId.freshAgentHeldout.passed, false);
  assert.equal(byId.publicationApproval.passed, false);
  assert.match(byId.freshAgentHeldout.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(byId.freshAgentHeldout.evidence[0].sha256, "0".repeat(64));
});

test("submission preparation blocks otherwise passing evidence while source is dirty", async () => {
  const { root, candidateCommit } = await createRepository("nodekit-prepare-dirty-");
  await writeVerdicts(root, exactVerdicts(candidateCommit));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "uncommitted.mjs"), "export default true;\n");
  const result = await prepareSubmissionManifest({ repoRoot: root });
  assert.equal(result.sourceIsExact, false);
  assert.deepEqual(result.sourceChanges, ["src/uncommitted.mjs"]);
  assert.equal(result.manifest.gates.every((gate) => gate.passed === false), true);
});
