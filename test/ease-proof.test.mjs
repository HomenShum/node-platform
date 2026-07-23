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
  assert.match(browser, /NODEKIT_TARBALL_SHA256/);
  assert.match(browser, /nodekitTarballIdentity\?\.digest === nodekitTarballSha256/);
  assert.match(browser, /nodekitSourceBound/);
  assert.match(browser, /nodekitTarballBound/);
  assert.match(browser, /nodekitTarballSha256/);
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
  assert.match(browser, /if \(!certified\) process\.exitCode = 1/);
  assert.match(browser, /BROWSER_JOURNEY_PASS_IDENTITY_UNBOUND/);
  assert.match(browser, /assertReviewState/);
  assert.match(browser, /activityModeOperable/);
  assert.match(browser, /activity_mode_verified/);
  assert.match(browser, /stateActionsCoherent/);
  assert.match(browser, /conflictRecovered/);
  assert.match(browser, /exceptionRecovered/);
  assert.match(browser, /exportBlockedBeforeCompletion/);
  assert.match(browser, /exportDownloadedAndVerified/);
  assert.match(browser, /verifyExportedProof/);
  assert.match(browser, /portable-proof-bundle/);
  assert.match(browser, /receiptHash !== contentHash\(receiptBody\)/);
  assert.match(browser, /export_downloaded_and_reopened/);
  assert.match(browser, /outcomeConfirmed/);
  assert.match(browser, /proposalBlockedBeforeConfirmation/);
  assert.match(browser, /mobile current action is outside the initial viewport/);
  assert.match(browser, /\\u00c2\\S/);
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
  assert.match(server, /\/api\/recover/);
  assert.match(server, /\/api\/resolve-conflict/);
  assert.match(server, /\/api\/confirm/);
  assert.match(server, /\/api\/export/);
  assert.match(server, /nodekit\.portable-proof-bundle\/v1/);
  assert.match(server, /content-disposition/);
  assert.match(server, /confirm the outcome before preparing a proposal/);
  assert.match(server, /the outcome is already confirmed/);
  assert.match(server, /there is no contained conflict to resolve/);
});

test("generated UI exposes one coherent next action for each lifecycle state", async () => {
  const html = await readFile(path.resolve("templates", "base", "apps", "web", "public", "index.html"), "utf8");
  const app = await readFile(path.resolve("templates", "base", "apps", "web", "public", "app.js"), "utf8");
  assert.match(html, /id="review-eyebrow">NEXT STEP/);
  assert.match(html, /id="review-title"[^>]*>Confirm the intended outcome/);
  assert.match(html, /id="resume" hidden/);
  assert.match(html, /id="resolve-conflict" hidden/);
  assert.match(html, /id="mobile-action"/);
  assert.match(html, /id="download-proof"/);
  assert.match(html, /id="copy-share"/);
  assert.match(app, /"DECISION REQUIRED", "Review proposed change"/);
  assert.match(app, /"CONFLICT CONTAINED", "Resolve version conflict"/);
  assert.match(app, /"RECOVERY REQUIRED", "Resume from preserved state"/);
  assert.match(app, /"VERIFIED RESULT", "Completion evidence"/);
  assert.match(app, /"NEXT STEP", "Confirm the intended outcome"/);
  assert.match(app, /elements\.propose\.hidden = !canPropose/);
  assert.match(app, /elements\.proposal\.hidden = intake/);
  assert.match(app, /elements\.approve\.hidden = !pending/);
  assert.match(app, /act\("\/api\/confirm", \{ outcome \}\)/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /artifact v\$\{state\.proposal\.baseVersion\} ·/);
  assert.doesNotMatch(app, /Â/);
});

