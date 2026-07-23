# Frontend tournament decisive verdict bound to verifier evidence

## What failed

The frontend tournament's decisive verdict was computed as

    browserChecksPassed && accessibilityPassed && overflowPassed && majorFindings.length === 0

from four fields the candidate wrote into its own benchmark JSON. Three `true` values and two
empty arrays printed TOURNAMENT DECISIVE. That is an unsigned self-attestation, not a fail-closed
gate. The NodeSlide pilot's primary metric — tokens to the first direction that passes the
tournament — would have measured how cheaply an agent produced a JSON that claimed to pass, not
whether a direction passed an independently observed quality gate.

## What changed

The decisive verdict is now computed from evidence a verifier produced, graded and fail-closed.

- `nodekit.frontend-render-receipt.v1` records a verifier's own observations over the six required
  direction states (desktop first-arrival / active-workspace / proposal-review, mobile
  primary-artifact / agent / review): per-state screenshot and check-report hashes, and browser,
  accessibility, overflow, and state-communication checks with the raw counts beside each status.
  The state manifest hash is recomputed from the per-state hashes, so editing the manifest is
  detectable. This is the narrower Frontend Render Contract, not the full browser-certification
  closure.
- `nodekit.frontend-review-receipt.v1` records an independent judgement bound to that manifest,
  carrying the generating model's identity so self-review is detectable.
- `evaluateFrontendRenderContract` grades DECISIVE / NOT_DECISIVE / FAIL / INCOMPLETE / UNVERIFIED.
  Only DECISIVE authorizes. The benchmark schema dropped the three candidate booleans and gained a
  repository commit plus render and review receipt references; `evaluateFrontendTournament` loads
  and grades those receipts for the selected direction.
- `assembleFrontendRenderReceipt` derives each check's status from raw observations rather than
  accepting an asserted status, so a state whose raw report shows a serious accessibility issue
  cannot be assembled into a passing receipt.

## Evidence

- The corruption corpus the design consult called more valuable than a hundred happy-path tests
  passes: no render receipt is UNVERIFIED; a receipt from a different commit or direction-set hash
  FAILs; a missing state is INCOMPLETE; a modified manifest FAILs; an accessibility summary of pass
  while the raw report has a serious issue FAILs; no review receipt is UNVERIFIED; a model reviewing
  its own output FAILs; a review of a different manifest FAILs; and all-checks-pass with an
  unresolved major finding is NOT_DECISIVE.
- The live tournament is DECISIVE only with valid verifier receipts and NOT_DECISIVE when the
  independent review carries an unresolved finding, proving the receipts flow through the live
  evaluator and not only the unit.
- test/frontend-render-contract.test.mjs and test/frontend-specialist.test.mjs pass; typecheck:public
  is clean; harness-gym shows no regression.

## Known limitations

- The verifier command that drives a real browser over the six states and calls the assembler is
  not yet wired; receipts here are assembled from observations by test and by the assembler, not by
  a live browser run.
- Freezing a new tournament version so a benchmark cannot be replayed against a stale contract is a
  separate follow-on.
- This change makes the tournament's decisiveness honest; it does not by itself certify any real
  frontend, model, or consumer.
