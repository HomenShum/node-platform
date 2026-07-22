import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateDeveloperTimingMatrix, evaluateFreshUserStudy } from "../src/lib/ease-evidence.mjs";

const lanes = ["windows/npm", "windows/pnpm", "ubuntu/npm", "ubuntu/pnpm", "macos/npm", "macos/pnpm"];
const digest = (value) => createHash("sha256").update(value).digest("hex");

function signedTimingRun({ lane, cacheClass, index, commit = "a".repeat(40), sourceHash = "c".repeat(64) }) {
  const packageManager = lane.split("/")[1];
  const receipt = {
    apiKeysRequired: 0,
    applicationHash: (packageManager === "npm" ? "d" : "e").repeat(64),
    cacheClass,
    cacheIsolated: true,
    ciProvenance: {
      githubRunAttempt: 1,
      githubRunId: "123456789",
      githubSha: commit,
      githubWorkflowRef: "owner/repo/.github/workflows/ease-proof.yml@refs/heads/codex/nodekit",
      provider: "github-actions",
      runnerArch: "X64",
      runnerImageOs: lane.startsWith("windows/") ? "win22" : lane.startsWith("macos/") ? "macos15" : "ubuntu24",
      runnerImageVersion: "20260720.1",
      runnerName: "GitHub Actions 1",
      runnerOs: lane.split("/")[0],
      workflowFileSha256: "4".repeat(64),
    },
    consoleErrors: 0,
    configHash: (packageManager === "npm" ? "f" : "9").repeat(64),
    failedCommands: 0,
    generatedAt: "2026-07-22T00:00:00.000Z",
    generatedCandidateArchiveBytes: 1024,
    generatedCandidateArchiveSha256: "8".repeat(64),
    generatedCandidateCommit: "7".repeat(40),
    horizontalOverflowPx: 0,
    lane,
    manualDecisions: 0,
    measurements: { scaffoldGenerationMs: 1, launcherInstallationMs: 1, generatedAppInstallationMs: 1, browserRuntimeInstallationMs: 1, dependencyInstallationMs: 3, compileMs: 1, serverReadinessMs: 1, firstMeaningfulPaintMs: 1, neutralJourneyMs: 1, totalMs: 10 },
    nodekitCommit: commit,
    nodekitPackage: "@homenshum/nodekit",
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: "6".repeat(64),
    nodekitVersion: "0.2.1",
    nodeVersion: "v22.0.0",
    operatingSystem: `${{ windows: "win32-10.0.0-x64", ubuntu: "linux-6.0.0-x64", macos: "darwin-25.0.0-arm64" }[lane.split("/")[0]]}`,
    packageManager,
    packageManagerVersion: packageManager === "npm" ? "10.9.0" : "10.13.1",
    receiptProduced: true,
    reloadPreserved: true,
    runId: `${lane}/${cacheClass}/${index}`,
    schemaVersion: "nodekit.developer-timing-run/v1",
    sourceEdits: 0,
    timerBoundary: "empty-launcher-before-package-json-to-completed-proof",
  };
  return { ...receipt, receiptSha256: digest(JSON.stringify(receipt)) };
}

function completeTimingMatrix(overrides = {}) {
  return lanes.flatMap((lane) => ["cold", "warm"].flatMap((cacheClass) => Array.from({ length: 5 }, (_, index) => signedTimingRun({ lane, cacheClass, index, ...overrides }))));
}

const humanThresholds = {
  minimumUnassistedCompletions: 4,
  minimumOutcomeComprehensions: 4,
  minimumFinalArtifactsLocated: 4,
  minimumUnresolvedIssuesLocated: 4,
  maximumMedianFirstMeaningfulActionMs: 30000,
  maximumMedianNeutralJourneyMs: 180000,
  minimumMedianSingleEaseQuestion: 6,
  maximumP0P1Failures: 0,
};

