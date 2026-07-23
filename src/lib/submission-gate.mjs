import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import pngjs from "pngjs";
import {
  AGENT_EASE_MAX_RUN_DURATION_MS,
  AGENT_EASE_MEDIAN_RUN_DURATION_MS,
  validateAgentEaseMeasurementVerdict,
  validateAgentEaseTrialManifest,
  validateLowerCostEvidence,
  validateOfficialPricingSnapshot,
  validateProtectedAgentEvaluation,
  validateVisualReviewInventory,
} from "./agent-ease-campaign.mjs";
import { evaluateDeveloperTimingMatrix } from "./ease-evidence.mjs";
import { runProtectedKnowledgeComparison } from "./knowledge-comparison.mjs";
import { knowledgeRuntimeHash } from "./knowledge-runtime.mjs";
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
  "browser-certification", "screenshot-manifest", "protected-evaluation", "evaluator-screenshot", "visual-review-inventory",
];
const AGENT_EVIDENCE_PATHS = Object.freeze({
  prompt: "agent/original-prompt.txt",
  "prompt-hash": "agent/prompt.sha256",
  environment: "agent/environment.json",
  interventions: "agent/interventions.json",
  session: "agent/session.jsonl",
  "final-report": "agent/final-report.md",
  stderr: "agent/stderr.txt",
  "token-usage": "agent/token-usage.json",
  "command-ledger": "commands.jsonl",
  "candidate-diff": "candidate/diff.patch",
  "candidate-status": "candidate/git-status.txt",
  "candidate-commit": "candidate/commit.txt",
  "application-identity": "candidate/application-identity.json",
  "candidate-archive": "candidate/generated-repo.tar.gz",
  "browser-certification": "candidate/browser-certification.json",
  "screenshot-manifest": "candidate/browser/screenshot-manifest.json",
  "protected-evaluation": "evaluator/protected-task-evaluation.json",
  "evaluator-screenshot": "evaluator/task-relevance.png",
  "visual-review-inventory": "evaluator/visual-review-inventory.json",
});
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
  "postgres-conformance", "auth-rls-report", "storage-roundtrip", "realtime-delivery", "queue-report", "cron-report",
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
  "builderGymRuntime", "candidateIdentityStable", "consumerPrepareBinRuntime", "convexComponentRuntime",
  "evidenceFinalizeBinRuntime", "freshConsumerInstall", "packagedCliCreate",
  "generatedAppInstall", "compile", "check", "demo", "eval", "typecheckPublic", "receiptsValid",
  "tarballHashStable", "distributionComplete",
];
const PACKAGE_DISTRIBUTION_CHECKS = [
  "attestationSignBin", "attestationVerifyBin", "builderGym", "caseflowTypes",
  "consumerPackagePreparation", "consumerPrepareBin", "convexClient", "convexConfig",
  "convexComponentApi", "convexComponentRuntime", "convexTestExport", "postgresAdapter",
  "postgresMigration", "evidenceFinalizeBin", "packageMetadata", "submissionAttestation",
  "submissionEvidenceFinalizer", "skillEvaluation", "supabaseProfile", "supabaseWorkers",
];
const PACKAGE_SUPPORTING_EVIDENCE_FILES = [
  "application-identity.json", "demo-receipt.json", "eval-receipt.json", "convex-runtime-proof.mjs",
  "command-ledger.json", "package-files.json", "public-api.ts", "convex-runtime-proof.json",
  "builder-gym-runtime-proof.json", "installed-cli-help-proof.json",
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

function freshAgentRepositoryEvidenceRoot(entry) {
  if (!entry || !portableEvidencePath(entry.manifestPath) || !COMMIT.test(entry.nodekitCommit ?? "")) return null;
  const segments = entry.manifestPath.split("/");
  if (segments.length !== 8
    || segments[0] !== "proof"
    || segments[1] !== "ease"
    || segments[2] !== "agent-campaigns"
    || segments[3] !== entry.nodekitCommit
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segments[4] ?? "")
    || segments[5] !== "runs"
    || segments[6] !== entry.runId
    || segments[7] !== "manifest.json"
    || !String(entry.runId ?? "").startsWith(`${segments[4]}_`)) {
    return null;
  }
  return segments.slice(0, -1).join("/");
}

function freshAgentCampaignEvidenceRoot(entry) {
  const runRoot = freshAgentRepositoryEvidenceRoot(entry);
  if (runRoot === null) return null;
  const suffix = `/runs/${entry.runId}`;
  return runRoot.endsWith(suffix) ? runRoot.slice(0, -suffix.length) : null;
}

function decisiveLowerCostPricing(value, selected) {
  const pricing = value?.lowerCostPricingEvidence;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing) || !Array.isArray(selected)) return false;
  const campaignRoots = new Set(selected.map(freshAgentCampaignEvidenceRoot));
  const lowerCostRuns = selected.filter((entry) => entry?.agentProfile === "lower-cost");
  const validation = pricing.pricingValidation;
  if (campaignRoots.size !== 1 || campaignRoots.has(null)) return false;
  const [campaignRoot] = campaignRoots;
  return pricing.schemaVersion === "nodekit.lower-cost-pricing-binding/v1"
    && new Set(["codex", "claude-code"]).has(pricing.agentDriver)
    && typeof pricing.model === "string" && pricing.model.trim().length > 0
    && pricing.evidencePath === `${campaignRoot}/inputs/lower-cost-model-evidence.json`
    && pricing.snapshotPath === `${campaignRoot}/inputs/lower-cost-source.snapshot.json`
    && pricing.evidencePath !== pricing.snapshotPath
    && SHA256.test(pricing.evidenceSha256 ?? "")
    && SHA256.test(pricing.snapshotSha256 ?? "")
    && lowerCostRuns.length === AGENT_TASKS.length
    && lowerCostRuns.every((entry) => entry.agentDriver === pricing.agentDriver && entry.agentModel === pricing.model)
    && validation && typeof validation === "object" && !Array.isArray(validation)
    && Number.isFinite(validation.ageMs) && validation.ageMs >= -600_000
    && validIsoTimestamp(validation.retrievedAt)
    && validIsoTimestamp(validation.validatedAt)
    && Date.parse(validation.validatedAt) >= Date.parse(validation.retrievedAt) - 600_000
    && typeof validation.source === "string" && validation.source.startsWith("https://")
    && Array.isArray(validation.verifiedModels)
    && new Set(validation.verifiedModels).size === validation.verifiedModels.length
    && validation.verifiedModels.length >= 2
    && validation.verifiedModels.includes(pricing.model);
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
  const durations = Array.isArray(selected) ? selected.map((entry) => entry?.durationMs).sort((left, right) => left - right) : [];
  const medianDurationMs = durations.length === 15 ? durations[7] : null;
  const maxDurationMs = durations.length === 15 ? durations.at(-1) : null;
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
    && value.combinedZeroToAppClaim === true
    && value.emptyDirectoryAgentCliRuns === 1
    && value.failedTrials === 0
    && externalGateAttestationContract(value, "freshAgentHeldout")
    && Object.keys(value.requiredProfiles ?? {}).length === Object.keys(AGENT_PROFILE_COUNTS).length
    && Object.entries(AGENT_PROFILE_COUNTS).every(([profile, count]) => value.requiredProfiles?.[profile] === count)
    && exactSet(value.requiredTasks, AGENT_TASKS)
    && Array.isArray(selected)
    && selected.length === 15
    && durations.every((duration) => Number.isInteger(duration) && duration >= 0 && duration <= AGENT_EASE_MAX_RUN_DURATION_MS)
    && value.timing?.schemaVersion === "nodekit.fresh-agent-timing/v1"
    && value.timing?.thresholds?.maxRunMs === AGENT_EASE_MAX_RUN_DURATION_MS
    && value.timing?.thresholds?.medianRunMs === AGENT_EASE_MEDIAN_RUN_DURATION_MS
    && value.timing?.observed?.maxRunMs === maxDurationMs
    && value.timing?.observed?.medianRunMs === medianDurationMs
    && medianDurationMs <= AGENT_EASE_MEDIAN_RUN_DURATION_MS
    && decisiveLowerCostPricing(value, selected)
    && new Set(selected.map((entry) => entry.runId)).size === 15
    && new Set(selected.map((entry) => entry.agentSessionId)).size === 15
    && new Set(selected.map((entry) => entry.manifestSha256)).size === 15
    && new Set(selected.map((entry) => entry.receiptSha256)).size === 15
    && new Set(selected.map((entry) => entry.protectedEvaluationSha256)).size === 15
    && new Set(selected.map((entry) => entry.evaluatorScreenshotSha256)).size === 15
    && new Set(selected.map((entry) => entry.visualReviewInventorySha256)).size === 15
    && new Set(selected.map((entry) => entry.taskSetSha256)).size === 1
    && new Set(selected.map((entry) => entry.trialRunnerSha256)).size === 1
    && new Set(selected.map((entry) => entry.protectedEvaluatorSha256)).size === 1
    && new Set(selected.map((entry) => entry.protectedBrowserLaneSha256)).size === 1
    && new Set(selected.map((entry) => entry.providerBrokerSha256)).size === 1
    && new Set(selected.map((entry) => entry.protectedContainerImage)).size === 1
    && new Set(selected.map((entry) => entry.protectedContainerImageId)).size === 1
    && new Set(selected.map((entry) => entry.protectedIsolationSha256)).size === 15
    && new Set(selected.map((entry) => entry.agentContainerImage)).size === 1
    && new Set(selected.map((entry) => entry.agentContainerImageId)).size === 1
    && new Set(selected.map((entry) => entry.agentProcessIsolationSha256)).size === 15
    && new Set(selected.map((entry) => entry.agentInstructionPolicySha256)).size === 15
    && selected.filter((entry) => entry.bootstrapMode === "agent-process-packed-cli-from-empty").length === 1
    && selected.filter((entry) => entry.bootstrapMode === "pre-scaffolded-packed-cli").length === 14
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
        && COMMIT.test(entry.postAgentTreeHash ?? "")
        && SHA256.test(entry.candidateArchiveSha256 ?? "")
        && entry.evidence?.find((item) => item.kind === "candidate-archive")?.sha256 === entry.candidateArchiveSha256
        && SHA256.test(entry.taskSetSha256 ?? "")
        && SHA256.test(entry.trialRunnerSha256 ?? "")
        && SHA256.test(entry.protectedEvaluatorSha256 ?? "")
        && SHA256.test(entry.protectedBrowserLaneSha256 ?? "")
        && SHA256.test(entry.providerBrokerSha256 ?? "")
        && typeof entry.protectedContainerImage === "string" && entry.protectedContainerImage.length > 0
        && /^sha256:[a-f0-9]{64}$/.test(entry.protectedContainerImageId ?? "")
        && SHA256.test(entry.protectedIsolationSha256 ?? "")
        && typeof entry.agentContainerImage === "string" && entry.agentContainerImage.length > 0
        && /^sha256:[a-f0-9]{64}$/.test(entry.agentContainerImageId ?? "")
        && SHA256.test(entry.agentCommandSha256 ?? "")
        && SHA256.test(entry.agentProcessIsolationSha256 ?? "")
        && SHA256.test(entry.agentInstructionPolicySha256 ?? "")
        && SHA256.test(entry.agentBootstrapSha256 ?? "")
        && SHA256.test(entry.protectedEvaluationSha256 ?? "")
        && SHA256.test(entry.evaluatorScreenshotSha256 ?? "")
        && SHA256.test(entry.visualReviewInventorySha256 ?? "")
        && SHA256.test(entry.screenshotEvidenceRootSha256 ?? "")
        && entry.evidence?.find((item) => item.kind === "protected-evaluation")?.sha256 === entry.protectedEvaluationSha256
        && entry.evidence?.find((item) => item.kind === "evaluator-screenshot")?.sha256 === entry.evaluatorScreenshotSha256
        && entry.evidence?.find((item) => item.kind === "visual-review-inventory")?.sha256 === entry.visualReviewInventorySha256
        && entry.freshSession === true
        && typeof entry.agentSessionId === "string" && entry.agentSessionId.trim().length > 0
        && entry.passed === true
        && entry.validationPassed === true
        && typeof entry.agentVersion === "string" && entry.agentVersion.trim().length > 0
        && ((entry.agentProfile === "codex" && entry.agentDriver === "codex")
          || (entry.agentProfile === "claude-code" && entry.agentDriver === "claude-code")
          || (entry.agentProfile === "lower-cost" && new Set(["codex", "claude-code"]).has(entry.agentDriver)))
        && typeof entry.agentModel === "string" && entry.agentModel.trim().length > 0
        && /^\d{4}-\d{2}-\d{2}T/.test(entry.trialStartedAt ?? "")
        && /^\d{4}-\d{2}-\d{2}T/.test(entry.generatedAt ?? "")
        && freshAgentRepositoryEvidenceRoot(entry) !== null
        && SHA256.test(entry.promptSha256 ?? "")
        && SHA256.test(entry.receiptSha256 ?? "")
        && SHA256.test(entry.manifestSha256 ?? "")
        && SHA256.test(entry.evidenceSetSha256 ?? "")
        && entry.evidenceCount === AGENT_EVIDENCE_KINDS.length
        && Array.isArray(evidence)
        && exactSet(evidence.map((item) => item.kind), AGENT_EVIDENCE_KINDS)
        && new Set(evidence.map((item) => item.path)).size === evidence.length
        && evidence.every((item) => item.path === `${freshAgentRepositoryEvidenceRoot(entry)}/${AGENT_EVIDENCE_PATHS[item.kind]}`)
        && evidence.every((item) => Number.isInteger(item.bytes) && item.bytes >= 0
          && portableEvidencePath(item.path)
          && item.path.startsWith(`${freshAgentRepositoryEvidenceRoot(entry)}/`)
          && SHA256.test(item.sha256 ?? ""))
        && entry.evidenceSetSha256 === sha256(JSON.stringify(evidence));
    });
}

