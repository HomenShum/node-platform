# NodeKit master plan and evidence checklist

Status: **engineering implementation substantially complete; final integration, Ease certification,
and Convex submission remain open**

Last reconciled: 2026-07-22

This document is the canonical strategic summary for NodeKit. It separates implemented behavior,
evidence-backed claims, active work, and future architecture. Detailed gate definitions remain in
`EASE_SUBMISSION_READINESS.md`, `CONVEX_CASEFLOW_EXTRACTION.md`, and `RELEASE_LADDER.md`.

## Locked thesis

> NodeKit is the domain-blank, figured-out foundation for agent applications and the improvement
> system for the harnesses that build and operate them.

Short form:

> **Blank in domain. Figured out in behavior. Convex-first, not Convex-locked.**

NodeKit standardizes the parts every serious agent application otherwise rebuilds:

- repository and coding-agent orientation;
- guided product progression;
- Caseflow lifecycle and canonical-state safety;
- agent authority, proposal, approval, and recovery boundaries;
- artifact-first responsive UI topology;
- deterministic demo, evaluation, proof, and deployment contracts;
- evidence-backed improvement of the builder, runtime, and interaction harnesses.

Domain applications still own the user's specific job, domain tools, artifact semantics, validators,
fixtures, and distinctive product experience.

## Current verdict

| Area | Evidence-backed status | Claim boundary |
|---|---|---|
| Domain-blank factory and neutral journey | IMPLEMENTED | Local deterministic and historical browser receipts exist; the final candidate must be rerun after source freeze |
| Portable Caseflow semantics | IMPLEMENTED | Memory, PostgreSQL, and Convex implementations share the lifecycle contract; current integration review is not yet a full-suite-green claim |
| PostgreSQL adapter | IMPLEMENTED; EARLIER LIVE PASS | A prior revision passed live PostgreSQL 17.10 conformance; final-candidate proof remains revision-bound |
| Convex component and package runtime | LOCAL ENGINEERING PASS | The component, client, validators, `convex-test`, and packed-consumer execution exist locally; this is not evidence of three authenticated consumers |
| Supabase managed profile | LOCAL CONTRACT IMPLEMENTED | SQL/profile and local harness cover the intended boundary; live Auth, RLS, Storage, Realtime, Queue, and Cron remain unproven |
| Exact browser export/reopen | IMPLEMENTED LOCALLY | The browser harness downloads and reopens the proof bundle and verifies artifact/receipt hashes; final-candidate and deployed-preview receipts remain open |
| Recursive submission evidence closure | IMPLEMENTED LOCALLY | The evaluator re-hashes decisive and transitive evidence and fails closed; a complete final manifest cannot exist until the external receipts do |
| Repeated cold/warm timing | HISTORICAL PASS ONLY | The exact gate is 60 runs: five cold and five warm for each Windows/Ubuntu/macOS x npm/pnpm lane; it must be rerun for the frozen candidate |
| Fresh coding-agent specialization | V2 HARNESS IMPLEMENTED | The exact gate is 15 real sessions across three tasks and five profile repetitions; earlier three-run evidence does not satisfy v2 |
| Fresh-human usability | 0/5 CURRENT-CANDIDATE PARTICIPANTS | Five real consented participants remain required |
| Submission-grade Convex consumers | 0/3 | Local component tests and preliminary sidecar integrations do not count as authenticated owner-scoped adoption |
| Shareable NodeKit factory preview | INCOMPLETE | Local browser proof is not an isolated deployed preview with fresh identity and cleanup |
| Harness Gym and Model Intelligence | ENGINEERING FOUNDATION | Schemas, compiler, comparisons, routing gates, and rollback exist; protected live-model/adoption evidence remains |
| Frontend Specialist | V1 ENGINEERING PASS | Tournament and canary mechanics exist; a real consumer tournament remains open |
| Knowledge Evolution Plane and Evolution Ledger | V1 ENGINEERING PASS | EvoGraph-R1-inspired governed graph and causal memory are implemented; protected real-task and consumer-adoption evidence remains |
| Convex directory submission | BLOCKED | `submissionReady` must be true for one immutable candidate and publication must be explicitly approved |

