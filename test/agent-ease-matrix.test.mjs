import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { independentlyPackCandidate } from "../scripts/run-agent-ease-matrix.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import {
  submissionEvidenceFixtureBytes,
  submissionEvidenceFixtureClosure,
} from "./submission-fixtures.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const heldoutTaskBytes = await readFile(path.resolve("evals", "ease", "heldout-tasks.json"));
const lowerCostEvidenceBytes = await readFile(path.resolve("evals", "ease", "lower-cost-model-evidence.json"));
const lowerCostSnapshotBytes = await readFile(path.resolve("evals", "ease", "openai-pricing-2026-07-22.json"));
const tasks = JSON.parse(heldoutTaskBytes.toString("utf8")).tasks;
const profiles = { codex: 3, "claude-code": 1, "lower-cost": 1 };
const protectedEvaluatorSha256 = digest(await readFile(path.resolve("scripts", "run-protected-agent-evaluator.mjs")));
const protectedBrowserLaneSha256 = digest(await readFile(path.resolve("scripts", "run-protected-browser-lane.mjs")));
const protectedTrialRunnerSha256 = digest(await readFile(path.resolve("scripts", "run-agent-ease-trial.mjs")));
const providerBrokerSha256 = digest(await readFile(path.resolve("scripts", "run-agent-provider-broker.mjs")));
const protectedContainerImage = "mcr.microsoft.com/playwright:v1.61.1-noble";
const protectedContainerImageId = `sha256:${"1".repeat(64)}`;
const agentContainerImage = "nodekit-ease-agent:codex-0.142.5-claude-2.1.185";
const agentContainerImageId = `sha256:${"2".repeat(64)}`;
const evidencePaths = Object.freeze({
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
const passingChecks = Object.freeze(Object.fromEntries([
  "agentBootstrapBound", "agentEnvironmentIsolated", "agentImplemented", "agentReportedCompletion", "agentSessionIdentityRecorded", "agentVersionRecorded",
  "applicationIdentityRecorded", "browserContract", "browserJourney", "browserRuntime", "candidateArchive", "check", "compile", "demo",
  "eval", "evidenceComplete", "localInstructionsBound", "nodekitIdentityStable", "nodekitRuntimeBound", "nodekitTarballStable", "postAgentTreeStable", "proof",
  "protectedEvaluation", "protectedEvaluatorStable", "protectedIsolation", "taskSpecificOutput", "visualReview",
].map((name) => [name, true])));

function protectedArtifactEvidence(taskId, seed = taskId) {
  const artifactType = {
    "launch-presentation": "launch-presentation",
    "research-map": "research-map",
    "volunteer-onboarding": "volunteer-onboarding-record",
  }[taskId];
  const canonicalContent = taskId === "research-map"
    ? {
        comparisons: [{ sourceIds: ["source-1", "source-2"], summary: "Compared approaches." }], question: "Which approach is most reliable?",
        sources: [
          { id: "source-1", publishedAtIso: "2026-07-20T00:00:00.000Z", title: "Paper one", url: "https://example.test/one" },
          { id: "source-2", publishedAtIso: "2026-07-21T00:00:00.000Z", title: "Paper two", url: "https://example.test/two" },
        ], submittedOutcome: seed,
      }
    : taskId === "volunteer-onboarding"
      ? { completion: { status: "confirmed" }, documents: [{ id: "doc-1", status: "reviewed" }], submittedOutcome: seed, volunteer: { id: "vol-1" } }
      : { brief: "Launch the product", metrics: [{ name: "users", value: 42 }], review: { status: "approved" }, slides: [{ id: 1 }, { id: 2 }, { id: 3 }], submittedOutcome: seed };
  const marker = { artifactId: `artifact_${seed}`, canonicalVersion: 2, contentSha256: digest(canonicalJson(canonicalContent)), type: artifactType };
  const domainSummary = taskId === "research-map"
    ? { comparisonCount: 1, questionPresent: true, sourceCount: 2 }
    : taskId === "volunteer-onboarding"
      ? { completionConfirmed: true, documentCount: 1, identityPresent: true }
      : { briefPresent: true, metricCount: 1, reviewApproved: true, slideCount: 3 };
  return {
    artifactId: marker.artifactId, artifactType, canonicalContent, canonicalVersion: 2, contentSha256: marker.contentSha256,
    domainSummary, exportBytes: 512, exportFile: "task-artifact.json", exportSha256: digest(`${seed}/export`),
    inputToken: seed, inputTokenSha256: digest(seed), marker, reloadMarker: { ...marker }, reopenMarker: { ...marker }, taskId,
  };
}

function protectedIsolation(runId) {
  const value = {
    browserContainer: {
      containerId: digest(`${runId}/browser-container`),
      mounts: [
        { destination: "/output", readOnly: false, type: "bind" },
        { destination: "/runner/node_modules/playwright", readOnly: true, type: "bind" },
        { destination: "/runner/node_modules/playwright-core", readOnly: true, type: "bind" },
        { destination: "/runner/run-protected-browser-lane.mjs", readOnly: true, type: "bind" },
      ],
      readOnlyRootFilesystem: true,
    },
    browserLaneSha256: protectedBrowserLaneSha256,
    candidateContainer: {
      containerId: digest(`${runId}/candidate-container`),
      mounts: [{ destination: "/workspace", readOnly: true, type: "bind" }],
      readOnlyRootFilesystem: true,
    },
    checks: Object.fromEntries([
      "browserCannotReadCandidate", "browserEgressBlocked", "browserReadOnlyRootFilesystem",
      "candidateCertificationOracleAbsent", "candidateEgressBlocked", "candidateHasNoEvidenceMount",
      "candidateReadOnlyRootFilesystem", "candidateSourceReadOnly", "exactImageBound", "hostNamespacesNotShared",
      "internalNetworkOnly", "noPublishedPorts", "separateEvaluatorContainer",
    ].map((key) => [key, true])),
    docker: { apiVersion: "1.52", architecture: "amd64", operatingSystem: "linux", serverVersion: "29.5.3" },
    image: { architecture: "amd64", id: protectedContainerImageId, operatingSystem: "linux", reference: protectedContainerImage, repoDigests: [] },
    mode: "docker-internal-two-container",
    network: { driver: "bridge", internal: true, networkId: digest(`${runId}/network`) },
    schemaVersion: "nodekit.protected-evaluator-isolation/v1",
  };
  value.isolationSha256 = digest(JSON.stringify(value));
  return value;
}

function codingAgentIsolation(runId, driver, bootstrapMode, nodekitTarballSha256) {
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
  const emptyDirectoryBootstrap = bootstrapMode === "agent-process-packed-cli-from-empty";
  const bootstrap = {
    agentInitiatedScaffold: emptyDirectoryBootstrap,
    candidateDirectoryInitiallyEmpty: emptyDirectoryBootstrap,
    commandSha256: digest(`${runId}/bootstrap-command`),
    firstWorkspaceWriteFromAgentSession: emptyDirectoryBootstrap,
    mode: bootstrapMode,
    nodekitCliSha256: digest(`${runId}/nodekit-cli`),
    nodekitTarballSha256,
    offlineDependencyInstall: emptyDirectoryBootstrap,
    packedCliInvokedInsideAgentProcess: emptyDirectoryBootstrap,
    schemaVersion: "nodekit.agent-bootstrap/v1",
    workspaceEmptyAtAgentStart: emptyDirectoryBootstrap,
  };
  bootstrap.bootstrapSha256 = digest(JSON.stringify(bootstrap));
  const value = {
    bootstrap,
    broker: { containerId: digest(`${runId}/broker`), expiresAt: "2026-07-22T20:00:00.000Z", imageId: agentContainerImageId, runnerSha256: providerBrokerSha256 },
    checks: Object.fromEntries([
      "bootstrapContractBound", "brokerCredentialExpiryBound", "brokerExactImageBound", "brokerNoPublishedPorts", "brokerRunnerBound", "capabilitiesDropped",
      "candidateOnlyWritableHostMount", "containerCommandBound", "credentialBrokered", "dockerSocketAbsent", "exactImageBound",
      "hostNamespacesNotShared", "instructionPolicyBound", "internalNetworkBound", "noCredentialMount",
      "noEvidenceOrEvaluatorMount", "noNewPrivileges", "noPublishedPorts", "providerBrokerOnlyPeer",
      "readOnlyRootFilesystem", "scopedMountSet",
    ].map((key) => [key, true])),
    commandSha256: digest(`${runId}/agent-command`),
    containerId: digest(`${runId}/agent-container`),
    credential: { expiresAt: "2026-07-22T20:00:00.000Z", fingerprintSha256: digest(`${runId}/credential`), provider: driver === "codex" ? "openai" : "anthropic", scope: driver === "codex" ? "responses:write" : "messages:write" },
    driver,
    image: { id: agentContainerImageId, reference: agentContainerImage },
    instructions,
    mode: "docker-candidate-only",
    mounts: [
      { destination: "/workspace", readOnly: false, type: "bind" },
      ...(emptyDirectoryBootstrap ? [
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

function gitAt(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test("agent campaign packs an isolated exact-source copy so prepare cannot mutate the authoritative checkout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-pack-isolation-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), `${JSON.stringify({
      files: ["src"],
      name: "@homenshum/nodekit",
      scripts: {
        prepare: "node -e \"require('node:fs').writeFileSync('PREPARE_SCRIPT_RAN', 'unsafe')\"",
      },
      type: "module",
      version: "0.2.1",
    }, null, 2)}\n`);
    await writeFile(path.join(root, "src", "index.mjs"), "export const isolated = true;\n");
    gitAt(root, ["init"]);
    gitAt(root, ["config", "user.name", "NodeKit Test"]);
    gitAt(root, ["config", "user.email", "nodekit-test@example.invalid"]);
    gitAt(root, ["add", "--all"]);
    gitAt(root, ["commit", "-m", "isolated source fixture"]);
    const candidateCommit = gitAt(root, ["rev-parse", "HEAD"]);
    const candidateSourceHash = await computeNodeKitSourceHash(root);
    const statusBefore = gitAt(root, ["status", "--porcelain=v1", "--untracked-files=all"]);

    const archive = await independentlyPackCandidate({
      candidateCommit,
      candidateSourceHash,
      sourceRoot: root,
    });

    assert.equal(archive.name, "@homenshum/nodekit");
    assert.equal(archive.version, "0.2.1");
    await assert.rejects(access(path.join(root, "PREPARE_SCRIPT_RAN")), { code: "ENOENT" });
    assert.equal(gitAt(root, ["status", "--porcelain=v1", "--untracked-files=all"]), statusBefore);
    assert.equal(gitAt(root, ["rev-parse", "HEAD"]), candidateCommit);
    assert.equal(await computeNodeKitSourceHash(root), candidateSourceHash);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function createTarball(_root, { marker = "candidate", version = "0.2.1" } = {}) {
  const packageTemp = await mkdtemp(path.join(os.tmpdir(), `nodekit-agent-package-${marker}-`));
  const packageRoot = path.join(packageTemp, "package");
  const outputRoot = path.join(packageTemp, "packed");
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@homenshum/nodekit",
    version,
    type: "module",
    files: ["src"],
  }, null, 2)}\n`);
  await writeFile(path.join(packageRoot, "src", "marker.mjs"), `export default ${JSON.stringify(marker)};\n`);
  const packed = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", outputRoot], {
    cwd: packageRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
  const records = JSON.parse(packed.stdout.trim());
  const tarball = path.join(outputRoot, records[0].filename);
  return {
    nodekitCommit: null,
    nodekitSourceHash: null,
    nodekitTarballSha256: digest(await readFile(tarball)),
    packageName: "@homenshum/nodekit",
    packageVersion: version,
    tarball,
  };
}

function evidenceBytes(kind, { agentProcessIsolation, agentSessionId, applicationHash, candidateCommit, configHash, packageCandidate, promptSha256, runId, sourceHash, task, taskSetSha256, trialRunnerSha256 }) {
  if (kind === "session") return Buffer.from(`${JSON.stringify({ type: "thread.started", thread_id: agentSessionId })}\n`);
  if (kind === "prompt") return Buffer.from(`${task.goal}\n`);
  if (kind === "prompt-hash") return Buffer.from(`${promptSha256}\n`);
  if (kind === "environment") return Buffer.from(`${JSON.stringify({
    nodekitPackage: packageCandidate.packageName,
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
    nodekitVersion: packageCandidate.packageVersion,
    protectedEvaluatorSha256,
    protectedBrowserLaneSha256,
    protectedContainerImage,
    protectedContainerImageId,
    agentContainerImage,
    agentContainerImageId,
    agentCommandSha256: agentProcessIsolation.commandSha256,
    agentProcessIsolation,
    agentProcessIsolationSha256: agentProcessIsolation.isolationSha256,
    agentInstructionPolicy: agentProcessIsolation.instructions,
    agentInstructionPolicySha256: agentProcessIsolation.instructions.instructionSetSha256,
    providerBrokerSha256,
    taskBriefSha256: promptSha256,
    taskSetSha256,
    trialRunnerSha256,
  })}\n`);
  if (kind === "interventions") return Buffer.from("[]\n");
  if (kind === "application-identity") return Buffer.from(`${JSON.stringify({
    applicationHash,
    configHash,
    schemaVersion: "nodeagent.application-identity/v1",
  })}\n`);
  return Buffer.from(`${runId}/${kind}\n`);
}

async function createMatrix(root, candidateCommit, sourceHash, packageCandidate) {
  await writeFile(path.join(root, "lower-cost-model-evidence.json"), lowerCostEvidenceBytes);
  await writeFile(path.join(root, "lower-cost-source.snapshot.json"), lowerCostSnapshotBytes);
  const browserManifestPaths = [];
  const firstEvidencePath = [];
  const manifestPaths = [];
  for (const task of tasks) {
    for (const [agentProfile, count] of Object.entries(profiles)) {
      for (let index = 0; index < count; index += 1) {
        const runId = `agent_${task.id}_${agentProfile}_${index + 1}`;
        const agentSessionId = `session_${runId}`;
        const agentDriver = agentProfile === "claude-code" ? "claude-code" : "codex";
        const bootstrapMode = task.id === "research-map" && agentProfile === "codex" && index === 0
          ? "agent-process-packed-cli-from-empty"
          : "pre-scaffolded-packed-cli";
        const agentProcessIsolation = codingAgentIsolation(runId, agentDriver, bootstrapMode, packageCandidate.nodekitTarballSha256);
        const runRoot = path.join(root, runId);
        const fixtureManifestPath = `${runId}/candidate/browser/screenshot-manifest.json`;
        const browserManifest = JSON.parse(submissionEvidenceFixtureBytes(
          fixtureManifestPath,
          candidateCommit,
          sourceHash,
        ).toString("utf8"));
        browserManifest.runId = runId;
        browserManifest.nodekitSourceBound = true;
        browserManifest.nodekitTarballBound = true;
        browserManifest.nodekitTarballSha256 = packageCandidate.nodekitTarballSha256;
        browserManifest.postAgentTreeHash = digest(`${runId}/post-agent-tree`).slice(0, 40);
        const rewrittenSidecars = new Map();
        for (const screenshot of browserManifest.screenshots) {
          const fullSidecarPath = `${runId}/candidate/${screenshot.sidecarPath}`;
          const sidecar = JSON.parse(submissionEvidenceFixtureBytes(
            fullSidecarPath,
            candidateCommit,
            sourceHash,
          ).toString("utf8"));
          Object.assign(sidecar, {
            nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
            postAgentTreeHash: browserManifest.postAgentTreeHash,
            runId,
          });
          const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
          Object.assign(screenshot, {
            nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
            postAgentTreeHash: browserManifest.postAgentTreeHash,
            runId,
            sidecarBytes: sidecarBytes.length,
            sidecarSha256: digest(sidecarBytes),
          });
          rewrittenSidecars.set(screenshot.sidecarPath, sidecarBytes);
        }
        delete browserManifest.manifestSha256;
        browserManifest.manifestSha256 = digest(JSON.stringify(browserManifest));
        const browserManifestBytes = Buffer.from(`${JSON.stringify(browserManifest, null, 2)}\n`);
        const applicationHash = browserManifest.applicationHash;
        const configHash = browserManifest.configHash;
        const promptSha256 = digest(task.goal);
        const taskSetSha256 = digest(heldoutTaskBytes);
        const trialRunnerSha256 = protectedTrialRunnerSha256;
        const browserManifestSha256 = digest(browserManifestBytes);
        const screenshotEvidenceRootSha256 = digest(JSON.stringify(browserManifest.screenshots.map((entry) => ({
          path: entry.path,
          pngSha256: entry.pngSha256,
          sidecarPath: entry.sidecarPath,
          sidecarSha256: entry.sidecarSha256,
          state: entry.state,
          theme: entry.theme,
          viewport: entry.viewport,
          viewportId: entry.viewportId,
        })).sort((left, right) => left.path.localeCompare(right.path))));
        const fixtureClosure = submissionEvidenceFixtureClosure(fixtureManifestPath, candidateCommit, sourceHash);
        const evaluatorPngChild = fixtureClosure.find((entry) => entry.path.endsWith(".png"));
        const evaluatorScreenshotBytes = submissionEvidenceFixtureBytes(evaluatorPngChild.path, candidateCommit, sourceHash);
        const evaluatorScreenshotSha256 = digest(evaluatorScreenshotBytes);
        const producer = {
          authority: "campaign-protected-evaluator", candidateEvidenceAccess: false, candidateHostAccess: false,
          candidateWriteAccess: false, executedAfterCandidateArchive: true, externalNetworkEgress: false,
          isolationMode: "docker-internal-two-container",
        };
        const isolation = protectedIsolation(runId);
        const candidateArchiveBytes = evidenceBytes("candidate-archive", {
          agentProcessIsolation, agentSessionId, applicationHash, candidateCommit, configHash, packageCandidate, promptSha256, runId, sourceHash, task, taskSetSha256, trialRunnerSha256,
        });
        const candidateArchiveSha256 = digest(candidateArchiveBytes);
        const visualInventory = {
          applicationHash,
          automatedReview: true,
          browserManifestSha256,
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
          nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
          openIssueCounts: { p0: 0, p1: 0, p2: 0, p3: 0 },
          passed: true,
          postAgentTreeHash: browserManifest.postAgentTreeHash,
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
        const relevanceGroups = Array.from({ length: 4 }, (_, group) => ({ alternatives: [`term-${group}`], group: group + 1, matches: [`term-${group}`], passed: true }));
        const protectedEvaluation = {
          applicationHash,
          browserManifestSha256,
          candidateArchiveSha256,
          checks: Object.fromEntries([
            "applicationIdentityBound", "artifactDownloadVerified", "artifactReloadPersistenceVerified", "artifactReopenPersistenceVerified",
            "browserEvidenceBound", "candidateArchiveBound", "candidateTreeBound", "evaluatorBytesBound",
            "guidedInteractionPassed", "independentScreenshotCaptured", "renderedTaskRelevant", "sourceTaskRelevant", "taskBytesBound",
            "taskInputBound", "taskSetBound", "typedArtifactVerified", "visualReviewPassed", "isolationBound",
          ].map((key) => [key, true])),
          configHash,
          evaluatorScreenshotSha256,
          evaluatorSha256: protectedEvaluatorSha256,
          generatedAt: "2026-07-22T00:04:01.000Z",
          isolation,
          isolationSha256: isolation.isolationSha256,
          nodekitCommit: candidateCommit,
          nodekitSourceHash: sourceHash,
          nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
          passed: true,
          postAgentTreeHash: browserManifest.postAgentTreeHash,
          producer,
          runId,
          schemaVersion: "nodekit.protected-agent-evaluation/v2",
          screenshotEvidenceRootSha256,
          sourceFilesInspected: ["apps/web/public/index.html"],
          taskArtifactEvidence: protectedArtifactEvidence(task.id, runId),
          taskBriefSha256: promptSha256,
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
        const specialEvidence = new Map([
          ["candidate-archive", candidateArchiveBytes],
          ["protected-evaluation", protectedEvaluationBytes],
          ["evaluator-screenshot", evaluatorScreenshotBytes],
          ["visual-review-inventory", visualInventoryBytes],
        ]);
        const evidence = [];
        for (const [kind, relative] of Object.entries(evidencePaths)) {
          const bytes = new Set(["browser-certification", "screenshot-manifest"]).has(kind)
            ? browserManifestBytes
             : specialEvidence.get(kind) ?? evidenceBytes(kind, {
                agentProcessIsolation, agentSessionId, applicationHash, candidateCommit, configHash, packageCandidate, promptSha256,
                runId, sourceHash, task, taskSetSha256, trialRunnerSha256,
              });
          const absolute = path.join(runRoot, ...relative.split("/"));
          await mkdir(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, bytes);
          evidence.push({ bytes: bytes.length, kind, path: relative, sha256: digest(bytes) });
          if (firstEvidencePath.length === 0) firstEvidencePath.push(absolute);
        }
        for (const child of fixtureClosure) {
          const relative = child.path.slice(`${runId}/`.length);
          const absolute = path.join(runRoot, ...relative.split("/"));
          const browserRelative = relative.slice("candidate/".length);
          const bytes = rewrittenSidecars.get(browserRelative)
            ?? submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
          await mkdir(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, bytes);
        }
        browserManifestPaths.push(path.join(runRoot, "candidate", "browser", "screenshot-manifest.json"));
        const receipt = {
          agentBootstrap: agentProcessIsolation.bootstrap,
          agentBootstrapSession: bootstrapMode === "agent-process-packed-cli-from-empty"
            ? { commandCount: 6, firstMutatingCommandSha256: agentProcessIsolation.bootstrap.commandSha256, passed: true, scaffoldCommandSha256: agentProcessIsolation.bootstrap.commandSha256 }
            : { commandCount: 0, firstMutatingCommandSha256: null, passed: true, scaffoldCommandSha256: null },
          agentBootstrapSha256: agentProcessIsolation.bootstrap.bootstrapSha256,
          agentCommandSha256: agentProcessIsolation.commandSha256,
          agentContainerImage,
          agentContainerImageId,
          agentDriver,
          agentExitCode: 0,
          agentModel: agentProfile === "lower-cost" ? "gpt-5.6-luna" : null,
          agentProfile,
          agentSessionId,
          agentSessionMode: "ephemeral",
          agentVersion: `${agentProfile} test version`,
          agentProcessIsolation,
          agentProcessIsolationSha256: agentProcessIsolation.isolationSha256,
          agentInstructionPolicy: agentProcessIsolation.instructions,
          agentInstructionPolicySha256: agentProcessIsolation.instructions.instructionSetSha256,
          applicationHash,
          candidateArchiveSha256: evidence.find((entry) => entry.kind === "candidate-archive").sha256,
          candidateRoot: `/tmp/${runId}`,
          bootstrapMode,
          changedFiles: ["agent/workflow.mjs"],
          checks: { ...passingChecks },
          configHash,
          durationMs: 1,
          evidence,
          evidenceSetSha256: digest(JSON.stringify(evidence)),
          executor: "docker",
          freshSession: true,
          generatedAt: "2026-07-22T00:05:00.000Z",
          interventions: 0,
          endingNodekitCommit: candidateCommit,
          endingNodekitSourceHash: sourceHash,
          nodekitCommit: candidateCommit,
          nodekitPackage: packageCandidate.packageName,
          nodekitSourceHash: sourceHash,
          nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
          nodekitVersion: packageCandidate.packageVersion,
          packageManager: "npm",
          passed: true,
          postAgentTreeHash: browserManifest.postAgentTreeHash,
          protectedEvaluatorSha256,
          protectedBrowserLaneSha256,
          protectedContainerImage,
          protectedContainerImageId,
          providerBrokerSha256,
          protectedIsolationSha256: isolation.isolationSha256,
          protectedEvaluationSha256: evidence.find((entry) => entry.kind === "protected-evaluation").sha256,
          evaluatorScreenshotSha256: evidence.find((entry) => entry.kind === "evaluator-screenshot").sha256,
          visualReviewInventorySha256: evidence.find((entry) => entry.kind === "visual-review-inventory").sha256,
          screenshotEvidenceRootSha256,
          promptSha256,
          runId,
          schemaVersion: "nodekit.agent-ease-trial/v2",
          taskId: task.id,
          taskSetSha256,
          trialStartedAt: "2026-07-22T00:00:00.000Z",
          trialRunnerSha256,
          userReprompts: 0,
          substantiveFiles: ["agent/workflow.mjs"],
          verdict: "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED",
        };
        receipt.receiptSha256 = digest(JSON.stringify(receipt));
        const manifestPath = path.join(runRoot, "manifest.json");
        await writeFile(manifestPath, `${JSON.stringify(receipt, null, 2)}\n`);
        manifestPaths.push(manifestPath);
      }
    }
  }
  return { browserManifestPaths, firstEvidencePath: firstEvidencePath[0], manifestPaths };
}

function evaluate(root, output, candidateCommit, sourceHash, packageCandidate) {
  return spawnSync(process.execPath, [
    path.resolve("scripts", "evaluate-agent-ease.mjs"),
    `--root=${root}`,
    `--output=${output}`,
    `--evidence-repo-root=${root}`,
    `--candidate=${candidateCommit}`,
    `--source-hash=${sourceHash}`,
    `--nodekit-tarball=${packageCandidate.tarball}`,
    `--nodekit-tarball-sha256=${packageCandidate.nodekitTarballSha256}`,
    `--lower-cost-evidence=${path.join(root, "lower-cost-model-evidence.json")}`,
    `--lower-cost-snapshot=${path.join(root, "lower-cost-source.snapshot.json")}`,
  ], { encoding: "utf8" });
}

async function rewriteReceipt(file, mutate) {
  const receipt = JSON.parse(await readFile(file, "utf8"));
  mutate(receipt);
  receipt.receiptSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256"))));
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

test("fresh-agent evaluator requires an exact packed NodeKit candidate", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts", "evaluate-agent-ease.mjs"),
    `--candidate=${"a".repeat(40)}`,
    `--source-hash=${"b".repeat(64)}`,
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /--nodekit-tarball=<exact-candidate\.tgz> is required/);
});

test("agent-ease verdict binds all 15 trials to the exact packed candidate and their evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-matrix-"));
  const output = path.join(root, "verdict.json");
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const packageCandidate = await createTarball(root);
  const { firstEvidencePath, manifestPaths } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  const passed = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.equal(verdict.passed, true);
  assert.equal(verdict.requiredRuns, 15);
  assert.equal(verdict.selectedRuns.length, 15);
  assert.equal(verdict.allAttemptsSelected, true);
  assert.equal(verdict.combinedZeroToAppClaim, true);
  assert.equal(verdict.emptyDirectoryAgentCliRuns, 1);
  assert.equal(verdict.selectedRuns.filter((entry) => entry.bootstrapMode === "agent-process-packed-cli-from-empty").length, 1);
  assert.deepEqual(verdict.requiredProfiles, profiles);
  assert.deepEqual(verdict.releaseCandidate, {
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
    packageName: packageCandidate.packageName,
    packageVersion: packageCandidate.packageVersion,
  });
  assert.ok(verdict.selectedRuns.every((entry) => entry.applicationHash && entry.configHash));

  await writeFile(firstEvidencePath, "tampered\n");
  const blocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(blocked.status, 1);
  const blockedVerdict = JSON.parse(await readFile(output, "utf8"));
  assert.equal(blockedVerdict.passed, false);
  assert.match(blockedVerdict.errors.join("\n"), /evidence (?:byte count|hash) mismatch/);

  await writeFile(firstEvidencePath, `${tasks[0].goal}\n`);
  const protectedEvaluationPath = path.join(path.dirname(manifestPaths[0]), "evaluator", "protected-task-evaluation.json");
  const selfAsserted = JSON.parse(await readFile(protectedEvaluationPath, "utf8"));
  selfAsserted.producer.candidateWriteAccess = true;
  delete selfAsserted.evaluationSha256;
  selfAsserted.evaluationSha256 = digest(JSON.stringify(selfAsserted));
  const selfAssertedBytes = Buffer.from(`${JSON.stringify(selfAsserted, null, 2)}\n`);
  await writeFile(protectedEvaluationPath, selfAssertedBytes);
  await rewriteReceipt(manifestPaths[0], (receipt) => {
    const evidence = receipt.evidence.find((entry) => entry.kind === "protected-evaluation");
    evidence.bytes = selfAssertedBytes.length;
    evidence.sha256 = digest(selfAssertedBytes);
    receipt.protectedEvaluationSha256 = evidence.sha256;
    receipt.evidenceSetSha256 = digest(JSON.stringify(receipt.evidence));
  });
  const selfAssertedBlocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(selfAssertedBlocked.status, 1);
  const selfAssertedVerdict = JSON.parse(await readFile(output, "utf8"));
  assert.match(selfAssertedVerdict.errors.join("\n"), /candidate-authored/);
});

test("agent-ease verdict reports rather than cherry-picks an extra candidate attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-no-cherry-pick-"));
  const output = path.join(root, "verdict.json");
  const candidateCommit = "c".repeat(40);
  const sourceHash = "d".repeat(64);
  const packageCandidate = await createTarball(root);
  const { firstEvidencePath } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  const originalRunRoot = path.dirname(path.dirname(firstEvidencePath));
  await cp(originalRunRoot, path.join(root, "extra_attempt"), { recursive: true });
  const blocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(blocked.status, 1);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.equal(verdict.allAttemptsSelected, true);
  assert.equal(verdict.selectedRuns.length, 16);
  assert.match(verdict.errors.join("\n"), /requires 15 total trials; observed 16/);
});

