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

## Byte-authenticated evidence snapshots

`nodekit graph evidence-ingest` is the authenticated source-capture path. It opens a real file,
enforces repository containment and byte/locator limits, rejects symbolic-link traversal, computes
SHA-256 from the bytes it actually read, and stores the bytes in a content-addressed immutable blob:

```text
.nodeagent/evidence/
  blobs/sha256/<prefix>/<raw-sha256>.bin
  snapshots/evidence_<id>.json
```

A caller may provide `expectedSha256` as a comparison, but never as the recorded hash. A mismatch
fails. Exact duplicate `source URI + raw hash` snapshots fail rather than creating ambiguous
records. `nodekit graph evidence-verify` reopens the stored blob and rechecks its byte length, raw
hash, locator byte anchors, and freshness deadline.

Locators are typed as text byte ranges, PDF pages, image regions, video time ranges, or generic
byte ranges. Every locator identifies whether it came from a user, provider, or parser and includes
an exact byte range whose hash is recomputed. NodeKit validates bounds and preserves the supplied
semantic location; it does not invent a page, bounding box, or timestamp. For image/video/PDF
positions, the byte anchor is verified while the semantic position remains attributed to its
declared source.

```bash
nodekit graph evidence-ingest \
  --file sources/report.pdf \
  --source-uri https://example.org/report.pdf \
  --media-type application/pdf \
  --captured-at 2026-07-22T12:00:00.000Z \
  --locators sources/report-locators.json \
  --repo-root .

nodekit graph evidence-verify --snapshot evidence_<id> --repo-root .
```

Capture stores an immutable snapshot and creates a pending graph proposal. It does not modify the
canonical node or hyperedge collections. The older `graph ingest --input` command is a generic
preconstructed graph-proposal route; its caller-supplied source records are not evidence of a byte
capture and must not be represented as such.

## Bounded external-research collector

External research uses the provider-neutral `nodekit.research-provider/v1` port:

```text
search(query, bounded options)
  -> response URI + capture timestamp + raw response bytes + result metadata

fetch(result URI, bounded options)
  -> exact URI + capture timestamp + raw document bytes + supplied locators
```

The NodeKit wrapper, not the provider, computes raw-byte SHA-256 provenance. Searches, result
counts, fetches, bytes per fetch, total bytes, locator count, and call duration all have explicit
ceilings. Duplicate results, redirect/URI substitution, late calls, malformed bytes, and limit
overruns fail closed. Search-response bytes and fetched-document bytes both pass through the same
immutable snapshot pipeline.

Normalization is a separate pure port with its own ID and version. A normalizer can produce a
label, confidence, and properties, but cannot replace or rewrite the raw evidence. A completed
collection emits `nodekit.research-collection/v1`, records an `EXTERNAL_RESEARCH` action, and adds
only a pending, source-grounded graph patch. The graph version and canonical entities must remain
unchanged.

The bundled CLI deliberately supports only a deterministic local fixture provider, so tests and
no-key demos never invoke a paid or mutable live service:

```bash
nodekit graph research "typed knowledge gap" \
  --provider-fixture fixtures/research-provider.json \
  --max-searches 1 \
  --max-results 8 \
  --max-fetches 4 \
  --max-bytes-per-fetch 5242880 \
  --max-total-bytes 20971520 \
  --repo-root .
```

Live search implementations plug into the same library contract. They are not hidden inside the
CLI, and adding one does not grant canonical graph-write authority.

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
nodekit graph evidence-ingest --file source.txt --source-uri https://example.org/source.txt --media-type text/plain --repo-root .
nodekit graph evidence-verify --snapshot evidence_<id> --repo-root .
nodekit graph inspect --repo-root .
nodekit graph query "stale proposal failures" --repo-root .
nodekit graph gaps --repo-root .
nodekit graph research "official source for gap:123" --provider-fixture fixtures/research-provider.json --repo-root .
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

`research` executes only the explicitly supplied provider port, records a typed and budgeted
research action, snapshots exact search/fetch bytes, and produces a separate graph patch. The
bundled CLI accepts a local deterministic provider fixture; it does not silently call a network or
paid provider.

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

