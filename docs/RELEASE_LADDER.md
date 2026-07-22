# NodeKit release and certification ladder

Overall verdict: **`EASE_NOT_CERTIFIED` - DO NOT SUBMIT**

Engineering readiness, packaged-factory proof, ease certification, Convex adoption, backend
portability, knowledge evolution, publication, and directory submission are separate tracks. Passing
one track never silently advances another, and evidence never carries forward across source changes.

## E0 - Engineering integration

Status: **under final integration review**.

Requires reviewed contracts, no unresolved P0/P1 engineering defect, complete repository tests,
component tests, public type checks, build/package checks, audits, and registry/ecosystem checks.
The current implementation is substantial, but this status intentionally does not claim the mutable
working tree has completed the final full-suite loop.

On a clean frozen revision, run:

```bash
npm run candidate:check
npm run candidate:prove -- --candidate <40-character-commit> --source-hash <64-character-sha256>
```

The first command is a read-only identity, issue-input, packed-surface, and browser-contract
preflight. The second records exactly ten local engineering checks (`repositoryTests`,
`componentTests`, `publicTypecheck`, `componentTypecheck`, `componentBuild`, `packageAudit`,
`registry`, `ecosystem`, `evolution`, and composite `distributionClean`). `distributionClean`
performs the exact package/archive proof and executes the structural live HTTP browser contract in
an application created from that tarball. The resulting `nodekit.engineering-health-verdict/v1`
references candidate-scoped, schema-validated command receipts and issue inventory by SHA-256.
It is not rendered-browser, hosted, human, consumer, deployment, publication, or submission
certification and does not advance E2, E3, C1, C2, or C3.

## E1 - Deterministic packaged factory

Status: **implemented; exact final-candidate proof pending**.

Requires one immutable candidate to pass fresh packed installation, empty-directory creation,
compile, check, no-key demo, eval, installed Convex component execution, and receipt validation.

## E2 - Revision-bound interaction and ease beta

Status: **incomplete for the final candidate**.

Requires the exact local browser journey with proof-bundle download/reopen and hash checks, exactly
60 hosted timing runs, exactly 15 real fresh-agent v2 sessions, and formative usability repair. Small
timing samples report `n`, median, range, and observed maximum, not a misleading p95.

## E3 - Ease certified

Status: **not certified**.

Requires five consented humans with at least four unassisted completions and the defined timing/SEQ
thresholds, a confirmation cohort after repairs when required, deployed first-user proof, and final
independent transitive ProofLoop verification.

## C0 - Convex component engineering candidate

Status: **implemented locally; final-candidate verification pending**.

The isolated Caseflow component, typed client/validators, local `convex-test`, and installed-package
runtime proof exist. This level proves package mechanics only; it is not real application adoption.

## C1 - Convex adoption proven

Status: **0/3 qualifying consumers**.

Requires three materially different applications, including NodeRoom/NodeSheet, NodeSlide, and
NodeVideo or equivalents, to use the exact packed component through authenticated owner-scoped
wrappers. Each must prove reactivity, idempotency, conflict/reload safety, exception recovery,
receipt integrity, and application/component ownership boundaries.

## C2 - Submission candidate

Status: **blocked by adoption and final evidence**.

Requires C1, an installable example, upgrade story, final package proof, exact isolated preview,
complete recursive evidence manifest, and independent review. Consumer evidence may require changes
to the locally extracted boundary.

## C3 - Convex directory submission

Status: **blocked**.

Requires a published exact npm package, explicit publication and submission authority, accurate
documentation, final component proof, and `submissionReady: true`. Until then: **DO NOT SUBMIT**.

## P1 - PostgreSQL implementation

Status: **implemented; earlier live conformance passed**.

The driver-neutral adapter and shared conformance suite exist. A prior revision passed live
PostgreSQL 17.10; rerun live conformance after the final candidate freezes.

## P2 - Supabase managed profile

Status: **local contract implemented; live proof incomplete**.

The Auth-derived authority, RLS boundary, proposal RPC, Storage policies, Realtime publication, and
server-only PGMQ/pg_cron module exist locally. A provisioned project must still prove Auth, RLS,
Storage bytes, Realtime delivery, queue isolation/consumption, and bounded Cron execution.

## P3 - Backend portability proven

Status: **incomplete**.

Requires final-candidate PostgreSQL and Supabase receipts plus Convex export to Supabase import with
matching canonical artifact and receipt hashes.

## K1 - Knowledge Evolution engineering

Status: **implemented locally**.

The EvoGraph-R1-inspired governed hypergraph, proposal/approval/conflict semantics, evidence anchors,
replay, receipts, CLI, Evolution Ledger, and Harness projection exist.

## K2 - Knowledge Evolution adoption

Status: **incomplete**.

Requires protected flat/static/evolving comparisons on real tasks and verified downstream consumer
adoption. Fixture-only results cannot certify an improvement or promotion.