function decisiveFreshHumans(value) {
  const selected = value?.selectedParticipants;
  if (!Array.isArray(selected) || selected.length !== 5) return false;
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
  const postgres = value?.postgresConformance;
  const postgresEvidence = value?.evidence?.find((item) => item.kind === "postgres-conformance");
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
    && postgres?.schemaVersion === "nodekit.postgres-conformance/v2"
    && portableEvidencePath(postgres?.path)
    && SHA256.test(postgres?.sha256 ?? "")
    && Number.isInteger(postgres?.serverVersionNum) && postgres.serverVersionNum >= 120000
    && postgres?.exactPackageInstalled === true
    && postgres?.passed === true
    && postgresEvidence?.path === postgres.path
    && postgresEvidence?.sha256 === postgres.sha256
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

// Node defaults execFileSync to a 1 MB buffer. Git plumbing over a large or dirty
// working tree overflows that and throws ENOBUFS, which would fail the submission
// gate for tree size rather than for a real evidence problem. Bound it explicitly,
// matching consumer-package-preparation.mjs and managed-evidence-capture.mjs.
function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: repoRoot, encoding, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
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

const MEBIBYTE = 1024 * 1024;
const MAX_EVIDENCE_FILE_BYTES = 32 * MEBIBYTE;
const MAX_STRUCTURED_EVIDENCE_BYTES = 16 * MEBIBYTE;
const MAX_CANDIDATE_ARCHIVE_BYTES = 256 * MEBIBYTE;
const MAX_SCREENSHOT_PNG_BYTES = 25 * MEBIBYTE;
const MAX_SCREENSHOT_SIDECAR_BYTES = 1 * MEBIBYTE;
const MAX_SCREENSHOT_MANIFEST_BYTES = 4 * MEBIBYTE;
const MAX_BROWSER_ARTIFACT_BYTES = 128 * MEBIBYTE;
const MAX_BROWSER_MANIFEST_CLOSURE_BYTES = 512 * MEBIBYTE;
const MAX_GATE_EVIDENCE_CLOSURE_BYTES = 1024 * MEBIBYTE;

async function readContainedEvidenceRecord(repoRoot, evidencePath, { maxBytes = MAX_EVIDENCE_FILE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_CANDIDATE_ARCHIVE_BYTES) {
    throw new Error(`invalid evidence verifier byte limit for ${evidencePath}`);
  }
  if (!portableEvidencePath(evidencePath)) throw new Error(`evidence path is not a portable repository-relative path: ${evidencePath}`);
  const root = await realpath(repoRoot);
  const absolute = path.resolve(root, evidencePath);
  if (!contained(root, absolute)) throw new Error(`evidence escapes repository: ${evidencePath}`);
  let cursor = root;
  for (const segment of evidencePath.split("/")) {
    cursor = path.join(cursor, segment);
    const component = await lstat(cursor, { bigint: true });
    if (component.isSymbolicLink()) throw new Error(`evidence traverses a symlink or junction: ${evidencePath}`);
  }
  // Keep filesystem identity lossless. On Windows, NTFS file identifiers can
  // exceed Number.MAX_SAFE_INTEGER, so every comparison remains BigInt.
  const pathBefore = await lstat(absolute, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n) {
    throw new Error(`evidence is not one regular unaliased non-symlink file: ${evidencePath}`);
  }
  if (pathBefore.size > BigInt(maxBytes)) throw new Error(`evidence exceeds the ${maxBytes}-byte verifier limit: ${evidencePath}`);
  const resolvedBefore = await realpath(absolute);
  if (!contained(root, resolvedBefore)) throw new Error(`evidence symlink escapes repository: ${evidencePath}`);
  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    try { handle = await open(absolute, fsConstants.O_RDONLY | noFollow); }
    catch (error) {
      if (!noFollow || !["EINVAL", "ENOTSUP", "UNKNOWN"].includes(error?.code)) throw error;
      handle = await open(absolute, "r");
    }
    const openedBefore = await handle.stat({ bigint: true });
    const sameIdentity = (left, right) => left.ino > 0n && right.ino > 0n
      ? left.dev === right.dev && left.ino === right.ino
      : left.size === right.size && left.mtimeNs === right.mtimeNs && left.birthtimeNs === right.birthtimeNs;
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n || !sameIdentity(pathBefore, openedBefore)) {
      throw new Error(`evidence identity changed before stable open: ${evidencePath}`);
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    const resolvedAfter = await realpath(absolute);
    if (openedAfter.nlink !== 1n || pathAfter.nlink !== 1n
      || !sameIdentity(openedBefore, openedAfter) || !sameIdentity(openedAfter, pathAfter)
      || openedBefore.size !== openedAfter.size || openedBefore.mtimeNs !== openedAfter.mtimeNs || openedBefore.ctimeNs !== openedAfter.ctimeNs
      || resolvedBefore !== resolvedAfter || bytes.length !== Number(openedAfter.size)) {
      throw new Error(`evidence identity changed during stable read: ${evidencePath}`);
    }
    return {
      bytes,
      fileIdentity: openedAfter.ino > 0n
        ? `${openedAfter.dev}:${openedAfter.ino}`
        : `path:${process.platform === "win32" ? resolvedAfter.toLowerCase() : resolvedAfter}`,
      resolved: resolvedAfter,
    };
  } finally {
    await handle?.close().catch(() => {});
  }
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
      return [
        ...(value?.lowerCostPricingEvidence ? [
          { kind: "lower-cost-evidence", path: value.lowerCostPricingEvidence.evidencePath, sha256: value.lowerCostPricingEvidence.evidenceSha256 },
          { kind: "lower-cost-snapshot", path: value.lowerCostPricingEvidence.snapshotPath, sha256: value.lowerCostPricingEvidence.snapshotSha256 },
        ] : []),
        ...((value?.selectedRuns?.length ?? 0) > 0 ? [
          { kind: "agent-task-set", path: "evals/ease/heldout-tasks.json", sha256: value.selectedRuns[0].taskSetSha256 },
          { kind: "agent-trial-runner", path: "scripts/run-agent-ease-trial.mjs", sha256: value.selectedRuns[0].trialRunnerSha256 },
          { kind: "agent-protected-evaluator", path: "scripts/run-protected-agent-evaluator.mjs", sha256: value.selectedRuns[0].protectedEvaluatorSha256 },
          { kind: "agent-protected-browser-lane", path: "scripts/run-protected-browser-lane.mjs", sha256: value.selectedRuns[0].protectedBrowserLaneSha256 },
          { kind: "agent-provider-broker", path: "scripts/run-agent-provider-broker.mjs", sha256: value.selectedRuns[0].providerBrokerSha256 },
        ] : []),
        ...(value?.selectedRuns ?? []).flatMap((run) => [
        { kind: "agent-trial-manifest", path: run.manifestPath, sha256: run.manifestSha256 },
        ...(run.evidence ?? []).map(evidenceRef),
        ]),
      ];
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

function protectedBrowserEvidenceRoot(manifestPath) {
  const suffix = "protected-browser/screenshot-manifest.json";
  if (!manifestPath.endsWith(suffix)) {
    throw new Error(`protected screenshot manifest must end with ${suffix}: ${manifestPath}`);
  }
  return manifestPath.slice(0, -suffix.length);
}

function protectedBrowserChildPath(root, childPath) {
  if (!portableEvidencePath(childPath) || !childPath.startsWith("protected-browser/")) {
    throw new Error(`protected browser manifest child is not a canonical evaluator-relative path: ${childPath ?? "missing"}`);
  }
  const joined = `${root}${childPath}`;
  if (!portableEvidencePath(joined)) throw new Error(`protected browser manifest child resolves to an invalid evidence path: ${joined}`);
  return joined;
}

function browserManifestChildren(manifestPath, manifest) {
  if (manifest?.schemaVersion !== "nodekit.browser-certification/v1") throw new Error("screenshot manifest is not a NodeKit browser certification manifest");
  if (manifest.passed !== true || manifest.certified !== true || manifest.verdict !== "BROWSER_CERTIFIED") throw new Error("browser certification manifest is not certified");
  if (!hasExactIdentity(manifest)) throw new Error("browser certification manifest is missing exact NodeKit identity");
  if (!SHA256.test(manifest.applicationHash ?? "") || !SHA256.test(manifest.configHash ?? "")) throw new Error("browser certification manifest is missing application identity");
  if (!SHA256.test(manifest.nodekitTarballSha256 ?? "") || manifest.nodekitSourceBound !== true || manifest.nodekitTarballBound !== true) {
    throw new Error("browser certification manifest is not bound to the exact NodeKit source and tarball");
  }
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
  let declaredClosureBytes = 0;
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
    if (!Number.isInteger(screenshot.pngBytes) || screenshot.pngBytes <= 0 || screenshot.pngBytes > MAX_SCREENSHOT_PNG_BYTES
      || !Number.isInteger(screenshot.sidecarBytes) || screenshot.sidecarBytes <= 0 || screenshot.sidecarBytes > MAX_SCREENSHOT_SIDECAR_BYTES) {
      throw new Error(`browser certification screenshot byte counts exceed verifier bounds for ${tuple}`);
    }
    declaredClosureBytes += screenshot.pngBytes + screenshot.sidecarBytes;
    if (screenshot.consoleErrors !== 0 || screenshot.failedRequests !== 0 || screenshot.horizontalOverflowPx !== 0 || screenshot.mojibakeDetected !== false) throw new Error(`browser certification screenshot health failed for ${tuple}`);
    if (screenshot.nodekitCommit !== manifest.nodekitCommit
      || screenshot.nodekitSourceHash !== manifest.nodekitSourceHash
      || screenshot.nodekitIdentity !== manifest.nodekitIdentity
      || screenshot.nodekitTarballSha256 !== manifest.nodekitTarballSha256
      || screenshot.nodekitSourceBound !== true
      || screenshot.nodekitTarballBound !== true
      || screenshot.applicationHash !== manifest.applicationHash
      || screenshot.configHash !== manifest.configHash
      || screenshot.runId !== manifest.runId
      || screenshot.postAgentTreeHash !== manifest.postAgentTreeHash
      || screenshot.generatedCandidateCommit !== manifest.generatedCandidateCommit) {
      throw new Error(`browser certification screenshot identity drifted for ${tuple}`);
    }
    if (screenshotHashes.has(screenshot.pngSha256) || screenshotHashes.has(screenshot.sidecarSha256)) throw new Error(`browser certification reuses screenshot evidence bytes for ${tuple}`);
    screenshotHashes.add(screenshot.pngSha256);
    screenshotHashes.add(screenshot.sidecarSha256);
    for (const childPath of [expectedPng, expectedSidecar]) {
      if (childPaths.has(childPath)) throw new Error(`browser certification reuses child path: ${childPath}`);
      childPaths.add(childPath);
    }
    children.push({
      bytes: screenshot.pngBytes,
      expectation: { manifestPath, screenshot, tuple },
      kind: "browser-screenshot",
      path: browserChildPath(root, expectedPng),
      sha256: screenshot.pngSha256,
    });
    children.push({
      bytes: screenshot.sidecarBytes,
      expectation: { manifestPath, screenshot, tuple },
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
    if (!SHA256.test(artifact?.sha256 ?? "") || !Number.isInteger(artifact?.byteSize)
      || artifact.byteSize < 0 || artifact.byteSize > MAX_BROWSER_ARTIFACT_BYTES) {
      throw new Error(`browser certification artifact metadata exceeds verifier bounds: ${artifact?.id ?? "missing"}`);
    }
    declaredClosureBytes += artifact.byteSize;
    if (childPaths.has(artifact.path)) throw new Error(`browser certification reuses child path: ${artifact.path}`);
    childPaths.add(artifact.path);
    children.push({ bytes: artifact.byteSize, kind: `browser-artifact:${artifact.id}`, path: browserChildPath(root, artifact.path), sha256: artifact.sha256 });
  }
  if (declaredClosureBytes > MAX_BROWSER_MANIFEST_CLOSURE_BYTES) {
    throw new Error(`browser certification declares more than ${MAX_BROWSER_MANIFEST_CLOSURE_BYTES} bytes of transitive evidence`);
  }
  return children;
}

function validateProtectedAxeEvidence(accessibility, label, { aggregate = false } = {}) {
  if (!accessibility || typeof accessibility !== "object" || Array.isArray(accessibility)
    || accessibility.engine !== "axe-core"
    || accessibility.engineVersion !== "4.12.1"
    || accessibility.policy !== "serious-critical-zero"
    || accessibility.passed !== true
    || accessibility.seriousCriticalViolations !== 0
    || !accessibility.violationCounts || typeof accessibility.violationCounts !== "object"
    || !exactSet(Object.keys(accessibility.violationCounts), ["critical", "serious", "moderate", "minor", "unknown"])
    || Object.values(accessibility.violationCounts).some((count) => !Number.isInteger(count) || count < 0)
    || accessibility.violationCounts.critical !== 0
    || accessibility.violationCounts.serious !== 0
    || !Number.isInteger(accessibility.totalViolations) || accessibility.totalViolations < 0
    || accessibility.totalViolations !== Object.values(accessibility.violationCounts).reduce((total, count) => total + count, 0)
    || (aggregate && accessibility.scans !== 180)
    || (!aggregate && accessibility.scans !== undefined)) {
    throw new Error(`protected Axe evidence is malformed or failed for ${label}`);
  }
  if (!aggregate) {
    if (!Array.isArray(accessibility.violations)
      || accessibility.violations.some((violation) => !violation || typeof violation.id !== "string" || violation.id.length === 0
        || !new Set(["moderate", "minor", "unknown"]).has(violation.impact)
        || !Number.isInteger(violation.nodeCount) || violation.nodeCount < 1)) {
      throw new Error(`protected Axe violation details are malformed for ${label}`);
    }
    const observedCounts = Object.fromEntries(["critical", "serious", "moderate", "minor", "unknown"]
      .map((impact) => [impact, accessibility.violations.filter((violation) => violation.impact === impact).length]));
    if (accessibility.violations.length !== accessibility.totalViolations
      || JSON.stringify(observedCounts) !== JSON.stringify(accessibility.violationCounts)) {
      throw new Error(`protected Axe violation counts do not reconcile for ${label}`);
    }
  }
}

function protectedBrowserManifestChildren(manifestPath, manifest, run, certificationRunId) {
  if (typeof certificationRunId !== "string" || !certificationRunId.startsWith("cert_")
    || certificationRunId === run.runId) {
    throw new Error(`protected browser certification identity is invalid for ${run.runId}`);
  }
  if (manifest?.schemaVersion !== "nodekit.protected-browser-screenshot-manifest/v1"
    || manifest.passed !== true || manifest.certified !== true
    || manifest.runId !== certificationRunId || manifest.taskId !== run.taskId
    || manifest.candidateArchiveSha256 !== run.candidateArchiveSha256) {
    throw new Error(`protected browser manifest identity or verdict is invalid for ${run.runId}`);
  }
  if (manifest.producer?.authority !== "campaign-protected-browser"
    || manifest.producer?.candidateHostAccess !== false
    || manifest.producer?.candidateWriteAccess !== false
    || manifest.producer?.externalNetworkEgress !== false) {
    throw new Error(`protected browser manifest lacks independent producer provenance for ${run.runId}`);
  }
  if (!exactSet(manifest.certificationScope, [
    "rendered-state-coverage", "console-health", "request-health", "horizontal-overflow", "mojibake", "axe-serious-critical",
  ])) throw new Error(`protected browser certification scope is incomplete for ${run.runId}`);
  if (Object.hasOwn(manifest, "accessibilityViolations")) {
    throw new Error(`protected browser manifest uses the unaudited legacy accessibility field for ${run.runId}`);
  }
  validateProtectedAxeEvidence(manifest.accessibilityAudit, `${run.runId} aggregate`, { aggregate: true });
  if (!exactSet(manifest.requiredStates, BROWSER_STATES) || !exactSet(manifest.coveredStates, BROWSER_STATES)
    || !exactSet(manifest.themes, BROWSER_THEMES)
    || !Array.isArray(manifest.consoleErrors) || manifest.consoleErrors.length !== 0
    || !Array.isArray(manifest.networkFailures) || manifest.networkFailures.length !== 0) {
    throw new Error(`protected browser manifest coverage or health is incomplete for ${run.runId}`);
  }
  if (!Array.isArray(manifest.viewports)
    || manifest.viewports.length !== Object.keys(BROWSER_VIEWPORTS).length
    || manifest.viewports.some((viewport) => !BROWSER_VIEWPORTS[viewport?.id]
      || viewport.width !== BROWSER_VIEWPORTS[viewport.id].width
      || viewport.height !== BROWSER_VIEWPORTS[viewport.id].height)) {
    throw new Error(`protected browser manifest viewport contract drifted for ${run.runId}`);
  }
  const manifestForHash = { ...manifest };
  delete manifestForHash.manifestSha256;
  if (!SHA256.test(manifest.manifestSha256 ?? "")
    || manifest.manifestSha256 !== sha256(Buffer.from(JSON.stringify(manifestForHash)))) {
    throw new Error(`protected browser manifest self-hash is invalid for ${run.runId}`);
  }

  const root = protectedBrowserEvidenceRoot(manifestPath);
  const expectedCount = BROWSER_STATES.length * Object.keys(BROWSER_VIEWPORTS).length * BROWSER_THEMES.length;
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== expectedCount) {
    throw new Error(`protected browser manifest requires exactly ${expectedCount} screenshots for ${run.runId}`);
  }
  const tuples = new Set();
  const childPaths = new Set();
  const screenshotHashes = new Set();
  const children = [];
  const observedAccessibilityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  let declaredClosureBytes = 0;
  for (const screenshot of manifest.screenshots) {
    const viewport = BROWSER_VIEWPORTS[screenshot?.viewportId];
    const tuple = `${screenshot?.state}/${screenshot?.viewportId}/${screenshot?.theme}`;
    if (!BROWSER_STATES.includes(screenshot?.state) || !viewport || !BROWSER_THEMES.includes(screenshot?.theme) || tuples.has(tuple)) {
      throw new Error(`protected browser manifest has an unexpected or repeated tuple: ${tuple}`);
    }
    tuples.add(tuple);
    const expectedPng = `protected-browser/screenshots/${screenshot.state}--${screenshot.viewportId}--${screenshot.theme}.png`;
    const expectedSidecar = expectedPng.replace(/\.png$/u, ".json");
    if (screenshot.path !== expectedPng || screenshot.sidecarPath !== expectedSidecar
      || screenshot.viewport?.width !== viewport.width || screenshot.viewport?.height !== viewport.height
      || screenshot.runId !== certificationRunId || screenshot.taskId !== run.taskId
      || screenshot.candidateArchiveSha256 !== run.candidateArchiveSha256
      || screenshot.authority !== "campaign-protected-browser"
      || screenshot.consoleErrors !== 0 || screenshot.failedRequests !== 0
      || screenshot.horizontalOverflowPx !== 0 || screenshot.mojibakeDetected !== false
      || !SHA256.test(screenshot.pngSha256 ?? "") || !SHA256.test(screenshot.sidecarSha256 ?? "")) {
      throw new Error(`protected browser screenshot metadata drifted for ${tuple}`);
    }
    validateProtectedAxeEvidence(screenshot.accessibility, tuple);
    for (const impact of Object.keys(observedAccessibilityCounts)) {
      observedAccessibilityCounts[impact] += screenshot.accessibility.violationCounts[impact];
    }
    if (!Number.isInteger(screenshot.pngBytes) || screenshot.pngBytes <= 0 || screenshot.pngBytes > MAX_SCREENSHOT_PNG_BYTES
      || !Number.isInteger(screenshot.sidecarBytes) || screenshot.sidecarBytes <= 0 || screenshot.sidecarBytes > MAX_SCREENSHOT_SIDECAR_BYTES) {
      throw new Error(`protected browser screenshot byte counts exceed verifier bounds for ${tuple}`);
    }
    declaredClosureBytes += screenshot.pngBytes + screenshot.sidecarBytes;
    if (screenshotHashes.has(screenshot.pngSha256) || screenshotHashes.has(screenshot.sidecarSha256)) {
      throw new Error(`protected browser manifest reuses screenshot evidence bytes for ${tuple}`);
    }
    screenshotHashes.add(screenshot.pngSha256);
    screenshotHashes.add(screenshot.sidecarSha256);
    for (const childPath of [expectedPng, expectedSidecar]) {
      if (childPaths.has(childPath)) throw new Error(`protected browser manifest reuses child path: ${childPath}`);
      childPaths.add(childPath);
    }
    children.push({
      bytes: screenshot.pngBytes,
      expectation: { manifestPath, protected: true, screenshot, tuple },
      kind: "protected-browser-screenshot",
      path: protectedBrowserChildPath(root, expectedPng),
      sha256: screenshot.pngSha256,
    });
    children.push({
      bytes: screenshot.sidecarBytes,
      expectation: { manifestPath, protected: true, screenshot, tuple },
      kind: "protected-browser-screenshot-sidecar",
      path: protectedBrowserChildPath(root, expectedSidecar),
      sha256: screenshot.sidecarSha256,
    });
  }
  if (tuples.size !== expectedCount) throw new Error(`protected browser screenshot tuple matrix is incomplete for ${run.runId}`);
  if (JSON.stringify(observedAccessibilityCounts) !== JSON.stringify(manifest.accessibilityAudit.violationCounts)
    || Object.values(observedAccessibilityCounts).reduce((total, count) => total + count, 0) !== manifest.accessibilityAudit.totalViolations) {
    throw new Error(`protected Axe aggregate does not reconcile with all 180 states for ${run.runId}`);
  }
  if (declaredClosureBytes > MAX_BROWSER_MANIFEST_CLOSURE_BYTES) {
    throw new Error(`protected browser manifest declares more than ${MAX_BROWSER_MANIFEST_CLOSURE_BYTES} bytes for ${run.runId}`);
  }
  if (manifest.screenshotEvidenceRootSha256 !== browserScreenshotEvidenceRoot(manifest)) {
    throw new Error(`protected browser screenshot root is invalid for ${run.runId}`);
  }
  return children;
}

function browserScreenshotEvidenceRoot(manifest) {
  const records = (manifest?.screenshots ?? []).map((screenshot) => ({
    path: screenshot.path,
    pngSha256: screenshot.pngSha256,
    sidecarPath: screenshot.sidecarPath,
    sidecarSha256: screenshot.sidecarSha256,
    state: screenshot.state,
    theme: screenshot.theme,
    viewport: screenshot.viewport,
    viewportId: screenshot.viewportId,
  })).sort((left, right) => compareCodeUnits(left.path, right.path));
  return sha256(Buffer.from(JSON.stringify(records), "utf8"));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const { PNG } = pngjs;
let pngCrcTable;
const validatedPngPixelContent = new Map();

function pngCrc32(bytes) {
  if (!pngCrcTable) {
    pngCrcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = pngCrcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePngScreenshot(bytes, expectation) {
  if (Buffer.isBuffer(bytes) && bytes.length > MAX_SCREENSHOT_PNG_BYTES) {
    throw new Error(`browser screenshot exceeds the ${MAX_SCREENSHOT_PNG_BYTES}-byte verifier limit: ${expectation.tuple}`);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`browser screenshot is not a PNG: ${expectation.tuple}`);
  }
  let offset = PNG_SIGNATURE.length;
  let ihdr = null;
  let sawEnd = false;
  const imageData = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(`browser screenshot PNG is truncated: ${expectation.tuple}`);
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) throw new Error(`browser screenshot PNG chunk is truncated: ${expectation.tuple}`);
    const type = bytes.subarray(typeStart, dataStart).toString("ascii");
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (pngCrc32(bytes.subarray(typeStart, dataEnd)) !== expectedCrc) throw new Error(`browser screenshot PNG CRC failed: ${expectation.tuple}`);
    if (ihdr === null && type !== "IHDR") throw new Error(`browser screenshot PNG does not start with IHDR: ${expectation.tuple}`);
    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) throw new Error(`browser screenshot PNG has invalid IHDR: ${expectation.tuple}`);
      ihdr = {
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0),
      };
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) throw new Error(`browser screenshot PNG has invalid trailing data: ${expectation.tuple}`);
      sawEnd = true;
    }
    offset = chunkEnd;
  }
  const expected = expectation.screenshot.viewport;
  const supportedEncoding = (ihdr?.bitDepth === 8 && new Set([2, 6]).has(ihdr?.colorType))
    || (ihdr?.bitDepth === 1 && ihdr?.colorType === 0);
  if (!sawEnd || ihdr === null || imageData.length === 0
    || ihdr.width !== expected.width || ihdr.height !== expected.height
    || !supportedEncoding
    || ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace !== 0) {
    throw new Error(`browser screenshot PNG dimensions or encoding are invalid: ${expectation.tuple}`);
  }
  const pixelContentKey = `${ihdr.width}x${ihdr.height}/${sha256(bytes)}`;
  if (validatedPngPixelContent.has(pixelContentKey)) return validatedPngPixelContent.get(pixelContentKey);
  let decodedPng;
  try {
    decodedPng = PNG.sync.read(bytes, {
      checkCRC: true,
      maxHeight: ihdr.height,
      maxWidth: ihdr.width,
      skipRescale: false,
    });
  } catch (error) {
    throw new Error(`browser screenshot PNG pixels cannot be decoded: ${expectation.tuple}: ${error.message}`);
  }
  const rgba = Buffer.from(decodedPng.data);
  if (decodedPng.width !== ihdr.width || decodedPng.height !== ihdr.height || rgba.length !== ihdr.width * ihdr.height * 4) {
    throw new Error(`browser screenshot PNG pixel length is invalid: ${expectation.tuple}`);
  }
  let visible = rgba[3] > 0;
  let differentColor = false;
  for (let offset = 4; offset < rgba.length && (!visible || !differentColor); offset += 4) {
    if (rgba[offset + 3] > 0) visible = true;
    if (rgba[offset] !== rgba[0] || rgba[offset + 1] !== rgba[1]
      || rgba[offset + 2] !== rgba[2] || rgba[offset + 3] !== rgba[3]) differentColor = true;
  }
  if (!visible || !differentColor) throw new Error(`browser screenshot PNG is blank or fully transparent: ${expectation.tuple}`);
  const result = {
    height: ihdr.height,
    pixelSha256: sha256(Buffer.concat([Buffer.from(`${ihdr.width}x${ihdr.height}/rgba8\0`, "utf8"), rgba])),
    width: ihdr.width,
  };
  validatedPngPixelContent.set(pixelContentKey, result);
  if (validatedPngPixelContent.size > 4096) validatedPngPixelContent.delete(validatedPngPixelContent.keys().next().value);
  return result;
}

