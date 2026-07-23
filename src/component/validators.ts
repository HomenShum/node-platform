import { v } from "convex/values";

export const actorValidator = v.object({ id: v.string(), type: v.string() });
export const stageOwnerValidator = v.string();
export const stageValidator = v.object({
  id: v.string(),
  label: v.string(),
  owner: stageOwnerValidator,
  status: v.union(v.literal("active"), v.literal("completed"), v.literal("pending")),
});

export const caseValidator = v.object({
  caseId: v.string(),
  createdAt: v.string(),
  currentRunId: v.union(v.null(), v.string()),
  primaryJob: v.string(),
  schemaVersion: v.literal("nodekit.case/v1"),
  status: v.union(v.literal("completed"), v.literal("in_progress"), v.literal("ready")),
  title: v.string(),
  updatedAt: v.string(),
});

export const runValidator = v.object({
  caseId: v.string(),
  createdAt: v.string(),
  currentStageId: v.string(),
  nextAction: v.string(),
  nextActionOwner: stageOwnerValidator,
  runId: v.string(),
  schemaVersion: v.literal("nodekit.run/v1"),
  stages: v.array(stageValidator),
  status: v.union(
    v.literal("active"),
    v.literal("blocked"),
    v.literal("cancelled"),
    v.literal("completed"),
    v.literal("failed_safely"),
  ),
  updatedAt: v.string(),
});

export const artifactVersionValidator = v.object({
  content: v.any(),
  contentHash: v.string(),
  createdAt: v.string(),
  proposalId: v.optional(v.string()),
  version: v.number(),
});

export const artifactValidator = v.object({
  artifactId: v.string(),
  canonicalVersion: v.number(),
  caseId: v.string(),
  createdAt: v.string(),
  kind: v.string(),
  runId: v.string(),
  schemaVersion: v.literal("nodekit.artifact/v1"),
  title: v.string(),
  updatedAt: v.string(),
  versions: v.array(artifactVersionValidator),
});

export const proposalValidator = v.object({
  artifactId: v.string(),
  baseVersion: v.number(),
  createdAt: v.string(),
  patch: v.any(),
  proposalId: v.string(),
  rationale: v.string(),
  schemaVersion: v.literal("nodekit.proposal/v1"),
  status: v.union(
    v.literal("accepted"),
    v.literal("conflicted"),
    v.literal("pending"),
    v.literal("rejected"),
  ),
});

export const approvalValidator = v.object({
  approvalId: v.string(),
  comment: v.string(),
  decidedAt: v.string(),
  decision: v.union(v.literal("accepted"), v.literal("rejected")),
  proposalId: v.string(),
  schemaVersion: v.literal("nodekit.approval/v1"),
});

export const exceptionValidator = v.object({
  code: v.string(),
  exceptionId: v.string(),
  message: v.string(),
  preservedState: v.any(),
  raisedAt: v.string(),
  resolution: v.union(v.null(), v.string()),
  resolvedAt: v.optional(v.string()),
  runId: v.string(),
  schemaVersion: v.literal("nodekit.exception/v1"),
  status: v.union(v.literal("open"), v.literal("resolved")),
});

export const receiptValidator = v.object({
  approvalBindings: v.array(v.object({
    approvalId: v.string(),
    commentHash: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    proposalId: v.string(),
  })),
  artifactIds: v.array(v.string()),
  artifactBindings: v.array(v.object({
    artifactId: v.string(),
    canonicalVersion: v.number(),
    contentHash: v.string(),
  })),
  caseHash: v.string(),
  caseId: v.string(),
  eventIds: v.array(v.string()),
  eventBindings: v.array(v.object({
    actorHash: v.string(),
    aggregateId: v.string(),
    aggregateType: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    sequence: v.number(),
  })),
  generatedAt: v.string(),
  proposalIds: v.array(v.string()),
  proposalBindings: v.array(v.object({
    artifactId: v.string(),
    baseVersion: v.number(),
    patchHash: v.string(),
    proposalId: v.string(),
    status: v.union(
      v.literal("accepted"),
      v.literal("conflicted"),
      v.literal("pending"),
      v.literal("rejected"),
    ),
  })),
  receiptHash: v.string(),
  receiptId: v.string(),
  runHash: v.string(),
  runId: v.string(),
  schemaVersion: v.literal("nodekit.receipt/v2"),
  status: v.union(v.literal("cancelled"), v.literal("completed"), v.literal("failed_safely")),
});

export const eventValidator = v.object({
  actor: actorValidator,
  aggregateId: v.string(),
  aggregateType: v.string(),
  eventId: v.string(),
  eventType: v.string(),
  occurredAt: v.string(),
  payload: v.any(),
  schemaVersion: v.literal("nodekit.caseflow-event/v1"),
  sequence: v.number(),
});

export const proposalDecisionValidator = v.object({
  approval: approvalValidator,
  artifact: artifactValidator,
  proposal: proposalValidator,
  reused: v.boolean(),
});

export const exceptionResolutionValidator = v.object({
  exception: exceptionValidator,
  run: runValidator,
});

export const completionValidator = v.object({
  receipt: receiptValidator,
  reused: v.boolean(),
  run: runValidator,
});
