import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { reportsWriteBlockage } from "../src/lib/agent-ease-report.mjs";
import { requiredSubmissionGates } from "../src/lib/submission-gate.mjs";

test("EaseProof keeps browser contracts distinct from certification", async () => {
  const proof = await readFile(path.resolve("templates", "base", "scripts", "proof.mjs"), "utf8");
  const contract = await readFile(path.resolve("templates", "base", "scripts", "browser-proof.mjs"), "utf8");
  const browser = await readFile(path.resolve("templates", "base", "scripts", "browser-certify.mjs"), "utf8");
  assert.match(contract, /not rendered-browser certification/);
  assert.match(contract, /health\?\.certificationRunId === runId/);
  assert.match(contract, /health\?\.serverPid === child\.pid/);
  assert.match(proof, /browserContractPassed/);
  assert.match(proof, /browserCertified/);
  assert.match(browser, /nodekit\.screenshot-proof\/v1/);
  assert.match(browser, /missingStates/);
  assert.match(browser, /AxeBuilder/);
  assert.match(browser, /accessibilityViolations\.length === 0/);
  assert.match(browser, /playwright-trace\.zip/);
  assert.match(browser, /journey\.webm/);
  assert.match(browser, /receipt_reload_confirmed/);
  assert.match(browser, /canonical_state_reset/);
  assert.match(browser, /health\?\.certificationRunId === runId/);
  assert.match(browser, /health\?\.serverPid === server\.pid/);
  assert.match(browser, /NODEKIT_BROWSER_RUN_ID: runId/);
  assert.match(browser, /serverProcess/);
  assert.match(proof, /suppliedBrowserEvidencePassed/);
  assert.match(proof, /checks\.browserJourneyPassed !== false/);
  for (const state of [
    "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
    "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
    "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
  ]) assert.match(browser, new RegExp(`\\b${state}\\b`));
  assert.match(browser, /requiredStates\.length/);
});

test("generated UI scenarios are backed by caseflow conflict, exception, and receipt records", async () => {
  const server = await readFile(path.resolve("templates", "base", "apps", "web", "server.mjs"), "utf8");
  assert.match(server, /decideProposal\(\{ proposalId: stale\.proposalId, decision: "accepted" \}\)/);
  assert.match(server, /raiseException\(\{ runId: current\.run\.runId/);
  assert.match(server, /"receipt_inspection", "export_share"/);
  assert.match(server, /\/api\/scenario/);
  assert.match(server, /certificationRunId: process\.env\.NODEKIT_BROWSER_RUN_ID \?\? null/);
  assert.match(server, /serverPid: process\.pid/);
});

test("fresh-agent recorder preserves process fields and prohibits routine reprompts", async () => {
  const harness = await readFile(path.resolve("scripts", "run-agent-ease-trial.mjs"), "utf8");
  assert.match(harness, /stdout: result\.stdout \?\? ""/);
  assert.match(harness, /--ephemeral/);
  assert.match(harness, /--ignore-user-config/);
  assert.match(harness, /--ignore-rules/);
  assert.match(harness, /CODEX_PERMISSION_PROFILE/);
  assert.match(harness, /candidate write preflight did not round-trip/);
  assert.match(harness, /nodekit-ease-agent:codex-0\.142\.5/);
  assert.match(harness, /target=\/root\/\.codex\/auth\.json,readonly/);
  assert.match(harness, /danger-full-access-inside-disposable-container/);
  assert.match(harness, /"--sandbox", "danger-full-access"/);
  assert.match(harness, /interventions: 0/);
  assert.match(harness, /nodekitCommit,/);
  assert.match(harness, /nodekitSourceHash: sourceHash/);
  assert.ok(harness.indexOf('const nodekitCommit = run("git"') < harness.indexOf("await createProject"));
  assert.ok(harness.indexOf("const sourceHash = await computeNodeKitSourceHash") < harness.indexOf("await createProject"));
  assert.match(harness, /checks\.nodekitIdentityStable = endingNodekitCommit === nodekitCommit && endingNodekitSourceHash === sourceHash/);
  assert.match(harness, /userReprompts: 0/);
  assert.match(harness, /checks\.agentImplemented = substantiveFiles\.length > 0/);
  assert.match(harness, /checks\.agentReportedCompletion/);
  assert.match(harness, /PILOT_FAIL_AGENT_BLOCKED/);
  assert.match(harness, /candidateRoot, "proof", "ease", runId, "browser"/);
});

test("fresh-agent completion detection distinguishes domain blockers from write blockage", () => {
  assert.equal(reportsWriteBlockage("Added tests for blocked missing-document packets."), false);
  assert.equal(reportsWriteBlockage("The workflow surfaces blocked cases for coordinator review."), false);
  assert.equal(reportsWriteBlockage("No repository files were changed because the workspace is read-only."), true);
  assert.equal(reportsWriteBlockage("I was blocked from writing by permissions."), true);
});

test("submission remains fail-closed while external EaseProof gates are open", async () => {
  const factory = await readFile(path.resolve("src", "factory-acceptance.mjs"), "utf8");
  assert.match(factory, /submissionReady: false/);
  assert.doesNotMatch(factory, /submissionBlockers: \["browserStateCoverage"/);
  assert.match(factory, /submissionBlockers: \[\.\.\.requiredSubmissionGates\]/);
  assert.deepEqual(requiredSubmissionGates, [
    "developerTimingMatrix",
    "freshAgentHeldout",
    "freshHumanUsability",
    "threeConvexConsumers",
    "previewDeployment",
    "proofloopEaseVerification",
    "packageInstallProof",
    "publicationApproval",
  ]);
});
