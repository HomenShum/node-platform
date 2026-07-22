import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { evaluateDeveloperTimingMatrix } from "../src/lib/ease-evidence.mjs";
import { inspectNpmPackageArchiveBytes } from "../src/lib/npm-package-archive.mjs";
import {
  createSubmissionCandidateRecord,
  requiredSubmissionGates,
  transitiveSubmissionEvidence,
} from "../src/lib/submission-gate.mjs";
import {
  createExternalGateVerificationPayload,
  createProofLoopEaseVerificationPayload,
  createPublicationApprovalPayload,
  signDetachedAttestation,
} from "../src/lib/submission-attestation.mjs";

const defaultSourceHash = "b".repeat(64);
const timingLanes = ["windows/npm", "windows/pnpm", "ubuntu/npm", "ubuntu/pnpm", "macos/npm", "macos/pnpm"];
const agentTasks = ["research-map", "volunteer-onboarding", "launch-presentation"];
const agentProfileCounts = { codex: 3, "claude-code": 1, "lower-cost": 1 };
const agentEvidenceKinds = [
  "prompt", "prompt-hash", "environment", "interventions", "session", "final-report", "stderr", "token-usage",
  "command-ledger", "candidate-diff", "candidate-status", "candidate-commit", "application-identity", "candidate-archive",
  "browser-certification", "screenshot-manifest",
];
const browserStates = [
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
];
const browserViewports = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "wide", width: 1920, height: 1080 },
  { id: "tablet-landscape", width: 1024, height: 768 },
  { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "mobile-portrait", width: 390, height: 844 },
  { id: "mobile-landscape", width: 844, height: 390 },
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const browserFixtureCache = new Map();
const submissionCandidateFixtureCache = new Map();
const proofLoopFixtureKey = generateKeyPairSync("ed25519");
const publicationFixtureKey = generateKeyPairSync("ed25519");
const externallyObservedFixtureKeys = Object.fromEntries([
  "developerTimingMatrix",
  "freshAgentHeldout",
  "freshHumanUsability",
  "threeConvexConsumers",
  "previewDeployment",
  "managedSupabasePortability",
  "knowledgeEvolutionAdoption",
  "modelIntelligenceHarness",
].map((gateId) => [gateId, generateKeyPairSync("ed25519")]));
let packageArchiveFixture;
export const submissionFixtureTrustedKeys = Object.freeze({
  "proofloop-fixture": Object.freeze({ publicKey: proofLoopFixtureKey.publicKey, purposes: Object.freeze(["proofloopEaseVerification"]) }),
  "publication-fixture": Object.freeze({ publicKey: publicationFixtureKey.publicKey, purposes: Object.freeze(["publicationApproval"]) }),
  ...Object.fromEntries(Object.entries(externallyObservedFixtureKeys).map(([gateId, key]) => [
    `${gateId}-fixture`, Object.freeze({ publicKey: key.publicKey, purposes: Object.freeze([gateId]) }),
  ])),
});

function writeTarOctal(header, offset, length, value) {
  header.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function packageTarEntry(filePath, body) {
  const bytes = Buffer.from(body, "utf8");
  const header = Buffer.alloc(512);
  header.write(`package/${filePath}`, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, bytes.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0]).copy(header, 257);
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return [header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)];
}

