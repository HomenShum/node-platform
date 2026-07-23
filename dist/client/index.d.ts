import type { FunctionArgs, GenericDataModel, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type Api = ComponentApi["caseflow"];
type Args<Name extends keyof Api> = FunctionArgs<Api[Name]>;
/**
 * Typed host-side bridge to the isolated NodeKit Caseflow component.
 *
 * This client deliberately does not authenticate callers. Host Convex
 * functions must authenticate and authorize first, derive an opaque scopeKey,
 * and then pass it to these methods. This preserves the component sandbox and
 * keeps auth-provider and organization-role policy in the application.
 */
export declare class NodeKitCaseflowClient {
    readonly component: ComponentApi;
    constructor(component: ComponentApi);
    createCase(ctx: MutationCtx, args: Args<"createCase">): Promise<import("../component/_generated/component.js").Case>;
    updateCaseInput(ctx: MutationCtx, args: Args<"updateCaseInput">): Promise<import("../component/_generated/component.js").Case>;
    startRun(ctx: MutationCtx, args: Args<"startRun">): Promise<import("../component/_generated/component.js").Run>;
    enterStage(ctx: MutationCtx, args: Args<"enterStage">): Promise<import("../component/_generated/component.js").Run>;
    createArtifact(ctx: MutationCtx, args: Omit<Args<"createArtifact">, "contentHash">): Promise<import("../component/_generated/component.js").Artifact>;
    createProposal(ctx: MutationCtx, args: Omit<Args<"createProposal">, "patchHash">): Promise<import("../component/_generated/component.js").Proposal>;
    decideProposal(ctx: MutationCtx, args: Args<"decideProposal">): Promise<{
        approval: import("../component/_generated/component.js").Approval;
        artifact: import("../component/_generated/component.js").Artifact;
        proposal: import("../component/_generated/component.js").Proposal;
        reused: boolean;
    }>;
    raiseException(ctx: MutationCtx, args: Omit<Args<"raiseException">, "preservedStateHash">): Promise<import("../component/_generated/component.js").Exception>;
    resolveException(ctx: MutationCtx, args: Args<"resolveException">): Promise<{
        exception: import("../component/_generated/component.js").Exception;
        run: import("../component/_generated/component.js").Run;
    }>;
    completeRun(ctx: MutationCtx, args: Args<"completeRun">): Promise<{
        receipt: import("../component/_generated/component.js").Receipt;
        reused: boolean;
        run: import("../component/_generated/component.js").Run;
    }>;
    cancelRun(ctx: MutationCtx, args: Args<"cancelRun">): Promise<{
        receipt: import("../component/_generated/component.js").Receipt;
        reused: boolean;
        run: import("../component/_generated/component.js").Run;
    }>;
    failRunSafely(ctx: MutationCtx, args: Args<"failRunSafely">): Promise<{
        receipt: import("../component/_generated/component.js").Receipt;
        reused: boolean;
        run: import("../component/_generated/component.js").Run;
    }>;
    getCase(ctx: QueryCtx, args: Args<"getCase">): Promise<import("../component/_generated/component.js").Case | null>;
    getRun(ctx: QueryCtx, args: Args<"getRun">): Promise<import("../component/_generated/component.js").Run | null>;
    getArtifact(ctx: QueryCtx, args: Args<"getArtifact">): Promise<import("../component/_generated/component.js").Artifact | null>;
    getReceiptForRun(ctx: QueryCtx, args: Args<"getReceiptForRun">): Promise<import("../component/_generated/component.js").Receipt | null>;
    getTimeline(ctx: QueryCtx, args: Args<"getTimeline">): Promise<import("../component/_generated/component.js").TimelineEvent[]>;
    listPendingApprovals(ctx: QueryCtx, args: Args<"listPendingApprovals">): Promise<import("../component/_generated/component.js").Proposal[]>;
}
export declare function createNodeKitCaseflowClient(component: ComponentApi): NodeKitCaseflowClient;
export type { ComponentApi } from "../component/_generated/component.js";
//# sourceMappingURL=index.d.ts.map