# Convex consumer audit

Audit date: 2026-07-22

This audit answers one narrow submission question: do three materially different Convex applications consume the portable NodeKit Caseflow contract through authenticated, owner-scoped wrappers and pass the packaged conformance behavior?

## Verdict

**The submission-grade consumer count remains 0/3.**

All three applications already contain useful Caseflow-like behavior. None of the three locally recorded `origin/main` revisions imports `@homenshum/nodekit`, exposes a Convex adapter for the portable Caseflow API, and runs `runCaseflowConformance()` against that adapter. Existing domain tests are valuable prerequisite evidence, but they are not package-consumption evidence.

Do not extract, publish, or submit NodeKit Caseflow yet.

The audit used the local `origin/main` refs listed below without fetching or mutating a consumer repository. A release audit must fetch and re-pin all three refs before accepting them as current upstream state.

## Counting rule

A consumer counts only when one reviewed revision proves all of the following:

1. It consumes the packed `@homenshum/nodekit` boundary rather than a copied source implementation.
2. A Convex adapter maps the application's real lifecycle to `Case`, `Run`, `Stage`, `Artifact`, `Proposal`, `Exception`, and `Receipt` semantics.
3. An application-owned wrapper authenticates the caller and resolves an owner or workspace before invoking lifecycle operations.
4. Stale writes fail closed; idempotent retry/reuse, exception recovery, explicit next-action ownership, and content-addressed completion receipts are exercised.
5. The packaged `runCaseflowConformance()` behavior runs against the Convex adapter with `convex-test`.
6. Component-owned and application-owned data are documented.

Passing similar domain tests without the shared package does not demonstrate reuse. Importing the package without authenticated, real-backend behavior does not demonstrate production adoption.

## Audited revisions

| Lane | Repository | Local `origin/main` revision | Working-copy note |
|---|---|---|---|
| NodeRoom / NodeSheet artifact collaboration | `D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom` | `c3143fcbe8dcbc4d4f3b31392854cc546fd9f1c2` - `docs: publish Casca FDE NodeRoom proof package (#240)` | Working branch `codex/nodekit-contract-alignment` was 1 ahead and 27 behind; audit used `origin/main`. NodeRoom is the finance/spreadsheet consumer in this workspace; no separate canonical NodeSheet repository was found. |
| NodeSlide presentation production | `D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\NodeSlide` | `4ac27f7fecb7c98229aca200e8e840c65e7dfb4f` - `ci(packages): prove packed consumer boundary (#9)` | Working branch `codex/injectable-core` was 1 ahead and 14 behind; audit used `origin/main`. |
| NodeVideo long-running artifact workflow | `D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\NodeVideo` | `7a741cb606ac64a05bb1eb5ed57429082b97ed5e` - `Export accepted edits as local MP4 (#31)` | Working tree and `origin/main` pointed at the same commit. |

## Evidence matrix

| Requirement | NodeRoom / NodeSheet | NodeSlide | NodeVideo |
|---|---|---|---|
| Packed `@homenshum/nodekit` consumption | **No** | **No** | **No** |
| Existing Caseflow-like lifecycle | Strong room/job/artifact/proposal lifecycle | Strong portable deck repository, proposal, version, and receipt contracts | Strong case/job/stage/artifact/proposal/receipt lifecycle |
| Authenticated owner/workspace wrapper | **Strong prerequisite:** `ctx.auth` plus verified room membership in production | **Gap:** opaque owner bearer capability, not `ctx.auth` identity/organization ownership | **Gap:** plane-wide environment bearer tokens and caller-supplied `projectId` |
| Stale-write/CAS behavior | Yes, real Convex element and artifact CAS | Yes in the memory repository and deck patch engine; not proven as shared Convex Caseflow | Partial: recipe-version validation and lease fencing, but no portable artifact-version conformance |
| Idempotency/retry | Yes, real Convex claim-or-reuse and journal retry coverage | Yes in memory repository resolution/apply behavior; no real Convex adapter proof | Yes in schema/workflow primitives; only helper-level durability tests found |
| Exception recovery/next owner | Domain recovery exists; portable Caseflow exception semantics not mapped | Not mapped to portable Caseflow | Stage retry/cancel exists; portable exception and next-owner semantics not mapped |
| Receipts | Extensive domain proof and audit receipts | Portable NodeSlide receipt envelope in memory repository | Freeze and evaluation receipts plus job events |
| Packaged Caseflow conformance on Convex | **No** | **No** | **No** |
| Submission-grade consumer | **0** | **0** | **0** |

## Consumer findings

### 1. NodeRoom / NodeSheet

NodeRoom is the most production-shaped authorization and collaboration consumer.

Existing evidence:

