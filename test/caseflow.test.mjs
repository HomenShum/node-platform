import assert from "node:assert/strict";
import test from "node:test";
import { CASEFLOW_SCHEMA_VERSIONS, createMemoryCaseflow } from "../src/lib/caseflow.mjs";
import { runCaseflowConformance } from "../src/lib/caseflow-conformance.mjs";
import { negotiateRuntimeCapabilities, runtimeProfiles } from "../src/lib/runtime-capabilities.mjs";

test("memory runtime passes the provider-neutral adapter conformance suite", async () => {
  const result = await runCaseflowConformance(() => createMemoryCaseflow());
  assert.equal(result.passed, true);
  assert.equal(result.capabilities.provider, "memory");
});

test("runtime capability negotiation is provider-native and fails closed", () => {
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.convex).passed, true);
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.postgres).passed, true);
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.supabase).passed, true);
  const memoryProduction = negotiateRuntimeCapabilities(runtimeProfiles.memory);
  assert.equal(memoryProduction.passed, false);
  assert.equal(memoryProduction.missing.some((entry) => entry.name === "durableState"), true);
});

test("memory caseflow carries one guided transaction to a content-addressed receipt", () => {
  let tick = 0;
  const runtime = createMemoryCaseflow({ clock: () => `2026-07-21T00:00:${String(tick++).padStart(2, "0")}.000Z` });
  const work = runtime.createCase({ title: "Neutral case", primaryJob: "Produce one reviewable artifact" });
  const run = runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "intake", label: "Confirm the intended outcome", owner: "user" },
      { id: "working", label: "Prepare a proposal", owner: "agent" },
      { id: "review", label: "Review the proposal", owner: "user" },
      { id: "complete", label: "Verify completion", owner: "system" },
    ],
  });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Primary artifact", content: { state: "baseline" } });
  runtime.enterStage({ runId: run.runId, stageId: "working" });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { state: "reviewed result" }, rationale: "Complete the bounded case." });
  runtime.enterStage({ runId: run.runId, stageId: "review" });
  const decided = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  runtime.enterStage({ runId: run.runId, stageId: "complete" });
  const completed = runtime.completeRun({ runId: run.runId });

  assert.equal(runtime.capabilities.provider, "memory");
  assert.equal(decided.artifact.canonicalVersion, 2);
  assert.equal(completed.receipt.schemaVersion, CASEFLOW_SCHEMA_VERSIONS.receipt);
  assert.match(completed.receipt.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(runtime.snapshot().cases[0].status, "completed");
});

test("memory caseflow fails stale proposals closed and preserves the canonical artifact", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Concurrency case", primaryJob: "Preserve human-authoritative state" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "review", label: "Review", owner: "user" }] });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Artifact", content: { value: 1 } });
  const first = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const stale = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 99 } });
  runtime.decideProposal({ proposalId: first.proposalId, decision: "accepted" });
  const result = runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });

  assert.equal(result.proposal.status, "conflicted");
  assert.equal(result.artifact.canonicalVersion, 2);
  assert.deepEqual(result.artifact.versions.at(-1).content, { value: 2 });
});

test("memory caseflow makes exception recovery and next-action ownership explicit", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Recovery case", primaryJob: "Recover without losing valid work" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "working", label: "Work", owner: "agent" }] });
  const raised = runtime.raiseException({ runId: run.runId, code: "source_unavailable", message: "A source could not be reached", preservedState: { completedItems: 2 } });
  assert.equal(runtime.snapshot().runs[0].status, "blocked");
  assert.equal(runtime.snapshot().runs[0].nextActionOwner, "user");
  const resolved = runtime.resolveException({ exceptionId: raised.exceptionId, resolution: "Use the attached source", nextAction: "Resume preparation", nextActionOwner: "agent" });
  assert.equal(resolved.run.status, "active");
  assert.equal(resolved.run.nextActionOwner, "agent");
});

test("memory caseflow retries decisions and completion without duplicate writes", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Retry safety", primaryJob: "Apply once" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const reusedRun = runtime.startRun({ caseId: work.caseId, stages: [{ id: "ignored", label: "Ignored", owner: "system" }] });
  assert.equal(reusedRun.runId, run.runId);
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Result", content: { value: 1 } });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const first = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  const repeated = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  assert.equal(first.reused, false);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.approval.approvalId, first.approval.approvalId);
  assert.equal(runtime.snapshot().artifacts[0].versions.length, 2);
  const completed = runtime.completeRun({ runId: run.runId });
  const retriedCompletion = runtime.completeRun({ runId: run.runId });
  assert.equal(retriedCompletion.reused, true);
  assert.equal(retriedCompletion.receipt.receiptId, completed.receipt.receiptId);
  assert.equal(runtime.snapshot().receipts.length, 1);
});
