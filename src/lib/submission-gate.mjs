import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { evaluateDeveloperTimingMatrix } from "./ease-evidence.mjs";
import { inspectNpmPackageArchiveBytes } from "./npm-package-archive.mjs";
import { validateSchema } from "./schema-validation.mjs";
import { computeNodeKitSourceHash } from "./source-hash.mjs";
import {
  EXTERNALLY_OBSERVED_GATE_TYPES,
  externalGateEvidenceRootSha256,
  externalGateVerdictBodySha256,
  proofLoopEvidenceRootSha256,
  verifyDetachedAttestation,
} from "./submission-attestation.mjs";

export const requiredSubmissionGates = Object.freeze([
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
export const submissionCandidateEvidencePath = "proof/submission-candidate.json";
export const submissionGateSchemas = Object.freeze({
  developerTimingMatrix: "nodekit.developer-timing-verdict.v1.schema.json",
  freshAgentHeldout: "nodekit.fresh-agent-verdict.v2.schema.json",
  freshHumanUsability: "nodekit.fresh-user-verdict.v1.schema.json",
  threeConvexConsumers: "nodekit.convex-consumers-verdict.v1.schema.json",
  previewDeployment: "nodekit.preview-verdict.v1.schema.json",
  managedSupabasePortability: "nodekit.managed-supabase-portability-verdict.v1.schema.json",
  knowledgeEvolutionAdoption: "nodekit.knowledge-evolution-adoption-verdict.v1.schema.json",
  modelIntelligenceHarness: "nodekit.model-intelligence-harness-verdict.v1.schema.json",
  engineeringHealth: "nodekit.engineering-health-verdict.v1.schema.json",
  proofloopEaseVerification: "nodekit.proofloop-ease-verification.v1.schema.json",
  packageInstallProof: "nodekit.package-install-proof.v1.schema.json",
  publicationApproval: "nodekit.publication-approval.v1.schema.json",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function submissionEvidenceRootSha256(gates) {
  if (!Array.isArray(gates)) throw new Error("submission gates must be an array");
  const entries = [];
  const seen = new Set();
  for (const gate of gates) {
    if (typeof gate?.id !== "string" || typeof gate?.passed !== "boolean" || !Array.isArray(gate?.evidence)) {
      throw new Error("submission gate is malformed");
    }
    for (const evidence of gate.evidence) {
      if (!portableEvidencePath(evidence?.path) || !SHA256.test(evidence?.sha256 ?? "")) throw new Error(`submission evidence reference is malformed: ${evidence?.path ?? "missing"}`);
      const key = `${gate.id}\0${evidence.path}`;
      if (seen.has(key)) throw new Error(`submission evidence path repeats within ${gate.id}: ${evidence.path}`);
      seen.add(key);
      entries.push({ gateId: gate.id, passed: gate.passed, path: evidence.path, sha256: evidence.sha256 });
    }
  }
  // The evidence root is signed and must therefore be identical across hosts.
  // String relational comparison uses deterministic UTF-16 code-unit order;
  // localeCompare can vary with the host locale and ICU version.
  entries.sort((left, right) => compareCodeUnits(left.gateId, right.gateId) || compareCodeUnits(left.path, right.path));
  return sha256(Buffer.from(JSON.stringify({ entries, schemaVersion: "nodekit.submission-evidence-root/v1" }), "utf8"));
}

export function createSubmissionCandidateRecord({ candidateCommit, candidateSourceHash, gates, releaseCandidate }) {
  const candidateGateIds = requiredSubmissionGates.filter((id) => id !== "publicationApproval");
  if (!COMMIT.test(candidateCommit ?? "") || !SHA256.test(candidateSourceHash ?? "")) throw new Error("submission candidate identity is invalid");
  if (!Array.isArray(gates) || !exactSet(gates.map((gate) => gate?.id), candidateGateIds) || gates.length !== candidateGateIds.length) {
    throw new Error(`submission candidate must contain the ${candidateGateIds.length} pre-approval gates exactly once`);
  }
  const orderedGates = candidateGateIds.map((id) => gates.find((gate) => gate.id === id));
  if (orderedGates.some((gate) => gate.passed !== true)) {
    throw new Error(`submission candidate cannot be created until all ${candidateGateIds.length} pre-approval gates pass`);
  }
  const candidate = {
    schemaVersion: "nodekit.submission-candidate/v1",
    candidateCommit,
    candidateSourceHash,
    releaseCandidate,
    evidenceRootSha256: submissionEvidenceRootSha256(orderedGates),
    gates: orderedGates,
  };
  if (releaseCandidate?.nodekitCommit !== candidateCommit
    || releaseCandidate?.nodekitSourceHash !== candidateSourceHash
    || releaseCandidate?.packageName !== "@homenshum/nodekit"
    || !PACKAGE_VERSION.test(releaseCandidate?.packageVersion ?? "")
    || !SHA256.test(releaseCandidate?.nodekitTarballSha256 ?? "")) {
    throw new Error("submission candidate release identity is invalid");
  }
  return candidate;
}

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TIMING_LANES = ["windows/npm", "windows/pnpm", "ubuntu/npm", "ubuntu/pnpm", "macos/npm", "macos/pnpm"];
const TIMING_FIELDS = ["scaffoldGenerationMs", "dependencyInstallationMs", "compileMs", "serverReadinessMs", "firstMeaningfulPaintMs", "neutralJourneyMs", "totalMs"];
const AGENT_TASKS = ["research-map", "volunteer-onboarding", "launch-presentation"];
const AGENT_PROFILE_COUNTS = Object.freeze({ codex: 3, "claude-code": 1, "lower-cost": 1 });
const AGENT_EVIDENCE_KINDS = [
  "prompt", "prompt-hash", "environment", "interventions", "session", "final-report", "stderr", "token-usage",
  "command-ledger", "candidate-diff", "candidate-status", "candidate-commit", "application-identity", "candidate-archive",
  "browser-certification", "screenshot-manifest",
];
const CONSUMER_IDS = ["noderoom", "nodeslide", "nodevideo"];
const HUMAN_EVIDENCE_KINDS = new Set(["screenshot", "session-log", "recording"]);
const HUMAN_CHECKS = ["participantCount", "unassistedCompletion", "outcomeUnderstood", "finalArtifactLocated", "unresolvedIssuesLocated", "firstMeaningfulAction", "neutralJourney", "singleEaseQuestion", "noP0P1Failures", "evidenceFilesVerified"];
const CONSUMER_CHECKS = [
  "packagedComponentInstalled", "componentRegistered", "authenticatedOwnerScope", "crossOwnerDenied",
  "staleConflictProtected", "idempotentRetries", "exceptionRecovery", "receiptVerified", "conformancePassed",
];
const SUPABASE_CHECKS = [
  "authenticatedOwnerRead", "crossOwnerDenied", "directLifecycleWritesDenied", "proposalRpcPrincipalDerived",
  "storageBytesRoundTrip", "realtimeDelivery", "queueIsolation", "queueConsumption", "boundedCronInvocation",
  "exportImportHashesMatch",
];
const SUPABASE_EVIDENCE_KINDS = [
  "auth-rls-report", "storage-roundtrip", "realtime-delivery", "queue-report", "cron-report",
  "export-import-report", "managed-service-receipt",
];
const KNOWLEDGE_CHECKS = [
  "sameInputs", "protectedEvaluatorUnchanged", "flatBaselineCompleted", "staticGraphCompleted",
  "evolvingGraphCompleted", "performanceImprovedOrHeld", "noProtectedTaskRegression",
  "humanReviewedLedgerEvent", "downstreamConsumerAdopted", "receiptVerified",
];
const KNOWLEDGE_EVIDENCE_KINDS = [
  "protected-comparison", "evaluator-identity", "consumer-adoption", "evolution-ledger-event", "evolution-receipt",
];
const MODEL_CHECKS = [
  "liveExactModelObservation", "projectScopedCapabilityCard", "protectedApplicationGym",
  "independentEvaluation", "protectedEvaluatorUnchanged", "freshAgentCanary", "provisionalPromotionOnly",
  "noAutomaticPromotion", "receiptVerified",
];
const MODEL_EVIDENCE_KINDS = [
  "model-observation", "capability-card", "application-gym", "independent-evaluation", "fresh-agent-canary", "promotion-receipt",
];
const ENGINEERING_CHECKS = [
  "repositoryTests", "componentTests", "publicTypecheck", "componentTypecheck", "componentBuild",
  "packageAudit", "registry", "ecosystem", "evolution", "distributionClean",
];
const ENGINEERING_COMMANDS = Object.freeze({
  repositoryTests: "npm run test:repository",
  componentTests: "npm run test:component",
  publicTypecheck: "npm run typecheck:public",
  componentTypecheck: "npm run typecheck:component",
  componentBuild: "npm run build:component",
  packageAudit: "npm run audit:prod",
  registry: "npm run registry:check",
  ecosystem: "npm run ecosystem:check",
  evolution: "npm run evolution:verify",
  distributionClean: "node scripts/run-local-distribution-gate.mjs --candidate <commit> --source-hash <sha256>",
});
const PROOFLOOP_CHECKS = [
  "package", "timing", "agents", "humans", "consumers", "preview", "supabase", "evolution", "model", "engineering", "browser",
];
const CONSUMER_EVIDENCE_KINDS = ["component-tarball", "consumer-verdict", "screenshot-manifest"];
const PREVIEW_EVIDENCE_KINDS = ["browser-proof", "screenshot-manifest", "exported-artifact", "reopen-score", "cleanup-receipt", "deployment-receipt"];
const PROOFLOOP_EVIDENCE_KINDS = [
  "package", "timing", "agents", "humans", "consumers", "preview", "supabase", "evolution", "model", "engineering", "browser",
];
const PACKAGE_CHECKS = [
  "candidateIdentityStable", "convexComponentRuntime", "freshConsumerInstall", "packagedCliCreate",
  "generatedAppInstall", "compile", "check", "demo", "eval", "typecheckPublic", "receiptsValid",
  "tarballHashStable", "distributionComplete",
];
const PACKAGE_DISTRIBUTION_CHECKS = [
  "caseflowTypes", "convexClient", "convexConfig", "convexComponentApi", "convexComponentRuntime",
  "convexTestExport", "postgresAdapter", "postgresMigration", "supabaseProfile", "supabaseWorkers",
];
const PACKAGE_SUPPORTING_EVIDENCE_FILES = [
  "application-identity.json", "demo-receipt.json", "eval-receipt.json", "convex-runtime-proof.mjs",
  "command-ledger.json", "package-files.json", "public-api.ts", "convex-runtime-proof.json",
  "generated-package.json", "generated-package-lock.json", "generated-npm-ls.json", "installed-runtime-identity.json",
  "generated-receipt-bindings.json", "generated-app.tar.gz", "generated-candidate.json",
];
const BROWSER_STATES = Object.freeze([
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
]);
const BROWSER_THEMES = Object.freeze(["light", "dark"]);
const BROWSER_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  wide: Object.freeze({ width: 1920, height: 1080 }),
  "tablet-landscape": Object.freeze({ width: 1024, height: 768 }),
  "tablet-portrait": Object.freeze({ width: 768, height: 1024 }),
  "mobile-portrait": Object.freeze({ width: 390, height: 844 }),
  "mobile-landscape": Object.freeze({ width: 844, height: 390 }),
});
const BROWSER_ARTIFACT_IDS = Object.freeze([
  "playwright-trace", "browser-video", "portable-proof-bundle", "browser-console", "browser-network",
]);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value;
}

export function portableEvidencePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value !== "."
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split("/").includes("..")
    && path.posix.normalize(value) === value;
}