- `convex/lib.ts` implements `requireActorProof()`. In production identity mode it requires `ctx.auth.getUserIdentity()`, matches the authenticated subject to the room member, and rejects revoked or mismatched members.
- `convex/artifacts.ts` implements proposal-before-apply, per-element and artifact-version CAS, conflict-as-data, final validation on approval, and receipt/audit updates.
- `convex/agentRuns.ts` and `convex/agentJobs.ts` contain idempotency-key claim/reuse and durable execution machinery.
- `tests/deckObjectCas.test.ts` exercises two users, stale overwrite rejection, agent proposal approval, invalid proposal rejection, history, and restoration against `convex-test`.
- `tests/idempotencyRuntime.test.ts` exercises atomic claim-or-reuse and retry/accounting behavior against the real Convex functions.
- `tests/freshRoomProofReceipts.test.ts` validates structured screenshot, trace, export, reopen, scorer, and model-accounting requirements for domain proof receipts.
- `tests/nodeSlideHostAuthorization.test.ts` proves verified membership, role-scoped read/propose/apply rules, resource scoping, and credential-free authorization evidence for the mounted NodeSlide surface.

Why it does not count:

- `package.json`, the lockfiles, `nodekit.yaml`, and application sources do not consume `@homenshum/nodekit` or call `runCaseflowConformance()`.
- The room lifecycle has not been adapted to the portable Caseflow method surface.
- Domain traces and proof receipts have not been normalized into a content-addressed Caseflow completion receipt.
- Component-owned versus NodeRoom-owned tables are not documented as an extraction boundary.

Smallest adoption patch:

1. Add the packed `@homenshum/nodekit` artifact to the test/build dependency boundary.
2. Add `src/integrations/nodekit/caseflowAdapter.ts` that maps existing room, job, artifact, proposal, exception/recovery, and receipt operations to the portable runtime without replacing `RoomTools` or NodeRoom's CAS spine.
3. Add application-owned Convex wrappers that call `requireActorProof()` first and pass only resolved `roomId`, member ID, role, and scoped resource IDs into the adapter.
4. Add `tests/nodekitCaseflowConformance.test.ts` using `convex-test`, the packaged conformance runner, two authenticated members, stale proposal rejection, retry/reload, and receipt hash verification.
5. Document NodeRoom-owned membership, domain artifacts, and export data versus the future Caseflow component's isolated lifecycle records.

### 2. NodeSlide

NodeSlide is closest to an injectable domain package, but the proven portable repository is currently memory-backed rather than a NodeKit Convex consumer.

Existing evidence:

- `packages/backend/src/index.ts` defines a backend-neutral `NodeSlideRepository`, normalized `NodeSlidePrincipal`, versioned patch commands, proposal resolution, asset storage, telemetry, and a portable receipt envelope.
- `packages/testing/src/conformance.ts` proves that proposal creation does not mutate the canonical deck and acceptance advances the authoritative version exactly once.
- `packages/testing/src/memoryRepository.ts` implements idempotent apply/resolve behavior, stale-proposal conflict handling, versions, authorization callbacks, and receipts.
- `packages/testing/src/memoryRepository.test.ts` exercises the conformance flow, two proposals racing from the same base version, stale receipts, and idempotent results.
- `convex/lib/nodeslideAccess.ts` correctly treats a deck ID as a locator rather than authority and gates operations with an unguessable owner capability.

Why it does not count:

- Its package set is `@nodeslide/contracts`, `@nodeslide/backend`, and `@nodeslide/testing`; none imports `@homenshum/nodekit`.
- No Convex-backed implementation of `NodeSlideRepository` exists under the extracted package boundary.
- `requireOwnerAccess()` checks a raw bearer capability stored with the deck. No application-owned `ctx.auth` wrapper binds the principal to an authenticated user or organization.
- The NodeSlide repository conformance suite is domain-specific and is not the packaged NodeKit Caseflow conformance suite.

Smallest adoption patch:

1. Keep the existing deck repository contract and add a thin `packages/convex-caseflow` adapter rather than moving slide logic into NodeKit.
2. Add an application-owned Convex wrapper that derives a `NodeSlidePrincipal` from `ctx.auth`, verifies deck/workspace ownership, and only then calls the adapter. Retain owner capabilities only as an explicitly bounded preview/bootstrap mechanism, not as the submission-grade owner identity.
3. Map deck to artifact, generation attempt to run, deck patch to proposal, validation failure to exception, and `NodeSlideReceipt` to a Caseflow receipt reference.
4. Run packaged `runCaseflowConformance()` through `convex-test`, then add authenticated cross-owner denial, same-base proposal race, idempotent repeat decision, reload/version, and receipt-hash tests.
5. Document which deck/media rows remain application-owned and which lifecycle rows would be component-owned.

### 3. NodeVideo

NodeVideo is the closest structural candidate for the long-running workflow lane, but its authority boundary and tests are not yet submission-grade.

Existing evidence:

