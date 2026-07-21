import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PresentationGateError,
  assertCampaignPresentationGate,
  attachFounderQuestScreenshot,
  buildCampaignDeckSpec,
  buildGenerationReceipt,
  canonicalJson,
  resolveFinalPresentationMediaProof,
  sha256,
} from "../src/lib/presentation-pipeline.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presentationRoot = path.join(
  repositoryRoot,
  "changes",
  "nodekit-proof-campaign-2026-07-20",
  "presentation",
);
const storyRoot = path.resolve(presentationRoot, "..", "story");

function gateFixture() {
  return {
    availableEvidenceIds: ["E1"],
    claims: {
      claims: [
        { id: "C1", status: "verified", evidenceIds: ["E1"], text: "Verified locally." },
        { id: "C2", status: "planned", evidenceIds: [], text: "Product provides a hosted view." },
      ],
    },
    evidenceIndex: { evidence: [{ id: "E1", kind: "receipt", path: "proof.json" }] },
    slidePlans: {
      slides: [
        {
          id: "S1",
          claimIds: ["C1"],
          evidenceIds: ["E1"],
          takeaway: "The local proof passed its deterministic gate.",
        },
        {
          id: "S2",
          claimIds: ["C2"],
          evidenceIds: [],
          takeaway: "The planned hosted view will show the bounded workflow after deployment proof passes.",
        },
      ],
    },
  };
}

test("claim/evidence gate accepts verified evidence and future-only planned copy", () => {
  const result = assertCampaignPresentationGate(gateFixture());
  assert.equal(result.passed, true);
  assert.deepEqual(result.requiredEvidenceIds, ["E1"]);
  assert.deepEqual(result.plannedClaimIds, ["C2"]);
});

test("claim/evidence gate fails closed on planned product copy asserted as current reality", () => {
  const fixture = gateFixture();
  fixture.slidePlans.slides[1].takeaway = "The hosted product provides the completed workflow.";
  assert.throws(
    () => assertCampaignPresentationGate(fixture),
    (error) =>
      error instanceof PresentationGateError &&
      error.message.includes("planned claim C2 on slide S2 is asserted as already real"),
  );
});

test("claim/evidence gate fails closed on missing required evidence", () => {
  const unavailable = gateFixture();
  unavailable.availableEvidenceIds = [];
  assert.throws(
    () => assertCampaignPresentationGate(unavailable),
    /required evidence E1 is unavailable/,
  );

  const omitted = gateFixture();
  omitted.slidePlans.slides[0].evidenceIds = [];
  assert.throws(
    () => assertCampaignPresentationGate(omitted),
    /slide S1 omits required evidence E1 for claim C1/,
  );
});

test("campaign slide plan binds verified Founder Quest production evidence and keeps publication separate", async () => {
  const [claims, evidenceIndex, slidePlans] = await Promise.all([
    readFile(path.join(storyRoot, "claims.json"), "utf8").then(JSON.parse),
    readFile(path.join(storyRoot, "evidence-index.json"), "utf8").then(JSON.parse),
    readFile(path.join(presentationRoot, "slide-design-plans.json"), "utf8").then(JSON.parse),
  ]);
  const result = assertCampaignPresentationGate({ claims, evidenceIndex, slidePlans });
  assert.equal(result.plannedClaimIds.includes("C5_FOUNDER_QUEST_PRODUCT"), false);
  const founderQuestBinding = result.claimBindings.find(
    (binding) => binding.claimId === "C5_FOUNDER_QUEST_PRODUCT",
  );
  assert.deepEqual(founderQuestBinding?.evidenceIds, [
    "E12_FOUNDER_QUEST_PRODUCTION",
    "E13_FOUNDER_QUEST_RELEASE",
  ]);
  assert.equal(result.claimBindings.some((binding) => binding.claimId === "C7_RECURSIVE_LAUNCH"), false);
});

