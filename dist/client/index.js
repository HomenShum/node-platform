import { contentHash } from "../component/hash.js";
import { PORTABLE_VALUE_LIMITS, normalizePortableValue } from "../lib/portable-value.mjs";
/**
 * Typed host-side bridge to the isolated NodeKit Caseflow component.
 *
 * This client deliberately does not authenticate callers. Host Convex
 * functions must authenticate and authorize first, derive an opaque scopeKey,
 * and then pass it to these methods. This preserves the component sandbox and
 * keeps auth-provider and organization-role policy in the application.
 */
export class NodeKitCaseflowClient {
    component;
    constructor(component) {
        this.component = component;
    }
    createCase(ctx, args) {
        return ctx.runMutation(this.component.caseflow.createCase, args);
    }
    updateCaseInput(ctx, args) {
        return ctx.runMutation(this.component.caseflow.updateCaseInput, args);
    }
    startRun(ctx, args) {
        return ctx.runMutation(this.component.caseflow.startRun, args);
    }
    enterStage(ctx, args) {
        return ctx.runMutation(this.component.caseflow.enterStage, args);
    }
    createArtifact(ctx, args) {
        const content = normalizePortableValue(args.content, "content", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        return ctx.runMutation(this.component.caseflow.createArtifact, {
            ...args,
            content,
            contentHash: contentHash(content),
        });
    }
    createProposal(ctx, args) {
        const patch = normalizePortableValue(args.patch, "patch", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        return ctx.runMutation(this.component.caseflow.createProposal, {
            ...args,
            patch,
            patchHash: contentHash(patch),
        });
    }
    decideProposal(ctx, args) {
        return ctx.runMutation(this.component.caseflow.decideProposal, args);
    }
    raiseException(ctx, args) {
        const preservedState = normalizePortableValue(args.preservedState ?? {}, "preservedState", {
            maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        });
        return ctx.runMutation(this.component.caseflow.raiseException, {
            ...args,
            preservedState,
            preservedStateHash: contentHash(preservedState),
        });
    }
    resolveException(ctx, args) {
        return ctx.runMutation(this.component.caseflow.resolveException, args);
    }
    completeRun(ctx, args) {
        return ctx.runMutation(this.component.caseflow.completeRun, args);
    }
    cancelRun(ctx, args) {
        return ctx.runMutation(this.component.caseflow.cancelRun, args);
    }
    failRunSafely(ctx, args) {
        return ctx.runMutation(this.component.caseflow.failRunSafely, args);
    }
    getCase(ctx, args) {
        return ctx.runQuery(this.component.caseflow.getCase, args);
    }
    getRun(ctx, args) {
        return ctx.runQuery(this.component.caseflow.getRun, args);
    }
    getArtifact(ctx, args) {
        return ctx.runQuery(this.component.caseflow.getArtifact, args);
    }
    getReceiptForRun(ctx, args) {
        return ctx.runQuery(this.component.caseflow.getReceiptForRun, args);
    }
    getTimeline(ctx, args) {
        return ctx.runQuery(this.component.caseflow.getTimeline, args);
    }
    listPendingApprovals(ctx, args) {
        return ctx.runQuery(this.component.caseflow.listPendingApprovals, args);
    }
}
export function createNodeKitCaseflowClient(component) {
    return new NodeKitCaseflowClient(component);
}
//# sourceMappingURL=index.js.map