function hasExactIdentity(value) {
  return COMMIT.test(value?.nodekitCommit ?? "")
    && SHA256.test(value?.nodekitSourceHash ?? "")
    && value?.nodekitIdentity === `${value.nodekitCommit}/${value.nodekitSourceHash}`;
}

export function releaseCandidateBinding(value) {
  const candidate = value?.releaseCandidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if (!exactSet(Object.keys(candidate), ["nodekitCommit", "nodekitSourceHash", "nodekitTarballSha256", "packageName", "packageVersion"])) return null;
  if (!COMMIT.test(candidate.nodekitCommit ?? "")
    || !SHA256.test(candidate.nodekitSourceHash ?? "")
    || !SHA256.test(candidate.nodekitTarballSha256 ?? "")
    || candidate.packageName !== "@homenshum/nodekit"
    || !PACKAGE_VERSION.test(candidate.packageVersion ?? "")) return null;
  if (evidenceCandidateCommit(value) !== candidate.nodekitCommit || evidenceSourceHash(value) !== candidate.nodekitSourceHash) return null;
  return candidate;
}

function releaseCandidateKey(value) {
  const candidate = releaseCandidateBinding(value);
  return candidate ? `${candidate.nodekitCommit}/${candidate.nodekitSourceHash}/${candidate.packageName}@${candidate.packageVersion}/${candidate.nodekitTarballSha256}` : null;
}

function exactSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && [...new Set(values)].sort().join("\n") === [...expected].sort().join("\n");
}

function allTrue(value, keys) {
  return keys.every((key) => value?.[key] === true);
}

function exactTrueObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && exactSet(Object.keys(value), keys)
    && keys.every((key) => value[key] === true);
}

function exactEvidenceKinds(evidence, kinds) {
  return Array.isArray(evidence)
    && exactSet(evidence.map((entry) => entry?.kind), kinds)
    && evidence.every((entry) => portableEvidencePath(entry?.path) && SHA256.test(entry?.sha256 ?? ""));
}

function externalGateAttestationContract(value, gateId) {
  try {
    const candidate = releaseCandidateBinding(value);
    const payload = value?.attestationPayload;
    const attestation = value?.attestation;
    return candidate !== null
      && payload?.schemaVersion === "nodekit.external-gate-verification-attestation-payload/v1"
      && payload?.type === gateId
      && payload?.verdict === "passed"
      && payload?.candidateCommit === candidate.nodekitCommit
      && payload?.nodekitSourceHash === candidate.nodekitSourceHash
      && payload?.nodekitTarballSha256 === candidate.nodekitTarballSha256
      && payload?.evidenceRootSha256 === externalGateEvidenceRootSha256(transitiveSubmissionEvidence(gateId, value))
      && payload?.verdictBodySha256 === externalGateVerdictBodySha256(value)
      && attestation?.schemaVersion === "nodekit.detached-attestation/v1"
      && attestation?.payloadType === gateId;
  } catch {
    return false;
  }
}

function proofLoopEvidenceRootMatches(payload, evidence) {
  try {
    return payload?.decisiveEvidenceRootSha256 === proofLoopEvidenceRootSha256(evidence);
  } catch {
    return false;
  }
}

function decisiveDeveloperTiming(value) {
  const selected = value?.selectedRuns;
  return value?.schemaVersion === "nodekit.developer-timing-verdict/v1"
    && value.passed === true
    && Array.isArray(value.errors) && value.errors.length === 0
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && value.requiredRuns === 60
    && value.observedRuns === 60
    && exactEvidenceKinds(value.supportingEvidence, ["timing-receipts"])
    && value.supportingEvidence[0].path === "proof/ease/developer-timing-runs.json"
    && externalGateAttestationContract(value, "developerTimingMatrix")
    && Array.isArray(selected)
    && selected.length === 60
    && new Set(selected.map((entry) => entry.runId)).size === 60
    && new Set(selected.map((entry) => entry.receiptSha256)).size === 60
    && selected.every((entry) => typeof entry.runId === "string" && entry.runId.length > 0
      && TIMING_LANES.includes(entry.lane)
      && ["cold", "warm"].includes(entry.cacheClass)
      && SHA256.test(entry.receiptSha256 ?? ""))
    && TIMING_LANES.every((lane) => ["cold", "warm"].every((cacheClass) => selected.filter((entry) => entry.lane === lane && entry.cacheClass === cacheClass).length === 5))
    && TIMING_LANES.every((lane) => ["cold", "warm"].every((cacheClass) => TIMING_FIELDS.every((field) => {
      const metric = value?.cells?.[lane]?.[cacheClass]?.[field];
      return metric?.samples === 5
        && Number.isFinite(metric.median)
        && Number.isFinite(metric.minimum)
        && Number.isFinite(metric.maximum);
    })));
}

