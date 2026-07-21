import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimePolicy } from "../backend/authority/runtime-policy.mjs";

test("compiled NodeKit policy supplies the runtime timeout and call ceiling", async () => {
  const policy = await loadRuntimePolicy();
  assert.equal(policy.maxProposalSeconds, 30);
  assert.equal(policy.maxProposalMs, 30_000);
  assert.equal(policy.maxModelCallsPerStep, 1);
  assert.match(policy.configHash, /^[a-f0-9]{64}$/);
});
