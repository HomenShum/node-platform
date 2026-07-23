# Builder Journey J1 — the Decide → Build compiler

## What was still open after J0

J0 gave the builder journey a vehicle and closed the Decide → Build seam with a fail-closed advance
rule: a case cannot leave Decide until an `OpportunityContract` exists and a receipt binds it by
content hash. But the contract was still an inert record. Nothing turned an approved
`OpportunityContract` into what the Build stage actually consumes, so the coding agent would still
re-derive the user, the job, the artifact, the data authority, and the permission boundaries while it
coded — the exact reprompt loop the journey exists to remove. The boundary was written down; it was
not yet load-bearing.

## What changed

`src/lib/opportunity-compiler.mjs` adds `compileOpportunityToBuild(opportunity)`, the seam-closer. It
takes a validated `nodekit.opportunity-contract/v1` and returns the two things Build consumes: a
`nodekit.product-design-contract/v1` for the frontend tournament, and an Atlas reuse query.

- **Decided fields become protected fields.** The contract's `user`, `primaryJob`, and
  `primaryArtifact` flow into the product contract's `product` block, and the product contract's
  `protectedDecisions` are pinned — `primaryUser`, `primaryJob`, `canonicalWorkflow`, `dataAuthority`,
  and `permissionBoundaries` to the `nodekit` authority; `completionCriteria` and `finalVerdict` to
  the `nodeproof` authority. The build agent may refine the interpretive design fields (emotional
  target, density, surfaces) within this boundary; it may not re-decide the protected core.
- **Every prohibited authority becomes an anti-pattern.** Each entry in `authorityLimits.prohibited`
  is slugged into a `prohibited:<slug>` item appended to the product contract's `avoid` list, so a
  prohibition recorded during Decide is carried into the interface as something the build must not
  present.
- **A read-only wedge stays read-only.** When nothing is in the `approve` list and a prohibition
  names a write/mutate/charge/pay/transfer/delete authority, `isReadOnly` marks the wedge read-only,
  the dominant action becomes `resolve_next_uncertainty` rather than `advance_the_primary_job`, and
  the Atlas query carries `readOnly: true`. A read-only wedge cannot be silently upgraded to a write
  product.

The module imports only `FRONTEND_REQUIRED_GUARDRAILS` and `FRONTEND_REQUIRED_STATES` from the
existing frontend specialist — zero new runtime dependencies.

## Evidence

- `test/opportunity-compiler.test.mjs` passes 4/4: the salon `OpportunityContract` compiles into a
  product-design contract that validates against its schema; the decided fields are carried and the
  protected decisions are pinned to the `nodekit` / `nodeproof` authorities; the salon prohibitions
  (`prohibited:write_to_any_accounting_ledger`, `prohibited:move_or_transfer_money`) survive into the
  `avoid` list; and the Atlas query is read-only and carries the wedge terms.
- `typecheck:public` is clean against the `opportunity-compiler.d.mts` sibling. No writes under
  `proof/`, `evolution/` runtime outputs, or `evals/`.

## Known limitations

- The compiler produces the Build stage's *inputs*; it does not yet run the frontend tournament or
  generate the salon application. Carrying the contract into a rendered, certified app is the next
  step in J1.
- The protected-decision pinning is verified by the unit test over one contract (the salon slice); no
  real builder has yet carried an `OpportunityContract` through compile → build → a certified surface.
- This closes the Decide → Build hand-off mechanically. It does not certify any application; the EASE
  verdict remains EASE_NOT_CERTIFIED.
