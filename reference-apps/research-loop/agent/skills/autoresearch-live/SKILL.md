---
name: autoresearch-live
description: Run a measurable keep-or-revert research loop that remains observable, steerable, resumable, and reproducible. Use when an experiment has a fixed objective metric and a human needs to intervene without restarting the agent.
---

# Autoresearch Live

1. Load the durable session and latest intervention.
2. Propose one bounded change with a falsifiable rationale.
3. Run the unchanged deterministic evaluator.
4. Keep only a strict metric improvement; otherwise revert.
5. Append the proposal, result, decision, hashes, usage, and intervention version.
6. Persist atomically before reporting completion.

Never let a model change the evaluator, corpus, budget, or keep/revert rule during a run.