The governed graph now has a separate provider-neutral retrieval/runtime contract. The graph file
remains the proposal and review authority; a runtime stores a read projection and may only advance
it with compare-and-swap. The implementations in this repository are deliberately narrower than
the long-term adapter map:

```text
Memory/file -> reference, replay, repeat-session tests
PostgreSQL -> transactional owner-scoped projection and retrieval receipts
Planned only: NodeGraph -> portable document/rendering
Planned only: Neo4j -> traversal and analytics projection
Planned only: Convex -> collaborative proposal/review state
Planned only: Supabase -> managed PostgreSQL profile
```

One deployment has one authoritative canonical graph. Provider projections are not independent
write authorities. The PostgreSQL schema is `adapters/postgres/002_knowledge_runtime.sql`; it uses
owner-prefixed primary and foreign keys, row locking for projection CAS, and a locked per-session
sequence for durable retrieval receipts.

## Runtime retrieval and context packs

`@homenshum/nodekit/knowledge-runtime` exposes graph traversal, the memory runtime, a Caseflow
context consumer, and protected comparisons. `@homenshum/nodekit/adapters/postgres/knowledge`
provides the production-capable SQL projection.

"Production-capable" describes the transaction, ownership, and receipt semantics implemented by
the adapter. A live managed PostgreSQL or Supabase certification run against the frozen release
candidate is still required before making a production-readiness claim.

The default context policy is fail-closed:

```text
accepted evolution receipt
  + canonical fact
  + current immutable source evidence
  + supported canonical hyperedge
  -> Caseflow context pack
```

Pending/rejected proposals, working/derived/hypothesis layers, deprecated facts, stale facts, stale
evidence, and unsupported edges are excluded. Retrieval can start from text or stable entity IDs
and traverse typed n-ary relationships, so related repairs and invariants do not need to repeat the
query wording. When the minimum supported fact count is not met, the consumer returns `ABSTAIN`
with `INSUFFICIENT_ACCEPTED_EVIDENCE`; it never fills the gap with an unreviewed proposal.

Every context pack binds the graph version/hash, accepted projection hash, selected facts,
traversed hyperedges, exact source hashes/URIs, producing evolution receipts, retrieval receipt,
Caseflow case/run, and repeat-session history. The consumer checks that the target Caseflow run is
real, belongs to the case, and is non-terminal before supplying context.

## Evaluation before learning

The protected comparison contract runs flat, static-graph, and evolving-graph profiles against the
same case bytes and immutable evaluator. It requires the caller to supply the externally locked
definition hash and measured turns, tokens, latency, and cost for every case/profile. Results also
record success, abstention correctness, and unsupported-edge behavior. The local result is always
labelled `ENGINEERING_COMPARISON_ONLY` with `adoptionClaim: false`.

The result is a transitive evidence closure, not an aggregate-only score. It contains a canonical
repository-relative reference and exact file SHA for the protected definition, plus one unique
execution-receipt path/SHA for every profile/case measurement. A decisive verifier must reopen
those files, re-hash their bytes, validate the definition/result schemas, recompute definition,
case, evaluator, result, and aggregate hashes/scores, reject duplicate or escaping receipt paths,
and confirm that flat uses the exact evolving snapshot while static is an immutable history prefix.
The separate evaluator-identity, consumer-adoption, ledger-event, and evolution-receipt evidence
remain required by the final Knowledge Evolution adoption verdict.

```bash
npm run knowledge:compare -- \
  --definition evals/knowledge-definition.json \
  --definition-sha256 <pre-registered-hash> \
  --flat proof/flat-graph.json \
  --static proof/static-graph.json \
  --evolving proof/evolving-graph.json \
  --measurements proof/measured-executions.json
```

An adoption claim still requires protected real application tasks, repeated runs, an independent
receipt, and verified downstream consumer use. Local deterministic tests intentionally do not
manufacture that evidence.

Do not begin RL training from this layer. Accepted and rejected trajectories become training data
only after non-RL graph governance, evaluators, rollback, and rewards are stable.