test("agent-ease verdict rejects a candidate-bound attempt that substitutes another tarball", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-tarball-substitution-"));
  const output = path.join(root, "verdict.json");
  const candidateCommit = "e".repeat(40);
  const sourceHash = "f".repeat(64);
  const packageCandidate = await createTarball(root);
  const substitute = await createTarball(root, { marker: "substitute" });
  const { manifestPaths } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  await rewriteReceipt(manifestPaths[0], (receipt) => { receipt.nodekitTarballSha256 = substitute.nodekitTarballSha256; });
  const blocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(blocked.status, 1);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.equal(verdict.selectedRuns.length, 15);
  assert.match(verdict.errors.join("\n"), /tarball SHA-256 does not match the exact candidate tarball/);
});

test("agent-ease verdict rejects aliased evidence paths and application identity drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-canonical-evidence-"));
  const output = path.join(root, "verdict.json");
  const candidateCommit = "1".repeat(40);
  const sourceHash = "2".repeat(64);
  const packageCandidate = await createTarball(root);
  const { browserManifestPaths, manifestPaths } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  await rewriteReceipt(manifestPaths[0], (receipt) => {
    receipt.evidence.find((entry) => entry.kind === "prompt").path = "agent//original-prompt.txt";
    receipt.evidenceSetSha256 = digest(JSON.stringify(receipt.evidence));
  });
  await rewriteReceipt(manifestPaths[1], (receipt) => { receipt.applicationHash = "3".repeat(64); });
  await rewriteReceipt(manifestPaths[2], (receipt) => { delete receipt.checks.nodekitRuntimeBound; });
  const browserManifest = JSON.parse(await readFile(browserManifestPaths[3], "utf8"));
  browserManifest.screenshots[0].horizontalOverflowPx = 1;
  delete browserManifest.manifestSha256;
  browserManifest.manifestSha256 = digest(JSON.stringify(browserManifest));
  const browserBytes = Buffer.from(`${JSON.stringify(browserManifest, null, 2)}\n`);
  const browserCertificatePath = path.join(path.dirname(path.dirname(browserManifestPaths[3])), "browser-certification.json");
  await writeFile(browserManifestPaths[3], browserBytes);
  await writeFile(browserCertificatePath, browserBytes);
  await rewriteReceipt(manifestPaths[3], (receipt) => {
    for (const kind of ["browser-certification", "screenshot-manifest"]) {
      const evidence = receipt.evidence.find((entry) => entry.kind === kind);
      evidence.bytes = browserBytes.length;
      evidence.sha256 = digest(browserBytes);
    }
    receipt.evidenceSetSha256 = digest(JSON.stringify(receipt.evidence));
  });
  const blocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(blocked.status, 1);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.match(verdict.errors.join("\n"), /evidence path is not canonical/);
  assert.match(verdict.errors.join("\n"), /application-identity evidence does not bind/);
  assert.match(verdict.errors.join("\n"), /exact required checks failed or were omitted/);
  assert.match(verdict.errors.join("\n"), /browser evidence closure failed/);
});
