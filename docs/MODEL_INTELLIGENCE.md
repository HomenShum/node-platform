# NodeKit Model Intelligence and Skill Compiler

Status: **P0 observation and capability-card foundation implemented; skill compilation, routing,
tournaments, and promotion remain gated roadmap work**

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

## Skill compiler design

The future resolved skill stack is:

```text
Role skill
+ Domain skill
+ Model adapter
+ Guardrail skills
+ Conditional recovery skill
```

Every executable skill must define typed triggers, inputs, required tools, procedure, constraints,
completion checks, failure behavior, positive and negative examples, expected tool traces, test
fixtures, and supporting evidence. A skill is not motivational prose.

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

## Controlled comparisons

```text
Model A + Harness v1 versus Model A + Harness v2     # harness gain
Model A + Harness v2 versus Model B + Harness v2     # model difference
Model A + Harness v2 +/- candidate skill             # skill effect
```

Tasks, evidence, tools, budgets, judges, and scoring remain fixed. Candidate code cannot edit
held-out tasks, decisive judges, thresholds, safety requirements, or official outcomes.

## Routing compiler design

Routing eventually compiles task requirements through eligible non-expired cards, quality,
safety, latency, cost, availability, and tool compatibility into a role/domain/adapter/guardrail
stack, bounded tools, deterministic fallback, and routing-decision receipt.

Routes expire when material model, harness, tool-surface, context-policy, or skill-stack identity
changes. Routing and skill changes remain proposals. Automatic promotion is disabled by default.

## Independent evaluation

The candidate model never judges itself alone. A decisive lane combines independent domain and
artifact critics, deterministic validators, optional blind human pairwise review, and NodeProof
integrity verification. Disagreement is retained as evidence instead of collapsed into a single
model-winner story.

## Implementation ladder

### P0 — implemented in this repository

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

### P1 — skill compiler

- [ ] Executable skill schema and five skill directories.
- [ ] Findings clustering into proposal-only candidates.
- [ ] Positive/negative examples, fixtures, traces, completion, and failure assertions.
- [ ] With-skill/without-skill benchmark.

### P2 — controlled routing

- [ ] Routing-policy schema and evidence precedence.
- [ ] Confidence, expiry, cost, latency, availability, tool compatibility, and fallback.
- [ ] Decision receipts and canary behavior.

### P3 — tournament and promotion

- [ ] Blind pairwise comparison and independent critics.
- [ ] Fresh-agent canaries and NodeProof promotion receipts.
- [ ] Versioned rollback and manual promotion/rejection.

### P4 — application gyms

- [ ] NodeKit Builder Gym.
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
