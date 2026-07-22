import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeveloperTimingMatrix, evaluateFreshUserStudy } from "../src/lib/ease-evidence.mjs";

test("fresh-user evidence fails closed without five real participants", () => {
  const verdict = evaluateFreshUserStudy({
    instruction: "Use this app to complete the job shown on screen.",
    participants: [],
    thresholds: { minimumUnassistedCompletions: 4, maximumMedianFirstMeaningfulActionMs: 30000, maximumMedianNeutralJourneyMs: 180000, minimumMedianSingleEaseQuestion: 6, maximumP0P1Failures: 0 },
  });
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /five fresh participants/);
});

test("developer timing matrix fails closed until all sixty isolated trials exist", () => {
  const verdict = evaluateDeveloperTimingMatrix([]);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.requiredRuns, 60);
  assert.match(verdict.errors.join("\n"), /share one immutable NodeKit identity/);
  assert.equal(verdict.cells["windows/npm"].cold.totalMs.p95, null);
  assert.equal(verdict.cells["windows/npm"].cold.totalMs.p95Eligible, false);
});

test("developer timing evidence cannot mix otherwise valid revisions", () => {
  const lanes = ["windows/npm", "windows/pnpm", "ubuntu/npm", "ubuntu/pnpm", "macos/npm", "macos/pnpm"];
  const runs = lanes.flatMap((lane) => ["cold", "warm"].flatMap((cacheClass) => Array.from({ length: 5 }, (_, index) => ({
    apiKeysRequired: 0,
    cacheClass,
    cacheIsolated: true,
    consoleErrors: 0,
    failedCommands: 0,
    horizontalOverflowPx: 0,
    lane,
    manualDecisions: 0,
    measurements: { scaffoldGenerationMs: 1, dependencyInstallationMs: 1, compileMs: 1, serverReadinessMs: 1, firstMeaningfulPaintMs: 1, neutralJourneyMs: 1, totalMs: 7 },
    nodekitCommit: index === 0 && lane === "windows/npm" && cacheClass === "cold" ? "b".repeat(40) : "a".repeat(40),
    nodekitSourceHash: "c".repeat(64),
    receiptProduced: true,
    reloadPreserved: true,
    runId: `${lane}/${cacheClass}/${index}`,
    sourceEdits: 0,
  }))));
  const verdict = evaluateDeveloperTimingMatrix(runs);
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /found 2/);
});

test("fresh-user evidence requires exact revision, consent, timestamps, and session artifacts", () => {
  const participants = Array.from({ length: 5 }, (_, index) => ({
    participantId: `participant-${index + 1}`,
    fresh: true,
    consentRecorded: index !== 0,
    sessionStartedAt: "2026-07-22T00:00:00Z",
    sessionCompletedAt: "2026-07-22T00:02:00Z",
    evidenceRefs: index === 0 ? [] : [`proof/humans/${index + 1}.png`],
    firstMeaningfulActionMs: 1000,
    neutralJourneyMs: 120000,
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
  const verdict = evaluateFreshUserStudy({
    nodekitCommit: "a".repeat(40),
    nodekitSourceHash: "b".repeat(64),
    instruction: "Use this app to complete the job shown on screen.",
    participants,
    thresholds: { minimumUnassistedCompletions: 4, maximumMedianFirstMeaningfulActionMs: 30000, maximumMedianNeutralJourneyMs: 180000, minimumMedianSingleEaseQuestion: 6, maximumP0P1Failures: 0 },
  });
  assert.equal(verdict.passed, false);
  assert.match(verdict.errors.join("\n"), /consent is not recorded/);
  assert.match(verdict.errors.join("\n"), /screenshot or recording evidence is required/);
});
