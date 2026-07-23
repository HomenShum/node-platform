# NodeKit EaseProof v1

NodeKit is not submission-ready merely because its engineering foundation passes CI. Submission remains locked until strangers can use it without architectural coaching.

## The three independent subjects

1. Developer ease: an empty directory reaches a rendered, reload-safe receipt with no key, manual source edit, or setup decision.
2. Coding-agent ease: a fresh agent receives only the generated repository and one short product goal, then builds and proves a vertical slice without routine steering.
3. End-user ease: a fresh person completes the visible job, understands the outcome, and can locate the artifact, unresolved issues, and receipt.

Passing one subject never implies another.

## Local evidence commands

```bash
npm run acceptance:factory
docker pull mcr.microsoft.com/playwright:v1.61.1-noble
npm run ease:run-agent-matrix -- \
  --campaign=<immutable-campaign-id> \
  --candidate=<40-char-commit> \
  --source-hash=<64-char-source-hash> \
  --nodekit-tarball=<exact-candidate.tgz> \
  --nodekit-tarball-sha256=<64-char-tarball-hash> \
  --lower-cost-driver=<codex-or-claude-code> \
  --lower-cost-model=<explicit-materially-lower-cost-model> \
  --lower-cost-evidence=<official-pricing-evidence.json> \
  --codex-model=<exact-codex-model> \
  --claude-model=<exact-claude-model> \
  --protected-container-image=mcr.microsoft.com/playwright:v1.61.1-noble \
  --concurrency=1
```

`ease:run-agent-matrix` is the qualifying entry point: it pins the immutable task set and runner,
builds all 15 required profile/task attempts, preserves the official lower-cost evidence snapshot,
and invokes the protected aggregate evaluator. `acceptance:agent` remains an internal diagnostic
primitive used by that orchestrator; a hand-written standalone invocation cannot supply the complete
immutable campaign bindings and does not qualify as submission evidence. Use shell-appropriate line
continuation syntax when copying the example (PowerShell uses a backtick instead of `\\`).
Docker is mandatory for the qualifying fresh-agent matrix. The orchestrator resolves the selected
image to its exact `sha256:` image ID before it creates any run. A missing daemon, absent image, or
image-ID drift fails the campaign; there is no host-process evaluator fallback. Pulling the versioned
Playwright image above is the one-time provisioning step for the default lane.

These evaluator commands deliberately emit unsigned measurement bodies. After
an independent reviewer checks the raw output, use
`npm run submission:finalize-evidence` with the exact release identity and a
one-purpose external key policy. The finalizer reopens all referenced evidence,
validates the decisive schema, and embeds the canonical payload plus detached
signature; it does not make the key trusted or turn a missing study into proof.
See [Trusted submission attestations](./ATTESTATIONS.md).

The factory command first packs the clean NodeKit candidate, then starts its decisive clock at an empty launcher before even `package.json` exists. The measured journey installs that exact tarball, invokes its installed CLI, binds the same tarball into the generated app, installs app and browser dependencies, and continues through compile, checks, demo, eval, rendered browser work, reload, and proof. It produces phase-level timers and 180 candidate-bound PNGs: 15 required lifecycle states across six viewport profiles and two themes. It also preserves screenshot sidecars, an archived generated candidate, exact application/config/tarball identities, CI runner provenance, and a fail-closed manifest under `proof/ease/latest/`. Candidate packaging and a warm-cache priming pass are disclosed separately and are never hidden inside the measured setup time.

The coding-agent command starts with an empty launcher, inspects and installs the required exact `.tgz`, invokes the CLI from that installed package, binds the same tarball into the generated repository, installs dependencies, compiles, and commits that clean baseline before the fresh agent sees it. It never imports the current checkout's scaffold implementation as a shortcut. `--agentProfile` is mandatory evidence, not a label inferred after the run: `codex` uses the Codex driver, `claude-code` uses the Claude Code driver, and `lower-cost` uses its preregistered lower-cost driver. Every live profile requires an explicit model identifier. The short-lived provider broker receives that identifier as `NODEKIT_BROKER_ALLOWED_MODEL`, rejects model drift, and records the allowed model in its self-hashed isolation receipt. It records the exact package name, package version, tarball SHA-256, generated `applicationHash` and `configHash`, prompt, sanitized JSONL session, command hashes, numeric token totals plus raw-event hashes, zero-intervention ledger, candidate diff/archive, post-agent gates, screenshots, and a hash-bound evidence manifest. Candidate-controlled post-agent commands run with no network, a read-only container root, dropped capabilities, no new privileges, bounded resources, and only the generated workspace mounted. The protected empty-directory lane additionally requires the exact scaffold invocation to be the first recorded coding-agent command; a command-name heuristic is not accepted as proof of the first write. A process exit is insufficient: the run fails unless the agent makes substantive non-proof changes and its final report is not blocked. One successful run is a pilot, not repeatability certification.

