# Convex Caseflow extraction gate

NodeKit Caseflow is the intended bounded Convex component, not the whole NodeKit factory.

The component will own isolated lifecycle state for cases, runs, stages, artifacts, artifact versions, proposals, approvals, exceptions, receipts, timeline events, and external references. It will enforce proposal-before-mutation, base-version checks, explicit terminal states, next-action ownership, idempotent lifecycle operations, and immutable receipt records.

It will not own application authentication, organization roles, model providers, prompts, RAG, general chat, or arbitrary host artifacts. Authenticated application functions must validate the principal and pass scoped identifiers into the component because component functions do not have `ctx.auth`. All public component functions require argument and return validators.

The host application composes existing Convex Agent, Workflow, Workpool, persistent streaming, RAG, Presence, rate limiting, and file components as required. Caseflow records typed external references and lifecycle events; it does not rebuild those capabilities.

## Extraction gate

Do not publish the component until three materially different applications use the portable Caseflow contract and the repeated Convex implementation is visible:

1. NodeRoom or NodeSheet artifact collaboration;
2. NodeSlide presentation production;
3. NodeVideo or another long-running artifact workflow.

Before extraction:

- all three pass `runCaseflowConformance()` semantics;
- their authenticated wrappers demonstrate owner scoping;
- stale proposals and retry/idempotency are exercised;
- component-owned versus app-owned data is documented;
- `convex-test` covers the packaged API;
- the example app exercises the bundled package, not source-only shortcuts.

Official current references:

- https://docs.convex.dev/components/authoring
- https://docs.convex.dev/components/using
- https://docs.convex.dev/agents/workflows

This document is an extraction contract, not evidence that a Convex component has already been published or submitted.
