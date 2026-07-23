import { createMemoryCaseflow } from "__NODEKIT_RUNTIME_IMPORT__";

export const stages = Object.freeze([
  { id: "intake", label: "Confirm the intended outcome", owner: "user" },
  { id: "working", label: "Prepare a proposal", owner: "agent" },
  { id: "review", label: "Review the proposed change", owner: "user" },
  { id: "complete", label: "Verify and export", owner: "system" },
]);

export function createGuidedDemo(options = {}) {
  const runtime = createMemoryCaseflow(options);

  function start() {
    const work = runtime.createCase({
      primaryJob: __BRIEF_JSON__,
      title: "__APP_TITLE__ case",
    });
    const run = runtime.startRun({ caseId: work.caseId, stages });
    const artifact = runtime.createArtifact({
      caseId: work.caseId,
      content: { summary: "The last approved result remains here.", status: "baseline" },
      kind: "structured-document",
      runId: run.runId,
      title: "Primary artifact",
    });
    return { artifact, case: work, run };
  }

  function propose({ artifactId, runId }) {
    runtime.enterStage({ runId, stageId: "working" });
    const proposal = runtime.createProposal({
      artifactId,
      baseVersion: runtime.snapshot().artifacts.find((entry) => entry.artifactId === artifactId).canonicalVersion,
      patch: {
        summary: "A bounded, reviewable result is ready. Replace this with the researched domain artifact.",
        status: "proposed",
      },
      rationale: "Demonstrate proposal-before-mutation without assuming a domain.",
    });
    runtime.enterStage({ runId, stageId: "review", nextAction: "Approve or reject the proposed change", nextActionOwner: "user" });
    return proposal;
  }

  function decide({ proposalId, runId, decision }) {
    const result = runtime.decideProposal({ proposalId, decision });
    if (decision === "accepted" && result.proposal.status === "accepted") {
      runtime.enterStage({ runId, stageId: "complete" });
      return { ...result, ...runtime.completeRun({ runId }) };
    }
    return result;
  }

  return { decide, propose, runtime, start };
}
