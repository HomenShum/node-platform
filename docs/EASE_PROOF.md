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
npm run acceptance:agent -- --task=volunteer-onboarding
```

The factory command produces phase-level timers, 36 candidate-bound PNGs across six viewports and two themes, screenshot sidecars, an archived generated candidate, and a fail-closed manifest under `proof/ease/latest/`.

The coding-agent command creates a new repository and a fresh ephemeral Codex session. It records the exact prompt, JSONL session, command hashes, token-bearing events, zero-intervention ledger, candidate diff/archive, post-agent gates, screenshots, and verdict. A process exit is insufficient: the run fails unless the agent makes substantive non-proof changes and its final report is not blocked. One successful run is a pilot, not repeatability certification.

## Human protocol

Recruit at least five people who did not build NodeKit. Give only:

> Use this app to complete the job shown on screen.

For each participant record UTC start/end, first meaningful action, completion, wrong turns, help requests, unclear terms, backtracking, whether they can explain what happened, whether they can find the canonical artifact and unresolved issues, and a 1–7 Single Ease Question score. Do not coach.

The human gate requires at least 4/5 unassisted completions, median first meaningful action under 30 seconds, median neutral journey under three minutes, median SEQ at least 6/7, and zero P0/P1 usability failures.

Use `proof/ease/fresh-users.template.json` as the append-only recording shape. Identifying information is intentionally excluded.

## Required repeatability

- Developer: five cold and five warm trials for Windows/npm, Windows/pnpm, Ubuntu/npm, Ubuntu/pnpm, macOS/npm, and macOS/pnpm before percentile claims.
- Coding agent: three fresh Codex sessions for each of the three held-out tasks, plus one fresh Claude Code session and one lower-cost-agent session per task. Report every attempt.
- End user: five uncoached people.
- Convex: NodeRoom, NodeSlide, and NodeVideo must materially adopt the same lifecycle and pass reactive two-session, reload, preview, and fresh-user journeys.

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
  AND proofloop_ease_verification_pass
  AND unresolved_P0_count == 0
  AND unresolved_P1_count == 0
```

Until every term is supported by evidence, the only valid public status is `EASE_NOT_CERTIFIED`, `BLOCKED_HUMAN_TEST`, or `BLOCKED_EXTERNAL`. Both implementation PRs stay draft; no Convex Component is extracted or submitted.
