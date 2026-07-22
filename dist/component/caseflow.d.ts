export declare const createCase: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    primaryJob: string;
    scopeKey: string;
    title: string;
}, Promise<{
    caseId: string;
    createdAt: string;
    currentRunId: string | null;
    primaryJob: string;
    schemaVersion: "nodekit.case/v1";
    status: "completed" | "in_progress" | "ready";
    title: string;
    updatedAt: string;
}>>;
export declare const updateCaseInput: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    caseId: string;
    primaryJob?: string;
    scopeKey: string;
    title?: string;
}, Promise<{
    caseId: string;
    createdAt: string;
    currentRunId: string | null;
    primaryJob: string;
    schemaVersion: "nodekit.case/v1";
    status: "completed" | "in_progress" | "ready";
    title: string;
    updatedAt: string;
}>>;
export declare const startRun: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    caseId: string;
    scopeKey: string;
    stages: {
        id: string;
        label: string;
        owner: string;
    }[];
}, Promise<{
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
}>>;
export declare const enterStage: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    idempotencyKey?: string;
    nextAction?: string;
    nextActionOwner?: string;
    runId: string;
    scopeKey: string;
    stageId: string;
}, Promise<{
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
}>>;
export declare const createArtifact: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    caseId: string;
    content: any;
    contentHash: string;
    idempotencyKey?: string;
    kind?: string;
    runId: string;
    scopeKey: string;
    title?: string;
}, Promise<{
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
}>>;
export declare const createProposal: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    artifactId: string;
    baseVersion: number;
    idempotencyKey?: string;
    patch: any;
    patchHash: string;
    rationale?: string;
    scopeKey: string;
}, Promise<{
    artifactId: string;
    baseVersion: number;
    createdAt: string;
    patch: any;
    proposalId: string;
    rationale: string;
    schemaVersion: "nodekit.proposal/v1";
    status: "accepted" | "conflicted" | "pending" | "rejected";
}>>;
export declare const decideProposal: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    comment?: string;
    decision: "accepted" | "rejected";
    proposalId: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const raiseException: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    code?: string;
    idempotencyKey?: string;
    message?: string;
    preservedState?: any;
    preservedStateHash: string;
    runId: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const resolveException: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    exceptionId: string;
    nextAction?: string;
    nextActionOwner?: string;
    resolution?: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const completeRun: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    runId: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const cancelRun: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    reason?: string;
    runId: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const failRunSafely: import("convex/server").RegisteredMutation<"public", {
    actor?: {
        id: string;
        type: string;
    };
    reason?: string;
    runId: string;
    scopeKey: string;
}, Promise<{
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
}>>;
export declare const getCase: import("convex/server").RegisteredQuery<"public", {
    caseId: string;
    scopeKey: string;
}, Promise<{
    caseId: string;
    createdAt: string;
    currentRunId: string | null;
    primaryJob: string;
    schemaVersion: "nodekit.case/v1";
    status: "completed" | "in_progress" | "ready";
    title: string;
    updatedAt: string;
} | null>>;
export declare const getRun: import("convex/server").RegisteredQuery<"public", {
    runId: string;
    scopeKey: string;
}, Promise<{
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
} | null>>;
export declare const getArtifact: import("convex/server").RegisteredQuery<"public", {
    artifactId: string;
    scopeKey: string;
}, Promise<{
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
} | null>>;
export declare const getReceiptForRun: import("convex/server").RegisteredQuery<"public", {
    runId: string;
    scopeKey: string;
}, Promise<{
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
} | null>>;
export declare const getTimeline: import("convex/server").RegisteredQuery<"public", {
    aggregateId: string;
    aggregateType: string;
    limit?: number;
    scopeKey: string;
}, Promise<{
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
}[]>>;
export declare const listPendingApprovals: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    scopeKey: string;
}, Promise<{
    artifactId: string;
    baseVersion: number;
    createdAt: string;
    patch: any;
    proposalId: string;
    rationale: string;
    schemaVersion: "nodekit.proposal/v1";
    status: "accepted" | "conflicted" | "pending" | "rejected";
}[]>>;
//# sourceMappingURL=caseflow.d.ts.map