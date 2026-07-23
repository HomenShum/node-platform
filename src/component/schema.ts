import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator, stageValidator } from "./validators.js";

const scoped = {
  // Opaque, host-authorized tenant/workspace identifier. The component never
  // interprets it or attempts to authenticate it.
  scopeKey: v.string(),
};

export default defineSchema({
  cases: defineTable({
    ...scoped,
    caseId: v.string(),
    title: v.string(),
    primaryJob: v.string(),
    status: v.union(v.literal("ready"), v.literal("in_progress"), v.literal("completed")),
    currentRunId: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "caseId"])
    .index("by_scope", ["scopeKey"])
    .index("by_scope_status", ["scopeKey", "status"]),

  runs: defineTable({
    ...scoped,
    runId: v.string(),
    caseId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("blocked"),
      v.literal("cancelled"),
      v.literal("completed"),
      v.literal("failed_safely"),
    ),
    currentStageId: v.string(),
    nextAction: v.string(),
    nextActionOwner: v.string(),
    stages: v.array(stageValidator),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "runId"])
    .index("by_scope_case", ["scopeKey", "caseId"])
    .index("by_scope_status", ["scopeKey", "status"]),

  artifacts: defineTable({
    ...scoped,
    artifactId: v.string(),
    caseId: v.string(),
    runId: v.string(),
    kind: v.string(),
    title: v.string(),
    canonicalVersion: v.number(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "artifactId"])
    .index("by_scope_case", ["scopeKey", "caseId"])
    .index("by_scope_run", ["scopeKey", "runId"]),

  artifactVersions: defineTable({
    ...scoped,
    artifactId: v.string(),
    version: v.number(),
    content: v.any(),
    contentHash: v.string(),
    createdAt: v.string(),
    proposalId: v.optional(v.string()),
  }).index("by_scope_artifact_version", ["scopeKey", "artifactId", "version"]),

  proposals: defineTable({
    ...scoped,
    proposalId: v.string(),
    artifactId: v.string(),
    baseVersion: v.number(),
    patch: v.any(),
    rationale: v.string(),
    status: v.union(
      v.literal("accepted"),
      v.literal("conflicted"),
      v.literal("pending"),
      v.literal("rejected"),
    ),
    createdAt: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "proposalId"])
    .index("by_scope_artifact", ["scopeKey", "artifactId"])
    .index("by_scope_status", ["scopeKey", "status"]),

  approvals: defineTable({
    ...scoped,
    approvalId: v.string(),
    proposalId: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    comment: v.string(),
    decidedAt: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "approvalId"])
    .index("by_scope_proposal", ["scopeKey", "proposalId"]),

  exceptions: defineTable({
    ...scoped,
    exceptionId: v.string(),
    runId: v.string(),
    code: v.string(),
    message: v.string(),
    preservedState: v.any(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    resolution: v.optional(v.string()),
    raisedAt: v.string(),
    resolvedAt: v.optional(v.string()),
  })
    .index("by_scope_id", ["scopeKey", "exceptionId"])
    .index("by_scope_run", ["scopeKey", "runId"])
    .index("by_scope_status", ["scopeKey", "status"]),

  receipts: defineTable({
    ...scoped,
    receiptId: v.string(),
    approvalBindings: v.array(v.object({
      approvalId: v.string(),
      commentHash: v.string(),
      decision: v.union(v.literal("accepted"), v.literal("rejected")),
      proposalId: v.string(),
    })),
    artifactBindings: v.array(v.object({
      artifactId: v.string(),
      canonicalVersion: v.number(),
      contentHash: v.string(),
    })),
    caseHash: v.string(),
    caseId: v.string(),
    runId: v.string(),
    status: v.union(v.literal("cancelled"), v.literal("completed"), v.literal("failed_safely")),
    artifactIds: v.array(v.string()),
    proposalIds: v.array(v.string()),
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
    runHash: v.string(),
  })
    .index("by_scope_id", ["scopeKey", "receiptId"])
    .index("by_scope_run", ["scopeKey", "runId"]),

  timelineEvents: defineTable({
    ...scoped,
    eventId: v.string(),
    aggregateType: v.string(),
    aggregateId: v.string(),
    eventType: v.string(),
    idempotencyKey: v.optional(v.string()),
    idempotencyResult: v.optional(v.any()),
    actor: actorValidator,
    payload: v.any(),
    requestHash: v.optional(v.string()),
    occurredAt: v.string(),
    sequence: v.number(),
  })
    .index("by_scope_id", ["scopeKey", "eventId"])
    .index("by_scope_aggregate", ["scopeKey", "aggregateType", "aggregateId", "sequence"])
    .index("by_scope_idempotency", ["scopeKey", "idempotencyKey"]),
});
