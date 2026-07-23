# Builder Journey J0 — the vehicle over the engines

## What was missing

NodeKit had strong engines — graph-hop, Atlas, create/adopt, the frontend tournament, NodeSlide
and NodeVideo, the EASE submission gate, the evolution ledger, the harness gym — but no single
object that carries a builder from an idea to a live, improving product. The engines produced
value in isolation; nothing sequenced them into one governed journey. Framed differently: the
gates are stage-exit conditions, not the product, and the product — the vehicle — did not exist.

The worst seam was Decide → Build. The failure mode: an interesting idea leads to rich research,
then a scaffold, and then the coding agent makes product decisions while it codes. That is why
strong technical work can still ship the wrong interface, and it is the reprompt loop the project
set out to remove.

## What changed

J0 adds the smallest connective layer, reusing Caseflow rather than reinventing it.

- `nodekit.builder-case/v1` models one venture carried through five stages, DECIDE → BUILD →
  EXPLAIN → LAUNCH → LEARN, each with one handoff artifact reference and a receipt. Empty-string
  refs mean "not yet produced".
- `nodekit.opportunity-contract/v1` is the artifact the Decide stage produces and the fix for the
  Decide → Build seam. It records the user, the problem, the wedge, the primary job, the inputs,
  the primary artifact, and — critically — the rejected alternatives, the open unknowns, the
  success condition, and the authority limits (read / propose / approve / prohibited). The coding
  agent builds against this boundary instead of re-deciding scope while coding.
- `src/lib/builder-journey.mjs` wraps Caseflow. `advanceStage` is the only path that marks a stage
  complete, and it is fail-closed: it blocks unless the current stage's handoff artifact and a
  receipt exist and the receipt binds that artifact by content hash. A forged or mismatched handoff
  reference stays blocked because the receipt never bound that identity and hash.
- The salon `OpportunityContract` fixture instantiates the Verified Weekly Salon Brief slice: a
  one-location salon uploads a week of bank, Square, and payroll files, and the application produces
  a read-only, source-linked owner brief. It is the first end-to-end vertical slice.

## Evidence

- `test/builder-journey.test.mjs` passes 7/7: a case starts in decide; advancing to build is blocked
  until an OpportunityContract and receipt exist; it advances once they do; a forged or mismatched
  handoff reference stays blocked via the content-hash binding; a corrupt receipt reference stays
  blocked as receipt-not-found; the salon OpportunityContract validates against its schema; and the
  journey view reports the current stage and what it still needs.
- Both schemas parse and validate a valid instance through the repository validator. typecheck:public
  is clean. The module imports only caseflow.mjs and schema-validation.mjs — zero new runtime
  dependencies. No writes under proof/, evolution/, or evals/.

## Known limitations

- Only the Decide → Build seam is closed by a real handoff contract. The other four handoff artifacts
  (BuildEvidencePack, StoryPack, LaunchManifest, ObservationPack) are named and referenced but not
  yet given their own schemas or generators.
- The builder journey is a contract and a fail-closed advance rule; it is not yet a running product
  surface, and no real builder has carried a case end to end.
- The salon slice is a fixture, not a certified application. It does not change the EASE verdict,
  which remains EASE_NOT_CERTIFIED.
