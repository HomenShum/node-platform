const timingFields = [
  "scaffoldGenerationMs",
  "dependencyInstallationMs",
  "compileMs",
  "serverReadinessMs",
  "firstMeaningfulPaintMs",
  "neutralJourneyMs",
  "totalMs",
];

const requiredLanes = [
  "windows/npm", "windows/pnpm",
  "ubuntu/npm", "ubuntu/pnpm",
  "macos/npm", "macos/pnpm",
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function evaluateFreshUserStudy(study) {
  const errors = [];
  const participants = Array.isArray(study?.participants) ? study.participants : [];
  if (!/^[a-f0-9]{40}$/.test(study?.nodekitCommit ?? "")) errors.push("study requires an immutable NodeKit commit");
  if (!/^[a-f0-9]{64}$/.test(study?.nodekitSourceHash ?? "")) errors.push("study requires a NodeKit source hash");
  if (study?.instruction !== "Use this app to complete the job shown on screen.") errors.push("study instruction changed");
  if (participants.length < 5) errors.push("at least five fresh participants are required");
  if (new Set(participants.map((entry) => entry.participantId)).size !== participants.length) errors.push("participant IDs must be unique");
  const numericFields = ["firstMeaningfulActionMs", "neutralJourneyMs", "wrongTurns", "helpRequests", "singleEaseQuestion", "p0P1Failures"];
  for (const participant of participants) {
    if (participant.fresh !== true) errors.push(`${participant.participantId ?? "unknown"}: participant is not marked fresh`);
    if (participant.consentRecorded !== true) errors.push(`${participant.participantId ?? "unknown"}: consent is not recorded`);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(participant.sessionStartedAt ?? "")) errors.push(`${participant.participantId ?? "unknown"}: invalid sessionStartedAt`);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(participant.sessionCompletedAt ?? "")) errors.push(`${participant.participantId ?? "unknown"}: invalid sessionCompletedAt`);
    if (!Array.isArray(participant.evidenceRefs) || participant.evidenceRefs.length === 0) errors.push(`${participant.participantId ?? "unknown"}: screenshot or recording evidence is required`);
    for (const field of numericFields) if (!Number.isFinite(participant[field]) || participant[field] < 0) errors.push(`${participant.participantId ?? "unknown"}: invalid ${field}`);
    for (const field of ["completed", "assisted", "canExplainOutcome", "locatedFinalArtifact", "locatedUnresolvedIssues"]) {
      if (typeof participant[field] !== "boolean") errors.push(`${participant.participantId ?? "unknown"}: missing ${field}`);
    }
  }
  const thresholds = study?.thresholds ?? {};
  const unassistedCompletions = participants.filter((entry) => entry.completed === true && entry.assisted === false).length;
  const medianFirstMeaningfulActionMs = median(participants.map((entry) => entry.firstMeaningfulActionMs).filter(Number.isFinite));
  const medianNeutralJourneyMs = median(participants.map((entry) => entry.neutralJourneyMs).filter(Number.isFinite));
  const medianSingleEaseQuestion = median(participants.map((entry) => entry.singleEaseQuestion).filter(Number.isFinite));
  const p0P1Failures = participants.reduce((sum, entry) => sum + (Number.isFinite(entry.p0P1Failures) ? entry.p0P1Failures : 0), 0);
  const checks = {
    participantCount: participants.length >= 5,
    unassistedCompletion: unassistedCompletions >= thresholds.minimumUnassistedCompletions,
    firstMeaningfulAction: medianFirstMeaningfulActionMs !== null && medianFirstMeaningfulActionMs <= thresholds.maximumMedianFirstMeaningfulActionMs,
    neutralJourney: medianNeutralJourneyMs !== null && medianNeutralJourneyMs <= thresholds.maximumMedianNeutralJourneyMs,
    singleEaseQuestion: medianSingleEaseQuestion !== null && medianSingleEaseQuestion >= thresholds.minimumMedianSingleEaseQuestion,
    noP0P1Failures: p0P1Failures <= thresholds.maximumP0P1Failures,
  };
  return {
    schemaVersion: "nodekit.fresh-user-verdict/v1",
    nodekitCommit: study?.nodekitCommit ?? null,
    nodekitSourceHash: study?.nodekitSourceHash ?? null,
    nodekitIdentity: study?.nodekitCommit && study?.nodekitSourceHash ? `${study.nodekitCommit}/${study.nodekitSourceHash}` : null,
    passed: errors.length === 0 && Object.values(checks).every(Boolean),
    errors,
    checks,
    metrics: { participantCount: participants.length, unassistedCompletions, medianFirstMeaningfulActionMs, medianNeutralJourneyMs, medianSingleEaseQuestion, p0P1Failures },
  };
}

