import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGuidedDemo } from "../agent/workflow.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const demo = createGuidedDemo();
const initial = demo.start();
const proposal = demo.propose({ artifactId: initial.artifact.artifactId, runId: initial.run.runId });
const completed = demo.decide({ decision: "accepted", proposalId: proposal.proposalId, runId: initial.run.runId });
const snapshot = demo.runtime.snapshot();
const receipt = {
  assertions: {
    canonicalVersionAdvanced: completed.artifact.canonicalVersion === 2,
    explicitNextAction: snapshot.runs[0].nextActionOwner === "user",
    proposalAccepted: completed.proposal.status === "accepted",
    receiptCreated: Boolean(completed.receipt.receiptHash),
  },
  receipt: completed.receipt,
  schemaVersion: "nodekit.figured-out-demo/v1",
  snapshot,
};
receipt.passed = Object.values(receipt.assertions).every(Boolean);
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "demo-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "deterministic_demo_passed" : "deterministic_demo_failed", receipt.assertions, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
