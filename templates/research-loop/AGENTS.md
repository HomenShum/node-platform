# __APP_TITLE__ agent instructions

Read `nodeagent.yaml`, `hackathon.yaml`, and `.nodeagent/resolved-definition.json` before changing the harness.

- Preserve one execution path: the browser, deterministic demo, live Pi run, and evals call `agent/experiment-loop.mjs`.
- Keep the evaluator deterministic. Model output may propose an experiment but cannot decide whether it passed.
- Never place provider secrets in source, YAML, browser bundles, logs, or receipts.
- Do not weaken a metric or fixture to make an experiment pass.
- Treat `.data/` as durable runtime state and `proof/` as sanitized evidence.
- Ask before deploying, creating paid resources, publishing, or making destructive changes.
- Run `npm run compile`, `npm run check`, `npm run eval`, and `npm run proof` after harness changes.
