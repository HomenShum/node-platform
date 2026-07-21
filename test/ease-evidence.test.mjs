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
  assert.equal(verdict.errors.length, 12);
});
