# Exact source-bound submission gates materiality review

Status: human-reviewed material change; exact-revision implementation proof pending.

Reviewer: project-owner

Reviewed at: 2026-07-22T02:33:14-07:00

## Why this is material

Submission readiness controls publication authority. Counts, familiar filenames, or internally consistent sidecars can look complete while describing another revision or omitting the facts that make a verdict decisive. The gate must validate the evidence contract and exact source identity, not the appearance of a proof directory.

## Reviewed response

The candidate is expected to fail closed unless every decisive verdict binds to the same immutable candidate commit and distributable source hash. Contract-specific checks must include:

- cold and warm timing samples across every required operating-system and package lane;
- three unique fresh coding-agent runs executing the required tasks;
- five consented human trials with unassisted-completion, first-action, journey-time, usability, and severity thresholds;
- three named consumers using the same final package, registered component, authenticated scoped flow, provider conformance, live signed-in browser journey, and screenshot hashes;
- a deployed preview whose frontend, backend, source, fixture, browser journey, export, reopen, and cleanup identities agree;
- a fresh packed-package install proving public types, distribution, and supported Convex exports without publishing;
- an independent ProofLoop verdict backed by distinct decisive evidence hashes;
- explicit publication approval bound to the candidate identity and allowed publication scopes.

The distributable source hash must be recomputed during evaluation. Packaged evolution records are part of that source identity, while later proof outputs and documentation may not silently redefine the candidate.

## Required verification

- Focused tests in `test/submission-gate.test.mjs` and `test/submission-preparation.test.mjs` must reject shallow, cross-revision, incomplete, duplicated, or approval-free evidence.
- The final submission manifest schema must require the candidate source hash.
- Final evaluation must be rerun after the exact candidate commit exists and after all decisive evidence is collected.

## Claims deliberately not made

- This review does not assert that the external timing, agent, human, consumer, preview, or independent-review gates have passed.
- It grants no permission to publish a package, deploy production, or submit a Convex Component.
- It does not allow proof generated for a historical candidate to certify the final candidate.