export function evaluateDeveloperTimingMatrix(receipts) {
  const errors = [];
  const cells = {};
  const identities = new Set();
  for (const run of receipts) {
    if (!/^[a-f0-9]{40}$/.test(run.nodekitCommit ?? "")) errors.push(`${run.runId ?? "unknown"}: missing immutable NodeKit commit`);
    if (!/^[a-f0-9]{64}$/.test(run.nodekitSourceHash ?? "")) errors.push(`${run.runId ?? "unknown"}: missing NodeKit source hash`);
    if (/^[a-f0-9]{40}$/.test(run.nodekitCommit ?? "") && /^[a-f0-9]{64}$/.test(run.nodekitSourceHash ?? "")) identities.add(`${run.nodekitCommit}/${run.nodekitSourceHash}`);
  }
  if (identities.size !== 1) errors.push(`developer timing receipts must share one immutable NodeKit identity; found ${identities.size}`);
  for (const lane of requiredLanes) {
    cells[lane] = {};
    for (const cacheClass of ["cold", "warm"]) {
      const runs = receipts.filter((entry) => entry.lane === lane && entry.cacheClass === cacheClass);
      if (runs.length < 5) errors.push(`${lane}/${cacheClass}: requires five runs, found ${runs.length}`);
      if (cacheClass === "cold" && runs.some((entry) => entry.cacheIsolated !== true)) errors.push(`${lane}/cold: every cache must be isolated`);
      for (const run of runs) {
        for (const field of timingFields) if (!Number.isFinite(run.measurements?.[field]) || run.measurements[field] < 0) errors.push(`${run.runId ?? "unknown"}: invalid ${field}`);
        if (run.failedCommands !== 0 || run.manualDecisions !== 0 || run.apiKeysRequired !== 0 || run.sourceEdits !== 0 || run.consoleErrors !== 0 || run.horizontalOverflowPx !== 0 || run.receiptProduced !== true || run.reloadPreserved !== true) {
          errors.push(`${run.runId ?? "unknown"}: zero-intervention journey invariants failed`);
        }
      }
      cells[lane][cacheClass] = Object.fromEntries(timingFields.map((field) => {
        const values = runs.map((entry) => entry.measurements?.[field]).filter(Number.isFinite);
        return [field, {
          samples: values.length,
          median: median(values),
          minimum: values.length ? Math.min(...values) : null,
          maximum: values.length ? Math.max(...values) : null,
          q1: values.length >= 4 ? percentile(values, 0.25) : null,
          q3: values.length >= 4 ? percentile(values, 0.75) : null,
          p95: values.length >= 20 ? percentile(values, 0.95) : null,
          p95Eligible: values.length >= 20,
        }];
      }));
    }
  }
  const nodekitIdentity = identities.size === 1 ? [...identities][0] : null;
  const [nodekitCommit = null, nodekitSourceHash = null] = nodekitIdentity?.split("/") ?? [];
  return { schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit, nodekitSourceHash, nodekitIdentity, passed: errors.length === 0, errors, requiredRuns: 60, observedRuns: receipts.length, cells };
}
