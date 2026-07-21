# NodeKit figured-out foundation handoff

## Current outcome

NodeKit's primary factory is now domain-blank and behaviorally figured out.

```text
nodekit create <empty-directory>
  -> product and service-design contract
  -> Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
  -> deterministic memory runtime
  -> responsive artifact-first application
  -> adapter conformance
  -> browser and proof receipts
```

The CLI no longer accepts `--preset`. Research Loop, SMB Lending FDE, and Agentic RL are explicitly labeled examples under `reference-apps/` and are created with `nodekit reference create`.

## Portable kernel

`src/lib/caseflow.mjs` defines the current portable semantic implementation. It provides NodeKit-owned IDs, canonical artifact versions, proposal-before-mutation, stale-proposal conflicts, explicit next-action ownership, exception recovery, terminal run states, portable events, and content-addressed receipts.

`src/lib/caseflow-conformance.mjs` is the provider-neutral executable boundary. The memory runtime passes it. Future Convex, PostgreSQL, and Supabase adapters must pass the same observable semantics without flattening provider-native strengths.

## Generated product contract

Every new app receives:

- `docs/FIGURED_OUT.md`;
- `product/BRIEF.md`;
- `product/AUDIENCE.md`;
- `product/USER_JOURNEY.md`;
- `product/SERVICE_BLUEPRINT.md`;
- `product/EXPERIENCE.yaml`;
- `product/DESIGN.md`;
- `product/TASTE.md`;
- a no-key deterministic demonstration;
- an artifact-first responsive shell;
- light and dark theme behavior;
- proposal, conflict, recovery, and receipt tests;
- a Convex capability plan that stays off until the real workflow is researched.

## Proof

The empty-directory acceptance runs installation, compilation, generated tests, deterministic demo, stale-proposal evaluation, live HTTP/DOM browser assertions, and proof generation. Its current receipt is `proof/factory-acceptance.json`.

The rendered QA packet is `.qa/evidence/nodekit-base-20260721-1949/`. It includes desktop, tablet, and mobile screenshots in light and dark themes plus pending-proposal and completed-receipt states. The pass found and fixed one dark-theme contrast issue. QA memory is append-only under `.qa/memory/`.

The current audience-facing proof deck is `outputs/nodekit-figured-out-proof.pptx`. It replaces the obsolete two-preset story with the neutral base, portable Caseflow, reference-app boundary, and Convex-first portability decision. Its byte hash, exact-template fidelity, overflow result, and per-slide visual inspection are recorded in `proof/nodekit-figured-out-presentation.json`.

Durable supervision is implemented in the companion NodeProof branch through a dependency-ordered ProofProgram, immutable runner-plan bindings, local read/proposal authority, budget and attempt ceilings, resumable ledgers, and NodeKit candidate/config/receipt verification.

## Convex boundary

Convex remains the preferred managed implementation, not the NodeKit semantic definition. `docs/CONVEX_CASEFLOW_EXTRACTION.md` records the component boundary and extraction gate. The component is intentionally not claimed as published: current Convex guidance keeps component state isolated, requires app-owned authentication wrappers, and recommends composing Workflow and Workpool for durable agent execution.

The component extraction begins only after three materially different consumers prove the repeated lifecycle implementation. Until then, NodeKit ships the portable contract, memory reference runtime, capability plan, and conformance suite.

## Remaining gated work

1. Adapt NodeRoom/NodeSheet, NodeSlide, and NodeVideo to the portable Caseflow contract in isolated, reviewed changes.
2. Extract the repeated Convex implementation and cover it with `convex-test` only after those consumers agree.
3. Add generic PostgreSQL semantics, then the Supabase managed profile.
4. Promote the structural browser gate to a packaged Playwright journey with screenshots in CI.
5. Add visible exception/restore/receipt-inspection surfaces to raise the remaining Agentic UI Bar dimensions.
These are explicit future gates, not hidden claims about the current release.
