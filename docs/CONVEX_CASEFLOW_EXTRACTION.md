# Convex Caseflow component and submission gate

NodeKit Caseflow is now implemented as a bounded, isolated Convex component. It
is not the whole NodeKit factory and it has not been deployed, published, or
submitted to the Convex directory.

The component owns exactly nine tables:

1. `cases`
2. `runs` (including embedded stage state)
3. `artifacts`
4. `artifactVersions`
5. `proposals`
6. `approvals`
7. `exceptions`
8. `receipts`
9. `timelineEvents`

Every record is isolated by an opaque, host-provided `scopeKey`. Public
component arguments and results use string IDs and exact Convex validators.
The component never calls `ctx.auth`; the host application must authenticate,
authorize, and derive `scopeKey` before invoking it.

The component enforces:

- proposal-before-mutation and base-version conflict detection;
- one canonical artifact version per artifact;
- explicit run terminal states and next-action ownership;
- safe failure preservation and exception-resolution quorum;
- optional, host-supplied idempotency keys for stage entry, artifact creation,
  proposal creation, and exception creation;
- exact-result replay for the same canonical idempotent request and rejection
  when a key is reused with different request content;
- required host-computed hashes for arbitrary content, patch, and preserved
  state inputs, so Convex transport or codec mutation fails closed;
- separate idempotency results on timeline records, keeping domain event
  payloads small and provider-aligned even near the portable value limit;
- a 12-level user-payload nesting limit that reserves the remaining four
  levels for Caseflow envelopes and Convex's document root;
- immutable receipt v2 bindings for canonical artifact content, proposal
  patches and states, approval decisions, event payloads, and event actors.

It does not own application authentication, organization roles, model
providers, prompts, RAG, general chat, or arbitrary host records. The host
application composes Convex Agent, Workflow, Workpool, persistent streaming,
RAG, Presence, rate limiting, and file components as needed. Caseflow records
the portable product lifecycle rather than rebuilding those capabilities.

## Package surface

The package exposes:

```text
@homenshum/nodekit/convex-caseflow       typed host client
@homenshum/nodekit/convex.config.js      Convex component definition
@homenshum/nodekit/_generated/component.js  generated component API types
@homenshum/nodekit/test                  convex-test registration helper
```

The host installs the component in its `convex/convex.config.ts` and keeps all
authorization in app-owned wrappers:

```ts
import { defineApp } from "convex/server";
import nodekitCaseflow from "@homenshum/nodekit/convex.config.js";

const app = defineApp();
app.use(nodekitCaseflow);
export default app;
```

Host wrappers should call the exported `NodeKitCaseflowClient`. It normalizes
portable values and supplies the required transport hashes before crossing the
component boundary. Direct component calls must supply `contentHash`,
`patchHash`, or `preservedStateHash` themselves and are rejected when the
component's post-transport hash differs.

```ts
// Host function: authenticate first, derive an opaque scope, then delegate.
const principal = await requireAuthorizedPrincipal(ctx);
return await ctx.runMutation(components.nodekitCaseflow.caseflow.createCase, {
  primaryJob: args.primaryJob,
  scopeKey: principal.workspaceId,
  title: args.title,
});
```

## Local verification

Run without deploying or publishing:

```powershell
npm run typecheck:component
npm run test:component
npm run build:component
npm pack --dry-run --json
```

`npm run component:codegen` is the official regeneration command once a local
Convex development deployment is configured. Do not point that command at the
shared production deployment merely to regenerate types.

## Extraction gate

Do not publish the component until three materially different applications use the portable Caseflow contract and the repeated Convex implementation is visible:

1. NodeRoom or NodeSheet artifact collaboration;
2. NodeSlide presentation production;
3. NodeVideo or another long-running artifact workflow.

Before submission:

- all three pass the portable Caseflow conformance semantics;
- their authenticated wrappers demonstrate owner scoping;
- stale proposals and retry/idempotency are exercised;
- component-owned versus app-owned data remains documented;
- the packed install path and `convex-test` registration pass from an empty
  consumer project;
- the example app exercises the bundled package, not source-only shortcuts.

Official current references:

- https://docs.convex.dev/components/authoring
- https://docs.convex.dev/components/using
- https://docs.convex.dev/agents/workflows

This document is an extraction contract, not evidence that a Convex component has already been published or submitted.
