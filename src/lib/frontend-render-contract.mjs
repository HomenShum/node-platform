import { createHash } from "node:crypto";

// The Frontend Render Contract. It computes the tournament's decisive verdict from
// evidence a verifier generated, not from booleans the candidate asserted. A candidate
// can no longer print TOURNAMENT DECISIVE by writing three trues into a JSON file.
//
// The verdict is graded so the failure mode is legible:
//   DECISIVE      every binding holds, every verifier check passes, an independent
//                 review passed, and no unresolved major finding remains.
//   NOT_DECISIVE  everything verified and every deterministic check passed, but a
//                 human-or-independent reviewer left an unresolved major finding.
//   FAIL          a binding is wrong, a check failed, a summary contradicts its raw
//                 counts, the manifest was tampered with, or the reviewer reviewed
//                 its own output.
//   INCOMPLETE    coverage is short of the six-state minimum, or a check could not
//                 complete.
//   UNVERIFIED    the receipts that would let anyone judge are absent.
// Only DECISIVE authorizes anything downstream.

export const REQUIRED_RENDER_STATE_IDS = Object.freeze([
  "desktop_first_arrival",
  "desktop_active_workspace",
  "desktop_proposal_review",
  "mobile_primary_artifact",
  "mobile_agent",
  "mobile_review",
]);

// The direction-set hash binds a render receipt to the exact frozen directions it was
// taken against. It is derived from the direction set's stable identity so a verifier
// authoring a receipt and the evaluator checking it compute the same value.
export function directionSetHashOf(directionSet) {
  return createHash("sha256")
    .update(JSON.stringify({
      directionSetId: directionSet.directionSetId,
      productContractHash: directionSet.productContractHash,
      routeHash: directionSet.routeHash,
    }))
    .digest("hex");
}