function decisiveFreshAgents(value) {
  const selected = value?.selectedRuns;
  return value?.schemaVersion === "nodekit.fresh-agent-verdict/v2"
    && value.passed === true
    && Array.isArray(value.errors) && value.errors.length === 0
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && value.requiredRuns === 15
    && value.observedTrials === 15
    && Number.isInteger(value.observedRepositoryTrials) && value.observedRepositoryTrials >= value.observedTrials
    && Number.isInteger(value.ignoredOtherCandidateTrials)
    && value.ignoredOtherCandidateTrials === value.observedRepositoryTrials - value.observedTrials
    && Number.isInteger(value.legacyTrialsIgnored) && value.legacyTrialsIgnored >= 0
    && value.allAttemptsSelected === true
    && value.failedTrials === 0
    && externalGateAttestationContract(value, "freshAgentHeldout")
    && Object.keys(value.requiredProfiles ?? {}).length === Object.keys(AGENT_PROFILE_COUNTS).length
    && Object.entries(AGENT_PROFILE_COUNTS).every(([profile, count]) => value.requiredProfiles?.[profile] === count)
    && exactSet(value.requiredTasks, AGENT_TASKS)
    && Array.isArray(selected)
    && selected.length === 15
    && new Set(selected.map((entry) => entry.runId)).size === 15
    && new Set(selected.map((entry) => entry.agentSessionId)).size === 15
    && new Set(selected.map((entry) => entry.manifestSha256)).size === 15
    && new Set(selected.map((entry) => entry.receiptSha256)).size === 15
    && new Set(selected.map((entry) => entry.evidence?.find((item) => item.kind === "session")?.sha256)).size === 15
    && AGENT_TASKS.every((taskId) => Object.entries(AGENT_PROFILE_COUNTS).every(([profile, count]) =>
      selected.filter((entry) => entry.taskId === taskId && entry.agentProfile === profile).length === count))
    && selected.every((entry) => {
      const evidence = entry.evidence;
      return typeof entry.runId === "string" && entry.runId.length > 0
        && entry.nodekitCommit === value.nodekitCommit
        && entry.nodekitSourceHash === value.nodekitSourceHash
        && entry.nodekitPackage === value.releaseCandidate.packageName
        && entry.nodekitVersion === value.releaseCandidate.packageVersion
        && entry.nodekitTarballSha256 === value.releaseCandidate.nodekitTarballSha256
        && SHA256.test(entry.applicationHash ?? "")
        && SHA256.test(entry.configHash ?? "")
        && entry.freshSession === true
        && typeof entry.agentSessionId === "string" && entry.agentSessionId.trim().length > 0
        && entry.passed === true
        && entry.validationPassed === true
        && typeof entry.agentVersion === "string" && entry.agentVersion.trim().length > 0
        && ((entry.agentProfile === "codex" && entry.agentDriver === "codex")
          || (entry.agentProfile === "claude-code" && entry.agentDriver === "claude-code")
          || (entry.agentProfile === "lower-cost" && new Set(["codex", "claude-code"]).has(entry.agentDriver)
            && typeof entry.agentModel === "string" && entry.agentModel.trim().length > 0))
        && /^\d{4}-\d{2}-\d{2}T/.test(entry.trialStartedAt ?? "")
        && /^\d{4}-\d{2}-\d{2}T/.test(entry.generatedAt ?? "")
        && entry.manifestPath === `proof/ease/agents/${entry.runId}/manifest.json`
        && SHA256.test(entry.promptSha256 ?? "")
        && SHA256.test(entry.receiptSha256 ?? "")
        && SHA256.test(entry.manifestSha256 ?? "")
        && SHA256.test(entry.evidenceSetSha256 ?? "")
        && entry.evidenceCount === AGENT_EVIDENCE_KINDS.length
        && Array.isArray(evidence)
        && exactSet(evidence.map((item) => item.kind), AGENT_EVIDENCE_KINDS)
        && new Set(evidence.map((item) => item.path)).size === evidence.length
        && evidence.every((item) => Number.isInteger(item.bytes) && item.bytes >= 0
          && portableEvidencePath(item.path)
          && item.path.startsWith(`proof/ease/agents/${entry.runId}/`)
          && SHA256.test(item.sha256 ?? ""))
        && entry.evidenceSetSha256 === sha256(JSON.stringify(evidence));
    });
}

function decisiveFreshHumans(value) {
  const selected = value?.selectedParticipants;
  if (!Array.isArray(selected) || selected.length < 5) return false;
  const participantIds = selected.map((entry) => entry?.participantId);
  const allEvidence = selected.flatMap((entry) => Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : []);
  const selectedRowsValid = selected.every((entry) => {
    const evidence = Array.isArray(entry?.evidenceRefs) ? entry.evidenceRefs : [];
    const kinds = new Set(evidence.map((ref) => ref?.kind));
    const startedAt = Date.parse(entry?.sessionStartedAt);
    const completedAt = Date.parse(entry?.sessionCompletedAt);
    return typeof entry?.participantId === "string" && entry.participantId.length > 0
      && entry.fresh === true
      && entry.consentRecorded === true
      && validIsoTimestamp(entry.sessionStartedAt)
      && validIsoTimestamp(entry.sessionCompletedAt)
      && completedAt > startedAt
      && kinds.has("screenshot")
      && kinds.has("session-log")
      && evidence.every((ref) => HUMAN_EVIDENCE_KINDS.has(ref?.kind) && portableEvidencePath(ref?.path) && SHA256.test(ref?.sha256 ?? ""))
      && Number.isFinite(entry.firstMeaningfulActionMs) && entry.firstMeaningfulActionMs >= 0 && entry.firstMeaningfulActionMs <= completedAt - startedAt
      && Number.isFinite(entry.neutralJourneyMs) && entry.neutralJourneyMs >= 0 && entry.neutralJourneyMs <= completedAt - startedAt
      && Number.isInteger(entry.wrongTurns) && entry.wrongTurns >= 0
      && Number.isInteger(entry.helpRequests) && entry.helpRequests >= 0
      && Number.isFinite(entry.singleEaseQuestion) && entry.singleEaseQuestion >= 1 && entry.singleEaseQuestion <= 7
      && Number.isInteger(entry.p0P1Failures) && entry.p0P1Failures >= 0
      && ["completed", "assisted", "canExplainOutcome", "locatedFinalArtifact", "locatedUnresolvedIssues"].every((field) => typeof entry[field] === "boolean");
  });
  const unassistedCompletions = selected.filter((entry) => entry.completed === true && entry.assisted === false).length;
  const outcomeExplanations = selected.filter((entry) => entry.canExplainOutcome === true).length;
  const finalArtifactsLocated = selected.filter((entry) => entry.locatedFinalArtifact === true).length;
  const unresolvedIssuesLocated = selected.filter((entry) => entry.locatedUnresolvedIssues === true).length;
  const medianFirstMeaningfulActionMs = median(selected.map((entry) => entry.firstMeaningfulActionMs));
  const medianNeutralJourneyMs = median(selected.map((entry) => entry.neutralJourneyMs));
  const medianSingleEaseQuestion = median(selected.map((entry) => entry.singleEaseQuestion));
  const p0P1Failures = selected.reduce((sum, entry) => sum + entry.p0P1Failures, 0);
  return value?.schemaVersion === "nodekit.fresh-user-verdict/v1"
    && value.passed === true
    && Array.isArray(value.errors) && value.errors.length === 0
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && SHA256.test(value.applicationHash ?? "")
    && SHA256.test(value.configHash ?? "")
    && value.evidenceFilesVerified === true
    && exactTrueObject(value.checks, HUMAN_CHECKS)
    && selectedRowsValid
    && new Set(participantIds).size === selected.length
    && new Set(allEvidence.map((entry) => entry.path)).size === allEvidence.length
    && new Set(allEvidence.map((entry) => entry.sha256)).size === allEvidence.length
    && value.metrics?.participantCount === selected.length
    && value.metrics?.unassistedCompletions === unassistedCompletions && unassistedCompletions >= 4
    && value.metrics?.outcomeExplanations === outcomeExplanations && outcomeExplanations >= 4
    && value.metrics?.finalArtifactsLocated === finalArtifactsLocated && finalArtifactsLocated >= 4
    && value.metrics?.unresolvedIssuesLocated === unresolvedIssuesLocated && unresolvedIssuesLocated >= 4
    && value.metrics?.medianFirstMeaningfulActionMs === medianFirstMeaningfulActionMs && medianFirstMeaningfulActionMs <= 30_000
    && value.metrics?.medianNeutralJourneyMs === medianNeutralJourneyMs && medianNeutralJourneyMs <= 180_000
    && value.metrics?.medianSingleEaseQuestion === medianSingleEaseQuestion && medianSingleEaseQuestion >= 6
    && value.metrics?.p0P1Failures === p0P1Failures && p0P1Failures === 0
    && externalGateAttestationContract(value, "freshHumanUsability");
}

function decisiveConsumers(value) {
  const consumers = value?.consumers;
  return value?.schemaVersion === "nodekit.convex-consumers-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && value.qualifyingConsumers === 3
    && Array.isArray(consumers)
    && consumers.length === 3
    && exactSet(consumers.map((entry) => entry.id), CONSUMER_IDS)
    && externalGateAttestationContract(value, "threeConvexConsumers")
    && consumers.every((entry) => entry.nodekitCommit === value.nodekitCommit
      && entry.nodekitSourceHash === value.nodekitSourceHash
      && COMMIT.test(entry.consumerCommit ?? "")
      && entry.componentTarballSha256 === value.releaseCandidate.nodekitTarballSha256
      && SHA256.test(entry.verdictSha256 ?? "")
      && exactEvidenceKinds(entry.evidence, CONSUMER_EVIDENCE_KINDS)
      && entry.evidence.find((item) => item.kind === "component-tarball")?.sha256 === entry.componentTarballSha256
      && entry.evidence.find((item) => item.kind === "consumer-verdict")?.sha256 === entry.verdictSha256
      && exactTrueObject(entry.checks, CONSUMER_CHECKS)
      && entry.liveFlowAdoption?.passed === true
      && entry.liveFlowAdoption?.signedIn === true
      && entry.liveFlowAdoption?.browserJourneyPassed === true
      && SHA256.test(entry.liveFlowAdoption?.screenshotManifestSha256 ?? "")
      && entry.evidence.find((item) => item.kind === "screenshot-manifest")?.sha256 === entry.liveFlowAdoption.screenshotManifestSha256);
}

