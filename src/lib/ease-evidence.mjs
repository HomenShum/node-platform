import { createHash } from "node:crypto";

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
const laneOperatingSystemPrefixes = Object.freeze({ windows: "win32-", ubuntu: "linux-", macos: "darwin-" });
export const developerTimingThresholds = Object.freeze({
  perCellMedianMs: Object.freeze({
    compileMs: 20_000,
    dependencyInstallationMs: Object.freeze({ cold: 60_000, warm: 30_000 }),
    firstMeaningfulPaintMs: 10_000,
    neutralJourneyMs: 15_000,
    scaffoldGenerationMs: 10_000,
    serverReadinessMs: 15_000,
    totalMs: 240_000,
  }),
  perRunMaximumMs: Object.freeze({
    compileMs: 30_000,
    dependencyInstallationMs: 180_000,
    firstMeaningfulPaintMs: 30_000,
    neutralJourneyMs: 60_000,
    scaffoldGenerationMs: 30_000,
    serverReadinessMs: 30_000,
    totalMs: 600_000,
  }),
  schemaVersion: "nodekit.developer-timing-thresholds/v1",
});

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const allowedHumanEvidenceKinds = new Set(["screenshot", "session-log", "recording"]);
const requiredFreshUserThresholds = Object.freeze({
  minimumUnassistedCompletions: 4,
  minimumOutcomeComprehensions: 4,
  minimumFinalArtifactsLocated: 4,
  minimumUnresolvedIssuesLocated: 4,
  maximumMedianFirstMeaningfulActionMs: 30_000,
  maximumMedianNeutralJourneyMs: 180_000,
  minimumMedianSingleEaseQuestion: 6,
  maximumP0P1Failures: 0,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPortableEvidencePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split("/").includes("..");
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

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

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateTimingProvenance(run, errors) {
  const runId = run?.runId ?? "unknown";
  const provenance = run?.ciProvenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push(`${runId}: missing CI provenance`);
    return;
  }
  if (provenance.provider !== "github-actions") errors.push(`${runId}: timing evidence must come from GitHub Actions hosted runners`);
  if (!/^\d+$/.test(String(provenance.githubRunId ?? ""))) errors.push(`${runId}: invalid GitHub run ID`);
  if (!Number.isInteger(provenance.githubRunAttempt) || provenance.githubRunAttempt < 1) errors.push(`${runId}: invalid GitHub run attempt`);
  if (typeof provenance.githubWorkflowRef !== "string" || !/\.github\/workflows\/ease-proof\.yml@/.test(provenance.githubWorkflowRef)) errors.push(`${runId}: invalid GitHub workflow ref`);
  if (provenance.githubSha !== run.nodekitCommit) errors.push(`${runId}: GitHub SHA does not match the NodeKit commit`);
  if (!SHA256.test(provenance.workflowFileSha256 ?? "")) errors.push(`${runId}: missing workflow file SHA-256`);
  for (const field of ["runnerArch", "runnerImageOs", "runnerImageVersion", "runnerName", "runnerOs"]) {
    if (typeof provenance[field] !== "string" || provenance[field].trim().length === 0) errors.push(`${runId}: missing CI provenance ${field}`);
  }
  if (typeof run.packageManagerVersion !== "string" || !/^\d+\.\d+/.test(run.packageManagerVersion)) errors.push(`${runId}: invalid package manager version`);
}

export function evaluateFreshUserStudy(study, options = {}) {
  const errors = [];
  const participants = Array.isArray(study?.participants) ? study.participants : [];
  const normalizedParticipants = participants.map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {});
  const evidenceFileErrors = Array.isArray(options.evidenceFileErrors) ? options.evidenceFileErrors : ["human evidence files were not independently verified"];
  const evidenceFilesVerified = options.evidenceFilesVerified === true && evidenceFileErrors.length === 0;
  if (study?.schemaVersion !== "nodekit.fresh-user-study/v1") errors.push("study requires nodekit.fresh-user-study/v1");
  if (!COMMIT.test(study?.nodekitCommit ?? "")) errors.push("study requires an immutable NodeKit commit");
  if (!SHA256.test(study?.nodekitSourceHash ?? "")) errors.push("study requires a NodeKit source hash");
  if (study?.instruction !== "Use this app to complete the job shown on screen.") errors.push("study instruction changed");
  if (participants.length < 5) errors.push("at least five fresh participants are required");
  if (normalizedParticipants.some((entry) => typeof entry.participantId !== "string" || entry.participantId.trim().length === 0)) errors.push("participant IDs must be non-empty strings");
  if (new Set(normalizedParticipants.map((entry) => entry.participantId)).size !== participants.length) errors.push("participant IDs must be unique");
  const evidencePaths = new Set();
  const evidenceHashes = new Set();
  const numericFields = ["firstMeaningfulActionMs", "neutralJourneyMs", "wrongTurns", "helpRequests", "singleEaseQuestion", "p0P1Failures"];
  for (const participant of normalizedParticipants) {
    const participantId = participant.participantId ?? "unknown";
    if (participant.fresh !== true) errors.push(`${participant.participantId ?? "unknown"}: participant is not marked fresh`);
    if (participant.consentRecorded !== true) errors.push(`${participantId}: consent is not recorded`);
    if (!isIsoTimestamp(participant.sessionStartedAt)) errors.push(`${participantId}: invalid sessionStartedAt`);
    if (!isIsoTimestamp(participant.sessionCompletedAt)) errors.push(`${participantId}: invalid sessionCompletedAt`);
    const startedAt = Date.parse(participant.sessionStartedAt);
    const completedAt = Date.parse(participant.sessionCompletedAt);
    if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt <= startedAt) errors.push(`${participantId}: sessionCompletedAt must be after sessionStartedAt`);
    const evidenceRefs = Array.isArray(participant.evidenceRefs) ? participant.evidenceRefs : [];
    const kinds = new Set();
    for (const evidence of evidenceRefs) {
      if (!allowedHumanEvidenceKinds.has(evidence?.kind)) errors.push(`${participantId}: invalid evidence kind ${evidence?.kind ?? "missing"}`);
      else kinds.add(evidence.kind);
      if (!isPortableEvidencePath(evidence?.path)) errors.push(`${participantId}: evidence path must be repository-relative POSIX path`);
      if (!SHA256.test(evidence?.sha256 ?? "")) errors.push(`${participantId}: evidence requires a SHA-256 hash`);
      if (evidencePaths.has(evidence?.path)) errors.push(`${participantId}: evidence path is reused: ${evidence?.path}`);
      else if (typeof evidence?.path === "string") evidencePaths.add(evidence.path);
      if (evidenceHashes.has(evidence?.sha256)) errors.push(`${participantId}: evidence hash is reused`);
      else if (SHA256.test(evidence?.sha256 ?? "")) evidenceHashes.add(evidence.sha256);
    }
    if (!kinds.has("screenshot")) errors.push(`${participantId}: hash-bound screenshot evidence is required`);
    if (!kinds.has("session-log")) errors.push(`${participantId}: hash-bound session-log evidence is required`);
    for (const field of numericFields) if (!Number.isFinite(participant[field]) || participant[field] < 0) errors.push(`${participantId}: invalid ${field}`);
    if (Number.isFinite(participant.singleEaseQuestion) && (participant.singleEaseQuestion < 1 || participant.singleEaseQuestion > 7)) errors.push(`${participantId}: singleEaseQuestion must be between 1 and 7`);
    for (const field of ["wrongTurns", "helpRequests", "p0P1Failures"]) if (Number.isFinite(participant[field]) && !Number.isInteger(participant[field])) errors.push(`${participantId}: ${field} must be an integer`);
    const elapsedMs = completedAt - startedAt;
    if (Number.isFinite(elapsedMs) && Number.isFinite(participant.firstMeaningfulActionMs) && participant.firstMeaningfulActionMs > elapsedMs) errors.push(`${participantId}: firstMeaningfulActionMs exceeds the recorded session`);
    if (Number.isFinite(elapsedMs) && Number.isFinite(participant.neutralJourneyMs) && participant.neutralJourneyMs > elapsedMs) errors.push(`${participantId}: neutralJourneyMs exceeds the recorded session`);
    for (const field of ["completed", "assisted", "canExplainOutcome", "locatedFinalArtifact", "locatedUnresolvedIssues"]) {
      if (typeof participant[field] !== "boolean") errors.push(`${participantId}: missing ${field}`);
    }
  }
  errors.push(...evidenceFileErrors);
  const thresholds = study?.thresholds ?? {};
  for (const [field, expected] of Object.entries(requiredFreshUserThresholds)) {
    if (thresholds[field] !== expected) errors.push(`study threshold ${field} changed; expected ${expected}`);
  }
  const unassistedCompletions = normalizedParticipants.filter((entry) => entry.completed === true && entry.assisted === false).length;
  const outcomeExplanations = normalizedParticipants.filter((entry) => entry.canExplainOutcome === true).length;
  const finalArtifactsLocated = normalizedParticipants.filter((entry) => entry.locatedFinalArtifact === true).length;
  const unresolvedIssuesLocated = normalizedParticipants.filter((entry) => entry.locatedUnresolvedIssues === true).length;
  const medianFirstMeaningfulActionMs = median(normalizedParticipants.map((entry) => entry.firstMeaningfulActionMs).filter(Number.isFinite));
  const medianNeutralJourneyMs = median(normalizedParticipants.map((entry) => entry.neutralJourneyMs).filter(Number.isFinite));
  const medianSingleEaseQuestion = median(normalizedParticipants.map((entry) => entry.singleEaseQuestion).filter(Number.isFinite));
  const p0P1Failures = normalizedParticipants.reduce((sum, entry) => sum + (Number.isFinite(entry.p0P1Failures) ? entry.p0P1Failures : 0), 0);
  const checks = {
    participantCount: participants.length >= 5,
    unassistedCompletion: unassistedCompletions >= thresholds.minimumUnassistedCompletions,
    outcomeUnderstood: outcomeExplanations >= thresholds.minimumOutcomeComprehensions,
    finalArtifactLocated: finalArtifactsLocated >= thresholds.minimumFinalArtifactsLocated,
    unresolvedIssuesLocated: unresolvedIssuesLocated >= thresholds.minimumUnresolvedIssuesLocated,
    firstMeaningfulAction: medianFirstMeaningfulActionMs !== null && medianFirstMeaningfulActionMs <= thresholds.maximumMedianFirstMeaningfulActionMs,
    neutralJourney: medianNeutralJourneyMs !== null && medianNeutralJourneyMs <= thresholds.maximumMedianNeutralJourneyMs,
    singleEaseQuestion: medianSingleEaseQuestion !== null && medianSingleEaseQuestion >= thresholds.minimumMedianSingleEaseQuestion,
    noP0P1Failures: p0P1Failures <= thresholds.maximumP0P1Failures,
    evidenceFilesVerified,
  };
  const selectedParticipants = normalizedParticipants.map((participant) => ({
    participantId: participant.participantId,
    fresh: participant.fresh,
    consentRecorded: participant.consentRecorded,
    sessionStartedAt: participant.sessionStartedAt,
    sessionCompletedAt: participant.sessionCompletedAt,
    evidenceRefs: participant.evidenceRefs,
    firstMeaningfulActionMs: participant.firstMeaningfulActionMs,
    neutralJourneyMs: participant.neutralJourneyMs,
    wrongTurns: participant.wrongTurns,
    helpRequests: participant.helpRequests,
    singleEaseQuestion: participant.singleEaseQuestion,
    p0P1Failures: participant.p0P1Failures,
    completed: participant.completed,
    assisted: participant.assisted,
    canExplainOutcome: participant.canExplainOutcome,
    locatedFinalArtifact: participant.locatedFinalArtifact,
    locatedUnresolvedIssues: participant.locatedUnresolvedIssues,
  }));
  return {
    schemaVersion: "nodekit.fresh-user-verdict/v1",
    nodekitCommit: study?.nodekitCommit ?? null,
    nodekitSourceHash: study?.nodekitSourceHash ?? null,
    nodekitIdentity: study?.nodekitCommit && study?.nodekitSourceHash ? `${study.nodekitCommit}/${study.nodekitSourceHash}` : null,
    passed: errors.length === 0 && Object.values(checks).every(Boolean),
    errors,
    checks,
    evidenceFilesVerified,
    thresholdsUsed: { ...thresholds },
    selectedParticipants,
    metrics: { participantCount: participants.length, unassistedCompletions, outcomeExplanations, finalArtifactsLocated, unresolvedIssuesLocated, medianFirstMeaningfulActionMs, medianNeutralJourneyMs, medianSingleEaseQuestion, p0P1Failures },
  };
}