test("fresh-agent recorder preserves process fields and prohibits routine reprompts", async () => {
  const harness = await readFile(path.resolve("scripts", "run-agent-ease-trial.mjs"), "utf8");
  assert.match(harness, /stdout: result\.stdout \?\? ""/);
  assert.match(harness, /--ephemeral/);
  assert.match(harness, /--ignore-user-config/);
  assert.match(harness, /"--setting-sources", "project"/);
  assert.match(harness, /rulesIgnored: false/);
  assert.match(harness, /CODEX_HOME: "\/tmp\/nodekit-home\/\.codex"/);
  assert.match(harness, /candidate write preflight did not round-trip/);
  assert.match(harness, /--agent-container-image=<reference> is required/);
  assert.match(harness, /--agent-container-image-id must be an exact Docker image ID/);
  assert.match(harness, /agentProfile/);
  assert.match(harness, /agentDriver/);
  assert.match(harness, /every live brokered profile requires --agentModel/);
  assert.match(harness, /NODEKIT_BROKER_ALLOWED_MODEL=\$\{agentModel\}/);
  assert.match(harness, /commands\[0\] === requiredScaffold/);
  assert.doesNotMatch(harness, /firstMutatingCommandPattern/);
  assert.match(harness, /claude-code/);
  assert.match(harness, /--no-session-persistence/);
  assert.match(harness, /OPENAI_API_KEY: "broker-managed"/);
  assert.match(harness, /ANTHROPIC_API_KEY: "broker-managed"/);
  assert.match(harness, /nodekit\.agent-ease-trial\/v2/);
  assert.match(harness, /evidenceSetSha256/);
  assert.match(harness, /agentSessionId/);
  assert.match(harness, /agentSessionIdentityRecorded/);
  assert.match(harness, /receipt\.receiptSha256 = sha256\(JSON\.stringify\(receipt\)\)/);
  assert.match(harness, /"add", "-A"/);
  assert.match(harness, /"diff", "--cached", "--binary", "HEAD"/);
  assert.match(harness, /"write-tree"/);
  assert.doesNotMatch(harness, /target=\/root\/\.codex\/auth\.json/);
  assert.match(harness, /danger-full-access-inside-disposable-container/);
  assert.match(harness, /"--sandbox", "danger-full-access"/);
  assert.match(harness, /interventions: 0/);
  assert.match(harness, /nodekitCommit,/);
  assert.match(harness, /nodekitSourceHash: sourceHash/);
  assert.match(harness, /--nodekit-tarball=<exact-candidate\.tgz> is required/);
  assert.match(harness, /inspectNpmPackageArchiveFile/);
  assert.match(harness, /exact NodeKit launcher installation/);
  assert.match(harness, /installed NodeKit CLI scaffold/);
  assert.match(harness, /installedPackageExactlyMatchesArchive/);
  assert.match(harness, /installed launcher package bytes differ from the inspected NodeKit tarball/);
  assert.match(harness, /"--nodekit-specifier", "file:vendor\/nodekit\.tgz"/);
  assert.match(harness, /checks\.nodekitRuntimeBound/);
  assert.match(harness, /nodekitTarballSha256,/);
  assert.match(harness, /applicationHash,/);
  assert.match(harness, /configHash,/);
  assert.doesNotMatch(harness, /import \{ createProject \}/);
  assert.ok(harness.indexOf('const nodekitCommit = run("git"') < harness.indexOf("installed NodeKit CLI scaffold"));
  assert.ok(harness.indexOf("const sourceHash = await computeNodeKitSourceHash") < harness.indexOf("installed NodeKit CLI scaffold"));
  assert.match(harness, /checks\.nodekitIdentityStable = endingNodekitCommit === nodekitCommit && endingNodekitSourceHash === sourceHash/);
  assert.match(harness, /userReprompts: 0/);
  assert.match(harness, /checks\.agentImplemented = substantiveFiles\.length > 0/);
  assert.match(harness, /checks\.agentReportedCompletion/);
  assert.match(harness, /PILOT_FAIL_AGENT_BLOCKED/);
  assert.match(harness, /candidateRoot, "proof", "ease", runId, "browser"/);
});

test("fresh-agent evaluator enforces the complete 15-run cross-agent matrix", async () => {
  const evaluator = await readFile(path.resolve("scripts", "evaluate-agent-ease.mjs"), "utf8");
  assert.match(evaluator, /codex: 3/);
  assert.match(evaluator, /"claude-code": 1/);
  assert.match(evaluator, /"lower-cost": 1/);
  assert.match(evaluator, /requiredRuns/);
  assert.match(evaluator, /exact candidate requires/);
  assert.match(evaluator, /receipt hash is invalid/);
  assert.match(evaluator, /session transcript does not bind the recorded agent session identity/);
  assert.match(evaluator, /evidence hash mismatch/);
  assert.match(evaluator, /trial tarball SHA-256 does not match the exact candidate tarball/);
  assert.match(evaluator, /application-identity evidence does not bind the generated applicationHash\/configHash/);
  assert.match(evaluator, /evidence path is not canonical/);
  assert.match(evaluator, /releaseCandidate/);
  assert.match(evaluator, /allAttemptsSelected/);
  assert.match(evaluator, /nodekit\.fresh-agent-verdict\/v2/);
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
    "managedSupabasePortability",
    "knowledgeEvolutionAdoption",
    "modelIntelligenceHarness",
    "engineeringHealth",
    "proofloopEaseVerification",
    "packageInstallProof",
    "publicationApproval",
  ]);
});

test("developer timer starts at an empty launcher and invokes the exact installed tarball", async () => {
  const [factory, workflow] = await Promise.all([
    readFile(path.resolve("src", "factory-acceptance.mjs"), "utf8"),
    readFile(path.resolve(".github", "workflows", "ease-proof.yml"), "utf8"),
  ]);
  assert.match(factory, /empty-launcher-before-package-json-to-completed-proof/);
  assert.match(factory, /packageInstallArgs\(cache, tarball\)/);
  assert.match(factory, /installedCli\(launcher\)/);
  assert.match(factory, /"--nodekit-specifier", "file:vendor\/nodekit\.tgz"/);
  assert.match(factory, /generated_application_installation/);
  assert.match(factory, /browser_runtime_installation/);
  assert.doesNotMatch(factory, /createProject\(/);
  assert.doesNotMatch(workflow, /npx playwright install chromium/);
});
