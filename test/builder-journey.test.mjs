import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STAGE_HANDOFFS,
  advanceStage,
  builderJourneyView,
  createBuilderCase,
  recordStageHandoff,
  verifyStageHandoff,
} from "../src/lib/builder-journey.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const ACTOR = { id: "tester", type: "human" };

async function loadSalon() {
  return JSON.parse(
    await readFile(new URL("./fixtures/builder-journey/salon.opportunity-contract.json", import.meta.url), "utf8"),
  );
}

async function freshCase() {
  return createBuilderCase({ title: "Verified Weekly Salon Brief", primaryJob: "Weekly profit health check.", actor: ACTOR });
}

test("a fresh builder case starts in decide with decide active", async () => {
  const { builderCase } = await freshCase();
  assert.equal(builderCase.currentStage, "decide");
  assert.equal(builderCase.stages.decide.status, "active");
  assert.equal(builderCase.stages.build.status, "pending");
  assert.equal(builderCase.stages.decide.opportunityContractRef, "");
  assert.equal(builderCase.stages.decide.receiptRef, "");
});

test("advancing decide->build is BLOCKED before an OpportunityContract + receipt exist", async () => {
  const { builderCase, caseflow } = await freshCase();
  const verdict = await advanceStage({ builderCase, actor: ACTOR, caseflow });
  assert.equal(verdict.status, "blocked");
  assert.equal(verdict.stage, "decide");
  assert.ok(
    verdict.needs.some((n) => n.startsWith("opportunityContractRef")),
    `expected opportunityContractRef need, got ${JSON.stringify(verdict.needs)}`,
  );
  assert.ok(verdict.needs.some((n) => n.startsWith("receiptRef")));
  // fail-closed: currentStage was NOT mutated on the blocked path.
  assert.equal(builderCase.currentStage, "decide");
});

test("the case advances once the handoff artifact + receipt exist", async () => {
  const { builderCase, caseflow } = await freshCase();
  const salon = await loadSalon();
  const recorded = await recordStageHandoff({
    builderCase,
    stage: "decide",
    content: salon,
    actor: ACTOR,
    caseflow,
  });
  assert.equal(recorded.builderCase.stages.decide.status, "ready");
  assert.notEqual(recorded.builderCase.stages.decide.opportunityContractRef, "");
  assert.notEqual(recorded.builderCase.stages.decide.receiptRef, "");

  const verified = verifyStageHandoff({ builderCase: recorded.builderCase, stage: "decide", caseflow });
  assert.deepEqual(verified, { ok: true, needs: [] });

  const verdict = await advanceStage({ builderCase: recorded.builderCase, actor: ACTOR, caseflow });
  assert.equal(verdict.status, "advanced");
  assert.equal(verdict.previousStage, "decide");
  assert.equal(verdict.currentStage, "build");
  assert.equal(verdict.looped, false);
  assert.equal(verdict.builderCase.stages.decide.status, "complete");
  assert.equal(verdict.builderCase.stages.build.status, "active");
});

test("a forged/mismatched handoff ref stays BLOCKED (contentHash binding, not mere presence)", async () => {
  const { builderCase, caseflow } = await freshCase();
  const salon = await loadSalon();
  const recorded = await recordStageHandoff({ builderCase, stage: "decide", content: salon, actor: ACTOR, caseflow });

  // Mint a real-but-different artifact in the same ledger (a build handoff on the same case).
  const advanced = await advanceStage({ builderCase: recorded.builderCase, actor: ACTOR, caseflow });
  assert.equal(advanced.status, "advanced");
  const buildRecorded = await recordStageHandoff({
    builderCase: advanced.builderCase,
    stage: "build",
    content: { evidence: "one golden journey vs one frozen fixture" },
    supporting: { productContractRef: { productContract: "salon brief" } },
    actor: ACTOR,
    caseflow,
  });
  const foreignArtifactId = buildRecorded.builderCase.stages.build.applicationRef;
  assert.notEqual(foreignArtifactId, recorded.builderCase.stages.decide.opportunityContractRef);

  // Swap decide's handoff ref to a real-but-different artifact while keeping the decide receipt.
  const forged = JSON.parse(JSON.stringify(recorded.builderCase));
  forged.stages.decide.opportunityContractRef = foreignArtifactId;

  const verified = verifyStageHandoff({ builderCase: forged, stage: "decide", caseflow });
  assert.equal(verified.ok, false);
  assert.ok(
    verified.needs.includes("receipt does not bind the handoff artifact by contentHash"),
    `expected contentHash-binding failure, got ${JSON.stringify(verified.needs)}`,
  );

  forged.currentStage = "decide";
  const verdict = await advanceStage({ builderCase: forged, actor: ACTOR, caseflow });
  assert.equal(verdict.status, "blocked");
});

test("a corrupt receipt ref stays BLOCKED with receipt-not-found", async () => {
  const { builderCase, caseflow } = await freshCase();
  const salon = await loadSalon();
  const recorded = await recordStageHandoff({ builderCase, stage: "decide", content: salon, actor: ACTOR, caseflow });
  const corrupt = JSON.parse(JSON.stringify(recorded.builderCase));
  corrupt.stages.decide.receiptRef = "receipt_deadbeefdeadbeefdeadbeefde";
  const verified = verifyStageHandoff({ builderCase: corrupt, stage: "decide", caseflow });
  assert.equal(verified.ok, false);
  assert.ok(verified.needs.includes("receipt not found in caseflow ledger"));
});

test("the salon OpportunityContract validates against its schema", async () => {
  const salon = await loadSalon();
  assert.deepEqual(await validateSchema("nodekit.opportunity-contract.v1.schema.json", salon, "salon"), []);
});

test("the journey view reports the right current stage + needs", async () => {
  const { builderCase, caseflow } = await freshCase();
  const view = builderJourneyView(builderCase);
  assert.equal(view.currentStage, "decide");
  assert.equal(view.caseId, builderCase.caseId);
  assert.deepEqual(view.currentNeeds, [
    STAGE_HANDOFFS.decide.handoffField,
    STAGE_HANDOFFS.decide.receiptField,
  ]);
  const decideView = view.stages.find((s) => s.stage === "decide");
  assert.equal(decideView.hasHandoff, false);
  assert.equal(decideView.hasReceipt, false);
  assert.equal(decideView.handoffArtifact, "OpportunityContract");

  const salon = await loadSalon();
  const recorded = await recordStageHandoff({ builderCase, stage: "decide", content: salon, actor: ACTOR, caseflow });
  const advanced = await advanceStage({ builderCase: recorded.builderCase, actor: ACTOR, caseflow });
  const view2 = builderJourneyView(advanced.builderCase);
  assert.equal(view2.currentStage, "build");
  const buildView = view2.stages.find((s) => s.stage === "build");
  assert.equal(buildView.status, "active");
  assert.deepEqual(view2.currentNeeds, [
    STAGE_HANDOFFS.build.handoffField,
    ...STAGE_HANDOFFS.build.supportingFields,
    STAGE_HANDOFFS.build.receiptField,
  ]);
});