The current mandatory verdict is `EASE_NOT_CERTIFIED`. Do not submit NodeKit or Caseflow to the
Convex Components directory yet.

### Status at a glance

**Closed locally:** domain-blank factory; portable Caseflow; PostgreSQL adapter; Convex component and
installed-package runtime; Supabase local profile; exact browser download/reopen verification;
recursive evidence verifier; Knowledge Evolution and Evolution Ledger mechanics.

**Open locally:** integrate and independently review the current changes, run the complete suite,
freeze one immutable candidate, and regenerate its package and browser receipts. No claim in this
document says the current working tree has completed that final loop.

**Open externally:** the candidate-bound 60-run timing matrix, 15-run fresh-agent v2 matrix, five
real humans, three real authenticated Convex consumers, isolated preview proof, live Supabase proof,
protected real-task knowledge/model evidence, final independent ProofLoop, and publication approval.

## Stable product grammar

Every NodeKit application uses the same observable lifecycle:

```text
Case
→ Run
→ Stage
→ Artifact
→ Proposal
→ Approval
→ Receipt
```

Every state answers:

1. What has happened?
2. What is happening now?
3. Who owns the next action?
4. What is required to continue?
5. What happens afterward?

The default product standard is:

```text
One primary job
One obvious starting action
One guided progression
One canonical output
One recovery path
One verifiable completion state
```

## Architecture boundary

```text
User goal and evidence
        ↓
NodeKit orientation and figured-out compiler
        ↓
Domain application pack
        ↓
NodeKit experience layer
        ↓
NodeAgent execution and tool runtime
        ↓
Frontend Specialist + Model Intelligence + Harness Gym
        ↓
Evolution Ledger (human-reviewed causal memory)
        ↓
Knowledge Evolution Plane
        ↓
Portable Caseflow core
        ↓
Memory | Convex | PostgreSQL | Supabase
```

Provider mechanics may differ, but observable behavior may not. In particular, every backend must
preserve proposal-before-mutation, base-version checks, idempotency, explicit terminal states,
next-action ownership, safe failure, and content-addressed receipts.

Convex is the golden reactive implementation. It is not the semantic definition of NodeKit.
Shared product code and shared React components must consume NodeKit ports and view models rather
than importing provider-specific database documents or hooks.

The Knowledge Evolution Plane is a separate authority from Caseflow and imported code graphs. It
maintains a backend-neutral multimodal hypergraph across `source`, `derived`, `working`, `proposal`,
`canonical`, and `hypothesis` layers. Only a source-grounded, validated, explicitly accepted patch
against the current base version advances canonical graph state. See `KNOWLEDGE_EVOLUTION.md`.

## Primary creation experience

The public initialization path remains:

```bash
nodekit create my-app
cd my-app
pnpm demo
```

Rules:

- no domain preset picker;
- no silent research-loop default;
- no initial backend, framework, model, or artifact questionnaire;
- the base application is blank in domain and complete in behavior;
- the neutral demo is visibly labeled `NODEKIT SYSTEM DEMO`;
- use `nodekit adopt` for existing repositories;
- backend and provider decisions occur only after the coding agent understands the real job.

The generated repository must orient a fresh coding agent through this reading order:

1. `docs/FIGURED_OUT.md`
2. `product/BRIEF.md`
3. `product/AUDIENCE.md`
4. `product/USER_JOURNEY.md`
5. `product/SERVICE_BLUEPRINT.md`
6. `product/EXPERIENCE.yaml`
7. `docs/ARCHITECTURE.md`
8. `nodekit.yaml`
9. `nodeagent.yaml`
10. current proof receipts

## UI contract

