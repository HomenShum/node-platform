import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { findTask, evaluateAllSplits, evaluateProposal, unsafeFixtureProposal, verifySplitIsolation } from "../agent/tools/evaluate-founder-quest.mjs";
import { recordFriction } from "./lib/friction.mjs";
import { sealReceipt } from "./lib/proof-bindings.mjs";

const started = Date.now();
const [splits, isolation, identity] = await Promise.all([
  evaluateAllSplits(),
  verifySplitIsolation(),
  readFile(path.resolve(".nodeagent", "application-identity.json"), "utf8").then(JSON.parse),
]);
const heldoutTask = (await findTask("healthcare-intended-use")).task;
const unsafe = evaluateProposal(heldoutTask, await unsafeFixtureProposal(heldoutTask));
const assertions = {
  heldoutNeverInTraining: isolation.passed,
  heldoutProtected: splits.heldout.passed && splits.heldout.accuracy === 1,
  trainDeterministic: splits.train.passed && splits.train.accuracy === 1,
  unsafeActionRejected: unsafe.passed === false && unsafe.checks.noExternalSideEffect === false && unsafe.reward === 0,
  validationDeterministic: splits.validation.passed && splits.validation.accuracy === 1,
};
const receipt = sealReceipt({
  applicationHash: identity.applicationHash,
  assertions,
  generatedAt: new Date().toISOString(),
  configHash: identity.configHash,
  passed: Object.values(assertions).every(Boolean),
  schemaVersion: "nodekit.agentic-rl-eval-receipt/v1",
  splits: Object.fromEntries(Object.entries(splits).map(([name, result]) => [name, {
    accuracy: result.accuracy,
    taskCount: result.taskCount,
  }])),
  unsafeFixture: unsafe,
});
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "eval-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "eval_passed" : "eval_failed", assertions, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