function decisivePreview(value) {
  return value?.schemaVersion === "nodekit.preview-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && SHA256.test(value.applicationHash ?? "")
    && SHA256.test(value.configHash ?? "")
    && value.deploymentCommit === value.nodekitCommit
    && typeof value.deploymentUrl === "string" && /^https:\/\/[^\s]+$/.test(value.deploymentUrl)
    && typeof value.deploymentProvider === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.deploymentProvider)
    && value.deploymentEnvironment === "preview"
    && typeof value.deploymentIdentity === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value.deploymentIdentity)
    && validIsoTimestamp(value.deploymentReceipt?.issuedAt)
    && portableEvidencePath(value.deploymentReceipt?.path)
    && SHA256.test(value.deploymentReceipt?.sha256 ?? "")
    && allTrue(value, ["freshIdentity", "realFixtureBytes", "frontendBackendCommitMatch", "browserJourneyPassed", "exportReopenPassed", "cleanupPassed"])
    && value.screenshotCount === BROWSER_STATES.length * Object.keys(BROWSER_VIEWPORTS).length * BROWSER_THEMES.length
    && value.consoleErrors === 0
    && value.networkFailures === 0
    && value.seriousAccessibilityViolations === 0
    && SHA256.test(value.browserProofSha256 ?? "")
    && SHA256.test(value.screenshotManifestSha256 ?? "")
    && exactEvidenceKinds(value.evidence, PREVIEW_EVIDENCE_KINDS)
    && value.evidence.find((item) => item.kind === "browser-proof")?.sha256 === value.browserProofSha256
    && value.evidence.find((item) => item.kind === "screenshot-manifest")?.sha256 === value.screenshotManifestSha256
    && value.evidence.find((item) => item.kind === "deployment-receipt")?.path === value.deploymentReceipt.path
    && value.evidence.find((item) => item.kind === "deployment-receipt")?.sha256 === value.deploymentReceipt.sha256
    && externalGateAttestationContract(value, "previewDeployment");
}

function decisiveManagedSupabase(value) {
  const roundTrip = value?.exportImport;
  return value?.schemaVersion === "nodekit.managed-supabase-portability-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && typeof value.projectRef === "string" && /^[a-z0-9][a-z0-9-]{5,62}$/.test(value.projectRef)
    && value.projectUrl === `https://${value.projectRef}.supabase.co`
    && value.environment === "managed-supabase"
    && validIsoTimestamp(value.testedAt)
    && exactTrueObject(value.checks, SUPABASE_CHECKS)
    && exactEvidenceKinds(value.evidence, SUPABASE_EVIDENCE_KINDS)
    && roundTrip?.sourceProvider === "convex"
    && roundTrip?.targetProvider === "supabase"
    && SHA256.test(roundTrip?.sourceArtifactSha256 ?? "")
    && roundTrip?.targetArtifactSha256 === roundTrip.sourceArtifactSha256
    && SHA256.test(roundTrip?.sourceReceiptSha256 ?? "")
    && roundTrip?.targetReceiptSha256 === roundTrip.sourceReceiptSha256
    && externalGateAttestationContract(value, "managedSupabasePortability");
}

function decisiveKnowledgeEvolution(value) {
  const comparison = value?.comparison;
  const adoption = value?.consumerAdoption;
  return value?.schemaVersion === "nodekit.knowledge-evolution-adoption-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && typeof value.comparisonId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value.comparisonId)
    && validIsoTimestamp(value.completedAt)
    && Number.isInteger(comparison?.taskCount) && comparison.taskCount >= 3
    && SHA256.test(comparison?.protectedBenchmarkSha256 ?? "")
    && SHA256.test(comparison?.harnessSha256 ?? "")
    && [comparison?.flatScore, comparison?.staticGraphScore, comparison?.evolvingGraphScore]
      .every((score) => Number.isFinite(score) && score >= 0 && score <= 1)
    && comparison.evolvingGraphScore >= comparison.flatScore
    && comparison.evolvingGraphScore >= comparison.staticGraphScore
    && ["improved", "held"].includes(comparison.outcome)
    && typeof adoption?.consumerId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(adoption.consumerId)
    && COMMIT.test(adoption?.consumerCommit ?? "")
    && adoption?.adopted === true
    && typeof value.ledgerEventId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value.ledgerEventId)
    && exactTrueObject(value.checks, KNOWLEDGE_CHECKS)
    && exactEvidenceKinds(value.evidence, KNOWLEDGE_EVIDENCE_KINDS)
    && externalGateAttestationContract(value, "knowledgeEvolutionAdoption");
}

function decisiveModelIntelligence(value) {
  const evaluation = value?.evaluation;
  const canary = value?.freshAgentCanary;
  return value?.schemaVersion === "nodekit.model-intelligence-harness-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && typeof value.projectId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value.projectId)
    && typeof value.observationId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value.observationId)
    && typeof value.provider === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.provider)
    && typeof value.model === "string" && value.model.trim().length > 0
    && validIsoTimestamp(value.observedAt)
    && value.promotionStatus === "provisional"
    && Number.isInteger(evaluation?.taskCount) && evaluation.taskCount >= 3
    && SHA256.test(evaluation?.protectedBenchmarkSha256 ?? "")
    && SHA256.test(evaluation?.harnessSha256 ?? "")
    && SHA256.test(evaluation?.protectedEvaluatorSha256 ?? "")
    && Number.isFinite(evaluation?.score) && evaluation.score >= 0 && evaluation.score <= 1
    && typeof canary?.sessionId === "string" && canary.sessionId.trim().length > 0
    && canary?.fresh === true
    && canary?.passed === true
    && exactTrueObject(value.checks, MODEL_CHECKS)
    && exactEvidenceKinds(value.evidence, MODEL_EVIDENCE_KINDS)
    && externalGateAttestationContract(value, "modelIntelligenceHarness");
}

function decisiveEngineeringHealth(value) {
  const commands = value?.commands;
  return value?.schemaVersion === "nodekit.engineering-health-verdict/v1"
    && value.passed === true
    && hasExactIdentity(value)
    && releaseCandidateBinding(value) !== null
    && validIsoTimestamp(value.completedAt)
    && exactTrueObject(value.checks, ENGINEERING_CHECKS)
    && value.unresolved?.p0 === 0
    && value.unresolved?.p1 === 0
    && Array.isArray(commands)
    && commands.length === ENGINEERING_CHECKS.length
    && exactSet(commands.map((entry) => entry?.id), ENGINEERING_CHECKS)
    && new Set(commands.map((entry) => entry?.path)).size === commands.length
    && commands.every((entry) => portableEvidencePath(entry?.path) && SHA256.test(entry?.sha256 ?? ""))
    && portableEvidencePath(value.issueInventory?.path)
    && SHA256.test(value.issueInventory?.sha256 ?? "")
    && value.issueInventory?.p0 === 0
    && value.issueInventory?.p1 === 0;
}

function decisiveProofLoop(value) {
  const evidence = value?.extensions?.decisiveEvidence;
  const payload = value?.extensions?.attestationPayload;
  const attestation = value?.extensions?.attestation;
  const releaseCandidate = releaseCandidateBinding(value);
  return value?.verdict?.status === "passed"
    && value?.extensions?.easeCertified === true
    && value?.extensions?.independentVerifier === true
    && releaseCandidateBinding(value) !== null
    && COMMIT.test(value?.subject?.repository?.candidateCommit ?? "")
    && SHA256.test(value?.subject?.repository?.nodekitSourceHash ?? "")
    && exactTrueObject(value?.extensions?.checks, PROOFLOOP_CHECKS)
    && exactEvidenceKinds(evidence, PROOFLOOP_EVIDENCE_KINDS)
    && new Set(evidence.map((entry) => entry.path)).size === evidence.length
    && new Set(evidence.map((entry) => entry.sha256)).size === evidence.length
    && payload?.type === "proofloopEaseVerification"
    && payload?.candidateCommit === releaseCandidate?.nodekitCommit
    && payload?.nodekitSourceHash === releaseCandidate?.nodekitSourceHash
    && payload?.nodekitTarballSha256 === releaseCandidate?.nodekitTarballSha256
    && proofLoopEvidenceRootMatches(payload, evidence)
    && portableEvidencePath(payload?.verification?.path)
    && SHA256.test(payload?.verification?.sha256 ?? "")
    && attestation?.schemaVersion === "nodekit.detached-attestation/v1"
    && attestation?.payloadType === "proofloopEaseVerification";
}

function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: repoRoot, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function nulPaths(output) {
  return output.toString("utf8").split("\0").filter(Boolean).map((entry) => entry.replaceAll("\\", "/"));
}

export function parseGitStatusZ(output) {
  const records = output.toString("utf8").split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new Error("malformed git status --porcelain=v1 -z output");
    const status = record.slice(0, 2);
    paths.push(record.slice(3).replaceAll("\\", "/"));
    if (/[RC]/.test(status)) {
      const originalPath = records[index + 1];
      if (!originalPath) throw new Error("malformed rename/copy record in git status output");
      paths.push(originalPath.replaceAll("\\", "/"));
      index += 1;
    }
  }
  return paths;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function readContainedEvidenceRecord(repoRoot, evidencePath) {
  if (!portableEvidencePath(evidencePath)) throw new Error(`evidence path is not a portable repository-relative path: ${evidencePath}`);
  const root = await realpath(repoRoot);
  const absolute = path.resolve(root, evidencePath);
  if (!contained(root, absolute)) throw new Error(`evidence escapes repository: ${evidencePath}`);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`evidence is not a regular non-symlink file: ${evidencePath}`);
  const resolved = await realpath(absolute);
  if (!contained(root, resolved)) throw new Error(`evidence symlink escapes repository: ${evidencePath}`);
  return {
    bytes: await readFile(resolved),
    fileIdentity: `${metadata.dev}:${metadata.ino}`,
    resolved,
  };
}

async function readContainedEvidence(repoRoot, evidencePath) {
  return (await readContainedEvidenceRecord(repoRoot, evidencePath)).bytes;
}

