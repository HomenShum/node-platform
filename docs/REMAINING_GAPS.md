# NodeKit remaining-gap ledger

Status date: 2026-07-22

Certification verdict: **`EASE_NOT_CERTIFIED`**

Submission verdict: **DO NOT SUBMIT**

This ledger separates implementation from evidence. A feature can be implemented and locally tested
without certifying the current revision, real users, a managed service, or a public submission. A
missing external receipt is a real blocker and must never be replaced with synthetic evidence.

## Closed locally

- [x] Domain-blank empty-directory factory and brownfield adoption path.
- [x] Portable Caseflow contracts, deterministic memory runtime, proposal-before-apply, stale-write
  conflicts, safe recovery, terminal receipts, and provider-neutral content hashes.
- [x] Driver-neutral PostgreSQL adapter with transactions, owner scoping, row/advisory locks,
  conditional artifact versioning, and shared conformance coverage. An earlier revision also passed
  live PostgreSQL 17.10 conformance; that receipt is regression history, not final-candidate proof.
- [x] Convex Caseflow component and public client/package surface, including local `convex-test` and
  fresh packed-consumer execution of the installed component. This does not count as adoption by a
  real authenticated application.
- [x] Supabase local managed profile: authenticated owner reads, denied direct lifecycle writes,
  principal-derived proposal RPC, explicit Realtime publication, owner-folder Storage policies,
  and opt-in server-only PGMQ/pg_cron provisioning. Live managed-service behavior is not certified.
- [x] Responsive lifecycle UI and browser-certification machinery, including a real proof-bundle
  download, reopen, artifact-hash check, and receipt-body-hash check.
- [x] Exact evidence schemas and evaluators for a 60-run timing matrix, a 15-run fresh-agent v2
  matrix, five-person usability, package installation, preview proof, and final submission.
- [x] Detached Ed25519 attestations for every externally observed decisive gate, with caller-owned
  trusted keys and signatures bound to the exact commit, source identity, tarball, verdict body,
  and canonical underlying-evidence root. Unsigned measurements remain usable as raw evidence but
  cannot pass the submission gate.
- [x] Recursive submission-evidence verification that is designed to re-hash decisive receipts,
  their nested evidence, and the packed tarball while rejecting missing, duplicate, escaping,
  symlinked, or tampered paths.
- [x] EvoGraph-R1-inspired Knowledge Evolution Plane and Evolution Ledger: governed hypergraph
  patches, immutable evidence, human-reviewed causal records, replay, receipts, CLI operations, and
  Harness Gym projection.
- [x] Provider-neutral bounded research collection and byte-authenticated evidence snapshots:
  exact URI/time/raw-byte SHA provenance, separate normalization, content-addressed storage,
  attributed multimodal locators, freshness/hash recheck, proposal-only graph changes, and
  adversarial path/symlink/duplicate/mismatch/limit coverage.
- [x] Provider-neutral accepted-knowledge runtime: typed hypergraph traversal, canonical-only
  Caseflow context packs, exact source/evolution provenance, repeat-session retrieval, safe
  abstention, tenant isolation, transactional PostgreSQL projection, and protected
  flat/static/evolving comparison mechanics. This engineering pass does not claim real-task or
  consumer adoption.

## Candidate-freeze work

- [ ] Finish integrating and independently reviewing the current lifecycle, portability, package,
  browser, protected-evaluator, evidence-verifier, attestation, and Knowledge Evolution changes.
- [ ] Re-run the complete repository and component tests, public and component TypeScript checks,
  component build, production dependency audit, registry check, ecosystem check, and Evolution
  Ledger verification after the final source change. A historical pre-hardening run passed 205 Node
  tests, eight component tests, both TypeScript surfaces, the component build, a zero-vulnerability
  production audit, registry and ecosystem conformance, and Evolution Ledger verification; those
  results do not certify the current mutable working tree.
- [ ] Freeze one clean immutable commit and compute its NodeKit source identity.
- [ ] Re-run the packed-consumer component proof and local browser download/reopen proof against
  that exact commit. Historical or mutable-working-tree receipts do not qualify.
- [ ] Update the submission manifest only from authentic evidence bound to that same candidate;
  the recursive evaluator must fail while any required evidence is absent.

## External or adoption evidence still open

| Gate | Exact closure condition | Why local implementation is insufficient |
|---|---|---|
| Developer timing | Exactly 60 candidate-bound runs: five cold and five warm for each Windows/Ubuntu/macOS x npm/pnpm lane | Requires the six real hosted OS/package-manager lanes; no aggregate-only or duplicate receipt qualifies |
| Fresh coding agents | Exactly 15 isolated real CLI sessions: three tasks x (Codex x3, Claude x1, lower-cost x1), all zero-reprompt and candidate-bound | Fixture simulations and earlier-revision transcripts do not prove a fresh agent can specialize the final candidate |
| Fresh humans | Five consented participants, at least four unassisted, required timing/SEQ thresholds, and no unresolved P0/P1 usability issue | Agents cannot substitute for human usability evidence |
| Convex consumers | Three materially different, authenticated, owner-scoped applications use the exact packed component and pass lifecycle/ownership proof | Local `convex-test`, copied adapters, and sidecar integrations are package proof, not consumer adoption |
| Preview | Exact commit deployed to isolated frontend/backend; fresh identity completes the rendered journey, downloads, reopens, independently scores, and cleans up | Requires authorized deployment credentials and deployment-bound evidence |
| Supabase | Auth, RLS, Storage bytes, Realtime delivery, queue isolation/consumption, and bounded Cron invocation pass in a provisioned project | Local SQL parsing and disposable PostgreSQL cannot certify Supabase-managed services |
| Knowledge evolution | Protected real-task comparisons and verified consumer adoption demonstrate that evolving knowledge improves or safely holds performance | Implemented graph mechanics alone do not prove useful adoption |
| Model/Harness learning | Live exact-model observations, a protected application gym, independent evaluation, and a fresh-agent canary produce a provisional promotion receipt | Fixture-based machinery cannot certify a model or routing policy |
| Final ProofLoop | An independent verifier re-hashes the immutable candidate, every decisive receipt, and all transitive evidence | It must run after every other required receipt exists |
| Publication | Exact tarball is authorized for npm publication and a human approves the final public claims and Convex submission | Publication is externally visible and intentionally last |

The fresh-human collection mechanics are closed: `npm run ease:human-study -- help` now records
anonymous consented sessions with append-only monotonic timers and byte-addressed evidence, then
assembles all five exact-candidate attempts for the existing independent evaluator. The external
gap remains 0/5 because tooling cannot stand in for real people or their consent.

## Deterministic final rule

Create `proof/submission-manifest.json` only after the real evidence exists, bind every decisive and
nested file by SHA-256, then run:

```bash
npm run submission:evaluate
```

Submission is authorized only when `proof/submission-verdict.json` reports both `passed: true` and
`submissionReady: true` for the frozen candidate and explicit publication approval is present.
Until then: **`EASE_NOT_CERTIFIED` - DO NOT SUBMIT**.
