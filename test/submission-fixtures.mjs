import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { createProtectedTaskInput, protectedTaskInputSha256 } from "../src/lib/agent-ease-campaign.mjs";
import { evaluateDeveloperTimingMatrix } from "../src/lib/ease-evidence.mjs";
import {
  createKnowledgeComparisonExecutionReceipt,
  createProtectedKnowledgeComparisonDefinition,
  runProtectedKnowledgeComparison,
} from "../src/lib/knowledge-comparison.mjs";
import { knowledgeRuntimeHash, retrieveAcceptedKnowledge } from "../src/lib/knowledge-runtime.mjs";
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
const agentCampaignId = "fixture-campaign";
const agentTaskSetBytes = readFileSync(new URL("../evals/ease/heldout-tasks.json", import.meta.url));
const agentTaskDefinitions = Object.freeze(JSON.parse(agentTaskSetBytes.toString("utf8")).tasks.map(Object.freeze));
const agentProtectedSourceBytes = Object.freeze(Object.fromEntries([
  "scripts/run-agent-ease-trial.mjs",
  "scripts/run-protected-agent-evaluator.mjs",
  "scripts/run-protected-browser-lane.mjs",
  "scripts/run-agent-provider-broker.mjs",
].map((relative) => [relative, readFileSync(new URL(`../${relative}`, import.meta.url))])));
const agentProfileCounts = { codex: 3, "claude-code": 1, "lower-cost": 1 };
const agentEvidenceKinds = [
  "prompt", "prompt-hash", "environment", "interventions", "session", "final-report", "stderr", "token-usage",
  "command-ledger", "candidate-diff", "candidate-status", "candidate-commit", "application-identity", "candidate-archive",
  "browser-certification", "screenshot-manifest", "protected-evaluation", "evaluator-screenshot", "visual-review-inventory",
];
const agentEvidencePaths = Object.freeze({
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
const agentPassingChecks = Object.freeze(Object.fromEntries([
  "agentBootstrapBound", "agentEnvironmentIsolated", "agentImplemented", "agentReportedCompletion", "agentSessionIdentityRecorded",
  "agentVersionRecorded", "applicationIdentityRecorded", "browserContract", "browserJourney", "browserRuntime", "candidateArchive",
  "check", "compile", "demo", "eval", "evidenceComplete", "localInstructionsBound", "nodekitIdentityStable", "nodekitRuntimeBound",
  "nodekitTarballStable", "postAgentTreeStable", "proof", "protectedEvaluation", "protectedEvaluatorStable", "protectedIsolation",
  "taskSpecificOutput", "visualReview",
].map((name) => [name, true])));
const protectedEvaluationChecks = Object.freeze(Object.fromEntries([
  "applicationIdentityBound", "artifactDownloadVerified", "artifactReloadPersistenceVerified", "artifactReopenPersistenceVerified",
  "browserEvidenceBound", "candidateArchiveBound", "candidateTreeBound", "evaluatorBytesBound", "guidedInteractionPassed",
  "independentScreenshotCaptured", "isolationBound", "renderedTaskRelevant", "sourceTaskRelevant", "taskBytesBound",
  "taskInputBound", "taskSetBound", "typedArtifactVerified", "visualReviewPassed",
].map((name) => [name, true])));
const lowerCostPricingSnapshot = Object.freeze({
  schemaVersion: "nodekit.external-source-snapshot/v1",
  retrievedAt: "2026-07-22T00:00:00.000Z",
  retrievalMethod: "OpenAI Developer Docs official pricing snapshot",
  source: "https://developers.openai.com/api/docs/pricing",
  section: "Flagship models / Standard",
  unit: "USD per 1M tokens",
  columns: ["model", "input", "cachedInput", "cacheWrite", "output"],
  rows: [
    ["gpt-5.6-sol", 5, 0.5, 6.25, 30],
    ["gpt-5.6-terra", 2.5, 0.25, 3.125, 15],
    ["gpt-5.6-luna", 1, 0.1, 1.25, 6],
  ],
  scope: "Fixture snapshot preserving the official-source pricing fields required to replay the lower-cost lane decision.",
});
const lowerCostPricingSnapshotBytes = Buffer.from(`${JSON.stringify(lowerCostPricingSnapshot, null, 2)}\n`);
const lowerCostModelEvidence = Object.freeze({
  schemaVersion: "nodekit.lower-cost-model-evidence/v1",
  agentDriver: "codex",
  model: "gpt-5.6-luna",
  lowerCost: { inputUsdPerMillion: 1, outputUsdPerMillion: 6 },
  comparators: [{ model: "gpt-5.6-sol", inputUsdPerMillion: 5, outputUsdPerMillion: 30 }],
  observedAt: lowerCostPricingSnapshot.retrievedAt,
  passed: true,
  source: {
    url: lowerCostPricingSnapshot.source,
    snapshotPath: "lower-cost-source.snapshot.json",
    snapshotSha256: createHash("sha256").update(lowerCostPricingSnapshotBytes).digest("hex"),
  },
});
const lowerCostModelEvidenceBytes = Buffer.from(`${JSON.stringify(lowerCostModelEvidence, null, 2)}\n`);
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
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const portableContentHash = (value) => digest(canonicalJson(value));
const browserFixtureCache = new Map();
const pngFixtureCache = new Map();
const freshAgentFixtureCache = new Map();
const submissionCandidateFixtureCache = new Map();
const protectedKnowledgeFixtureCache = new Map();
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

let pngCrcTable;

function crc32(bytes) {
  if (!pngCrcTable) {
    pngCrcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return chunk;
}

export function browserPng(width, height, marker) {
  const cacheKey = `${width}x${height}:${marker}`;
  let base = pngFixtureCache.get(cacheKey);
  if (!base) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 1;
    ihdr[9] = 0;
    const stride = Math.ceil(width / 8);
    const raw = Buffer.alloc((stride + 1) * height, 0xff);
    for (let row = 0; row < height; row += 1) raw[row * (stride + 1)] = 0;
    const markerDigest = createHash("sha256").update(marker).digest();
    for (let index = 0; index < markerDigest.length && index < stride; index += 1) raw[1 + index] = markerDigest[index];
    base = {
      idat: pngChunk("IDAT", deflateSync(raw, { level: 9 })),
      iend: pngChunk("IEND"),
      prefix: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", ihdr),
      ]),
    };
    pngFixtureCache.set(cacheKey, base);
  }
  return Buffer.concat([
    base.prefix,
    pngChunk("tEXt", Buffer.from(`nodekit-fixture\0${marker}`, "utf8")),
    base.idat,
    base.iend,
  ]);
}

