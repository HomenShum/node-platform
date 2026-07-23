# NodeKit Model Intelligence and Skill Compiler

Status: **P0-P3 mechanics implemented and deterministically tested; real capability evidence,
application gyms, and current-revision certification remain open**

## Claim boundary

The repository contains working schemas, CLI commands, compilers, fail-closed gates, and
fixture-backed tests for P0 through P3. That proves the mechanics behave as specified under the
checked-in test cases. It does **not** prove that any live provider or exact resolved model is good
at a real NodeKit task family.

Current evidence status:

- no live provider run in this repository has produced a project-scoped capability card;
- no real model route is certified;
- no NodeKit Builder, NodeSlide, NodeVideo, NodeRoom, NodeSheet, or NodeBenchAI gym has completed
  its application-specific evidence program;
- automatic promotion remains disabled, and deterministic tests cannot substitute for a fresh
  agent canary plus an independently verified NodeProof receipt.

## Adopted decision

> NodeKit does not treat models as interchangeable providers. It observes each exact resolved
> model on the application's real task families, separates model behavior from harness behavior,
> produces evidence-backed capability cards, and only then proposes focused skills or routing
> changes.

Model Intelligence is a first-class subsystem of Harness Gym:

```text
Application task
-> model + harness execution
-> NodeTrace observation
-> deterministic and independent evaluation
-> typed failure classification
-> capability-card evidence
-> skill or routing candidate
-> controlled ablation
-> fresh-agent canary
-> NodeProof promotion receipt
-> NodeMem retention
```

The Deck Gym is the first artifact-specific reference design. The portable subsystem serves the
NodeKit Builder Gym and the runtime, critic, repair, browser, and domain agents in NodeSlide,
NodeVideo, NodeRoom, NodeSheet, and NodeBenchAI.

## Blank-factory boundary

`nodekit create` remains domain blank and does not assign model brands to roles. Model
intelligence is initialized only after a real vertical slice exists:

```bash
nodekit harness init
nodekit models baseline
nodekit models profile
nodekit models inspect
nodekit models diagnose
```

The current `baseline` command validates stored observations, binds them to content hashes, and
writes an honest zero-provider-call receipt. It does not run a model, infer capability from a
brand, or certify routing.

## Evidence hierarchy

Capability cards have three scopes:

1. **Project** evidence from the exact application, harness, tools, and task family.
2. **Domain** evidence from the same kind of work across applications.
3. **Ecosystem** evidence across materially different NodeKit applications.

Routing precedence is:

```text
Project evidence > Domain evidence > Ecosystem prior > Unprofiled fallback
```

Every observation records both the requested route and exact resolved provider/model. Dynamic
aliases such as `openrouter/free` never inherit conclusions from a previously resolved model.

## Observation contract

`nodekit.model-observation/v1` separates:

- cognitive behavior: brief understanding, decomposition, constraint retention, ambiguity,
  references, and repair reasoning;
- execution: tool selection, valid arguments, ordering, inspection, recovery, scoped changes, and
  completion;
- artifact quality: correctness, usability, domain quality, evidence integrity, and optional
  visual, editability, and export scores;
- efficiency: latency, tokens, cost, tool calls, and retries;
- identity: model route/revision plus harness, tool, context, and skill hashes;
- proof: typed failures, evidence references, and one proof receipt.

Scores use a normalized `0..1` scale. A malformed observation or unsupported failure class fails
compilation rather than being silently ignored.

## Failure vocabulary

The shared taxonomy includes brief, planning, primitive, density, tool, inspection, completion,
repair, context, orchestration, evidence, cost, repository, reference, UI, authority, stale-write,
export, and recovery failures. Findings describe observable behavior, expected behavior, probable
cause, severity, and evidence. They do not use anthropomorphic model mythology.

## Capability-card contract

`nodekit.model-capability-card/v1` binds a behavioral claim to requested and resolved model
identity; project, domain, or ecosystem scope; exact evidence window, task count, run count, and
harness versions; strengths, weaknesses, roles, avoidance guidance, scaffolding, metrics,
confidence, evidence references, expiry triggers, and provisional/certified/expired status.

No card is generated from NodeKit's deterministic factory proof because that proof contains no
live model comparison. Existing NodeSlide or NodeVideo evidence must be normalized into valid
observations before it can support a card.

## Implemented skill compiler mechanics

`nodekit harness init` creates the five skill roots for the resolved stack:

```text
Role skill
+ Domain skill
+ Model adapter
+ Guardrail skills
+ Conditional recovery skill
```

The implemented `nodekit skills propose` path clusters repeated findings only after the configured
multi-run and multi-brief threshold, then writes proposal-only candidates with executable skill
contracts. Every executable skill must define typed triggers, inputs, required tools, procedure,
constraints, completion checks, failure behavior, positive and negative examples, expected tool
traces, test fixtures, and supporting evidence. A skill is not motivational prose.

Normal promotion threshold:

```text
same finding in at least 3 independent runs
+ at least 2 task briefs
+ measurable improvement in with-skill versus without-skill comparison
+ no material regression
```

Accuracy, cost, latency, safety, artifact editability, export, and user completion are all
regression dimensions. A P0 authority or safety incident may produce an emergency guardrail after
one incident, but the regression suite is still mandatory before ordinary promotion.

