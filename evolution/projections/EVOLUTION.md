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

### A generated app could display guided intake and review controls without actually enforcing the intake transition or making the current decision usable in the initial mobile viewport.

- Event: `evt:guided-intake-mobile-decisions`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed product contract requires explicit outcome confirmation before proposal creation, persisted progression into active work, proposal absence during intake, and one state-appropriate mobile decision surface inside the initial viewport.
- Observed failure: DOM presence alone could pass while a premature proposal was accepted or the only meaningful mobile action began below the fold.
- Invariants: `inv:guided-intake-mobile-decisions` (partially-verified)
- Evidence: `evd:guided-intake-mobile-decisions-materiality` (partial)
- Known limitations: The materiality review is not final screenshot evidence and does not certify an uncommitted or later source revision.; Fresh-user timing and consented human usability trials remain open external proof gates.

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

### A checked-in SQL schema was being tracked as portability progress even though no executable NodeKit runtime implemented or proved the full Caseflow contract.

- Event: `evt:postgres-caseflow-adapter`
- Source: `5cc61578b3c1bd5b5c8195b83347b91f8b83242b`
- Resolution: NodeKit now ships a driver-neutral PostgreSQL Caseflow adapter, complete transactional schema, owner-scoped operations, stable public and typed exports, a disposable-provider conformance runner, and a complete Supabase RLS projection over the portable tables.
- Observed failure: The PostgreSQL layer lacked cases, runs, approvals, exceptions, receipts, owner-scoped runtime methods, public package exports, TypeScript declarations, and live provider conformance.
- Invariants: `inv:postgres-caseflow-conformance` (verified)
- Evidence: `evd:postgres-caseflow-conformance` (pass)
- Known limitations: The Supabase SQL projection has not yet passed authenticated live Auth, Storage, Realtime, Queue, and Cron conformance.; PostgreSQL subscriptions use polling and durable jobs remain an external runtime capability by design.

### Extracting Caseflow as an installable Convex Component could weaken receipt bindings, exception containment, retry idempotency, or host authorization boundaries.

- Event: `evt:convex-caseflow-receipt-retry-contract`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed contract requires one portable Caseflow lifecycle across memory, PostgreSQL, and Convex; host-owned authorization; receipt v2 content bindings; multi-exception containment; and fail-closed idempotency-key reuse.
- Observed failure: A reusable-looking component could reopen a still-blocked run, duplicate lifecycle objects during an ordinary retry, or emit a receipt that proves identifiers without proving content and actor bindings.
- Invariants: `inv:caseflow-receipt-retry-containment` (partially-verified)
- Evidence: `evd:convex-caseflow-receipt-retry-materiality` (partial)
- Known limitations: The materiality review is not an exact-revision live PostgreSQL or Convex provider result.; Authenticated consumer adoption and application-wrapper authorization remain separate proof gates.; The review grants no npm publication, production deployment, or Convex directory submission authority.

### Submission evidence could appear complete while describing another source revision, omitting decisive contract fields, duplicating evidence, or lacking scoped publication authority.

- Event: `evt:source-bound-submission-gates`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed release contract requires strict verdict schemas, exact candidate commit and distributable-source bindings, recomputed evidence hashes, distinct decisive evidence, a signed seven-gate candidate, and explicit scoped publication approval.
- Observed failure: Counts and familiar filenames were insufficient to prove that timing, agent, human, consumer, preview, package, independent-review, and approval verdicts described one immutable candidate.
- Invariants: `inv:source-bound-decisive-verdicts` (partially-verified)
- Evidence: `evd:source-bound-submission-gates-materiality` (partial)
- Known limitations: The external timing, fresh-agent, human, consumer, preview, and independent ProofLoop verdicts remain open until collected for the exact candidate.; This review grants no package publication, production deployment, or Convex Component submission permission.; Historical proof cannot certify the final candidate and final evaluation must be rerun after the immutable candidate exists.

## Harness evolution

### Visually polished frontend output could still miss the intended creator-workspace topology.

- Event: `evt:nodevideo-topology-contract`
- Source: `678f2e0b82c2c50c3741c8bbb2a80ed95ff5b159`
- Resolution: Added Frontend Specialist Routing with a protected product contract, three required rendered directions, independent criticism, explicit mobile topology, bounded repair, and a NodeProof-controlled canary.
- Observed failure: NodeVideo was organized as a proof dashboard instead of keeping the primary media artifact, agent context, and proposal review boundary legible across desktop and mobile.
- Invariants: `inv:major-frontend-direction-tournament` (partially-verified)
- Evidence: `evd:nodevideo-topology-failure` (partial)
- Known limitations: No real NodeVideo or NodeSlide consumer has yet completed the three-direction tournament and fresh-browser canary.; No exact resolved model identity was preserved for the historical failed attempt, so this event makes no model capability claim.

### The frontend tournament could print TOURNAMENT DECISIVE from booleans the candidate wrote into its own benchmark, so the NodeSlide pilot metric would have measured how cheaply an agent claimed to pass rather than whether a direction passed an independently observed gate.

- Event: `evt:frontend-decisive-evidence`
- Source: `f4bf70f5356c913aa3d7f28fab83ccba3f94877c`
- Resolution: The decisive verdict is computed from a Frontend Render Contract. A verifier-authored render receipt over the six required states, whose check statuses are derived from raw observations, plus an independent review receipt bound to the same state manifest, are graded DECISIVE / NOT_DECISIVE / FAIL / INCOMPLETE / UNVERIFIED; only DECISIVE authorizes. The benchmark schema dropped the three candidate booleans. A corruption corpus proves each self-attested shortcut lands on the correct graded verdict.
- Observed failure: decisive was browserChecksPassed && accessibilityPassed && overflowPassed && majorFindings.length === 0 over candidate-supplied fields; three true values and two empty arrays authorized the verdict with no evidence binding.
- Invariants: `inv:major-frontend-direction-tournament` (partially-verified)
- Evidence: `evd:frontend-decisive-evidence` (partial)
- Known limitations: The verifier command that drives a real browser over the six states and calls the assembler is not yet wired; receipts are assembled from observations, not from a live browser run.; Freezing a new tournament version so a benchmark cannot be replayed against a stale contract is a separate follow-on.; This makes the tournament's decisiveness honest; it does not by itself certify any real frontend, model, or consumer.