After the candidate tree and archive are frozen, a content-addressed evaluator outside the generated repository creates a nonce-bearing hidden task input. The candidate never receives the evaluator, rubric, expected output, or protected evidence; it receives only that task input through the same browser form a user operates. The evaluator verifies the immutable task and task-set bytes, exact NodeKit identities, candidate archive/tree, generated application identity, and an exact task-specific transformation. Research cases use only supplied immutable source packet IDs, excerpts, timestamps, and content hashes; they make no live or “latest” claim. The candidate server receives an evidence-free extraction of the frozen archive as its only read-only bind mount. It runs as a non-root process with a read-only root filesystem, dropped capabilities, no new privileges, bounded resources, no published ports, and no external egress. A second container on the same Docker-internal bridge runs the content-addressed browser lane. That browser container cannot mount the candidate tree or evaluator oracle; its only writable mount is a new evaluator scratch directory. It first resets the server, captures the exact 15-state × six-viewport × two-theme matrix itself, resets again, and then completes the hidden guided task, export, reload, reopen, and receipt journey. Every matrix state runs pinned Axe 4.12.1; any serious or critical violation fails. Playwright, Playwright Core, Axe Playwright, and Axe Core are exact-version, read-only mounts whose complete package trees are hash-bound in the isolation receipt. The lane also proves public-network egress is blocked and captures the task-relevance PNG. Container IDs, dependency tree hashes, mount summaries, Docker server identity, image reference and exact image ID, internal-network ID, and every isolation check are self-hashed into both evaluator receipts. The evaluator output directory is created only after the coding agent exits; a pre-existing, candidate-authored, host-fallback, image-drifted, or incompletely isolated result is rejected. Candidate-owned browser output remains diagnostic. The separately hash-bound visual inventory and protected evaluation bind the protected manifest, all 180 PNGs, all 180 sidecars, the decoded-pixel evidence root, and the independent evaluator screenshot. Qualifying runs require zero open P0/P1 issues.

That automated visual inventory is not the five-human usability study and says so in its typed receipt (`separateFromHumanUsability: true`, `humanUsabilityGateSatisfied: false`). It proves the enumerated layout, browser-health, serious/critical Axe, screenshot-integrity, and task-output checks. Moderate and minor Axe findings remain recorded rather than erased. It does not certify complete WCAG conformance, human comprehension, taste, or ease.

Only `nodekit.agent-ease-trial/v2` trials qualify. Every trial binds the starting and ending NodeKit commit and distributable source hash, the inspected package name/version/tarball hash, generated application identity, fresh CLI session ID found in its JSONL transcript, protected evaluator and browser-lane SHA-256 values, protected Docker image reference and exact image ID, isolation self-hash, task-specific evaluation, independent evaluator screenshot, visual-review inventory, exact screenshot-evidence root, a recomputable receipt hash, and hashes for all required evidence files. All evidence paths must use their one canonical repository-relative POSIX spelling; aliases such as `agent//session.jsonl` or `agent/./session.jsonl` fail. All 15 session IDs, session-transcript hashes, and isolation hashes must be distinct, while every run must use the same protected lane and exact image. The aggregate evaluator independently reopens the same required tarball, evaluator, candidate archive, task-bound receipts, isolation records, and transitive screenshot closure; selects every v2 attempt bound to the candidate commit/source identity; and rejects any attempt using another tarball rather than filtering it away. It also rejects extra, missing, failed, duplicate, candidate-authored, host-fallback, isolation-tampered, or unreported attempts and emits the exact package identity as `releaseCandidate`. It never chooses the latest passing run. Historical v1 pilots remain useful diagnostics but cannot satisfy submission.

## Human protocol

Recruit exactly five people who did not build NodeKit. Give only:

> Use this app to complete the job shown on screen.