export async function readSubmissionEvidenceFile(repoRoot, evidencePath) {
  return readContainedEvidence(repoRoot, evidencePath);
}

export function evidenceCandidateCommit(value) {
  if (typeof value?.candidateCommit === "string") return value.candidateCommit;
  if (typeof value?.nodekitCommit === "string") return value.nodekitCommit;
  if (typeof value?.subject?.repository?.candidateCommit === "string") return value.subject.repository.candidateCommit;
  if (typeof value?.nodekitIdentity === "string") return value.nodekitIdentity.split("/")[0];
  return null;
}

export function evidenceSourceHash(value) {
  if (typeof value?.nodekitSourceHash === "string") return value.nodekitSourceHash;
  if (typeof value?.subject?.repository?.nodekitSourceHash === "string") return value.subject.repository.nodekitSourceHash;
  if (typeof value?.nodekitIdentity === "string") return value.nodekitIdentity.split("/")[1] ?? null;
  return null;
}

function evidenceRef(entry) {
  return {
    ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
    path: entry.path,
    sha256: entry.sha256,
    ...(Number.isInteger(entry.bytes) ? { bytes: entry.bytes } : {}),
  };
}

export function transitiveSubmissionEvidence(gateId, value) {
  switch (gateId) {
    case "developerTimingMatrix":
      return (value?.supportingEvidence ?? []).map(evidenceRef);
    case "freshAgentHeldout":
      return (value?.selectedRuns ?? []).flatMap((run) => [
        { path: run.manifestPath, sha256: run.manifestSha256 },
        ...(run.evidence ?? []).map(evidenceRef),
      ]);
    case "freshHumanUsability":
      return (value?.selectedParticipants ?? []).flatMap((participant) => (participant.evidenceRefs ?? []).map(evidenceRef));
    case "threeConvexConsumers":
      return (value?.consumers ?? []).flatMap((consumer) => (consumer.evidence ?? []).map(evidenceRef));
    case "previewDeployment":
      return (value?.evidence ?? []).map(evidenceRef);
    case "managedSupabasePortability":
    case "knowledgeEvolutionAdoption":
    case "modelIntelligenceHarness":
      return (value?.evidence ?? []).map(evidenceRef);
    case "engineeringHealth":
      return [
        ...(value?.commands ?? []).map((entry) => ({ kind: "engineering-check-receipt", path: entry.path, sha256: entry.sha256 })),
        ...(value?.issueInventory ? [{ kind: "engineering-issue-inventory", path: value.issueInventory.path, sha256: value.issueInventory.sha256 }] : []),
      ];
    case "proofloopEaseVerification":
      return [
        ...(value?.extensions?.decisiveEvidence ?? []).map(evidenceRef),
        ...(value?.extensions?.attestationPayload?.verification ? [evidenceRef(value.extensions.attestationPayload.verification)] : []),
      ];
    case "packageInstallProof":
      return [
        { path: value?.tarball, sha256: value?.tarballSha256, bytes: value?.tarballBytes },
        ...(value?.supportingEvidence ?? []).map(evidenceRef),
      ];
    case "publicationApproval":
      return value?.attestationPayload?.submissionManifest ? [evidenceRef(value.attestationPayload.submissionManifest)] : [];
    default:
      return [];
  }
}

function browserEvidenceRoot(manifestPath) {
  const suffix = "browser/screenshot-manifest.json";
  if (!manifestPath.endsWith(suffix)) {
    throw new Error(`browser screenshot manifest must end with ${suffix}: ${manifestPath}`);
  }
  return manifestPath.slice(0, -suffix.length);
}

function browserChildPath(root, childPath) {
  if (!portableEvidencePath(childPath) || !childPath.startsWith("browser/")) {
    throw new Error(`browser manifest child is not a canonical browser-relative path: ${childPath ?? "missing"}`);
  }
  const joined = `${root}${childPath}`;
  if (!portableEvidencePath(joined)) throw new Error(`browser manifest child resolves to an invalid evidence path: ${joined}`);
  return joined;
}

function browserManifestChildren(manifestPath, manifest) {
  if (manifest?.schemaVersion !== "nodekit.browser-certification/v1") throw new Error("screenshot manifest is not a NodeKit browser certification manifest");
  if (manifest.passed !== true || manifest.certified !== true || manifest.verdict !== "BROWSER_CERTIFIED") throw new Error("browser certification manifest is not certified");
  if (!hasExactIdentity(manifest)) throw new Error("browser certification manifest is missing exact NodeKit identity");
  if (!SHA256.test(manifest.applicationHash ?? "") || !SHA256.test(manifest.configHash ?? "")) throw new Error("browser certification manifest is missing application identity");
  if (!exactSet(manifest.requiredStates, BROWSER_STATES) || !exactSet(manifest.coveredStates, BROWSER_STATES)) throw new Error("browser certification state coverage is not exact");
  if (!Array.isArray(manifest.missingStates) || manifest.missingStates.length !== 0) throw new Error("browser certification reports missing states");
  if (!Array.isArray(manifest.consoleErrors) || manifest.consoleErrors.length !== 0) throw new Error("browser certification contains console errors");
  if (!Array.isArray(manifest.networkFailures) || manifest.networkFailures.length !== 0) throw new Error("browser certification contains network failures");
  if (!Array.isArray(manifest.accessibilityViolations) || manifest.accessibilityViolations.length !== 0) throw new Error("browser certification contains serious accessibility violations");
  if (!manifest.journeyAssertions || Object.keys(manifest.journeyAssertions).length === 0 || !Object.values(manifest.journeyAssertions).every((value) => value === true)) {
    throw new Error("browser certification journey assertions are incomplete");
  }
  const manifestForHash = { ...manifest };
  delete manifestForHash.manifestSha256;
  if (manifest.manifestSha256 !== sha256(Buffer.from(JSON.stringify(manifestForHash)))) throw new Error("browser certification manifest self-hash is invalid");

  const root = browserEvidenceRoot(manifestPath);
  const expectedCount = BROWSER_STATES.length * Object.keys(BROWSER_VIEWPORTS).length * BROWSER_THEMES.length;
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== expectedCount) {
    throw new Error(`browser certification requires exactly ${expectedCount} screenshots`);
  }
  const tuples = new Set();
  const childPaths = new Set();
  const screenshotHashes = new Set();
  const children = [];
  for (const screenshot of manifest.screenshots) {
    const viewport = BROWSER_VIEWPORTS[screenshot?.viewportId];
    const tuple = `${screenshot?.state}/${screenshot?.viewportId}/${screenshot?.theme}`;
    if (!BROWSER_STATES.includes(screenshot?.state) || !viewport || !BROWSER_THEMES.includes(screenshot?.theme)) throw new Error(`browser certification contains an unexpected screenshot tuple: ${tuple}`);
    if (tuples.has(tuple)) throw new Error(`browser certification reuses screenshot tuple: ${tuple}`);
    tuples.add(tuple);
    if (screenshot.viewport?.width !== viewport.width || screenshot.viewport?.height !== viewport.height) throw new Error(`browser certification viewport dimensions drifted for ${tuple}`);
    const expectedPng = `browser/screenshots/${screenshot.state}--${screenshot.viewportId}--${screenshot.theme}.png`;
    const expectedSidecar = expectedPng.replace(/\.png$/, ".json");
    if (screenshot.path !== expectedPng || screenshot.sidecarPath !== expectedSidecar) throw new Error(`browser certification screenshot paths drifted for ${tuple}`);
    if (!SHA256.test(screenshot.pngSha256 ?? "") || !SHA256.test(screenshot.sidecarSha256 ?? "")) throw new Error(`browser certification screenshot hashes are invalid for ${tuple}`);
    if (!Number.isInteger(screenshot.pngBytes) || screenshot.pngBytes <= 0 || !Number.isInteger(screenshot.sidecarBytes) || screenshot.sidecarBytes <= 0) throw new Error(`browser certification screenshot byte counts are invalid for ${tuple}`);
    if (screenshot.consoleErrors !== 0 || screenshot.failedRequests !== 0 || screenshot.horizontalOverflowPx !== 0 || screenshot.mojibakeDetected !== false) throw new Error(`browser certification screenshot health failed for ${tuple}`);
    if (screenshotHashes.has(screenshot.pngSha256) || screenshotHashes.has(screenshot.sidecarSha256)) throw new Error(`browser certification reuses screenshot evidence bytes for ${tuple}`);
    screenshotHashes.add(screenshot.pngSha256);
    screenshotHashes.add(screenshot.sidecarSha256);
    for (const childPath of [expectedPng, expectedSidecar]) {
      if (childPaths.has(childPath)) throw new Error(`browser certification reuses child path: ${childPath}`);
      childPaths.add(childPath);
    }
    children.push({
      bytes: screenshot.pngBytes,
      kind: "browser-screenshot",
      path: browserChildPath(root, expectedPng),
      sha256: screenshot.pngSha256,
    });
    children.push({
      bytes: screenshot.sidecarBytes,
      expectation: { screenshot, tuple },
      kind: "browser-screenshot-sidecar",
      path: browserChildPath(root, expectedSidecar),
      sha256: screenshot.sidecarSha256,
    });
  }
  if (tuples.size !== expectedCount) throw new Error("browser certification screenshot tuple matrix is incomplete");

  if (!Array.isArray(manifest.evidenceArtifacts) || !exactSet(manifest.evidenceArtifacts.map((entry) => entry?.id), BROWSER_ARTIFACT_IDS)) {
    throw new Error("browser certification evidence artifact set is not exact");
  }
  for (const artifact of manifest.evidenceArtifacts) {
    if (!SHA256.test(artifact?.sha256 ?? "") || !Number.isInteger(artifact?.byteSize) || artifact.byteSize < 0) throw new Error(`browser certification artifact metadata is invalid: ${artifact?.id ?? "missing"}`);
    if (childPaths.has(artifact.path)) throw new Error(`browser certification reuses child path: ${artifact.path}`);
    childPaths.add(artifact.path);
    children.push({ bytes: artifact.byteSize, kind: `browser-artifact:${artifact.id}`, path: browserChildPath(root, artifact.path), sha256: artifact.sha256 });
  }
  return children;
}

