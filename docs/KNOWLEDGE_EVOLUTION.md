# Knowledge Evolution Plane

NodeKit adapts the useful systems pattern from
[EvoGraph-R1](https://arxiv.org/abs/2607.12764): knowledge is a persistent environment that an
agent can retrieve, expand, correct, and use across runs. NodeKit does **not** copy the paper's
training system or permit autonomous canonical graph mutation.

The NodeKit interpretation is:

```text
Observe current graph
-> retrieve known context
-> identify typed gaps or contradictions
-> research only those gaps
-> propose a source-grounded graph patch
-> validate schema, authority, freshness, and conflicts
-> request an explicit decision
-> apply atomically against the pinned graph version
-> retain an evolution receipt
```

## Authority boundary

There are two distinct graph products:

```text
Understand Anything code graph
  read-only, commit-pinned repository evidence

NodeKit Knowledge Evolution graph
  backend-neutral, versioned, proposal-governed project knowledge
```

Importing a code graph does not grant knowledge-write authority. A knowledge graph cannot modify
source code, an artifact, a Caseflow record, a benchmark, or a proof receipt. It can only advance
its own canonical version through an accepted `nodekit.graph-patch/v1` proposal.

## Six epistemic layers

| Layer | Purpose | Mutation rule |
|---|---|---|
| `source` | Immutable documents, code, screenshots, video, traces, datasets, and web anchors | Ingest proposal only; never updated or deprecated in place |
| `derived` | Machine-extracted entities and relationships | Graph patch |
| `working` | Run-scoped task knowledge | Graph patch |
| `proposal` | Candidate understanding awaiting validation or review | Graph patch |
| `canonical` | Approved durable project knowledge | Accepted graph patch only |
| `hypothesis` | Explicitly unverified ideas | Graph patch; always visibly labeled |

`DEPRECATE` preserves history. Destructive delete is not part of the v1 operation set.

## Multimodal anchors and hyperedges

An evidence node has a content hash, source URI, capture time, and optional spatial or temporal
locator. Claims and relationships reference those immutable anchors. An n-ary hyperedge can retain
the full context of an observation, for example:

```text
model + exact model revision + task + harness + tool surface
+ failure + screenshot + repair skill + proof receipt
```

This avoids flattening a real observation into unrelated binary facts.

## Agent action receipts

NodeKit records the bounded action pool without storing private chain-of-thought:

- `GRAPH_RETRIEVE`
- `EXTERNAL_RESEARCH`
- `PROPOSE_GRAPH_PATCH`
- `INSPECT_ARTIFACT`
- `EXECUTE_TOOL`
- `REQUEST_APPROVAL`
- `COMPLETE`
- `ABSTAIN`

Each receipt binds the graph version, run and case identity, actor, inputs, output references,
evidence references, budget, status, and time.

## CLI

```bash
nodekit graph init --repo-root .
nodekit graph ingest --input evidence.json --repo-root .
nodekit graph inspect --repo-root .
nodekit graph query "stale proposal failures" --repo-root .
nodekit graph gaps --repo-root .
nodekit graph research "official source for gap:123" --repo-root .
nodekit graph propose --patch patch.json --repo-root .
nodekit graph validate --patch patch_123 --repo-root .
nodekit graph apply --patch patch_123 --approved-by human:reviewer --repo-root .
nodekit graph diff --from 2 --to 5 --repo-root .
nodekit graph replay --version 4 --repo-root .
nodekit graph benchmark --cases evals/knowledge-cases.json --repo-root .
nodekit graph harness-sync --repo-root .
```

`ingest`, `propose`, and `harness-sync` create proposals only. `apply` requires an approving
principal and re-validates the patch against the current graph. A stale base version conflicts.

`research` records a typed, budgeted research action. It does not silently call a provider. Search
results must return as immutable evidence anchors and a separate graph patch.

## Harness Gym integration

`nodekit graph harness-sync` compiles evaluated model observations into a proposed harness
hypergraph:

```text
observation evidence
+ task
+ resolved model
+ exact harness hash
+ failures
+ cognitive/execution/artifact/efficiency verdicts
```

The command does not promote a model, skill, route, or patch. Existing Harness Gym protected-task,
fresh-agent canary, independent-critic, rollback, and NodeProof requirements remain decisive.

## Backend contract

The current implementation is a portable JSON document and in-memory/file adapter suitable for
deterministic tests. Future provider adapters must preserve the same observable semantics:

```text
Memory/file -> reference and replay
NodeGraph -> portable document/rendering
Neo4j -> traversal and analytics projection
Convex -> collaborative proposal/review state
PostgreSQL/Supabase -> managed relational persistence
```

One deployment has one authoritative canonical graph. Provider projections are not independent
write authorities.

## Evaluation before learning

The v1 benchmark compares flat retrieval, a static `source + canonical` graph, and the composed
evolving graph. Receipts report whether INSERT, UPDATE, DEPRECATE, and EXTERNAL_RESEARCH appear in
the measured trajectory. Production claims still require fixed tasks, repeated runs, unsupported
edge rate, success, turns, tokens, latency, cost, and protected evaluators.

Do not begin RL training from this layer. Accepted and rejected trajectories become training data
only after non-RL graph governance, evaluators, rollback, and rewards are stable.
