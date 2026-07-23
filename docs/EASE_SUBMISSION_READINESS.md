# NodeKit Ease submission readiness

This document governs **E3 Ease certification and C3 Convex submission**, not E0 engineering merge
readiness. See `RELEASE_LADDER.md`. Implemented code and passing unit tests may be merged while
product-evidence and submission claims remain fail-closed.

Status: **DO NOT SUBMIT**

The current working tree is not a frozen certification candidate. Historical receipts remain useful
regression evidence, but no earlier commit, source hash, screenshot set, timing matrix, agent
transcript, or convenience alias certifies the source being edited now.

## Evidence identity rule

Every certification claim must name one immutable NodeKit commit and source hash. A passing receipt
may not be silently carried forward after source changes, even when those changes are additive.

### Readiness summary

- **Closed locally:** the factory, portable adapters, local Convex component/package execution,
  Supabase profile shape, exact browser export/reopen checks, recursive evidence verifier, and
  Knowledge Evolution/Evolution Ledger mechanics.
- **Open locally:** integrate and review the current changes, run the complete suite, freeze the
  candidate, and regenerate its local package/browser receipts.
- **Open externally:** 60 timing runs, 15 real fresh-agent v2 sessions, five real humans, three real
  authenticated consumers, isolated preview proof, live Supabase, real evolution adoption, final
  independent ProofLoop, and publication approval.

The evidence directory contains historical artifacts from multiple revisions. Interpret each receipt
only through its embedded `nodekitCommit`, `nodekitSourceHash`, package hash, generated-app identity,
and nested evidence hashes. Convenience filenames such as `*-verdict.json` are not proof of currency.

Earlier revisions have produced complete 60-run timing matrices and smaller fresh-agent studies.
They show that the harness can execute, not that the final candidate is certified. The current
fresh-agent v2 gate is stricter: exactly 15 unique real sessions, so the earlier three-run result is
not v2 evidence. Five samples per timing cell also do not justify publishing a per-cell p95.

## Implemented mechanics versus certification

The current source includes deterministic machinery for:

- domain-blank application scaffolding and package creation;
- exact server-process binding in browser certification;
- canonical responsive UI-state screenshots and sidecars;
- proof-bundle download, reopen, canonical artifact re-hash, and receipt-body re-hash;
- cold/warm timing aggregation that requires exactly 60 unique self-hashed trials;
- fresh coding-agent v2 aggregation that requires exactly 15 unique real CLI sessions;
- fail-closed protected fresh-agent evaluation in two separately inspected Docker containers on an
  internal-only bridge, bound to one exact image ID and a content-addressed browser lane;
- fresh packed-consumer installation and execution of the installed Convex component;
- recursive, fail-closed submission evaluation of decisive receipts, nested evidence, and tarball;
- PostgreSQL conformance and the local Supabase managed-profile contract;
- P0-P3 Model Intelligence and Harness Gym mechanics;
- governed EvoGraph-R1-inspired Knowledge Evolution, the Evolution Ledger, and frontend-topology
  evolution.

Those are implementation facts. They are not equivalent to:

- a real project-scoped model capability card;
- a completed application gym;
- an authenticated Convex consumer;
- a real-person usability result;
- a deployed fresh-user production proof;
- live Supabase managed-service conformance;
- verified real-task Knowledge Evolution adoption; or
- a current-revision Ease certificate.

## Current-revision certification gate

All items below must be completed on one clean immutable candidate after the current changes are
integrated and independently reviewed. Do not claim the full suite is green before that loop runs.

- [ ] Run factory generation, fresh dependency installation, compile, check, deterministic demo,
      evaluation, and receipt generation on the exact candidate.
- [ ] Complete the real browser journey and retain exact process identity, trace, video,
      screenshots, sidecars, accessibility results, network health, reload behavior, proof-bundle
      download/reopen, canonical artifact hash, and receipt-body hash.
- [ ] Run five isolated cold and five warm trials for all six OS/package-manager lanes and retain
      the 60 raw receipts plus the aggregate verdict.
- [ ] Run the fresh-agent v2 matrix: research map, volunteer onboarding, and launch presentation,
      each through Codex three times, Claude once, and a lower-cost agent once. All 15 real CLI
      sessions must be unique, writable, isolated, zero-reprompt, and substantively change non-proof
      files. Provision Docker and the versioned Playwright image first; every protected evaluator
      run must retain a distinct valid isolation receipt while sharing the exact image ID and browser
      lane hash. Host fallback, external egress, candidate evidence access, or a writable candidate
      server mount blocks the matrix.
- [ ] Pack the candidate and pass the fresh-consumer install/create/compile/check/demo/eval path,
      including execution of the exact installed Convex component.
- [ ] Run independent ProofLoop integrity verification over the final candidate archive and every
      referenced artifact, including recursively referenced nested evidence and the exact tarball.
