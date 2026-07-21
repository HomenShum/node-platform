# NodeKit Ultra V1: GPT-5.6 Sol adversarial review

Use this after reading `docs/NODEKIT_ULTRA_V1_HANDOFF.md`. The purpose is to
challenge the overnight delivery, not to improve its marketing language.

## Scope and authority

Review only these local candidates:

```text
NodeKit factory
  branch: codex/nodekit-ultra-v1
  candidate: f5fbb99083ec9d45d213c1c721c355a90e8f011d

Casca clean-room lab
  branch: codex/casca-fde-deployment-lab
  candidate: 1c58bf60d4e4342e8c125cbbdf3f2fb35d7e3411

FounderQuest Agentic-RL lab
  branch: codex/founderquest-rl-research-lab
  candidate: e69dde717fbb933405b51d415968111a19fe3ac4

ProofLoop verifier
  candidate: 6e61a0d91f80cfa8a7f9f240aab3fcda8ad68905
```

Do not deploy, connect accounts, call providers, publish content, submit a
lending application, or alter the candidate commits. Run destructive tests
only in disposable copies.

## Required evidence checks

1. Run NodeKit's test suite, registry check, and production dependency audit.
2. Generate a fresh `smb-lending-fde` project in a disposable empty directory;
   verify that its local demo, evaluation, benchmark, and proof pass.
3. In a disposable copy, change a declared pack ID, a fixture byte, and a
   receipt byte. Confirm the relevant compiler or verifier fails closed.
4. Run the Casca app's `npm run check`, `demo`, `eval`, `benchmark`, and
   `proof`; then run ProofLoop's `verify-nodekit` against its exact Git commit.
5. Attempt the synthetic lab's forbidden paths:
   - propose a loan approval;
   - request a document that is not missing;
   - submit a live proposal without per-action consent;
   - attempt a networked mutation.
   Each must reject without changing lending authority or calling external systems.
6. Run the FounderQuest-RL lab's local gates and confirm that it is only a
   synthetic, replay-only protected environment, not an RL-trained model or a
   real-world capability benchmark.
7. Inspect the code-graph adapter and confirm imports are pinned, read-only
   snapshots. Do not run a full Understand Anything scan until the user reviews
   `.understand-anything/.understandignore`.

## Product interaction check

Start the Casca local server and exercise this exact path in a fresh browser:

```text
Reset synthetic case
-> Why blocked?
-> Find safe next action (unsafe credit decision rejected)
-> Find safe next action again (bounded document request)
-> Approve request
-> Export readiness packet
-> Reload
```

Verify desktop and mobile rendering, no horizontal overflow, correct source
lineage, and that approval only changes the synthetic document-request state.
Record screenshots or a short local capture. Do not mark browser certification
as passed unless its required independent artifacts exist.

## Verdict format

Return a concise table with one row per claim:

| Claim | Evidence command/artifact | Verdict: PASS / WARN / FAIL | Exact reason |
|---|---|---|---|

Then list:

1. Any security or authority-boundary defect that blocks use.
2. Any proof-integrity weakness that makes local-ready misleading.
3. Any missing step between current local-ready status and a public Casca
   application or a live Founder Quest deployment.
4. The smallest safe next project NodeKit should generate after the Casca lab.

## Non-negotiable interpretation

`local-ready` means deterministic local gates, candidate binding, and receipts
passed. It does not mean hosted, bank-integrated, Neo4j-backed, live-model
validated, browser-certified, legally reviewed, publicly distributable, or
release-ready.
