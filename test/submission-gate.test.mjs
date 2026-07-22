import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { evaluateSubmissionManifest, requiredSubmissionGates } from "../src/lib/submission-gate.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("submission gate requires all evidence, hashes, and explicit approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  execFileSync("git", ["add", "candidate.txt", "schemas"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const verdicts = {
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
  const gates = [];
  for (const id of requiredSubmissionGates) {
    const relative = `proof/${id}.json`;
    const bytes = Buffer.from(`${JSON.stringify(verdicts[id])}\n`);
    await writeFile(path.join(root, relative), bytes);
    gates.push({ id, passed: true, evidence: [{ path: relative, sha256: digest(bytes) }] });
  }
  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    gates,
  };
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  assert.equal((await evaluateSubmissionManifest(root)).submissionReady, true);
  manifest.gates.at(-1).passed = false;
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const blocked = await evaluateSubmissionManifest(root);
  assert.equal(blocked.submissionReady, false);
  assert.match(blocked.errors.join("\n"), /publicationApproval: not passed/);
});

test("submission gate rejects stale source revisions and cross-gate evidence reuse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-stale-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  execFileSync("git", ["add", "candidate.txt", "schemas"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "changed.mjs"), "export default true;\n");
  execFileSync("git", ["add", "src/changed.mjs"], { cwd: root });
  execFileSync("git", ["commit", "-m", "source changed"], { cwd: root, stdio: "ignore" });
  const evidence = Buffer.from(`${JSON.stringify({ schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit: candidateCommit, passed: true, observedRuns: 60 })}\n`);
  await writeFile(path.join(root, "proof", "shared.json"), evidence);
  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    gates: requiredSubmissionGates.map((id) => ({ id, passed: true, evidence: [{ path: "proof/shared.json", sha256: digest(evidence) }] })),
  };
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const verdict = await evaluateSubmissionManifest(root);
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /candidateCommit is stale/);
  assert.match(verdict.errors.join("\n"), /evidence path is reused/);
});

test("submission gate rejects uncommitted source and incomplete package proof", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-dirty-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  execFileSync("git", ["add", "candidate.txt", "schemas"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const verdicts = {
    developerTimingMatrix: { schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit: candidateCommit, passed: true, observedRuns: 60 },
    freshAgentHeldout: { schemaVersion: "nodekit.fresh-agent-verdict/v1", nodekitCommit: candidateCommit, passed: true, selectedRuns: [{}, {}, {}] },
    freshHumanUsability: { schemaVersion: "nodekit.fresh-user-verdict/v1", nodekitCommit: candidateCommit, passed: true, metrics: { participantCount: 5 } },
    threeConvexConsumers: { schemaVersion: "nodekit.convex-consumers-verdict/v1", candidateCommit, passed: true, qualifyingConsumers: 3 },
    previewDeployment: { schemaVersion: "nodekit.preview-verdict/v1", candidateCommit, passed: true, freshIdentity: true, exportReopenPassed: true, cleanupPassed: true },
    proofloopEaseVerification: { subject: { repository: { candidateCommit } }, verdict: { status: "passed" }, extensions: { easeCertified: true } },
    packageInstallProof: { schemaVersion: "nodekit.package-install-proof/v1", candidateCommit, passed: true, tarballSha256: "a".repeat(64), checks: {} },
    publicationApproval: { schemaVersion: "nodekit.publication-approval/v1", candidateCommit, approved: true, approvedBy: "owner", scopes: ["npm-publish", "convex-directory-submit"] },
  };
  const gates = [];
  for (const id of requiredSubmissionGates) {
    const relative = `proof/${id}.json`;
    const bytes = Buffer.from(`${JSON.stringify(verdicts[id])}\n`);
    await writeFile(path.join(root, relative), bytes);
    gates.push({ id, passed: true, evidence: [{ path: relative, sha256: digest(bytes) }] });
  }
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify({ schemaVersion: "nodekit.submission-manifest/v1", candidateCommit, gates }));
  await writeFile(path.join(root, "src", "dirty.mjs"), "export default true;\n");
  const verdict = await evaluateSubmissionManifest(root);
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /working tree contains uncommitted source changes/);
  assert.match(verdict.errors.join("\n"), /packageInstallProof: no exact-candidate decisive verdict/);
});
