# Understand Anything code graph adapter

NodeKit treats Understand Anything as a **codebase graph compiler**. It does
not make the graph an execution authority and does not embed or proxy the
upstream local dashboard into a hosted product surface.

```text
Understand Anything graph
  -> NodeKit import adapter
  -> namespaced code graph snapshot
  -> NodeGraph / NodeRoom projection and authenticated UI
```

The codebase graph remains separate from:

- execution graphs owned by NodeTrace and NodeProof receipts; and
- founder/product quest graphs owned by NodeKit and NodeRoom state.

Cross-link projections only through stable anchors such as repository ID,
commit SHA, relative file path, symbol ID, run ID, and receipt ID.

## Safe import

First run Understand Anything against a pinned repository revision. Its own
workflow requires reviewing `.understand-anything/.understandignore` before a
full scan. Exclude credentials, local environment files, generated proof,
and binary artifacts. Never expose the upstream dashboard token in receipts,
screenshots, logs, or a hosted URL.

Then import its generated graph:

```bash
nodekit graph import \
  --repo-root . \
  --graph-dir .understand-anything \
  --repo-id my-repository \
  --commit <exact-commit>
```

This writes:

```text
.nodeagent/code-graph/understand-anything.snapshot.json
```

The snapshot records the graph content hash, source path, source graph version,
repo ID, and commit. Node IDs are namespaced as:

```text
codebase:<repo-id>@<commit>:<understand-anything-node-id>
```

## Retrieval

```bash
nodekit graph query "where is the receipt verifier" --repo-root . --json
```

The command is deterministic local retrieval over node names, tags, and
summaries plus the selected one-hop edges. A model-backed answer may consume
the resulting bounded packet, but the import/query layer itself has no model,
credentials, or mutation capability.

## Freshness

Treat an Understand Anything graph as evidence for one commit, not a live
source of truth. Rebuild after structural changes and schedule periodic full
rebuilds even when upstream incremental fingerprints report a narrow change.
Reject or quarantine snapshots whose repository, commit, content hash, or
schema does not match the program's pinned inputs.