export function evaluateDeveloperTimingMatrix(receipts) {
  const errors = [];
  const cells = {};
  const identities = new Set();
  const tarballIdentities = new Set();
  const applicationIdentities = { npm: new Set(), pnpm: new Set() };
  const seenRunIds = new Set();
  const seenReceiptHashes = new Set();
  if (!Array.isArray(receipts)) receipts = [];
  const validReceipts = receipts.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  if (receipts.length !== 60) errors.push(`developer timing matrix requires exactly 60 runs, found ${receipts.length}`);
  for (const candidate of receipts) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push("unknown: timing receipt must be an object");
      continue;
    }
    const run = candidate;
    const runId = run?.runId ?? "unknown";
    if (run?.schemaVersion !== "nodekit.developer-timing-run/v1") errors.push(`${runId}: invalid timing receipt schema`);
    if (typeof run?.runId !== "string" || run.runId.length === 0) errors.push(`${runId}: missing runId`);
    else if (seenRunIds.has(run.runId)) errors.push(`${runId}: duplicate runId`);
    else seenRunIds.add(run.runId);
    if (!requiredLanes.includes(run?.lane)) errors.push(`${runId}: unexpected lane ${run?.lane ?? "missing"}`);
    if (!["cold", "warm"].includes(run?.cacheClass)) errors.push(`${runId}: unexpected cacheClass ${run?.cacheClass ?? "missing"}`);
    const [laneOperatingSystem, lanePackageManager] = typeof run?.lane === "string" ? run.lane.split("/") : [];
    if (run?.packageManager !== lanePackageManager) errors.push(`${runId}: packageManager does not match lane`);
    if (typeof run?.operatingSystem !== "string" || !run.operatingSystem.startsWith(laneOperatingSystemPrefixes[laneOperatingSystem] ?? "__invalid__")) errors.push(`${runId}: operatingSystem does not match lane`);
    if (typeof run?.nodeVersion !== "string" || !/^v\d+\./.test(run.nodeVersion)) errors.push(`${runId}: invalid nodeVersion`);
    if (!isIsoTimestamp(run?.generatedAt)) errors.push(`${runId}: invalid generatedAt`);
    if (!COMMIT.test(run?.nodekitCommit ?? "")) errors.push(`${runId}: missing immutable NodeKit commit`);
    if (!SHA256.test(run?.nodekitSourceHash ?? "")) errors.push(`${runId}: missing NodeKit source hash`);
    if (COMMIT.test(run?.nodekitCommit ?? "") && SHA256.test(run?.nodekitSourceHash ?? "")) identities.add(`${run.nodekitCommit}/${run.nodekitSourceHash}`);
    if (run?.nodekitPackage !== "@homenshum/nodekit") errors.push(`${runId}: unexpected NodeKit package identity`);
    if (typeof run?.nodekitVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(run.nodekitVersion)) errors.push(`${runId}: invalid NodeKit package version`);
    if (!SHA256.test(run?.nodekitTarballSha256 ?? "")) errors.push(`${runId}: missing exact NodeKit tarball SHA-256`);
    else tarballIdentities.add(`${run.nodekitPackage}@${run.nodekitVersion}/${run.nodekitTarballSha256}`);
    if (!SHA256.test(run?.applicationHash ?? "") || !SHA256.test(run?.configHash ?? "")) errors.push(`${runId}: missing generated application identity`);
    else if (applicationIdentities[run.packageManager]) applicationIdentities[run.packageManager].add(`${run.applicationHash}/${run.configHash}`);
    if (!COMMIT.test(run?.generatedCandidateCommit ?? "")) errors.push(`${runId}: missing generated candidate commit`);
    if (!SHA256.test(run?.generatedCandidateArchiveSha256 ?? "") || !Number.isFinite(run?.generatedCandidateArchiveBytes) || run.generatedCandidateArchiveBytes <= 0) errors.push(`${runId}: missing generated candidate archive identity`);
    if (run?.timerBoundary !== "empty-launcher-before-package-json-to-completed-proof") errors.push(`${runId}: timer boundary is not the preregistered empty-launcher journey`);
    validateTimingProvenance(run, errors);
    if (!SHA256.test(run?.receiptSha256 ?? "")) errors.push(`${runId}: missing receipt SHA-256`);
    else {
      if (seenReceiptHashes.has(run.receiptSha256)) errors.push(`${runId}: duplicate receipt SHA-256`);
      else seenReceiptHashes.add(run.receiptSha256);
      const { receiptSha256, ...receiptBody } = run;
      const recomputed = sha256(JSON.stringify(receiptBody));
      if (recomputed !== receiptSha256) errors.push(`${runId}: receipt SHA-256 does not match the receipt body`);
    }
  }
  if (identities.size !== 1) errors.push(`developer timing receipts must share one immutable NodeKit identity; found ${identities.size}`);
  if (tarballIdentities.size !== 1) errors.push(`developer timing receipts must share one exact NodeKit tarball identity; found ${tarballIdentities.size}`);
  for (const packageManager of ["npm", "pnpm"]) {
    if (applicationIdentities[packageManager].size !== 1) errors.push(`${packageManager}: timing receipts must share one generated application identity; found ${applicationIdentities[packageManager].size}`);
  }
  for (const lane of requiredLanes) {
    cells[lane] = {};
    for (const cacheClass of ["cold", "warm"]) {
      const runs = validReceipts.filter((entry) => entry.lane === lane && entry.cacheClass === cacheClass);
      if (runs.length !== 5) errors.push(`${lane}/${cacheClass}: requires exactly five runs, found ${runs.length}`);
      if (cacheClass === "cold" && runs.some((entry) => entry.cacheIsolated !== true)) errors.push(`${lane}/cold: every cache must be isolated`);
      for (const run of runs) {
        for (const field of timingFields) if (!Number.isFinite(run.measurements?.[field]) || run.measurements[field] < 0) errors.push(`${run.runId ?? "unknown"}: invalid ${field}`);
        for (const field of ["launcherInstallationMs", "generatedAppInstallationMs", "browserRuntimeInstallationMs"]) {
          if (!Number.isFinite(run.measurements?.[field]) || run.measurements[field] < 0) errors.push(`${run.runId ?? "unknown"}: invalid ${field}`);
        }
        const installParts = ["launcherInstallationMs", "generatedAppInstallationMs", "browserRuntimeInstallationMs"].map((field) => run.measurements?.[field]);
        if (installParts.every(Number.isFinite)
          && Number.isFinite(run.measurements?.dependencyInstallationMs)
          && run.measurements.dependencyInstallationMs !== installParts.reduce((sum, value) => sum + value, 0)) {
          errors.push(`${run.runId ?? "unknown"}: dependencyInstallationMs does not equal its measured installation phases`);
        }
        const exclusiveMinimum = ["scaffoldGenerationMs", "dependencyInstallationMs", "compileMs"].map((field) => run.measurements?.[field]);
        if (exclusiveMinimum.every(Number.isFinite)
          && Number.isFinite(run.measurements?.totalMs)
          && run.measurements.totalMs < exclusiveMinimum.reduce((sum, value) => sum + value, 0)) errors.push(`${run.runId ?? "unknown"}: totalMs is shorter than its non-overlapping measured phases`);
        for (const [field, maximum] of Object.entries(developerTimingThresholds.perRunMaximumMs)) {
          if (Number.isFinite(run.measurements?.[field]) && run.measurements[field] > maximum) errors.push(`${run.runId ?? "unknown"}: ${field} exceeds the preregistered per-run maximum of ${maximum}ms`);
        }
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
      for (const field of timingFields) {
        const configured = developerTimingThresholds.perCellMedianMs[field];
        const maximumMedian = typeof configured === "object" ? configured[cacheClass] : configured;
        const observedMedian = cells[lane][cacheClass][field].median;
        if (Number.isFinite(observedMedian) && observedMedian > maximumMedian) errors.push(`${lane}/${cacheClass}: median ${field} ${observedMedian}ms exceeds the preregistered ${maximumMedian}ms limit`);
      }
    }
  }
  const nodekitIdentity = identities.size === 1 ? [...identities][0] : null;
  const [nodekitCommit = null, nodekitSourceHash = null] = nodekitIdentity?.split("/") ?? [];
  const nodekitTarballIdentity = tarballIdentities.size === 1 ? [...tarballIdentities][0] : null;
  const nodekitTarballSha256 = nodekitTarballIdentity?.split("/").at(-1) ?? null;
  const selectedRuns = [...validReceipts]
    .sort((left, right) => requiredLanes.indexOf(left.lane) - requiredLanes.indexOf(right.lane)
      || ["cold", "warm"].indexOf(left.cacheClass) - ["cold", "warm"].indexOf(right.cacheClass)
      || lexical(String(left.runId), String(right.runId)))
    .map((run) => ({ runId: run.runId, lane: run.lane, cacheClass: run.cacheClass, receiptSha256: run.receiptSha256 }));
  return {
    schemaVersion: "nodekit.developer-timing-verdict/v1",
    nodekitCommit,
    nodekitSourceHash,
    nodekitIdentity,
    nodekitTarballSha256,
    applicationIdentities: Object.fromEntries(Object.entries(applicationIdentities).map(([manager, values]) => [manager, values.size === 1 ? [...values][0] : null])),
    thresholdsUsed: developerTimingThresholds,
    passed: errors.length === 0,
    errors,
    requiredRuns: 60,
    observedRuns: receipts.length,
    selectedRuns,
    cells,
  };
}
