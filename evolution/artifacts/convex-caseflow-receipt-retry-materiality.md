# Convex Caseflow, receipt v2, containment, and retry materiality review

Status: human-reviewed material change; exact-revision implementation and provider proof pending.

Reviewer: project-owner

Reviewed at: 2026-07-22T02:33:14-07:00

## Why this is material

Extracting Caseflow into an installable Convex Component changes architectural ownership and the public lifecycle contract. Receipt strength, exception containment, and retry semantics are downstream trust guarantees: a component can look reusable while losing authorization boundaries, reopening a still-blocked run, or duplicating lifecycle objects after ordinary retries.

## Reviewed response

The candidate is expected to implement one portable Caseflow contract across memory, PostgreSQL, and the isolated Convex Component:

- the shared lifecycle owns exactly cases, runs, stages, artifacts, artifact versions, proposals, approvals, exceptions, receipts, and events;
- host applications retain authentication, membership, domain bindings, files, jobs, worker credentials, and UI authority;
- the Convex boundary accepts an opaque host-authorized scope key and does not read host authentication state from inside the component;
- public component functions use explicit argument and return validators and string identifiers at the package boundary;
- resolving one exception keeps a run blocked while any other exception remains open;
- receipt schema `nodekit.receipt/v2` binds case and run state plus artifact, proposal, approval, and event content, including actor hashes, instead of proving only identifiers and a timestamp;
- `enterStage`, `createArtifact`, `createProposal`, and `raiseException` accept explicit idempotency keys; a repeated key with the same request returns the original result, while reuse with a different request fails;
- provider implementations use the existing event journal or equivalent transactional mechanism rather than adding an ungoverned parallel lifecycle store.

## Required verification

- Shared Caseflow conformance must exercise input updates, multiple simultaneous exceptions, receipt-v2 hash reconstruction and bindings, same-request retries, and conflicting idempotency-key reuse.
- Memory, live disposable PostgreSQL, and `convex-test` component suites must pass the same observable contract.
- The packed package must expose the supported Convex component, client, generated component reference, and testing entry points.
- Authenticated consumer adoption remains a separate, consumer-side proof gate.

## Claims deliberately not made

- This review is not a live Convex deployment or production authorization result.
- It does not claim final consumer adoption from copied sidecar adapters.
- It does not certify PostgreSQL or Convex behavior until their exact-revision provider suites pass.
- It does not authorize npm publication or Convex directory submission.
