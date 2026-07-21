# NodeKit Ease submission readiness

Status: **DO NOT SUBMIT**

Last evidence run: `ease_3f8133e3d5a5408bb13e` on NodeKit commit `4bdc60d0b0e224f7d4884d7857b6f968bb3a901d`.

NodeKit is eligible for Convex component extraction or submission only when every row below is independently evidenced. A green factory command is necessary but not sufficient.

## Closed gates

- [x] Empty-directory factory generation, dependency install, compile, check, deterministic demo, evaluation, and receipt generation.
- [x] Exact phase timer ledger: full run `138751ms`; rendered browser journey `126768ms`; first meaningful paint `1124ms`.
- [x] Fifteen honest UI states: first arrival, orientation, input, validation error, running, partial result, external wait, proposal pending, approval, conflict, recoverable failure, reload/resume, completed receipt, receipt inspection, and export/share.
- [x] Six viewports in light and dark: 180 screenshot PNGs plus 180 JSON sidecars.
- [x] Zero missing states, console errors, failed network requests, horizontal overflow, or detected mojibake.
- [x] Zero serious or critical Axe violations across all 15 required states.
- [x] Pixel inspection of desktop, tablet, mobile portrait, mobile landscape, light, dark, conflict, failure, approval, receipt, and export views.
- [x] Stale proposals fail closed and preserve the newer canonical artifact.
- [x] Failure and external-wait states preserve the last valid artifact and name next-action ownership.
- [x] Independent ProofLoop integrity verification re-hashed the candidate archive, manifests, all 180 screenshots, the Playwright trace, and the browser video.
- [x] A real click-through journey proves proposal creation, approval, receipt visibility, and receipt survival after reload; the trace, video, server process identity, timings, and hashes are in the browser manifest.
- [x] One cross-platform npm/pnpm factory run passed on Ubuntu, macOS, and Windows.

Canonical evidence:

- `proof/factory-acceptance.json`
- `proof/ease/latest/manifest.json`
- `proof/ease/latest/browser/screenshot-manifest.json`
- `proof/ease/latest/browser/screenshots/`
- `proof/ease/latest/candidate.tar.gz`
- `proof/ease/latest/proofloop-receipt.json`
- `.qa/memory/runs.jsonl`
- `.qa/memory/findings.jsonl`

## Open submission blockers

### 0. Repeated cold/warm developer timing matrix

- [ ] Five genuinely cold and five warm runs pass for each supported OS/package-manager lane.
- [ ] Cold caches are isolated rather than merely labeled cold.
- [ ] Per-phase cold/warm p50 and p95 are computed from raw receipts.
- [ ] No strong onboarding percentile claim is published from the current single-run samples.

The existing cross-platform result proves compatibility, not percentile stability.

### 1. Fresh coding-agent held-out matrix

- [ ] One writable, isolated coding-agent run succeeds without human reprompting.
- [ ] All three held-out tasks succeed: research map, volunteer onboarding, and launch presentation.
- [ ] Each run makes substantive non-proof changes, produces a non-blocked final report, passes generated checks, and preserves its transcript, diff, timers, screenshots, and receipt.

Current blocker: native Codex execution inherits a read-only boundary. Docker isolates the candidate and mounts credentials read-only, but Codex's nested `bubblewrap` cannot create an unprivileged user namespace inside Docker Desktop. Two bounded attempts failed closed; the protocol prohibits a third retry in the same QA pass.

Evidence: `proof/ease/agents/agent_volunteer-onboarding_165fb8466787/agent/session.jsonl` (local ignored evidence).

Next repair: for the Docker executor only, rely on the outer disposable container as the sandbox and disable the incompatible inner Linux sandbox. Re-run in a new QA pass, then run the other two held-out tasks only after the canary succeeds.

### 2. Five-person fresh-user study

- [ ] Five participants receive only: "Use this app to complete the job shown on screen."
- [ ] At least four finish unassisted.
- [ ] Median first meaningful action is at most 30 seconds.
- [ ] Median neutral journey is at most 180 seconds.
- [ ] Median Single Ease Question score is at least 6/7.
- [ ] No P0/P1 usability failures remain.
- [ ] Consent, timestamps, screen recordings or exact screenshots, interventions, and participant-level receipts are retained.

Template: `proof/ease/fresh-users.template.json`. This gate requires real people and cannot be replaced with an agent simulation.

### 3. Three Convex-backed consumers

- [ ] NodeRoom or NodeSheet artifact collaboration passes portable Caseflow conformance through authenticated, owner-scoped Convex wrappers.
- [ ] NodeSlide presentation production passes the same contract.
- [ ] NodeVideo or another long-running artifact workflow passes the same contract.
- [ ] Stale proposals, idempotent retries, exception recovery, receipt integrity, and component/app ownership boundaries are exercised in each consumer.
- [ ] The repeated implementation is covered by `convex-test` before extraction.

Current ecosystem audit:

- NodeRoom: fails one contract-classification gate.
- NodeSlide: existing repository contract checks pass, but this is not evidence of a Convex Caseflow consumer.
- NodeVideo: checkout is absent from the workspace.

No component extraction is authorized until all three real consumers exist.

### 4. Shareable preview and production-first-user proof

- [ ] Exact tested commit is deployed to an isolated preview frontend and backend.
- [ ] Fresh browser identity completes the rendered journey using real fixture bytes.
- [ ] Exported artifact is downloaded, reopened, and independently scored.
- [ ] Deployment identity, screenshots, browser health, cleanup, and proof receipt are preserved.

This requires deployment credentials and explicit authorization. No preview or production deployment occurred in the current pass.

## Submission sequence after blockers close

1. Re-run the complete factory and cross-platform matrix against one immutable candidate.
2. Re-run independent ProofLoop verification.
3. Confirm five-person and three-consumer receipts are bound into the submission manifest.
4. Extract only the repeated Convex Caseflow kernel; keep NodeKit CLI, React experience kit, and factory outside the component.
5. Run `convex-test`, package-install example tests, and the fresh-user preview journey.
6. Publish the npm package only with explicit authorization.
7. Submit through the Convex component submission process only when `submissionReady` is deterministically true.

Until then, the required verdict is `EASE_NOT_CERTIFIED`.
