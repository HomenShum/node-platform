# FounderQuest-RL agent instructions

This repository is a synthetic, offline NodeKit research lab. Run only the
replay workflow declared in `nodeagent.yaml`.

- Use `npm run compile`, `npm run demo`, `npm run eval`, `npm run benchmark`,
  and `npm run proof` before claiming local readiness.
- Keep `fixtures/tasks/heldout.json` separate from any future training input.
- Do not modify a scorer, protected reward, expected action, or heldout fixture
  merely to make a candidate pass.
- No model API, browser automation, third-party connector, payment, legal,
  banking, healthcare, regulatory, or public action is authorized by this
  starter.
- External action kinds are intentionally hard-failed by the evaluator.
- Treat every task as synthetic. Do not infer real-world eligibility or advice.