function packageTargetPaths(value, targets = []) {
  if (typeof value === "string") {
    if (value.startsWith("./")) targets.push(value.slice(2));
    return targets;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return targets;
  for (const child of Object.values(value)) packageTargetPaths(child, targets);
  return targets;
}

export async function validatePackageArchiveEvidence(repoRoot, verdict) {
  const archiveBytes = await readContainedEvidence(repoRoot, verdict.tarball);
  const archive = inspectNpmPackageArchiveBytes(archiveBytes, {
    expectedName: verdict.package,
    expectedTarballSha256: verdict.tarballSha256,
    expectedVersion: verdict.version,
  });
  if (archive.tarballBytes !== verdict.tarballBytes) throw new Error("verified archive byte count differs from package verdict");
  if (archive.fileCount !== verdict.fileCount) throw new Error("verified archive file count differs from package verdict");
  if (archive.unpackedSize !== verdict.unpackedSize) throw new Error("verified archive unpacked size differs from package verdict");

  const fileEvidence = verdict.supportingEvidence.find((entry) => path.posix.basename(entry.path) === "package-files.json");
  if (!fileEvidence) throw new Error("package-files.json evidence is missing");
  let packageFiles;
  try {
    packageFiles = JSON.parse((await readContainedEvidence(repoRoot, fileEvidence.path)).toString("utf8"));
  } catch (error) {
    throw new Error(`package-files.json cannot be parsed: ${error.message}`);
  }
  if (packageFiles?.schemaVersion !== "nodekit.packed-files/v1"
    || packageFiles.name !== archive.name
    || packageFiles.version !== archive.version
    || packageFiles.reproducible !== true
    || JSON.stringify(packageFiles.archiveFiles) !== JSON.stringify(archive.fileManifest)
    || JSON.stringify(packageFiles.files) !== JSON.stringify(archive.fileManifest)) {
    throw new Error("package-files.json does not exactly describe the independently verified archive");
  }
  const archiveManifestSha256 = sha256(Buffer.from(JSON.stringify(archive.fileManifest)));
  if (!Array.isArray(packageFiles.independentPacks)
    || packageFiles.independentPacks.length !== 2
    || !exactSet(packageFiles.independentPacks.map((entry) => entry?.trial), [1, 2])
    || !packageFiles.independentPacks.every((entry) => entry?.tarballSha256 === archive.tarballSha256
      && entry?.archiveBytes === archive.tarballBytes
      && entry?.archiveManifestSha256 === archiveManifestSha256
      && SHA256.test(entry?.packFilesSha256 ?? ""))) {
    throw new Error("package-files.json does not prove two byte-identical independent pack runs");
  }
  if (packageFiles.distribution?.passed !== true
    || JSON.stringify(packageFiles.distribution?.checks) !== JSON.stringify(verdict.distributionChecks)
    || !Array.isArray(packageFiles.distribution?.missingBinTargets)
    || packageFiles.distribution.missingBinTargets.length !== 0
    || !Array.isArray(packageFiles.distribution?.missingExportTargets)
    || packageFiles.distribution.missingExportTargets.length !== 0) {
    throw new Error("package distribution evidence is not identical to the package verdict");
  }

  const packedPaths = new Set(archive.fileManifest.map((entry) => entry.path));
  const exportTargets = packageTargetPaths(archive.packageJson.exports);
  const binTargets = Object.values(archive.packageJson.bin ?? {}).map((target) => String(target).replace(/^\.\//, ""));
  if (exportTargets.length === 0 || binTargets.length === 0) throw new Error("packed package must expose both exports and a CLI binary");
  for (const target of [...new Set([...exportTargets, ...binTargets])]) {
    if (!portableEvidencePath(target) || !packedPaths.has(target)) throw new Error(`packed package target is missing or non-portable: ${target}`);
  }
  return archive;
}

function validateScreenshotSidecar(sidecar, expectation) {
  const screenshot = expectation.screenshot;
  if (sidecar?.schemaVersion !== "nodekit.screenshot-proof/v1"
    || sidecar.state !== screenshot.state
    || sidecar.theme !== screenshot.theme
    || sidecar.viewportId !== screenshot.viewportId
    || sidecar.viewport?.width !== screenshot.viewport.width
    || sidecar.viewport?.height !== screenshot.viewport.height
    || sidecar.pngSha256 !== screenshot.pngSha256
    || sidecar.nodekitCommit !== screenshot.nodekitCommit
    || sidecar.nodekitSourceHash !== screenshot.nodekitSourceHash
    || sidecar.applicationHash !== screenshot.applicationHash
    || sidecar.configHash !== screenshot.configHash
    || sidecar.consoleErrors !== 0
    || sidecar.failedRequests !== 0
    || sidecar.horizontalOverflowPx !== 0
    || sidecar.mojibakeDetected !== false) {
    throw new Error(`browser screenshot sidecar does not match its manifest row: ${expectation.tuple}`);
  }
}

async function validateEngineeringEvidence(reference, bytes, verdict) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`engineering evidence is not JSON: ${reference.path}`);
  }
  if (reference.kind === "engineering-check-receipt") {
    const schemaErrors = await validateSchema("nodekit.engineering-check-receipt.v1.schema.json", value, reference.path);
    if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
    const expected = verdict.commands.find((entry) => entry.path === reference.path);
    if (!expected
      || value.checkId !== expected.id
      || value.command !== ENGINEERING_COMMANDS[expected.id]
      || value.candidateCommit !== verdict.nodekitCommit
      || value.nodekitSourceHash !== verdict.nodekitSourceHash
      || value.exitCode !== 0
      || !validIsoTimestamp(value.startedAt)
      || !validIsoTimestamp(value.completedAt)
      || Date.parse(value.completedAt) < Date.parse(value.startedAt)
      || Date.parse(value.completedAt) > Date.parse(verdict.completedAt)) {
      throw new Error(`engineering check receipt does not match its decisive verdict: ${reference.path}`);
    }
    return;
  }
  if (reference.kind === "engineering-issue-inventory") {
    const schemaErrors = await validateSchema("nodekit.engineering-issue-inventory.v1.schema.json", value, reference.path);
    if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
    const open = value.issues.filter((issue) => issue.status === "open");
    const p0 = open.filter((issue) => issue.severity === "p0").length;
    const p1 = open.filter((issue) => issue.severity === "p1").length;
    if (value.candidateCommit !== verdict.nodekitCommit
      || value.nodekitSourceHash !== verdict.nodekitSourceHash
      || !validIsoTimestamp(value.generatedAt)
      || Date.parse(value.generatedAt) > Date.parse(verdict.completedAt)
      || value.counts.p0 !== p0
      || value.counts.p1 !== p1
      || p0 !== verdict.unresolved.p0
      || p1 !== verdict.unresolved.p1
      || p0 !== 0
      || p1 !== 0) {
      throw new Error("engineering issue inventory does not prove zero unresolved P0/P1 issues");
    }
  }
}

export async function resolveSubmissionEvidenceClosure(repoRoot, gateId, value) {
  const direct = transitiveSubmissionEvidence(gateId, value);
  const queue = [...direct];
  const references = [];
  const paths = new Set();
  const resolvedPaths = new Set();
  const fileIdentities = new Set();
  while (queue.length > 0) {
    const reference = queue.shift();
    if (!portableEvidencePath(reference?.path) || !SHA256.test(reference?.sha256 ?? "")) throw new Error(`invalid evidence reference in ${gateId}: ${reference?.path ?? "missing"}`);
    if (paths.has(reference.path)) throw new Error(`evidence closure reuses path in ${gateId}: ${reference.path}`);
    paths.add(reference.path);
    const record = await readContainedEvidenceRecord(repoRoot, reference.path);
    if (resolvedPaths.has(record.resolved) || fileIdentities.has(record.fileIdentity)) throw new Error(`evidence closure aliases a previously used file in ${gateId}: ${reference.path}`);
    resolvedPaths.add(record.resolved);
    fileIdentities.add(record.fileIdentity);
    const actualHash = sha256(record.bytes);
    if (actualHash !== reference.sha256) throw new Error(`evidence closure hash mismatch in ${gateId}: ${reference.path}`);
    if (Number.isInteger(reference.bytes) && record.bytes.length !== reference.bytes) throw new Error(`evidence closure byte count mismatch in ${gateId}: ${reference.path}`);
    references.push({ path: reference.path, sha256: reference.sha256, ...(Number.isInteger(reference.bytes) ? { bytes: reference.bytes } : {}) });

    if (reference.kind === "screenshot-manifest" && gateId === "previewDeployment") {
      let manifest;
      try { manifest = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`browser screenshot manifest is not JSON: ${reference.path}`); }
      queue.push(...browserManifestChildren(reference.path, manifest));
    } else if (reference.kind === "browser-screenshot-sidecar") {
      let sidecar;
      try { sidecar = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`browser screenshot sidecar is not JSON: ${reference.path}`); }
      validateScreenshotSidecar(sidecar, reference.expectation);
    } else if (gateId === "engineeringHealth" && ["engineering-check-receipt", "engineering-issue-inventory"].includes(reference.kind)) {
      await validateEngineeringEvidence(reference, record.bytes, value);
    }
  }
  return references;
}

