/**
 * Provider-neutral Caseflow conformance. An adapter may return values directly
 * or as promises; the suite observes behavior rather than storage mechanics.
 */
export async function runCaseflowConformance(createRuntime, { requiredCapabilities = { optimisticConcurrency: true, transactions: true } } = {}) {
  const runtime = await createRuntime();
  const work = await runtime.createCase({ title: "Adapter conformance", primaryJob: "Preserve one reviewed artifact" });
  const run = await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "working", label: "Prepare", owner: "agent" },
      { id: "review", label: "Review", owner: "user" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  });
  const artifact = await runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Artifact", content: { value: 1 } });
  const accepted = await runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const stale = await runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 99 } });
  const firstDecision = await runtime.decideProposal({ proposalId: accepted.proposalId, decision: "accepted" });
  const staleDecision = await runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });
  const raised = await runtime.raiseException({ runId: run.runId, code: "conformance_pause", message: "Exercise recovery", preservedState: { canonicalVersion: 2 } });
  const recovered = await runtime.resolveException({ exceptionId: raised.exceptionId, resolution: "Resume", nextAction: "Verify", nextActionOwner: "system" });
  await runtime.enterStage({ runId: run.runId, stageId: "complete" });
  const completed = await runtime.completeRun({ runId: run.runId });
  const snapshot = await runtime.snapshot();

  const assertions = {
    canonicalVersionAdvancedOnce: firstDecision.artifact.canonicalVersion === 2,
    contentAddressedReceipt: /^[a-f0-9]{64}$/.test(completed.receipt.receiptHash),
    exceptionStatePreserved: raised.preservedState.canonicalVersion === 2,
    nextActionOwnerExplicit: recovered.run.nextActionOwner === "system",
    oneAuthoritativeCase: snapshot.cases.length === 1 && snapshot.cases[0].status === "completed",
    staleProposalFailedClosed: staleDecision.proposal.status === "conflicted"
      && staleDecision.artifact.versions.at(-1).content.value === 2,
  };
  return {
    assertions,
    capabilityNegotiation: negotiateRuntimeCapabilities(runtime.capabilities, requiredCapabilities),
    capabilities: runtime.capabilities,
    passed: Object.values(assertions).every(Boolean)
      && negotiateRuntimeCapabilities(runtime.capabilities, requiredCapabilities).passed,
    schemaVersion: "nodekit.adapter-conformance/v1",
  };
}
import { negotiateRuntimeCapabilities } from "./runtime-capabilities.mjs";