function humanParticipants() {
  return Array.from({ length: 5 }, (_, index) => ({
    participantId: `participant-${index + 1}`,
    fresh: true,
    consentRecorded: true,
    sessionStartedAt: "2026-07-22T00:00:00Z",
    sessionCompletedAt: "2026-07-22T00:02:00Z",
    evidenceRefs: [
      { kind: "screenshot", path: `proof/ease/humans/participant-${index + 1}/completion.png`, sha256: digest(`screenshot-${index}`) },
      { kind: "session-log", path: `proof/ease/humans/participant-${index + 1}/session.json`, sha256: digest(`session-${index}`) },
    ],
    firstMeaningfulActionMs: 1000,
    neutralJourneyMs: 90000,
    wrongTurns: 0,
    helpRequests: 0,
    singleEaseQuestion: 7,
    p0P1Failures: 0,
    completed: true,
    assisted: false,
    canExplainOutcome: true,
    locatedFinalArtifact: true,
    locatedUnresolvedIssues: true,
  }));
}

test("fresh-user evidence fails closed without five real participants", () => {
  const verdict = evaluateFreshUserStudy({
    schemaVersion: "nodekit.fresh-user-study/v1",
    instruction: "Use this app to complete the job shown on screen.",
    participants: [],
    thresholds: humanThresholds,
  });
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /five fresh participants/);
  assert.equal(verdict.evidenceFilesVerified, false);
});

test("developer timing matrix fails closed until all sixty isolated trials exist", () => {
  const verdict = evaluateDeveloperTimingMatrix([]);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.requiredRuns, 60);
  assert.match(verdict.errors.join("\n"), /exactly 60 runs/);
  assert.match(verdict.errors.join("\n"), /share one immutable NodeKit identity/);
  assert.equal(verdict.cells["windows/npm"].cold.totalMs.p95, null);
  assert.equal(verdict.cells["windows/npm"].cold.totalMs.p95Eligible, false);
});

test("developer timing verdict binds exactly sixty unique recomputed receipts", () => {
  const runs = completeTimingMatrix();
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, true, verdict.errors.join("\n"));
  assert.equal(verdict.selectedRuns.length, 60);
  assert.equal(new Set(verdict.selectedRuns.map((entry) => entry.runId)).size, 60);
  assert.equal(new Set(verdict.selectedRuns.map((entry) => entry.receiptSha256)).size, 60);
  assert.equal(verdict.selectedRuns.filter((entry) => entry.lane === "windows/npm" && entry.cacheClass === "cold").length, 5);

  runs[0].measurements.totalMs = 8;
  const tampered = evaluateDeveloperTimingMatrix(runs);
  assert.equal(tampered.passed, false);
  assert.match(tampered.errors.join("\n"), /receipt SHA-256 does not match/);
});

test("developer timing evidence cannot mix otherwise valid revisions", () => {
  const runs = completeTimingMatrix();
  const mixed = signedTimingRun({ lane: "windows/npm", cacheClass: "cold", index: 0, commit: "b".repeat(40) });
  runs[0] = mixed;
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /found 2/);
});

test("developer timing evidence fails closed on a slow individual run even when medians remain fast", () => {
  const runs = completeTimingMatrix();
  runs[0].measurements.totalMs = 600_001;
  const { receiptSha256: _oldHash, ...body } = runs[0];
  runs[0].receiptSha256 = digest(JSON.stringify(body));
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /per-run maximum of 600000ms/);
});

test("developer timing evidence fails closed on a slow cell median", () => {
  const runs = completeTimingMatrix();
  for (const run of runs.filter((entry) => entry.lane === "windows/npm" && entry.cacheClass === "warm")) {
    run.measurements.dependencyInstallationMs = 30_001;
    run.measurements.launcherInstallationMs = 10_001;
    run.measurements.generatedAppInstallationMs = 10_000;
    run.measurements.browserRuntimeInstallationMs = 10_000;
    const { receiptSha256: _oldHash, ...body } = run;
    run.receiptSha256 = digest(JSON.stringify(body));
  }
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /median dependencyInstallationMs 30001ms exceeds the preregistered 30000ms limit/);
});

