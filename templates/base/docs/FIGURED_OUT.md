# Figured-out contract

This application is blank in domain and figured out in behavior.

The user must be able to enter with one intention, understand the next step without training, move through a bounded progression, review generated work before it becomes canonical, recover without losing valid work, and leave with one clear artifact plus proof of completion.

## Stable product grammar

```text
Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
```

- One primary job.
- One obvious starting action.
- One guided progression.
- One canonical output.
- One explicit recovery path.
- One verifiable completion state.

Infrastructure stays backstage. The main experience exposes progress, consequences, decisions, and the current owner of the next action. Agent activity, tool traces, retries, and provider details remain available but secondary.

## Clean-state invariants

- A proposal is never the canonical artifact.
- Every proposal names the artifact version it inspected.
- A stale proposal conflicts instead of overwriting newer work.
- A failed run preserves the last valid artifact.
- Every run ends as completed, awaiting review, blocked, conflicted, cancelled, or failed safely.
- Every completion creates a content-addressed receipt.

## Specialization boundary

Change the domain job, guided questions, stages, artifact type, tools, validators, fixtures, and renderer. Do not remove version safety, approval, explicit next-action ownership, exception recovery, or proof.

When specialization requires durable cross-run knowledge, use `docs/KNOWLEDGE_EVOLUTION.md`.
Persistent knowledge follows the same safety grammar as artifacts: retrieve, propose, validate,
approve, apply, and retain a receipt.
