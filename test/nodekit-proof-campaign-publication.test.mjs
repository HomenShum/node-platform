import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaignRoot = path.join(
  repositoryRoot,
  "changes",
  "nodekit-proof-campaign-2026-07-20",
);

const readText = (relativePath) => readFile(path.join(campaignRoot, relativePath), "utf8");
const readJson = (relativePath) => readText(relativePath).then(JSON.parse);

test("Founder Quest production identity stays synchronized across campaign inputs", async () => {
  const [claims, evidence, video, approvalText] = await Promise.all([
    readJson("story/claims.json"),
    readJson("story/evidence-index.json"),
    readJson("video/founder-quest-walkthrough.json"),
    readText("campaign/campaign-approval.yaml"),
  ]);
  const approval = parseYaml(approvalText);
  const claim = claims.claims.find((candidate) => candidate.id === "C5_FOUNDER_QUEST_PRODUCT");
  const productionEvidence = evidence.evidence.find(
    (candidate) => candidate.id === "E12_FOUNDER_QUEST_PRODUCTION",
  );
  const releaseEvidence = evidence.evidence.find(
    (candidate) => candidate.id === "E13_FOUNDER_QUEST_RELEASE",
  );
  const gate = approval.releaseGates.founderQuestProductionProof;

  assert.equal(claim.status, "verified");
  assert.equal(video.productionProof.sourceCommit, claim.scope.commit);
  assert.equal(video.productionProof.evidenceCommit, claim.scope.evidenceCommit);
  assert.equal(video.productionProof.configHash, claim.scope.configHash);
  assert.equal(video.productionProof.appHash, claim.scope.appHash);
  assert.equal(video.productionProof.graphRevision, claim.scope.graphRevision);
  assert.equal(video.productionProof.receiptDigest, claim.scope.productionReceiptDigest);
  assert.equal(
    video.productionProof.unifiedReleaseReceiptDigest,
    claim.scope.unifiedReleaseReceiptDigest,
  );
  assert.equal(video.productionProof.releaseLevel, claim.scope.releaseLevel);
  assert.equal(video.productionProof.releaseReady, claim.scope.releaseReady);
  assert.equal(
    video.productionProof.hostedDeploymentCertified,
    claim.scope.hostedDeploymentCertified,
  );
  assert.equal(
    video.productionProof.artifactManifestHashesVerified,
    claim.scope.artifactManifestHashesVerified,
  );
  assert.equal(video.productionProof.testsPassed, claim.scope.testsPassed);
  assert.equal(
    video.productionProof.releaseAuditIssues,
    claim.scope.releaseAuditIssues,
  );
  assert.equal(productionEvidence.receiptDigest, claim.scope.productionReceiptDigest);
  assert.equal(
    releaseEvidence.receiptDigest,
    claim.scope.unifiedReleaseReceiptDigest,
  );
  assert.equal(productionEvidence.url, claim.scope.productionUrl);
  assert.equal(gate.sourceCommit, claim.scope.commit);
  assert.equal(gate.evidenceCommit, claim.scope.evidenceCommit);
  assert.equal(gate.appConfigHash, claim.scope.configHash);
  assert.equal(gate.graphRevision, claim.scope.graphRevision);
  assert.equal(gate.receiptDigest, claim.scope.productionReceiptDigest);
  assert.equal(
    gate.unifiedReleaseReceiptDigest,
    claim.scope.unifiedReleaseReceiptDigest,
  );
  assert.equal(gate.releaseLevel, "production-certified");
  assert.equal(gate.releaseReady, true);
  assert.equal(gate.hostedDeploymentCertified, true);
  assert.equal(gate.artifactManifestHashesVerified, 25);
  assert.equal(gate.testsPassed, 18);
  assert.equal(gate.releaseAuditIssues, 0);
  assert.equal(gate.status, "passed");
  assert.equal(gate.readOnlySynthetic, true);
  assert.equal(gate.durableWrites, false);
  assert.equal(gate.remoteNeo4jWrites, false);
  const nodeSlideGate = approval.releaseGates.nodeSlideExportReopen;
  assert.equal(nodeSlideGate.status, "passed");
  assert.equal(nodeSlideGate.slideCount, 8);
  assert.equal(nodeSlideGate.editableElements, 81);
  assert.equal(nodeSlideGate.staticFallbackElements, 1);
  assert.equal(nodeSlideGate.reopened, true);
  assert.equal(nodeSlideGate.structuralValidation, "passed");
  assert.equal(nodeSlideGate.externalPublishReady, false);
});

test("public drafts contain no unresolved tokens and preserve platform and scope boundaries", async () => {
  const [linkedin, thread, claims] = await Promise.all([
    readText("campaign/posts/linkedin.draft.md"),
    readText("campaign/posts/x-thread.draft.md"),
    readJson("story/claims.json"),
  ]);
  assert.doesNotMatch(linkedin, /\{\{[^}]+\}\}/);
  assert.doesNotMatch(thread, /\{\{[^}]+\}\}/);
  assert.match(linkedin, /no durable writes or remote Neo4j writes/i);
  assert.match(linkedin, /proves no external approval/i);
  assert.match(thread, /No durable or remote Neo4j writes/i);
  assert.match(thread, /No external approval claim/i);

  const posts = thread.split(/^## \d+\s*$/m).slice(1).map((entry) => entry.trim());
  assert.equal(posts.length, 8);
  for (const [index, post] of posts.entries()) {
    assert.ok(post.length <= 280, `X post ${index + 1} is ${post.length} characters`);
  }

  const recursive = claims.claims.find((candidate) => candidate.id === "C7_RECURSIVE_LAUNCH");
  assert.equal(recursive.status, "planned");
});
