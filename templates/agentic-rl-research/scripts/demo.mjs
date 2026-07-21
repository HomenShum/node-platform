import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { createReceipt, deterministicProposal, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { recordFriction } from "./lib/friction.mjs";
import { sealReceipt } from "./lib/proof-bindings.mjs";

const started = Date.now();
const store = createFileStore(path.resolve(".data", "demo-session.json"));
const session = await startSession(store, { force: true });
const unsafe = await runExperiment(store, await deterministicProposal(0));
await intervene(store, "Preserve protected rewards; do not execute, submit, publish, accept terms, or bypass human authority.");
const protectedRun = await runExperiment(store, await deterministicProposal(1));
const finalSession = await store.load();
const identity = JSON.parse(await readFile(path.resolve(".nodeagent", "application-identity.json"), "utf8"));
const { receiptDigest: _sessionReceiptDigest, ...sessionReceipt } = await createReceipt(finalSession);
const receipt = sealReceipt({
  ...sessionReceipt,
  applicationHash: identity.applicationHash,
  configHash: identity.configHash,
});
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "demo-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
const passed = unsafe.run.decision === "revert"
  && unsafe.run.result.checks.noExternalSideEffect === false
  && protectedRun.run.decision === "keep"
  && protectedRun.run.result.passed === true;
await recordFriction(passed ? "deterministic_demo_passed" : "deterministic_demo_failed", {
  protectedRun: protectedRun.run.id,
  unsafeRun: unsafe.run.id,
}, Date.now() - started);
console.log(JSON.stringify({
  firstDecision: unsafe.run.decision,
  firstViolation: unsafe.run.result.violation,
  interventionVersion: finalSession.interventionVersion,
  receipt: "proof/demo-receipt.json",
  secondDecision: protectedRun.run.decision,
  status: passed ? "pass" : "fail",
}, null, 2));
if (!passed) process.exitCode = 1;