For each participant record UTC start/end, first meaningful action, completion, wrong turns, help requests, unclear terms, backtracking, whether they can explain what happened, whether they can find the canonical artifact and unresolved issues, and a 1–7 Single Ease Question score. Do not coach.

Each participant must have two repository-relative, content-addressed evidence objects: at least one `screenshot` and one `session-log`. A recording is optional. Every object has the shape `{ "kind": "screenshot|session-log|recording", "path": "proof/ease/humans/...", "sha256": "..." }`. Paths and hashes cannot be reused across participants. The evaluator reads the referenced files, rejects missing or escaping paths and symlinks, recomputes every SHA-256 hash, and only then emits `evidenceFilesVerified: true` plus the non-identifying `selectedParticipants` rows.

The human gate requires at least 4/5 unassisted completions, at least 4/5 participants able to explain the outcome, locate the canonical artifact, and locate unresolved issues, median first meaningful action under 30 seconds, median neutral journey under three minutes, median SEQ at least 6/7, and zero P0/P1 usability failures.

Use `npm run ease:human-study -- help` and
`docs/FRESH_HUMAN_USABILITY_STUDY.md` to capture each real observation. The operator generates an
anonymous ID, rejects participant PII flags, records hash-chained OS-monotonic events, requires an
exact completion PNG, and materializes the existing evaluator-compatible shape without overwriting
prior evidence. `proof/ease/fresh-users.template.json` remains a not-run example, not evidence.

## Required repeatability

- Developer: exactly five cold and five warm trials for Windows/npm, Windows/pnpm, Ubuntu/npm, Ubuntu/pnpm, macOS/npm, and macOS/pnpm for one immutable commit/source-hash/tarball identity. Each raw timing receipt carries a self-hash over its complete body, the generated application identity, generated candidate archive identity, detailed launcher/app/browser installation times, package-manager version, and GitHub run/attempt/workflow/runner-image provenance. The evaluator recomputes all 60 hashes, rejects duplicate run IDs or hashes and extra/missing runs, and emits all 60 rows in `selectedRuns`; aggregate timing cells alone can never pass submission.
- Coding agent: for each of the three held-out tasks, run exactly three fresh Codex sessions, one fresh Claude Code session, and one fresh lower-cost-agent session: 15 exact-candidate trials total. Pin and record the exact model for every live session; use a materially lower-cost model for the lower-cost slot. Report every attempt; any failed or additional v2 attempt bound to the candidate blocks the matrix instead of being cherry-picked away. Use `proof/ease/fresh-agent-matrix.template.json` as the execution ledger.
- End user: five uncoached people.
- Convex: NodeRoom, NodeSlide, and NodeVideo must materially adopt the same lifecycle and pass reactive two-session, reload, preview, and fresh-user journeys.

For the developer matrix, freeze and push the exact candidate, then dispatch the workflow once per
cache class:

```bash
gh workflow run ease-proof.yml --ref <frozen-ref> -f cache_class=cold
gh workflow run ease-proof.yml --ref <frozen-ref> -f cache_class=warm -f paired_cold_run_id=<successful-cold-run-id>
```

Each deliberate dispatch expands to five isolated runners for every OS/package-manager lane (30
receipts). The warm dispatch is accepted only when it names the successful cold run for the same
frozen candidate. It downloads both exact runs, aggregates them together, and uploads canonical
`proof/ease/developer-timing-runs.json` and its verdict. Pull-request runs remain a
one-trial-per-lane smoke matrix and cannot accidentally count as cold or warm evidence. The
evaluator still rejects any missing, extra, duplicated, conflicting, cross-candidate, or unpaired
receipt.

The timing limits are preregistered in `src/lib/ease-evidence.mjs`, not supplied by a result file. Every
individual run must remain at or below 30 seconds for scaffold, compile, server readiness, and first
meaningful paint; 180 seconds for all dependency installation; 60 seconds for the neutral journey;
and 600 seconds overall. Every five-run cell must have medians at or below 10 seconds for scaffold
and first meaningful paint, 20 seconds for compile, 15 seconds for server readiness and the neutral
journey, 240 seconds overall, and dependency-installation medians of 60 seconds cold or 30 seconds
warm. A single per-run violation or a slow cell fails the whole matrix.

## Submission evidence closure

