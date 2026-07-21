import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("generation receipt is canonical, deterministic, hash-bound, and always draft-only", () => {
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
