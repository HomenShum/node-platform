import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGuidedDemo } from "../agent/workflow.mjs";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const demo = createGuidedDemo();
const initial = demo.start();
const first = demo.runtime.createProposal({ artifactId: initial.artifact.artifactId, baseVersion: 1, patch: { value: "first" } });
const stale = demo.runtime.createProposal({ artifactId: initial.artifact.artifactId, baseVersion: 1, patch: { value: "stale" } });
demo.runtime.decideProposal({ proposalId: first.proposalId, decision: "accepted" });
const conflict = demo.runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });
const raised = demo.runtime.raiseException({ runId: initial.run.runId, code: "fixture_exception", message: "Exercise safe recovery", preservedState: { artifactVersion: 2 } });
const recovered = demo.runtime.resolveException({ exceptionId: raised.exceptionId, resolution: "Fixture resolved", nextAction: "Continue", nextActionOwner: "agent" });
const assertions = {
  canonicalStatePreserved: conflict.artifact.canonicalVersion === 2 && conflict.artifact.versions.at(-1).content.value === "first",
  exceptionPreservedState: raised.preservedState.artifactVersion === 2,
  recoveryOwnerExplicit: recovered.run.nextActionOwner === "agent",
  staleProposalConflicted: conflict.proposal.status === "conflicted",
};
const receipt = { assertions, generatedAt: new Date().toISOString(), passed: Object.values(assertions).every(Boolean), schemaVersion: "nodekit.eval-receipt/v1" };
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "eval-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "eval_passed" : "eval_failed", assertions, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