NodeKit maintains a curated UI Gold Registry rather than copying entire product UIs.

```text
Generic primitives
→ agent primitives
→ Node trust components
→ artifact compositions
→ domain UI
→ optional expressive effects
```

The stable workspace topology is artifact-first:

- case and history navigation;
- primary artifact stage;
- adjacent agent/review rail;
- visible stage progress and current action;
- collected proposals and decisions;
- separate ephemeral activity;
- advanced traces available but secondary;
- stacked or tabbed mobile behavior rather than a crushed desktop layout.

## Caseflow component boundary

The future Convex submission is **NodeKit Caseflow**, not the entire NodeKit factory.

An isolated component and installed-package runtime now exist as a local engineering candidate. The
boundary is not submission-validated until three materially different authenticated consumers use
that exact packed component and reveal no application-specific assumptions.

Caseflow may own:

- cases, runs, stages, and timeline events;
- artifacts and artifact versions;
- proposals and approvals;
- exceptions and recovery state;
- receipts and external references.

Caseflow must not own:

- application authentication or organization roles;
- model providers, prompts, RAG, or general chat;
- arbitrary host-application artifacts;
- the NodeKit CLI, React experience kit, factory, or Harness Gym.

The host application authenticates the principal and passes scoped identity into the component.
Existing Convex Agent, Workflow, Workpool, streaming, RAG, Presence, rate-limit, and file components
should be composed rather than rebuilt.

## Harness Gym

Harness Gym is the next compounding layer:

> NodeKit builds the app, proves the app, and improves the harness future agents use to build and
> operate the app.

It treats three changeable harnesses and one protected evaluator as separate systems:

1. builder harness: repository map, required reading, references, commands, and completion contract;
2. runtime harness: planner, tools, context, routing, memory, retry, and authority policy;
3. interaction harness: UI topology, journeys, states, selectors, artifacts, and exceptions;
4. evaluation harness: frozen tasks, fixtures, judges, safety rules, and proof thresholds.

The optimizing agent may propose changes to the first three. It may not change held-out tasks,
official outcomes, decisive judges, safety requirements, or proof thresholds in the same candidate.

### Harness Gym implementation order

- [x] Add the `nodekit.harness/v1` schema and content-addressed harness identity.
- [x] Generate a minimal `harness/` directory after the first application vertical slice.
- [x] Add protected validation, held-out, and adversarial task indexes.
- [x] Add `init`, `baseline`, `inspect`, `diagnose`, `propose`, `benchmark`, `tournament`, `canary`,
  `review`, `promote`, `rollback`, `status`, and `gate` commands.
- [x] Require a hypothesis, expected impact, and risk for every harness candidate.
- [ ] Capture complete NodeTrace trajectories and separate task, artifact, UI, safety, efficiency,
  evidence, and human-preference verdicts.
- [x] Require fresh-agent canaries, rollback versions, and NodeProof promotion receipts.
- [x] Keep automatic promotion disabled by default.
- [ ] Implement NodeKit Builder Gym first.
- [ ] Implement NodeSlide Deck Gym, NodeVideo Creator Gym, and NodeRoom Collaboration Gym next.
- [ ] Prove Harness v1 beats or holds Harness v0 with a fresh agent on frozen tasks.

Harness Gym comes before NodeRL. Model training consumes accepted and rejected trajectories only
after documentation, tools, context, routing, UI contracts, and deterministic repair have been
optimized.

### Model Intelligence and Skill Compiler

Harness Gym now includes a first-class model-intelligence subsystem. Exact resolved models are
observed on real application task families; cognitive behavior, tool execution, artifact quality,
and efficiency are evaluated separately. Behavioral findings update scoped capability cards and
may later propose focused skill or routing changes.

Evidence precedence is `project > domain > ecosystem > unprofiled fallback`. A dynamic provider
alias never inherits another resolved model's card. Model, harness, tool-surface, context-policy,
and skill-stack identities are bound to every observation.