export function validateSubmissionScreenshotPng(bytes, expectation) {
  return validatePngScreenshot(bytes, expectation);
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
  const packageKeywords = archive.packageJson.keywords;
  if (archive.packageJson.repository?.type !== "git"
    || archive.packageJson.repository?.url !== "git+https://github.com/HomenShum/node-platform.git"
    || archive.packageJson.homepage !== "https://github.com/HomenShum/node-platform#readme"
    || archive.packageJson.bugs?.url !== "https://github.com/HomenShum/node-platform/issues"
    || archive.packageJson.author !== "Homen Shum"
    || !Array.isArray(packageKeywords)
    || !["ai-agents", "agent-applications", "convex", "evaluation", "proof", "scaffolding"]
      .every((keyword) => packageKeywords.includes(keyword))) {
    throw new Error("packed package metadata is incomplete or does not identify the NodeKit source repository");
  }

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
    || sidecar.postAgentTreeHash !== screenshot.postAgentTreeHash
    || sidecar.consoleErrors !== 0
    || sidecar.failedRequests !== 0
    || sidecar.horizontalOverflowPx !== 0
    || sidecar.mojibakeDetected !== false) {
    throw new Error(`browser screenshot sidecar does not match its manifest row: ${expectation.tuple}`);
  }
}

