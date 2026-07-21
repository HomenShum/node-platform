# Change story contract

## Canonical directory

```text
changes/<change-id>/
|-- change.yaml
|-- evidence/
|   |-- baseline/
|   |-- implementation/
|   |-- tests/
|   |-- browser/
|   |-- traces/
|   |-- benchmarks/
|   `-- deployment/
|-- story/
|   |-- claims.json
|   |-- evidence-index.json
|   |-- architecture-diff.json
|   `-- limitations.json
`-- presentation/
    |-- deck-spec.json
    |-- slide-design-plans/
    |-- speaker-notes.md
    `-- exports/
```

## Required change fields

- stable ID, title, change type, audience, and presentation tier
- previous state, user pain or risk, and affected users
- selected decision, alternatives, and tradeoffs
- affected systems and contracts
- required proof and approval boundaries
- honest limitations and next milestone

## Claim record

Each material claim must include:

- stable ID and exact text
- status: `verified`, `measured`, `observed`, `user_asserted`, or `planned`
- evidence IDs
- commit, deployment, benchmark, or artifact scope when applicable
- limitations

Invalidate a claim when its bound commit, deployment, source, or benchmark is stale.

## Presentation tiers

- Tier 0: no deck; PR or changelog text only
- Tier 1: one-page `Problem -> Change -> Proof` card
- Tier 2: 3-5 slides for a substantial feature or migration
- Tier 3: 6-10 slides plus technical appendix for a release
- Tier 4: judge/customer/investor deck, appendix, demo choreography, and Q&A map

## Default narrative

1. Why the change exists
2. Previous state and concrete limitation
3. Decision and tradeoffs
4. New architecture or workflow
5. User-visible result
6. Agent/tool execution path
7. Proof
8. Limitations
9. Reuse across the ecosystem
10. Next milestone

Match visual form to meaning: before/after, architecture, workflow, trace,
benchmark, screenshot, code contract, or timeline. Avoid repeating
title-plus-bullets on every slide.

## Verification gate

Require current evidence, accurate architecture, scoped metrics, visible
limitations, no overflow/collision, editable export, reopen success, and
human-reviewable proposals. A missing production artifact may still yield a
draft, but it cannot yield a production claim.