The future resolved stack is `role + domain + model adapter + guardrails + conditional recovery`.
Candidate skills and routes require controlled ablations, protected tasks, independent critics, a
fresh-agent canary, rollback, and NodeProof receipt. Automatic promotion remains disabled.

See `MODEL_INTELLIGENCE.md` for the canonical contracts and phase gates.

### Frontend Specialist Routing

Frontend work is a protected Harness Gym specialization rather than a prompt convention. The
product-design contract retains authority over the primary job, canonical artifact, required
states, mobile topology, evidence, approvals, and forbidden patterns. Model routing is evidence
ranked and remains unprofiled until real observations justify a preferred route.

Every major frontend must render exactly three materially different directions: collaborative
workspace, artifact studio, and domain-native. An independent critic performs pairwise selection;
the winner may receive only bounded repairs before a fresh-browser canary. Promotion requires the
exact model and commit, a fresh identity, complete desktop/mobile journeys, screenshots, NodeProof,
zero major findings, and human approval. Automatic deployment and promotion remain disabled.

See `FRONTEND_SPECIALIST.md` for the CLI and authority boundaries.

## Knowledge Evolution Plane

The graph is an agent environment, not merely a visualization:

```text
retrieve known subgraph
-> identify a gap or contradiction
-> perform bounded external research
-> anchor multimodal evidence
-> propose graph patch
-> validate and approve
-> apply atomically
-> retain evolution receipt
```

Implemented v1:

- [x] Add backend-neutral knowledge-state, graph, graph-patch, and action-receipt schemas.
- [x] Add immutable multimodal source anchors and n-ary hyperedges with typed roles.
- [x] Separate source, derived, working, proposal, canonical, and hypothesis layers.
- [x] Add INSERT, UPDATE, and DEPRECATE; omit destructive DELETE.
- [x] Require source grounding, schema validity, authority, freshness, and base-version checks.
- [x] Require an explicit approving principal before apply.
- [x] Preserve stale proposals as conflicts instead of overwrites.
- [x] Add query, gaps, diff, replay, benchmark, and action/evolution receipts.
- [x] Project Harness Gym observations into proposal-only task/model/harness/failure hyperedges.
- [x] Preserve the Understand Anything graph as read-only, commit-pinned code evidence.
- [ ] Run protected flat/static/evolving comparisons on real application tasks.
- [ ] Add NodeGraph document/rendering, Neo4j traversal, Convex collaboration, and SQL persistence projections.
- [ ] Add graph-aware NodeRoom review and multimodal source-region navigation.
- [ ] Export trajectories to NodeRL only after protected rewards stabilize.

## Evolution Ledger

The Evolution Ledger is NodeKit's durable causal memory. It records human-reviewed evolution
events, challenged assumptions, invariant claims, immutable evidence, and consumer adoptions. Git
commits, content hashes, verifier references, model identity, sample size, viewport, and candidate
identity are checked where applicable. Records are append-only; corrections supersede history
instead of overwriting it.

The ledger can be queried and diffed, generates `EVOLUTION.md` and an adoption map, and can only
propose evidence-grounded Knowledge Evolution patches. It does not silently mutate the canonical
knowledge graph. CI blocks material product, schema, template, harness, ownership, or workflow
changes when the commit range contains no human-reviewed evolution event.

See `EVOLUTION_LEDGER.md` for record contracts and commands.

## Release ladder

```text
E0 Engineering merge
-> E1 Deterministic packaged factory
-> E2 Revision-bound rendered interaction proof
-> E3 Ease certification

C0 Local Convex component and package runtime
-> C1 Three qualifying authenticated consumers
-> C2 Component candidate validated by adoption
-> C3 Convex directory submission

P1 PostgreSQL implementation
-> P2 Supabase local managed profile
-> P3 Live portability and migration proof
```

