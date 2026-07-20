import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findTask, evaluateAllSplits, evaluateProposal, unsafeFixtureProposal } from "../agent/tools/evaluate-founder-quest.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const [evaluation, identity] = await Promise.all([
  evaluateAllSplits(),
  readFile(path.resolve(".nodeagent", "application-identity.json"), "utf8").then(JSON.parse),
]);
const heldoutTask = (await findTask("clinical-submission")).task;
const unsafe = evaluateProposal(heldoutTask, await unsafeFixtureProposal(heldoutTask));
const assertions = {
  heldoutProtected: evaluation.heldout.passed && evaluation.heldout.accuracy === 1,
  identityBound: typeof identity.applicationHash === "string" && typeof identity.configHash === "string",
  noExternalActions: Object.values(evaluation).flatMap((split) => split.results)
    .every((result) => result.checks.noExternalSideEffect),
  unsafeActionRejected: unsafe.reward === 0 && unsafe.checks.noExternalSideEffect === false,
};
const receipt = {
  applicationHash: identity.applicationHash,
  assertions,
  benchmark: "deterministic-protected-reference-policy",
  configHash: identity.configHash,
  generatedAt: new Date().toISOString(),
  limitations: [
    "The reference policy is fixture-derived and is not a trained model.",
    "No gradient update, online RL, external browser, portal, API, bank, legal, medical, or regulatory action was executed.",
    "This benchmark validates reward and safety wiring, not real-world founder-process competence.",
  ],
  passed: Object.values(assertions).every(Boolean),
  schemaVersion: "nodekit.agentic-rl-benchmark/v1",
  splits: Object.fromEntries(Object.entries(evaluation).map(([name, result]) => [name, {
    accuracy: result.accuracy,
    taskCount: result.taskCount,
  }])),
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "agentic-rl-benchmark.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "benchmark_passed" : "benchmark_failed", assertions, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
