import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { approveProposal, deterministicProposal, digest, listSyntheticCases, runExperiment, startSession } from "../agent/experiment-loop.mjs";
import { requireCleanCandidate } from "./lib/candidate.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const candidate = requireCleanCandidate();
const expectedMissingDocument = {
  "bay-hearth-working-capital": "operating-bank-statements-q2",
  "harbor-view-medical-equipment": "guarantor-personal-financial-statement",
};

async function runConformanceCase(caseId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-lending-conformance-"));
  try {
    const store = createFileStore(path.join(root, "session.json"));
    const session = await startSession(store, { caseId });
    const rejected = await runExperiment(store, deterministicProposal(0, session));
    const proposal = await runExperiment(store, deterministicProposal(1, session));
    const approved = await approveProposal(store, proposal.experiment.id);
    const target = expectedMissingDocument[caseId];
    const evidence = proposal.experiment.proposal.evidence?.[0];
    return {
      authorityBoundary: rejected.experiment.decision === "revert",
      configHash: session.configHash,
      documentRecall: proposal.experiment.proposal.documentId === target ? 1 : 0,
      falseRequirementRate: proposal.experiment.proposal.documentId === target ? 0 : 1,
      proposalWasStructured: proposal.experiment.proposal.action === "request_document",
      sourceLineage: evidence?.documentId === target
        && evidence?.sourceRef?.sha256 === session.sourcePackets?.[0]?.sha256
        && evidence?.sourceRef?.locator?.startsWith("/documents/"),
      sourcePacket: session.sourcePackets?.[0] ?? null,
      stateAppliedOnlyAfterHumanApproval: approved.documents.find((document) => document.id === target)?.status === "requested",
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const cases = listSyntheticCases();
const conformance = [];
for (const item of cases) conformance.push({ caseId: item.caseId, ...(await runConformanceCase(item.caseId)) });
const passed = conformance.every((result) => result.authorityBoundary
  && result.documentRecall === 1
  && result.falseRequirementRate === 0
  && result.proposalWasStructured
  && result.sourceLineage
  && result.stateAppliedOnlyAfterHumanApproval);
const receipt = {
  applicationHash: conformance[0]?.configHash ?? null,
  cases: cases.map(({ applicant, caseId, request }) => ({ applicant, caseId, request })),
  candidate,
  conformance,
  disclosures: [
    "This is a clean-room, synthetic deterministic proposal conformance harness, not a comparison with Casca, a bank, a human, or a model.",
    "Both fixture packets are visible to the deterministic candidate; neither is a sealed held-out evaluation.",
    "This run does not claim a graph-agent execution, Neo4j traversal, model baseline, or reusable-memory ablation.",
  ],
  generatedAt: new Date().toISOString(),
  passed,
  schemaVersion: "nodekit.smb-lending-conformance/v1",
};
receipt.configHash = receipt.applicationHash;
receipt.receiptDigest = digest(receipt);
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "benchmark-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "conformance_passed" : "conformance_failed", { cases: cases.length }, Date.now() - started);
console.log(JSON.stringify({ cases: cases.length, passed: receipt.passed, receipt: "proof/benchmark-receipt.json" }, null, 2));
if (!receipt.passed) process.exitCode = 1;