The three tracks are related but not interchangeable. Passing local component tests does not prove
consumer adoption; passing PostgreSQL conformance does not prove Supabase-managed behavior; and a
historical Ease receipt does not certify a later source revision.

## Master checklist

### Proven foundation

- [x] Domain-blank base template.
- [x] Empty-directory-only `nodekit create` and brownfield `nodekit adopt` distinction.
- [x] Thin repository contract and compiled application identity.
- [x] Deterministic memory runtime.
- [x] Portable Caseflow lifecycle and stale-proposal semantics.
- [x] Neutral no-key demo from Case through Receipt.
- [x] Compile, check, evaluation, browser-contract, browser, and proof commands.
- [x] Exact factory phase ledger and content hashes.
- [x] Fifteen-state rendered browser harness.
- [x] Six viewport/theme profiles and the 180 PNG/JSON screenshot-pair contract.
- [x] Accessibility, overflow, console, network, mojibake, and exact export/reopen gates.
- [x] Proposal approval, canonical versioning, reload persistence, and safe conflict behavior.
- [x] Historical independent ProofLoop archive and screenshot re-hash; final-candidate rerun remains open.
- [x] Historical npm/pnpm compatibility coverage on Windows, macOS, and Ubuntu; the final exact
  60-run matrix remains open.

### Ease certification

- [x] Implement a fail-closed evaluator that requires exactly five isolated cold and five warm
  trials for every Windows/Ubuntu/macOS x npm/pnpm lane: 60 unique, self-hashed raw receipts.
- [ ] Execute that exact 60-run matrix against the final immutable candidate and compute median,
  range, and maximum without carrying evidence forward from an earlier revision.
- [ ] Require at least 20 cold and 20 warm samples per lane before publishing p95.
- [x] Implement the fresh-agent v2 evaluator for exactly 15 isolated real CLI sessions: research
  map, volunteer onboarding, and launch presentation, each run by Codex three times, Claude once,
  and a lower-cost agent once.
- [ ] Pass all 15 candidate-bound sessions with zero human reprompts, substantive non-proof changes,
  final reports, diffs, screenshots, transcripts, and self-hashed receipts.
- [ ] Run five fresh-human sessions with consent and participant-level receipts.
- [ ] Require at least four unassisted completions, median first action at most 30 seconds, median
  neutral journey at most 180 seconds, and median SEQ at least 6/7.
- [x] Implement local browser download/reopen verification for the portable proof bundle, canonical
  artifact hash, and receipt-body hash.
- [ ] Deploy an exact tested NodeKit factory candidate to an isolated preview frontend and backend.
- [ ] Complete a fresh-browser upload, journey, export, reopen, independent score, cleanup, and
  deployment-bound receipt.
- [x] Implement recursive submission evidence verification for decisive receipts, nested evidence,
  and the exact package tarball.
- [ ] Re-run independent ProofLoop verification over the final immutable candidate.

### Convex component and adoption

- [x] Implement the isolated Convex Caseflow component, public client, typed validators, local
  `convex-test` coverage, and fresh packed-consumer execution of the installed runtime.
- [x] Preserve preliminary NodeVideo, NodeRoom, and NodeSlide integrations as discovery evidence
  only; copied adapters, sidecars, and unauthenticated locators do not count toward submission.
- [ ] Make NodeVideo pass exact-packed-component conformance through authenticated owner-scoped wrappers.
- [ ] Make NodeRoom or NodeSheet pass authenticated artifact-collaboration Caseflow conformance.
- [ ] Make NodeSlide pass authenticated presentation-production Caseflow conformance.
- [ ] Exercise stale proposals, idempotent retries, exception recovery, receipt integrity, and data
  ownership boundaries in all three consumers.
- [ ] Revise the local component if those three consumers reveal application-specific assumptions;
  consumer convergence, not extraction alone, validates the package boundary.
- [ ] Publish npm only with explicit authorization.
- [ ] Submit to the Convex Components directory only when the deterministic manifest says ready.

