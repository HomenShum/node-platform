export declare const actorValidator: import("convex/values").VObject<{
    id: string;
    type: string;
}, {
    id: import("convex/values").VString<string, "required">;
    type: import("convex/values").VString<string, "required">;
}, "required", "id" | "type">;
export declare const stageOwnerValidator: import("convex/values").VString<string, "required">;
export declare const stageValidator: import("convex/values").VObject<{
    id: string;
    label: string;
    owner: string;
    status: "active" | "completed" | "pending";
}, {
    id: import("convex/values").VString<string, "required">;
    label: import("convex/values").VString<string, "required">;
    owner: import("convex/values").VString<string, "required">;
    status: import("convex/values").VUnion<"active" | "completed" | "pending", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"pending", "required">], "required", never>;
}, "required", "id" | "label" | "owner" | "status">;
export declare const caseValidator: import("convex/values").VObject<{
    caseId: string;
    createdAt: string;
    currentRunId: string | null;
    primaryJob: string;
    schemaVersion: "nodekit.case/v1";
    status: "completed" | "in_progress" | "ready";
    title: string;
    updatedAt: string;
}, {
    caseId: import("convex/values").VString<string, "required">;
    createdAt: import("convex/values").VString<string, "required">;
    currentRunId: import("convex/values").VUnion<string | null, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "required", never>;
    primaryJob: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.case/v1", "required">;
    status: import("convex/values").VUnion<"completed" | "in_progress" | "ready", [import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"in_progress", "required">, import("convex/values").VLiteral<"ready", "required">], "required", never>;
    title: import("convex/values").VString<string, "required">;
    updatedAt: import("convex/values").VString<string, "required">;
}, "required", "caseId" | "createdAt" | "currentRunId" | "primaryJob" | "schemaVersion" | "status" | "title" | "updatedAt">;
export declare const runValidator: import("convex/values").VObject<{
    caseId: string;
    createdAt: string;
    currentStageId: string;
    nextAction: string;
    nextActionOwner: string;
    runId: string;
    schemaVersion: "nodekit.run/v1";
    stages: {
        id: string;
        label: string;
        owner: string;
        status: "active" | "completed" | "pending";
    }[];
    status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
    updatedAt: string;
}, {
    caseId: import("convex/values").VString<string, "required">;
    createdAt: import("convex/values").VString<string, "required">;
    currentStageId: import("convex/values").VString<string, "required">;
    nextAction: import("convex/values").VString<string, "required">;
    nextActionOwner: import("convex/values").VString<string, "required">;
    runId: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.run/v1", "required">;
    stages: import("convex/values").VArray<{
        id: string;
        label: string;
        owner: string;
        status: "active" | "completed" | "pending";
    }[], import("convex/values").VObject<{
        id: string;
        label: string;
        owner: string;
        status: "active" | "completed" | "pending";
    }, {
        id: import("convex/values").VString<string, "required">;
        label: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"active" | "completed" | "pending", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"pending", "required">], "required", never>;
    }, "required", "id" | "label" | "owner" | "status">, "required">;
    status: import("convex/values").VUnion<"active" | "blocked" | "cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"blocked", "required">, import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
    updatedAt: import("convex/values").VString<string, "required">;
}, "required", "caseId" | "createdAt" | "currentStageId" | "nextAction" | "nextActionOwner" | "runId" | "schemaVersion" | "stages" | "status" | "updatedAt">;
export declare const artifactVersionValidator: import("convex/values").VObject<{
    content: any;
    contentHash: string;
    createdAt: string;
    proposalId?: string;
    version: number;
}, {
    content: import("convex/values").VAny<any, "required", string>;
    contentHash: import("convex/values").VString<string, "required">;
    createdAt: import("convex/values").VString<string, "required">;
    proposalId: import("convex/values").VString<string | undefined, "optional">;
    version: import("convex/values").VFloat64<number, "required">;
}, "required", "content" | "contentHash" | "createdAt" | "proposalId" | "version" | `content.${string}`>;
export declare const artifactValidator: import("convex/values").VObject<{
    artifactId: string;
    canonicalVersion: number;
    caseId: string;
    createdAt: string;
    kind: string;
    runId: string;
    schemaVersion: "nodekit.artifact/v1";
    title: string;
    updatedAt: string;
    versions: {
        content: any;
        contentHash: string;
        createdAt: string;
        proposalId?: string;
        version: number;
    }[];
}, {
    artifactId: import("convex/values").VString<string, "required">;
    canonicalVersion: import("convex/values").VFloat64<number, "required">;
    caseId: import("convex/values").VString<string, "required">;
    createdAt: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VString<string, "required">;
    runId: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.artifact/v1", "required">;
    title: import("convex/values").VString<string, "required">;
    updatedAt: import("convex/values").VString<string, "required">;
    versions: import("convex/values").VArray<{
        content: any;
        contentHash: string;
        createdAt: string;
        proposalId?: string;
        version: number;
    }[], import("convex/values").VObject<{
        content: any;
        contentHash: string;
        createdAt: string;
        proposalId?: string;
        version: number;
    }, {
        content: import("convex/values").VAny<any, "required", string>;
        contentHash: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        proposalId: import("convex/values").VString<string | undefined, "optional">;
        version: import("convex/values").VFloat64<number, "required">;
    }, "required", "content" | "contentHash" | "createdAt" | "proposalId" | "version" | `content.${string}`>, "required">;
}, "required", "artifactId" | "canonicalVersion" | "caseId" | "createdAt" | "kind" | "runId" | "schemaVersion" | "title" | "updatedAt" | "versions">;
export declare const proposalValidator: import("convex/values").VObject<{
    artifactId: string;
    baseVersion: number;
    createdAt: string;
    patch: any;
    proposalId: string;
    rationale: string;
    schemaVersion: "nodekit.proposal/v1";
    status: "accepted" | "conflicted" | "pending" | "rejected";
}, {
    artifactId: import("convex/values").VString<string, "required">;
    baseVersion: import("convex/values").VFloat64<number, "required">;
    createdAt: import("convex/values").VString<string, "required">;
    patch: import("convex/values").VAny<any, "required", string>;
    proposalId: import("convex/values").VString<string, "required">;
    rationale: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.proposal/v1", "required">;
    status: import("convex/values").VUnion<"accepted" | "conflicted" | "pending" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"conflicted", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
}, "required", "artifactId" | "baseVersion" | "createdAt" | "patch" | "proposalId" | "rationale" | "schemaVersion" | "status" | `patch.${string}`>;
export declare const approvalValidator: import("convex/values").VObject<{
    approvalId: string;
    comment: string;
    decidedAt: string;
    decision: "accepted" | "rejected";
    proposalId: string;
    schemaVersion: "nodekit.approval/v1";
}, {
    approvalId: import("convex/values").VString<string, "required">;
    comment: import("convex/values").VString<string, "required">;
    decidedAt: import("convex/values").VString<string, "required">;
    decision: import("convex/values").VUnion<"accepted" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
    proposalId: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.approval/v1", "required">;
}, "required", "approvalId" | "comment" | "decidedAt" | "decision" | "proposalId" | "schemaVersion">;
export declare const exceptionValidator: import("convex/values").VObject<{
    code: string;
    exceptionId: string;
    message: string;
    preservedState: any;
    raisedAt: string;
    resolution: string | null;
    resolvedAt?: string;
    runId: string;
    schemaVersion: "nodekit.exception/v1";
    status: "open" | "resolved";
}, {
    code: import("convex/values").VString<string, "required">;
    exceptionId: import("convex/values").VString<string, "required">;
    message: import("convex/values").VString<string, "required">;
    preservedState: import("convex/values").VAny<any, "required", string>;
    raisedAt: import("convex/values").VString<string, "required">;
    resolution: import("convex/values").VUnion<string | null, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "required", never>;
    resolvedAt: import("convex/values").VString<string | undefined, "optional">;
    runId: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.exception/v1", "required">;
    status: import("convex/values").VUnion<"open" | "resolved", [import("convex/values").VLiteral<"open", "required">, import("convex/values").VLiteral<"resolved", "required">], "required", never>;
}, "required", "code" | "exceptionId" | "message" | "preservedState" | "raisedAt" | "resolution" | "resolvedAt" | "runId" | "schemaVersion" | "status" | `preservedState.${string}`>;
export declare const receiptValidator: import("convex/values").VObject<{
    approvalBindings: {
        approvalId: string;
        commentHash: string;
        decision: "accepted" | "rejected";
        proposalId: string;
    }[];
    artifactBindings: {
        artifactId: string;
        canonicalVersion: number;
        contentHash: string;
    }[];
    artifactIds: string[];
    caseHash: string;
    caseId: string;
    eventBindings: {
        actorHash: string;
        aggregateId: string;
        aggregateType: string;
        eventId: string;
        eventType: string;
        payloadHash: string;
        sequence: number;
    }[];
    eventIds: string[];
    generatedAt: string;
    proposalBindings: {
        artifactId: string;
        baseVersion: number;
        patchHash: string;
        proposalId: string;
        status: "accepted" | "conflicted" | "pending" | "rejected";
    }[];
    proposalIds: string[];
    receiptHash: string;
    receiptId: string;
    runHash: string;
    runId: string;
    schemaVersion: "nodekit.receipt/v2";
    status: "cancelled" | "completed" | "failed_safely";
}, {
    approvalBindings: import("convex/values").VArray<{
        approvalId: string;
        commentHash: string;
        decision: "accepted" | "rejected";
        proposalId: string;
    }[], import("convex/values").VObject<{
        approvalId: string;
        commentHash: string;
        decision: "accepted" | "rejected";
        proposalId: string;
    }, {
        approvalId: import("convex/values").VString<string, "required">;
        commentHash: import("convex/values").VString<string, "required">;
        decision: import("convex/values").VUnion<"accepted" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
        proposalId: import("convex/values").VString<string, "required">;
    }, "required", "approvalId" | "commentHash" | "decision" | "proposalId">, "required">;
    artifactIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
    artifactBindings: import("convex/values").VArray<{
        artifactId: string;
        canonicalVersion: number;
        contentHash: string;
    }[], import("convex/values").VObject<{
        artifactId: string;
        canonicalVersion: number;
        contentHash: string;
    }, {
        artifactId: import("convex/values").VString<string, "required">;
        canonicalVersion: import("convex/values").VFloat64<number, "required">;
        contentHash: import("convex/values").VString<string, "required">;
    }, "required", "artifactId" | "canonicalVersion" | "contentHash">, "required">;
    caseHash: import("convex/values").VString<string, "required">;
    caseId: import("convex/values").VString<string, "required">;
    eventIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
    eventBindings: import("convex/values").VArray<{
        actorHash: string;
        aggregateId: string;
        aggregateType: string;
        eventId: string;
        eventType: string;
        payloadHash: string;
        sequence: number;
    }[], import("convex/values").VObject<{
        actorHash: string;
        aggregateId: string;
        aggregateType: string;
        eventId: string;
        eventType: string;
        payloadHash: string;
        sequence: number;
    }, {
        actorHash: import("convex/values").VString<string, "required">;
        aggregateId: import("convex/values").VString<string, "required">;
        aggregateType: import("convex/values").VString<string, "required">;
        eventId: import("convex/values").VString<string, "required">;
        eventType: import("convex/values").VString<string, "required">;
        payloadHash: import("convex/values").VString<string, "required">;
        sequence: import("convex/values").VFloat64<number, "required">;
    }, "required", "actorHash" | "aggregateId" | "aggregateType" | "eventId" | "eventType" | "payloadHash" | "sequence">, "required">;
    generatedAt: import("convex/values").VString<string, "required">;
    proposalIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
    proposalBindings: import("convex/values").VArray<{
        artifactId: string;
        baseVersion: number;
        patchHash: string;
        proposalId: string;
        status: "accepted" | "conflicted" | "pending" | "rejected";
    }[], import("convex/values").VObject<{
        artifactId: string;
        baseVersion: number;
        patchHash: string;
        proposalId: string;
        status: "accepted" | "conflicted" | "pending" | "rejected";
    }, {
        artifactId: import("convex/values").VString<string, "required">;
        baseVersion: import("convex/values").VFloat64<number, "required">;
        patchHash: import("convex/values").VString<string, "required">;
        proposalId: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"accepted" | "conflicted" | "pending" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"conflicted", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
    }, "required", "artifactId" | "baseVersion" | "patchHash" | "proposalId" | "status">, "required">;
    receiptHash: import("convex/values").VString<string, "required">;
    receiptId: import("convex/values").VString<string, "required">;
    runHash: import("convex/values").VString<string, "required">;
    runId: import("convex/values").VString<string, "required">;
    schemaVersion: import("convex/values").VLiteral<"nodekit.receipt/v2", "required">;
    status: import("convex/values").VUnion<"cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
}, "required", "approvalBindings" | "artifactBindings" | "artifactIds" | "caseHash" | "caseId" | "eventBindings" | "eventIds" | "generatedAt" | "proposalBindings" | "proposalIds" | "receiptHash" | "receiptId" | "runHash" | "runId" | "schemaVersion" | "status">;
export declare const eventValidator: import("convex/values").VObject<{
    actor: {
        id: string;
        type: string;
    };
    aggregateId: string;
    aggregateType: string;
    eventId: string;
    eventType: string;
    occurredAt: string;
    payload: any;
    schemaVersion: "nodekit.caseflow-event/v1";
    sequence: number;
}, {
    actor: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        id: import("convex/values").VString<string, "required">;
        type: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    aggregateId: import("convex/values").VString<string, "required">;
    aggregateType: import("convex/values").VString<string, "required">;
    eventId: import("convex/values").VString<string, "required">;
    eventType: import("convex/values").VString<string, "required">;
    occurredAt: import("convex/values").VString<string, "required">;
    payload: import("convex/values").VAny<any, "required", string>;
    schemaVersion: import("convex/values").VLiteral<"nodekit.caseflow-event/v1", "required">;
    sequence: import("convex/values").VFloat64<number, "required">;
}, "required", "actor" | "actor.id" | "actor.type" | "aggregateId" | "aggregateType" | "eventId" | "eventType" | "occurredAt" | "payload" | "schemaVersion" | "sequence" | `payload.${string}`>;
export declare const proposalDecisionValidator: import("convex/values").VObject<{
    approval: {
        approvalId: string;
        comment: string;
        decidedAt: string;
        decision: "accepted" | "rejected";
        proposalId: string;
        schemaVersion: "nodekit.approval/v1";
    };
    artifact: {
        artifactId: string;
        canonicalVersion: number;
        caseId: string;
        createdAt: string;
        kind: string;
        runId: string;
        schemaVersion: "nodekit.artifact/v1";
        title: string;
        updatedAt: string;
        versions: {
            content: any;
            contentHash: string;
            createdAt: string;
            proposalId?: string;
            version: number;
        }[];
    };
    proposal: {
        artifactId: string;
        baseVersion: number;
        createdAt: string;
        patch: any;
        proposalId: string;
        rationale: string;
        schemaVersion: "nodekit.proposal/v1";
        status: "accepted" | "conflicted" | "pending" | "rejected";
    };
    reused: boolean;
}, {
    approval: import("convex/values").VObject<{
        approvalId: string;
        comment: string;
        decidedAt: string;
        decision: "accepted" | "rejected";
        proposalId: string;
        schemaVersion: "nodekit.approval/v1";
    }, {
        approvalId: import("convex/values").VString<string, "required">;
        comment: import("convex/values").VString<string, "required">;
        decidedAt: import("convex/values").VString<string, "required">;
        decision: import("convex/values").VUnion<"accepted" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
        proposalId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.approval/v1", "required">;
    }, "required", "approvalId" | "comment" | "decidedAt" | "decision" | "proposalId" | "schemaVersion">;
    artifact: import("convex/values").VObject<{
        artifactId: string;
        canonicalVersion: number;
        caseId: string;
        createdAt: string;
        kind: string;
        runId: string;
        schemaVersion: "nodekit.artifact/v1";
        title: string;
        updatedAt: string;
        versions: {
            content: any;
            contentHash: string;
            createdAt: string;
            proposalId?: string;
            version: number;
        }[];
    }, {
        artifactId: import("convex/values").VString<string, "required">;
        canonicalVersion: import("convex/values").VFloat64<number, "required">;
        caseId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.artifact/v1", "required">;
        title: import("convex/values").VString<string, "required">;
        updatedAt: import("convex/values").VString<string, "required">;
        versions: import("convex/values").VArray<{
            content: any;
            contentHash: string;
            createdAt: string;
            proposalId?: string;
            version: number;
        }[], import("convex/values").VObject<{
            content: any;
            contentHash: string;
            createdAt: string;
            proposalId?: string;
            version: number;
        }, {
            content: import("convex/values").VAny<any, "required", string>;
            contentHash: import("convex/values").VString<string, "required">;
            createdAt: import("convex/values").VString<string, "required">;
            proposalId: import("convex/values").VString<string | undefined, "optional">;
            version: import("convex/values").VFloat64<number, "required">;
        }, "required", "content" | "contentHash" | "createdAt" | "proposalId" | "version" | `content.${string}`>, "required">;
    }, "required", "artifactId" | "canonicalVersion" | "caseId" | "createdAt" | "kind" | "runId" | "schemaVersion" | "title" | "updatedAt" | "versions">;
    proposal: import("convex/values").VObject<{
        artifactId: string;
        baseVersion: number;
        createdAt: string;
        patch: any;
        proposalId: string;
        rationale: string;
        schemaVersion: "nodekit.proposal/v1";
        status: "accepted" | "conflicted" | "pending" | "rejected";
    }, {
        artifactId: import("convex/values").VString<string, "required">;
        baseVersion: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        patch: import("convex/values").VAny<any, "required", string>;
        proposalId: import("convex/values").VString<string, "required">;
        rationale: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.proposal/v1", "required">;
        status: import("convex/values").VUnion<"accepted" | "conflicted" | "pending" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"conflicted", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
    }, "required", "artifactId" | "baseVersion" | "createdAt" | "patch" | "proposalId" | "rationale" | "schemaVersion" | "status" | `patch.${string}`>;
    reused: import("convex/values").VBoolean<boolean, "required">;
}, "required", "approval" | "approval.approvalId" | "approval.comment" | "approval.decidedAt" | "approval.decision" | "approval.proposalId" | "approval.schemaVersion" | "artifact" | "artifact.artifactId" | "artifact.canonicalVersion" | "artifact.caseId" | "artifact.createdAt" | "artifact.kind" | "artifact.runId" | "artifact.schemaVersion" | "artifact.title" | "artifact.updatedAt" | "artifact.versions" | "proposal" | "proposal.artifactId" | "proposal.baseVersion" | "proposal.createdAt" | "proposal.patch" | "proposal.proposalId" | "proposal.rationale" | "proposal.schemaVersion" | "proposal.status" | "reused" | `proposal.patch.${string}`>;
export declare const exceptionResolutionValidator: import("convex/values").VObject<{
    exception: {
        code: string;
        exceptionId: string;
        message: string;
        preservedState: any;
        raisedAt: string;
        resolution: string | null;
        resolvedAt?: string;
        runId: string;
        schemaVersion: "nodekit.exception/v1";
        status: "open" | "resolved";
    };
    run: {
        caseId: string;
        createdAt: string;
        currentStageId: string;
        nextAction: string;
        nextActionOwner: string;
        runId: string;
        schemaVersion: "nodekit.run/v1";
        stages: {
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[];
        status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
        updatedAt: string;
    };
}, {
    exception: import("convex/values").VObject<{
        code: string;
        exceptionId: string;
        message: string;
        preservedState: any;
        raisedAt: string;
        resolution: string | null;
        resolvedAt?: string;
        runId: string;
        schemaVersion: "nodekit.exception/v1";
        status: "open" | "resolved";
    }, {
        code: import("convex/values").VString<string, "required">;
        exceptionId: import("convex/values").VString<string, "required">;
        message: import("convex/values").VString<string, "required">;
        preservedState: import("convex/values").VAny<any, "required", string>;
        raisedAt: import("convex/values").VString<string, "required">;
        resolution: import("convex/values").VUnion<string | null, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "required", never>;
        resolvedAt: import("convex/values").VString<string | undefined, "optional">;
        runId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.exception/v1", "required">;
        status: import("convex/values").VUnion<"open" | "resolved", [import("convex/values").VLiteral<"open", "required">, import("convex/values").VLiteral<"resolved", "required">], "required", never>;
    }, "required", "code" | "exceptionId" | "message" | "preservedState" | "raisedAt" | "resolution" | "resolvedAt" | "runId" | "schemaVersion" | "status" | `preservedState.${string}`>;
    run: import("convex/values").VObject<{
        caseId: string;
        createdAt: string;
        currentStageId: string;
        nextAction: string;
        nextActionOwner: string;
        runId: string;
        schemaVersion: "nodekit.run/v1";
        stages: {
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[];
        status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
        updatedAt: string;
    }, {
        caseId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        currentStageId: import("convex/values").VString<string, "required">;
        nextAction: import("convex/values").VString<string, "required">;
        nextActionOwner: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.run/v1", "required">;
        stages: import("convex/values").VArray<{
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[], import("convex/values").VObject<{
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }, {
            id: import("convex/values").VString<string, "required">;
            label: import("convex/values").VString<string, "required">;
            owner: import("convex/values").VString<string, "required">;
            status: import("convex/values").VUnion<"active" | "completed" | "pending", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"pending", "required">], "required", never>;
        }, "required", "id" | "label" | "owner" | "status">, "required">;
        status: import("convex/values").VUnion<"active" | "blocked" | "cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"blocked", "required">, import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
        updatedAt: import("convex/values").VString<string, "required">;
    }, "required", "caseId" | "createdAt" | "currentStageId" | "nextAction" | "nextActionOwner" | "runId" | "schemaVersion" | "stages" | "status" | "updatedAt">;
}, "required", "exception" | "exception.code" | "exception.exceptionId" | "exception.message" | "exception.preservedState" | "exception.raisedAt" | "exception.resolution" | "exception.resolvedAt" | "exception.runId" | "exception.schemaVersion" | "exception.status" | "run" | "run.caseId" | "run.createdAt" | "run.currentStageId" | "run.nextAction" | "run.nextActionOwner" | "run.runId" | "run.schemaVersion" | "run.stages" | "run.status" | "run.updatedAt" | `exception.preservedState.${string}`>;
export declare const completionValidator: import("convex/values").VObject<{
    receipt: {
        approvalBindings: {
            approvalId: string;
            commentHash: string;
            decision: "accepted" | "rejected";
            proposalId: string;
        }[];
        artifactBindings: {
            artifactId: string;
            canonicalVersion: number;
            contentHash: string;
        }[];
        artifactIds: string[];
        caseHash: string;
        caseId: string;
        eventBindings: {
            actorHash: string;
            aggregateId: string;
            aggregateType: string;
            eventId: string;
            eventType: string;
            payloadHash: string;
            sequence: number;
        }[];
        eventIds: string[];
        generatedAt: string;
        proposalBindings: {
            artifactId: string;
            baseVersion: number;
            patchHash: string;
            proposalId: string;
            status: "accepted" | "conflicted" | "pending" | "rejected";
        }[];
        proposalIds: string[];
        receiptHash: string;
        receiptId: string;
        runHash: string;
        runId: string;
        schemaVersion: "nodekit.receipt/v2";
        status: "cancelled" | "completed" | "failed_safely";
    };
    reused: boolean;
    run: {
        caseId: string;
        createdAt: string;
        currentStageId: string;
        nextAction: string;
        nextActionOwner: string;
        runId: string;
        schemaVersion: "nodekit.run/v1";
        stages: {
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[];
        status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
        updatedAt: string;
    };
}, {
    receipt: import("convex/values").VObject<{
        approvalBindings: {
            approvalId: string;
            commentHash: string;
            decision: "accepted" | "rejected";
            proposalId: string;
        }[];
        artifactBindings: {
            artifactId: string;
            canonicalVersion: number;
            contentHash: string;
        }[];
        artifactIds: string[];
        caseHash: string;
        caseId: string;
        eventBindings: {
            actorHash: string;
            aggregateId: string;
            aggregateType: string;
            eventId: string;
            eventType: string;
            payloadHash: string;
            sequence: number;
        }[];
        eventIds: string[];
        generatedAt: string;
        proposalBindings: {
            artifactId: string;
            baseVersion: number;
            patchHash: string;
            proposalId: string;
            status: "accepted" | "conflicted" | "pending" | "rejected";
        }[];
        proposalIds: string[];
        receiptHash: string;
        receiptId: string;
        runHash: string;
        runId: string;
        schemaVersion: "nodekit.receipt/v2";
        status: "cancelled" | "completed" | "failed_safely";
    }, {
        approvalBindings: import("convex/values").VArray<{
            approvalId: string;
            commentHash: string;
            decision: "accepted" | "rejected";
            proposalId: string;
        }[], import("convex/values").VObject<{
            approvalId: string;
            commentHash: string;
            decision: "accepted" | "rejected";
            proposalId: string;
        }, {
            approvalId: import("convex/values").VString<string, "required">;
            commentHash: import("convex/values").VString<string, "required">;
            decision: import("convex/values").VUnion<"accepted" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
            proposalId: import("convex/values").VString<string, "required">;
        }, "required", "approvalId" | "commentHash" | "decision" | "proposalId">, "required">;
        artifactIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
        artifactBindings: import("convex/values").VArray<{
            artifactId: string;
            canonicalVersion: number;
            contentHash: string;
        }[], import("convex/values").VObject<{
            artifactId: string;
            canonicalVersion: number;
            contentHash: string;
        }, {
            artifactId: import("convex/values").VString<string, "required">;
            canonicalVersion: import("convex/values").VFloat64<number, "required">;
            contentHash: import("convex/values").VString<string, "required">;
        }, "required", "artifactId" | "canonicalVersion" | "contentHash">, "required">;
        caseHash: import("convex/values").VString<string, "required">;
        caseId: import("convex/values").VString<string, "required">;
        eventIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
        eventBindings: import("convex/values").VArray<{
            actorHash: string;
            aggregateId: string;
            aggregateType: string;
            eventId: string;
            eventType: string;
            payloadHash: string;
            sequence: number;
        }[], import("convex/values").VObject<{
            actorHash: string;
            aggregateId: string;
            aggregateType: string;
            eventId: string;
            eventType: string;
            payloadHash: string;
            sequence: number;
        }, {
            actorHash: import("convex/values").VString<string, "required">;
            aggregateId: import("convex/values").VString<string, "required">;
            aggregateType: import("convex/values").VString<string, "required">;
            eventId: import("convex/values").VString<string, "required">;
            eventType: import("convex/values").VString<string, "required">;
            payloadHash: import("convex/values").VString<string, "required">;
            sequence: import("convex/values").VFloat64<number, "required">;
        }, "required", "actorHash" | "aggregateId" | "aggregateType" | "eventId" | "eventType" | "payloadHash" | "sequence">, "required">;
        generatedAt: import("convex/values").VString<string, "required">;
        proposalIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
        proposalBindings: import("convex/values").VArray<{
            artifactId: string;
            baseVersion: number;
            patchHash: string;
            proposalId: string;
            status: "accepted" | "conflicted" | "pending" | "rejected";
        }[], import("convex/values").VObject<{
            artifactId: string;
            baseVersion: number;
            patchHash: string;
            proposalId: string;
            status: "accepted" | "conflicted" | "pending" | "rejected";
        }, {
            artifactId: import("convex/values").VString<string, "required">;
            baseVersion: import("convex/values").VFloat64<number, "required">;
            patchHash: import("convex/values").VString<string, "required">;
            proposalId: import("convex/values").VString<string, "required">;
            status: import("convex/values").VUnion<"accepted" | "conflicted" | "pending" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"conflicted", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
        }, "required", "artifactId" | "baseVersion" | "patchHash" | "proposalId" | "status">, "required">;
        receiptHash: import("convex/values").VString<string, "required">;
        receiptId: import("convex/values").VString<string, "required">;
        runHash: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.receipt/v2", "required">;
        status: import("convex/values").VUnion<"cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
    }, "required", "approvalBindings" | "artifactBindings" | "artifactIds" | "caseHash" | "caseId" | "eventBindings" | "eventIds" | "generatedAt" | "proposalBindings" | "proposalIds" | "receiptHash" | "receiptId" | "runHash" | "runId" | "schemaVersion" | "status">;
    reused: import("convex/values").VBoolean<boolean, "required">;
    run: import("convex/values").VObject<{
        caseId: string;
        createdAt: string;
        currentStageId: string;
        nextAction: string;
        nextActionOwner: string;
        runId: string;
        schemaVersion: "nodekit.run/v1";
        stages: {
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[];
        status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
        updatedAt: string;
    }, {
        caseId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        currentStageId: import("convex/values").VString<string, "required">;
        nextAction: import("convex/values").VString<string, "required">;
        nextActionOwner: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        schemaVersion: import("convex/values").VLiteral<"nodekit.run/v1", "required">;
        stages: import("convex/values").VArray<{
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[], import("convex/values").VObject<{
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }, {
            id: import("convex/values").VString<string, "required">;
            label: import("convex/values").VString<string, "required">;
            owner: import("convex/values").VString<string, "required">;
            status: import("convex/values").VUnion<"active" | "completed" | "pending", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"pending", "required">], "required", never>;
        }, "required", "id" | "label" | "owner" | "status">, "required">;
        status: import("convex/values").VUnion<"active" | "blocked" | "cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"blocked", "required">, import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
        updatedAt: import("convex/values").VString<string, "required">;
    }, "required", "caseId" | "createdAt" | "currentStageId" | "nextAction" | "nextActionOwner" | "runId" | "schemaVersion" | "stages" | "status" | "updatedAt">;
}, "required", "receipt" | "receipt.approvalBindings" | "receipt.artifactBindings" | "receipt.artifactIds" | "receipt.caseHash" | "receipt.caseId" | "receipt.eventBindings" | "receipt.eventIds" | "receipt.generatedAt" | "receipt.proposalBindings" | "receipt.proposalIds" | "receipt.receiptHash" | "receipt.receiptId" | "receipt.runHash" | "receipt.runId" | "receipt.schemaVersion" | "receipt.status" | "reused" | "run" | "run.caseId" | "run.createdAt" | "run.currentStageId" | "run.nextAction" | "run.nextActionOwner" | "run.runId" | "run.schemaVersion" | "run.stages" | "run.status" | "run.updatedAt">;
//# sourceMappingURL=validators.d.ts.map