function validateProtectedScreenshotSidecar(sidecar, expectation) {
  const screenshot = expectation.screenshot;
  const requiredKeys = [
    "accessibility", "authority", "candidateArchiveSha256", "consoleErrors", "failedRequests",
    "horizontalOverflowPx", "mojibakeDetected", "pageUrl", "pngSha256", "runId", "schemaVersion",
    "state", "taskId", "theme", "viewport", "viewportId",
  ];
  validateProtectedAxeEvidence(sidecar?.accessibility, expectation.tuple);
  if (!sidecar || !exactSet(Object.keys(sidecar), requiredKeys)
    || sidecar.schemaVersion !== "nodekit.protected-screenshot-proof/v1"
    || sidecar.authority !== "campaign-protected-browser"
    || sidecar.candidateArchiveSha256 !== screenshot.candidateArchiveSha256
    || sidecar.runId !== screenshot.runId || sidecar.taskId !== screenshot.taskId
    || sidecar.state !== screenshot.state || sidecar.theme !== screenshot.theme
    || sidecar.viewportId !== screenshot.viewportId
    || sidecar.viewport?.width !== screenshot.viewport.width || sidecar.viewport?.height !== screenshot.viewport.height
    || sidecar.pageUrl !== screenshot.pageUrl || sidecar.pngSha256 !== screenshot.pngSha256
    || JSON.stringify(sidecar.accessibility) !== JSON.stringify(screenshot.accessibility)
    || sidecar.consoleErrors !== 0 || sidecar.failedRequests !== 0
    || sidecar.horizontalOverflowPx !== 0 || sidecar.mojibakeDetected !== false) {
    throw new Error(`protected browser screenshot sidecar does not match its manifest row: ${expectation.tuple}`);
  }
}