### Backend portability

- [x] Keep canonical IDs, events, schemas, receipts, and React view models provider-neutral.
- [x] Maintain one authoritative transactional backend per deployment.
- [x] Publish adapter capability negotiation and conformance suites.
- [x] Implement generic PostgreSQL persistence, owner scoping, transactional lifecycle operations,
  and conditional version application.
- [x] Retain the earlier PostgreSQL 17.10 live-conformance receipt as regression history.
- [ ] Re-run live PostgreSQL conformance for the final immutable candidate.
- [x] Implement the local Supabase managed profile contract: Auth-derived authority, read-only
  lifecycle RLS, a narrow proposal RPC, private Storage policies, explicit Realtime tables, and an
  opt-in server-only PGMQ/pg_cron worker module.
- [ ] Run authenticated live Supabase conformance for Auth, RLS, Storage bytes, Realtime delivery,
  queue isolation/consumption, and a bounded Cron invocation.
- [ ] Prove export from Convex and import into Supabase with matching canonical artifact and receipt
  hashes.

### Distribution and learning

- [ ] Complete review, merge, and package publication gates in dependency order.
- [ ] Produce a revision-bound presentation and demonstration packet.
- [ ] Certify editable export and reopen fidelity for presentation artifacts.
- [ ] Observe real application use and convert failures into minimized regression tasks.
- [ ] Store repeated corrections and winning references in NodeMem.
- [ ] Export accepted and rejected harness trajectories to NodeRL only after protected evaluation
  exists.

### Model Intelligence and Skill Compiler

- [x] Add strict harness, model-observation, and model-capability-card schemas.
- [x] Require requested route, resolved provider/model, and harness/tool/context/skill hashes.
- [x] Separate cognitive, execution, artifact, and efficiency evaluation.
- [x] Add the shared behavioral failure taxonomy.
- [x] Add application-specific harness initialization without changing the blank factory.
- [x] Compile evidence registries and benchmark/harness hashes fail closed.
- [x] Add baseline, profile, inspect, and failure-diagnosis commands.
- [ ] Normalize real application evidence into the first provisional capability card.
- [x] Add executable role, domain, model-adapter, guardrail, and recovery skill contracts.
- [x] Add without-skill versus with-skill protected comparisons.
- [x] Add capability-driven routing, deterministic fallbacks, expiry, and decision receipts.
- [x] Add blind tournaments, independent critics, fresh-agent canaries, rollback, and NodeProof
  promotion receipts.
- [x] Keep automatic skill and routing promotion disabled by default.

### Knowledge Evolution Plane

- [x] Add the governed six-layer knowledge hypergraph and portable schemas.
- [x] Add immutable multimodal evidence anchors and n-ary hyperedges.
- [x] Add proposal, validation, approval, conflict, apply, diff, and replay semantics.
- [x] Add graph CLI commands and Harness Gym proposal projection.
- [x] Add deterministic conformance and safety tests.
- [ ] Run protected real-task comparisons against flat retrieval, static graph, and search-only baselines.
- [ ] Add NodeGraph, Neo4j, Convex, and SQL provider projections in that order.
- [ ] Add graph-aware review UI only after the portable proposal contract is stable.

### Frontend Specialist

- [x] Add protected product-design, route, direction-set, benchmark, and decision contracts.
- [x] Default routing to unprofiled; require evidence before naming a preferred model.
- [x] Require three distinct directions and the full desktop/mobile view set.
- [x] Add independent pairwise selection, bounded repair, and prior-implementation preservation.
- [x] Require exact model, exact commit, fresh identity, screenshots, NodeProof, human approval, and
  zero major findings for canary success.
- [x] Keep promotion and deployment disabled by default.
- [ ] Run the first complete tournament and fresh-browser canary in NodeVideo or NodeSlide.

### Evolution Ledger

