/* eslint-disable */
/**
 * Generated component API type. Component functions are internal references
 * from the host application's side of the sandbox boundary.
 */
import type { FunctionReference } from "convex/server";

type Actor = { id: string; type: string };
type Stage = { id: string; label: string; owner: string; status: "active" | "completed" | "pending" };
type Case = {
  caseId: string; createdAt: string; currentRunId: string | null; primaryJob: string;
  schemaVersion: "nodekit.case/v1"; status: "completed" | "in_progress" | "ready"; title: string; updatedAt: string;
};
type Run = {
  caseId: string; createdAt: string; currentStageId: string; nextAction: string; nextActionOwner: string;
  runId: string; schemaVersion: "nodekit.run/v1"; stages: Stage[];
  status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely"; updatedAt: string;
};
type ArtifactVersion = { content: any; contentHash: string; createdAt: string; proposalId?: string; version: number };
type Artifact = {
  artifactId: string; canonicalVersion: number; caseId: string; createdAt: string; kind: string; runId: string;
  schemaVersion: "nodekit.artifact/v1"; title: string; updatedAt: string; versions: ArtifactVersion[];
};
type Proposal = {
  artifactId: string; baseVersion: number; createdAt: string; patch: any; proposalId: string; rationale: string;
  schemaVersion: "nodekit.proposal/v1"; status: "accepted" | "conflicted" | "pending" | "rejected";
};
type Approval = {
  approvalId: string; comment: string; decidedAt: string; decision: "accepted" | "rejected";
  proposalId: string; schemaVersion: "nodekit.approval/v1";
};
type Exception = {
  code: string; exceptionId: string; message: string; preservedState: any; raisedAt: string;
  resolution: string | null; resolvedAt?: string; runId: string; schemaVersion: "nodekit.exception/v1";
  status: "open" | "resolved";
};
type Receipt = {
  approvalBindings: Array<{ approvalId: string; commentHash: string; decision: "accepted" | "rejected"; proposalId: string }>;
  artifactBindings: Array<{ artifactId: string; canonicalVersion: number; contentHash: string }>;
  artifactIds: string[]; caseHash: string; caseId: string;
  eventBindings: Array<{ actorHash: string; aggregateId: string; aggregateType: string; eventId: string; eventType: string; payloadHash: string; sequence: number }>;
  eventIds: string[]; generatedAt: string;
  proposalBindings: Array<{ artifactId: string; baseVersion: number; patchHash: string; proposalId: string; status: Proposal["status"] }>;
  proposalIds: string[]; receiptHash: string; receiptId: string; runHash: string; runId: string;
  schemaVersion: "nodekit.receipt/v2"; status: "cancelled" | "completed" | "failed_safely";
};
type TimelineEvent = {
  actor: Actor; aggregateId: string; aggregateType: string; eventId: string; eventType: string;
  occurredAt: string; payload: any; schemaVersion: "nodekit.caseflow-event/v1"; sequence: number;
};
type Ref<
  Kind extends "mutation" | "query",
  Args extends Record<string, unknown>,
  Returns,
  Name extends string | undefined,
> =
  FunctionReference<Kind, "internal", Args, Returns, Name>;

export type ComponentApi<Name extends string | undefined = string | undefined> = {
  caseflow: {
    createCase: Ref<"mutation", { actor?: Actor; primaryJob: string; scopeKey: string; title: string }, Case, Name>;
    updateCaseInput: Ref<"mutation", { actor?: Actor; caseId: string; primaryJob?: string; scopeKey: string; title?: string }, Case, Name>;
    startRun: Ref<"mutation", { actor?: Actor; caseId: string; scopeKey: string; stages: Array<Pick<Stage, "id" | "label" | "owner">> }, Run, Name>;
    enterStage: Ref<"mutation", { actor?: Actor; idempotencyKey?: string; nextAction?: string; nextActionOwner?: string; runId: string; scopeKey: string; stageId: string }, Run, Name>;
    createArtifact: Ref<"mutation", { actor?: Actor; caseId: string; content: any; contentHash: string; idempotencyKey?: string; kind?: string; runId: string; scopeKey: string; title?: string }, Artifact, Name>;
    createProposal: Ref<"mutation", { actor?: Actor; artifactId: string; baseVersion: number; idempotencyKey?: string; patch: any; patchHash: string; rationale?: string; scopeKey: string }, Proposal, Name>;
    decideProposal: Ref<"mutation", { actor?: Actor; comment?: string; decision: "accepted" | "rejected"; proposalId: string; scopeKey: string }, { approval: Approval; artifact: Artifact; proposal: Proposal; reused: boolean }, Name>;
    raiseException: Ref<"mutation", { actor?: Actor; code?: string; idempotencyKey?: string; message?: string; preservedState?: any; preservedStateHash: string; runId: string; scopeKey: string }, Exception, Name>;
    resolveException: Ref<"mutation", { actor?: Actor; exceptionId: string; nextAction?: string; nextActionOwner?: string; resolution?: string; scopeKey: string }, { exception: Exception; run: Run }, Name>;
    completeRun: Ref<"mutation", { actor?: Actor; runId: string; scopeKey: string }, { receipt: Receipt; reused: boolean; run: Run }, Name>;
    cancelRun: Ref<"mutation", { actor?: Actor; reason?: string; runId: string; scopeKey: string }, { receipt: Receipt; reused: boolean; run: Run }, Name>;
    failRunSafely: Ref<"mutation", { actor?: Actor; reason?: string; runId: string; scopeKey: string }, { receipt: Receipt; reused: boolean; run: Run }, Name>;
    getCase: Ref<"query", { caseId: string; scopeKey: string }, Case | null, Name>;
    getRun: Ref<"query", { runId: string; scopeKey: string }, Run | null, Name>;
    getArtifact: Ref<"query", { artifactId: string; scopeKey: string }, Artifact | null, Name>;
    getReceiptForRun: Ref<"query", { runId: string; scopeKey: string }, Receipt | null, Name>;
    getTimeline: Ref<"query", { aggregateId: string; aggregateType: string; limit?: number; scopeKey: string }, TimelineEvent[], Name>;
    listPendingApprovals: Ref<"query", { limit?: number; scopeKey: string }, Proposal[], Name>;
  };
};
