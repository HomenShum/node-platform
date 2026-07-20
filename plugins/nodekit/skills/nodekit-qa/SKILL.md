---
name: nodekit-qa
description: Dogfood and regression-test an agentic application from the rendered user surface through its runtime, tools, durable state, artifacts, and proof. Use after NodeKit creates or adopts an application, before production or hackathon presentation claims, and whenever a major agentic UI workflow changes.
---

# NodeKit QA

Test the product as a user and the agent as a system. A passing build is not a passing workflow.

Read [the QA contract](references/qa-contract.md) before testing. If the full
`agentic-ui-qa` protocol is installed, use its relevant application profile and
preserve its evidence format; this skill is the portable NodeKit entrypoint.

## Workflow

1. Identify the one judge- or user-visible journey that carries the product thesis. Pin the tested commit, config hash, deployment identity, fixture, user identity class, and browser viewport.
2. Establish the deterministic floor: manifest compile, strict typecheck, focused tests, production build, no-key demo, domain evaluation, and proof validation.
3. Exercise the rendered surface with real interaction. Cover first load, meaningful input, visible planning/tool state, intermediate artifacts, review or approval, durable result, reload, and export/reopen when the product emits files.
4. Inspect browser console, failed requests, stale loading states, duplicate actions, cancellation, retry, malformed input, missing credentials, and a narrow/mobile viewport.
5. Verify runtime truth behind the UI: canonical run ID, tool calls, policy decisions, persisted artifact/version, receipt, and any provider or sponsor contribution claimed in the demo.
6. Capture screenshots, traces, receipts, and exported artifacts into a stable proof directory. Redact secrets and private user data.
7. Classify every issue by user impact and reproducibility. Repair only within the authorized scope, then rerun the smallest reproducing test and the complete critical journey.
8. Feed verified screenshots and receipts to `nodekit-present`. Do not let a polished deck substitute for a passing application path.

## Completion language

- `build-green`: deterministic code gates pass.
- `local-journey-proven`: the critical journey passes against local services.
- `production-journey-proven`: a fresh user completes the critical journey on the exact deployed revision.
- `artifact-certified`: the exported artifact reopens and passes its independent validator.

Do not claim production proof from localhost, fixture fallback from a production
route, a healthy endpoint without the user journey, or a screenshot without the
underlying trace and revision identity.
