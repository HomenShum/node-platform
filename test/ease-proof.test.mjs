import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("EaseProof keeps browser contracts distinct from certification", async () => {
  const proof = await readFile(path.resolve("templates", "base", "scripts", "proof.mjs"), "utf8");
  const contract = await readFile(path.resolve("templates", "base", "scripts", "browser-proof.mjs"), "utf8");
  const browser = await readFile(path.resolve("templates", "base", "scripts", "browser-certify.mjs"), "utf8");
  assert.match(contract, /not rendered-browser certification/);
  assert.match(proof, /browserContractPassed/);
  assert.match(proof, /browserCertified/);
  assert.match(browser, /nodekit\.screenshot-proof\/v1/);
  assert.match(browser, /missingStates/);
});

test("fresh-agent recorder preserves process fields and prohibits routine reprompts", async () => {
  const harness = await readFile(path.resolve("scripts", "run-agent-ease-trial.mjs"), "utf8");
  assert.match(harness, /stdout: result\.stdout \?\? ""/);
  assert.match(harness, /--ephemeral/);
  assert.match(harness, /--ignore-user-config/);
  assert.match(harness, /interventions: 0/);
  assert.match(harness, /userReprompts: 0/);
  assert.match(harness, /checks\.agentImplemented = substantiveFiles\.length > 0/);
  assert.match(harness, /checks\.agentReportedCompletion/);
  assert.match(harness, /PILOT_FAIL_AGENT_BLOCKED/);
  assert.match(harness, /candidateRoot, "proof", "ease", runId, "browser"/);
});

test("submission remains fail-closed while external EaseProof gates are open", async () => {
  const factory = await readFile(path.resolve("src", "factory-acceptance.mjs"), "utf8");
  assert.match(factory, /submissionReady: false/);
  for (const blocker of ["freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "proofloopEaseVerification"]) {
    assert.match(factory, new RegExp(blocker));
  }
});