test("developer timing evidence requires hosted provenance and one exact tarball", () => {
  const runs = completeTimingMatrix();
  runs[0].ciProvenance = null;
  runs[1].nodekitTarballSha256 = "5".repeat(64);
  for (const run of runs.slice(0, 2)) {
    const { receiptSha256: _oldHash, ...body } = run;
    run.receiptSha256 = digest(JSON.stringify(body));
  }
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /missing CI provenance/);
  assert.match(verdict.errors.join("\n"), /share one exact NodeKit tarball identity; found 2/);
});

test("fresh-user evidence requires exact revision, consent, timestamps, screenshot and session log", () => {
  const participants = humanParticipants();
  participants[0].consentRecorded = false;
  participants[0].evidenceRefs = [];
  const verdict = evaluateFreshUserStudy({
    schemaVersion: "nodekit.fresh-user-study/v1",
    nodekitCommit: "a".repeat(40),
    nodekitSourceHash: "b".repeat(64),
    instruction: "Use this app to complete the job shown on screen.",
    participants,
    thresholds: humanThresholds,
  }, { evidenceFilesVerified: true, evidenceFileErrors: [] });
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /consent is not recorded/);
  assert.match(verdict.errors.join("\n"), /hash-bound screenshot evidence is required/);
  assert.match(verdict.errors.join("\n"), /hash-bound session-log evidence is required/);
});

test("fresh-user verdict emits participant-level evidence and recomputable metrics", () => {
  const verdict = evaluateFreshUserStudy({
    schemaVersion: "nodekit.fresh-user-study/v1",
    nodekitCommit: "a".repeat(40),
    nodekitSourceHash: "b".repeat(64),
    instruction: "Use this app to complete the job shown on screen.",
    participants: humanParticipants(),
    thresholds: humanThresholds,
  }, { evidenceFilesVerified: true, evidenceFileErrors: [] });
  assert.equal(verdict.passed, true, verdict.errors.join("\n"));
  assert.equal(verdict.selectedParticipants.length, 5);
  assert.equal(verdict.selectedParticipants.flatMap((entry) => entry.evidenceRefs).length, 10);
  assert.equal(verdict.metrics.outcomeExplanations, 5);
  assert.equal(verdict.checks.evidenceFilesVerified, true);
});

test("human CLI evaluator reads and hashes the exact screenshot and session log files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-human-evidence-"));
  const participants = humanParticipants();
  for (let index = 0; index < participants.length; index += 1) {
    const screenshot = Buffer.from(`screenshot-${index}`);
    const session = Buffer.from(`session-${index}`);
    const directory = path.join(root, `proof/ease/humans/participant-${index + 1}`);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "completion.png"), screenshot);
    await writeFile(path.join(directory, "session.json"), session);
  }
  const studyPath = path.join(root, "study.json");
  const verdictPath = path.join(root, "verdict.json");
  await writeFile(studyPath, JSON.stringify({
    schemaVersion: "nodekit.fresh-user-study/v1",
    nodekitCommit: "a".repeat(40),
    nodekitSourceHash: "b".repeat(64),
    instruction: "Use this app to complete the job shown on screen.",
    participants,
    thresholds: humanThresholds,
  }));
  const evaluator = path.resolve("scripts/evaluate-ease-evidence.mjs");
  execFileSync(process.execPath, [evaluator, "humans", studyPath, verdictPath], { cwd: root, stdio: "ignore" });
  const verdict = JSON.parse(await readFile(verdictPath, "utf8"));
  assert.equal(verdict.passed, true);
  assert.equal(verdict.evidenceFilesVerified, true);

  await writeFile(path.join(root, "proof/ease/humans/participant-1/completion.png"), "tampered");
  const tampered = spawnSync(process.execPath, [evaluator, "humans", studyPath, verdictPath], { cwd: root, encoding: "utf8" });
  assert.equal(tampered.status, 1);
  assert.match(tampered.stdout, /evidence hash mismatch/);
});