function packageFixture() {
  if (packageArchiveFixture) return packageArchiveFixture;
  const packageJson = `${JSON.stringify({
    bin: { nodekit: "src/cli.mjs" },
    exports: { ".": "./src/index.mjs" },
    name: "@homenshum/nodekit",
    version: "0.2.1",
  }, null, 2)}\n`;
  const tar = Buffer.concat([
    ...packageTarEntry("package.json", packageJson),
    ...packageTarEntry("src/cli.mjs", "#!/usr/bin/env node\n"),
    ...packageTarEntry("src/index.mjs", "export const nodekit = true;\n"),
    Buffer.alloc(1024),
  ]);
  const tarball = gzipSync(tar, { level: 9 });
  const inspection = inspectNpmPackageArchiveBytes(tarball, {
    expectedName: "@homenshum/nodekit",
    expectedVersion: "0.2.1",
  });
  const distributionChecks = {
    caseflowTypes: true, convexClient: true, convexConfig: true, convexComponentApi: true, convexComponentRuntime: true,
    convexTestExport: true, postgresAdapter: true, postgresMigration: true, supabaseProfile: true, supabaseWorkers: true,
  };
  const archiveManifestSha256 = digest(JSON.stringify(inspection.fileManifest));
  packageArchiveFixture = {
    inspection,
    packageFiles: Buffer.from(`${JSON.stringify({
      archiveFiles: inspection.fileManifest,
      distribution: { checks: distributionChecks, missingBinTargets: [], missingExportTargets: [], passed: true },
      files: inspection.fileManifest,
      independentPacks: [1, 2].map((trial) => ({
        archiveBytes: inspection.tarballBytes,
        archiveManifestSha256,
        packFilesSha256: digest(`fixture-pack-files-${trial}`),
        tarballSha256: inspection.tarballSha256,
        trial,
      })),
      name: inspection.name,
      packFiles: inspection.fileManifest.map(({ path, size }) => ({ mode: 420, path, size })),
      reproducible: true,
      schemaVersion: "nodekit.packed-files/v1",
      version: inspection.version,
    }, null, 2)}\n`),
    tarball,
  };
  return packageArchiveFixture;
}
function timingReceipts(candidateCommit, sourceHash) {
  return timingLanes.flatMap((lane) => ["cold", "warm"].flatMap((cacheClass) => Array.from({ length: 5 }, (_, index) => {
    const receipt = {
      apiKeysRequired: 0,
      cacheClass,
      cacheIsolated: true,
      consoleErrors: 0,
      failedCommands: 0,
      generatedAt: "2026-07-22T00:00:00.000Z",
      horizontalOverflowPx: 0,
      lane,
      manualDecisions: 0,
      measurements: {
        scaffoldGenerationMs: 1,
        launcherInstallationMs: 1,
        generatedAppInstallationMs: 1,
        browserRuntimeInstallationMs: 1,
        dependencyInstallationMs: 3,
        compileMs: 1,
        serverReadinessMs: 1,
        firstMeaningfulPaintMs: 1,
        neutralJourneyMs: 1,
        totalMs: 9,
      },
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodeVersion: "v22.0.0",
      operatingSystem: `${{ windows: "win32-10.0.0-x64", ubuntu: "linux-6.0.0-x64", macos: "darwin-25.0.0-arm64" }[lane.split("/")[0]]}`,
      packageManager: lane.split("/")[1],
      packageManagerVersion: "10.0.0",
      nodekitPackage: "@homenshum/nodekit",
      nodekitVersion: "0.2.1",
      nodekitTarballSha256: packageFixture().inspection.tarballSha256,
      applicationHash: digest(`timing-${lane.split("/")[1]}-application`),
      configHash: digest(`timing-${lane.split("/")[1]}-config`),
      generatedCandidateCommit: (lane.endsWith("/npm") ? "c" : "d").repeat(40),
      generatedCandidateArchiveSha256: digest(`timing-${lane.split("/")[1]}-archive`),
      generatedCandidateArchiveBytes: 1,
      timerBoundary: "empty-launcher-before-package-json-to-completed-proof",
      ciProvenance: {
        provider: "github-actions",
        githubRunId: `${1000 + index}`,
        githubRunAttempt: 1,
        githubWorkflowRef: "HomenShum/node-platform/.github/workflows/ease-proof.yml@refs/heads/main",
        githubSha: candidateCommit,
        workflowFileSha256: digest("fixture-ease-proof-workflow"),
        runnerArch: lane.startsWith("macos") ? "ARM64" : "X64",
        runnerImageOs: lane.split("/")[0],
        runnerImageVersion: "20260722.1",
        runnerName: `hosted-${lane.split("/")[0]}`,
        runnerOs: lane.split("/")[0],
      },
      receiptProduced: true,
      reloadPreserved: true,
      runId: `${lane}/${cacheClass}/${index}`,
      schemaVersion: "nodekit.developer-timing-run/v1",
      sourceEdits: 0,
    };
    return { ...receipt, receiptSha256: digest(JSON.stringify(receipt)) };
  })));
}
function browserFixtureParts(root, candidateCommit, sourceHash) {
  const applicationHash = digest(`${root}/application`);
  const configHash = digest(`${root}/config`);
  const screenshots = browserStates.flatMap((state) => browserViewports.flatMap((viewport) => ["light", "dark"].map((theme) => {
    const path = `browser/screenshots/${state}--${viewport.id}--${theme}.png`;
    const sidecarPath = path.replace(/\.png$/, ".json");
    const png = Buffer.from(`PNG:${root}:${state}:${viewport.id}:${theme}\n`);
    const sidecar = {
      applicationHash,
      capturedAt: "2026-07-22T00:00:00.000Z",
      configHash,
      consoleErrors: 0,
      elapsedMs: 1,
      failedRequests: 0,
      generatedCandidateCommit: candidateCommit,
      horizontalOverflowPx: 0,
      mojibakeDetected: false,
      nodekitCommit: candidateCommit,
      nodekitIdentity: `${candidateCommit}/${sourceHash}`,
      nodekitSourceHash: sourceHash,
      pageUrl: `http://127.0.0.1/?scenario=${state}`,
      pngSha256: digest(png),
      runId: `browser_${digest(root).slice(0, 12)}`,
      schemaVersion: "nodekit.screenshot-proof/v1",
      serverProcess: { command: "node apps/web/server.mjs", pid: 1 },
      state,
      theme,
      viewportId: viewport.id,
      viewport: { height: viewport.height, width: viewport.width },
    };
    const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
    return {
      ...sidecar,
      path,
      pngBytes: png.length,
      sidecarBytes: sidecarBytes.length,
      sidecarPath,
      sidecarSha256: digest(sidecarBytes),
    };
  })));
  const artifactSpecs = [
    ["playwright-trace", "browser/playwright-trace.zip", "trace"],
    ["browser-video", "browser/journey.webm", "video"],
    ["portable-proof-bundle", "browser/nodekit-proof.json", "portable-proof"],
    ["browser-console", "browser/console.jsonl", ""],
    ["browser-network", "browser/network.jsonl", ""],
  ];
  const evidenceArtifacts = artifactSpecs.map(([id, path, value]) => {
    const bytes = Buffer.from(value ? `${value}:${root}\n` : "");
    return { byteSize: bytes.length, id, path, sha256: digest(bytes) };
  });
  const manifest = {
    accessibilityViolations: [],
    applicationHash,
    certified: true,
    configHash,
    consoleErrors: [],
    coveredStates: [...browserStates],
    durationMs: 1,
    error: null,
    evidenceArtifacts,
    firstMeaningfulPaintMs: 1,
    generatedAt: "2026-07-22T00:00:01.000Z",
    generatedCandidateCommit: candidateCommit,
    journeyAssertions: { exactStateMatrix: true, exportReopened: true, receiptVisible: true },
    milestones: [],
    missingStates: [],
    networkFailures: [],
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${sourceHash}`,
    nodekitSourceHash: sourceHash,
    passed: true,
    phases: [],
    requiredStates: [...browserStates],
    runId: `browser_${digest(root).slice(0, 12)}`,
    schemaVersion: "nodekit.browser-certification/v1",
    screenshots,
    startedAt: "2026-07-22T00:00:00.000Z",
    verdict: "BROWSER_CERTIFIED",
  };
  manifest.manifestSha256 = digest(JSON.stringify(manifest));
  return { artifactSpecs, evidenceArtifacts, manifest, screenshots };
}

function browserFixtureBytes(evidencePath, candidateCommit, sourceHash) {
  const marker = "browser/";
  const markerIndex = evidencePath.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const root = evidencePath.slice(0, markerIndex);
  const childPath = evidencePath.slice(markerIndex);
  const cacheKey = `${root}\0${candidateCommit}\0${sourceHash}`;
  let parts = browserFixtureCache.get(cacheKey);
  if (!parts) {
    parts = browserFixtureParts(root, candidateCommit, sourceHash);
    browserFixtureCache.set(cacheKey, parts);
  }
  if (childPath === "browser/screenshot-manifest.json") return Buffer.from(`${JSON.stringify(parts.manifest, null, 2)}\n`);
  const screenshot = parts.screenshots.find((entry) => entry.path === childPath || entry.sidecarPath === childPath);
  if (screenshot?.path === childPath) return Buffer.from(`PNG:${root}:${screenshot.state}:${screenshot.viewportId}:${screenshot.theme}\n`);
  if (screenshot?.sidecarPath === childPath) {
    const { path: _path, pngBytes: _pngBytes, sidecarBytes: _sidecarBytes, sidecarPath: _sidecarPath, sidecarSha256: _sidecarSha256, ...sidecar } = screenshot;
    return Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
  }
  const artifact = parts.evidenceArtifacts.find((entry) => entry.path === childPath);
  if (artifact) {
    const spec = parts.artifactSpecs.find(([, path]) => path === childPath);
    return Buffer.from(spec?.[2] ? `${spec[2]}:${root}\n` : "");
  }
  return null;
}

export function submissionEvidenceFixtureBytes(evidencePath, candidateCommit = "a".repeat(40), sourceHash = defaultSourceHash) {
  if (evidencePath === "proof/submission-candidate.json") {
    const bytes = submissionCandidateFixtureCache.get(`${candidateCommit}\0${sourceHash}`);
    if (!bytes) throw new Error("submission candidate fixture must be composed from every pre-approval gate before it is referenced");
    return bytes;
  }
  const engineeringCheck = evidencePath.match(/^proof\/engineering\/checks\/([A-Za-z0-9]+)\.json$/);
  if (engineeringCheck) {
    const engineeringCommands = {
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
    };
    return Buffer.from(`${JSON.stringify({
    schemaVersion: "nodekit.engineering-check-receipt/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    checkId: engineeringCheck[1],
    command: engineeringCommands[engineeringCheck[1]],
    exitCode: 0,
    startedAt: "2026-07-22T00:00:00.000Z",
    completedAt: "2026-07-22T00:00:01.000Z",
    }, null, 2)}\n`);
  }
  if (evidencePath === "proof/engineering/issue-inventory.json") return Buffer.from(`${JSON.stringify({
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    generatedAt: "2026-07-22T00:00:01.000Z",
    counts: { p0: 0, p1: 0 },
    issues: [],
  }, null, 2)}\n`);
  if (evidencePath === "proof/ease/developer-timing-runs.json") return Buffer.from(`${JSON.stringify(timingReceipts(candidateCommit, sourceHash), null, 2)}\n`);
  if (evidencePath === "proof/nodekit.tgz" || /^proof\/consumers\/[^/]+\/nodekit-component\.tgz$/.test(evidencePath)) return packageFixture().tarball;
  if (evidencePath.endsWith("/package-files.json")) return packageFixture().packageFiles;
  const browser = browserFixtureBytes(evidencePath, candidateCommit, sourceHash);
  return browser ?? Buffer.from(`nodekit submission fixture: ${evidencePath}\n`);
}

export function submissionEvidenceFixtureClosure(manifestPath, candidateCommit = "a".repeat(40), sourceHash = defaultSourceHash) {
  const manifest = JSON.parse(submissionEvidenceFixtureBytes(manifestPath, candidateCommit, sourceHash).toString("utf8"));
  const root = manifestPath.slice(0, -"browser/screenshot-manifest.json".length);
  return [
    ...manifest.screenshots.flatMap((entry) => [
      { bytes: entry.pngBytes, path: `${root}${entry.path}`, sha256: entry.pngSha256 },
      { bytes: entry.sidecarBytes, path: `${root}${entry.sidecarPath}`, sha256: entry.sidecarSha256 },
    ]),
    ...manifest.evidenceArtifacts.map((entry) => ({ bytes: entry.byteSize, path: `${root}${entry.path}`, sha256: entry.sha256 })),
  ];
}

const fixtureRef = (evidencePath, kind, candidateCommit = "a".repeat(40), sourceHash = defaultSourceHash) => ({
  ...(kind ? { kind } : {}),
  path: evidencePath,
  sha256: digest(submissionEvidenceFixtureBytes(evidencePath, candidateCommit, sourceHash)),
});

function submissionCandidateGateEvidence(id, value, candidateCommit, sourceHash) {
  const decisivePaths = {
    developerTimingMatrix: "proof/ease/developer-timing-verdict.json",
    freshAgentHeldout: "proof/ease/fresh-agent-verdict.json",
    freshHumanUsability: "proof/ease/fresh-users-verdict.json",
    threeConvexConsumers: "proof/convex-consumers-verdict.json",
    previewDeployment: "proof/preview-verdict.json",
    managedSupabasePortability: "proof/managed-supabase-portability-verdict.json",
    knowledgeEvolutionAdoption: "proof/knowledge-evolution-adoption-verdict.json",
    modelIntelligenceHarness: "proof/model-intelligence-harness-verdict.json",
    engineeringHealth: "proof/engineering-health-verdict.json",
    proofloopEaseVerification: "proof/proofloop-final.json",
    packageInstallProof: "proof/package-install-verdict.json",
  };
  const decisiveBytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const evidence = [{ path: decisivePaths[id], sha256: digest(decisiveBytes) }];
  let previewManifestPath = null;
  for (const reference of transitiveSubmissionEvidence(id, value)) {
    evidence.push({ path: reference.path, sha256: reference.sha256 });
    if (id === "previewDeployment" && reference.kind === "screenshot-manifest") previewManifestPath = reference.path;
  }
  // Submission preparation first records every direct reference and only then
  // appends the screenshot manifest's closed set of PNGs, sidecars, and media.
  if (previewManifestPath) {
    for (const child of submissionEvidenceFixtureClosure(previewManifestPath, candidateCommit, sourceHash)) {
      evidence.push({ path: child.path, sha256: child.sha256 });
    }
  }
  return { id, passed: true, evidence };
}

const humanSelectedParticipants = () => Array.from({ length: 5 }, (_, index) => ({
  participantId: `participant-${index + 1}`,
  fresh: true,
  consentRecorded: true,
  sessionStartedAt: "2026-07-22T00:00:00.000Z",
  sessionCompletedAt: "2026-07-22T00:02:00.000Z",
  evidenceRefs: [
    fixtureRef(`proof/ease/humans/participant-${index + 1}/completion.png`, "screenshot"),
    fixtureRef(`proof/ease/humans/participant-${index + 1}/session.json`, "session-log"),
  ],
  firstMeaningfulActionMs: 10_000,
  neutralJourneyMs: 90_000,
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

export function exactSubmissionVerdicts(candidateCommit, sourceHash = defaultSourceHash) {
  const nodekitIdentity = `${candidateCommit}/${sourceHash}`;
  const releaseCandidate = {
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: digest(submissionEvidenceFixtureBytes("proof/nodekit.tgz", candidateCommit, sourceHash)),
    packageName: "@homenshum/nodekit",
    packageVersion: "0.2.1",
  };
  const timingVerdict = evaluateDeveloperTimingMatrix(timingReceipts(candidateCommit, sourceHash));
  timingVerdict.releaseCandidate = { ...releaseCandidate };
  timingVerdict.supportingEvidence = [{
    kind: "timing-receipts",
    path: "proof/ease/developer-timing-runs.json",
    sha256: digest(submissionEvidenceFixtureBytes("proof/ease/developer-timing-runs.json", candidateCommit, sourceHash)),
  }];
  const selectedAgentRuns = agentTasks.flatMap((taskId) => Object.entries(agentProfileCounts).flatMap(([agentProfile, count]) =>
    Array.from({ length: count }, (_, index) => {
      const runId = `agent_${taskId}_${agentProfile}_${index + 1}`;
      const evidence = agentEvidenceKinds.map((kind) => {
        const fullPath = `proof/ease/agents/${runId}/${kind}.json`;
        const bytes = submissionEvidenceFixtureBytes(fullPath);
        return { bytes: bytes.length, kind, path: fullPath, sha256: digest(bytes) };
      });
      const manifestPath = `proof/ease/agents/${runId}/manifest.json`;
      return {
        agentDriver: agentProfile === "claude-code" ? "claude-code" : "codex",
        agentModel: agentProfile === "lower-cost" ? "explicit-lower-cost-model" : null,
        agentProfile,
        agentSessionId: `session_${runId}`,
        agentVersion: `${agentProfile} test version`,
        applicationHash: digest(`${runId}/application`),
        configHash: digest(`${runId}/config`),
        evidence,
        evidenceCount: evidence.length,
        evidenceSetSha256: digest(JSON.stringify(evidence)),
        freshSession: true,
        generatedAt: "2026-07-22T00:05:00.000Z",
        manifestPath,
        manifestSha256: digest(submissionEvidenceFixtureBytes(manifestPath)),
        nodekitCommit: candidateCommit,
        nodekitSourceHash: sourceHash,
        nodekitPackage: releaseCandidate.packageName,
        nodekitTarballSha256: releaseCandidate.nodekitTarballSha256,
        nodekitVersion: releaseCandidate.packageVersion,
        passed: true,
        promptSha256: digest(`${runId}/prompt`),
        receiptSha256: digest(`${runId}/receipt`),
        runId,
        taskId,
        trialStartedAt: "2026-07-22T00:00:00.000Z",
        validationPassed: true,
      };
    })));
  const consumers = ["noderoom", "nodeslide", "nodevideo"].map((id, index) => ({
    ...(() => {
      const evidence = [
        fixtureRef(`proof/consumers/${id}/nodekit-component.tgz`, "component-tarball"),
        fixtureRef(`proof/consumers/${id}/consumer-verdict.json`, "consumer-verdict"),
        fixtureRef(`proof/consumers/${id}/browser/screenshot-manifest.json`, "screenshot-manifest", candidateCommit, sourceHash),
      ];
      return { evidence };
    })(),
    id,
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    consumerCommit: ["c", "d", "e"][index].repeat(40),
    componentTarballSha256: releaseCandidate.nodekitTarballSha256,
    verdictSha256: digest(submissionEvidenceFixtureBytes(`proof/consumers/${id}/consumer-verdict.json`)),
    checks: {
      packagedComponentInstalled: true,
      componentRegistered: true,
      authenticatedOwnerScope: true,
      crossOwnerDenied: true,
      staleConflictProtected: true,
      idempotentRetries: true,
      exceptionRecovery: true,
      receiptVerified: true,
      conformancePassed: true,
    },
    liveFlowAdoption: {
      passed: true,
      signedIn: true,
      browserJourneyPassed: true,
      screenshotManifestSha256: digest(submissionEvidenceFixtureBytes(`proof/consumers/${id}/browser/screenshot-manifest.json`, candidateCommit, sourceHash)),
    },
  }));
  const verdicts = {
    developerTimingMatrix: timingVerdict,
    freshAgentHeldout: {
      schemaVersion: "nodekit.fresh-agent-verdict/v2",
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      passed: true,
      errors: [],
      allAttemptsSelected: true,
      failedTrials: 0,
      ignoredOtherCandidateTrials: 0,
      legacyTrialsIgnored: 0,
      observedRepositoryTrials: 15,
      observedTrials: 15,
      requiredProfiles: { ...agentProfileCounts },
      requiredRuns: 15,
      requiredTasks: agentTasks,
      selectedRuns: selectedAgentRuns,
    },
    freshHumanUsability: {
      schemaVersion: "nodekit.fresh-user-verdict/v1",
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      applicationHash: digest("human-application"),
      configHash: digest("human-config"),
      passed: true,
      errors: [],
      evidenceFilesVerified: true,
      checks: {
        participantCount: true,
        unassistedCompletion: true,
        outcomeUnderstood: true,
        finalArtifactLocated: true,
        unresolvedIssuesLocated: true,
        firstMeaningfulAction: true,
        neutralJourney: true,
        singleEaseQuestion: true,
        noP0P1Failures: true,
        evidenceFilesVerified: true,
      },
      selectedParticipants: humanSelectedParticipants(),
      metrics: {
        participantCount: 5,
        unassistedCompletions: 5,
        outcomeExplanations: 5,
        finalArtifactsLocated: 5,
        unresolvedIssuesLocated: 5,
        medianFirstMeaningfulActionMs: 10_000,
        medianNeutralJourneyMs: 90_000,
        medianSingleEaseQuestion: 7,
        p0P1Failures: 0,
      },
    },
    threeConvexConsumers: {
      schemaVersion: "nodekit.convex-consumers-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      passed: true,
      qualifyingConsumers: 3,
      consumers,
    },
    previewDeployment: {
      schemaVersion: "nodekit.preview-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      applicationHash: digest("preview-application"),
      configHash: digest("preview-config"),
      deploymentCommit: candidateCommit,
      deploymentUrl: "https://nodekit-fixture-preview.example.test",
      deploymentProvider: "fixture-host",
      deploymentEnvironment: "preview",
      deploymentIdentity: "fixture-host:deployment_01NODEKIT",
      deploymentReceipt: {
        path: "proof/preview/deployment-receipt.json",
        sha256: digest(submissionEvidenceFixtureBytes("proof/preview/deployment-receipt.json")),
        issuedAt: "2026-07-22T00:03:00.000Z",
      },
      passed: true,
      freshIdentity: true,
      realFixtureBytes: true,
      frontendBackendCommitMatch: true,
      browserJourneyPassed: true,
      exportReopenPassed: true,
      cleanupPassed: true,
      screenshotCount: 180,
      consoleErrors: 0,
      networkFailures: 0,
      seriousAccessibilityViolations: 0,
      browserProofSha256: digest(submissionEvidenceFixtureBytes("proof/preview/browser-proof.json")),
      screenshotManifestSha256: digest(submissionEvidenceFixtureBytes("proof/preview/browser/screenshot-manifest.json", candidateCommit, sourceHash)),
      evidence: [
        fixtureRef("proof/preview/browser-proof.json", "browser-proof"),
        fixtureRef("proof/preview/browser/screenshot-manifest.json", "screenshot-manifest", candidateCommit, sourceHash),
        fixtureRef("proof/preview/exported-artifact.bin", "exported-artifact"),
        fixtureRef("proof/preview/reopen-score.json", "reopen-score"),
        fixtureRef("proof/preview/cleanup-receipt.json", "cleanup-receipt"),
        fixtureRef("proof/preview/deployment-receipt.json", "deployment-receipt"),
      ],
    },
    managedSupabasePortability: {
      schemaVersion: "nodekit.managed-supabase-portability-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      passed: true,
      projectRef: "fixture-project",
      projectUrl: "https://fixture-project.supabase.co",
      environment: "managed-supabase",
      testedAt: "2026-07-22T00:04:00.000Z",
      checks: {
        authenticatedOwnerRead: true,
        crossOwnerDenied: true,
        directLifecycleWritesDenied: true,
        proposalRpcPrincipalDerived: true,
        storageBytesRoundTrip: true,
        realtimeDelivery: true,
        queueIsolation: true,
        queueConsumption: true,
        boundedCronInvocation: true,
        exportImportHashesMatch: true,
      },
      exportImport: {
        sourceProvider: "convex",
        targetProvider: "supabase",
        sourceArtifactSha256: digest("portable-artifact"),
        targetArtifactSha256: digest("portable-artifact"),
        sourceReceiptSha256: digest("portable-receipt"),
        targetReceiptSha256: digest("portable-receipt"),
      },
      evidence: [
        fixtureRef("proof/supabase/auth-rls-report.json", "auth-rls-report"),
        fixtureRef("proof/supabase/storage-roundtrip.json", "storage-roundtrip"),
        fixtureRef("proof/supabase/realtime-delivery.json", "realtime-delivery"),
        fixtureRef("proof/supabase/queue-report.json", "queue-report"),
        fixtureRef("proof/supabase/cron-report.json", "cron-report"),
        fixtureRef("proof/supabase/export-import-report.json", "export-import-report"),
        fixtureRef("proof/supabase/managed-service-receipt.json", "managed-service-receipt"),
      ],
    },
    knowledgeEvolutionAdoption: {
      schemaVersion: "nodekit.knowledge-evolution-adoption-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      passed: true,
      comparisonId: "knowledge-comparison-fixture",
      completedAt: "2026-07-22T00:05:00.000Z",
      comparison: {
        taskCount: 3,
        protectedBenchmarkSha256: digest("knowledge-benchmark"),
        harnessSha256: digest("knowledge-harness"),
        flatScore: 0.7,
        staticGraphScore: 0.8,
        evolvingGraphScore: 0.85,
        outcome: "improved",
      },
      consumerAdoption: { consumerId: "fixture-consumer", consumerCommit: "f".repeat(40), adopted: true },
      ledgerEventId: "evt-knowledge-fixture",
      checks: {
        sameInputs: true,
        protectedEvaluatorUnchanged: true,
        flatBaselineCompleted: true,
        staticGraphCompleted: true,
        evolvingGraphCompleted: true,
        performanceImprovedOrHeld: true,
        noProtectedTaskRegression: true,
        humanReviewedLedgerEvent: true,
        downstreamConsumerAdopted: true,
        receiptVerified: true,
      },
      evidence: [
        fixtureRef("proof/evolution/protected-comparison.json", "protected-comparison"),
        fixtureRef("proof/evolution/evaluator-identity.json", "evaluator-identity"),
        fixtureRef("proof/evolution/consumer-adoption.json", "consumer-adoption"),
        fixtureRef("proof/evolution/ledger-event.json", "evolution-ledger-event"),
        fixtureRef("proof/evolution/evolution-receipt.json", "evolution-receipt"),
      ],
    },
    modelIntelligenceHarness: {
      schemaVersion: "nodekit.model-intelligence-harness-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      passed: true,
      projectId: "fixture-project",
      observationId: "observation-fixture",
      provider: "fixture-provider",
      model: "fixture-live-model",
      observedAt: "2026-07-22T00:06:00.000Z",
      promotionStatus: "provisional",
      evaluation: {
        taskCount: 3,
        protectedBenchmarkSha256: digest("model-benchmark"),
        harnessSha256: digest("model-harness"),
        protectedEvaluatorSha256: digest("model-evaluator"),
        score: 0.9,
      },
      freshAgentCanary: { sessionId: "fresh-canary-fixture", fresh: true, passed: true },
      checks: {
        liveExactModelObservation: true,
        projectScopedCapabilityCard: true,
        protectedApplicationGym: true,
        independentEvaluation: true,
        protectedEvaluatorUnchanged: true,
        freshAgentCanary: true,
        provisionalPromotionOnly: true,
        noAutomaticPromotion: true,
        receiptVerified: true,
      },
      evidence: [
        fixtureRef("proof/model/model-observation.json", "model-observation"),
        fixtureRef("proof/model/capability-card.json", "capability-card"),
        fixtureRef("proof/model/application-gym.json", "application-gym"),
        fixtureRef("proof/model/independent-evaluation.json", "independent-evaluation"),
        fixtureRef("proof/model/fresh-agent-canary.json", "fresh-agent-canary"),
        fixtureRef("proof/model/promotion-receipt.json", "promotion-receipt"),
      ],
    },
    engineeringHealth: {
      schemaVersion: "nodekit.engineering-health-verdict/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      completedAt: "2026-07-22T00:07:00.000Z",
      passed: true,
      checks: {
        repositoryTests: true,
        componentTests: true,
        publicTypecheck: true,
        componentTypecheck: true,
        componentBuild: true,
        packageAudit: true,
        registry: true,
        ecosystem: true,
        evolution: true,
        distributionClean: true,
      },
      unresolved: { p0: 0, p1: 0 },
      commands: [
        "repositoryTests", "componentTests", "publicTypecheck", "componentTypecheck", "componentBuild",
        "packageAudit", "registry", "ecosystem", "evolution", "distributionClean",
      ].map((id) => fixtureRef(`proof/engineering/checks/${id}.json`, undefined, candidateCommit, sourceHash)).map((ref, index) => ({
        id: [
          "repositoryTests", "componentTests", "publicTypecheck", "componentTypecheck", "componentBuild",
          "packageAudit", "registry", "ecosystem", "evolution", "distributionClean",
        ][index],
        path: ref.path,
        sha256: ref.sha256,
      })),
      issueInventory: {
        ...fixtureRef("proof/engineering/issue-inventory.json", undefined, candidateCommit, sourceHash),
        p0: 0,
        p1: 0,
      },
    },
    proofloopEaseVerification: {
      subject: { repository: { candidateCommit, nodekitSourceHash: sourceHash } },
      releaseCandidate: { ...releaseCandidate },
      verdict: { status: "passed" },
      extensions: {
        easeCertified: true,
        independentVerifier: true,
        checks: {
          package: true, timing: true, agents: true, humans: true, consumers: true, preview: true,
          supabase: true, evolution: true, model: true, engineering: true, browser: true,
        },
        decisiveEvidence: ["package", "timing", "agents", "humans", "consumers", "preview", "supabase", "evolution", "model", "engineering", "browser"]
          .map((kind) => fixtureRef(`proof/proofloop/${kind}.json`, kind)),
      },
    },
    packageInstallProof: {
      schemaVersion: "nodekit.package-install-proof/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      package: "@homenshum/nodekit",
      version: "0.2.1",
      passed: true,
      publicationPerformed: false,
      deployPerformed: false,
      tarball: "proof/nodekit.tgz",
      tarballBytes: submissionEvidenceFixtureBytes("proof/nodekit.tgz").length,
      unpackedSize: packageFixture().inspection.unpackedSize,
      fileCount: packageFixture().inspection.fileCount,
      tarballSha256: digest(submissionEvidenceFixtureBytes("proof/nodekit.tgz")),
      checks: {
        candidateIdentityStable: true, convexComponentRuntime: true, freshConsumerInstall: true, packagedCliCreate: true,
        generatedAppInstall: true, compile: true, check: true, demo: true, eval: true, typecheckPublic: true,
        receiptsValid: true, tarballHashStable: true, distributionComplete: true,
      },
      distributionChecks: {
        caseflowTypes: true, convexClient: true, convexConfig: true, convexComponentApi: true, convexComponentRuntime: true,
        convexTestExport: true, postgresAdapter: true, postgresMigration: true, supabaseProfile: true,
        supabaseWorkers: true,
      },
      supportingEvidence: [
        "application-identity.json", "demo-receipt.json", "eval-receipt.json", "convex-runtime-proof.mjs",
        "command-ledger.json", "package-files.json", "public-api.ts", "convex-runtime-proof.json",
        "generated-package.json", "generated-package-lock.json", "generated-npm-ls.json", "installed-runtime-identity.json",
        "generated-receipt-bindings.json", "generated-app.tar.gz", "generated-candidate.json",
      ].map((file) => fixtureRef(`proof/package/${file}`)),
    },
    publicationApproval: {
      schemaVersion: "nodekit.publication-approval/v1",
      candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity,
      releaseCandidate: { ...releaseCandidate },
      approved: true,
      approvedAt: "2026-07-22T00:00:00.000Z",
      approvedBy: "owner",
      scopes: ["npm-publish", "convex-directory-submit"],
    },
  };
  for (const gateId of Object.keys(externallyObservedFixtureKeys)) {
    const verdict = verdicts[gateId];
    verdict.attestationPayload = createExternalGateVerificationPayload({
      type: gateId,
      candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitTarballSha256: releaseCandidate.nodekitTarballSha256,
      evidence: transitiveSubmissionEvidence(gateId, verdict),
      verdict,
    });
    verdict.attestation = signDetachedAttestation({
      payload: verdict.attestationPayload,
      privateKey: externallyObservedFixtureKeys[gateId].privateKey,
      keyId: `${gateId}-fixture`,
      signedAt: "2026-07-22T00:00:00.000Z",
    });
  }
  const decisivePaths = {
    package: "proof/package-install-verdict.json",
    timing: "proof/ease/developer-timing-verdict.json",
    agents: "proof/ease/fresh-agent-verdict.json",
    humans: "proof/ease/fresh-users-verdict.json",
    consumers: "proof/convex-consumers-verdict.json",
    preview: "proof/preview-verdict.json",
    supabase: "proof/managed-supabase-portability-verdict.json",
    evolution: "proof/knowledge-evolution-adoption-verdict.json",
    model: "proof/model-intelligence-harness-verdict.json",
    engineering: "proof/engineering-health-verdict.json",
  };
  const gateByKind = {
    package: "packageInstallProof",
    timing: "developerTimingMatrix",
    agents: "freshAgentHeldout",
    humans: "freshHumanUsability",
    consumers: "threeConvexConsumers",
    preview: "previewDeployment",
    supabase: "managedSupabasePortability",
    evolution: "knowledgeEvolutionAdoption",
    model: "modelIntelligenceHarness",
    engineering: "engineeringHealth",
  };
  verdicts.proofloopEaseVerification.extensions.decisiveEvidence = Object.entries(decisivePaths).map(([kind, path]) => ({
    kind,
    path,
    sha256: digest(Buffer.from(`${JSON.stringify(verdicts[gateByKind[kind]])}\n`)),
  }));
  verdicts.proofloopEaseVerification.extensions.decisiveEvidence.push({
    kind: "browser",
    path: "proof/preview/browser/screenshot-manifest.json",
    sha256: verdicts.previewDeployment.screenshotManifestSha256,
  });
  const verification = fixtureRef("proof/proofloop/independent-verification.json");
  verdicts.proofloopEaseVerification.extensions.attestationPayload = createProofLoopEaseVerificationPayload({
    candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: releaseCandidate.nodekitTarballSha256,
    decisiveEvidence: verdicts.proofloopEaseVerification.extensions.decisiveEvidence,
    verification,
  });
  verdicts.proofloopEaseVerification.extensions.attestation = signDetachedAttestation({
    payload: verdicts.proofloopEaseVerification.extensions.attestationPayload,
    privateKey: proofLoopFixtureKey.privateKey,
    keyId: "proofloop-fixture",
    signedAt: "2026-07-22T00:00:00.000Z",
  });
  const candidateGates = requiredSubmissionGates
    .filter((id) => id !== "publicationApproval")
    .map((id) => submissionCandidateGateEvidence(id, verdicts[id], candidateCommit, sourceHash));
  const submissionCandidate = createSubmissionCandidateRecord({
    candidateCommit,
    candidateSourceHash: sourceHash,
    gates: candidateGates,
    releaseCandidate,
  });
  const submissionCandidateBytes = Buffer.from(`${JSON.stringify(submissionCandidate, null, 2)}\n`, "utf8");
  submissionCandidateFixtureCache.set(`${candidateCommit}\0${sourceHash}`, submissionCandidateBytes);
  const submissionManifest = fixtureRef("proof/submission-candidate.json", undefined, candidateCommit, sourceHash);
  verdicts.publicationApproval.attestationPayload = createPublicationApprovalPayload({
    candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: releaseCandidate.nodekitTarballSha256,
    submissionManifest,
    scopes: verdicts.publicationApproval.scopes,
  });
  verdicts.publicationApproval.attestation = signDetachedAttestation({
    payload: verdicts.publicationApproval.attestationPayload,
    privateKey: publicationFixtureKey.privateKey,
    keyId: "publication-fixture",
    signedAt: "2026-07-22T00:00:00.000Z",
  });
  return verdicts;
}
