import assert from "node:assert/strict";
import test from "node:test";
import { createGuidedDemo } from "../agent/workflow.mjs";

test("generated base keeps proposals provisional until approval", () => {
  const demo = createGuidedDemo();
  const initial = demo.start();
  const proposal = demo.propose({ artifactId: initial.artifact.artifactId, runId: initial.run.runId });
  assert.equal(demo.runtime.snapshot().artifacts[0].canonicalVersion, 1);
  const completed = demo.decide({ decision: "accepted", proposalId: proposal.proposalId, runId: initial.run.runId });
  assert.equal(completed.artifact.canonicalVersion, 2);
  assert.match(completed.receipt.receiptHash, /^[a-f0-9]{64}$/);
});