- [x] Add event, assumption, invariant, evidence, and adoption schemas.
- [x] Enforce human-reviewed canonical events and immutable append-or-supersede history.
- [x] Verify Git provenance, content hashes, references, secrets, benchmark identity, screenshots,
  model identity, invariant proof, and consumer adoption.
- [x] Add init, draft, record, verify, query, diff, materiality, docs, and graph-proposal commands.
- [x] Add generated chronology/adoption projections and CI drift/materiality gates.
- [x] Backfill domain-blank factory and rendered-browser-certification decisions.
- [x] Complete the NodeVideo topology-failure backfill against its exact source commit.
- [ ] Verify adoption of the frontend tournament invariant in a real consumer.

## Ordered execution plan

1. **Close the local integration loop.** Independently review the current lifecycle, package,
   browser, portability, and recursive-evidence changes; run the complete suite; do not describe the
   mutable working tree as green before those checks finish.
2. **Freeze one candidate.** Commit the reviewed source, compute its source identity, and rerun the
   exact packed-consumer Convex component proof plus local browser download/reopen proof.
3. **Collect the exact Ease matrices.** Run all 60 hosted timing trials and all 15 real fresh-agent
   v2 sessions against that same candidate. Retain every attempt; do not cherry-pick or reuse prior
   revision receipts.
4. **Run the five-person study.** Use the frozen candidate and the uncoached prompt.
5. **Prove three authenticated consumers.** Make NodeVideo, NodeRoom/NodeSheet, and NodeSlide use the
   exact packed component through owner-scoped application wrappers and pass the shared lifecycle
   and security contract.
6. **Prove the isolated preview.** Deploy the exact candidate, use a fresh identity and real fixture
   bytes, export, reopen, independently score, clean up, and bind deployment identity.
7. **Complete managed portability.** Re-run final-candidate PostgreSQL conformance, run authenticated
   live Supabase Auth/RLS/Storage/Realtime/Queue/Cron proof, and prove export/import hash parity.
8. **Prove the learning planes.** Run a real Frontend Specialist tournament, exact-model Harness Gym
   comparison, and protected flat/static/evolving Knowledge Evolution benchmark; record only
   human-reviewed conclusions in the Evolution Ledger.
9. **Verify transitively.** Have an independent ProofLoop re-hash the candidate, package, decisive
   receipts, and every nested evidence file; reject any missing or escaping path.
10. **Publish and submit last.** Only after explicit npm/publication approval, evaluate the complete
    submission manifest and submit when it returns `submissionReady: true`.

## Why the remaining blockers are hard

- Repeated timing requires controlled caches and exactly 60 current-candidate runs; one fast run or
  an earlier 60-run matrix cannot prove the final revision.
- Fresh-agent evidence must come from 15 writable, isolated, real CLI sessions with no conversational
  memory. A fixture, blocked agent, duplicate session, reprompt, or contradictory report is not a pass.
- Human usability can only be established with real people; simulated participants cannot replace
  consented observation.
- Consumer convergence cannot be inferred from local component tests or one application. The
  extracted engineering candidate may still encode hidden application-specific assumptions and
  must remain revisable until three qualifying consumers converge.
- Authentication and tenant ownership are security boundaries, not UI polish.
- Production proof requires credentials, exact revision identity, cleanup, and independently
  validated exported artifacts.
- Harness self-improvement is unsafe unless candidate generation is separated from protected
  evaluation and every promotion is reversible.

## Final submission rule

Do not submit because the architecture looks coherent or the demo looks polished.

Submit only when:

```text
repeated developer timing passes
+ 15 fresh-agent v2 runs pass
+ five-person usability passes
+ exact preview proof passes
+ three authenticated Convex consumers pass
+ packaged Caseflow tests pass
+ independent ProofLoop verification passes
+ submissionReady === true
```

Until then, continue engineering and evidence collection under the explicit verdict:

> **NodeKit is a strong engineering foundation and a promising product system. It is not yet an
> ease-certified or submission-ready Convex component.**