export function evidenceContractPasses(gateId, value) {
  switch (gateId) {
    case "developerTimingMatrix": return decisiveDeveloperTiming(value);
    case "freshAgentHeldout": return decisiveFreshAgents(value);
    case "freshHumanUsability": return decisiveFreshHumans(value);
    case "threeConvexConsumers": return decisiveConsumers(value);
    case "previewDeployment": return decisivePreview(value);
    case "managedSupabasePortability": return decisiveManagedSupabase(value);
    case "knowledgeEvolutionAdoption": return decisiveKnowledgeEvolution(value);
    case "modelIntelligenceHarness": return decisiveModelIntelligence(value);
    case "engineeringHealth": return decisiveEngineeringHealth(value);
    case "proofloopEaseVerification": return decisiveProofLoop(value);
    case "packageInstallProof": {
      return value?.schemaVersion === "nodekit.package-install-proof/v1"
        && value.passed === true
        && hasExactIdentity(value)
        && releaseCandidateBinding(value) !== null
        && value.releaseCandidate.packageName === value.package
        && value.releaseCandidate.packageVersion === value.version
        && value.releaseCandidate.nodekitTarballSha256 === value.tarballSha256
        && exactTrueObject(value.checks, PACKAGE_CHECKS)
        && exactTrueObject(value.distributionChecks, PACKAGE_DISTRIBUTION_CHECKS)
        && value.publicationPerformed === false
        && value.deployPerformed === false
        && portableEvidencePath(value.tarball) && value.tarball.endsWith(".tgz")
        && value.tarballBytes > 0 && value.fileCount > 0
        && SHA256.test(value?.tarballSha256 ?? "")
        && Array.isArray(value.supportingEvidence)
        && value.supportingEvidence.length === PACKAGE_SUPPORTING_EVIDENCE_FILES.length
        && exactSet(value.supportingEvidence.map((entry) => path.posix.basename(entry.path ?? "")), PACKAGE_SUPPORTING_EVIDENCE_FILES)
        && new Set(value.supportingEvidence.map((entry) => entry.path)).size === value.supportingEvidence.length
        && value.supportingEvidence.every((entry) => portableEvidencePath(entry.path) && SHA256.test(entry.sha256 ?? ""));
    }
    case "publicationApproval": return value?.schemaVersion === "nodekit.publication-approval/v1"
      && value.approved === true
      && COMMIT.test(value.candidateCommit ?? "")
      && SHA256.test(value.nodekitSourceHash ?? "")
      && value.nodekitIdentity === `${value.candidateCommit}/${value.nodekitSourceHash}`
      && releaseCandidateBinding(value) !== null
      && Array.isArray(value.scopes)
      && value.scopes.includes("npm-publish")
      && value.scopes.includes("convex-directory-submit")
      && typeof value.approvedBy === "string" && value.approvedBy.length > 0
      && validIsoTimestamp(value.approvedAt)
      && value.attestationPayload?.type === "publicationApproval"
      && value.attestationPayload?.candidateCommit === value.releaseCandidate.nodekitCommit
      && value.attestationPayload?.nodekitSourceHash === value.releaseCandidate.nodekitSourceHash
      && value.attestationPayload?.nodekitTarballSha256 === value.releaseCandidate.nodekitTarballSha256
      && exactSet(value.attestationPayload?.scopes, [...value.scopes].sort())
      && portableEvidencePath(value.attestationPayload?.submissionManifest?.path)
      && SHA256.test(value.attestationPayload?.submissionManifest?.sha256 ?? "")
      && value.attestation?.schemaVersion === "nodekit.detached-attestation/v1"
      && value.attestation?.payloadType === "publicationApproval";
    default: return false;
  }
}

