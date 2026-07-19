import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { createReceipt, deterministicProposal, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const store = createFileStore(path.resolve(".data", "demo-session.json"));
const session = await startSession(store, { force: true });
const regression = await runExperiment(store, deterministicProposal(0));
await intervene(store, "Test context width next; leave the corpus and metric unchanged.");
const improvement = await runExperiment(store, deterministicProposal(1));
const finalSession = await store.load();
const receipt = await createReceipt(finalSession);
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "demo-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction("deterministic_demo_passed", { experiments: 2 }, Date.now() - started);
console.log(JSON.stringify({
  baseline: session.baseline.heldoutBitsPerCharacter,
  best: finalSession.best.heldoutBitsPerCharacter,
  firstDecision: regression.experiment.decision,
  interventionVersion: finalSession.interventionVersion,
  receipt: "proof/demo-receipt.json",
  secondDecision: improvement.experiment.decision,
  status: regression.experiment.decision === "revert" && improvement.experiment.decision === "keep" ? "pass" : "fail",
}, null, 2));
if (regression.experiment.decision !== "revert" || improvement.experiment.decision !== "keep") process.exitCode = 1;
