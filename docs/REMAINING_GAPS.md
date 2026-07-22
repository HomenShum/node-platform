# NodeKit remaining-gap ledger

Status date: 2026-07-21

This is the authoritative distinction between work NodeKit can close inside this repository and evidence that must come from independent people, authenticated applications, or provisioned services. A missing external receipt is a real blocker, not permission to synthesize one.

## Closed in the repository

- [x] Domain-blank factory, portable compiled identity, deterministic memory Caseflow, proposal-before-apply, conflict safety, receipts, and no-key demo.
- [x] Rendered browser certification across 15 lifecycle states, six viewport/theme profiles, exact PNG sidecars, Playwright trace/video, accessibility, console, network, overflow, mojibake, reload, and receipt checks.
- [x] Cold/warm cache isolation mechanics and normalized per-run timing receipts for all seven required phase measurements.
- [x] Cross-platform GitHub matrix definition for Windows, Ubuntu, and macOS with npm and pnpm.
- [x] Developer-timing aggregation and a fail-closed 60-run evaluator.
- [x] Disposable-container fresh-agent executor with read-only credentials, zero-reprompt ledger, substantive-edit gate, generated checks, screenshots, diff, transcript, and proof capture.
- [x] Model observation and capability-card compiler with exact requested/resolved model identity and project-first evidence precedence.
- [x] Executable skill contracts, evidence-threshold candidate proposals, fixed protected comparisons, regression rejection, routing decisions, independent tournaments, canary verification, manual proof-bound promotion, and rollback.
- [x] Automatic skill and routing promotion remains disabled.
- [x] Provider capability negotiation and the shared Caseflow conformance suite.
- [x] PostgreSQL schema foundation with transactional row locks and stale-proposal conditional apply.
- [x] Executable, owner-scoped PostgreSQL adapter with public TypeScript API and exact-revision live
  conformance on PostgreSQL 17.10, including same-base races, retries, recovery, reload, and receipts.
- [x] Supabase managed-profile foundation with owner-scoped RLS policies and explicit Realtime tables.
- [x] Submission manifest schema and evaluator requiring all evidence hashes plus explicit publication approval.

## Evidence collection still required

| Gate | Exact closure condition | Why it cannot be manufactured locally |
|---|---|---|
| Developer timing matrix | Five cold and five warm receipts for each Windows/Ubuntu/macOS x npm/pnpm lane; 60 total | Requires repeated independent hosted runners; automation exists but results must execute against the immutable revision |
| Fresh coding agents | Research-map, volunteer-onboarding, and launch-presentation held-outs all pass with zero reprompts | Requires three actual isolated model executions and their authentic transcripts |
| Fresh humans | Five consented participants; at least four unassisted; timing and SEQ thresholds pass; no P0/P1 issue remains | Agent simulations are not human usability evidence |
| Convex consumers | Authenticated NodeRoom/NodeSheet, NodeSlide, and NodeVideo wrappers each pass lifecycle and ownership conformance | The component boundary can only be discovered from real, materially different consumers |
| Preview proof | Exact commit deployed to isolated frontend/backend; fresh identity uploads real bytes, completes, exports, reopens, scores, and cleans up | Requires live deployment credentials and a deployment-bound browser journey |
| Supabase profile | Auth, RLS, Storage, Realtime, Queue, and Cron pass owner-scoped live conformance | Requires a provisioned Supabase project and authenticated multi-user tests |
| Final ProofLoop | Independent verifier re-hashes the final immutable candidate and every release receipt | Must run after all other receipts exist |
| Package/publication | Packed install example passes, npm publication is authorized, and a human approves final public claims | Publication is externally visible and intentionally last |

## Deterministic final rule

Copy `proof/submission-manifest.template.json` to `proof/submission-manifest.json` only after real evidence exists. Bind every file by SHA-256, then run:

```bash
npm run submission:evaluate
```

The Convex submission is authorized only when the resulting `proof/submission-verdict.json` contains both `passed: true` and `submissionReady: true`. Until then the honest verdict remains `EASE_NOT_CERTIFIED` and **DO NOT SUBMIT**.
