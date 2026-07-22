# NodeKit Ease submission readiness

This document governs **E3 Ease certification and C3 Convex submission**, not E0 engineering merge
readiness. See `RELEASE_LADDER.md`. Implemented code and passing unit tests may be merged while
product-evidence and submission claims remain fail-closed.

Status: **DO NOT SUBMIT**

Baseline revision audited before the exact-candidate hardening in this update:
`5b9c4d73c286020fe7b7c52d208d7e0cbfeef626`.

No complete Ease certification bundle is bound to that revision. Passing evidence from
`e398398d7f1dd4ff0b65409d2c8da971e83bc488` or
`0cc282c68c316068447956f5c6729f98ba3435f8` remains useful regression history, but it does not
certify `5b9c4d7` or any later candidate.

## Evidence identity rule

Every certification claim must name one immutable NodeKit commit and source hash. A passing receipt
may not be silently carried forward after source changes, even when those changes are additive.

The current local evidence directory contains artifacts from different revisions:

| Evidence                                                                                                                    | Bound revision                                    | Honest interpretation                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `proof/factory-acceptance.json` and `proof/ease/latest/manifest.json`                                                       | `0cc282c`                                         | Passing factory/browser run for that earlier revision only.                                     |
| `proof/ease/developer-timing-runs-0cc282c*.json`                                                                            | `0cc282c`                                         | Passing 60-run cold/warm matrix for that earlier revision only.                                 |
| `proof/ease/developer-timing-runs-e398398*.json`                                                                            | `e398398`                                         | Passing 60-run cold/warm matrix for that earlier revision only.                                 |
| `proof/ease/fresh-agent-verdict-e398398.json`                                                                               | `e398398`                                         | All three required held-out coding-agent tasks passed on one exact earlier identity.            |
| `proof/package-install-verdict-e398398.json`                                                                                | `e398398`                                         | Fresh-consumer tarball install, create, compile, check, demo, and eval passed for that package. |
| `proof/local-closure-e398398.json`                                                                                          | `e398398`                                         | Records local/code-owned closure and explicitly leaves external evidence open.                  |
| `proof/ease/developer-timing-verdict.json`, `proof/ease/fresh-agent-verdict.json`, and `proof/package-install-verdict.json` | aliases currently resolving to `e398398` evidence | Convenience filenames, not current-revision proof.                                              |
| `proof/ease/latest/proofloop-receipt.json`                                                                                  | absent in the current working tree                | Independent Ease integrity verification is not currently evidenced.                             |

The `0cc282c` and `e398398` matrices each contain five cold and five warm runs for npm and pnpm on
Windows, Ubuntu, and macOS. They support an earlier-revision stability claim. They do not support a
`5b9c4d7` onboarding claim, and five samples per cell still do not justify a per-cell p95.

## Implemented mechanics versus certification

The current source includes deterministic machinery for:

- domain-blank application scaffolding and package creation;
- exact server-process binding in browser certification;
- canonical responsive UI-state screenshots and sidecars;
- cold/warm timing aggregation that requires all 60 trials;
- fresh coding-agent held-out aggregation;
- package-install verification;
- fail-closed submission-manifest evaluation;
- P0-P3 Model Intelligence and Harness Gym mechanics;
- governed Knowledge Evolution and frontend-topology evolution.

Those are implementation facts. They are not equivalent to:

- a real project-scoped model capability card;
- a completed application gym;
- an authenticated Convex consumer;
- a real-person usability result;
- a deployed fresh-user production proof; or
- a current-revision Ease certificate.

## Current-revision certification gate

All items below must be repeated on one clean immutable candidate that contains the Knowledge
Evolution and frontend-specialist changes now present after `e398398`.

- [ ] Run factory generation, fresh dependency installation, compile, check, deterministic demo,
      evaluation, and receipt generation on the exact candidate.
- [ ] Complete the real browser journey and retain exact process identity, trace, video,
      screenshots, sidecars, accessibility results, network health, reload behavior, and export proof.
- [ ] Run five isolated cold and five warm trials for all six OS/package-manager lanes and retain
      the 60 raw receipts plus the aggregate verdict.
- [ ] Re-run research map, volunteer onboarding, and launch presentation as writable isolated
      coding-agent tasks with zero human reprompts and substantive non-proof changes.
- [ ] Pack the candidate and pass the fresh-consumer install/create/compile/check/demo/eval path.
- [ ] Run independent ProofLoop integrity verification over the final candidate archive and every
      referenced artifact.
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

Template: `proof/ease/fresh-users.template.json`. This gate requires real people and cannot be
replaced by an agent simulation. Evaluate the completed study with
`npm run ease:evaluate-humans -- proof/ease/fresh-users.json`.

### 2. Three authenticated Convex-backed consumers

- [ ] NodeRoom or NodeSheet passes portable Caseflow conformance through authenticated,
      owner-scoped Convex wrappers.
- [ ] NodeSlide presentation production passes the same contract.
- [ ] NodeVideo or another long-running artifact workflow passes the same contract.
- [ ] Each consumer exercises stale proposals, idempotent retries, exception recovery, receipt
      integrity, and component/application ownership boundaries.
- [ ] Repeated Caseflow behavior is covered with `convex-test` before extraction.

Repository contract checks, filesystem adapters, local durable candidates, or unauthenticated
owner-capability locators do not count as authenticated Convex consumers. No component extraction
is authorized until all three real consumers exist.

### 3. Live backend portability

- [ ] Run the portable Caseflow suite against a live PostgreSQL deployment.
- [ ] Run it against a live Supabase project with Auth, RLS, Storage, and Realtime enabled.
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

## Submission sequence after every blocker closes

1. Freeze one immutable candidate and discard or archive stale convenience aliases.
2. Re-run the current-revision local certification gate.
3. Bind the five-person, three-consumer, portability, model-evidence, and production-preview
   receipts into one submission manifest.
4. Re-run independent ProofLoop verification over the complete evidence set.
5. Extract only the repeated Convex Caseflow kernel; keep the NodeKit CLI, React experience kit,
   Knowledge Evolution plane, Harness Gym, and factory outside the component.
6. Run `convex-test`, package-install example tests, and the fresh-user preview journey.
7. Publish the npm package only with explicit authorization.
8. Submit only when `npm run submission:evaluate` returns `submissionReady: true` for the frozen
   candidate and explicit publication approval is present.

Until then, the required verdict is `EASE_NOT_CERTIFIED`.
