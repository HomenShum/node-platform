# Guided intake and mobile decisions materiality review

Status: human-reviewed material change; exact-revision implementation proof pending.

Reviewer: project-owner

Reviewed at: 2026-07-22T02:33:14-07:00

## Why this is material

The generated application's first-run progression and its ability to expose the current decision on a small screen are primary-user-workflow guarantees. A visually present form is not sufficient when submitting it does not advance the case, and a review action is not usable when it begins below the initial mobile viewport.

## Reviewed response

The candidate is expected to enforce all of the following as one product contract:

- intake presents one explicit outcome-confirmation action;
- a proposal cannot be created before that outcome is confirmed;
- confirmation persists the intended outcome and advances the case to active work;
- proposal content remains absent while the user is still in intake;
- approval, conflict, and recoverable-failure states expose the appropriate decision in a mobile decision dock inside the initial viewport;
- the equivalent off-screen desktop action group is hidden on mobile decision states, so there is one obvious action surface.

## Required verification

- `test/ease-proof.test.mjs` must cover premature-proposal rejection and the confirmation transition.
- `templates/base/scripts/browser-certify.mjs` must exercise the real form interaction and decision recovery paths.
- Final candidate browser certification must cover all declared states, viewports, and themes with screenshot hashes and zero console, network, accessibility, or horizontal-overflow failures.
- The mobile action dock must be asserted inside the initial viewport, not merely found in the DOM.

## Claims deliberately not made

- This review is not final screenshot evidence.
- It does not replace fresh-user timing or consented human usability trials.
- It does not certify an uncommitted worktree or a later source revision.
