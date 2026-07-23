import { createMemoryCaseflow, contentHash, TERMINAL_RUN_STATUSES } from "./caseflow.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const BUILDER_CASE_SCHEMA = "nodekit.builder-case.v1.schema.json";
export const OPPORTUNITY_CONTRACT_SCHEMA = "nodekit.opportunity-contract.v1.schema.json";

export const STAGE_ORDER = Object.freeze(["decide", "build", "explain", "launch", "learn"]);

export const STAGE_HANDOFFS = Object.freeze({
  decide: Object.freeze({
    handoffField: "opportunityContractRef",
    receiptField: "receiptRef",
    supportingFields: Object.freeze([]),
    label: "OpportunityContract",
    owner: "builder",
  }),
  build: Object.freeze({
    handoffField: "applicationRef",
    receiptField: "buildReceiptRef",
    supportingFields: Object.freeze(["productContractRef"]),
    label: "BuildEvidencePack",
    owner: "builder",
  }),
  explain: Object.freeze({
    handoffField: "storyPackRef",
    receiptField: "presentationReceiptRef",
    supportingFields: Object.freeze([]),
    label: "StoryPack",
    owner: "builder",
  }),
  launch: Object.freeze({
    handoffField: "launchManifestRef",
    receiptField: "deploymentReceiptRef",
    supportingFields: Object.freeze([]),
    label: "LaunchManifest",
    owner: "builder",
  }),
  learn: Object.freeze({
    handoffField: "observationPackRef",
    receiptField: "receiptRef",
    supportingFields: Object.freeze([]),
    label: "ObservationPack",
    owner: "builder",
  }),
});

async function validateOrThrow(schema, value, label) {
  const f = await validateSchema(schema, value, label);
  if (f.length) throw new Error(`${label} validation failed:\n${f.join("\n")}`);
}

function cloneCase(builderCase) {
  return JSON.parse(JSON.stringify(builderCase));
}

function emptyStage(stage, status) {
  const spec = STAGE_HANDOFFS[stage];
  const stageObject = { status };
  stageObject[spec.handoffField] = "";
  for (const field of spec.supportingFields) stageObject[field] = "";
  stageObject[spec.receiptField] = "";
  return stageObject;
}

export async function createBuilderCase({ title, primaryJob, actor, caseflow = createMemoryCaseflow() }) {
  const caseRecord = caseflow.createCase({ title, primaryJob, actor });
  const stages = {};
  for (const stage of STAGE_ORDER) {
    stages[stage] = emptyStage(stage, stage === "decide" ? "active" : "pending");
  }
  const builderCase = {
    schemaVersion: "nodekit.builder-case/v1",
    caseId: caseRecord.caseId,
    title,
    currentStage: "decide",
    stages,
  };
  await validateOrThrow(BUILDER_CASE_SCHEMA, builderCase, "builder case");
  return { builderCase, caseflow };
}

export async function recordStageHandoff({ builderCase, stage, content, kind, title, supporting = {}, actor, caseflow }) {
  const spec = STAGE_HANDOFFS[stage];
  if (!spec) throw new Error(`unknown stage: ${stage}`);
  const run = caseflow.startRun({
    caseId: builderCase.caseId,
    stages: [{ id: stage, label: spec.label, owner: spec.owner }],
    actor,
  });
  const artifact = caseflow.createArtifact({
    caseId: builderCase.caseId,
    runId: run.runId,
    kind: kind ?? `${stage}-handoff`,
    title: title ?? spec.label,
    content,
    actor,
  });
  const supportingArtifacts = {};
  for (const field of spec.supportingFields) {
    if (!(field in supporting)) {
      throw new Error(`recordStageHandoff for ${stage} requires supporting.${field}`);
    }
    supportingArtifacts[field] = caseflow.createArtifact({
      caseId: builderCase.caseId,
      runId: run.runId,
      kind: `${stage}-${field}`,
      title: field,
      content: supporting[field],
      actor,
    });
  }
  const { receipt } = caseflow.completeRun({ runId: run.runId, actor });

  const nextCase = cloneCase(builderCase);
  const stageObject = nextCase.stages[stage];
  stageObject[spec.handoffField] = artifact.artifactId;
  for (const field of spec.supportingFields) {
    stageObject[field] = supportingArtifacts[field].artifactId;
  }
  stageObject[spec.receiptField] = receipt.receiptId;
  stageObject.status = "ready";
  await validateOrThrow(BUILDER_CASE_SCHEMA, nextCase, "builder case");
  return { builderCase: nextCase, artifact, receipt, supportingArtifacts };
}

