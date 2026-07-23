declare const _default: import("convex/server").SchemaDefinition<{
    cases: import("convex/server").TableDefinition<import("convex/values").VObject<{
        caseId: string;
        createdAt: string;
        currentRunId?: string;
        primaryJob: string;
        scopeKey: string;
        status: "completed" | "in_progress" | "ready";
        title: string;
        updatedAt: string;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        caseId: import("convex/values").VString<string, "required">;
        title: import("convex/values").VString<string, "required">;
        primaryJob: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"completed" | "in_progress" | "ready", [import("convex/values").VLiteral<"ready", "required">, import("convex/values").VLiteral<"in_progress", "required">, import("convex/values").VLiteral<"completed", "required">], "required", never>;
        currentRunId: import("convex/values").VString<string | undefined, "optional">;
        createdAt: import("convex/values").VString<string, "required">;
        updatedAt: import("convex/values").VString<string, "required">;
    }, "required", "caseId" | "createdAt" | "currentRunId" | "primaryJob" | "scopeKey" | "status" | "title" | "updatedAt">, {
        by_scope: ["scopeKey", "_creationTime"];
        by_scope_id: ["scopeKey", "caseId", "_creationTime"];
        by_scope_status: ["scopeKey", "status", "_creationTime"];
    }, {}, {}>;
    runs: import("convex/server").TableDefinition<import("convex/values").VObject<{
        caseId: string;
        createdAt: string;
        currentStageId: string;
        nextAction: string;
        nextActionOwner: string;
        runId: string;
        scopeKey: string;
        stages: {
            id: string;
            label: string;
            owner: string;
            status: "active" | "completed" | "pending";
        }[];
        status: "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
        updatedAt: string;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        caseId: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"active" | "blocked" | "cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"blocked", "required">, import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
        currentStageId: import("convex/values").VString<string, "required">;
        nextAction: import("convex/values").VString<string, "required">;
        nextActionOwner: import("convex/values").VString<string, "required">;
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
        createdAt: import("convex/values").VString<string, "required">;
        updatedAt: import("convex/values").VString<string, "required">;
    }, "required", "caseId" | "createdAt" | "currentStageId" | "nextAction" | "nextActionOwner" | "runId" | "scopeKey" | "stages" | "status" | "updatedAt">, {
        by_scope_case: ["scopeKey", "caseId", "_creationTime"];
        by_scope_id: ["scopeKey", "runId", "_creationTime"];
        by_scope_status: ["scopeKey", "status", "_creationTime"];
    }, {}, {}>;
    artifacts: import("convex/server").TableDefinition<import("convex/values").VObject<{
        artifactId: string;
        canonicalVersion: number;
        caseId: string;
        createdAt: string;
        kind: string;
        runId: string;
        scopeKey: string;
        title: string;
        updatedAt: string;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        artifactId: import("convex/values").VString<string, "required">;
        caseId: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VString<string, "required">;
        title: import("convex/values").VString<string, "required">;
        canonicalVersion: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        updatedAt: import("convex/values").VString<string, "required">;
    }, "required", "artifactId" | "canonicalVersion" | "caseId" | "createdAt" | "kind" | "runId" | "scopeKey" | "title" | "updatedAt">, {
        by_scope_case: ["scopeKey", "caseId", "_creationTime"];
        by_scope_id: ["scopeKey", "artifactId", "_creationTime"];
        by_scope_run: ["scopeKey", "runId", "_creationTime"];
    }, {}, {}>;
    artifactVersions: import("convex/server").TableDefinition<import("convex/values").VObject<{
        artifactId: string;
        content: any;
        contentHash: string;
        createdAt: string;
        proposalId?: string;
        scopeKey: string;
        version: number;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        artifactId: import("convex/values").VString<string, "required">;
        version: import("convex/values").VFloat64<number, "required">;
        content: import("convex/values").VAny<any, "required", string>;
        contentHash: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VString<string, "required">;
        proposalId: import("convex/values").VString<string | undefined, "optional">;
    }, "required", "artifactId" | "content" | "contentHash" | "createdAt" | "proposalId" | "scopeKey" | "version" | `content.${string}`>, {
        by_scope_artifact_version: ["scopeKey", "artifactId", "version", "_creationTime"];
    }, {}, {}>;
    proposals: import("convex/server").TableDefinition<import("convex/values").VObject<{
        artifactId: string;
        baseVersion: number;
        createdAt: string;
        patch: any;
        proposalId: string;
        rationale: string;
        scopeKey: string;
        status: "accepted" | "conflicted" | "pending" | "rejected";
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        proposalId: import("convex/values").VString<string, "required">;
        artifactId: import("convex/values").VString<string, "required">;
        baseVersion: import("convex/values").VFloat64<number, "required">;
        patch: import("convex/values").VAny<any, "required", string>;
        rationale: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"accepted" | "conflicted" | "pending" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"conflicted", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
        createdAt: import("convex/values").VString<string, "required">;
    }, "required", "artifactId" | "baseVersion" | "createdAt" | "patch" | "proposalId" | "rationale" | "scopeKey" | "status" | `patch.${string}`>, {
        by_scope_artifact: ["scopeKey", "artifactId", "_creationTime"];
        by_scope_id: ["scopeKey", "proposalId", "_creationTime"];
        by_scope_status: ["scopeKey", "status", "_creationTime"];
    }, {}, {}>;
    approvals: import("convex/server").TableDefinition<import("convex/values").VObject<{
        approvalId: string;
        comment: string;
        decidedAt: string;
        decision: "accepted" | "rejected";
        proposalId: string;
        scopeKey: string;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        approvalId: import("convex/values").VString<string, "required">;
        proposalId: import("convex/values").VString<string, "required">;
        decision: import("convex/values").VUnion<"accepted" | "rejected", [import("convex/values").VLiteral<"accepted", "required">, import("convex/values").VLiteral<"rejected", "required">], "required", never>;
        comment: import("convex/values").VString<string, "required">;
        decidedAt: import("convex/values").VString<string, "required">;
    }, "required", "approvalId" | "comment" | "decidedAt" | "decision" | "proposalId" | "scopeKey">, {
        by_scope_id: ["scopeKey", "approvalId", "_creationTime"];
        by_scope_proposal: ["scopeKey", "proposalId", "_creationTime"];
    }, {}, {}>;
    exceptions: import("convex/server").TableDefinition<import("convex/values").VObject<{
        code: string;
        exceptionId: string;
        message: string;
        preservedState: any;
        raisedAt: string;
        resolution?: string;
        resolvedAt?: string;
        runId: string;
        scopeKey: string;
        status: "open" | "resolved";
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        exceptionId: import("convex/values").VString<string, "required">;
        runId: import("convex/values").VString<string, "required">;
        code: import("convex/values").VString<string, "required">;
        message: import("convex/values").VString<string, "required">;
        preservedState: import("convex/values").VAny<any, "required", string>;
        status: import("convex/values").VUnion<"open" | "resolved", [import("convex/values").VLiteral<"open", "required">, import("convex/values").VLiteral<"resolved", "required">], "required", never>;
        resolution: import("convex/values").VString<string | undefined, "optional">;
        raisedAt: import("convex/values").VString<string, "required">;
        resolvedAt: import("convex/values").VString<string | undefined, "optional">;
    }, "required", "code" | "exceptionId" | "message" | "preservedState" | "raisedAt" | "resolution" | "resolvedAt" | "runId" | "scopeKey" | "status" | `preservedState.${string}`>, {
        by_scope_id: ["scopeKey", "exceptionId", "_creationTime"];
        by_scope_run: ["scopeKey", "runId", "_creationTime"];
        by_scope_status: ["scopeKey", "status", "_creationTime"];
    }, {}, {}>;
    receipts: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
        scopeKey: string;
        status: "cancelled" | "completed" | "failed_safely";
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        receiptId: import("convex/values").VString<string, "required">;
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
        runId: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"cancelled" | "completed" | "failed_safely", [import("convex/values").VLiteral<"cancelled", "required">, import("convex/values").VLiteral<"completed", "required">, import("convex/values").VLiteral<"failed_safely", "required">], "required", never>;
        artifactIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
        proposalIds: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">;
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
        runHash: import("convex/values").VString<string, "required">;
    }, "required", "approvalBindings" | "artifactBindings" | "artifactIds" | "caseHash" | "caseId" | "eventBindings" | "eventIds" | "generatedAt" | "proposalBindings" | "proposalIds" | "receiptHash" | "receiptId" | "runHash" | "runId" | "scopeKey" | "status">, {
        by_scope_id: ["scopeKey", "receiptId", "_creationTime"];
        by_scope_run: ["scopeKey", "runId", "_creationTime"];
    }, {}, {}>;
    timelineEvents: import("convex/server").TableDefinition<import("convex/values").VObject<{
        actor: {
            id: string;
            type: string;
        };
        aggregateId: string;
        aggregateType: string;
        eventId: string;
        eventType: string;
        idempotencyKey?: string;
        idempotencyResult?: any;
        occurredAt: string;
        payload: any;
        requestHash?: string;
        scopeKey: string;
        sequence: number;
    }, {
        scopeKey: import("convex/values").VString<string, "required">;
        eventId: import("convex/values").VString<string, "required">;
        aggregateType: import("convex/values").VString<string, "required">;
        aggregateId: import("convex/values").VString<string, "required">;
        eventType: import("convex/values").VString<string, "required">;
        idempotencyKey: import("convex/values").VString<string | undefined, "optional">;
        idempotencyResult: import("convex/values").VAny<any, "optional", string>;
        actor: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            id: import("convex/values").VString<string, "required">;
            type: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payload: import("convex/values").VAny<any, "required", string>;
        requestHash: import("convex/values").VString<string | undefined, "optional">;
        occurredAt: import("convex/values").VString<string, "required">;
        sequence: import("convex/values").VFloat64<number, "required">;
    }, "required", "actor" | "actor.id" | "actor.type" | "aggregateId" | "aggregateType" | "eventId" | "eventType" | "idempotencyKey" | "idempotencyResult" | "occurredAt" | "payload" | "requestHash" | "scopeKey" | "sequence" | `idempotencyResult.${string}` | `payload.${string}`>, {
        by_scope_aggregate: ["scopeKey", "aggregateType", "aggregateId", "sequence", "_creationTime"];
        by_scope_id: ["scopeKey", "eventId", "_creationTime"];
        by_scope_idempotency: ["scopeKey", "idempotencyKey", "_creationTime"];
    }, {}, {}>;
}, true>;
export default _default;
//# sourceMappingURL=schema.d.ts.map