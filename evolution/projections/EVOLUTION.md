# NodeKit Evolution Ledger

Canonical JSON records remain authoritative. This projection explains why material system guarantees exist.

## Product evolution

### The primary initializer silently specialized the product.

- Event: `evt:domain-blank-factory`
- Source: `8d4f7e6e8235751d07c456208f841b15edf8de39`
- Resolution: NodeKit now exposes one domain-blank factory and keeps narrow applications as references.
- Observed failure: A blank creation command selected a reference workflow without user authority.
- Invariants: `inv:domain-blank-create` (verified)
- Evidence: `evd:domain-blank-factory` (pass)
- Known limitations: Reference applications still require explicit user selection after creation.

### The natural named-option form for selecting a submission candidate failed before evidence evaluation began.

- Event: `evt:submission-cli-named-options`
- Source: `d0d9bb5b0a2cde1cdc2b236025ac985595613a5d`
- Resolution: Submission preparation and evaluation now accept explicit named options, retain positional compatibility, reject unknown options clearly, and have subprocess coverage for the public command form.
- Observed failure: npm run submission:prepare -- --candidate <sha> treated --candidate as a literal Git reference and produced a spawn error instead of a readiness manifest.
- Invariants: `inv:submission-cli-explicit-options` (verified)
- Evidence: `evd:submission-cli-explicit-options` (pass)
- Known limitations: A generated readiness manifest remains fail-closed until every external evidence gate passes.; This change improves command usability but does not authorize publication or Convex submission.

## Architecture evolution

### Structural availability was mislabeled as browser certification.

- Event: `evt:rendered-browser-certification`
- Source: `e398398d7f1dd4ff0b65409d2c8da971e83bc488`
- Resolution: Structural checks and rendered Playwright evidence are separate, revision-bound proof classes.
- Observed failure: HTTP and DOM checks could pass without proving the rendered user journey.
- Invariants: `inv:rendered-browser-evidence` (verified)
- Evidence: `evd:rendered-browser-certification` (pass)
- Known limitations: External fresh-user timing evidence remains a separate submission gate.

### Historical receipts and internal deep imports could be mistaken for current package and submission guarantees.

- Event: `evt:exact-candidate-contract`
- Source: `1df155370258239ddd315c1f8842ecf0aa55b7e0`
- Resolution: NodeKit now exposes a supported Caseflow package entry point and requires eight distinct, contract-valid decisive verdicts bound to one clean candidate revision before submission.
- Observed failure: Existing proof aliases mixed source identities, omitted decisive revision fields, and exposed Caseflow through an unstable internal path.
- Invariants: `inv:exact-candidate-evidence` (verified), `inv:stable-caseflow-package-entrypoint` (verified)
- Evidence: `evd:exact-candidate-gate` (pass), `evd:caseflow-public-api` (pass)
- Known limitations: Current-revision timing, fresh-agent, human, consumer, preview, package, and independent ProofLoop evidence still must be collected.; The public Caseflow entry point is portable, but no authenticated Convex consumer has yet earned submission-grade adoption status.

### The portable Caseflow conformance suite named idempotency as a requirement without repeating decisions or completion calls.

- Event: `evt:caseflow-idempotent-retries`
- Source: `f3471c7fd31b4839ffeb9c9f43bd0d4ab7ef6bfc`
- Resolution: Caseflow now reuses an active run, returns the original approval for a repeated matching decision, returns the original completion receipt, and verifies all three behaviors in shared conformance.
- Observed failure: An adapter could pass conformance while duplicating artifact versions, approvals, or receipts during an ordinary retry.
- Invariants: `inv:caseflow-idempotent-retries` (verified)
- Evidence: `evd:caseflow-idempotent-retries` (pass)
- Known limitations: Each provider adapter must still demonstrate this contract against its real transactional backend.; Cross-tenant authorization remains an application-wrapper responsibility and is tested separately by each consumer.

## Harness evolution

### Visually polished frontend output could still miss the intended creator-workspace topology.

- Event: `evt:nodevideo-topology-contract`
- Source: `678f2e0b82c2c50c3741c8bbb2a80ed95ff5b159`
- Resolution: Added Frontend Specialist Routing with a protected product contract, three required rendered directions, independent criticism, explicit mobile topology, bounded repair, and a NodeProof-controlled canary.
- Observed failure: NodeVideo was organized as a proof dashboard instead of keeping the primary media artifact, agent context, and proposal review boundary legible across desktop and mobile.
- Invariants: `inv:major-frontend-direction-tournament` (partially-verified)
- Evidence: `evd:nodevideo-topology-failure` (partial)
- Known limitations: No real NodeVideo or NodeSlide consumer has yet completed the three-direction tournament and fresh-browser canary.; No exact resolved model identity was preserved for the historical failed attempt, so this event makes no model capability claim.