test("verified Founder Quest slide carries production copy without erasing the synthetic boundary", async () => {
  const changeRoot = path.resolve(presentationRoot, "..");
  const [changeYaml, claims, evidenceIndex, slidePlans] = await Promise.all([
    readFile(path.join(changeRoot, "change.yaml"), "utf8"),
    readFile(path.join(storyRoot, "claims.json"), "utf8").then(JSON.parse),
    readFile(path.join(storyRoot, "evidence-index.json"), "utf8").then(JSON.parse),
    readFile(path.join(presentationRoot, "slide-design-plans.json"), "utf8").then(JSON.parse),
  ]);
  const { parse } = await import("yaml");
  const spec = buildCampaignDeckSpec({
    change: parse(changeYaml),
    claims,
    evidenceIndex,
    slidePlans,
  });
  const founderQuestSlide = spec.slides[5];
  assert.match(founderQuestSlide.headline, /passed all 15 hosted checks/i);
  assert.equal(founderQuestSlide.metric, "15 / 15");
  assert.match(founderQuestSlide.image.caption, /verified production proof/i);
  assert.match(founderQuestSlide.image.credit, /synthetic read-only production/i);
  assert.equal(founderQuestSlide.image.imageUrl, undefined);

  const elementId = attachFounderQuestScreenshot(
    {
      slides: [
        {},
        {},
        {},
        {},
        {},
        { elementOrder: ["s6-image"] },
      ],
      elements: [
        {
          id: "s6-image",
          kind: "image",
          image: { placeholder: true },
          exportCapabilities: [],
        },
      ],
    },
    { dataUrl: "data:image/png;base64,QUJDRA==" },
  );
  assert.equal(elementId, "s6-image");

  const finalSpec = buildCampaignDeckSpec({
    change: parse(changeYaml),
    claims,
    evidenceIndex,
    releaseMode: "final",
    slidePlans,
  });
  assert.equal(finalSpec.title, "NodeKit launches NodeKit through proof-carrying product work");
  assert.doesNotMatch(JSON.stringify(finalSpec), /\bDRAFT\b/);
  assert.match(
    finalSpec.narrative.join(" "),
    /verified product and media artifacts remain distinct from pending publication claims/i,
  );
});