- `convex/schema.ts` owns `sourceOnlyCases`, jobs, stages, events, artifacts, proposals, freeze receipts, and evaluation receipts.
- `convex/workflow.ts` implements idempotent case/job creation, stage leases, retries, cancellation, proposal approval binding, frozen generation inputs, and evaluation unsealing.
- `convex/lib/durability.ts` supplies canonical JSON, input-digest reuse checks, lease fencing, and digest validation.
- `tests/unit/durability.test.ts` tests canonical hashes, idempotent-input conflicts, stale lease fencing, monotonic event sequence numbers, and approval binding.
- `src/lib/nodeVideoWorkflowCandidate.test.ts` rejects stale recipe versions and incomplete or mismatched candidates and emits an application-validation/CAS-review receipt.

Why it does not count:

- No source or package manifest imports `@homenshum/nodekit` or runs packaged Caseflow conformance.
- Owner HTTP routes in `convex/http.ts` authorize one environment token (`NODEVIDEO_OWNER_TOKEN`) and then call internal functions. They do not resolve a user, organization, workspace, or project owner through `ctx.auth`.
- `projectId` is caller-supplied lifecycle scope; the schema does not bind it to an authenticated owner.
- No `convex-test` coverage was found for the real workflow functions, so helper tests do not prove transactional behavior of the packaged API.
- Stage retry/cancel and freeze/evaluation receipts are not mapped to portable exception recovery, explicit next-action ownership, and the Caseflow completion receipt.

Smallest adoption patch:

1. Add the packed `@homenshum/nodekit` boundary and a NodeVideo Caseflow adapter over the existing tables; do not replace the working stage engine.
2. Add an application-owned owner API that authenticates a user, resolves an owned project/workspace, and supplies that server-resolved scope. Keep separate worker/evaluator service credentials for machine planes.
3. Map case/job/stage/artifact/proposal/retry/freeze receipts to the portable runtime and emit a content-addressed completion receipt referencing NodeVideo's domain receipts.
4. Add `convex-test` coverage that invokes the packaged conformance runner and separately proves cross-owner denial, duplicate start reuse, stale proposal failure, lease-recovery resume, reload, and receipt integrity.
5. Document NodeVideo media, hidden evaluator data, and worker artifacts as application-owned; only shared lifecycle state is a Caseflow extraction candidate.

## EvoGraph-R1 integration consequence

EvoGraph-R1 is not absent from NodeKit. The adapted pattern already exists in:

- `src/lib/knowledge-evolution.mjs` and `docs/KNOWLEDGE_EVOLUTION.md`: a persistent, versioned knowledge environment with typed gaps, evidence-grounded graph patches, explicit approval, stale-version rejection, replay, and evolution receipts;
- `src/lib/evolution-ledger.mjs` and `docs/EVOLUTION_LEDGER.md`: human-reviewed causal memory for product, architecture, and harness evolution;
- the `nodekit graph ...` and `nodekit evolution ...` CLI families.

The missing integration is consumer evidence flow. Each adoption patch should produce immutable evidence from its packaged Convex conformance run, record a human-reviewed evolution event, and propose a Knowledge Evolution graph patch linking:

```text
consumer revision
+ packed NodeKit version and config hash
+ authenticated wrapper
+ Caseflow conformance receipt
+ stale/idempotency/recovery evidence
+ browser/export proof where applicable
```

The graph must not grant adoption status automatically. `nodekit evolution verify` and human review remain the authority boundary, and `nodekit evolution sync-graph` must continue to create a proposal rather than mutating canonical knowledge directly.

## Ordered closure plan

1. **NodeVideo first:** its persisted lifecycle already resembles Caseflow. Close authenticated project ownership and real `convex-test` conformance.
2. **NodeRoom / NodeSheet second:** adapt the mature auth, CAS, idempotency, and receipt spine without replacing domain collaboration logic.
3. **NodeSlide third:** retain the clean injectable repository packages, add a real Convex adapter, and replace owner-capability-only authority with an authenticated host wrapper for the certification lane.
4. For each accepted consumer revision, ingest its immutable proof into the Evolution Ledger and propose the associated Knowledge Evolution update.
5. Re-audit all three fetched upstream commits. Count a lane only after its package import, authenticated wrapper, packaged conformance result, and proof artifacts are present in the same reviewed revision.
6. Extract the smallest repeated Convex lifecycle kernel only after the count reaches 3/3. Then run the component's own `convex-test`, packed example, timer, screenshot, fresh-coding-agent, and production proof gates before submission.

## Current blocker statement

The blockers are not missing ideas. The shared Caseflow contract, Knowledge Evolution plane, Evolution Ledger, and substantial domain behaviors exist. The blockers are **cross-repository adoption evidence and authenticated backend convergence**. Until those are closed, claiming three consumers or submitting a reusable Convex component would overstate what the code proves.