export async function evaluateSubmissionManifest(repoRoot, manifestPath = "proof/submission-manifest.json", options = {}) {
  const root = path.resolve(repoRoot);
  const manifestBytes = await readContainedEvidence(root, manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const schemaErrors = await validateSchema("nodekit.submission-manifest.v1.schema.json", manifest, manifestPath);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const errors = [];
  let evidenceRootSha256 = null;
  try {
    evidenceRootSha256 = submissionEvidenceRootSha256(manifest.gates);
    if (manifest.evidenceRootSha256 !== evidenceRootSha256) errors.push(`evidenceRootSha256 does not match the canonical gate evidence root: expected ${evidenceRootSha256}, received ${manifest.evidenceRootSha256}`);
  } catch (error) {
    errors.push(`unable to compute evidenceRootSha256: ${error.message}`);
  }
  if (manifest.releaseCandidate?.nodekitCommit !== manifest.candidateCommit
    || manifest.releaseCandidate?.nodekitSourceHash !== manifest.candidateSourceHash) {
    errors.push("manifest releaseCandidate is not bound to its candidate commit and source hash");
  }
  try {
    const currentSourceHash = await computeNodeKitSourceHash(root);
    if (manifest.candidateSourceHash !== currentSourceHash) errors.push(`candidateSourceHash does not match the distributable source tree: expected ${currentSourceHash}, received ${manifest.candidateSourceHash}`);
  } catch (error) {
    errors.push(`unable to compute candidateSourceHash: ${error.message}`);
  }
  try {
    git(root, ["cat-file", "-e", `${manifest.candidateCommit}^{commit}`]);
    git(root, ["merge-base", "--is-ancestor", manifest.candidateCommit, "HEAD"]);
    const postCandidateChanges = nulPaths(git(root, ["diff", "--name-only", "-z", "--no-renames", `${manifest.candidateCommit}..HEAD`], null));
    const disallowed = postCandidateChanges.filter((file) => !/^(?:proof|docs)\//.test(file.replaceAll("\\", "/")));
    if (disallowed.length > 0) errors.push(`candidateCommit is stale; source changed afterward: ${disallowed.join(", ")}`);
    const dirtyPaths = parseGitStatusZ(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], null));
    const dirtySource = dirtyPaths.filter((file) => !/^(?:proof|docs)\//.test(file));
    if (dirtySource.length > 0) errors.push(`working tree contains uncommitted source changes: ${dirtySource.join(", ")}`);
  } catch (error) {
    errors.push(`candidateCommit or repository state could not be verified for ${manifest.candidateCommit}: ${error.message}`);
  }
  const ids = manifest.gates.map((gate) => gate.id);
  if (ids.join("\n") !== requiredSubmissionGates.join("\n")) errors.push("submission gates are not in canonical order");
  for (const id of requiredSubmissionGates) {
    if (ids.filter((candidate) => candidate === id).length !== 1) errors.push(`${id}: required exactly once`);
  }
  const evidenceHashes = new Map();
  const decisiveByGate = new Map();
  for (const gate of manifest.gates) {
    if (gate.passed !== true) errors.push(`${gate.id}: not passed`);
    const parsedEvidence = [];
    const gatePaths = new Set();
    for (const evidence of gate.evidence) {
      if (gatePaths.has(evidence.path)) errors.push(`${gate.id}: duplicate evidence path: ${evidence.path}`);
      gatePaths.add(evidence.path);
      const priorHash = evidenceHashes.get(evidence.path);
      if (priorHash && priorHash !== evidence.sha256) errors.push(`${gate.id}: evidence path is declared with conflicting hashes: ${evidence.path}`);
      evidenceHashes.set(evidence.path, evidence.sha256);
      try {
        const bytes = await readContainedEvidence(root, evidence.path);
        const actualHash = sha256(bytes);
        if (actualHash !== evidence.sha256) errors.push(`${gate.id}: evidence hash mismatch: ${evidence.path}`);
        try {
          parsedEvidence.push({ evidence, value: JSON.parse(bytes.toString("utf8")), bytes });
        } catch {
          // Binary and non-JSON supporting evidence cannot be a decisive verdict.
        }
      } catch (error) {
        errors.push(`${gate.id}: evidence unavailable: ${evidence.path}: ${error.message}`);
      }
    }
    for (const { evidence, value } of parsedEvidence) {
      const boundCommit = evidenceCandidateCommit(value);
      const boundSourceHash = evidenceSourceHash(value);
      if (boundCommit && boundCommit !== manifest.candidateCommit) errors.push(`${gate.id}: evidence is bound to ${boundCommit}, expected ${manifest.candidateCommit}: ${evidence.path}`);
      if (boundSourceHash && boundSourceHash !== manifest.candidateSourceHash) errors.push(`${gate.id}: evidence source hash is ${boundSourceHash}, expected ${manifest.candidateSourceHash}: ${evidence.path}`);
    }
    const decisive = parsedEvidence.filter(({ value }) => evidenceCandidateCommit(value) === manifest.candidateCommit
      && evidenceSourceHash(value) === manifest.candidateSourceHash
      && evidenceContractPasses(gate.id, value));
    if (decisive.length !== 1) {
      errors.push(`${gate.id}: requires exactly one exact-candidate decisive verdict; found ${decisive.length}`);
      continue;
    }
    decisiveByGate.set(gate.id, decisive[0]);
    const decisiveSchemaErrors = await validateSchema(submissionGateSchemas[gate.id], decisive[0].value, decisive[0].evidence.path);
    for (const schemaError of decisiveSchemaErrors) errors.push(`${gate.id}: decisive verdict schema rejected: ${schemaError}`);
    if (EXTERNALLY_OBSERVED_GATE_TYPES.includes(gate.id) || gate.id === "proofloopEaseVerification" || gate.id === "publicationApproval") {
      const payload = gate.id === "proofloopEaseVerification"
        ? decisive[0].value.extensions.attestationPayload
        : decisive[0].value.attestationPayload;
      const attestation = gate.id === "proofloopEaseVerification"
        ? decisive[0].value.extensions.attestation
        : decisive[0].value.attestation;
      try {
        verifyDetachedAttestation({
          attestation,
          expectedPayloadType: gate.id,
          now: options.now ?? Date.now(),
          payload,
          trustedKeys: options.trustedAttestationKeys,
        });
      } catch (error) {
        errors.push(`${gate.id}: trusted detached attestation failed: ${error.message}`);
      }
    }
    let nested = [];
    try {
      nested = await resolveSubmissionEvidenceClosure(root, gate.id, decisive[0].value);
    } catch (error) {
      errors.push(`${gate.id}: recursive evidence closure failed: ${error.message}`);
      continue;
    }
    const expected = [decisive[0].evidence, ...nested];
    const expectedPaths = new Set();
    for (const reference of expected) {
      if (!portableEvidencePath(reference.path) || !SHA256.test(reference.sha256 ?? "")) {
        errors.push(`${gate.id}: decisive verdict contains an invalid evidence reference: ${reference.path ?? "missing"}`);
        continue;
      }
      if (expectedPaths.has(reference.path)) errors.push(`${gate.id}: decisive verdict reuses evidence path: ${reference.path}`);
      expectedPaths.add(reference.path);
      const declared = gate.evidence.find((entry) => entry.path === reference.path);
      if (!declared) errors.push(`${gate.id}: transitive evidence is missing from the submission manifest: ${reference.path}`);
      else if (declared.sha256 !== reference.sha256) errors.push(`${gate.id}: transitive evidence hash differs from decisive verdict: ${reference.path}`);
      const verified = parsedEvidence.find((entry) => entry.evidence.path === reference.path)
        ?? (await (async () => {
          try {
            const bytes = await readContainedEvidence(root, reference.path);
            return { bytes };
          } catch {
            return null;
          }
        })());
      if (verified && Number.isInteger(reference.bytes) && verified.bytes.length !== reference.bytes) {
        errors.push(`${gate.id}: transitive evidence byte count mismatch: ${reference.path}`);
      }
    }
    for (const evidence of gate.evidence) {
      if (!expectedPaths.has(evidence.path)) errors.push(`${gate.id}: undeclared extra evidence is not part of the decisive evidence set: ${evidence.path}`);
    }
    if (gate.evidence.length !== expected.length) errors.push(`${gate.id}: evidence count mismatch; expected ${expected.length}, received ${gate.evidence.length}`);
    if (gate.id === "developerTimingMatrix") {
      const bundlePath = decisive[0].value.supportingEvidence[0].path;
      try {
        const bundle = JSON.parse((await readContainedEvidence(root, bundlePath)).toString("utf8"));
        const recomputed = evaluateDeveloperTimingMatrix(Array.isArray(bundle) ? bundle : bundle?.runs ?? []);
        const {
          attestation: _attestation,
          attestationPayload: _attestationPayload,
          supportingEvidence: _supportingEvidence,
          releaseCandidate: _releaseCandidate,
          ...decisiveShape
        } = decisive[0].value;
        if (JSON.stringify(decisiveShape) !== JSON.stringify(recomputed)) errors.push(`${gate.id}: timing verdict does not exactly match recomputation from its 60-receipt bundle`);
      } catch (error) {
        errors.push(`${gate.id}: timing receipt bundle cannot be recomputed: ${error.message}`);
      }
    }
    if (gate.id === "packageInstallProof") {
      try {
        await validatePackageArchiveEvidence(root, decisive[0].value);
      } catch (error) {
        errors.push(`${gate.id}: independent npm archive verification failed: ${error.message}`);
      }
    }
  }
  const packageDecision = decisiveByGate.get("packageInstallProof");
  if (packageDecision) {
    const canonicalReleaseKey = releaseCandidateKey(packageDecision.value);
    if (JSON.stringify(manifest.releaseCandidate) !== JSON.stringify(packageDecision.value.releaseCandidate)) {
      errors.push("manifest releaseCandidate differs from packageInstallProof");
    }
    for (const gateId of requiredSubmissionGates) {
      const decision = decisiveByGate.get(gateId);
      if (decision && releaseCandidateKey(decision.value) !== canonicalReleaseKey) {
        errors.push(`${gateId}: release candidate binding differs from packageInstallProof`);
      }
    }
    const consumerDecision = decisiveByGate.get("threeConvexConsumers");
    if (consumerDecision) {
      for (const consumer of consumerDecision.value.consumers ?? []) {
        if (consumer.componentTarballSha256 !== packageDecision.value.tarballSha256) {
          errors.push(`threeConvexConsumers: ${consumer.id} used a different component tarball than packageInstallProof`);
        }
      }
    }
  }
  const proofLoopDecision = decisiveByGate.get("proofloopEaseVerification");
  if (proofLoopDecision) {
    const expectedProofLoopEvidence = [
      ["package", "packageInstallProof"],
      ["timing", "developerTimingMatrix"],
      ["agents", "freshAgentHeldout"],
      ["humans", "freshHumanUsability"],
      ["consumers", "threeConvexConsumers"],
      ["preview", "previewDeployment"],
      ["supabase", "managedSupabasePortability"],
      ["evolution", "knowledgeEvolutionAdoption"],
      ["model", "modelIntelligenceHarness"],
      ["engineering", "engineeringHealth"],
    ].map(([kind, gateId]) => {
      const decision = decisiveByGate.get(gateId);
      return decision ? { kind, path: decision.evidence.path, sha256: decision.evidence.sha256 } : null;
    }).filter(Boolean);
    const previewDecision = decisiveByGate.get("previewDeployment");
    const browserReference = previewDecision?.value?.evidence?.find((entry) => entry.kind === "screenshot-manifest");
    if (browserReference) expectedProofLoopEvidence.push({ kind: "browser", path: browserReference.path, sha256: browserReference.sha256 });
    const actual = proofLoopDecision.value.extensions.decisiveEvidence;
    if (JSON.stringify(actual) !== JSON.stringify(expectedProofLoopEvidence)) {
      errors.push("proofloopEaseVerification: decisive evidence does not exactly reference every verified engineering, package, timing, agent, human, consumer, preview, portability, knowledge, model, and browser gate");
    }
  }
  const publicationDecision = decisiveByGate.get("publicationApproval");
  if (publicationDecision) {
    const candidateReference = publicationDecision.value.attestationPayload?.submissionManifest;
    if (candidateReference?.path !== submissionCandidateEvidencePath) {
      errors.push(`publicationApproval: signed submission candidate path must be ${submissionCandidateEvidencePath}`);
    } else {
      try {
        const candidateBytes = await readContainedEvidence(root, candidateReference.path);
        const candidate = JSON.parse(candidateBytes.toString("utf8"));
        const candidateSchemaErrors = await validateSchema("nodekit.submission-candidate.v1.schema.json", candidate, candidateReference.path);
        if (candidateSchemaErrors.length > 0) throw new Error(candidateSchemaErrors.join("\n"));
        const expected = createSubmissionCandidateRecord({
          candidateCommit: manifest.candidateCommit,
          candidateSourceHash: manifest.candidateSourceHash,
          gates: manifest.gates.filter((gate) => gate.id !== "publicationApproval"),
          releaseCandidate: manifest.releaseCandidate,
        });
        if (JSON.stringify(candidate) !== JSON.stringify(expected)) {
          errors.push(`publicationApproval: externally signed submission candidate does not exactly match the final manifest's ${requiredSubmissionGates.length - 1} pre-approval gates`);
        }
      } catch (error) {
        errors.push(`publicationApproval: signed submission candidate cannot be reconstructed: ${error.message}`);
      }
    }
  }
  const verdict = {
    candidateCommit: manifest.candidateCommit,
    candidateSourceHash: manifest.candidateSourceHash,
    evidenceRootSha256,
    errors,
    manifestSha256: sha256(manifestBytes),
    passed: errors.length === 0,
    releaseCandidate: manifest.releaseCandidate,
    schemaVersion: "nodekit.submission-verdict/v1",
    submissionReady: errors.length === 0,
  };
  return { ...verdict, verdictSha256: sha256(Buffer.from(JSON.stringify(verdict), "utf8")) };
}
