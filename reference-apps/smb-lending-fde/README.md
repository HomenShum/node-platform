# __APP_TITLE__

An independent, synthetic, evaluation-only SMB lending forward-deployment lab generated from NodeKit's `smb-lending-fde` preset.

It demonstrates a narrow FDE workflow:

```text
Synthetic credit-file intake
→ visible missing evidence
→ bounded document-request proposal
→ human approval
→ durable receipt
```

The UI includes a deterministic, read-only local process-graph explorer for blockers,
critical path, and authority questions. It is not a Neo4j deployment or an LLM graph
agent; those belong to a later authenticated Founder Quest graph pack.

## Safety boundary

- Not affiliated with Casca, a bank, or a lender.
- All fixture material is synthetic and marked `SYNTHETIC - NO REAL CUSTOMER DATA`.
- Not financial, legal, credit, or lending advice.
- The agent never makes, recommends, approves, declines, or simulates a lending decision.
- A human underwriter or credit authority owns every lending decision.
- No live bank, KYC, credit-bureau, payment, applicant, or underwriting integration is included.

## Start locally

```bash
npm install
npm run compile
npm run demo
npm run eval
npm run benchmark
npm run proof
npm run dev
```

Open the local URL printed by `npm run dev`, load the synthetic Bay Hearth Foods case, find the safe next action, inspect its evidence, approve the request, and export the readiness receipt.

No-key replay is the default. A live Pi route is optional only for a local synthetic
test after adding a configured provider key **and** setting
`NODEKIT_ENABLE_LOCAL_LIVE_PI=true`. It is constrained to one document-request
proposal and cannot broaden authority. This starter fails closed for networked
mutations and must not be deployed publicly until an authenticated workspace adapter
exists.

## What gets proved

- A simulated loan-approval attempt is deterministically rejected.
- A request can target only an explicitly missing document.
- The request stays pending until a human approves it.
- Approval changes only document-request state, not a credit decision.
- Interrupted proposal state recovers on reload.
- The declared SMB lending pack fails closed if its local tool or validator modules drift from `packs/primary/pack.yaml`.
- Proposal, approval, and receipt events record the concrete local tool and validator IDs plus output hashes.
- The receipt binds the compiled NodeKit application identity.
- The deterministic conformance harness runs the same proposal-only contract on restaurant and medical-practice fixture packets. It does not claim sealed held-out performance, graph-agent execution, memory improvement, or model superiority.

## What this starter does not claim

This is not a loan-origination system or a reproduction of a bank's policies. It is a clean-room FDE demonstration of workflow mapping, evidence gaps, guarded agent proposals, human authority, and proof-carrying application behavior.
