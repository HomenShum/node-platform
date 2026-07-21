# NodeKit Ultra V1: overnight delivery and morning verification

## Honest outcome

This delivery makes NodeKit usable for a **next bounded application** without
rebuilding the factory: it can generate a committed, identity-bound local
candidate, run deterministic evaluations, and issue a local-ready proof. It
adds two intentionally narrow presets:

- `smb-lending-fde`: a clean-room, synthetic Casca FDE deployment lab;
- `agentic-rl-research`: a replay-only FounderQuest research environment.

It does not claim a live lending platform, an institutional integration, a
trained RL policy, a Neo4j deployment, a production release, or public
distribution. Those activities need separate authority and evidence.

## What was built

```text
brief
  -> nodekit create
  -> immutable initial Git candidate
  -> compiled application identity
  -> deterministic demo/eval/conformance
  -> hash-verified local proof
  -> explicit release gates
```

### Factory guarantees

`nodekit create --local-proof` now requires the normal local Git candidate.
The factory creates an initial commit using the local `NodeKit` identity before
the compiler produces ignored generated state. This prevents proof receipts
from silently binding to an uncommitted or dirty application.

The supported presets are:

```text
research-loop
smb-lending-fde
agentic-rl-research
```

The first two include a Pi seam, but only the Casca preset explicitly defaults
to loopback-only server behavior and an off-by-default live model path. The
Agentic-RL preset has no provider, network, or browser execution path.

## What to touch in the morning

### 1. Casca FDE lab

Open the local, synthetic lab at `http://127.0.0.1:4174` only while the local
server is running. The intended demo is:

1. Click **Reset synthetic case**.
2. Click **Why blocked?** and see the source-backed document blocker and graph
   highlight.
3. Click **Find safe next action** once. It visibly rejects the unsafe lending
   decision proposal.
4. Click it a second time. It proposes only a missing-document request.
5. Click **Approve request**. The synthetic state becomes *waiting external*;
   no bank or applicant is notified.
6. Click **Export readiness packet** and inspect the local JSON receipt.
7. Change to the healthcare synthetic case and repeat the bounded path.

The only valid headline is: **a local, synthetic, human-authority-preserving
lending-readiness conformance lab**.

### 2. Generate the next app

From an empty directory, select a preset and run its local proof:

```powershell
node <nodekit-source>\src\cli.mjs create . `
  --name my-next-lab `
  --brief "State the narrow question and protected boundary." `
  --preset agentic-rl-research `
  --no-install `
  --local-proof
```

For a full install, omit `--no-install` and use a portable NodeKit specifier
(published package or immutable Git/tarball reference). Do not use a
machine-specific `file:D:/...` dependency for a shareable candidate.

### 3. Inspect and prove

In any generated project:

```powershell
npm run compile
npm run check
npm run demo
npm run eval
npm run benchmark   # when the preset provides it
npm run proof
git status --porcelain
git rev-parse HEAD
```

`passed: true` with `level: local-ready` is **not** release approval.
`releaseReady: true` remains impossible until the separately authorized live,
browser, and deployment gates have concrete evidence.

## Understand Anything integration

NodeKit includes a bounded code-graph adapter:

```powershell
node <nodekit-source>\src\cli.mjs graph import `
  --repo-root . `
  --graph-dir .understand-anything `
  --repo-id my-repository `
  --commit <exact-commit>

node <nodekit-source>\src\cli.mjs graph query "receipt verifier" --repo-root . --json
```

Before a full Understand Anything scan, a human must review and approve
`.understand-anything/.understandignore`. The imported graph is a pinned,
read-only codebase snapshot; it is not a replacement for the Founder Quest
graph, NodeRoom state, or execution receipts.

## Morning Sol review packet

Use GPT-5.6 Sol to challenge the following claims, rather than to rubber-stamp
the implementation:

The paste-ready review brief is `docs/SOL_ADVERSARIAL_REVIEW_PROMPT.md`.

1. **Candidate binding:** mutate a source file, fixture, or receipt after a
   gate and confirm the verifier fails.
2. **Factory portability:** generate a project into a clean directory with a
   portable NodeKit reference; run a clean install and all local gates.
3. **Casca safety:** try a forged live request, a credit decision, and a stale
   approval. All must fail closed.
4. **Graph honesty:** verify that current Casca graph queries are deterministic
   local traversal, not Neo4j or a model-backed graph agent.
5. **Agentic-RL honesty:** verify that the preset is a protected synthetic
   environment and baseline, not trained-policy or real-world performance
   evidence.
6. **Understand Anything boundaries:** verify a code graph cannot silently
   mutate quest state or execution state.

## Deliberate next gates

These are not unfinished hidden tasks; they are authority-gated phases:

| Gate | Requires | Why it is not automatic overnight |
|---|---|---|
| Formal browser certification | An isolated runner, generated artifacts, human review of snapshots | Browser proof must not be a fabricated attestation |
| Hosted Casca-like application | Workspace auth, storage/CAS, threat model, deployment approval | The local filesystem starter is single-user only |
| Neo4j/Aura graph projection | Connection credentials and an approved schema/data owner | Current graph is deterministic local traversal by design |
| Live Pi evaluation | Explicit provider key/budget approval | No external provider calls were authorized |
| Casca submission/distribution | User approval of public claims and assets | Public claims must be held to the proof level |

## Final overnight submission set

1. NodeKit factory changes and both presets.
2. A committed Casca clean-room app with local-ready proof receipts.
3. A committed FounderQuest Agentic-RL clean-room lab.
4. ProofLoop's independent NodeKit candidate/receipt verifier.
5. Manual sandbox browser QA evidence for the Casca lab.
6. This handoff and the Sol adversarial-review checklist.

The test for “ready for the next thing” is simple: choose a new bounded
workflow, generate the closest preset, preserve the same candidate/proof
discipline, and add only domain-specific tools, validators, fixtures, and UI.