function validateBrowserManifestBinding(gateId, verdict, reference, manifest) {
  if (manifest.nodekitCommit !== verdict?.nodekitCommit
    || manifest.nodekitSourceHash !== verdict?.nodekitSourceHash
    || manifest.nodekitIdentity !== verdict?.nodekitIdentity
    || manifest.nodekitTarballSha256 !== verdict?.releaseCandidate?.nodekitTarballSha256) {
    throw new Error(`browser screenshot manifest is not bound to the ${gateId} release candidate: ${reference.path}`);
  }
  if (gateId === "freshAgentHeldout") {
    const run = selectedAgentRunForReference(verdict, reference);
    if (!run
      || manifest.runId !== run.runId
      || manifest.applicationHash !== run.applicationHash
      || manifest.configHash !== run.configHash
      || manifest.postAgentTreeHash !== run.postAgentTreeHash) {
      throw new Error(`fresh-agent browser manifest is not bound to its post-agent run: ${reference.path}`);
    }
  } else if (gateId === "threeConvexConsumers") {
    const consumer = verdict.consumers?.find((entry) => entry.evidence?.some((item) => item.kind === "screenshot-manifest" && item.path === reference.path));
    if (!consumer || manifest.generatedCandidateCommit !== consumer.consumerCommit) {
      throw new Error(`consumer browser manifest is not bound to its reviewed consumer commit: ${reference.path}`);
    }
  } else if (gateId === "previewDeployment") {
    if (manifest.generatedCandidateCommit !== verdict.deploymentCommit
      || manifest.applicationHash !== verdict.applicationHash
      || manifest.configHash !== verdict.configHash) {
      throw new Error(`preview browser manifest is not bound to the deployed application revision: ${reference.path}`);
    }
  }
}

function selectedAgentRunForReference(verdict, reference) {
  return verdict?.selectedRuns?.find((run) => run.manifestPath === reference.path
    || run.evidence?.some((entry) => entry.path === reference.path)) ?? null;
}

function freshAgentCandidateExpectation(verdict) {
  const release = releaseCandidateBinding(verdict);
  if (!release) throw new Error("fresh-agent verdict is missing its exact release candidate");
  return {
    commit: release.nodekitCommit,
    packageName: release.packageName,
    packageVersion: release.packageVersion,
    sourceHash: release.nodekitSourceHash,
    tarballSha256: release.nodekitTarballSha256,
  };
}

function freshAgentRunExpectation(run, taskBriefSha256 = run.promptSha256) {
  return {
    agentContainerImage: run.agentContainerImage,
    agentContainerImageId: run.agentContainerImageId,
    agentDriver: run.agentDriver,
    agentProfile: run.agentProfile,
    bootstrapMode: run.bootstrapMode,
    model: run.agentModel,
    protectedBrowserLaneSha256: run.protectedBrowserLaneSha256,
    protectedContainerImage: run.protectedContainerImage,
    protectedContainerImageId: run.protectedContainerImageId,
    protectedEvaluatorSha256: run.protectedEvaluatorSha256,
    providerBrokerSha256: run.providerBrokerSha256,
    runId: run.runId,
    taskBriefSha256,
    taskId: run.taskId,
    taskSetSha256: run.taskSetSha256,
    trialRunnerSha256: run.trialRunnerSha256,
  };
}

function freshAgentProtectedExpectation(run) {
  const evidence = Object.fromEntries((run.evidence ?? []).map((entry) => [entry.kind, entry]));
  return {
    applicationHash: run.applicationHash,
    browserLaneSha256: run.protectedBrowserLaneSha256,
    candidateBrowserManifestSha256: evidence["screenshot-manifest"]?.sha256,
    candidateArchiveSha256: run.candidateArchiveSha256,
    configHash: run.configHash,
    containerImage: run.protectedContainerImage,
    containerImageId: run.protectedContainerImageId,
    evaluatorScreenshotSha256: run.evaluatorScreenshotSha256,
    evaluatorSha256: run.protectedEvaluatorSha256,
    isolationSha256: run.protectedIsolationSha256,
    nodekitCommit: run.nodekitCommit,
    nodekitSourceHash: run.nodekitSourceHash,
    nodekitTarballSha256: run.nodekitTarballSha256,
    postAgentTreeHash: run.postAgentTreeHash,
    runId: run.runId,
    screenshotEvidenceRootSha256: run.screenshotEvidenceRootSha256,
    taskBriefSha256: run.promptSha256,
    taskId: run.taskId,
    taskSetSha256: run.taskSetSha256,
    visualReviewInventorySha256: run.visualReviewInventorySha256,
  };
}

function campaignRelativeAgentPath(value, runId) {
  const marker = `${runId}/`;
  const index = String(value ?? "").indexOf(marker);
  if (index < 0) throw new Error(`fresh-agent evidence path is not rooted under ${runId}: ${value}`);
  return String(value).slice(index);
}