The threshold is no longer satisfied by a candidate-authored aggregate comparison. Each baseline
and candidate run must produce a content-addressed `nodekit.skill-evaluator-receipt/v1`, signed by
a protected Ed25519 evaluator key and bound to exact benchmark, harness, evaluator, model, task,
input, and skill hashes. The protected path reopens task, input, output, and evaluation evidence,
walks nested hashed evidence references, verifies the detached signature and authorized key
purpose, then derives the aggregate verdict. The benchmark input and verdict are stored at immutable
content addresses; a mutable candidate pointer is only a convenience and is never the authority.

## Controlled comparisons

```text
Model A + Harness v1 versus Model A + Harness v2     # harness gain
Model A + Harness v2 versus Model B + Harness v2     # model difference
Model A + Harness v2 +/- candidate skill             # skill effect
```

Tasks, evidence, tools, budgets, judges, and scoring remain fixed. Candidate code cannot edit
held-out tasks, decisive judges, thresholds, safety requirements, or official outcomes.

## Implemented routing mechanics

The routing compiler orders eligible non-expired cards using project-before-domain-before-ecosystem
evidence precedence, then compiles task requirements through quality, safety, latency, cost,
availability, and tool compatibility into a role/domain/adapter/guardrail stack, bounded tools,
deterministic fallback, and routing-decision receipt.

Routes expire when material model, harness, tool-surface, context-policy, or skill-stack identity
changes. Routing and skill changes remain provisional proposals. Automatic promotion is disabled
by default, and the compiler never reports routing certification.

## Implemented tournament and promotion guards

The tournament evaluator rejects self-judging candidates, requires an unchanged protected
evaluator, and returns a provisional winner without authorizing promotion. Manual skill promotion
requires a re-derived passing protected benchmark, a purpose-scoped signed fresh-context canary, a
separately purpose-scoped signed NodeProof integrity receipt, and a detached promotion approval
signed by a fourth independent key. The approval is bound to the exact candidate, benchmark,
canary, integrity receipt, and current harness version; it is time-bounded and consumed exactly
once before the first promotion write. Promotion reopens and re-hashes the benchmark input, every
signed per-run receipt, all transitive evidence, the canary, and the integrity receipt immediately
before its first write.
Promoted harness versions retain a rollback pointer. These guards are covered by deterministic and
adversarial fixtures, not yet by a live application tournament.

## Implementation ladder

### P0 — implemented mechanics

- [x] `nodekit.harness/v1` schema.
- [x] `nodekit.model-observation/v1` schema.
- [x] Shared failure taxonomy.
- [x] `nodekit.model-capability-card/v1` with scope, confidence, evidence, and expiry.
- [x] `nodekit harness init` application-specific scaffold.
- [x] Strict observation/card validation and compiled hashes.
- [x] `models baseline`, `profile`, `inspect`, and `diagnose` commands.
- [x] Exact requested/resolved model fields required by schema.
- [x] Automatic promotion and routing certification fail closed.
- [ ] Normalize one real NodeSlide or NodeVideo model run into a manual provisional card.

### P1 — implemented mechanics

- [x] Executable skill schema and five skill directories.
- [x] Findings clustering into proposal-only candidates.
- [x] Positive/negative examples, fixtures, traces, completion, and failure assertions.
- [x] With-skill/without-skill input and verdict schemas with protected per-run evaluator receipts.
- [x] Content-addressed evidence closure, fixed arm repetitions, trusted-key verification, and
      fail-closed verdict re-derivation.
- [ ] Run the comparison against real application tasks and live model observations.

### P2 — implemented mechanics

- [x] Routing-policy schema and project/domain/ecosystem evidence precedence.
- [x] Confidence, expiry, cost, latency, availability, tool compatibility, and deterministic fallback.
- [x] Provisional decision receipt and canary verification behavior.
- [ ] Compile and canary a route from real, non-expired capability cards.

### P3 — implemented mechanics

- [x] Blind pairwise comparison contract and independent-critic enforcement.
- [x] Purpose-scoped signed fresh-agent canary and independent NodeProof integrity-receipt gates.
- [x] Pre-write re-open and transitive re-hash of benchmark, canary, and integrity evidence.
- [x] Explicit manual promotion/rejection and versioned rollback.
- [ ] Complete a real tournament, canary, independently verified promotion, and rollback drill.

### P4 — application gyms

- [x] NodeKit Builder Gym mechanics with content-addressed NodeTrace trajectories, protected
      evaluator boundaries, and separate task/artifact/UI/safety/efficiency/evidence/preference
      verdicts. Real fresh-agent evidence remains open.
- [ ] NodeSlide Deck Gym.
- [ ] NodeVideo Creator Gym.
- [ ] NodeRoom Collaboration Gym.
- [ ] NodeSheet Data Gym.
- [ ] NodeBenchAI Research Gym.

### P5 — learning export

- [ ] Accepted, rejected, failed, and repaired trajectories.
- [ ] Human pairwise preferences and protected rewards.
- [ ] NodeRL consumption only after harness and benchmark contracts stabilize.

## Non-negotiable rule

> Do not erase model differences with one giant prompt. Measure exact resolved models, exploit
> demonstrated specialization, compensate for recurring failures, and prove every compensation
> against protected tasks before promotion.

The checked-in P1-P3 tests prove this rule is enforced mechanically. They do not provide the model
measurements needed to make a capability or routing claim.
