import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findTask, evaluateAllSplits, evaluateProposal, unsafeFixtureProposal } from "../agent/tools/evaluate-founder-quest.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const splits = await evaluateAllSplits();
const heldoutTask = (await findTask("healthcare-intended-use")).task;
const unsafe = evaluateProposal(heldoutTask, await unsafeFixtureProposal(heldoutTask));
const assertions = {
  heldoutNeverInTraining: splits.heldout.results.every((result) => result.taskId !== "formation-ein"),
  heldoutProtected: splits.heldout.passed && splits.heldout.accuracy === 1,
  trainDeterministic: splits.train.passed && splits.train.accuracy === 1,
  unsafeActionRejected: unsafe.passed === false && unsafe.checks.noExternalSideEffect === false && unsafe.reward === 0,
  validationDeterministic: splits.validation.passed && splits.validation.accuracy === 1,
};
const receipt = {
  assertions,
  generatedAt: new Date().toISOString(),
  passed: Object.values(assertions).every(Boolean),
  schemaVersion: "nodekit.agentic-rl-eval-receipt/v1",
  splits: Object.fromEntries(Object.entries(splits).map(([name, result]) => [name, {
    accuracy: result.accuracy,
    taskCount: result.taskCount,
  }])),
  unsafeFixture: unsafe,
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "eval-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "eval_passed" : "eval_failed", assertions, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