The submission manifest is a byte-level closure, not a list of summary verdicts. `submission:prepare`
rehashes each decisive verdict and every file that verdict relies on, then lists the complete set in
the corresponding gate. `submission:evaluate` independently derives the expected set from the
decisive verdict, rejects missing or extra entries, and rehashes every byte again.

- Developer timing includes `proof/ease/developer-timing-runs.json`; the evaluator recomputes the
  verdict from all 60 complete self-hashed receipts and requires an exact match.
- Fresh-agent evidence uses unambiguous repository-relative paths. Each of 15 manifests and all 19
  direct evidence files per run remain required. The candidate-owned browser closure is diagnostic;
  the decisive evaluator separately contributes one protected manifest, 180 protected PNGs, and 180
  protected sidecars per run. The trial runner, aggregate evaluator, and final signer reopen the full
  protected closure, validate PNG CRC/dimensions/decoded pixels, reject visual reuse, recompute its
  evidence root, and bind it through the protected evaluation. A candidate-authored browser script,
  self-asserted task result, metadata-only PNG variation, or zero exit code cannot certify itself.
- Human, consumer, preview, managed-Supabase, protected knowledge-evolution, model-intelligence,
  engineering-health, and ProofLoop verdicts carry typed repository-relative evidence references.
  Consumer and preview evidence kinds are exact, not minimum counts.
- Managed Supabase requires an externally attested hosted run proving owner-scoped auth, RLS write
  denial, principal-derived proposal RPC, real Storage bytes, Realtime delivery, queue isolation and
  consumption, bounded Cron, and Convex-to-Supabase artifact/receipt hash preservation.
- Knowledge Evolution requires an externally attested protected comparison of flat, static-graph,
  and evolving-graph modes plus a real consumer adoption. Evolving behavior must improve or hold
  both baselines; the protected evaluator identity cannot change.
- Model Intelligence requires an externally attested live exact-model observation, protected
  application gym, independent evaluation, and fresh-agent canary. Its outcome remains provisional;
  it cannot self-promote a model or mutate the protected evaluator.
- Engineering health requires ten exact-candidate machine command receipts and a machine issue
  inventory. Evaluation reopens each receipt, recomputes candidate/source identity and exit status,
  recounts open P0/P1 issues, and requires both counts to be zero.
- Package proof creates two independent archives and requires byte-identical tarball hashes,
  byte-identical npm file manifests, and byte-identical independently reopened per-file hash
  manifests. It includes the canonical `.tgz`, all exact runtime/install and distribution checks,
  the generated package and lockfile, `npm ls`, command ledger, installed-runtime identity,
  application identity, demo/eval binding record, and a reconstructable generated-candidate archive.

Every path must be a portable repository-relative POSIX path. The verifier resolves the real
repository and real evidence path, rejects non-files and direct symlinks, rejects parent symlinks or
junctions that escape the repository, verifies declared byte counts where present, and compares the
actual SHA-256 digest. Git cleanliness uses NUL-delimited porcelain output and preserves both ends
of rename/copy records, including filenames containing whitespace or newlines. Moving dirty source
under `docs/` or `proof/` therefore cannot make a candidate appear exact.

## Submission formula

```text
SUBMISSION_READY =
  blank_factory_cross_platform_pass
  AND cold_setup_timer_pass
  AND fresh_agent_heldout_pass
  AND responsive_ui_matrix_pass
  AND accessibility_pass
  AND fresh_human_usability_pass
  AND convex_real_consumer_count >= 3
  AND fresh_preview_deployment_pass
  AND managed_supabase_portability_pass
  AND knowledge_evolution_protected_comparison_and_adoption_pass
  AND model_intelligence_harness_and_fresh_canary_pass
  AND exact_candidate_engineering_health_pass
  AND proofloop_ease_verification_pass
  AND exact_package_install_proof_pass
  AND unresolved_P0_count == 0
  AND unresolved_P1_count == 0
  AND purpose_scoped_publication_approval_pass
```

Until every term is supported by evidence, the only valid public status is `EASE_NOT_CERTIFIED`, `BLOCKED_HUMAN_TEST`, or `BLOCKED_EXTERNAL`. Both implementation PRs stay draft; no Convex Component is extracted or submitted.

Detached external-review and publication signatures use purpose-scoped trust keys; see
[Trusted submission attestations](./ATTESTATIONS.md). A key trusted for one gate is never globally
trusted for another.