test("final media gate validates the receipt contract and re-hashes both current MP4s", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nodekit-final-media-"));
  const output = path.join(root, "video", "output");
  const proof = path.join(root, "video", "proof");
  await Promise.all([mkdir(output, { recursive: true }), mkdir(proof, { recursive: true })]);
  const vertical = Buffer.from("vertical-video-bytes");
  const technical = Buffer.from("technical-video-bytes");
  await Promise.all([
    writeFile(path.join(output, "nodekit-founder-quest-vertical.mp4"), vertical),
    writeFile(path.join(output, "nodekit-founder-quest-technical.mp4"), technical),
  ]);
  const receiptPath = path.join(proof, "founder-quest-video-receipt.json");
  const videoReceipt = {
    campaignId: "nodekit-proof-campaign-2026-07-20",
    schemaVersion: "nodekit.video-proof-receipt/v1",
    status: "verified",
    verifiedAt: "2026-07-21T06:10:03.951Z",
    videos: [
      {
        bytes: vertical.byteLength,
        compositionId: "WT9-FounderQuestVertical",
        durationSeconds: 83,
        height: 1920,
        path: "video/output/nodekit-founder-quest-vertical.mp4",
        profileId: "FounderQuestVertical",
        sha256: sha256(vertical),
        width: 1080,
      },
      {
        bytes: technical.byteLength,
        compositionId: "WT-FounderQuestTechnical",
        durationSeconds: 180,
        height: 1080,
        path: "video/output/nodekit-founder-quest-technical.mp4",
        profileId: "FounderQuestTechnical",
        sha256: sha256(technical),
        width: 1920,
      },
    ],
  };
  await writeFile(receiptPath, canonicalJson(videoReceipt));

  try {
    const resolved = await resolveFinalPresentationMediaProof({
      campaignRoot: root,
      expectedCampaignId: videoReceipt.campaignId,
      receiptPath,
    });
    assert.equal(resolved.receipt.status, "verified");
    assert.equal(resolved.videos.length, 2);
    assert.deepEqual(
      Object.fromEntries(resolved.videos.map((video) => [video.profileId, video.sha256])),
      {
        FounderQuestTechnical: sha256(technical),
        FounderQuestVertical: sha256(vertical),
      },
    );

    for (const [override, pattern] of [
      [{ schemaVersion: "nodekit.video-proof-receipt/v0" }, /video receipt schema must be/],
      [{ status: "draft" }, /video receipt status must be verified/],
      [{ campaignId: "different-campaign" }, /video receipt campaign id must be/],
    ]) {
      await writeFile(receiptPath, canonicalJson({ ...videoReceipt, ...override }));
      await assert.rejects(
        () =>
          resolveFinalPresentationMediaProof({
            campaignRoot: root,
            expectedCampaignId: videoReceipt.campaignId,
            receiptPath,
          }),
        pattern,
      );
    }
    await writeFile(receiptPath, canonicalJson(videoReceipt));

    await writeFile(path.join(output, "nodekit-founder-quest-vertical.mp4"), "tampered");
    await assert.rejects(
      () =>
        resolveFinalPresentationMediaProof({
          campaignRoot: root,
          expectedCampaignId: videoReceipt.campaignId,
          receiptPath,
        }),
      /FounderQuestVertical (?:byte count|hash) mismatch/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function receiptFixture() {
  return {
    artifacts: [
      { path: "presentation/deck.json", sha256: "a".repeat(64), byteSize: 100 },
      { path: "presentation/deck.pptx", sha256: "b".repeat(64), byteSize: 200 },
    ],
    changeId: "change-2026-07-20",
    evidence: [
      { id: "E2", files: [], urls: [{ field: "url", url: "https://example.com/two" }] },
      { id: "E1", files: [{ field: "path", sha256: "c".repeat(64) }], urls: [] },
    ],
    gate: { passed: true, requiredEvidenceIds: ["E1", "E2"] },
    generatedAt: "2026-07-20T00:00:00.000Z",
    inputs: [
      { path: "story/claims.json", sha256: "d".repeat(64), byteSize: 10 },
      { path: "change.yaml", sha256: "e".repeat(64), byteSize: 20 },
    ],
    nodeSlide: { commit: "0".repeat(40), mode: "local" },
    pptxVerification: { editableElementCount: 12, reopened: true, slideCount: 2 },
    validation: { cleanOk: true, ok: true, publishOk: true },
  };
}

test("default generation receipt remains canonical, deterministic, hash-bound, and draft-only", () => {
  const input = receiptFixture();
  const first = buildGenerationReceipt(input);
  const second = buildGenerationReceipt({
    ...input,
    artifacts: [...input.artifacts].reverse(),
    evidence: [...input.evidence].reverse(),
    inputs: [...input.inputs].reverse(),
  });
  assert.deepEqual(second, first);
  assert.equal(first.status, "draft");
  assert.equal(first.externalPublishReady, false);

  const withoutDigest = { ...first };
  delete withoutDigest.receiptDigest;
  assert.equal(first.receiptDigest, sha256(canonicalJson(withoutDigest)));

  const tampered = receiptFixture();
  tampered.artifacts[0] = { ...tampered.artifacts[0], sha256: "f".repeat(64) };
  const changed = buildGenerationReceipt(tampered);
  assert.notEqual(changed.generationIdentity, first.generationIdentity);
  assert.notEqual(changed.receiptDigest, first.receiptDigest);
});

test("final generation receipt is media-bound, ready, and explicitly not published", () => {
  const mediaProof = {
    campaignId: "change-2026-07-20",
    receipt: {
      byteSize: 50,
      path: "video/proof/receipt.json",
      schemaVersion: "nodekit.video-proof-receipt/v1",
      sha256: "1".repeat(64),
      status: "verified",
    },
    videos: [
      {
        byteSize: 100,
        path: "video/output/technical.mp4",
        profileId: "FounderQuestTechnical",
        sha256: "2".repeat(64),
      },
      {
        byteSize: 80,
        path: "video/output/vertical.mp4",
        profileId: "FounderQuestVertical",
        sha256: "3".repeat(64),
      },
    ],
  };
  const receipt = buildGenerationReceipt({
    ...receiptFixture(),
    artifacts: receiptFixture().artifacts.map((artifact) => ({
      ...artifact,
      publicationStatus: "not-published",
      status: "ready",
    })),
    mediaProof,
    releaseMode: "final",
  });
  assert.equal(receipt.status, "ready");
  assert.equal(receipt.externalPublishReady, true);
  assert.equal(receipt.distribution.status, "not-published");
  assert.equal(receipt.mediaProof.receipt.sha256, "1".repeat(64));
  assert.equal(receipt.gate.passed, true);
  assert.deepEqual(receipt.generationIdentity.length, 64);
});
