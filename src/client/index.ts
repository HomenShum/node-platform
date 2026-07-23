import type {
  FunctionArgs,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import type { ComponentApi } from "../component/_generated/component.js";
import { contentHash } from "../component/hash.js";
import { PORTABLE_VALUE_LIMITS, normalizePortableValue } from "../lib/portable-value.mjs";

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
export class NodeKitCaseflowClient {
  constructor(public readonly component: ComponentApi) {}

  createCase(ctx: MutationCtx, args: Args<"createCase">) {
    return ctx.runMutation(this.component.caseflow.createCase, args);
  }

  updateCaseInput(ctx: MutationCtx, args: Args<"updateCaseInput">) {
    return ctx.runMutation(this.component.caseflow.updateCaseInput, args);
  }

  startRun(ctx: MutationCtx, args: Args<"startRun">) {
    return ctx.runMutation(this.component.caseflow.startRun, args);
  }

  enterStage(ctx: MutationCtx, args: Args<"enterStage">) {
    return ctx.runMutation(this.component.caseflow.enterStage, args);
  }

  createArtifact(ctx: MutationCtx, args: Omit<Args<"createArtifact">, "contentHash">) {
    const content = normalizePortableValue(args.content, "content", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    return ctx.runMutation(this.component.caseflow.createArtifact, {
      ...args,
      content,
      contentHash: contentHash(content),
    });
  }

  createProposal(ctx: MutationCtx, args: Omit<Args<"createProposal">, "patchHash">) {
    const patch = normalizePortableValue(args.patch, "patch", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    return ctx.runMutation(this.component.caseflow.createProposal, {
      ...args,
      patch,
      patchHash: contentHash(patch),
    });
  }

  decideProposal(ctx: MutationCtx, args: Args<"decideProposal">) {
    return ctx.runMutation(this.component.caseflow.decideProposal, args);
  }

  raiseException(ctx: MutationCtx, args: Omit<Args<"raiseException">, "preservedStateHash">) {
    const preservedState = normalizePortableValue(args.preservedState ?? {}, "preservedState", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    return ctx.runMutation(this.component.caseflow.raiseException, {
      ...args,
      preservedState,
      preservedStateHash: contentHash(preservedState),
    });
  }

  resolveException(ctx: MutationCtx, args: Args<"resolveException">) {
    return ctx.runMutation(this.component.caseflow.resolveException, args);
  }

  completeRun(ctx: MutationCtx, args: Args<"completeRun">) {
    return ctx.runMutation(this.component.caseflow.completeRun, args);
  }

  cancelRun(ctx: MutationCtx, args: Args<"cancelRun">) {
    return ctx.runMutation(this.component.caseflow.cancelRun, args);
  }

  failRunSafely(ctx: MutationCtx, args: Args<"failRunSafely">) {
    return ctx.runMutation(this.component.caseflow.failRunSafely, args);
  }

  getCase(ctx: QueryCtx, args: Args<"getCase">) {
    return ctx.runQuery(this.component.caseflow.getCase, args);
  }

  getRun(ctx: QueryCtx, args: Args<"getRun">) {
    return ctx.runQuery(this.component.caseflow.getRun, args);
  }

  getArtifact(ctx: QueryCtx, args: Args<"getArtifact">) {
    return ctx.runQuery(this.component.caseflow.getArtifact, args);
  }

  getReceiptForRun(ctx: QueryCtx, args: Args<"getReceiptForRun">) {
    return ctx.runQuery(this.component.caseflow.getReceiptForRun, args);
  }

  getTimeline(ctx: QueryCtx, args: Args<"getTimeline">) {
    return ctx.runQuery(this.component.caseflow.getTimeline, args);
  }

  listPendingApprovals(ctx: QueryCtx, args: Args<"listPendingApprovals">) {
    return ctx.runQuery(this.component.caseflow.listPendingApprovals, args);
  }
}

export function createNodeKitCaseflowClient(component: ComponentApi) {
  return new NodeKitCaseflowClient(component);
}

export type { ComponentApi } from "../component/_generated/component.js";
