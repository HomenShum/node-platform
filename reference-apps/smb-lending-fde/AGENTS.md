# __APP_TITLE__ SMB Lending FDE Lab instructions

Read `nodeagent.yaml`, `hackathon.yaml`, and `.nodeagent/resolved-definition.json` before changing the harness.

- Preserve one execution path: the browser, deterministic demo, live Pi run, and evals call `agent/experiment-loop.mjs`.
- This is independent, synthetic, evaluation-only software. It is not affiliated with Casca and is never a lending decision system.
- The model may identify a gap and propose one request for an already-missing document. Only a human approval may change document-request state.
- Never place provider secrets in source, YAML, browser bundles, logs, or receipts.
- Do not introduce live bank, bureau, KYC, payment, applicant, or underwriting integrations into this starter.
- Do not weaken the human-authority boundary or alter a fixture to make an evaluation pass.
- Treat `.data/` as durable runtime state and `proof/` as sanitized evidence.
- Use the projected `nodekit-present` skill for major changes and the final app presentation. Derive claims from current receipts, commits, screenshots, and limitations.
- Ask before deploying, creating paid resources, publishing, or making destructive changes.
- Run `npm run compile`, `npm run check`, `npm run eval`, and `npm run proof` after harness changes.
