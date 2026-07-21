import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { deterministicProposal, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-eval-"));
try {
  const store = createFileStore(path.join(root, "session.json"));
  const initial = await startSession(store);
  const bad = await runExperiment(store, deterministicProposal(0));
  await intervene(store, "Only vary context width; preserve corpus and evaluator.");
  const good = await runExperiment(store, deterministicProposal(1));
  const beforeReload = await store.load();
  beforeReload.status = "measuring";
  beforeReload.events.push({ at: new Date().toISOString(), details: { simulated: true }, id: "simulated-interruption", type: "experiment.interrupted" });
  await store.save(beforeReload);
  const afterReload = await startSession(store);
  const assertions = {
    durableRecovery: afterReload.status === "ready" && afterReload.events.some((entry) => entry.type === "session.recovered"),
    interventionAttached: good.experiment.intervention?.version === 1,
    regressionReverted: bad.experiment.decision === "revert",
    strictImprovementKept: good.experiment.decision === "keep" && good.session.best.heldoutBitsPerCharacter < initial.best.heldoutBitsPerCharacter,
  };
  const receipt = { assertions, generatedAt: new Date().toISOString(), passed: Object.values(assertions).every(Boolean), schemaVersion: "nodekit.eval-receipt/v1" };
  await writeFile(path.resolve("proof", "eval-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await recordFriction(receipt.passed ? "eval_passed" : "eval_failed", assertions, Date.now() - started);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await rm(root, { force: true, recursive: true });
}
