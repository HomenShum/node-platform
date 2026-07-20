import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changeRoot = path.join(platformRoot, "changes", "nodekit-factory-p1");
const storyRoot = path.join(changeRoot, "story");
const presentationRoot = path.join(changeRoot, "presentation");

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

test("P1 Change Story evidence and NodeSlide application graph stay internally bound", async () => {
  const evidenceIndex = await readJson(path.join(storyRoot, "evidence-index.json"));
  const claims = await readJson(path.join(storyRoot, "claims.json"));
  const slidePlans = await readJson(path.join(presentationRoot, "slide-design-plans.json"));
  const v1 = await readJson(path.join(presentationRoot, "change-card.v1.json"));
  const v2 = await readJson(path.join(presentationRoot, "change-card.v2.json"));
  const proposal = await readJson(path.join(presentationRoot, "change-card.proposal.json"));
  const application = await readJson(path.join(presentationRoot, "change-card.application.json"));
  const transport = await readJson(path.join(presentationRoot, "change-card.transport-proof.json"));

  const evidenceIds = evidenceIndex.evidence.map((entry) => entry.id);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length, "evidence IDs must be unique");
  const evidenceIdSet = new Set(evidenceIds);

  for (const claim of claims.claims) {
    for (const evidenceId of claim.evidenceIds) {
      assert.equal(evidenceIdSet.has(evidenceId), true, `claim ${claim.id} references ${evidenceId}`);
    }
  }
  for (const slide of slidePlans.slides) {
    for (const evidenceId of slide.evidenceIds) {
      assert.equal(evidenceIdSet.has(evidenceId), true, `slide ${slide.slideId} references ${evidenceId}`);
    }
  }

  for (const evidence of evidenceIndex.evidence) {
    if (/^(?:https?:|local:)/.test(evidence.location)) continue;
    await access(path.resolve(storyRoot, evidence.location));
  }

  for (const snapshot of [v1, v2]) {
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    for (const element of snapshot.elements) {
      for (const sourceId of element.sourceIds ?? []) {
        assert.equal(sourceIds.has(sourceId), true, `element ${element.id} references ${sourceId}`);
      }
    }
    for (const source of snapshot.sources) {
      if (/^(?:https?:|local:)/.test(source.citation)) continue;
      await access(path.resolve(presentationRoot, source.citation));
    }
  }

  assert.equal(proposal.base.deckVersion, v1.deck.version);
  assert.equal(proposal.patch.baseDeckVersion, v1.deck.version);
  assert.equal(proposal.candidate.deckVersion, v2.deck.version);
  assert.deepEqual(application.snapshot, v2);
  assert.equal(application.receipt.proposalId, proposal.id);
  assert.equal(transport.application.proposalId, proposal.id);
  assert.equal(application.receipt.baseSnapshotDigest, proposal.base.snapshotDigest);
  assert.equal(transport.validation.baseSnapshotDigest, proposal.base.snapshotDigest);
  assert.equal(application.receipt.resultingSnapshotDigest, proposal.candidate.snapshotDigest);
  assert.equal(transport.validation.validateCandidateDigest, proposal.candidate.snapshotDigest);
  assert.equal(transport.validation.proposalCandidateDigest, proposal.candidate.snapshotDigest);
  assert.equal(transport.application.resultingSnapshotDigest, proposal.candidate.snapshotDigest);
  assert.equal(application.receipt.patchDigest, transport.validation.patchDigest);
  assert.equal(transport.validation.deterministicCandidateParity, true);
  assert.equal(transport.boundary.sourceBound, true);
  assert.equal(transport.boundary.digestBound, true);
  assert.equal(transport.boundary.exactApproval, true);
  assert.equal(transport.boundary.claimsEvidenceCertified, false);
  assert.equal(transport.boundary.pptxExportVerified, false);
  assert.equal(transport.boundary.productionDeployed, false);
  assert.equal(transport.boundary.packagePublished, false);
});