function parseAgentJsonEvidence(record, reference, label) {
  try {
    return JSON.parse(record.bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not JSON: ${reference.path}`);
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

async function validatePostgresConformanceEvidence(reference, bytes, verdict) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`PostgreSQL conformance evidence is not JSON: ${reference.path}`);
  }
  const schemaErrors = await validateSchema("nodekit.postgres-conformance.v2.schema.json", value, reference.path);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const release = releaseCandidateBinding(value);
  const expectedRelease = releaseCandidateBinding(verdict);
  const releaseMatches = release && expectedRelease
    && release.nodekitCommit === expectedRelease.nodekitCommit
    && release.nodekitSourceHash === expectedRelease.nodekitSourceHash
    && release.nodekitTarballSha256 === expectedRelease.nodekitTarballSha256
    && release.packageName === expectedRelease.packageName
    && release.packageVersion === expectedRelease.packageVersion;
  if (!releaseMatches
    || value.candidateCommit !== verdict.nodekitCommit
    || value.nodekitCommit !== verdict.nodekitCommit
    || value.nodekitSourceHash !== verdict.nodekitSourceHash
    || value.nodekitIdentity !== verdict.nodekitIdentity
    || value.environment !== "live-postgresql"
    || value.packageInstallation?.isolated !== true
    || value.packageInstallation?.sourceCheckoutImported !== false
    || value.postgres?.serverVersionNum !== verdict.postgresConformance?.serverVersionNum
    || value.testedAt > verdict.testedAt
    || verdict.postgresConformance?.path !== reference.path
    || verdict.postgresConformance?.sha256 !== reference.sha256) {
    throw new Error("live PostgreSQL conformance does not match the exact managed-portability release candidate");
  }
}

function sameOrderedValues(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function recomputeKnowledgeProfile(profile, label) {
  if (!Array.isArray(profile?.cases) || profile.cases.length < 3) {
    throw new Error(`${label} protected knowledge profile requires at least three cases`);
  }
  const caseIds = profile.cases.map((entry) => entry.caseId);
  if (new Set(caseIds).size !== caseIds.length) throw new Error(`${label} protected knowledge cases are not unique`);
  for (const entry of profile.cases) {
    const expectedSuccess = entry.missingExpected.length === 0
      && entry.returnedForbidden.length === 0
      && entry.abstainCorrect === true
      && entry.surfacedUnsupportedEdgeIds.length === 0;
    if (entry.success !== expectedSuccess) throw new Error(`${label}/${entry.caseId} protected knowledge success is not recomputable`);
    if (entry.evaluatorSha256 === undefined || entry.metrics?.executionReceipt === undefined) {
      throw new Error(`${label}/${entry.caseId} protected knowledge evidence is incomplete`);
    }
  }
  const sums = {
    successRate: profile.cases.filter((entry) => entry.success).length / profile.cases.length,
    abstainAccuracy: profile.cases.filter((entry) => entry.abstainCorrect).length / profile.cases.length,
    unsupportedEdgeCount: profile.cases.reduce((sum, entry) => sum + entry.unsupportedEdgeCount, 0),
    turns: profile.cases.reduce((sum, entry) => sum + entry.metrics.turns, 0),
    tokens: profile.cases.reduce((sum, entry) => sum + entry.metrics.tokens, 0),
    latencyMs: profile.cases.reduce((sum, entry) => sum + entry.metrics.latencyMs, 0),
    costUsd: profile.cases.reduce((sum, entry) => sum + entry.metrics.costUsd, 0),
  };
  for (const [name, expected] of Object.entries(sums)) {
    if (profile[name] !== expected) throw new Error(`${label} protected knowledge ${name} aggregate does not match its cases`);
  }
  return caseIds;
}

async function validateProtectedKnowledgeComparisonEvidence(repoRoot, reference, bytes, verdict) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`protected knowledge comparison evidence is not JSON: ${reference.path}`);
  }
  const schemaErrors = await validateSchema("nodekit.protected-knowledge-comparison-result.v1.schema.json", value, reference.path);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const { resultSha256, ...resultBody } = value;
  if (knowledgeRuntimeHash(resultBody) !== resultSha256) throw new Error("protected knowledge comparison result hash mismatch");
  const profiles = value.profiles;

  const readBoundJson = async (evidence, label, schemaName) => {
    if (!portableEvidencePath(evidence?.path) || !SHA256.test(evidence?.sha256 ?? "")) throw new Error(`${label} evidence reference is invalid`);
    const record = await readContainedEvidenceRecord(repoRoot, evidence.path);
    if (sha256(record.bytes) !== evidence.sha256) throw new Error(`${label} evidence hash mismatch`);
    let parsed;
    try { parsed = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`${label} evidence is not JSON: ${evidence.path}`); }
    if (schemaName) {
      const errors = await validateSchema(schemaName, parsed, evidence.path);
      if (errors.length > 0) throw new Error(errors.join("\n"));
    }
    return parsed;
  };
  const definition = await readBoundJson(value.definitionEvidence, "protected knowledge definition", "nodekit.protected-knowledge-comparison-definition.v1.schema.json");
  const graphs = {};
  const graphEvidence = {};
  const measurements = {};
  for (const [profileName, profile] of Object.entries(profiles)) {
    graphs[profileName] = await readBoundJson(profile.graphSnapshot, `${profileName} graph snapshot`, "nodekit.knowledge-graph.v1.schema.json");
    graphEvidence[profileName] = profile.graphSnapshot;
    measurements[profileName] = {};
    for (const entry of profile.cases) {
      const execution = await readBoundJson(entry.metrics.executionReceipt, `${profileName}/${entry.caseId} execution receipt`, "nodekit.knowledge-comparison-execution.v1.schema.json");
      measurements[profileName][entry.caseId] = {
        turns: entry.metrics.turns,
        tokens: entry.metrics.tokens,
        latencyMs: entry.metrics.latencyMs,
        costUsd: entry.metrics.costUsd,
        executionReceiptPath: entry.metrics.executionReceipt.path,
        executionReceiptSha256: entry.metrics.executionReceipt.sha256,
        execution,
      };
    }
  }
  const recomputed = runProtectedKnowledgeComparison({
    definition,
    definitionEvidencePath: value.definitionEvidence.path,
    definitionEvidenceSha256: value.definitionEvidence.sha256,
    expectedDefinitionSha256: value.definitionSha256,
    graphs,
    graphEvidence,
    measurements,
    releaseCandidate: value.releaseCandidate,
    completedAt: value.completedAt,
  });
  if (JSON.stringify(recomputed) !== JSON.stringify(value)) {
    throw new Error("protected knowledge comparison is not reproducible from its exact graph, definition, and execution receipts");
  }
  const flatIds = recomputeKnowledgeProfile(profiles.flat, "flat");
  const staticIds = recomputeKnowledgeProfile(profiles.staticGraph, "staticGraph");
  const evolvingIds = recomputeKnowledgeProfile(profiles.evolvingGraph, "evolvingGraph");
  if (!sameOrderedValues(flatIds, staticIds) || !sameOrderedValues(flatIds, evolvingIds)) {
    throw new Error("protected knowledge profiles did not execute the same ordered cases");
  }
  if (profiles.flat.graphId !== profiles.staticGraph.graphId
    || profiles.flat.graphId !== profiles.evolvingGraph.graphId
    || profiles.flat.graphContentHash !== profiles.evolvingGraph.graphContentHash
    || profiles.staticGraph.graphVersion > profiles.evolvingGraph.graphVersion) {
    throw new Error("protected knowledge graph lineage is inconsistent");
  }
  for (let index = 0; index < flatIds.length; index += 1) {
    const cases = [profiles.flat.cases[index], profiles.staticGraph.cases[index], profiles.evolvingGraph.cases[index]];
    if (new Set(cases.map((entry) => entry.caseInputSha256)).size !== 1
      || cases.some((entry) => entry.evaluatorSha256 !== value.evaluatorSha256)) {
      throw new Error(`protected knowledge input or evaluator changed for ${flatIds[index]}`);
    }
    if ((cases[0].success || cases[1].success) && !cases[2].success) {
      throw new Error(`protected knowledge evolving profile regressed ${flatIds[index]}`);
    }
  }
  const comparison = verdict.comparison;
  const bestBaseline = Math.max(profiles.flat.successRate, profiles.staticGraph.successRate);
  const expectedOutcome = profiles.evolvingGraph.successRate > bestBaseline ? "improved" : "held";
  if (value.comparisonId !== verdict.comparisonId
    || JSON.stringify(value.releaseCandidate) !== JSON.stringify(verdict.releaseCandidate)
    || value.protectedBenchmarkSha256 !== comparison.protectedBenchmarkSha256
    || value.evaluatorSha256 !== comparison.harnessSha256
    || value.completedAt > verdict.completedAt
    || flatIds.length !== comparison.taskCount
    || profiles.flat.successRate !== comparison.flatScore
    || profiles.staticGraph.successRate !== comparison.staticGraphScore
    || profiles.evolvingGraph.successRate !== comparison.evolvingGraphScore
    || profiles.evolvingGraph.successRate < bestBaseline
    || comparison.outcome !== expectedOutcome
    || value.sameInputs !== true
    || value.protectedEvaluatorUnchanged !== true
    || value.adoptionClaim !== false
    || value.status !== "ENGINEERING_COMPARISON_ONLY") {
    throw new Error("protected knowledge comparison does not match its decisive adoption verdict");
  }
  const children = [{
    kind: "knowledge-comparison-definition",
    path: value.definitionEvidence.path,
    sha256: value.definitionEvidence.sha256,
    expectation: { result: value },
  }];
  const childPaths = new Map([[value.definitionEvidence.path, value.definitionEvidence.sha256]]);
  for (const [profileName, profile] of Object.entries(profiles)) {
    const existing = childPaths.get(profile.graphSnapshot.path);
    if (existing && existing !== profile.graphSnapshot.sha256) throw new Error(`protected knowledge graph snapshot path has conflicting hashes: ${profile.graphSnapshot.path}`);
    if (!existing) {
      childPaths.set(profile.graphSnapshot.path, profile.graphSnapshot.sha256);
      children.push({
        kind: "knowledge-graph-snapshot",
        path: profile.graphSnapshot.path,
        sha256: profile.graphSnapshot.sha256,
        expectation: { profileName, result: value },
      });
    }
  }
  for (const [profileName, profile] of Object.entries(profiles)) {
    for (const entry of profile.cases) {
      if (childPaths.has(entry.metrics.executionReceipt.path)) throw new Error(`protected knowledge evidence path is reused: ${entry.metrics.executionReceipt.path}`);
      childPaths.set(entry.metrics.executionReceipt.path, entry.metrics.executionReceipt.sha256);
      children.push({
        kind: "knowledge-execution-receipt",
        path: entry.metrics.executionReceipt.path,
        sha256: entry.metrics.executionReceipt.sha256,
        expectation: { profileName, caseId: entry.caseId, result: value },
      });
    }
  }
  return children;
}

async function validateProtectedKnowledgeDefinitionEvidence(reference, bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`protected knowledge definition evidence is not JSON: ${reference.path}`);
  }
  const schemaErrors = await validateSchema("nodekit.protected-knowledge-comparison-definition.v1.schema.json", value, reference.path);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
  const result = reference.expectation?.result;
  const { definitionSha256, ...definitionBody } = value;
  if (knowledgeRuntimeHash(definitionBody) !== definitionSha256
    || knowledgeRuntimeHash(value.cases) !== value.protectedBenchmarkSha256
    || knowledgeRuntimeHash(value.evaluator) !== value.evaluatorSha256
    || value.comparisonId !== result?.comparisonId
    || definitionSha256 !== result?.definitionSha256
    || value.protectedBenchmarkSha256 !== result?.protectedBenchmarkSha256
    || value.evaluatorSha256 !== result?.evaluatorSha256) {
    throw new Error("protected knowledge definition does not match its comparison result");
  }
  for (const [index, definitionCase] of value.cases.entries()) {
    const { inputSha256, ...caseBody } = definitionCase;
    if (knowledgeRuntimeHash(caseBody) !== inputSha256) throw new Error(`protected knowledge case hash mismatch at index ${index}`);
    for (const profile of Object.values(result.profiles)) {
      const observed = profile.cases[index];
      const returned = new Set(observed.returnedEntityIds);
      const missingExpected = definitionCase.expectedEntityIds.filter((id) => !returned.has(id));
      const returnedForbidden = definitionCase.forbiddenEntityIds.filter((id) => returned.has(id));
      const abstainCorrect = (observed.decision === "ABSTAIN") === definitionCase.expectAbstain;
      if (observed.caseId !== definitionCase.caseId
        || observed.caseInputSha256 !== inputSha256
        || !sameOrderedValues(observed.missingExpected, missingExpected)
        || !sameOrderedValues(observed.returnedForbidden, returnedForbidden)
        || observed.abstainCorrect !== abstainCorrect) {
        throw new Error(`protected knowledge case result is not recomputable for ${definitionCase.caseId}`);
      }
    }
  }
}

export async function resolveSubmissionEvidenceClosure(repoRoot, gateId, value) {
  const direct = transitiveSubmissionEvidence(gateId, value);
  const declaredDirectBytes = direct.reduce((total, reference) => total + (Number.isInteger(reference?.bytes) ? reference.bytes : 0), 0);
  if (declaredDirectBytes > MAX_GATE_EVIDENCE_CLOSURE_BYTES) {
    throw new Error(`evidence declares more than the ${MAX_GATE_EVIDENCE_CLOSURE_BYTES}-byte gate limit in ${gateId}`);
  }
  const queue = [...direct];
  const references = [];
  const paths = new Set();
  const resolvedPaths = new Set();
  const fileIdentities = new Set();
  const screenshotPixels = new Map();
  const agentTrialManifests = new Map();
  const agentProtectedEvaluations = new Map();
  const agentVisualInventories = new Map();
  const agentBrowserCertifications = new Map();
  const agentScreenshotManifests = new Map();
  const agentProtectedScreenshotManifests = new Map();
  const agentSessionEvidence = new Set();
  const agentPromptEvidence = new Set();
  const agentPromptHashEvidence = new Set();
  let agentTaskSet = null;
  let agentLowerCostEvidence = null;
  let agentLowerCostSnapshot = null;
  let totalClosureBytes = 0;
  while (queue.length > 0) {
    const reference = queue.shift();
    if (!portableEvidencePath(reference?.path) || !SHA256.test(reference?.sha256 ?? "")) throw new Error(`invalid evidence reference in ${gateId}: ${reference?.path ?? "missing"}`);
    if (paths.has(reference.path)) throw new Error(`evidence closure reuses path in ${gateId}: ${reference.path}`);
    paths.add(reference.path);
    const maxBytes = reference.kind === "candidate-archive" ? MAX_CANDIDATE_ARCHIVE_BYTES
      : new Set(["screenshot-manifest", "protected-screenshot-manifest"]).has(reference.kind) ? MAX_SCREENSHOT_MANIFEST_BYTES
      : new Set(["browser-screenshot", "protected-browser-screenshot"]).has(reference.kind) ? MAX_SCREENSHOT_PNG_BYTES
        : new Set(["browser-screenshot-sidecar", "protected-browser-screenshot-sidecar"]).has(reference.kind) ? MAX_SCREENSHOT_SIDECAR_BYTES
          : /\.(?:json|jsonl)$/i.test(reference.path) ? MAX_STRUCTURED_EVIDENCE_BYTES
            : String(reference.kind ?? "").startsWith("browser-artifact:") ? MAX_BROWSER_ARTIFACT_BYTES
              : MAX_EVIDENCE_FILE_BYTES;
    if (Number.isInteger(reference.bytes) && (reference.bytes < 0 || reference.bytes > maxBytes)) {
      throw new Error(`evidence declares an out-of-bounds byte count in ${gateId}: ${reference.path}`);
    }
    const record = await readContainedEvidenceRecord(repoRoot, reference.path, { maxBytes });
    totalClosureBytes += record.bytes.length;
    if (totalClosureBytes > MAX_GATE_EVIDENCE_CLOSURE_BYTES) {
      throw new Error(`evidence closure exceeds the ${MAX_GATE_EVIDENCE_CLOSURE_BYTES}-byte gate limit in ${gateId}`);
    }
    if (resolvedPaths.has(record.resolved) || fileIdentities.has(record.fileIdentity)) throw new Error(`evidence closure aliases a previously used file in ${gateId}: ${reference.path}`);
    resolvedPaths.add(record.resolved);
    fileIdentities.add(record.fileIdentity);
    const actualHash = sha256(record.bytes);
    if (actualHash !== reference.sha256) throw new Error(`evidence closure hash mismatch in ${gateId}: ${reference.path}`);
    if (Number.isInteger(reference.bytes) && record.bytes.length !== reference.bytes) throw new Error(`evidence closure byte count mismatch in ${gateId}: ${reference.path}`);
    references.push({ path: reference.path, sha256: reference.sha256, ...(Number.isInteger(reference.bytes) ? { bytes: reference.bytes } : {}) });

    if (gateId === "freshAgentHeldout" && reference.kind === "lower-cost-evidence") {
      const rawEvidence = parseAgentJsonEvidence(record, reference, "lower-cost model evidence");
      const pricing = value?.lowerCostPricingEvidence;
      const normalized = validateLowerCostEvidence(rawEvidence, {
        agentDriver: pricing?.agentDriver,
        model: pricing?.model,
      });
      if (reference.path !== pricing?.evidencePath
        || actualHash !== pricing?.evidenceSha256
        || normalized.source.snapshotSha256 !== pricing?.snapshotSha256) {
        throw new Error("fresh-agent lower-cost evidence does not bind the decisive pricing claim");
      }
      agentLowerCostEvidence = normalized;
    } else if (gateId === "freshAgentHeldout" && reference.kind === "lower-cost-snapshot") {
      if (!agentLowerCostEvidence) throw new Error("fresh-agent official pricing snapshot was resolved before its evidence contract");
      const snapshot = parseAgentJsonEvidence(record, reference, "official pricing snapshot");
      const pricing = value?.lowerCostPricingEvidence;
      if (reference.path !== pricing?.snapshotPath || actualHash !== pricing?.snapshotSha256) {
        throw new Error("fresh-agent official pricing snapshot does not bind the decisive pricing claim");
      }
      const replay = validateOfficialPricingSnapshot(snapshot, agentLowerCostEvidence, {
        referenceTime: pricing?.pricingValidation?.validatedAt,
      });
      const validation = pricing?.pricingValidation;
      if (!validation
        || replay.ageMs !== validation.ageMs
        || replay.retrievedAt !== validation.retrievedAt
        || replay.source !== validation.source
        || !exactSet(replay.verifiedModels, validation.verifiedModels)) {
        throw new Error("fresh-agent lower-cost pricing validation is not replayable from the official snapshot");
      }
      validateOfficialPricingSnapshot(snapshot, agentLowerCostEvidence, { referenceTime: new Date() });
      agentLowerCostSnapshot = snapshot;
    } else if (gateId === "freshAgentHeldout" && reference.kind === "agent-task-set") {
      const taskSet = parseAgentJsonEvidence(record, reference, "fresh-agent task set");
      const tasks = Array.isArray(taskSet?.tasks) ? taskSet.tasks : [];
      if (taskSet?.schemaVersion !== "nodekit.agent-ease-tasks/v1"
        || !exactSet(tasks.map((task) => task?.id), AGENT_TASKS)
        || tasks.some((task) => !task || !exactSet(Object.keys(task), ["goal", "id"])
          || typeof task.goal !== "string" || task.goal.trim().length === 0)) {
        throw new Error("fresh-agent task set is malformed or does not contain the exact protected tasks");
      }
      agentTaskSet = new Map(tasks.map((task) => [task.id, task.goal]));
    } else if (gateId === "freshAgentHeldout" && reference.kind === "prompt") {
      const run = selectedAgentRunForReference(value, reference);
      const goal = run ? agentTaskSet?.get(run.taskId) : null;
      if (!run || typeof goal !== "string" || !record.bytes.equals(Buffer.from(`${goal}\n`, "utf8"))) {
        throw new Error(`fresh-agent prompt evidence does not equal the protected task goal: ${reference.path}`);
      }
      agentPromptEvidence.add(run.runId);
    } else if (gateId === "freshAgentHeldout" && reference.kind === "prompt-hash") {
      const run = selectedAgentRunForReference(value, reference);
      const goal = run ? agentTaskSet?.get(run.taskId) : null;
      if (!run || typeof goal !== "string" || !record.bytes.equals(Buffer.from(`${sha256(goal)}\n`, "utf8"))) {
        throw new Error(`fresh-agent prompt hash evidence does not bind the protected task goal: ${reference.path}`);
      }
      agentPromptHashEvidence.add(run.runId);
    } else if (reference.kind === "screenshot-manifest") {
      let manifest;
      try { manifest = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`browser screenshot manifest is not JSON: ${reference.path}`); }
      validateBrowserManifestBinding(gateId, value, reference, manifest);
      if (gateId === "freshAgentHeldout") {
        const run = selectedAgentRunForReference(value, reference);
        if (!run || manifest.runId !== run.runId) throw new Error(`fresh-agent screenshot manifest has no selected run: ${reference.path}`);
        agentScreenshotManifests.set(run.runId, { fileSha256: actualHash, value: manifest });
        // Candidate-authored screenshot bytes are diagnostic only. Validate the
        // declared matrix, but do not let its children satisfy the decisive UI
        // closure. The protected evaluator supplies and owns that matrix.
        browserManifestChildren(reference.path, manifest);
      } else {
        queue.push(...browserManifestChildren(reference.path, manifest));
      }
    } else if (gateId === "freshAgentHeldout" && reference.kind === "protected-screenshot-manifest") {
      const run = value?.selectedRuns?.find((entry) => entry.runId === reference.runId);
      if (!run) throw new Error(`protected screenshot manifest has no selected run: ${reference.path}`);
      const evaluation = agentProtectedEvaluations.get(run.runId)?.value;
      const certificationRunId = evaluation?.protectedTaskInput?.inputToken;
      if (typeof certificationRunId !== "string") {
        throw new Error(`protected screenshot manifest was resolved before its trusted certification identity: ${reference.path}`);
      }
      const manifest = parseAgentJsonEvidence(record, reference, "protected browser screenshot manifest");
      const children = protectedBrowserManifestChildren(reference.path, manifest, run, certificationRunId);
      agentProtectedScreenshotManifests.set(run.runId, { certificationRunId, fileSha256: actualHash, value: manifest });
      queue.push(...children);
    } else if (new Set(["browser-screenshot", "protected-browser-screenshot"]).has(reference.kind)) {
      const decoded = validatePngScreenshot(record.bytes, reference.expectation);
      const pixelScope = `${reference.expectation?.manifestPath ?? "unknown"}\0${decoded.pixelSha256}`;
      const priorPath = screenshotPixels.get(pixelScope);
      if (priorPath) throw new Error(`browser certification reuses decoded screenshot pixels: ${priorPath} and ${reference.path}`);
      screenshotPixels.set(pixelScope, reference.path);
    } else if (reference.kind === "protected-browser-screenshot-sidecar") {
      let sidecar;
      try { sidecar = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`protected browser screenshot sidecar is not JSON: ${reference.path}`); }
      validateProtectedScreenshotSidecar(sidecar, reference.expectation);
    } else if (reference.kind === "browser-screenshot-sidecar") {
      let sidecar;
      try { sidecar = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`browser screenshot sidecar is not JSON: ${reference.path}`); }
      validateScreenshotSidecar(sidecar, reference.expectation);
    } else if (gateId === "freshAgentHeldout" && reference.kind === "agent-trial-manifest") {
      const run = selectedAgentRunForReference(value, reference);
      if (!run) throw new Error(`fresh-agent trial manifest has no selected run: ${reference.path}`);
      const manifest = parseAgentJsonEvidence(record, reference, "fresh-agent trial manifest");
      const schemaErrors = await validateSchema("nodekit.agent-ease-trial.v2.schema.json", manifest, reference.path);
      if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
      validateAgentEaseTrialManifest(manifest, {
        candidate: freshAgentCandidateExpectation(value),
        run: freshAgentRunExpectation(run),
      });
      agentTrialManifests.set(run.runId, { fileSha256: actualHash, value: manifest });
    } else if (gateId === "freshAgentHeldout" && reference.kind === "protected-evaluation") {
      const run = selectedAgentRunForReference(value, reference);
      if (!run) throw new Error(`fresh-agent protected evaluation has no selected run: ${reference.path}`);
      const evaluation = parseAgentJsonEvidence(record, reference, "fresh-agent protected evaluation");
      const schemaErrors = await validateSchema("nodekit.protected-agent-evaluation.v2.schema.json", evaluation, reference.path);
      if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
      validateProtectedAgentEvaluation(evaluation, freshAgentProtectedExpectation(run));
      agentProtectedEvaluations.set(run.runId, { fileSha256: actualHash, value: evaluation });
      const runRoot = freshAgentRepositoryEvidenceRoot(run);
      if (!runRoot || evaluation.protectedBrowserManifestFile !== "protected-browser/screenshot-manifest.json") {
        throw new Error(`fresh-agent protected evaluation has an invalid trusted browser path: ${reference.path}`);
      }
      queue.push({
        kind: "protected-screenshot-manifest",
        path: `${runRoot}/evaluator/${evaluation.protectedBrowserManifestFile}`,
        runId: run.runId,
        sha256: evaluation.browserManifestSha256,
      });
    } else if (gateId === "freshAgentHeldout" && reference.kind === "visual-review-inventory") {
      const run = selectedAgentRunForReference(value, reference);
      if (!run) throw new Error(`fresh-agent visual review inventory has no selected run: ${reference.path}`);
      const inventory = parseAgentJsonEvidence(record, reference, "fresh-agent visual review inventory");
      const schemaErrors = await validateSchema("nodekit.visual-review-inventory.v1.schema.json", inventory, reference.path);
      if (schemaErrors.length > 0) throw new Error(schemaErrors.join("\n"));
      validateVisualReviewInventory(inventory, freshAgentProtectedExpectation(run));
      agentVisualInventories.set(run.runId, { fileSha256: actualHash, value: inventory });
    } else if (gateId === "freshAgentHeldout" && reference.kind === "browser-certification") {
      const run = selectedAgentRunForReference(value, reference);
      if (!run) throw new Error(`fresh-agent browser certification has no selected run: ${reference.path}`);
      const manifest = parseAgentJsonEvidence(record, reference, "fresh-agent browser certification");
      validateBrowserManifestBinding(gateId, value, reference, manifest);
      browserManifestChildren(reference.path.replace(/browser-certification\.json$/u, "browser/screenshot-manifest.json"), manifest);
      agentBrowserCertifications.set(run.runId, { fileSha256: actualHash, value: manifest });
    } else if (gateId === "freshAgentHeldout" && reference.kind === "session") {
      const run = selectedAgentRunForReference(value, reference);
      if (!run) throw new Error(`fresh-agent session evidence has no selected run: ${reference.path}`);
      const lines = record.bytes.toString("utf8").split(/\r?\n/u).filter((line) => line.trim().length > 0);
      let events;
      try { events = lines.map((line) => JSON.parse(line)); } catch { throw new Error(`fresh-agent session is not valid JSONL: ${reference.path}`); }
      if (events.length === 0 || !events.some((event) => JSON.stringify(event).includes(run.agentSessionId))) {
        throw new Error(`fresh-agent session does not bind its selected session ID: ${reference.path}`);
      }
      agentSessionEvidence.add(run.runId);
    } else if (gateId === "engineeringHealth" && ["engineering-check-receipt", "engineering-issue-inventory"].includes(reference.kind)) {
      await validateEngineeringEvidence(reference, record.bytes, value);
    } else if (gateId === "managedSupabasePortability" && reference.kind === "postgres-conformance") {
      await validatePostgresConformanceEvidence(reference, record.bytes, value);
    } else if (gateId === "knowledgeEvolutionAdoption" && reference.kind === "protected-comparison") {
      queue.push(...await validateProtectedKnowledgeComparisonEvidence(repoRoot, reference, record.bytes, value));
    } else if (gateId === "knowledgeEvolutionAdoption" && reference.kind === "knowledge-comparison-definition") {
      await validateProtectedKnowledgeDefinitionEvidence(reference, record.bytes);
    } else if (gateId === "knowledgeEvolutionAdoption" && reference.kind === "knowledge-execution-receipt") {
      let execution;
      try { execution = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`protected knowledge execution receipt is not JSON: ${reference.path}`); }
      const errors = await validateSchema("nodekit.knowledge-comparison-execution.v1.schema.json", execution, reference.path);
      if (errors.length > 0) throw new Error(errors.join("\n"));
      if (execution.profile !== reference.expectation?.profileName || execution.caseId !== reference.expectation?.caseId) {
        throw new Error(`protected knowledge execution receipt identity mismatch: ${reference.path}`);
      }
    } else if (gateId === "knowledgeEvolutionAdoption" && reference.kind === "knowledge-graph-snapshot") {
      let graph;
      try { graph = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error(`protected knowledge graph snapshot is not JSON: ${reference.path}`); }
      const errors = await validateSchema("nodekit.knowledge-graph.v1.schema.json", graph, reference.path);
      if (errors.length > 0) throw new Error(errors.join("\n"));
      const profile = reference.expectation?.result?.profiles?.[reference.expectation?.profileName];
      if (graph.graphId !== profile?.graphId || graph.version !== profile?.graphVersion || graph.contentHash !== profile?.graphContentHash || graph.authority?.ownerId !== profile?.ownerId) {
        throw new Error(`protected knowledge graph snapshot identity mismatch: ${reference.path}`);
      }
    }
  }
  if (gateId === "freshAgentHeldout") {
    const selectedRuns = value?.selectedRuns ?? [];
    const expectedCount = selectedRuns.length;
    if (!(agentTaskSet instanceof Map) || agentTaskSet.size !== AGENT_TASKS.length) {
      throw new Error("fresh-agent closure lacks the exact parsed task set");
    }
    if (!agentLowerCostEvidence || !agentLowerCostSnapshot) {
      throw new Error("fresh-agent closure lacks replayable official lower-cost pricing evidence");
    }
    for (const [label, observed] of [
      ["trial manifests", agentTrialManifests],
      ["protected evaluations", agentProtectedEvaluations],
      ["visual review inventories", agentVisualInventories],
      ["browser certifications", agentBrowserCertifications],
      ["candidate diagnostic screenshot manifests", agentScreenshotManifests],
      ["protected screenshot manifests", agentProtectedScreenshotManifests],
    ]) {
      if (observed.size !== expectedCount) throw new Error(`fresh-agent closure has ${observed.size}/${expectedCount} ${label}`);
    }
    if (agentSessionEvidence.size !== expectedCount) {
      throw new Error(`fresh-agent closure has ${agentSessionEvidence.size}/${expectedCount} replayable agent sessions`);
    }
    if (agentPromptEvidence.size !== expectedCount || agentPromptHashEvidence.size !== expectedCount) {
      throw new Error(`fresh-agent closure has ${agentPromptEvidence.size}/${expectedCount} exact prompts and ${agentPromptHashEvidence.size}/${expectedCount} prompt hashes`);
    }
    const campaignIds = new Set(selectedRuns.map((run) => run.manifestPath.split("/")[4]));
    if (campaignIds.size !== 1) throw new Error("fresh-agent selected runs do not belong to one exact campaign");
    const [campaignId] = campaignIds;
    const expectedRunIds = AGENT_TASKS.flatMap((taskId) => Object.entries(AGENT_PROFILE_COUNTS)
      .flatMap(([profile, count]) => Array.from({ length: count }, (_, index) => `${campaignId}_${taskId}_${profile}_${index + 1}`)));
    if (!exactSet(selectedRuns.map((run) => run.runId), expectedRunIds)) {
      throw new Error("fresh-agent selected run IDs do not match the protected campaign matrix");
    }
    for (const run of selectedRuns) {
      const taskGoal = agentTaskSet.get(run.taskId);
      if (run.promptSha256 !== sha256(taskGoal)) {
        throw new Error(`fresh-agent run does not bind the protected task goal: ${run.runId}`);
      }
      const expectedBootstrapMode = run.taskId === "research-map" && run.agentProfile === "codex" && run.runId.endsWith("_1")
        ? "agent-process-packed-cli-from-empty"
        : "pre-scaffolded-packed-cli";
      if (run.bootstrapMode !== expectedBootstrapMode
        || (run.agentProfile === "codex" && run.agentDriver !== "codex")
        || (run.agentProfile === "claude-code" && run.agentDriver !== "claude-code")) {
        throw new Error(`fresh-agent run does not match its derived campaign profile: ${run.runId}`);
      }
      const manifest = agentTrialManifests.get(run.runId);
      const evaluation = agentProtectedEvaluations.get(run.runId);
      const inventory = agentVisualInventories.get(run.runId);
      const browserCertification = agentBrowserCertifications.get(run.runId);
      const screenshotManifest = agentScreenshotManifests.get(run.runId);
      const protectedScreenshotManifest = agentProtectedScreenshotManifests.get(run.runId);
      if (!manifest || !evaluation || !inventory || !browserCertification || !screenshotManifest || !protectedScreenshotManifest) {
        throw new Error(`fresh-agent closure is incomplete for ${run.runId}`);
      }
      const manifestEvidence = Object.fromEntries(manifest.value.evidence.map((entry) => [entry.kind, entry]));
      if (manifest.fileSha256 !== run.manifestSha256
        || manifestEvidence["protected-evaluation"]?.sha256 !== evaluation.fileSha256
        || manifestEvidence["visual-review-inventory"]?.sha256 !== inventory.fileSha256
        || manifestEvidence["browser-certification"]?.sha256 !== browserCertification.fileSha256
        || manifestEvidence["screenshot-manifest"]?.sha256 !== screenshotManifest.fileSha256
        || browserCertification.fileSha256 !== screenshotManifest.fileSha256
        || JSON.stringify(browserCertification.value) !== JSON.stringify(screenshotManifest.value)
        || evaluation.value.candidateBrowserManifestSha256 !== screenshotManifest.fileSha256
        || evaluation.value.browserManifestSha256 !== protectedScreenshotManifest.fileSha256
        || evaluation.value.protectedTaskInput.inputToken !== protectedScreenshotManifest.certificationRunId
        || protectedScreenshotManifest.value.runId !== protectedScreenshotManifest.certificationRunId
        || evaluation.value.screenshotEvidenceRootSha256 !== browserScreenshotEvidenceRoot(protectedScreenshotManifest.value)
        || run.screenshotEvidenceRootSha256 !== browserScreenshotEvidenceRoot(protectedScreenshotManifest.value)
        || evaluation.value.visualReviewInventorySha256 !== inventory.fileSha256
        || evaluation.value.visualReviewInventorySelfHash !== inventory.value.inventorySha256
        || inventory.value.browserManifestSha256 !== protectedScreenshotManifest.fileSha256
        || inventory.value.screenshotEvidenceRootSha256 !== browserScreenshotEvidenceRoot(protectedScreenshotManifest.value)
        || inventory.value.evaluatorScreenshotSha256 !== run.evaluatorScreenshotSha256) {
        throw new Error(`fresh-agent semantic evidence bindings disagree for ${run.runId}`);
      }
      validateProtectedAgentEvaluation(evaluation.value, {
        ...freshAgentProtectedExpectation(run),
        protectedBrowserManifestSha256: protectedScreenshotManifest.fileSha256,
        visualReviewInventorySha256: inventory.fileSha256,
        visualReviewInventorySelfHash: inventory.value.inventorySha256,
      });
      validateVisualReviewInventory(inventory.value, {
        ...freshAgentProtectedExpectation(run),
        protectedBrowserManifestSha256: protectedScreenshotManifest.fileSha256,
      });
    }
    const normalizedVerdict = structuredClone(value);
    normalizedVerdict.selectedRuns = normalizedVerdict.selectedRuns.map((run) => {
      const evidence = run.evidence.map((entry) => ({
        ...entry,
        path: campaignRelativeAgentPath(entry.path, run.runId),
      }));
      return {
        ...run,
        evidence,
        evidenceSetSha256: sha256(JSON.stringify(evidence)),
        manifestPath: campaignRelativeAgentPath(run.manifestPath, run.runId),
      };
    });
    validateAgentEaseMeasurementVerdict(normalizedVerdict, {
      candidate: freshAgentCandidateExpectation(value),
      manifests: agentTrialManifests,
      runs: selectedRuns.map((run) => freshAgentRunExpectation(run, sha256(agentTaskSet.get(run.taskId)))),
    });
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
