# NodeKit figured-out foundation handoff

> Historical implementation handoff. It records the foundation at the time it was written, before
> the installable Convex component, PostgreSQL adapter, Supabase profile, hardened evidence gates,
> and EvoGraph-R1-inspired evolution plane were integrated. Use
> [`NODEKIT_MASTER_PLAN.md`](NODEKIT_MASTER_PLAN.md) and
> [`REMAINING_GAPS.md`](REMAINING_GAPS.md) for current status.

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

The CLI accepts no `--preset`, domain selector, or public reference-creation path. Narrow applications under `reference-apps/` are repository-internal regression fixtures and historical demonstrations only; they are excluded from the published package. Every real application begins from the same blank, figured-out foundation and is specialized by the coding agent from the user's stated job.

## Portable kernel

`src/lib/caseflow.mjs` defines the current portable semantic implementation. It provides NodeKit-owned IDs, canonical artifact versions, proposal-before-mutation, stale-proposal conflicts, explicit next-action ownership, exception recovery, terminal run states, portable events, and content-addressed receipts.

`src/lib/caseflow-conformance.mjs` is the provider-neutral executable boundary. The memory runtime,
installable Convex component, PostgreSQL adapter, and local Supabase profile now exercise the same
observable semantics without flattening provider-native strengths. Managed-service and real-consumer
adoption remain evidence gates, not implementation claims.

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

The historical rendered QA packet is `proof/ease/latest/`. It contains 180 screenshots and sidecars
covering 15 required states across six viewport/theme combinations, plus a Playwright trace and
browser video of a real proposal, approval, receipt, and reload journey. That historical packet was
independently re-hashed, but it is not final-candidate ProofLoop evidence. Current certification must
use an immutable identity-scoped packet and a fresh trusted attestation. QA memory is append-only
under `.qa/memory/`.

The current audience-facing proof deck is `outputs/nodekit-figured-out-proof.pptx`. It replaces the obsolete two-preset story with the neutral base, portable Caseflow, reference-app boundary, and Convex-first portability decision. Its byte hash, exact-template fidelity, overflow result, and per-slide visual inspection are recorded in `proof/nodekit-figured-out-presentation.json`.

Durable supervision is implemented in the companion NodeProof branch through a dependency-ordered ProofProgram, immutable runner-plan bindings, local read/proposal authority, budget and attempt ceilings, resumable ledgers, and NodeKit candidate/config/receipt verification.

## Convex boundary

Convex remains the preferred managed implementation, not the NodeKit semantic definition. `docs/CONVEX_CASEFLOW_EXTRACTION.md` records the component boundary and extraction gate. The component is intentionally not claimed as published: current Convex guidance keeps component state isolated, requires app-owned authentication wrappers, and recommends composing Workflow and Workpool for durable agent execution.

The component implementation now exists and passes local component/package conformance. Publication
and Convex-directory submission still wait for three materially different authenticated consumers
to prove the lifecycle boundary in real applications.

## Remaining gated work

1. Freeze one reviewed candidate and rerun package, browser, timing, and coding-agent proof against it.
2. Complete authenticated NodeRoom, NodeSlide, and NodeVideo adoption with exact packed-component evidence.
3. Run the five-person usability study and an authorized shareable-preview journey.
4. Verify the Supabase profile in a provisioned managed project.
5. Obtain trusted external ProofLoop and publication attestations only after all preceding evidence closes.

The live checklist, exact evidence counts, and submission order are maintained in `docs/EASE_SUBMISSION_READINESS.md`.
These are explicit future gates, not hidden claims about the current release.