export function verifyStageHandoff({ builderCase, stage, caseflow }) {
  const spec = STAGE_HANDOFFS[stage];
  if (!spec) throw new Error(`unknown stage: ${stage}`);
  const stageObject = builderCase.stages[stage];
  const needs = [];

  const handoffRef = stageObject[spec.handoffField];
  const receiptRef = stageObject[spec.receiptField];
  if (handoffRef === "") needs.push(`${spec.handoffField} (handoff artifact not yet produced)`);
  if (receiptRef === "") needs.push(`${spec.receiptField} (receipt not yet produced)`);
  for (const field of spec.supportingFields) {
    if (stageObject[field] === "") needs.push(`${field} (supporting artifact not yet produced)`);
  }
  if (needs.length > 0) return { ok: false, needs };

  const snap = caseflow.snapshot();
  const receipt = snap.receipts.find((r) => r.receiptId === receiptRef);
  if (!receipt) needs.push("receipt not found in caseflow ledger");
  if (receipt && !TERMINAL_RUN_STATUSES.includes(receipt.status)) needs.push("receipt is not terminal");
  const artifact = snap.artifacts.find((a) => a.artifactId === handoffRef);
  if (!artifact) needs.push("handoff artifact not found in caseflow ledger");
  if (receipt && artifact) {
    const version = artifact.versions.find((v) => v.version === artifact.canonicalVersion);
    const computed = contentHash(version.content);
    const binding = receipt.artifactBindings.find(
      (b) => b.artifactId === handoffRef && b.contentHash === computed,
    );
    if (!binding) needs.push("receipt does not bind the handoff artifact by contentHash");
  }
  return { ok: needs.length === 0, needs };
}

export async function advanceStage({ builderCase, actor, caseflow }) {
  const stage = builderCase.currentStage;
  const { ok, needs } = verifyStageHandoff({ builderCase, stage, caseflow });
  if (!ok) return { status: "blocked", stage, needs };

  const idx = STAGE_ORDER.indexOf(stage);
  const next = STAGE_ORDER[(idx + 1) % STAGE_ORDER.length];
  const nextCase = cloneCase(builderCase);
  nextCase.stages[stage].status = "complete";
  nextCase.stages[next].status = "active";
  nextCase.currentStage = next;
  await validateOrThrow(BUILDER_CASE_SCHEMA, nextCase, "builder case");
  return {
    status: "advanced",
    previousStage: stage,
    currentStage: next,
    looped: idx === STAGE_ORDER.length - 1,
    builderCase: nextCase,
  };
}

export function builderJourneyView(builderCase) {
  const stages = STAGE_ORDER.map((stage) => {
    const spec = STAGE_HANDOFFS[stage];
    const stageObject = builderCase.stages[stage];
    const handoffArtifactRef = stageObject[spec.handoffField];
    const receiptRef = stageObject[spec.receiptField];
    const supportingRefs = spec.supportingFields.map((field) => stageObject[field]);
    const needs = [];
    if (handoffArtifactRef === "") needs.push(spec.handoffField);
    for (const field of spec.supportingFields) {
      if (stageObject[field] === "") needs.push(field);
    }
    if (receiptRef === "") needs.push(spec.receiptField);
    return {
      stage,
      status: stageObject.status,
      handoffArtifact: spec.label,
      handoffArtifactRef,
      receiptRef,
      supportingRefs,
      hasHandoff: handoffArtifactRef !== "",
      hasReceipt: receiptRef !== "",
      needs,
    };
  });
  const current = stages.find((entry) => entry.stage === builderCase.currentStage);
  return {
    caseId: builderCase.caseId,
    title: builderCase.title,
    currentStage: builderCase.currentStage,
    stages,
    currentNeeds: current ? current.needs : [],
  };
}
