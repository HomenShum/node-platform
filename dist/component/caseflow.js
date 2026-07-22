import { v } from "convex/values";
import { normalizePortableValue, normalizeStageDefinitions, PORTABLE_VALUE_LIMITS, requireTrimmedText, stageDefinitionsMatch, } from "../lib/portable-value.mjs";
import { normalizeReceiptBindings } from "../lib/receipt-bindings.mjs";
import { mutation, query } from "./_generated/server.js";
import { contentHash } from "./hash.js";
import { actorValidator, approvalValidator, artifactValidator, caseValidator, completionValidator, eventValidator, exceptionResolutionValidator, exceptionValidator, proposalDecisionValidator, proposalValidator, receiptValidator, runValidator, stageValidator, } from "./validators.js";
const SCHEMA = {
    approval: "nodekit.approval/v1",
    artifact: "nodekit.artifact/v1",
    case: "nodekit.case/v1",
    event: "nodekit.caseflow-event/v1",
    exception: "nodekit.exception/v1",
    proposal: "nodekit.proposal/v1",
    receipt: "nodekit.receipt/v2",
    run: "nodekit.run/v1",
};
const TERMINAL_RUN_STATUSES = new Set(["cancelled", "completed", "failed_safely"]);
function timestamp() {
    return new Date(Date.now()).toISOString();
}
function actorOrSystem(actor) {
    const normalized = normalizePortableValue(actor ?? { id: "nodekit", type: "system" }, "actor");
    if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
        throw new TypeError("actor must be an object");
    }
    return {
        id: requireTrimmedText(normalized.id, "actor.id"),
        type: requireTrimmedText(normalized.type, "actor.type"),
    };
}
function requireActiveRun(run) {
    if (run.status === "active")
        return;
    if (TERMINAL_RUN_STATUSES.has(run.status))
        throw new Error(`run is terminal: ${run.status}`);
    throw new Error(`run is not active: ${run.status}`);
}
function requireNonTerminalRun(run) {
    if (TERMINAL_RUN_STATUSES.has(run.status))
        throw new Error(`run is terminal: ${run.status}`);
}
function requireTransportHash(expected, actual, label) {
    if (!/^[a-f0-9]{64}$/.test(expected))
        throw new Error(`${label} must be a lowercase SHA-256 digest`);
    if (expected !== actual)
        throw new Error(`${label} does not match the transported portable value`);
}
function nodeId(prefix) {
    return `${prefix}_${contentHash({ entropy: Math.random(), prefix, timestamp: Date.now() }).slice(0, 26)}`;
}
async function requireScoped(ctx, table, rawId, scopeKey, label) {
    let record = null;
    if (table === "cases")
        record = await ctx.db.query("cases").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("caseId", rawId)).unique();
    else if (table === "runs")
        record = await ctx.db.query("runs").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("runId", rawId)).unique();
    else if (table === "artifacts")
        record = await ctx.db.query("artifacts").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("artifactId", rawId)).unique();
    else if (table === "proposals")
        record = await ctx.db.query("proposals").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("proposalId", rawId)).unique();
    else if (table === "approvals")
        record = await ctx.db.query("approvals").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("approvalId", rawId)).unique();
    else if (table === "exceptions")
        record = await ctx.db.query("exceptions").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("exceptionId", rawId)).unique();
    else if (table === "receipts")
        record = await ctx.db.query("receipts").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("receiptId", rawId)).unique();
    else if (table === "timelineEvents")
        record = await ctx.db.query("timelineEvents").withIndex("by_scope_id", (q) => q.eq("scopeKey", scopeKey).eq("eventId", rawId)).unique();
    else
        throw new Error(`unsupported scoped table: ${String(table)}`);
    if (record === null)
        throw new Error(`${label} not found: ${rawId}`);
    return record;
}
function toCase(record) {
    return {
        caseId: record.caseId,
        createdAt: record.createdAt,
        currentRunId: record.currentRunId ?? null,
        primaryJob: record.primaryJob,
        schemaVersion: SCHEMA.case,
        status: record.status,
        title: record.title,
        updatedAt: record.updatedAt,
    };
}
function toRun(record) {
    return {
        caseId: record.caseId,
        createdAt: record.createdAt,
        currentStageId: record.currentStageId,
        nextAction: record.nextAction,
        nextActionOwner: record.nextActionOwner,
        runId: record.runId,
        schemaVersion: SCHEMA.run,
        stages: record.stages,
        status: record.status,
        updatedAt: record.updatedAt,
    };
}
function toProposal(record) {
    return {
        artifactId: record.artifactId,
        baseVersion: record.baseVersion,
        createdAt: record.createdAt,
        patch: record.patch,
        proposalId: record.proposalId,
        rationale: record.rationale,
        schemaVersion: SCHEMA.proposal,
        status: record.status,
    };
}
function toApproval(record) {
    return {
        approvalId: record.approvalId,
        comment: record.comment,
        decidedAt: record.decidedAt,
        decision: record.decision,
        proposalId: record.proposalId,
        schemaVersion: SCHEMA.approval,
    };
}
function toException(record) {
    return {
        code: record.code,
        exceptionId: record.exceptionId,
        message: record.message,
        preservedState: record.preservedState,
        raisedAt: record.raisedAt,
        resolution: record.resolution ?? null,
        ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt }),
        runId: record.runId,
        schemaVersion: SCHEMA.exception,
        status: record.status,
    };
}
function toReceipt(record) {
    return {
        approvalBindings: record.approvalBindings,
        artifactBindings: record.artifactBindings,
        artifactIds: record.artifactIds,
        caseHash: record.caseHash,
        caseId: record.caseId,
        eventBindings: record.eventBindings,
        eventIds: record.eventIds,
        generatedAt: record.generatedAt,
        proposalBindings: record.proposalBindings,
        proposalIds: record.proposalIds,
        receiptHash: record.receiptHash,
        receiptId: record.receiptId,
        runHash: record.runHash,
        runId: record.runId,
        schemaVersion: SCHEMA.receipt,
        status: record.status,
    };
}
function toEvent(record) {
    return {
        actor: record.actor,
        aggregateId: record.aggregateId,
        aggregateType: record.aggregateType,
        eventId: record.eventId,
        eventType: record.eventType,
        occurredAt: record.occurredAt,
        payload: record.payload,
        schemaVersion: SCHEMA.event,
        sequence: record.sequence,
    };
}
async function artifactOutput(ctx, record) {
    const versions = await ctx.db
        .query("artifactVersions")
        .withIndex("by_scope_artifact_version", (q) => q.eq("scopeKey", record.scopeKey).eq("artifactId", record.artifactId))
        .collect();
    return {
        artifactId: record.artifactId,
        canonicalVersion: record.canonicalVersion,
        caseId: record.caseId,
        createdAt: record.createdAt,
        kind: record.kind,
        runId: record.runId,
        schemaVersion: SCHEMA.artifact,
        title: record.title,
        updatedAt: record.updatedAt,
        versions: versions
            .sort((left, right) => left.version - right.version)
            .map((entry) => ({
            content: entry.content,
            contentHash: entry.contentHash,
            createdAt: entry.createdAt,
            ...(entry.proposalId === undefined ? {} : { proposalId: entry.proposalId }),
            version: entry.version,
        })),
    };
}
async function emit(ctx, scopeKey, aggregateType, aggregateId, eventType, payload, actor, idempotency) {
    const portablePayload = normalizePortableValue(payload, "event payload");
    const idempotencyResult = idempotency === undefined
        ? undefined
        : normalizePortableValue(idempotency.result, "idempotency result", {
            maxEncodedBytes: PORTABLE_VALUE_LIMITS.maxEnvelopeBytes,
        });
    const previous = await ctx.db
        .query("timelineEvents")
        .withIndex("by_scope_aggregate", (q) => q.eq("scopeKey", scopeKey).eq("aggregateType", aggregateType).eq("aggregateId", aggregateId))
        .order("desc")
        .first();
    const eventId = nodeId("event");
    await ctx.db.insert("timelineEvents", {
        actor: actorOrSystem(actor),
        aggregateId,
        aggregateType,
        eventId,
        eventType,
        ...(idempotency === undefined ? {} : { idempotencyKey: idempotency.key }),
        ...(idempotencyResult === undefined ? {} : { idempotencyResult }),
        occurredAt: timestamp(),
        payload: portablePayload,
        ...(idempotency === undefined ? {} : { requestHash: idempotency.requestHash }),
        scopeKey,
        sequence: (previous?.sequence ?? 0) + 1,
    });
    return eventId;
}
async function findIdempotentEvent(ctx, scopeKey, idempotencyKey, operation, request) {
    const requestHash = contentHash({ operation, request });
    if (idempotencyKey === undefined)
        return { event: null, key: undefined, requestHash };
    const key = requireTrimmedText(idempotencyKey, "idempotencyKey");
    const event = await ctx.db
        .query("timelineEvents")
        .withIndex("by_scope_idempotency", (q) => q.eq("scopeKey", scopeKey).eq("idempotencyKey", key))
        .first();
    if (event !== null && event.requestHash !== requestHash) {
        throw new Error(`idempotencyKey was already used with a different ${operation} request`);
    }
    return { event, key, requestHash };
}
export const createCase = mutation({
    args: {
        actor: v.optional(actorValidator),
        primaryJob: v.string(),
        scopeKey: v.string(),
        title: v.string(),
    },
    returns: caseValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const title = args.title.trim();
        const primaryJob = args.primaryJob.trim();
        if (args.scopeKey.length === 0)
            throw new Error("scopeKey is required");
        if (title.length === 0)
            throw new Error("case title is required");
        if (primaryJob.length === 0)
            throw new Error("case primaryJob is required");
        const now = timestamp();
        const caseId = nodeId("case");
        await ctx.db.insert("cases", {
            caseId,
            createdAt: now,
            primaryJob,
            scopeKey: args.scopeKey,
            status: "ready",
            title,
            updatedAt: now,
        });
        const record = await requireScoped(ctx, "cases", caseId, args.scopeKey, "case");
        await emit(ctx, args.scopeKey, "case", caseId, "case.created", toCase(record), actor);
        return toCase(record);
    },
});
export const updateCaseInput = mutation({
    args: {
        actor: v.optional(actorValidator),
        caseId: v.string(),
        primaryJob: v.optional(v.string()),
        scopeKey: v.string(),
        title: v.optional(v.string()),
    },
    returns: caseValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const record = await requireScoped(ctx, "cases", args.caseId, args.scopeKey, "case");
        if (record.status === "completed")
            throw new Error("completed case input cannot be changed");
        const primaryJob = args.primaryJob?.trim() ?? record.primaryJob;
        const title = args.title?.trim();
        if (primaryJob.length === 0)
            throw new Error("case primaryJob is required");
        if (title !== undefined && title.length === 0)
            throw new Error("case title cannot be empty");
        if (primaryJob === record.primaryJob && (title === undefined || title === record.title))
            return toCase(record);
        await ctx.db.patch(record._id, {
            primaryJob,
            ...(title === undefined ? {} : { title }),
            updatedAt: timestamp(),
        });
        const updated = await requireScoped(ctx, "cases", args.caseId, args.scopeKey, "case");
        await emit(ctx, args.scopeKey, "case", args.caseId, "case.updated", {
            primaryJob,
            ...(title === undefined ? {} : { title }),
        }, actor);
        return toCase(updated);
    },
});
export const startRun = mutation({
    args: {
        actor: v.optional(actorValidator),
        caseId: v.string(),
        scopeKey: v.string(),
        stages: v.array(v.object({ id: v.string(), label: v.string(), owner: v.string() })),
    },
    returns: runValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const caseRecord = await requireScoped(ctx, "cases", args.caseId, args.scopeKey, "case");
        const normalizedStages = normalizeStageDefinitions(args.stages);
        if (caseRecord.currentRunId !== undefined) {
            const current = await requireScoped(ctx, "runs", caseRecord.currentRunId, args.scopeKey, "run");
            if (!TERMINAL_RUN_STATUSES.has(current.status)) {
                if (!stageDefinitionsMatch(current.stages, normalizedStages)) {
                    throw new Error("active run stages do not match requested stage plan");
                }
                return toRun(current);
            }
        }
        const now = timestamp();
        const runId = nodeId("run");
        await ctx.db.insert("runs", {
            caseId: args.caseId,
            createdAt: now,
            currentStageId: normalizedStages[0].id,
            nextAction: normalizedStages[0].label,
            nextActionOwner: normalizedStages[0].owner,
            runId,
            scopeKey: args.scopeKey,
            stages: normalizedStages,
            status: "active",
            updatedAt: now,
        });
        await ctx.db.patch(caseRecord._id, { currentRunId: runId, status: "in_progress", updatedAt: now });
        const run = await requireScoped(ctx, "runs", runId, args.scopeKey, "run");
        await emit(ctx, args.scopeKey, "run", runId, "run.started", toRun(run), actor);
        await emit(ctx, args.scopeKey, "run", runId, "stage.entered", { stageId: run.currentStageId }, actor);
        return toRun(run);
    },
});
export const enterStage = mutation({
    args: {
        actor: v.optional(actorValidator),
        idempotencyKey: v.optional(v.string()),
        nextAction: v.optional(v.string()),
        nextActionOwner: v.optional(v.string()),
        runId: v.string(),
        scopeKey: v.string(),
        stageId: v.string(),
    },
    returns: runValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const stageId = requireTrimmedText(args.stageId, "stageId");
        const requestedNextAction = args.nextAction === undefined ? undefined : requireTrimmedText(args.nextAction, "nextAction");
        const requestedNextActionOwner = args.nextActionOwner === undefined ? undefined : requireTrimmedText(args.nextActionOwner, "nextActionOwner");
        const idempotency = await findIdempotentEvent(ctx, args.scopeKey, args.idempotencyKey, "enterStage", {
            actor,
            nextAction: requestedNextAction ?? null,
            nextActionOwner: requestedNextActionOwner ?? null,
            runId: args.runId,
            stageId,
        });
        if (idempotency.event !== null) {
            if (idempotency.event.idempotencyResult === undefined)
                throw new Error("idempotency result is missing");
            return idempotency.event.idempotencyResult;
        }
        const run = await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run");
        requireActiveRun(run);
        const targetIndex = run.stages.findIndex((stage) => stage.id === stageId);
        if (targetIndex < 0)
            throw new Error(`stage not found: ${stageId}`);
        const stages = run.stages.map((stage, index) => ({
            ...stage,
            status: index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending",
        }));
        const nextAction = requestedNextAction ?? stages[targetIndex].label;
        const nextActionOwner = requestedNextActionOwner ?? stages[targetIndex].owner;
        await ctx.db.patch(run._id, {
            currentStageId: stageId,
            nextAction,
            nextActionOwner,
            stages,
            updatedAt: timestamp(),
        });
        const updated = await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run");
        await emit(ctx, args.scopeKey, "run", args.runId, "stage.entered", {
            nextAction,
            nextActionOwner,
            stageId,
        }, actor, idempotency.key === undefined ? undefined : {
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            result: toRun(updated),
        });
        return toRun(updated);
    },
});
export const createArtifact = mutation({
    args: {
        actor: v.optional(actorValidator),
        caseId: v.string(),
        content: v.any(),
        contentHash: v.string(),
        idempotencyKey: v.optional(v.string()),
        kind: v.optional(v.string()),
        runId: v.string(),
        scopeKey: v.string(),
        title: v.optional(v.string()),
    },
    returns: artifactValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const content = normalizePortableValue(args.content, "content", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        requireTransportHash(args.contentHash, contentHash(content), "contentHash");
        const kind = args.kind === undefined ? "generic" : requireTrimmedText(args.kind, "kind");
        const title = args.title === undefined ? "Artifact" : requireTrimmedText(args.title, "title");
        const idempotency = await findIdempotentEvent(ctx, args.scopeKey, args.idempotencyKey, "createArtifact", {
            actor,
            caseId: args.caseId,
            content,
            kind,
            runId: args.runId,
            title,
        });
        if (idempotency.event !== null) {
            if (idempotency.event.idempotencyResult === undefined)
                throw new Error("idempotency result is missing");
            return idempotency.event.idempotencyResult;
        }
        await requireScoped(ctx, "cases", args.caseId, args.scopeKey, "case");
        const run = await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run");
        if (run.caseId !== args.caseId)
            throw new Error("run does not belong to case");
        requireActiveRun(run);
        const now = timestamp();
        const artifactId = nodeId("artifact");
        await ctx.db.insert("artifacts", {
            artifactId,
            canonicalVersion: 1,
            caseId: args.caseId,
            createdAt: now,
            kind,
            runId: args.runId,
            scopeKey: args.scopeKey,
            title,
            updatedAt: now,
        });
        await ctx.db.insert("artifactVersions", {
            artifactId,
            content,
            contentHash: contentHash(content),
            createdAt: now,
            scopeKey: args.scopeKey,
            version: 1,
        });
        const artifact = await requireScoped(ctx, "artifacts", artifactId, args.scopeKey, "artifact");
        const result = await artifactOutput(ctx, artifact);
        await emit(ctx, args.scopeKey, "artifact", artifactId, "artifact.created", {
            artifactId,
            version: 1,
        }, actor, idempotency.key === undefined ? undefined : {
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            result,
        });
        return result;
    },
});
export const createProposal = mutation({
    args: {
        actor: v.optional(actorValidator),
        artifactId: v.string(),
        baseVersion: v.number(),
        idempotencyKey: v.optional(v.string()),
        patch: v.any(),
        patchHash: v.string(),
        rationale: v.optional(v.string()),
        scopeKey: v.string(),
    },
    returns: proposalValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const patch = normalizePortableValue(args.patch, "patch", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        requireTransportHash(args.patchHash, contentHash(patch), "patchHash");
        if (!Number.isInteger(args.baseVersion) || args.baseVersion < 1)
            throw new Error("baseVersion must be a positive integer");
        const rationale = args.rationale ?? "";
        const idempotency = await findIdempotentEvent(ctx, args.scopeKey, args.idempotencyKey, "createProposal", {
            actor,
            artifactId: args.artifactId,
            baseVersion: args.baseVersion,
            patch,
            rationale,
        });
        if (idempotency.event !== null) {
            if (idempotency.event.idempotencyResult === undefined)
                throw new Error("idempotency result is missing");
            return idempotency.event.idempotencyResult;
        }
        const artifact = await requireScoped(ctx, "artifacts", args.artifactId, args.scopeKey, "artifact");
        const run = await requireScoped(ctx, "runs", artifact.runId, args.scopeKey, "run");
        requireActiveRun(run);
        if (args.baseVersion !== artifact.canonicalVersion) {
            throw new Error(`proposal base version ${args.baseVersion} is stale; canonical version is ${artifact.canonicalVersion}`);
        }
        const proposalId = nodeId("proposal");
        await ctx.db.insert("proposals", {
            artifactId: args.artifactId,
            baseVersion: args.baseVersion,
            createdAt: timestamp(),
            patch,
            proposalId,
            rationale,
            scopeKey: args.scopeKey,
            status: "pending",
        });
        const proposal = await requireScoped(ctx, "proposals", proposalId, args.scopeKey, "proposal");
        const result = toProposal(proposal);
        await emit(ctx, args.scopeKey, "proposal", proposalId, "proposal.created", {
            artifactId: result.artifactId,
            baseVersion: result.baseVersion,
            proposalId: result.proposalId,
        }, actor, idempotency.key === undefined ? undefined : {
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            result,
        });
        return result;
    },
});
export const decideProposal = mutation({
    args: {
        actor: v.optional(actorValidator),
        comment: v.optional(v.string()),
        decision: v.union(v.literal("accepted"), v.literal("rejected")),
        proposalId: v.string(),
        scopeKey: v.string(),
    },
    returns: proposalDecisionValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const proposal = await requireScoped(ctx, "proposals", args.proposalId, args.scopeKey, "proposal");
        const artifact = await requireScoped(ctx, "artifacts", proposal.artifactId, args.scopeKey, "artifact");
        if (proposal.status !== "pending") {
            const approval = await ctx.db
                .query("approvals")
                .withIndex("by_scope_proposal", (q) => q.eq("scopeKey", args.scopeKey).eq("proposalId", args.proposalId))
                .first();
            const decisionEvent = await ctx.db
                .query("timelineEvents")
                .withIndex("by_scope_aggregate", (q) => q
                .eq("scopeKey", args.scopeKey)
                .eq("aggregateType", "proposal")
                .eq("aggregateId", args.proposalId))
                .order("desc")
                .filter((q) => q.eq(q.field("eventType"), `proposal.${proposal.status}`))
                .first();
            const matches = approval?.decision === args.decision
                && approval.comment === (args.comment ?? "")
                && decisionEvent !== null
                && contentHash(decisionEvent.actor) === contentHash(actor)
                && (proposal.status === args.decision || (proposal.status === "conflicted" && args.decision === "accepted"));
            if (!matches || approval === null) {
                throw new Error(`proposal retry does not match original decision request; proposal is already ${proposal.status}`);
            }
            return {
                approval: toApproval(approval),
                artifact: await artifactOutput(ctx, artifact),
                proposal: toProposal(proposal),
                reused: true,
            };
        }
        const run = await requireScoped(ctx, "runs", artifact.runId, args.scopeKey, "run");
        requireActiveRun(run);
        const decidedAt = timestamp();
        const approvalId = nodeId("approval");
        await ctx.db.insert("approvals", {
            approvalId,
            comment: args.comment ?? "",
            decidedAt,
            decision: args.decision,
            proposalId: args.proposalId,
            scopeKey: args.scopeKey,
        });
        let nextStatus = args.decision;
        if (args.decision === "accepted" && proposal.baseVersion !== artifact.canonicalVersion)
            nextStatus = "conflicted";
        await ctx.db.patch(proposal._id, { status: nextStatus });
        if (nextStatus === "conflicted") {
            await emit(ctx, args.scopeKey, "proposal", args.proposalId, "proposal.conflicted", {
                canonicalVersion: artifact.canonicalVersion,
            }, actor);
        }
        else if (nextStatus === "accepted") {
            const nextVersion = artifact.canonicalVersion + 1;
            await ctx.db.patch(artifact._id, { canonicalVersion: nextVersion, updatedAt: decidedAt });
            await ctx.db.insert("artifactVersions", {
                artifactId: proposal.artifactId,
                content: proposal.patch,
                contentHash: contentHash(proposal.patch),
                createdAt: decidedAt,
                proposalId: args.proposalId,
                scopeKey: args.scopeKey,
                version: nextVersion,
            });
            await emit(ctx, args.scopeKey, "artifact", proposal.artifactId, "artifact.version_created", {
                proposalId: args.proposalId,
                version: nextVersion,
            }, actor);
        }
        await emit(ctx, args.scopeKey, "proposal", args.proposalId, `proposal.${nextStatus}`, {
            approvalId,
        }, actor);
        const updatedProposal = await requireScoped(ctx, "proposals", args.proposalId, args.scopeKey, "proposal");
        const updatedArtifact = await requireScoped(ctx, "artifacts", proposal.artifactId, args.scopeKey, "artifact");
        const approval = await requireScoped(ctx, "approvals", approvalId, args.scopeKey, "approval");
        return {
            approval: toApproval(approval),
            artifact: await artifactOutput(ctx, updatedArtifact),
            proposal: toProposal(updatedProposal),
            reused: false,
        };
    },
});
export const raiseException = mutation({
    args: {
        actor: v.optional(actorValidator),
        code: v.optional(v.string()),
        idempotencyKey: v.optional(v.string()),
        message: v.optional(v.string()),
        preservedState: v.optional(v.any()),
        preservedStateHash: v.string(),
        runId: v.string(),
        scopeKey: v.string(),
    },
    returns: exceptionValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const code = args.code === undefined ? "unknown" : requireTrimmedText(args.code, "code");
        const message = args.message === undefined ? "An exception occurred." : requireTrimmedText(args.message, "message");
        const preservedState = normalizePortableValue(args.preservedState ?? {}, "preservedState", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        requireTransportHash(args.preservedStateHash, contentHash(preservedState), "preservedStateHash");
        const idempotency = await findIdempotentEvent(ctx, args.scopeKey, args.idempotencyKey, "raiseException", {
            actor,
            code,
            message,
            preservedState,
            runId: args.runId,
        });
        if (idempotency.event !== null) {
            if (idempotency.event.idempotencyResult === undefined)
                throw new Error("idempotency result is missing");
            return idempotency.event.idempotencyResult;
        }
        const run = await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run");
        requireNonTerminalRun(run);
        const raisedAt = timestamp();
        const exceptionId = nodeId("exception");
        await ctx.db.insert("exceptions", {
            code,
            exceptionId,
            message,
            preservedState,
            raisedAt,
            runId: args.runId,
            scopeKey: args.scopeKey,
            status: "open",
        });
        await ctx.db.patch(run._id, {
            nextAction: "Resolve exception",
            nextActionOwner: "user",
            status: "blocked",
            updatedAt: raisedAt,
        });
        const exception = await requireScoped(ctx, "exceptions", exceptionId, args.scopeKey, "exception");
        const result = toException(exception);
        await emit(ctx, args.scopeKey, "run", args.runId, "exception.raised", {
            code,
            exceptionId,
            messageHash: contentHash(message),
            preservedStateHash: contentHash(preservedState),
        }, actor, idempotency.key === undefined ? undefined : {
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            result,
        });
        return result;
    },
});
export const resolveException = mutation({
    args: {
        actor: v.optional(actorValidator),
        exceptionId: v.string(),
        nextAction: v.optional(v.string()),
        nextActionOwner: v.optional(v.string()),
        resolution: v.optional(v.string()),
        scopeKey: v.string(),
    },
    returns: exceptionResolutionValidator,
    handler: async (ctx, args) => {
        const actor = actorOrSystem(args.actor);
        const exception = await requireScoped(ctx, "exceptions", args.exceptionId, args.scopeKey, "exception");
        if (exception.status !== "open")
            throw new Error("exception is already resolved");
        const run = await requireScoped(ctx, "runs", exception.runId, args.scopeKey, "run");
        requireNonTerminalRun(run);
        const resolvedAt = timestamp();
        const resolution = args.resolution === undefined ? "resolved" : requireTrimmedText(args.resolution, "resolution");
        const nextAction = args.nextAction === undefined ? "Continue run" : requireTrimmedText(args.nextAction, "nextAction");
        const nextActionOwner = args.nextActionOwner === undefined ? "system" : requireTrimmedText(args.nextActionOwner, "nextActionOwner");
        await ctx.db.patch(exception._id, { resolution, resolvedAt, status: "resolved" });
        const unresolved = await ctx.db
            .query("exceptions")
            .withIndex("by_scope_run", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", exception.runId))
            .collect();
        const remainingOpen = unresolved.filter((entry) => entry.status === "open" && entry._id !== exception._id);
        await ctx.db.patch(run._id, {
            nextAction: remainingOpen.length > 0 ? "Resolve exception" : nextAction,
            nextActionOwner: remainingOpen.length > 0 ? "user" : nextActionOwner,
            status: remainingOpen.length > 0 ? "blocked" : "active",
            updatedAt: resolvedAt,
        });
        await emit(ctx, args.scopeKey, "run", exception.runId, "exception.resolved", {
            exceptionId: args.exceptionId,
            remainingOpenExceptions: remainingOpen.length,
            resolution,
        }, actor);
        return {
            exception: toException(await requireScoped(ctx, "exceptions", args.exceptionId, args.scopeKey, "exception")),
            run: toRun(await requireScoped(ctx, "runs", exception.runId, args.scopeKey, "run")),
        };
    },
});
async function terminalizeRun(ctx, args, status, reason) {
    const actor = actorOrSystem(args.actor);
    const eventType = `run.${status}`;
    const terminalPayload = status === "completed" ? {} : { reason };
    const run = await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run");
    if (run.status === status) {
        const receipt = await ctx.db
            .query("receipts")
            .withIndex("by_scope_run", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", args.runId))
            .first();
        if (receipt === null)
            throw new Error(`${status} run is missing its receipt`);
        const runEvents = await ctx.db
            .query("timelineEvents")
            .withIndex("by_scope_aggregate", (q) => q.eq("scopeKey", args.scopeKey).eq("aggregateType", "run").eq("aggregateId", args.runId))
            .collect();
        const terminalEvent = runEvents.find((entry) => entry.eventType === eventType);
        if (terminalEvent === undefined
            || contentHash(terminalEvent.actor) !== contentHash(actor)
            || contentHash(terminalEvent.payload) !== contentHash(terminalPayload)) {
            throw new Error("terminal retry does not match the original request");
        }
        return { receipt: toReceipt(receipt), reused: true, run: toRun(run) };
    }
    if (TERMINAL_RUN_STATUSES.has(run.status))
        throw new Error(`run is terminal: ${run.status}`);
    if (status === "completed")
        requireActiveRun(run);
    const exceptions = await ctx.db
        .query("exceptions")
        .withIndex("by_scope_run", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", args.runId))
        .collect();
    const runArtifacts = await ctx.db
        .query("artifacts")
        .withIndex("by_scope_run", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", args.runId))
        .collect();
    const pendingProposalGroups = await Promise.all(runArtifacts.map((artifact) => ctx.db.query("proposals").withIndex("by_scope_artifact", (q) => q.eq("scopeKey", args.scopeKey).eq("artifactId", artifact.artifactId)).collect()));
    if (status === "completed") {
        if (runArtifacts.length === 0)
            throw new Error("run must have at least one canonical artifact");
        if (exceptions.some((entry) => entry.status === "open"))
            throw new Error("run has unresolved exceptions");
        if (pendingProposalGroups.flat().some((proposal) => proposal.status === "pending")) {
            throw new Error("run has pending proposals");
        }
    }
    const completedAt = timestamp();
    await ctx.db.patch(run._id, {
        nextAction: status === "completed" ? "Review receipt" : "Start a new run",
        nextActionOwner: "user",
        stages: status === "completed"
            ? run.stages.map((stage) => ({ ...stage, status: "completed" }))
            : run.stages,
        status,
        updatedAt: completedAt,
    });
    const caseRecord = await requireScoped(ctx, "cases", run.caseId, args.scopeKey, "case");
    await ctx.db.patch(caseRecord._id, { status: status === "completed" ? "completed" : "ready", updatedAt: completedAt });
    await emit(ctx, args.scopeKey, "run", args.runId, eventType, terminalPayload, actor);
    const rawArtifactBindings = await Promise.all(runArtifacts.map(async (artifact) => {
        const canonicalVersion = await ctx.db
            .query("artifactVersions")
            .withIndex("by_scope_artifact_version", (q) => q.eq("scopeKey", args.scopeKey)
            .eq("artifactId", artifact.artifactId)
            .eq("version", artifact.canonicalVersion))
            .first();
        if (canonicalVersion === null)
            throw new Error(`artifact ${artifact.artifactId} is missing its canonical version`);
        return {
            artifactId: artifact.artifactId,
            canonicalVersion: artifact.canonicalVersion,
            contentHash: canonicalVersion.contentHash,
        };
    }));
    const rawArtifactIds = rawArtifactBindings.map((entry) => entry.artifactId);
    const proposalGroups = await Promise.all(rawArtifactIds.map((artifactId) => ctx.db.query("proposals").withIndex("by_scope_artifact", (q) => q.eq("scopeKey", args.scopeKey).eq("artifactId", artifactId)).collect()));
    const proposals = proposalGroups.flat();
    const rawProposalBindings = proposals.map((proposal) => ({
        artifactId: proposal.artifactId,
        baseVersion: proposal.baseVersion,
        patchHash: contentHash(proposal.patch),
        proposalId: proposal.proposalId,
        status: proposal.status,
    }));
    const rawProposalIds = rawProposalBindings.map((entry) => entry.proposalId);
    const approvalGroups = await Promise.all(rawProposalIds.map((proposalId) => ctx.db.query("approvals").withIndex("by_scope_proposal", (q) => q.eq("scopeKey", args.scopeKey).eq("proposalId", proposalId)).collect()));
    const rawApprovalBindings = approvalGroups.flat().map((approval) => ({
        approvalId: approval.approvalId,
        commentHash: contentHash(approval.comment),
        decision: approval.decision,
        proposalId: approval.proposalId,
    }));
    const aggregateRefs = [
        { type: "run", id: args.runId },
        ...rawArtifactIds.map((id) => ({ type: "artifact", id })),
        ...rawProposalIds.map((id) => ({ type: "proposal", id })),
    ];
    const eventGroups = await Promise.all(aggregateRefs.map(({ type, id }) => ctx.db.query("timelineEvents").withIndex("by_scope_aggregate", (q) => q.eq("scopeKey", args.scopeKey).eq("aggregateType", type).eq("aggregateId", id)).collect()));
    const rawEventBindings = eventGroups.flat().map((event) => ({
        actorHash: contentHash(event.actor),
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        eventId: event.eventId,
        eventType: event.eventType,
        payloadHash: contentHash(event.payload),
        sequence: event.sequence,
    }));
    const { approvalBindings, artifactBindings, artifactIds, eventBindings, eventIds, proposalBindings, proposalIds, } = normalizeReceiptBindings({
        approvalBindings: rawApprovalBindings,
        artifactBindings: rawArtifactBindings,
        eventBindings: rawEventBindings,
        proposalBindings: rawProposalBindings,
    });
    const receiptBody = {
        approvalBindings,
        artifactBindings,
        artifactIds,
        caseHash: contentHash(toCase(await requireScoped(ctx, "cases", run.caseId, args.scopeKey, "case"))),
        caseId: run.caseId,
        eventBindings,
        eventIds,
        generatedAt: completedAt,
        proposalBindings,
        proposalIds,
        runHash: contentHash(toRun(await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run"))),
        runId: args.runId,
        schemaVersion: SCHEMA.receipt,
        status,
    };
    const receiptId = nodeId("receipt");
    await ctx.db.insert("receipts", {
        approvalBindings,
        artifactBindings,
        artifactIds,
        caseHash: receiptBody.caseHash,
        caseId: run.caseId,
        eventBindings,
        eventIds,
        generatedAt: completedAt,
        proposalBindings,
        proposalIds,
        receiptId,
        receiptHash: contentHash(receiptBody),
        runHash: receiptBody.runHash,
        runId: args.runId,
        scopeKey: args.scopeKey,
        status,
    });
    const receipt = await requireScoped(ctx, "receipts", receiptId, args.scopeKey, "receipt");
    await emit(ctx, args.scopeKey, "run", args.runId, "receipt.created", {
        receiptHash: receipt.receiptHash,
        receiptId,
    }, actor);
    return {
        receipt: toReceipt(receipt),
        reused: false,
        run: toRun(await requireScoped(ctx, "runs", args.runId, args.scopeKey, "run")),
    };
}
export const completeRun = mutation({
    args: { actor: v.optional(actorValidator), runId: v.string(), scopeKey: v.string() },
    returns: completionValidator,
    handler: async (ctx, args) => terminalizeRun(ctx, args, "completed"),
});
export const cancelRun = mutation({
    args: { actor: v.optional(actorValidator), reason: v.optional(v.string()), runId: v.string(), scopeKey: v.string() },
    returns: completionValidator,
    handler: async (ctx, args) => terminalizeRun(ctx, args, "cancelled", requireTrimmedText(args.reason ?? "Cancelled by request.", "reason")),
});
export const failRunSafely = mutation({
    args: { actor: v.optional(actorValidator), reason: v.optional(v.string()), runId: v.string(), scopeKey: v.string() },
    returns: completionValidator,
    handler: async (ctx, args) => terminalizeRun(ctx, args, "failed_safely", requireTrimmedText(args.reason ?? "Run failed safely.", "reason")),
});
export const getCase = query({
    args: { caseId: v.string(), scopeKey: v.string() },
    returns: v.union(v.null(), caseValidator),
    handler: async (ctx, args) => {
        const record = await ctx.db.query("cases")
            .withIndex("by_scope_id", (q) => q.eq("scopeKey", args.scopeKey).eq("caseId", args.caseId))
            .unique();
        return record === null ? null : toCase(record);
    },
});
export const getRun = query({
    args: { runId: v.string(), scopeKey: v.string() },
    returns: v.union(v.null(), runValidator),
    handler: async (ctx, args) => {
        const record = await ctx.db.query("runs")
            .withIndex("by_scope_id", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", args.runId))
            .unique();
        return record === null ? null : toRun(record);
    },
});
export const getArtifact = query({
    args: { artifactId: v.string(), scopeKey: v.string() },
    returns: v.union(v.null(), artifactValidator),
    handler: async (ctx, args) => {
        const record = await ctx.db.query("artifacts")
            .withIndex("by_scope_id", (q) => q.eq("scopeKey", args.scopeKey).eq("artifactId", args.artifactId))
            .unique();
        return record === null ? null : await artifactOutput(ctx, record);
    },
});
export const getReceiptForRun = query({
    args: { runId: v.string(), scopeKey: v.string() },
    returns: v.union(v.null(), receiptValidator),
    handler: async (ctx, args) => {
        const receipt = await ctx.db
            .query("receipts")
            .withIndex("by_scope_run", (q) => q.eq("scopeKey", args.scopeKey).eq("runId", args.runId))
            .first();
        return receipt === null ? null : toReceipt(receipt);
    },
});
export const getTimeline = query({
    args: {
        aggregateId: v.string(),
        aggregateType: v.string(),
        limit: v.optional(v.number()),
        scopeKey: v.string(),
    },
    returns: v.array(eventValidator),
    handler: async (ctx, args) => {
        const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 100)));
        const events = await ctx.db
            .query("timelineEvents")
            .withIndex("by_scope_aggregate", (q) => q.eq("scopeKey", args.scopeKey).eq("aggregateType", args.aggregateType).eq("aggregateId", args.aggregateId))
            .order("asc")
            .take(limit);
        return events.map(toEvent);
    },
});
export const listPendingApprovals = query({
    args: { limit: v.optional(v.number()), scopeKey: v.string() },
    returns: v.array(proposalValidator),
    handler: async (ctx, args) => {
        const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 100)));
        const proposals = await ctx.db
            .query("proposals")
            .withIndex("by_scope_status", (q) => q.eq("scopeKey", args.scopeKey).eq("status", "pending"))
            .order("asc")
            .take(limit);
        return proposals.map(toProposal);
    },
});
//# sourceMappingURL=caseflow.js.map