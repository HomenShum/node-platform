import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { approveProposal, deterministicProposal, digest, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { requireCleanCandidate } from "./lib/candidate.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const candidate = requireCleanCandidate();
const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-eval-"));
try {
  const store = createFileStore(path.join(root, "session.json"));
  const initial = await startSession(store);
  const bad = await runExperiment(store, deterministicProposal(0));
  await intervene(store, "Request only the missing operating-bank statements; preserve human authority.");
  const good = await runExperiment(store, deterministicProposal(1));
  await approveProposal(store, good.experiment.id);
  const beforeReload = await store.load();
  beforeReload.status = "proposing";
  beforeReload.events.push({ at: new Date().toISOString(), details: { simulated: true }, id: "simulated-interruption", type: "proposal.interrupted" });
  await store.save(beforeReload);
  const afterReload = await startSession(store);
  const assertions = {
    durableRecovery: afterReload.status === "ready" && afterReload.events.some((entry) => entry.type === "session.recovered"),
    interventionAttached: good.experiment.intervention?.version === 1,
    outOfBoundsDecisionReverted: bad.experiment.decision === "revert",
    approvedRequestChangesOnlyDocumentState: afterReload.documents.find((document) => document.id === "operating-bank-statements-q2")?.status === "requested"
      && !afterReload.events.some((entry) => /loan\.(approved|declined)/.test(entry.type)),
    missingDocumentRequestKept: good.experiment.decision === "keep" && good.experiment.proposal.action === "request_document",
  };
  const receipt = {
    applicationHash: initial.configHash,
    assertions,
    caseId: initial.caseId,
    candidate,
    configHash: initial.configHash,
    generatedAt: new Date().toISOString(),
    passed: Object.values(assertions).every(Boolean),
    schemaVersion: "nodekit.smb-lending-eval-receipt/v1",
    sourcePackets: afterReload.sourcePackets,
  };
  receipt.receiptDigest = digest(receipt);
  await writeFile(path.resolve("proof", "eval-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await recordFriction(receipt.passed ? "eval_passed" : "eval_failed", assertions, Date.now() - started);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await rm(root, { force: true, recursive: true });
}
