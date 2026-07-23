export type BuilderStageId = "decide" | "build" | "explain" | "launch" | "learn";
export type BuilderStageStatus = "pending" | "active" | "ready" | "complete";

export interface DecideStage {
  status: BuilderStageStatus;
  opportunityContractRef: string;
  receiptRef: string;
}
export interface BuildStage {
  status: BuilderStageStatus;
  productContractRef: string;
  applicationRef: string;
  buildReceiptRef: string;
}
export interface ExplainStage {
  status: BuilderStageStatus;
  storyPackRef: string;
  presentationReceiptRef: string;
}
export interface LaunchStage {
  status: BuilderStageStatus;
  launchManifestRef: string;
  deploymentReceiptRef: string;
}
export interface LearnStage {
  status: BuilderStageStatus;
  observationPackRef: string;
  receiptRef: string;
}

export interface NodeKitBuilderCase {
  schemaVersion: "nodekit.builder-case/v1";
  caseId: string;
  title: string;
  currentStage: BuilderStageId;
  stages: {
    decide: DecideStage;
    build: BuildStage;
    explain: ExplainStage;
    launch: LaunchStage;
    learn: LearnStage;
  };
}

export interface RejectedAlternative {
  alternative: string;
  reason: string;
}

export interface OpportunityContractAuthorityLimits {
  read: string[];
  propose: string[];
  approve: string[];
  prohibited: string[];
}

export interface OpportunityContract {
  schemaVersion: "nodekit.opportunity-contract/v1";
  user: string;
  problem: string;
  wedge: string;
  primaryJob: string;
  inputs: string[];
  primaryArtifact: string;
  rejectedAlternatives: RejectedAlternative[];
  openUnknowns: string[];
  successCondition: string;
  authorityLimits: OpportunityContractAuthorityLimits;
}

export interface StageHandoffSpec {
  handoffField: string;
  receiptField: string;
  supportingFields: readonly string[];
  label: string;
  owner: string;
}

export type AdvanceVerdict =
  | { status: "blocked"; stage: BuilderStageId; needs: string[] }
  | {
      status: "advanced";
      previousStage: BuilderStageId;
      currentStage: BuilderStageId;
      looped: boolean;
      builderCase: NodeKitBuilderCase;
    };

export interface BuilderJourneyStageView {
  stage: BuilderStageId;
  status: BuilderStageStatus;
  handoffArtifact: string;
  handoffArtifactRef: string;
  receiptRef: string;
  supportingRefs: string[];
  hasHandoff: boolean;
  hasReceipt: boolean;
  needs: string[];
}

export interface BuilderJourneyView {
  caseId: string;
  title: string;
  currentStage: BuilderStageId;
  stages: BuilderJourneyStageView[];
  currentNeeds: string[];
}

export interface CaseflowLike {
  createCase(input: { title: string; primaryJob: string; actor?: unknown }): { caseId: string };
  startRun(input: { caseId: string; stages: unknown; actor?: unknown }): { runId: string };
  createArtifact(input: {
    caseId: string;
    runId: string;
    kind?: string;
    title?: string;
    content: unknown;
    actor?: unknown;
  }): { artifactId: string };
  completeRun(input: { runId: string; actor?: unknown }): { receipt: { receiptId: string } };
  snapshot(): unknown;
}

export const BUILDER_CASE_SCHEMA: "nodekit.builder-case.v1.schema.json";
export const OPPORTUNITY_CONTRACT_SCHEMA: "nodekit.opportunity-contract.v1.schema.json";
export const STAGE_ORDER: readonly BuilderStageId[];
export const STAGE_HANDOFFS: Readonly<Record<BuilderStageId, StageHandoffSpec>>;

export function createBuilderCase(input: {
  title: string;
  primaryJob: string;
  actor?: unknown;
  caseflow?: CaseflowLike;
}): Promise<{ builderCase: NodeKitBuilderCase; caseflow: CaseflowLike }>;

export function recordStageHandoff(input: {
  builderCase: NodeKitBuilderCase;
  stage: BuilderStageId;
  content: unknown;
  kind?: string;
  title?: string;
  supporting?: Record<string, unknown>;
  actor?: unknown;
  caseflow: CaseflowLike;
}): Promise<{
  builderCase: NodeKitBuilderCase;
  artifact: { artifactId: string };
  receipt: { receiptId: string };
  supportingArtifacts: Record<string, { artifactId: string }>;
}>;

export function verifyStageHandoff(input: {
  builderCase: NodeKitBuilderCase;
  stage: BuilderStageId;
  caseflow: CaseflowLike;
}): { ok: boolean; needs: string[] };

export function advanceStage(input: {
  builderCase: NodeKitBuilderCase;
  actor?: unknown;
  caseflow: CaseflowLike;
}): Promise<AdvanceVerdict>;

export function builderJourneyView(builderCase: NodeKitBuilderCase): BuilderJourneyView;
