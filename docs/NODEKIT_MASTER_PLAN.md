# NodeKit master plan and evidence checklist

Status: **engineering foundation proven; Ease certification and Convex submission blocked**

Last reconciled: 2026-07-21

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
| Domain-blank empty-directory factory | PASS | One complete factory receipt exists |
| Figured-out neutral journey | PASS | Case through receipt, reload, conflict, failure, and export states |
| Portable Caseflow semantics | PASS | Memory implementation and conformance behavior exist |
| Deterministic no-key runtime | PASS | Demo, compile, eval, browser contract, and receipt pass |
| Cross-platform compatibility | PASS, one run per lane | Not a repeatability or percentile claim |
| Rendered UI coverage | PASS | 15 states, 6 viewport/theme profiles, 180 hashed screenshots |
| Evidence integrity | PASS | Independent ProofLoop re-hash passed |
| Repeated cold/warm timing | INCOMPLETE | 60 raw developer trials still required |
| Fresh coding-agent specialization | INCOMPLETE | No valid three-task, writable, zero-reprompt matrix |
| Fresh-human usability | INCOMPLETE | Five real participants still required |
| NodeVideo Caseflow adoption | ENGINEERING PASS | Production candidate; authenticated wrapper still missing |
| Submission-grade Convex consumers | 0/3 | NodeVideo does not count until owner-scoped auth boundary passes |
| Shareable NodeKit factory preview | INCOMPLETE | NodeVideo production proof is not factory-preview proof |
| Harness Gym | PLANNED | No schema, CLI, protected benchmark, or promotion receipt yet |
| Convex component extraction | BLOCKED | Requires three qualifying consumers and repeated implementation |
| Convex directory submission | BLOCKED | `submissionReady` must be deterministically true first |
| PostgreSQL/Supabase portability | FUTURE | Contracts should be preserved now; adapters follow later |

The current mandatory verdict is `EASE_NOT_CERTIFIED`. Do not submit NodeKit or Caseflow to the
Convex Components directory yet.

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

- [ ] Add the `nodekit.harness/v1` schema and content-addressed harness identity.
- [ ] Generate a minimal `harness/` directory after the first application vertical slice.
- [ ] Add protected validation, held-out, and adversarial task indexes.
- [ ] Add `init`, `baseline`, `inspect`, `diagnose`, `propose`, `benchmark`, `tournament`, `canary`,
  `review`, `promote`, `rollback`, `status`, and `gate` commands.
- [ ] Require a hypothesis, expected impact, and risk for every harness candidate.
- [ ] Capture complete NodeTrace trajectories and separate task, artifact, UI, safety, efficiency,
  evidence, and human-preference verdicts.
- [ ] Require fresh-agent canaries, rollback versions, and NodeProof promotion receipts.
- [ ] Keep automatic promotion disabled by default.
- [ ] Implement NodeKit Builder Gym first.
- [ ] Implement NodeSlide Deck Gym, NodeVideo Creator Gym, and NodeRoom Collaboration Gym next.
- [ ] Prove Harness v1 beats or holds Harness v0 with a fresh agent on frozen tasks.

Harness Gym comes before NodeRL. Model training consumes accepted and rejected trajectories only
after documentation, tools, context, routing, UI contracts, and deterministic repair have been
optimized.

## Release ladder

```text
E0 Engineering merge
→ E1 Deterministic factory
→ E2 Rendered interaction proof
→ E3 Ease certification
→ C1 Three qualifying Convex consumers
→ C2 Caseflow extraction and package proof
→ C3 Convex directory submission
→ P1 PostgreSQL adapter
→ P2 Supabase managed profile
```

Passing an earlier level never implies a later claim.

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
- [x] Fifteen rendered application states.
- [x] Six viewport/theme profiles and 180 PNG/JSON screenshot pairs.
- [x] Accessibility, overflow, console, network, and mojibake gates.
- [x] Proposal approval, canonical versioning, reload persistence, and safe conflict behavior.
- [x] Independent ProofLoop archive and screenshot re-hash.
- [x] One npm/pnpm compatibility run on Windows, macOS, and Ubuntu.

### Ease certification