- [ ] Bind every receipt to the same commit, source hash, package tarball hash, and generated-app
      identity.
- [ ] Publish no per-lane p95 unless that lane has at least 20 cold and 20 warm samples.

The earlier passing matrices and held-out runs reduce regression risk and prove the harness can
work. They do not close this gate for the current revision.

## External submission blockers

### 1. Five-person fresh-user study

- [ ] Five participants receive only: "Use this app to complete the job shown on screen."
- [ ] At least four finish unassisted.
- [ ] Median first meaningful action is at most 30 seconds.
- [ ] Median neutral journey is at most 180 seconds.
- [ ] Median Single Ease Question score is at least 6/7.
- [ ] No P0/P1 usability failures remain.
- [ ] Consent, timestamps, recordings or exact screenshots, interventions, and participant-level
      receipts are retained.

Template: `proof/ease/fresh-users.template.json`. The privacy-safe, append-only operator runbook is
`docs/FRESH_HUMAN_USABILITY_STUDY.md`; start it with `npm run ease:human-study -- help`. It creates
anonymous, timer- and byte-addressed session evidence but does not fabricate or replace the five
real people. Evaluate the assembled study with
`npm run ease:evaluate-humans -- proof/ease/fresh-users.json`.

### 2. Three authenticated Convex-backed consumers

- [ ] NodeRoom or NodeSheet passes portable Caseflow conformance through authenticated,
      owner-scoped Convex wrappers.
- [ ] NodeSlide presentation production passes the same contract.
- [ ] NodeVideo or another long-running artifact workflow passes the same contract.
- [ ] Each consumer exercises stale proposals, idempotent retries, exception recovery, receipt
      integrity, and component/application ownership boundaries.
- [ ] Each consumer installs and executes the same exact packed Caseflow candidate already covered
      by local `convex-test`; no copied implementation or sidecar adapter qualifies.

Repository contract checks, filesystem adapters, local durable candidates, or unauthenticated
owner-capability locators do not count as authenticated Convex consumers. The existing local
component is an engineering candidate, not a validated public boundary; all three consumers must
converge before its API is treated as submission-ready.

### 3. Live backend portability

- [ ] Re-run the portable Caseflow suite against live PostgreSQL on the final candidate. A previous
      revision passed PostgreSQL 17.10 and remains regression evidence only.
- [ ] Run the final candidate against live Supabase with Auth, RLS, Storage, Realtime, Queue, and
      Cron enabled.
- [ ] Preserve provider-specific receipts and verify export/import compatibility.

Checked-in migrations and deterministic adapter tests prove implementation shape, not managed
service behavior.

### 4. Real Model Intelligence evidence

- [ ] Normalize live exact-model observations into at least one project-scoped provisional
      capability card.
- [ ] Complete a real application gym using protected tasks and independent evaluation.
- [ ] Keep routing provisional until a fresh-agent canary and NodeProof receipt pass.

P1-P3 mechanics are implemented and tested with fixtures. No live model capability or routing
claim is currently authorized.

### 5. Shareable preview and production-first-user proof

- [ ] Deploy the exact tested commit to isolated preview frontend and backend environments.
- [ ] Use a fresh browser identity and real fixture bytes through the rendered UI.
- [ ] Download, reopen, and independently score the exported artifact.
- [ ] Preserve deployment identity, screenshots, health, cleanup, and proof receipt.

This requires credentials and explicit authorization. Local browser evidence is not a deployment.

### 6. Knowledge Evolution adoption

- [ ] Run protected real application tasks against flat retrieval, a static graph, and the governed
      evolving graph using the same inputs and independent evaluator.
- [ ] Demonstrate at least one verified downstream consumer adoption with immutable evidence.
- [ ] Record material conclusions as human-reviewed Evolution Ledger events; do not auto-promote a
      graph, harness, or routing policy from fixture-only results.

The EvoGraph-R1-inspired plane and ledger are implemented. Implementation is not evidence that the
evolving graph improves a real task or has been adopted by a consumer.

## Submission sequence after every blocker closes

1. Freeze one immutable candidate and discard or archive stale convenience aliases.
2. Re-run the current-revision local certification gate.
3. Bind the five-person, three-consumer, portability, model-evidence, Knowledge Evolution, and
   production-preview receipts into one submission manifest.
4. Re-run independent ProofLoop verification over the complete evidence set.
5. Reconcile the local Convex component against the repeated kernel demonstrated by all three
   consumers; keep the NodeKit CLI, React experience kit, Knowledge Evolution plane, Harness Gym,
   and factory outside the component.
6. Run `convex-test`, package-install example tests, and the fresh-user preview journey.
7. Publish the npm package only with explicit authorization.
8. Submit only when `npm run submission:evaluate` returns `submissionReady: true` for the frozen
   candidate and explicit publication approval is present.

Until then, the required verdict is `EASE_NOT_CERTIFIED`.
