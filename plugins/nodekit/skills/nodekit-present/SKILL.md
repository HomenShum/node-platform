---
name: nodekit-present
description: Capture a substantial code change, architecture migration, benchmark, release, or completed hackathon application as an editable, evidence-backed presentation. Use when Codex must explain what changed, assemble a judge or reviewer deck, keep presentation material current during development, or drive NodeSlide through its package, CLI, MCP, or host adapter.
---

# NodeKit Present

Turn verified development artifacts into a living presentation. Treat the deck as a projection of the change record, never as an independent source of claims.

Read [the change-story contract](references/change-story-contract.md) before creating or updating presentation artifacts.

## Workflow

1. Classify the change tier. Skip decks for trivial work; use a change card for a narrow fix, a 3–5 slide mini-deck for a major feature, and a full deck plus appendix for releases or hackathons.
2. Create or update `changes/<change-id>/change.yaml`. Record audience, problem, prior state, decision, alternatives, affected systems, user workflow, proof requirements, limitations, and presentation tier.
3. Capture evidence while work happens: baseline and after screenshots, exact commits, deployment identity, tests, benchmarks, traces, artifacts, exports, and known failures. Preserve raw receipts.
4. Build an evidence index. Give every material claim a status and evidence IDs. Label planned, inferred, user-asserted, and measured claims distinctly.
5. Plan each slide before rendering. State its job, audience question, takeaway, narrative role, dominant visual, evidence IDs, density budget, and speaker-note goal.
6. Use the installed NodeSlide transport in this order: repository-native adapter, NodeSlide CLI, NodeSlide MCP, or package API. Inspect capabilities first and never assume hosted writes, export, or approval are available.
7. Propose deck changes against the pinned deck version. Validate, compare, and apply through the host policy; do not bypass NodeSlide governance for convenience.
8. Verify every material claim against the current commit or deployment. Refresh stale screenshots and metrics. Keep limitations visible.
9. Export the requested editable format and reopen it. Verify the rendered deck, speaker notes, source bindings, and any PPTX round trip.
10. Derive the demo script, README section, release notes, and submission copy from the same Change Story and Evidence Index.

## Parallel lane

For a large implementation, run presentation work as a read-mostly lane beside building and QA. Draft the problem and architecture early; replace placeholders only with verified evidence from later gates. Block release only for unsupported claims, missing required proof, stale evidence, or a broken export.

## Completion language

- Say `drafted` when slide plans exist.
- Say `evidence-bound` when every material claim resolves to current evidence.
- Say `export-verified` only after the requested output reopens successfully.
- Say `release-ready` only when the application proof and presentation proof both pass.

Do not turn a green unit test into a production claim, an HTTP 200 into browser proof, or an advisory model judgment into an authoritative verdict.
