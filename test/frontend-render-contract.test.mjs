import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFrontendRenderContract, stateManifestHashOf, REQUIRED_RENDER_STATE_IDS } from "../src/lib/frontend-render-contract.mjs";

const sha256 = (seed) => seed.padEnd(64, "0").slice(0, 64);
const sha1 = (seed) => seed.padEnd(40, "0").slice(0, 40);
const EXPECTED = {
  candidateId: "direction-a",
  repositoryCommit: sha1("commit"),
  directionSetHash: sha256("directionset"),
};

function renderedStates() {
  return REQUIRED_RENDER_STATE_IDS.map((stateId, i) => ({
    stateId,
    route: `/${stateId}`,
    viewport: { width: stateId.startsWith("mobile") ? 375 : 1440, height: 812 },
    screenshotSha256: sha256(`shot${i}`),
    checkReportSha256: sha256(`report${i}`),
  }));
}

function passingChecks() {
  return {
    browser: { status: "pass", pageErrors: 0, failedRequiredRequests: 0, missingRequiredStates: [] },
    accessibility: { status: "pass", seriousOrCriticalCount: 0, incompleteCount: 0 },
    overflow: { status: "pass", maxHorizontalOverflowPx: 0 },
    stateCommunication: { status: "pass", silentStates: [] },
  };
}

function renderReceipt(overrides = {}) {
  const states = overrides.renderedStates ?? renderedStates();
  const candidate = {
    candidateId: "direction-a",
    repositoryCommit: EXPECTED.repositoryCommit,
    productContractHash: sha256("contract"),
    directionSetHash: EXPECTED.directionSetHash,
    stateManifestHash: stateManifestHashOf(states),
    ...(overrides.candidate ?? {}),
  };
  return {
    schemaVersion: "nodekit.frontend-render-receipt/v1",
    candidate,
    verifier: {
      verifierId: "independent-verifier", verifierCommit: sha1("verifier"),
      command: "npm run frontend:render-check", browserName: "chromium", browserVersion: "1.61.1",
      startedAt: "2026-07-23T00:00:00.000Z", completedAt: "2026-07-23T00:02:00.000Z",
    },
    coverage: { requiredStateIds: [...REQUIRED_RENDER_STATE_IDS], renderedStates: states },
    checks: overrides.checks ?? passingChecks(),
  };
}

function reviewReceipt(overrides = {}) {
  const render = overrides.render ?? renderReceipt();
  return {
    schemaVersion: "nodekit.frontend-review-receipt/v1",
    candidateId: "direction-a",
    reviewerId: "independent-critic",
    generatingModelId: "generating-model",
    reviewedStateManifestHash: render.candidate.stateManifestHash,
    verdict: "pass",
    unresolvedMajorFindings: [],
    reviewedAt: "2026-07-23T00:05:00.000Z",
    ...overrides.fields,
  };
}

const run = (renderR, reviewR) => evaluateFrontendRenderContract({ renderReceipt: renderR, reviewReceipt: reviewR, expected: EXPECTED });

// The corruption corpus the design consult called more valuable than another hundred
// happy-path tests: each self-attested shortcut must land on the right graded verdict.

test("the happy path with full independent evidence is DECISIVE", () => {
  const render = renderReceipt();
  assert.deepEqual(run(render, reviewReceipt({ render })), { status: "DECISIVE", decisive: true, reasons: run(render, reviewReceipt({ render })).reasons });
  assert.equal(run(render, reviewReceipt({ render })).decisive, true);
});

test("three self-asserted booleans with no render receipt are UNVERIFIED", () => {
  const v = evaluateFrontendRenderContract({ renderReceipt: null, reviewReceipt: reviewReceipt(), expected: EXPECTED });
  assert.equal(v.status, "UNVERIFIED");
  assert.equal(v.decisive, false);
});

test("a render receipt from a different commit FAILs", () => {
  const render = renderReceipt({ candidate: { repositoryCommit: sha1("othercommit") } });
  const v = run(render, reviewReceipt({ render }));
  assert.equal(v.status, "FAIL");
});

test("a differing direction-set hash FAILs", () => {
  const render = renderReceipt({ candidate: { directionSetHash: sha256("otherset") } });
  assert.equal(run(render, reviewReceipt({ render })).status, "FAIL");
});

test("one of the six required states absent is INCOMPLETE", () => {
  const states = renderedStates().slice(0, 5);
  const render = renderReceipt({ renderedStates: states });
  assert.equal(run(render, reviewReceipt({ render })).status, "INCOMPLETE");
});

test("a modified screenshot manifest FAILs on the manifest hash", () => {
  const render = renderReceipt();
  render.coverage.renderedStates[0].screenshotSha256 = sha256("tampered"); // change bytes after the hash was bound
  assert.equal(run(render, reviewReceipt({ render })).status, "FAIL");
});

test("an accessibility summary of pass while the raw report has a serious issue FAILs", () => {
  const checks = passingChecks();
  checks.accessibility = { status: "pass", seriousOrCriticalCount: 1, incompleteCount: 0 };
  const render = renderReceipt({ checks });
  assert.equal(run(render, reviewReceipt({ render })).status, "FAIL");
});

test("no independent review receipt is UNVERIFIED", () => {
  const render = renderReceipt();
  const v = evaluateFrontendRenderContract({ renderReceipt: render, reviewReceipt: null, expected: EXPECTED });
  assert.equal(v.status, "UNVERIFIED");
});

test("the generating model reviewing its own output FAILs", () => {
  const render = renderReceipt();
  const review = reviewReceipt({ render, fields: { reviewerId: "generating-model", generatingModelId: "generating-model" } });
  assert.equal(run(render, review).status, "FAIL");
});

test("a review that references a different state manifest FAILs", () => {
  const render = renderReceipt();
  const review = reviewReceipt({ render, fields: { reviewedStateManifestHash: sha256("otherartifact") } });
  assert.equal(run(render, review).status, "FAIL");
});

test("all deterministic checks pass but an unresolved major finding is NOT_DECISIVE", () => {
  const render = renderReceipt();
  const review = reviewReceipt({ render, fields: { unresolvedMajorFindings: ["primary action below the fold on mobile"] } });
  const v = run(render, review);
  assert.equal(v.status, "NOT_DECISIVE");
  assert.equal(v.decisive, false);
});