// The state manifest hash binds the exact rendered evidence. Recomputing it from the
// per-state screenshot and check-report hashes makes candidate.stateManifestHash
// tamper-evident: editing the manifest changes the hash and the receipt no longer
// matches its own coverage.
export function stateManifestHashOf(renderedStates) {
  const canonical = [...renderedStates]
    .map((entry) => ({
      stateId: entry.stateId,
      route: entry.route,
      viewport: { width: entry.viewport.width, height: entry.viewport.height },
      screenshotSha256: entry.screenshotSha256,
      checkReportSha256: entry.checkReportSha256,
    }))
    .sort((left, right) => (left.stateId < right.stateId ? -1 : left.stateId > right.stateId ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function checkIsPassButRawShowsIssue(checks) {
  const { browser, accessibility, overflow, stateCommunication } = checks;
  if (browser.status === "pass" && (browser.pageErrors > 0 || browser.failedRequiredRequests > 0 || browser.missingRequiredStates.length > 0)) {
    return "browser summary says pass but its raw report is non-zero";
  }
  if (accessibility.status === "pass" && accessibility.seriousOrCriticalCount > 0) {
    return "accessibility summary says pass but the raw report contains serious or critical issues";
  }
  if (overflow.status === "pass" && overflow.maxHorizontalOverflowPx > 0) {
    return "overflow summary says pass but the raw report shows horizontal overflow";
  }
  if (stateCommunication.status === "pass" && stateCommunication.silentStates.length > 0) {
    return "state-communication summary says pass but some states are silent";
  }
  return null;
}

// Assemble a render receipt from raw browser observations, DERIVING each check's status
// from its own counts rather than accepting an asserted status. This is what "the verifier
// runs the checks itself" means: a state where the raw report shows a serious accessibility
// issue cannot be assembled into a passing receipt, because the status is computed here, not
// supplied. The screenshot and check-report hashes are computed over the observed bytes, so
// the manifest is bound to what was actually seen.
export function assembleFrontendRenderReceipt({ candidate, verifier, states }) {
  if (!Array.isArray(states) || states.length < REQUIRED_RENDER_STATE_IDS.length) {
    throw new Error("a render receipt must be assembled from at least the six required states");
  }
  const renderedStates = states.map((state) => {
    const checkReport = {
      pageErrors: state.pageErrors ?? 0,
      failedRequiredRequests: state.failedRequiredRequests ?? 0,
      accessibilitySerious: state.accessibilitySerious ?? 0,
      accessibilityIncomplete: state.accessibilityIncomplete ?? 0,
      overflowPx: state.overflowPx ?? 0,
      silent: Boolean(state.silent),
    };
    return {
      stateId: state.stateId,
      route: state.route,
      viewport: { width: state.viewport.width, height: state.viewport.height },
      screenshotSha256: createHash("sha256").update(state.screenshotBytes ?? Buffer.alloc(0)).digest("hex"),
      checkReportSha256: createHash("sha256").update(JSON.stringify(checkReport)).digest("hex"),
      _report: checkReport,
    };
  });

  const totals = renderedStates.reduce((acc, entry) => {
    acc.pageErrors += entry._report.pageErrors;
    acc.failedRequiredRequests += entry._report.failedRequiredRequests;
    acc.accessibilitySerious += entry._report.accessibilitySerious;
    acc.accessibilityIncomplete += entry._report.accessibilityIncomplete;
    acc.overflowPx = Math.max(acc.overflowPx, entry._report.overflowPx);
    if (entry._report.silent) acc.silentStates.push(entry.stateId);
    return acc;
  }, { pageErrors: 0, failedRequiredRequests: 0, accessibilitySerious: 0, accessibilityIncomplete: 0, overflowPx: 0, silentStates: [] });

  const rendered = new Set(renderedStates.map((entry) => entry.stateId));
  const missingRequiredStates = REQUIRED_RENDER_STATE_IDS.filter((id) => !rendered.has(id));
  const checks = {
    browser: {
      status: totals.pageErrors === 0 && totals.failedRequiredRequests === 0 && missingRequiredStates.length === 0 ? "pass" : "fail",
      pageErrors: totals.pageErrors, failedRequiredRequests: totals.failedRequiredRequests, missingRequiredStates,
    },
    accessibility: {
      status: totals.accessibilitySerious > 0 ? "fail" : totals.accessibilityIncomplete > 0 ? "incomplete" : "pass",
      seriousOrCriticalCount: totals.accessibilitySerious, incompleteCount: totals.accessibilityIncomplete,
    },
    overflow: { status: totals.overflowPx > 0 ? "fail" : "pass", maxHorizontalOverflowPx: totals.overflowPx },
    stateCommunication: { status: totals.silentStates.length > 0 ? "fail" : "pass", silentStates: totals.silentStates },
  };

  const coverageStates = renderedStates.map(({ _report, ...entry }) => entry);
  return {
    schemaVersion: "nodekit.frontend-render-receipt/v1",
    candidate: { ...candidate, stateManifestHash: stateManifestHashOf(coverageStates) },
    verifier,
    coverage: { requiredStateIds: [...REQUIRED_RENDER_STATE_IDS], renderedStates: coverageStates },
    checks,
  };
}

/**
 * @param {object} input
 * @param {object|null} input.renderReceipt  a validated nodekit.frontend-render-receipt/v1, or null
 * @param {object|null} input.reviewReceipt  a validated nodekit.frontend-review-receipt/v1, or null
 * @param {object} input.expected  { candidateId, repositoryCommit, directionSetHash }
 * @returns {{ status: string, decisive: boolean, reasons: string[] }}
 */
export function evaluateFrontendRenderContract({ renderReceipt, reviewReceipt, expected }) {
  const verdict = (status, reason) => ({ status, decisive: status === "DECISIVE", reasons: [reason] });

  if (!renderReceipt) {
    return verdict("UNVERIFIED", "no render receipt; self-asserted browser/accessibility/overflow booleans are not evidence");
  }

  const c = renderReceipt.candidate;
  if (c.candidateId !== expected.candidateId) return verdict("FAIL", `render receipt is for ${c.candidateId}, expected ${expected.candidateId}`);
  if (c.repositoryCommit !== expected.repositoryCommit) return verdict("FAIL", "render receipt belongs to a different repository commit");
  if (c.directionSetHash !== expected.directionSetHash) return verdict("FAIL", "render receipt direction-set hash differs from the frozen direction set");

  const required = new Set(REQUIRED_RENDER_STATE_IDS);
  const declared = new Set(renderReceipt.coverage.requiredStateIds);
  if (declared.size !== required.size || [...required].some((id) => !declared.has(id))) {
    return verdict("INCOMPLETE", "required state set does not equal the six-state minimum");
  }
  const rendered = new Set(renderReceipt.coverage.renderedStates.map((entry) => entry.stateId));
  const missing = [...required].filter((id) => !rendered.has(id));
  if (missing.length > 0) return verdict("INCOMPLETE", `render receipt is missing required states: ${missing.join(", ")}`);

  if (stateManifestHashOf(renderReceipt.coverage.renderedStates) !== c.stateManifestHash) {
    return verdict("FAIL", "state manifest hash does not match the rendered evidence; the manifest was modified");
  }

  const inconsistent = checkIsPassButRawShowsIssue(renderReceipt.checks);
  if (inconsistent) return verdict("FAIL", inconsistent);

  const statuses = Object.values(renderReceipt.checks).map((check) => check.status);
  if (statuses.includes("fail")) return verdict("FAIL", "a verifier check failed");
  if (statuses.includes("incomplete")) return verdict("INCOMPLETE", "a verifier check could not complete");

  if (!reviewReceipt) return verdict("UNVERIFIED", "no independent review receipt");
  if (reviewReceipt.candidateId !== expected.candidateId) return verdict("FAIL", "review receipt is for a different candidate");
  if (reviewReceipt.reviewedStateManifestHash !== c.stateManifestHash) return verdict("FAIL", "review receipt references a different state manifest than the render receipt");
  if (reviewReceipt.reviewerId === reviewReceipt.generatingModelId) return verdict("FAIL", "the generating model reviewed its own output; review is not independent");
  if (reviewReceipt.verdict === "fail") return verdict("FAIL", "independent review verdict is fail");
  if (reviewReceipt.verdict === "incomplete") return verdict("INCOMPLETE", "independent review verdict is incomplete");
  if (reviewReceipt.unresolvedMajorFindings.length > 0) {
    return verdict("NOT_DECISIVE", `deterministic checks pass but ${reviewReceipt.unresolvedMajorFindings.length} unresolved major finding(s) remain`);
  }

  return verdict("DECISIVE", "verifier evidence, coverage, manifest integrity, and independent review all hold");
}
