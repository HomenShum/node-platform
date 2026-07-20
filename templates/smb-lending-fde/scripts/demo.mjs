import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { approveProposal, createReceipt, deterministicProposal, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { requireCleanCandidate } from "./lib/candidate.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const candidate = requireCleanCandidate();
const store = createFileStore(path.resolve(".data", "demo-session.json"));
const session = await startSession(store, { force: true });
const outOfBounds = await runExperiment(store, deterministicProposal(0));
await intervene(store, "Prioritize the missing operating-bank statements and preserve the human underwriting boundary.");
const request = await runExperiment(store, deterministicProposal(1));
await approveProposal(store, request.experiment.id);
const finalSession = await store.load();
const receipt = await createReceipt(finalSession, { candidate });
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "demo-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction("deterministic_demo_passed", { experiments: 2 }, Date.now() - started);
console.log(JSON.stringify({
  applicant: finalSession.applicant,
  firstDecision: outOfBounds.experiment.decision,
  interventionVersion: finalSession.interventionVersion,
  readiness: finalSession.readiness,
  receipt: "proof/demo-receipt.json",
  secondDecision: request.experiment.decision,
  status: outOfBounds.experiment.decision === "revert"
    && request.experiment.decision === "keep"
    && finalSession.documents.find((document) => document.id === "operating-bank-statements-q2")?.status === "requested"
    ? "pass"
    : "fail",
}, null, 2));
if (outOfBounds.experiment.decision !== "revert" || request.experiment.decision !== "keep") process.exitCode = 1;