- [ ] Run five isolated cold and five warm trials for every supported OS/package-manager lane.
- [ ] Preserve all 60 raw timing receipts and compute median, range, and maximum.
- [ ] Require at least 20 cold and 20 warm samples per lane before publishing p95.
- [ ] Pass all three fresh-agent held-out tasks from writable isolated sessions.
- [ ] Require substantive non-proof changes, no human reprompt, final report, diff, screenshots, and
  proof receipt in every fresh-agent run.
- [ ] Run five fresh-human sessions with consent and participant-level receipts.
- [ ] Require at least four unassisted completions, median first action at most 30 seconds, median
  neutral journey at most 180 seconds, and median SEQ at least 6/7.
- [ ] Deploy an exact tested NodeKit factory candidate to an isolated preview frontend and backend.
- [ ] Complete a fresh-browser upload, journey, export, reopen, independent score, cleanup, and
  deployment-bound receipt.
- [ ] Re-run independent ProofLoop verification over the final immutable candidate.

### Convex adoption and extraction

- [x] NodeVideo demonstrates production Convex Caseflow behavior, two-session reactivity, stale
  conflict rejection, exact approval, reload persistence, and governed external planning.
- [ ] Replace NodeVideo's owner-capability locator with authenticated owner-scoped wrappers.
- [ ] Make NodeVideo pass packaged Caseflow conformance as a submission-grade consumer.
- [ ] Make NodeRoom or NodeSheet pass authenticated artifact-collaboration Caseflow conformance.
- [ ] Make NodeSlide pass authenticated presentation-production Caseflow conformance.
- [ ] Exercise stale proposals, idempotent retries, exception recovery, receipt integrity, and data
  ownership boundaries in all three consumers.
- [ ] Identify the repeated Convex implementation only after the three consumers converge.
- [ ] Extract the isolated Caseflow component.
- [ ] Add argument and return validators to every public component function.
- [ ] Cover the packaged API with `convex-test` and a package-install example.
- [ ] Publish npm only with explicit authorization.
- [ ] Submit to the Convex Components directory only when the deterministic manifest says ready.

### Backend portability

- [x] Keep canonical IDs, events, schemas, receipts, and React view models provider-neutral.
- [x] Maintain one authoritative transactional backend per deployment.
- [ ] Publish adapter capability negotiation and conformance suites.
- [ ] Implement generic PostgreSQL persistence and conditional version application.
- [ ] Implement the Supabase managed profile: Auth, RLS, Storage, Realtime, queues, and Cron.
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

## Ordered execution plan

1. **Repair fresh-agent execution.** Run the Docker executor without the incompatible nested Linux
   namespace while retaining the disposable outer container. Re-run the volunteer canary in a new
   QA pass, then research-map and launch-presentation held-outs.
2. **Collect the developer timing matrix.** Automate isolated caches and retain all raw receipts;
   do not optimize against undocumented samples.
3. **Run the five-person study.** Use the frozen candidate and uncoached prompt.
4. **Finish NodeVideo's authenticated wrapper.** Promote it from engineering consumer to the first
   submission-grade consumer.
5. **Adopt Caseflow in NodeRoom/NodeSheet and NodeSlide.** Keep domain logic in each application and
   require the shared conformance suite.
6. **Prove the NodeKit preview journey.** Deploy the exact candidate, run a fresh browser, export,
   reopen, score, clean up, and bind deployment identity.
7. **Implement Harness Gym v0.** Freeze the NodeKit Builder Gym benchmark before candidate
   generation or promotion exists.
8. **Extract Caseflow.** Only after three consumer implementations reveal the genuinely repeated
   kernel.
9. **Package and submit.** Run `convex-test`, installed-example proof, independent review, explicit
   publication approval, and the deterministic submission gate.
10. **Add SQL portability.** PostgreSQL first, Supabase managed profile second, with migration proof.

## Why the remaining blockers are hard

- Repeated timing requires controlled caches and many real samples; one fast run cannot prove ease.
- Fresh-agent evidence must come from a writable session with no conversational memory. A blocked
  agent or a manifest that contradicts its final report is not a pass.
- Human usability can only be established with real people; simulated participants cannot replace
  consented observation.
- Consumer convergence cannot be inferred from one application. Premature extraction would encode
  NodeVideo-specific assumptions into a supposedly reusable component.
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
+ three fresh-agent held-outs pass
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