function generatedCandidateCommitForFixture(root, candidateCommit) {
  const consumerId = root.match(/^proof\/consumers\/(noderoom|nodeslide|nodevideo)\//)?.[1];
  if (consumerId) return ({ noderoom: "c", nodeslide: "d", nodevideo: "e" })[consumerId].repeat(40);
  const agentRunId = root.match(/^proof\/ease\/agent-campaigns\/[a-f0-9]{40}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/runs\/([^/]+)\/candidate\/$/)?.[1];
  return agentRunId ? digest(`${agentRunId}/generated-candidate-commit`).slice(0, 40) : candidateCommit;
}

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
    author: "Homen Shum",
    bin: { nodekit: "src/cli.mjs" },
    bugs: { url: "https://github.com/HomenShum/node-platform/issues" },
    exports: { ".": "./src/index.mjs" },
    homepage: "https://github.com/HomenShum/node-platform#readme",
    keywords: ["ai-agents", "agent-applications", "convex", "evaluation", "proof", "scaffolding"],
    name: "@homenshum/nodekit",
    repository: { type: "git", url: "git+https://github.com/HomenShum/node-platform.git" },
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
    attestationSignBin: true, attestationVerifyBin: true, builderGym: true,
    caseflowTypes: true, convexClient: true, convexConfig: true, convexComponentApi: true, convexComponentRuntime: true,
    consumerPackagePreparation: true, consumerPrepareBin: true, convexTestExport: true,
    evidenceFinalizeBin: true, packageMetadata: true, postgresAdapter: true, postgresMigration: true,
    submissionAttestation: true, submissionEvidenceFinalizer: true, skillEvaluation: true, supabaseProfile: true, supabaseWorkers: true,
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
  const isPreview = root === "proof/preview/";
  const applicationHash = isPreview ? digest("preview-application") : digest(`${root}/application`);
  const configHash = isPreview ? digest("preview-config") : digest(`${root}/config`);
  const agentRunId = root.match(/^proof\/ease\/agent-campaigns\/[a-f0-9]{40}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/runs\/([^/]+)\/candidate\/$/)?.[1]
    ?? root.match(/^proof\/ease\/agents\/([^/]+)\/candidate\/$/)?.[1]
    ?? null;
  const postAgentTreeHash = agentRunId ? digest(`${agentRunId}/post-agent-tree`).slice(0, 40) : null;
  const nodekitTarballSha256 = digest(packageFixture().tarball);
  const generatedCandidateCommit = generatedCandidateCommitForFixture(root, candidateCommit);
  const browserRunId = agentRunId ?? `browser_${digest(root).slice(0, 12)}`;
  const screenshots = browserStates.flatMap((state) => browserViewports.flatMap((viewport) => ["light", "dark"].map((theme) => {
    const path = `browser/screenshots/${state}--${viewport.id}--${theme}.png`;
    const sidecarPath = path.replace(/\.png$/, ".json");
    const png = browserPng(viewport.width, viewport.height, `${root}:${state}:${viewport.id}:${theme}`);
    const sidecar = {
      applicationHash,
      capturedAt: "2026-07-22T00:00:00.000Z",
      configHash,
      consoleErrors: 0,
      elapsedMs: 1,
      failedRequests: 0,
      generatedCandidateCommit,
      horizontalOverflowPx: 0,
      mojibakeDetected: false,
      nodekitCommit: candidateCommit,
      nodekitIdentity: `${candidateCommit}/${sourceHash}`,
      nodekitSourceBound: true,
      nodekitSourceHash: sourceHash,
      nodekitTarballBound: true,
      nodekitTarballSha256,
      pageUrl: `http://127.0.0.1/?scenario=${state}`,
      postAgentTreeHash,
      pngSha256: digest(png),
      runId: browserRunId,
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
    generatedCandidateCommit,
    journeyAssertions: { exactStateMatrix: true, exportReopened: true, receiptVisible: true },
    milestones: [],
    missingStates: [],
    networkFailures: [],
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${sourceHash}`,
    nodekitSourceBound: true,
    nodekitSourceHash: sourceHash,
    nodekitTarballBound: true,
    nodekitTarballSha256,
    passed: true,
    phases: [],
    postAgentTreeHash,
    requiredStates: [...browserStates],
    runId: browserRunId,
    schemaVersion: "nodekit.browser-certification/v1",
    screenshots,
    startedAt: "2026-07-22T00:00:00.000Z",
    verdict: "BROWSER_CERTIFIED",
  };
  manifest.manifestSha256 = digest(JSON.stringify(manifest));
  return { artifactSpecs, evidenceArtifacts, manifest, screenshots };
}

function protectedBrowserFixtureParts(root, candidateArchiveSha256, runId, taskId) {
  const accessibilityResult = () => ({
    engine: "axe-core",
    engineVersion: "4.12.1",
    passed: true,
    policy: "serious-critical-zero",
    seriousCriticalViolations: 0,
    totalViolations: 0,
    violationCounts: { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 },
    violations: [],
  });
  const screenshots = browserStates.flatMap((state) => browserViewports.flatMap((viewport) => ["light", "dark"].map((theme) => {
    const path = `protected-browser/screenshots/${state}--${viewport.id}--${theme}.png`;
    const sidecarPath = path.replace(/\.png$/, ".json");
    const png = browserPng(viewport.width, viewport.height, `${root}:${runId}:${taskId}:${state}:${viewport.id}:${theme}`);
    const sidecar = {
      accessibility: accessibilityResult(),
      authority: "campaign-protected-browser",
      candidateArchiveSha256,
      consoleErrors: 0,
      failedRequests: 0,
      horizontalOverflowPx: 0,
      mojibakeDetected: false,
      pageUrl: `http://candidate:4173/?scenario=${state}`,
      pngSha256: digest(png),
      runId,
      schemaVersion: "nodekit.protected-screenshot-proof/v1",
      state,
      taskId,
      theme,
      viewport: { height: viewport.height, width: viewport.width },
      viewportId: viewport.id,
    };
    const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
    return {
      ...sidecar,
      path,
      png,
      pngBytes: png.length,
      sidecarBytes: sidecarBytes.length,
      sidecarBytesValue: sidecarBytes,
      sidecarPath,
      sidecarSha256: digest(sidecarBytes),
    };
  })));
  const records = screenshots.map((screenshot) => ({
    path: screenshot.path,
    pngSha256: screenshot.pngSha256,
    sidecarPath: screenshot.sidecarPath,
    sidecarSha256: screenshot.sidecarSha256,
    state: screenshot.state,
    theme: screenshot.theme,
    viewport: screenshot.viewport,
    viewportId: screenshot.viewportId,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    accessibilityAudit: {
      engine: "axe-core",
      engineVersion: "4.12.1",
      passed: true,
      policy: "serious-critical-zero",
      scans: 180,
      seriousCriticalViolations: 0,
      totalViolations: 0,
      violationCounts: { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 },
    },
    candidateArchiveSha256,
    certificationScope: [
      "rendered-state-coverage", "console-health", "request-health",
      "horizontal-overflow", "mojibake", "axe-serious-critical",
    ],
    certified: true,
    consoleErrors: [],
    coveredStates: [...browserStates],
    generatedAt: "2026-07-22T00:03:59.000Z",
    networkFailures: [],
    passed: true,
    producer: {
      authority: "campaign-protected-browser",
      candidateHostAccess: false,
      candidateWriteAccess: false,
      externalNetworkEgress: false,
    },
    requiredStates: [...browserStates],
    runId,
    schemaVersion: "nodekit.protected-browser-screenshot-manifest/v1",
    screenshotEvidenceRootSha256: digest(JSON.stringify(records)),
    screenshots: screenshots.map(({ png, sidecarBytesValue, ...screenshot }) => screenshot),
    taskId,
    themes: ["light", "dark"],
    viewports: browserViewports.map((viewport) => ({ ...viewport })),
  };
  manifest.manifestSha256 = digest(JSON.stringify(manifest));
  return {
    manifest,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    screenshots,
  };
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
  if (screenshot?.path === childPath) {
    return browserPng(
      screenshot.viewport.width,
      screenshot.viewport.height,
      `${root}:${screenshot.state}:${screenshot.viewportId}:${screenshot.theme}`,
    );
  }
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

function protectedAgentProducer() {
  return {
    authority: "campaign-protected-evaluator",
    candidateEvidenceAccess: false,
    candidateHostAccess: false,
    candidateWriteAccess: false,
    executedAfterCandidateArchive: true,
    externalNetworkEgress: false,
    isolationMode: "docker-internal-two-container",
  };
}

function protectedAgentIsolation(runId, browserLaneSha256) {
  const browserDependencies = [
    { destination: "/runner/node_modules/playwright", fileCount: 42, name: "playwright", treeSha256: digest(`${runId}/playwright-tree`), version: "1.61.1" },
    { destination: "/runner/node_modules/playwright-core", fileCount: 310, name: "playwright-core", treeSha256: digest(`${runId}/playwright-core-tree`), version: "1.61.1" },
    { destination: "/runner/node_modules/@axe-core/playwright", fileCount: 9, name: "@axe-core/playwright", treeSha256: digest(`${runId}/axe-playwright-tree`), version: "4.12.1" },
    { destination: "/runner/node_modules/axe-core", fileCount: 18, name: "axe-core", treeSha256: digest(`${runId}/axe-core-tree`), version: "4.12.1" },
  ];
  const value = {
    browserContainer: {
      containerId: digest(`${runId}/browser-container`),
      mounts: [
        { destination: "/output", readOnly: false, type: "bind" },
        { destination: "/runner/node_modules/@axe-core/playwright", readOnly: true, type: "bind" },
        { destination: "/runner/node_modules/axe-core", readOnly: true, type: "bind" },
        { destination: "/runner/node_modules/playwright", readOnly: true, type: "bind" },
        { destination: "/runner/node_modules/playwright-core", readOnly: true, type: "bind" },
        { destination: "/runner/run-protected-browser-lane.mjs", readOnly: true, type: "bind" },
      ],
      readOnlyRootFilesystem: true,
    },
    browserDependencies,
    browserLaneSha256,
    candidateContainer: {
      containerId: digest(`${runId}/candidate-container`),
      mounts: [{ destination: "/workspace", readOnly: true, type: "bind" }],
      readOnlyRootFilesystem: true,
    },
    checks: Object.fromEntries([
      "browserCannotReadCandidate", "browserEgressBlocked", "browserReadOnlyRootFilesystem", "candidateCertificationOracleAbsent",
      "candidateEgressBlocked", "candidateHasNoEvidenceMount", "candidateReadOnlyRootFilesystem", "candidateSourceReadOnly",
      "exactImageBound", "hostNamespacesNotShared", "internalNetworkOnly", "noPublishedPorts", "separateEvaluatorContainer",
    ].map((name) => [name, true])),
    docker: { apiVersion: "1.52", architecture: "amd64", operatingSystem: "linux", serverVersion: "29.5.3" },
    image: {
      architecture: "amd64",
      id: `sha256:${"1".repeat(64)}`,
      operatingSystem: "linux",
      reference: "mcr.microsoft.com/playwright:v1.61.1-noble",
      repoDigests: [],
    },
    mode: "docker-internal-two-container",
    network: { driver: "bridge", internal: true, networkId: digest(`${runId}/protected-network`) },
    schemaVersion: "nodekit.protected-evaluator-isolation/v1",
  };
  value.isolationSha256 = digest(JSON.stringify(value));
  return value;
}

function codingAgentIsolation(runId, driver, agentModel, bootstrapMode, nodekitTarballSha256, providerBrokerSha256) {
  const instructions = {
    automaticPath: driver === "codex" ? "AGENTS.md" : "CLAUDE.md",
    canonicalPath: "AGENTS.md",
    files: ["AGENTS.md", "CLAUDE.md"].map((file) => ({ path: file, sha256: digest(`${runId}/${file}`) })),
    loadedPaths: driver === "codex" ? ["AGENTS.md"] : ["CLAUDE.md", "AGENTS.md"],
    parentContextInherited: false,
    routingDirective: driver === "codex" ? null : "@AGENTS.md",
    rulesIgnored: false,
    schemaVersion: "nodekit.agent-instruction-policy/v1",
  };
  instructions.instructionSetSha256 = digest(JSON.stringify(instructions));
  const emptyDirectory = bootstrapMode === "agent-process-packed-cli-from-empty";
  const bootstrap = {
    agentInitiatedScaffold: emptyDirectory,
    bootstrapSha256: null,
    candidateDirectoryInitiallyEmpty: emptyDirectory,
    commandSha256: digest(`${runId}/bootstrap-command`),
    firstWorkspaceWriteFromAgentSession: emptyDirectory,
    mode: bootstrapMode,
    nodekitCliSha256: digest(`${runId}/nodekit-cli`),
    nodekitTarballSha256,
    offlineDependencyInstall: emptyDirectory,
    packedCliInvokedInsideAgentProcess: emptyDirectory,
    schemaVersion: "nodekit.agent-bootstrap/v1",
    workspaceEmptyAtAgentStart: emptyDirectory,
  };
  delete bootstrap.bootstrapSha256;
  bootstrap.bootstrapSha256 = digest(JSON.stringify(bootstrap));
  const value = {
    bootstrap,
    broker: {
      allowedModel: agentModel,
      containerId: digest(`${runId}/broker-container`),
      expiresAt: "2026-07-22T20:00:00.000Z",
      imageId: `sha256:${"2".repeat(64)}`,
      runnerSha256: providerBrokerSha256,
    },
    checks: Object.fromEntries([
      "bootstrapContractBound", "brokerCredentialExpiryBound", "brokerExactImageBound", "brokerModelBound", "brokerNoPublishedPorts", "brokerRunnerBound",
      "capabilitiesDropped", "candidateOnlyWritableHostMount", "containerCommandBound", "credentialBrokered", "dockerSocketAbsent",
      "exactImageBound", "hostNamespacesNotShared", "instructionPolicyBound", "internalNetworkBound", "noCredentialMount",
      "noEvidenceOrEvaluatorMount", "noNewPrivileges", "noPublishedPorts", "providerBrokerOnlyPeer", "readOnlyRootFilesystem", "scopedMountSet",
    ].map((name) => [name, true])),
    commandSha256: digest(`${runId}/agent-command`),
    containerId: digest(`${runId}/agent-container`),
    credential: {
      expiresAt: "2026-07-22T20:00:00.000Z",
      fingerprintSha256: digest(`${runId}/credential`),
      provider: driver === "codex" ? "openai" : "anthropic",
      scope: driver === "codex" ? "responses:write" : "messages:write",
    },
    driver,
    image: { id: `sha256:${"2".repeat(64)}`, reference: "nodekit-ease-agent:codex-0.142.5-claude-2.1.185" },
    instructions,
    mode: "docker-candidate-only",
    mounts: [
      { destination: "/workspace", readOnly: false, type: "bind" },
      ...(emptyDirectory ? [
        { destination: "/protected/nodekit-package", readOnly: true, type: "bind" },
        { destination: "/protected/nodekit.tgz", readOnly: true, type: "bind" },
        { destination: "/protected/npm-cache", readOnly: true, type: "bind" },
        { destination: "/AGENTS.md", readOnly: true, type: "bind" },
        { destination: "/CLAUDE.md", readOnly: true, type: "bind" },
      ] : []),
    ],
    network: { id: digest(`${runId}/agent-network`), internal: true, name: `network-${runId}` },
    schemaVersion: "nodekit.coding-agent-isolation/v1",
  };
  value.isolationSha256 = digest(JSON.stringify(value));
  return value;
}

export function protectedTaskArtifact(taskId, inputToken, candidateArchiveSha256) {
  const artifactType = {
    "launch-presentation": "launch-presentation",
    "research-map": "research-map",
    "volunteer-onboarding": "volunteer-onboarding-record",
  }[taskId];
  const nonce = `challenge_${digest(`${inputToken}/${candidateArchiveSha256}/protected-input`).slice(0, 48)}`;
  const protectedTaskInput = createProtectedTaskInput({ candidateArchiveSha256, inputToken, nonce, taskId });
  const canonicalContent = taskId === "research-map"
    ? {
        comparisons: [{
          sourceIds: protectedTaskInput.sources.map((source) => source.id),
          summary: "Compared every supplied protected source while preserving its immutable evidence fields.",
        }],
        inputToken,
        question: protectedTaskInput.question,
        sources: protectedTaskInput.sources.map((source) => ({ ...source })),
      }
    : taskId === "volunteer-onboarding"
      ? {
          completion: { status: "confirmed" },
          documents: protectedTaskInput.documents.map((document) => ({ ...document })),
          inputToken,
          volunteer: { ...protectedTaskInput.volunteer },
        }
      : {
          brief: { ...protectedTaskInput.brief },
          inputToken,
          metrics: protectedTaskInput.metrics.map((metric) => ({ ...metric })),
          review: { status: "approved" },
          slides: protectedTaskInput.metrics.map((metric, index) => ({
            id: index + 1,
            metricIds: [metric.id],
            title: ["Problem", "Product", "Proof"][index] ?? `Evidence ${index + 1}`,
          })),
        };
  const artifactId = `artifact_${digest(inputToken).slice(0, 24)}`;
  const contentSha256 = portableContentHash(canonicalContent);
  const marker = { artifactId, canonicalVersion: 2, contentSha256, type: artifactType };
  const domainSummary = taskId === "research-map"
    ? { comparisonCount: 1, questionPresent: true, sourceCount: protectedTaskInput.sources.length }
    : taskId === "volunteer-onboarding"
      ? { completionConfirmed: true, documentCount: protectedTaskInput.documents.length, identityPresent: true }
      : {
          briefPresent: true,
          metricCount: protectedTaskInput.metrics.length,
          reviewApproved: true,
          slideCount: protectedTaskInput.metrics.length,
        };
  const caseId = `case_${digest(`${inputToken}/case`).slice(0, 24)}`;
  const caseRunId = `run_${digest(`${inputToken}/case-run`).slice(0, 24)}`;
  const receiptBody = {
    artifactBindings: [{ artifactId, canonicalVersion: 2, contentHash: contentSha256 }],
    completedAt: "2026-07-22T00:03:59.000Z",
    runId: caseRunId,
    schemaVersion: "nodekit.receipt/v2",
  };
  const receipt = {
    ...receiptBody,
    receiptId: `receipt_${digest(`${inputToken}/receipt`).slice(0, 24)}`,
    receiptHash: portableContentHash(receiptBody),
  };
  const exportBundle = {
    artifact: {
      artifactId,
      canonicalVersion: 2,
      kind: artifactType,
      versions: [{ content: canonicalContent, contentHash: contentSha256, version: 2 }],
    },
    case: { caseId },
    receipt,
    run: { caseId, runId: caseRunId },
    schemaVersion: "nodekit.portable-proof-bundle/v1",
  };
  const exportBytes = Buffer.from(`${JSON.stringify(exportBundle, null, 2)}\n`);
  return {
    protectedTaskInput,
    protectedTaskInputSha256: protectedTaskInputSha256(protectedTaskInput),
    taskArtifactEvidence: {
      artifactId,
      artifactType,
      canonicalContent,
      canonicalVersion: 2,
      contentSha256,
      domainSummary,
      exportBytes: exportBytes.length,
      exportFile: "task-artifact.json",
      exportSha256: digest(exportBytes),
      inputToken,
      inputTokenSha256: digest(inputToken),
      marker,
      reloadMarker: { ...marker },
      reopenMarker: { ...marker },
      taskId,
    },
  };
}

function freshAgentCandidateArchive(runId, taskId) {
  const tar = Buffer.concat([
    ...packageTarEntry("apps/web/public/index.html", `<!doctype html><title>${taskId}</title><main id=\"artifact\">${runId}</main>\n`),
    ...packageTarEntry("apps/web/server.mjs", `export const runId = ${JSON.stringify(runId)};\n`),
    Buffer.alloc(1024),
  ]);
  return gzipSync(tar, { level: 9 });
}

function freshAgentEvidenceBytes(kind, context) {
  const {
    agentBootstrapSession, agentProcessIsolation, agentSessionId, applicationHash, candidateCommit, configHash, generatedCandidateCommit,
    promptSha256, runId, sourceHash, task, taskSetSha256, trialRunnerSha256,
  } = context;
  if (kind === "prompt") return Buffer.from(`${task.goal}\n`);
  if (kind === "prompt-hash") return Buffer.from(`${promptSha256}\n`);
  if (kind === "environment") return Buffer.from(`${JSON.stringify({
    agentBootstrapSession,
    agentCommandSha256: agentProcessIsolation.commandSha256,
    agentContainerImage: agentProcessIsolation.image.reference,
    agentContainerImageId: agentProcessIsolation.image.id,
    agentInstructionPolicy: agentProcessIsolation.instructions,
    agentInstructionPolicySha256: agentProcessIsolation.instructions.instructionSetSha256,
    agentProcessIsolation,
    agentProcessIsolationSha256: agentProcessIsolation.isolationSha256,
    nodekitCommit: candidateCommit,
    nodekitPackage: "@homenshum/nodekit",
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: digest(packageFixture().tarball),
    nodekitVersion: "0.2.1",
    protectedBrowserLaneSha256: digest(agentProtectedSourceBytes["scripts/run-protected-browser-lane.mjs"]),
    protectedContainerImage: "mcr.microsoft.com/playwright:v1.61.1-noble",
    protectedContainerImageId: `sha256:${"1".repeat(64)}`,
    protectedEvaluatorSha256: digest(agentProtectedSourceBytes["scripts/run-protected-agent-evaluator.mjs"]),
    providerBrokerSha256: digest(agentProtectedSourceBytes["scripts/run-agent-provider-broker.mjs"]),
    taskBriefSha256: promptSha256,
    taskSetSha256,
    trialRunnerSha256,
  }, null, 2)}\n`);
  if (kind === "interventions") return Buffer.from("[]\n");
  if (kind === "session") return Buffer.from(`${JSON.stringify({ type: "thread.started", thread_id: agentSessionId })}\n${JSON.stringify({ type: "turn.completed", thread_id: agentSessionId })}\n`);
  if (kind === "final-report") return Buffer.from(`# Completed ${task.id}\n\nBuilt, checked, evaluated, and browser-certified ${runId}.\n`);
  if (kind === "stderr") return Buffer.alloc(0);
  if (kind === "token-usage") return Buffer.from(`${JSON.stringify({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }, null, 2)}\n`);
  if (kind === "command-ledger") return Buffer.from(`${JSON.stringify({ command: "npm run check", exitCode: 0 })}\n${JSON.stringify({ command: "npm run proof", exitCode: 0 })}\n`);
  if (kind === "candidate-diff") return Buffer.from(`diff --git a/apps/web/public/index.html b/apps/web/public/index.html\n+<main id=\"artifact\">${task.id}</main>\n`);
  if (kind === "candidate-status") return Buffer.alloc(0);
  if (kind === "candidate-commit") return Buffer.from(`${generatedCandidateCommit}\n`);
  if (kind === "application-identity") return Buffer.from(`${JSON.stringify({
    applicationHash,
    configHash,
    schemaVersion: "nodeagent.application-identity/v1",
  }, null, 2)}\n`);
  return Buffer.from(`${runId}/${kind}\n`);
}

function freshAgentFixtureParts(candidateCommit, sourceHash) {
  const cacheKey = `${candidateCommit}\0${sourceHash}`;
  let cached = freshAgentFixtureCache.get(cacheKey);
  if (cached) return cached;
  const bytesByPath = new Map();
  const selectedRuns = [];
  const nodekitTarballSha256 = digest(packageFixture().tarball);
  const taskSetSha256 = digest(agentTaskSetBytes);
  const trialRunnerSha256 = digest(agentProtectedSourceBytes["scripts/run-agent-ease-trial.mjs"]);
  const protectedEvaluatorSha256 = digest(agentProtectedSourceBytes["scripts/run-protected-agent-evaluator.mjs"]);
  const protectedBrowserLaneSha256 = digest(agentProtectedSourceBytes["scripts/run-protected-browser-lane.mjs"]);
  const providerBrokerSha256 = digest(agentProtectedSourceBytes["scripts/run-agent-provider-broker.mjs"]);
  const campaignRoot = `proof/ease/agent-campaigns/${candidateCommit}/${agentCampaignId}`;
  const lowerCostEvidencePath = `${campaignRoot}/inputs/lower-cost-model-evidence.json`;
  const lowerCostSnapshotPath = `${campaignRoot}/inputs/lower-cost-source.snapshot.json`;
  bytesByPath.set(lowerCostEvidencePath, lowerCostModelEvidenceBytes);
  bytesByPath.set(lowerCostSnapshotPath, lowerCostPricingSnapshotBytes);
  const lowerCostPricingEvidence = {
    agentDriver: "codex",
    evidencePath: lowerCostEvidencePath,
    evidenceSha256: digest(lowerCostModelEvidenceBytes),
    model: "gpt-5.6-luna",
    pricingValidation: {
      ageMs: 0,
      retrievedAt: lowerCostPricingSnapshot.retrievedAt,
      source: lowerCostPricingSnapshot.source,
      validatedAt: lowerCostPricingSnapshot.retrievedAt,
      verifiedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
    },
    schemaVersion: "nodekit.lower-cost-pricing-binding/v1",
    snapshotPath: lowerCostSnapshotPath,
    snapshotSha256: digest(lowerCostPricingSnapshotBytes),
  };
  for (const task of agentTaskDefinitions) {
    for (const [agentProfile, count] of Object.entries(agentProfileCounts)) {
      for (let index = 0; index < count; index += 1) {
        const ordinal = index + 1;
        const runId = `${agentCampaignId}_${task.id}_${agentProfile}_${ordinal}`;
        const runRoot = `proof/ease/agent-campaigns/${candidateCommit}/${agentCampaignId}/runs/${runId}`;
        const agentSessionId = `session_${runId}`;
        const agentDriver = agentProfile === "claude-code" ? "claude-code" : "codex";
        const agentModel = agentProfile === "lower-cost"
          ? lowerCostPricingEvidence.model
          : agentProfile === "claude-code"
            ? "claude-opus-4-1"
            : "gpt-5.6-sol";
        const bootstrapMode = task.id === "research-map" && agentProfile === "codex" && index === 0
          ? "agent-process-packed-cli-from-empty"
          : "pre-scaffolded-packed-cli";
        const agentProcessIsolation = codingAgentIsolation(runId, agentDriver, agentModel, bootstrapMode, nodekitTarballSha256, providerBrokerSha256);
        const agentBootstrapSession = bootstrapMode === "agent-process-packed-cli-from-empty"
          ? {
              commandCount: 1,
              firstMutatingCommandSha256: agentProcessIsolation.bootstrap.commandSha256,
              passed: true,
              scaffoldCommandSha256: agentProcessIsolation.bootstrap.commandSha256,
            }
          : { commandCount: 0, firstMutatingCommandSha256: null, passed: true, scaffoldCommandSha256: null };
        const browserRoot = `${runRoot}/candidate/`;
        const browser = browserFixtureParts(browserRoot, candidateCommit, sourceHash);
        const browserManifestBytes = Buffer.from(`${JSON.stringify(browser.manifest, null, 2)}\n`);
        const applicationHash = browser.manifest.applicationHash;
        const configHash = browser.manifest.configHash;
        const postAgentTreeHash = browser.manifest.postAgentTreeHash;
        const generatedCandidateCommit = browser.manifest.generatedCandidateCommit;
        const candidateBrowserManifestSha256 = digest(browserManifestBytes);
        const candidateScreenshotEvidenceRootSha256 = digest(JSON.stringify(browser.manifest.screenshots.map((entry) => ({
          path: entry.path,
          pngSha256: entry.pngSha256,
          sidecarPath: entry.sidecarPath,
          sidecarSha256: entry.sidecarSha256,
          state: entry.state,
          theme: entry.theme,
          viewport: entry.viewport,
          viewportId: entry.viewportId,
        })).sort((left, right) => left.path.localeCompare(right.path))));
        const evaluatorScreenshotBytes = browserPng(1440, 900, `${runRoot}:protected-evaluator`);
        const evaluatorScreenshotSha256 = digest(evaluatorScreenshotBytes);
        const candidateArchiveBytes = freshAgentCandidateArchive(runId, task.id);
        const candidateArchiveSha256 = digest(candidateArchiveBytes);
        const isolation = protectedAgentIsolation(runId, protectedBrowserLaneSha256);
        const producer = protectedAgentProducer();
        const protectedInputToken = `cert_${digest(`${runId}/protected-browser-session`).slice(0, 48)}`;
        const protectedArtifact = protectedTaskArtifact(task.id, protectedInputToken, candidateArchiveSha256);
        const evaluatorRoot = `${runRoot}/evaluator/`;
        const protectedBrowser = protectedBrowserFixtureParts(
          evaluatorRoot,
          candidateArchiveSha256,
          protectedInputToken,
          task.id,
        );
        const protectedBrowserManifestSha256 = digest(protectedBrowser.manifestBytes);
        const screenshotEvidenceRootSha256 = protectedBrowser.manifest.screenshotEvidenceRootSha256;
        const visualInventory = {
          applicationHash,
          automatedReview: true,
          browserManifestSha256: protectedBrowserManifestSha256,
          candidateArchiveSha256,
          configHash,
          evaluatorScreenshotSha256,
          generatedAt: "2026-07-22T00:04:00.000Z",
          humanUsabilityGateSatisfied: false,
          isolation,
          isolationSha256: isolation.isolationSha256,
          issues: [],
          nodekitCommit: candidateCommit,
          nodekitSourceHash: sourceHash,
          nodekitTarballSha256,
          openIssueCounts: { p0: 0, p1: 0, p2: 0, p3: 0 },
          passed: true,
          postAgentTreeHash,
          producer,
          runId,
          schemaVersion: "nodekit.visual-review-inventory/v1",
          screenshotCount: 180,
          screenshotEvidenceRootSha256,
          separateFromHumanUsability: true,
          taskId: task.id,
        };
        visualInventory.inventorySha256 = digest(JSON.stringify(visualInventory));
        const visualInventoryBytes = Buffer.from(`${JSON.stringify(visualInventory, null, 2)}\n`);
        const relevanceGroups = Array.from({ length: 4 }, (_, group) => ({
          alternatives: [`${task.id}-term-${group + 1}`],
          group: group + 1,
          matches: [`${task.id}-term-${group + 1}`],
          passed: true,
        }));
        const protectedEvaluation = {
          applicationHash,
          browserManifestSha256: protectedBrowserManifestSha256,
          candidateBrowserManifestSha256,
          candidateArchiveSha256,
          checks: { ...protectedEvaluationChecks },
          configHash,
          evaluatorScreenshotSha256,
          evaluatorSha256: protectedEvaluatorSha256,
          generatedAt: "2026-07-22T00:04:01.000Z",
          isolation,
          isolationSha256: isolation.isolationSha256,
          nodekitCommit: candidateCommit,
          nodekitSourceHash: sourceHash,
          nodekitTarballSha256,
          passed: true,
          postAgentTreeHash,
          producer,
          protectedBrowserManifestFile: "protected-browser/screenshot-manifest.json",
          protectedTaskInput: protectedArtifact.protectedTaskInput,
          protectedTaskInputSha256: protectedArtifact.protectedTaskInputSha256,
          runId,
          schemaVersion: "nodekit.protected-agent-evaluation/v2",
          screenshotEvidenceRootSha256,
          sourceFilesInspected: ["apps/web/public/index.html", "apps/web/server.mjs"],
          taskArtifactEvidence: protectedArtifact.taskArtifactEvidence,
          taskBriefSha256: digest(task.goal),
          taskId: task.id,
          taskRelevance: {
            renderedGroups: relevanceGroups,
            renderedTextSha256: digest(`${runId}/rendered-text`),
            sourceGroups: relevanceGroups,
            sourceTextSha256: digest(`${runId}/source-text`),
          },
          taskSetSha256,
          visualReviewInventorySha256: digest(visualInventoryBytes),
          visualReviewInventorySelfHash: visualInventory.inventorySha256,
        };
        protectedEvaluation.evaluationSha256 = digest(JSON.stringify(protectedEvaluation));
        const protectedEvaluationBytes = Buffer.from(`${JSON.stringify(protectedEvaluation, null, 2)}\n`);
        bytesByPath.set(`${evaluatorRoot}protected-browser/screenshot-manifest.json`, protectedBrowser.manifestBytes);
        for (const screenshot of protectedBrowser.screenshots) {
          bytesByPath.set(`${evaluatorRoot}${screenshot.path}`, screenshot.png);
          bytesByPath.set(`${evaluatorRoot}${screenshot.sidecarPath}`, screenshot.sidecarBytesValue);
        }
        const promptSha256 = digest(task.goal);
        const evidenceContext = {
          agentBootstrapSession,
          agentProcessIsolation,
          agentSessionId,
          applicationHash,
          candidateCommit,
          configHash,
          generatedCandidateCommit,
          promptSha256,
          runId,
          sourceHash,
          task,
          taskSetSha256,
          trialRunnerSha256,
          candidateScreenshotEvidenceRootSha256,
        };
        const specialEvidence = new Map([
          ["browser-certification", browserManifestBytes],
          ["candidate-archive", candidateArchiveBytes],
          ["evaluator-screenshot", evaluatorScreenshotBytes],
          ["protected-evaluation", protectedEvaluationBytes],
          ["screenshot-manifest", browserManifestBytes],
          ["visual-review-inventory", visualInventoryBytes],
        ]);
        const evidence = agentEvidenceKinds.map((kind) => {
          const relativePath = agentEvidencePaths[kind];
          const bytes = specialEvidence.get(kind) ?? freshAgentEvidenceBytes(kind, evidenceContext);
          bytesByPath.set(`${runRoot}/${relativePath}`, bytes);
          return { bytes: bytes.length, kind, path: relativePath, sha256: digest(bytes) };
        });
        const receipt = {
          agentBootstrap: agentProcessIsolation.bootstrap,
          agentBootstrapSession,
          agentBootstrapSha256: agentProcessIsolation.bootstrap.bootstrapSha256,
          agentCommandSha256: agentProcessIsolation.commandSha256,
          agentContainerImage: agentProcessIsolation.image.reference,
          agentContainerImageId: agentProcessIsolation.image.id,
          agentDriver,
          agentExitCode: 0,
          agentInstructionPolicy: agentProcessIsolation.instructions,
          agentInstructionPolicySha256: agentProcessIsolation.instructions.instructionSetSha256,
          agentModel,
          agentProcessIsolation,
          agentProcessIsolationSha256: agentProcessIsolation.isolationSha256,
          agentProfile,
          agentSessionId,
          agentSessionMode: "ephemeral",
          agentVersion: `${agentProfile} fixture version`,
          applicationHash,
          bootstrapMode,
          candidateArchiveSha256,
          candidateRoot: "/workspace",
          changedFiles: ["apps/web/public/index.html", "apps/web/server.mjs"],
          checks: { ...agentPassingChecks },
          configHash,
          durationMs: 300_000 + selectedRuns.length,
          endingNodekitCommit: candidateCommit,
          endingNodekitSourceHash: sourceHash,
          evidence,
          evidenceSetSha256: digest(JSON.stringify(evidence)),
          executor: "docker",
          freshSession: true,
          generatedAt: "2026-07-22T00:05:00.000Z",
          interventions: 0,
          nodekitCommit: candidateCommit,
          nodekitPackage: "@homenshum/nodekit",
          nodekitSourceHash: sourceHash,
          nodekitTarballSha256,
          nodekitVersion: "0.2.1",
          packageManager: "npm",
          passed: true,
          postAgentTreeHash,
          promptSha256,
          protectedBrowserLaneSha256,
          protectedContainerImage: isolation.image.reference,
          protectedContainerImageId: isolation.image.id,
          protectedEvaluationSha256: digest(protectedEvaluationBytes),
          protectedEvaluatorSha256,
          protectedIsolationSha256: isolation.isolationSha256,
          providerBrokerSha256,
          evaluatorScreenshotSha256,
          runId,
          schemaVersion: "nodekit.agent-ease-trial/v2",
          screenshotEvidenceRootSha256,
          substantiveFiles: ["apps/web/public/index.html", "apps/web/server.mjs"],
          taskId: task.id,
          taskSetSha256,
          trialRunnerSha256,
          trialStartedAt: "2026-07-22T00:00:00.000Z",
          userReprompts: 0,
          verdict: "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED",
          visualReviewInventorySha256: digest(visualInventoryBytes),
        };
        receipt.receiptSha256 = digest(JSON.stringify(receipt));
        const manifestPath = `${runRoot}/manifest.json`;
        const manifestBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
        bytesByPath.set(manifestPath, manifestBytes);
        const normalizedEvidence = receipt.evidence.map((entry) => ({ ...entry, path: `${runRoot}/${entry.path}` }));
        selectedRuns.push({
          agentBootstrapSha256: receipt.agentBootstrapSha256,
          agentCommandSha256: receipt.agentCommandSha256,
          agentContainerImage: receipt.agentContainerImage,
          agentContainerImageId: receipt.agentContainerImageId,
          agentDriver: receipt.agentDriver,
          agentInstructionPolicySha256: receipt.agentInstructionPolicySha256,
          agentModel: receipt.agentModel,
          agentProcessIsolationSha256: receipt.agentProcessIsolationSha256,
          agentProfile: receipt.agentProfile,
          agentSessionId: receipt.agentSessionId,
          agentVersion: receipt.agentVersion,
          applicationHash: receipt.applicationHash,
          bootstrapMode: receipt.bootstrapMode,
          candidateArchiveSha256: receipt.candidateArchiveSha256,
          configHash: receipt.configHash,
          durationMs: receipt.durationMs,
          evidence: normalizedEvidence,
          evidenceCount: normalizedEvidence.length,
          evidenceSetSha256: digest(JSON.stringify(normalizedEvidence)),
          evaluatorScreenshotSha256: receipt.evaluatorScreenshotSha256,
          freshSession: receipt.freshSession,
          generatedAt: receipt.generatedAt,
          manifestPath,
          manifestSha256: digest(manifestBytes),
          nodekitCommit: receipt.nodekitCommit,
          nodekitPackage: receipt.nodekitPackage,
          nodekitSourceHash: receipt.nodekitSourceHash,
          nodekitTarballSha256: receipt.nodekitTarballSha256,
          nodekitVersion: receipt.nodekitVersion,
          passed: receipt.passed,
          postAgentTreeHash: receipt.postAgentTreeHash,
          promptSha256: receipt.promptSha256,
          protectedBrowserLaneSha256: receipt.protectedBrowserLaneSha256,
          protectedContainerImage: receipt.protectedContainerImage,
          protectedContainerImageId: receipt.protectedContainerImageId,
          protectedEvaluationSha256: receipt.protectedEvaluationSha256,
          protectedEvaluatorSha256: receipt.protectedEvaluatorSha256,
          protectedIsolationSha256: receipt.protectedIsolationSha256,
          providerBrokerSha256: receipt.providerBrokerSha256,
          receiptSha256: receipt.receiptSha256,
          runId: receipt.runId,
          screenshotEvidenceRootSha256: receipt.screenshotEvidenceRootSha256,
          taskId: receipt.taskId,
          taskSetSha256: receipt.taskSetSha256,
          trialRunnerSha256: receipt.trialRunnerSha256,
          trialStartedAt: receipt.trialStartedAt,
          validationPassed: true,
          visualReviewInventorySha256: receipt.visualReviewInventorySha256,
        });
      }
    }
  }
  cached = { bytesByPath, lowerCostPricingEvidence, selectedRuns };
  freshAgentFixtureCache.set(cacheKey, cached);
  return cached;
}

function freshAgentFixtureBytes(evidencePath, candidateCommit, sourceHash) {
  if (!evidencePath.startsWith(`proof/ease/agent-campaigns/${candidateCommit}/${agentCampaignId}/`)) return null;
  return freshAgentFixtureParts(candidateCommit, sourceHash).bytesByPath.get(evidencePath) ?? null;
}

const protectedKnowledgeDefinition = createProtectedKnowledgeComparisonDefinition({
  comparisonId: "knowledge-comparison-fixture",
  cases: [
    { caseId: "direct-fact", query: "missing direct fact", expectAbstain: true, at: "2026-07-22T00:00:00.000Z" },
    { caseId: "insufficient", query: "missing evidence", expectAbstain: true, at: "2026-07-22T00:00:00.000Z" },
    { caseId: "evolved-fact", query: "missing evolved fact", expectAbstain: true, at: "2026-07-22T00:00:00.000Z" },
  ],
});

function protectedKnowledgeDefinitionBytes() {
  return Buffer.from(`${JSON.stringify(protectedKnowledgeDefinition, null, 2)}\n`);
}

function fixtureReleaseCandidate(candidateCommit, sourceHash) {
  return {
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: digest(packageFixture().tarball),
    packageName: "@homenshum/nodekit",
    packageVersion: "0.2.1",
  };
}

function emptyProtectedKnowledgeGraph() {
  const createdAt = "2026-07-22T00:00:00.000Z";
  const body = {
    schemaVersion: "nodekit.knowledge-graph/v1",
    graphId: "knowledge-fixture-graph",
    version: 0,
    authority: {
      canonicalMutation: "accepted-patch-only",
      destructiveDelete: false,
      oneAuthoritativeGraph: true,
      ownerId: "owner:knowledge-fixture",
    },
    layers: ["source", "derived", "working", "proposal", "canonical", "hypothesis"]
      .map((id) => ({ id, writableThrough: id === "source" ? "ingest-proposal" : "graph-patch" })),
    nodes: [],
    hyperedges: [],
    proposals: [],
    actionReceipts: [],
    evolutionReceipts: [],
    genesis: { createdAt, graphId: "knowledge-fixture-graph" },
    createdAt,
    updatedAt: createdAt,
  };
  return { ...body, contentHash: knowledgeRuntimeHash(body) };
}

function protectedKnowledgeFixtureParts(candidateCommit, sourceHash) {
  const cacheKey = `${candidateCommit}\0${sourceHash}`;
  let cached = protectedKnowledgeFixtureCache.get(cacheKey);
  if (cached) return cached;
  const releaseCandidate = fixtureReleaseCandidate(candidateCommit, sourceHash);
  const graph = emptyProtectedKnowledgeGraph();
  const graphs = { flat: structuredClone(graph), staticGraph: structuredClone(graph), evolvingGraph: structuredClone(graph) };
  const graphBytes = new Map();
  const graphEvidence = {};
  for (const profile of Object.keys(graphs)) {
    const graphPath = `proof/evolution/graphs/${profile}.json`;
    const bytes = Buffer.from(`${JSON.stringify(graphs[profile], null, 2)}\n`);
    graphBytes.set(graphPath, bytes);
    graphEvidence[profile] = { path: graphPath, sha256: digest(bytes) };
  }
  const executionBytes = new Map();
  const measurements = {};
  for (const [profileIndex, profile] of Object.keys(graphs).entries()) {
    measurements[profile] = {};
    for (const [caseIndex, entry] of protectedKnowledgeDefinition.cases.entries()) {
      const retrieval = retrieveAcceptedKnowledge(graphs[profile], {
        query: entry.query,
        seedIds: entry.seedIds,
        predicates: entry.predicates,
        minimumFacts: entry.minimumFacts,
        maxDepth: entry.maxDepth,
        mode: profile === "flat" ? "flat" : "graph",
        sessionId: `comparison:${entry.caseId}`,
        at: entry.at,
      }, { ownerId: graphs[profile].authority.ownerId, occurredAt: entry.at });
      const metrics = {
        turns: 1 + profileIndex,
        tokens: 100 + caseIndex,
        latencyMs: 10 + profileIndex,
        costUsd: 0.001 + profileIndex * 0.001,
      };
      const execution = createKnowledgeComparisonExecutionReceipt({
        definition: protectedKnowledgeDefinition,
        profile,
        caseId: entry.caseId,
        graph: graphs[profile],
        retrievalReceipt: retrieval.receipt,
        ...metrics,
        releaseCandidate,
        generatedAt: entry.at,
      });
      const executionPath = `proof/evolution/executions/${profile}-${entry.caseId}.json`;
      const bytes = Buffer.from(`${JSON.stringify(execution, null, 2)}\n`);
      executionBytes.set(executionPath, bytes);
      measurements[profile][entry.caseId] = {
        ...metrics,
        executionReceiptPath: executionPath,
        executionReceiptSha256: digest(bytes),
        execution,
      };
    }
  }
  const result = runProtectedKnowledgeComparison({
    definition: protectedKnowledgeDefinition,
    definitionEvidencePath: "proof/evolution/protected-definition.json",
    definitionEvidenceSha256: digest(protectedKnowledgeDefinitionBytes()),
    expectedDefinitionSha256: protectedKnowledgeDefinition.definitionSha256,
    graphs,
    graphEvidence,
    measurements,
    releaseCandidate,
    completedAt: "2026-07-22T00:04:00.000Z",
  });
  cached = { result, executionBytes, graphBytes };
  protectedKnowledgeFixtureCache.set(cacheKey, cached);
  return cached;
}

function protectedKnowledgeExecutionBytes(evidencePath, candidateCommit, sourceHash) {
  return protectedKnowledgeFixtureParts(candidateCommit, sourceHash).executionBytes.get(evidencePath) ?? null;
}

function protectedKnowledgeComparisonFixture(candidateCommit, sourceHash) {
  return protectedKnowledgeFixtureParts(candidateCommit, sourceHash).result;
}

export function submissionEvidenceFixtureBytes(evidencePath, candidateCommit = "a".repeat(40), sourceHash = defaultSourceHash) {
  if (evidencePath === "proof/submission-candidate.json") {
    const bytes = submissionCandidateFixtureCache.get(`${candidateCommit}\0${sourceHash}`);
    if (!bytes) throw new Error("submission candidate fixture must be composed from every pre-approval gate before it is referenced");
    return bytes;
  }
  if (evidencePath === "evals/ease/heldout-tasks.json") return agentTaskSetBytes;
  if (Object.hasOwn(agentProtectedSourceBytes, evidencePath)) return agentProtectedSourceBytes[evidencePath];
  const freshAgentBytes = freshAgentFixtureBytes(evidencePath, candidateCommit, sourceHash);
  if (freshAgentBytes) return freshAgentBytes;
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
  if (evidencePath === "proof/evolution/protected-definition.json") return protectedKnowledgeDefinitionBytes();
  if (evidencePath === "proof/evolution/protected-comparison.json") {
    return Buffer.from(`${JSON.stringify(protectedKnowledgeComparisonFixture(candidateCommit, sourceHash), null, 2)}\n`);
  }
  const knowledgeGraph = protectedKnowledgeFixtureParts(candidateCommit, sourceHash).graphBytes.get(evidencePath);
  if (knowledgeGraph) return knowledgeGraph;
  const knowledgeExecution = protectedKnowledgeExecutionBytes(evidencePath, candidateCommit, sourceHash);
  if (knowledgeExecution) return knowledgeExecution;
  if (evidencePath === "proof/postgres-conformance.json") {
    const capabilities = {
      schemaVersion: "nodekit.runtime-capabilities/v1", provider: "postgres", durableState: true,
      transactions: true, optimisticConcurrency: true, subscriptions: "polling", durableJobs: "external",
      fileStorage: false, presence: false, scheduledJobs: false, localDevelopment: true,
    };
    const assertions = {
      activeRunStartIsIdempotent: true, canonicalVersionAdvancedOnce: true, contentAddressedReceipt: true,
      exceptionStatePreserved: true, nextActionOwnerExplicit: true, oneAuthoritativeCase: true,
      repeatedCompletionIsIdempotent: true, repeatedDecisionIsIdempotent: true, staleProposalFailedClosed: true,
    };
    return Buffer.from(`${JSON.stringify({
      schemaVersion: "nodekit.postgres-conformance/v2",
      adapter: "@homenshum/nodekit/adapters/postgres",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity: `${candidateCommit}/${sourceHash}`,
      releaseCandidate: {
        nodekitCommit: candidateCommit, nodekitSourceHash: sourceHash,
        nodekitTarballSha256: digest(packageFixture().tarball), packageName: "@homenshum/nodekit", packageVersion: "0.2.1",
      },
      environment: "live-postgresql",
      testedAt: "2026-07-22T00:00:00.000Z",
      ownerScope: "isolated-test-identities",
      migration: { packagePath: "adapters/postgres/001_caseflow.sql", sha256: digest("postgres-migration") },
      knowledgeMigration: { packagePath: "adapters/postgres/002_knowledge_runtime.sql", sha256: digest("postgres-knowledge-migration") },
      packageInstallation: {
        installTool: "npm", isolated: true, lifecycleScriptsDisabled: true,
        packageJsonSha256: digest("installed-package-json"),
        resolvedAdapterPath: "node_modules/@homenshum/nodekit/src/adapters/postgres.mjs",
        resolvedKnowledgeAdapterPath: "node_modules/@homenshum/nodekit/src/adapters/postgres-knowledge.mjs",
        immutableTarballCopySha256: digest(packageFixture().tarball),
        sourceCheckoutImported: false,
      },
      postgres: { serverVersion: "17.10", serverVersionNum: 170010 },
      capabilities,
      conformance: {
        schemaVersion: "nodekit.adapter-conformance/v1", capabilities,
        capabilityNegotiation: { schemaVersion: "nodekit.runtime-capability-negotiation/v1", provider: "postgres", missing: [], passed: true },
        assertions, passed: true,
      },
      assertions: {
        artifactCompletionRaceAtomic: true, crossOwnerDenied: true, ownerIsolation: true, receiptIntegrity: true,
        reloadPreservedState: true, sameBaseRaceFailedClosed: true, sharedConformancePassed: true,
        knowledgeFirstCreateRaceAtomic: true, knowledgeOwnerIsolation: true, knowledgePackageExportsResolved: true,
        knowledgeProjectionApplied: true, knowledgeProjectionReloaded: true, knowledgeRetrievalReceiptDurable: true,
      },
      passed: true, errors: [], publicationPerformed: false, deployPerformed: false,
    }, null, 2)}\n`);
  }
  if (evidencePath === "proof/nodekit.tgz" || /^proof\/consumers\/[^/]+\/nodekit-component\.tgz$/.test(evidencePath)) return packageFixture().tarball;
  if (evidencePath.endsWith("/package-files.json")) return packageFixture().packageFiles;
  if (/^proof\/ease\/agents\/[^/]+\/evaluator\/task-relevance\.png$/.test(evidencePath)) {
    return browserPng(1440, 900, evidencePath);
  }
  const browser = browserFixtureBytes(evidencePath, candidateCommit, sourceHash);
  return browser ?? Buffer.from(`nodekit submission fixture: ${evidencePath}\n`);
}

export function submissionEvidenceFixtureClosure(manifestPath, candidateCommit = "a".repeat(40), sourceHash = defaultSourceHash) {
  const manifest = JSON.parse(submissionEvidenceFixtureBytes(manifestPath, candidateCommit, sourceHash).toString("utf8"));
  if (manifest.schemaVersion === "nodekit.protected-knowledge-comparison-result/v1") {
    return [
      { path: manifest.definitionEvidence.path, sha256: manifest.definitionEvidence.sha256 },
      ...Object.values(manifest.profiles).map((profile) => ({
        path: profile.graphSnapshot.path,
        sha256: profile.graphSnapshot.sha256,
      })),
      ...Object.values(manifest.profiles).flatMap((profile) => profile.cases.map((entry) => ({
        path: entry.metrics.executionReceipt.path,
        sha256: entry.metrics.executionReceipt.sha256,
      }))),
    ];
  }
  const manifestSuffix = manifest.schemaVersion === "nodekit.protected-browser-screenshot-manifest/v1"
    ? "protected-browser/screenshot-manifest.json"
    : "browser/screenshot-manifest.json";
  if (!manifestPath.endsWith(manifestSuffix)) throw new Error(`unexpected browser manifest fixture path: ${manifestPath}`);
  const root = manifestPath.slice(0, -manifestSuffix.length);
  return [
    ...manifest.screenshots.flatMap((entry) => [
      { bytes: entry.pngBytes, path: `${root}${entry.path}`, sha256: entry.pngSha256 },
      { bytes: entry.sidecarBytes, path: `${root}${entry.sidecarPath}`, sha256: entry.sidecarSha256 },
    ]),
    ...(Array.isArray(manifest.evidenceArtifacts)
      ? manifest.evidenceArtifacts.map((entry) => ({ bytes: entry.byteSize, path: `${root}${entry.path}`, sha256: entry.sha256 }))
      : []),
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
  const recursiveEvidencePaths = [];
  const protectedManifestPaths = [];
  for (const reference of transitiveSubmissionEvidence(id, value)) {
    evidence.push({ path: reference.path, sha256: reference.sha256 });
    if (reference.kind === "protected-comparison"
      || (reference.kind === "screenshot-manifest" && id !== "freshAgentHeldout")) {
      recursiveEvidencePaths.push(reference.path);
    }
    if (id === "freshAgentHeldout" && reference.kind === "protected-evaluation") {
      const evaluation = JSON.parse(submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash).toString("utf8"));
      protectedManifestPaths.push(path.posix.join(path.posix.dirname(reference.path), evaluation.protectedBrowserManifestFile));
    }
  }
  // The closure walker only discovers a protected browser manifest while it is
  // draining the direct references, so the manifests land after all of them and
  // ahead of their own screenshot children.
  for (const protectedManifestPath of protectedManifestPaths) {
    evidence.push({ path: protectedManifestPath, sha256: digest(submissionEvidenceFixtureBytes(protectedManifestPath, candidateCommit, sourceHash)) });
    recursiveEvidencePaths.push(protectedManifestPath);
  }
  // Submission preparation records every direct reference and then appends
  // recursive browser and protected-comparison evidence closures.
  for (const manifestPath of recursiveEvidencePaths) {
    for (const child of submissionEvidenceFixtureClosure(manifestPath, candidateCommit, sourceHash)) {
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
  const protectedKnowledgeComparison = protectedKnowledgeComparisonFixture(candidateCommit, sourceHash);
  const timingVerdict = evaluateDeveloperTimingMatrix(timingReceipts(candidateCommit, sourceHash));
  timingVerdict.releaseCandidate = { ...releaseCandidate };
  timingVerdict.supportingEvidence = [{
    kind: "timing-receipts",
    path: "proof/ease/developer-timing-runs.json",
    sha256: digest(submissionEvidenceFixtureBytes("proof/ease/developer-timing-runs.json", candidateCommit, sourceHash)),
  }];
  const agentFixtureParts = freshAgentFixtureParts(candidateCommit, sourceHash);
  const selectedAgentRuns = agentFixtureParts.selectedRuns.map((entry) => structuredClone(entry));
  const selectedAgentDurations = selectedAgentRuns.map((entry) => entry.durationMs).sort((left, right) => left - right);
  const selectedAgentMedianDuration = selectedAgentDurations[(selectedAgentDurations.length - 1) / 2];
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
      combinedZeroToAppClaim: true,
      emptyDirectoryAgentCliRuns: 1,
      failedTrials: 0,
      ignoredOtherCandidateTrials: 0,
      legacyTrialsIgnored: 0,
      observedRepositoryTrials: 15,
      observedTrials: 15,
      lowerCostPricingEvidence: structuredClone(agentFixtureParts.lowerCostPricingEvidence),
      requiredProfiles: { ...agentProfileCounts },
      requiredRuns: 15,
      requiredTasks: agentTasks,
      selectedRuns: selectedAgentRuns,
      timing: {
        observed: {
          maxRunMs: selectedAgentDurations.at(-1),
          medianRunMs: selectedAgentMedianDuration,
        },
        schemaVersion: "nodekit.fresh-agent-timing/v1",
        thresholds: { maxRunMs: 30 * 60 * 1000, medianRunMs: 20 * 60 * 1000 },
      },
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
      postgresConformance: {
        schemaVersion: "nodekit.postgres-conformance/v2",
        path: "proof/postgres-conformance.json",
        sha256: digest(submissionEvidenceFixtureBytes("proof/postgres-conformance.json", candidateCommit, sourceHash)),
        serverVersionNum: 170010,
        exactPackageInstalled: true,
        passed: true,
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
        fixtureRef("proof/postgres-conformance.json", "postgres-conformance", candidateCommit, sourceHash),
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
        taskCount: protectedKnowledgeComparison.profiles.flat.cases.length,
        protectedBenchmarkSha256: protectedKnowledgeComparison.protectedBenchmarkSha256,
        harnessSha256: protectedKnowledgeComparison.evaluatorSha256,
        flatScore: protectedKnowledgeComparison.profiles.flat.successRate,
        staticGraphScore: protectedKnowledgeComparison.profiles.staticGraph.successRate,
        evolvingGraphScore: protectedKnowledgeComparison.profiles.evolvingGraph.successRate,
        outcome: protectedKnowledgeComparison.profiles.evolvingGraph.successRate
          > Math.max(protectedKnowledgeComparison.profiles.flat.successRate, protectedKnowledgeComparison.profiles.staticGraph.successRate)
          ? "improved"
          : "held",
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
        fixtureRef("proof/evolution/protected-comparison.json", "protected-comparison", candidateCommit, sourceHash),
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
        builderGymRuntime: true, candidateIdentityStable: true, consumerPrepareBinRuntime: true,
        convexComponentRuntime: true, evidenceFinalizeBinRuntime: true, freshConsumerInstall: true, packagedCliCreate: true,
        generatedAppInstall: true, compile: true, check: true, demo: true, eval: true, typecheckPublic: true,
        receiptsValid: true, tarballHashStable: true, distributionComplete: true,
      },
      distributionChecks: {
        attestationSignBin: true, attestationVerifyBin: true, builderGym: true,
        caseflowTypes: true, convexClient: true, convexConfig: true, convexComponentApi: true, convexComponentRuntime: true,
        consumerPackagePreparation: true, consumerPrepareBin: true, convexTestExport: true,
        evidenceFinalizeBin: true, packageMetadata: true, postgresAdapter: true, postgresMigration: true,
        submissionAttestation: true, submissionEvidenceFinalizer: true, skillEvaluation: true, supabaseProfile: true,
        supabaseWorkers: true,
      },
      supportingEvidence: [
        "application-identity.json", "demo-receipt.json", "eval-receipt.json", "convex-runtime-proof.mjs",
        "command-ledger.json", "package-files.json", "public-api.ts", "convex-runtime-proof.json",
        "builder-gym-runtime-proof.json", "installed-cli-help-proof.json",
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
