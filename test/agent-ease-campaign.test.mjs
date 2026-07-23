import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_EASE_MAX_RUN_DURATION_MS,
  AGENT_EASE_MEDIAN_RUN_DURATION_MS,
  AGENT_EASE_PROFILE_COUNTS,
  AGENT_EASE_REQUIRED_CHECKS,
  AGENT_EASE_TASK_IDS,
  buildAgentEaseCampaignPlan,
  createProtectedTaskInput,
  parseAgentEaseCliArgs,
  protectedTaskInputSha256,
  validateAgentEaseMeasurementVerdict,
  validateAgentEaseTrialManifest,
  validateCodingAgentIsolation,
  validateIndependentSourceArchive,
  validateLowerCostEvidence,
  validateOfficialPricingSnapshot,
  validateProtectedAgentEvaluation,
  validateProtectedAgentEvaluationV1,
  validateProtectedTaskInput,
  validateProtectedTaskTransformation,
  validateVisualReviewInventory,
} from "../src/lib/agent-ease-campaign.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const taskDocuments = AGENT_EASE_TASK_IDS.map((id) => ({ id, goal: `Bound goal for ${id}` }));
const taskBriefById = Object.fromEntries(taskDocuments.map((task) => [task.id, {
  file: `/tmp/${task.id}.txt`,
  sha256: digest(task.goal),
}]));

function protectedTaskFixture(taskId, seed = taskId, candidateArchiveSha256 = "3".repeat(64)) {
  const artifactType = {
    "launch-presentation": "launch-presentation",
    "research-map": "research-map",
    "volunteer-onboarding": "volunteer-onboarding-record",
  }[taskId];
  const protectedTaskInput = createProtectedTaskInput({
    candidateArchiveSha256,
    inputToken: seed,
    nonce: `challenge_${digest(`${taskId}/${seed}`).slice(0, 48)}`,
    taskId,
  });
  const canonicalContent = taskId === "research-map"
    ? {
        comparisons: [{ sourceIds: protectedTaskInput.sources.map((source) => source.id), summary: "Compared only the supplied immutable packet." }],
        inputToken: seed,
        question: protectedTaskInput.question,
        sources: structuredClone(protectedTaskInput.sources),
      }
    : taskId === "volunteer-onboarding"
      ? {
          completion: { status: "confirmed" },
          documents: structuredClone(protectedTaskInput.documents),
          inputToken: seed,
          volunteer: structuredClone(protectedTaskInput.volunteer),
        }
      : {
          brief: structuredClone(protectedTaskInput.brief),
          inputToken: seed,
          metrics: structuredClone(protectedTaskInput.metrics),
          review: { status: "approved" },
          slides: protectedTaskInput.metrics.map((metric, index) => ({ id: index + 1, metricIds: [metric.id], title: `Evidence ${index + 1}` })),
        };
  const marker = {
    artifactId: `artifact_${seed}`,
    canonicalVersion: 2,
    contentSha256: digest(canonicalJson(canonicalContent)),
    type: artifactType,
  };
  const domainSummary = taskId === "research-map"
    ? { comparisonCount: canonicalContent.comparisons.length, questionPresent: true, sourceCount: canonicalContent.sources.length }
    : taskId === "volunteer-onboarding"
      ? { completionConfirmed: true, documentCount: canonicalContent.documents.length, identityPresent: true }
      : { briefPresent: true, metricCount: canonicalContent.metrics.length, reviewApproved: true, slideCount: canonicalContent.slides.length };
  const artifact = {
    artifactId: marker.artifactId,
    artifactType,
    canonicalContent,
    canonicalVersion: marker.canonicalVersion,
    contentSha256: marker.contentSha256,
    domainSummary,
    exportBytes: 512,
    exportFile: "task-artifact.json",
    exportSha256: digest(`${seed}/export`),
    inputToken: seed,
    inputTokenSha256: digest(seed),
    marker,
    reloadMarker: { ...marker },
    reopenMarker: { ...marker },
    taskId,
  };
  return { artifact, protectedTaskInput };
}

const lowerCostEvidence = {
  agentDriver: "codex",
  comparators: [
    { inputUsdPerMillion: 4, model: "primary-model", outputUsdPerMillion: 16 },
  ],
  lowerCost: { inputUsdPerMillion: 1, outputUsdPerMillion: 4 },
  model: "economy-model",
  observedAt: "2026-07-22T12:00:00.000Z",
  passed: true,
  schemaVersion: "nodekit.lower-cost-model-evidence/v1",
  source: {
    snapshotSha256: "a".repeat(64),
    snapshotPath: "pricing-snapshot.html",
    url: "https://example.test/pricing",
  },
};

test("protected task inputs are nonce-bearing, archive-bound, and replay exact unseen transformations", () => {
  for (const taskId of AGENT_EASE_TASK_IDS) {
    const fixture = protectedTaskFixture(taskId, `cert_${taskId}`, "3".repeat(64));
    assert.equal(validateProtectedTaskInput(fixture.protectedTaskInput, {
      candidateArchiveSha256: "3".repeat(64),
      inputToken: `cert_${taskId}`,
      taskId,
    }), fixture.protectedTaskInput);
    assert.match(protectedTaskInputSha256(fixture.protectedTaskInput), /^[a-f0-9]{64}$/);
    assert.deepEqual(
      validateProtectedTaskTransformation(taskId, fixture.protectedTaskInput, fixture.artifact.canonicalContent),
      fixture.artifact.domainSummary,
    );

    const canned = structuredClone(fixture.artifact.canonicalContent);
    canned.inputToken = "cert_canned_known_before_archive";
    assert.throws(
      () => validateProtectedTaskTransformation(taskId, fixture.protectedTaskInput, canned),
      /hidden input token/,
    );
  }
});

test("protected research input authenticates immutable source excerpts and rejects invented packet changes", () => {
  const fixture = protectedTaskFixture("research-map", "cert_research_exact", "3".repeat(64));
  const forgedInput = structuredClone(fixture.protectedTaskInput);
  forgedInput.sources[0].excerpt = "Replaced after the packet hash was issued.";
  assert.throws(
    () => validateProtectedTaskInput(forgedInput, {
      candidateArchiveSha256: "3".repeat(64), inputToken: "cert_research_exact", taskId: "research-map",
    }),
    /source packet is invalid/,
  );
  const inventedOutput = structuredClone(fixture.artifact.canonicalContent);
  inventedOutput.sources[0].title = "Invented source";
  assert.throws(
    () => validateProtectedTaskTransformation("research-map", fixture.protectedTaskInput, inventedOutput),
    /preserve the immutable source packet exactly/,
  );
});

test("campaign plan is the exact 15-trial no-cherry-pick matrix", () => {
  const plan = buildAgentEaseCampaignPlan({
    campaignId: "candidate123",
    candidateCommit: "c".repeat(40),
    candidateSourceHash: "d".repeat(64),
    claudeModel: "claude-primary-model",
    codexModel: "codex-primary-model",
    evidenceRoot: "/tmp/evidence",
    lowerCostDriver: "codex",
    lowerCostEvidence,
    lowerCostModel: "economy-model",
    nodekitTarball: "/tmp/nodekit.tgz",
    nodekitTarballSha256: "b".repeat(64),
    taskBriefById,
    tasks: taskDocuments,
    taskSetFile: "/tmp/heldout-tasks.json",
    taskSetSha256: "e".repeat(64),
    timeoutMs: 30_000,
    trialRunnerSha256: "f".repeat(64),
    protectedEvaluatorFile: "/tmp/protected-evaluator.mjs",
    protectedEvaluatorSha256: "6".repeat(64),
    protectedBrowserLaneFile: "/tmp/protected-browser-lane.mjs",
    protectedBrowserLaneSha256: "7".repeat(64),
    providerBrokerFile: "/tmp/provider-broker.mjs",
    providerBrokerSha256: "5".repeat(64),
    protectedContainerImage: "nodekit/protected:test",
    protectedContainerImageId: `sha256:${"8".repeat(64)}`,
    agentContainerImage: "nodekit/agents:test",
    agentContainerImageId: `sha256:${"9".repeat(64)}`,
  });
  assert.equal(plan.runs.length, 15);
  assert.equal(plan.runs.filter((run) => run.bootstrapMode === "agent-process-packed-cli-from-empty").length, 1);
  assert.ok(plan.runs.every((run) => run.args.includes(`--bootstrap-mode=${run.bootstrapMode}`)));
  assert.equal(new Set(plan.runs.map((run) => run.runId)).size, 15);
  assert.deepEqual(plan.profileCounts, AGENT_EASE_PROFILE_COUNTS);
  for (const taskId of AGENT_EASE_TASK_IDS) {
    const taskRuns = plan.runs.filter((run) => run.taskId === taskId);
    assert.equal(taskRuns.filter((run) => run.agentProfile === "codex").length, 3);
    assert.equal(taskRuns.filter((run) => run.agentProfile === "claude-code").length, 1);
    assert.equal(taskRuns.filter((run) => run.agentProfile === "lower-cost").length, 1);
  }
  assert.ok(plan.runs.filter((run) => run.agentProfile === "lower-cost").every((run) =>
    run.model === "economy-model"
    && run.args.includes("--agentModel=economy-model")
    && run.args.includes("--agentDriver=codex")
    && run.args.includes("--evidence-root=/tmp/evidence")));
  assert.ok(plan.runs.every((run) => run.args.includes(`--task-brief-sha256=${taskBriefById[run.taskId].sha256}`)
    && run.args.includes(`--candidate=${"c".repeat(40)}`)
    && run.args.includes(`--trial-runner-sha256=${"f".repeat(64)}`)
    && run.args.includes(`--protected-evaluator-sha256=${"6".repeat(64)}`)));
});

test("campaign CLI parsing rejects unknown, duplicate, positional, and malformed flags", () => {
  assert.deepEqual({ ...parseAgentEaseCliArgs(["--candidate=abc", "--dry-run"], {
    allowed: ["candidate", "dry-run"],
    boolean: ["dry-run"],
  }) }, { candidate: "abc", "dry-run": true });
  assert.throws(() => parseAgentEaseCliArgs(["--candidate=a", "--candidate=b"], { allowed: ["candidate"] }), /duplicate/);
  assert.throws(() => parseAgentEaseCliArgs(["--unknown=x"], { allowed: ["candidate"] }), /unknown/);
  assert.throws(() => parseAgentEaseCliArgs(["positional"], { allowed: [] }), /positional/);
  assert.throws(() => parseAgentEaseCliArgs(["--candidate"], { allowed: ["candidate"] }), /requires/);
  assert.throws(() => parseAgentEaseCliArgs(["--dry-run=true"], { allowed: ["dry-run"], boolean: ["dry-run"] }), /does not accept/);
});

test("provider broker fails closed once its scoped credential is expired", () => {
  const result = spawnSync(process.execPath, [path.resolve("scripts", "run-agent-provider-broker.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODEKIT_BROKER_API_KEY: "scoped-test-key-that-is-never-sent",
      NODEKIT_BROKER_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
      NODEKIT_BROKER_ALLOWED_MODEL: "gpt-5.4",
      NODEKIT_BROKER_PROVIDER: "openai",
    },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /must be a future timestamp/);
});

test("independent source-pack comparison rejects a substituted archive", () => {
  const source = {
    canonicalManifestSha256: "a".repeat(64),
    fileCount: 10,
    name: "@homenshum/nodekit",
    unpackedSize: 100,
    version: "0.2.1",
  };
  assert.deepEqual(validateIndependentSourceArchive(source, { ...source }), {
    canonicalManifestSha256: true,
    fileCount: true,
    name: true,
    unpackedSize: true,
    version: true,
  });
  assert.throws(() => validateIndependentSourceArchive(source, {
    ...source,
    canonicalManifestSha256: "b".repeat(64),
  }), /independent script-disabled pack.*canonicalManifestSha256/);
});

test("campaign planning fails closed on incomplete tasks or unproven lower-cost claims", () => {
  assert.throws(() => buildAgentEaseCampaignPlan({
    campaignId: "candidate123",
    candidateCommit: "c".repeat(40),
    candidateSourceHash: "d".repeat(64),
    claudeModel: "claude-primary-model",
    codexModel: "codex-primary-model",
    lowerCostDriver: "codex",
    lowerCostEvidence,
    lowerCostModel: "economy-model",
    nodekitTarball: "/tmp/nodekit.tgz",
    nodekitTarballSha256: "b".repeat(64),
    taskBriefById,
    taskSetFile: "/tmp/heldout-tasks.json",
    taskSetSha256: "e".repeat(64),
    tasks: [{ id: "research-map" }],
    trialRunnerSha256: "f".repeat(64),
    protectedEvaluatorFile: "/tmp/protected-evaluator.mjs",
    protectedEvaluatorSha256: "6".repeat(64),
    protectedBrowserLaneFile: "/tmp/protected-browser-lane.mjs",
    protectedBrowserLaneSha256: "7".repeat(64),
    providerBrokerFile: "/tmp/provider-broker.mjs",
    providerBrokerSha256: "5".repeat(64),
    protectedContainerImage: "nodekit/protected:test",
    protectedContainerImageId: `sha256:${"8".repeat(64)}`,
    agentContainerImage: "nodekit/agents:test",
    agentContainerImageId: `sha256:${"9".repeat(64)}`,
  }), /requires exactly these held-out tasks/);
  assert.throws(() => validateLowerCostEvidence({
    ...lowerCostEvidence,
    passed: false,
  }), /must explicitly pass/);
  assert.throws(() => validateLowerCostEvidence({
    ...lowerCostEvidence,
    comparators: [{ inputUsdPerMillion: 1, model: "primary-model", outputUsdPerMillion: 4 }],
  }), /strictly more expensive/);
  assert.throws(() => validateLowerCostEvidence({
    ...lowerCostEvidence,
    source: { ...lowerCostEvidence.source, snapshotSha256: "not-a-hash" },
  }), /snapshotSha256/);
});

test("official pricing snapshot must match authoritative raw rows and freshness", () => {
  const evidence = validateLowerCostEvidence({
    ...lowerCostEvidence,
    model: "gpt-5.6-luna",
    observedAt: "2026-07-22T12:00:00.000Z",
    lowerCost: { inputUsdPerMillion: 1, outputUsdPerMillion: 6 },
    comparators: [{ inputUsdPerMillion: 5, model: "gpt-5.6-sol", outputUsdPerMillion: 30 }],
    source: {
      ...lowerCostEvidence.source,
      url: "https://developers.openai.com/api/docs/pricing",
    },
  });
  const snapshot = {
    schemaVersion: "nodekit.external-source-snapshot/v1",
    retrievedAt: evidence.observedAt,
    source: evidence.source.url,
    unit: "USD per 1M tokens",
    columns: ["model", "input", "cachedInput", "cacheWrite", "output"],
    rows: [
      ["gpt-5.6-sol", 5, 0.5, 6.25, 30],
      ["gpt-5.6-luna", 1, 0.1, 1.25, 6],
    ],
  };
  const validated = validateOfficialPricingSnapshot(snapshot, evidence, {
    referenceTime: "2026-07-23T12:00:00.000Z",
  });
  assert.deepEqual(validated.verifiedModels, ["gpt-5.6-luna", "gpt-5.6-sol"]);
  assert.throws(() => validateOfficialPricingSnapshot({
    ...snapshot,
    rows: snapshot.rows.map((row) => row[0] === "gpt-5.6-luna" ? [row[0], 2, ...row.slice(2)] : row),
  }, evidence, { referenceTime: "2026-07-23T12:00:00.000Z" }), /prices do not match/);
  assert.throws(() => validateOfficialPricingSnapshot(snapshot, evidence, {
    referenceTime: "2026-09-01T12:00:00.000Z",
  }), /stale/);
  assert.throws(() => validateOfficialPricingSnapshot({ ...snapshot, source: "https://example.test/pricing" }, evidence, {
    referenceTime: "2026-07-23T12:00:00.000Z",
  }), /does not match/);
  assert.throws(() => validateOfficialPricingSnapshot(snapshot, {
    ...evidence,
    observedAt: "2026-07-22T12:00:01.000Z",
  }, { referenceTime: "2026-07-23T12:00:00.000Z" }), /observedAt must exactly match/);
});

test("trial runner refuses mutable repository task lookup inputs", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts", "run-agent-ease-trial.mjs"),
    "--task=research-map",
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /--task-brief-file=<immutable-task\.txt> is required/);
  const duplicate = spawnSync(process.execPath, [
    path.resolve("scripts", "run-agent-ease-trial.mjs"),
    "--task=research-map",
    "--task=launch-presentation",
  ], { encoding: "utf8" });
  assert.equal(duplicate.status, 1);
  assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /duplicate CLI option --task/);
});

function qualifyingManifest(run, candidate) {
  const evidencePaths = {
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
  };
  const evidence = Object.entries(evidencePaths).map(([kind, path]) => ({ bytes: 1, kind, path, sha256: digest(kind) }));
  const instructionPolicy = {
    automaticPath: run.agentDriver === "codex" ? "AGENTS.md" : "CLAUDE.md",
    canonicalPath: "AGENTS.md",
    files: ["AGENTS.md", "CLAUDE.md"].map((file) => ({ path: file, sha256: digest(`${run.runId}/${file}`) })),
    loadedPaths: run.agentDriver === "codex" ? ["AGENTS.md"] : ["CLAUDE.md", "AGENTS.md"],
    parentContextInherited: false,
    routingDirective: run.agentDriver === "codex" ? null : "@AGENTS.md",
    rulesIgnored: false,
    schemaVersion: "nodekit.agent-instruction-policy/v1",
  };
  instructionPolicy.instructionSetSha256 = digest(JSON.stringify(instructionPolicy));
  const emptyDirectoryBootstrap = run.bootstrapMode === "agent-process-packed-cli-from-empty";
  const agentBootstrap = {
    agentInitiatedScaffold: emptyDirectoryBootstrap,
    candidateDirectoryInitiallyEmpty: emptyDirectoryBootstrap,
    commandSha256: digest(`${run.runId}/bootstrap-command`),
    firstWorkspaceWriteFromAgentSession: emptyDirectoryBootstrap,
    mode: run.bootstrapMode,
    nodekitCliSha256: digest(`${run.runId}/nodekit-cli`),
    nodekitTarballSha256: candidate.tarballSha256,
    offlineDependencyInstall: emptyDirectoryBootstrap,
    packedCliInvokedInsideAgentProcess: emptyDirectoryBootstrap,
    schemaVersion: "nodekit.agent-bootstrap/v1",
    workspaceEmptyAtAgentStart: emptyDirectoryBootstrap,
  };
  agentBootstrap.bootstrapSha256 = digest(JSON.stringify(agentBootstrap));
  const agentBootstrapSession = emptyDirectoryBootstrap
    ? { commandCount: 6, firstMutatingCommandSha256: agentBootstrap.commandSha256, passed: true, scaffoldCommandSha256: agentBootstrap.commandSha256 }
    : { commandCount: 0, firstMutatingCommandSha256: null, passed: true, scaffoldCommandSha256: null };
  const agentProcessIsolation = {
    bootstrap: agentBootstrap,
    broker: { allowedModel: run.model, containerId: digest(`${run.runId}/broker`), expiresAt: "2026-07-22T20:00:00.000Z", imageId: run.agentContainerImageId, runnerSha256: run.providerBrokerSha256 },
    checks: Object.fromEntries([
      "bootstrapContractBound", "brokerCredentialExpiryBound", "brokerExactImageBound", "brokerModelBound", "brokerNoPublishedPorts", "brokerRunnerBound", "capabilitiesDropped",
      "candidateOnlyWritableHostMount", "containerCommandBound", "credentialBrokered", "dockerSocketAbsent", "exactImageBound",
      "hostNamespacesNotShared", "instructionPolicyBound", "internalNetworkBound", "noCredentialMount",
      "noEvidenceOrEvaluatorMount", "noNewPrivileges", "noPublishedPorts", "providerBrokerOnlyPeer",
      "readOnlyRootFilesystem", "scopedMountSet",
    ].map((key) => [key, true])),
    commandSha256: digest(`${run.runId}/agent-command`),
    containerId: digest(`${run.runId}/agent-container`),
    credential: { expiresAt: "2026-07-22T20:00:00.000Z", fingerprintSha256: digest(`${run.runId}/credential`), provider: run.agentDriver === "codex" ? "openai" : "anthropic", scope: run.agentDriver === "codex" ? "responses:write" : "messages:write" },
    driver: run.agentDriver,
    image: { id: run.agentContainerImageId, reference: run.agentContainerImage },
    instructions: instructionPolicy,
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
    network: { id: digest(`${run.runId}/agent-network`), internal: true, name: `network-${run.runId}` },
    schemaVersion: "nodekit.coding-agent-isolation/v1",
  };
  agentProcessIsolation.isolationSha256 = digest(JSON.stringify(agentProcessIsolation));
  const value = {
    schemaVersion: "nodekit.agent-ease-trial/v2",
    runId: run.runId,
    taskId: run.taskId,
    agentProfile: run.agentProfile,
    agentBootstrap,
    agentBootstrapSession,
    agentBootstrapSha256: agentBootstrap.bootstrapSha256,
    bootstrapMode: run.bootstrapMode,
    agentDriver: run.agentDriver,
    agentCommandSha256: agentProcessIsolation.commandSha256,
    agentContainerImage: run.agentContainerImage,
    agentContainerImageId: run.agentContainerImageId,
    agentModel: run.model,
    nodekitCommit: candidate.commit,
    endingNodekitCommit: candidate.commit,
    nodekitSourceHash: candidate.sourceHash,
    endingNodekitSourceHash: candidate.sourceHash,
    nodekitTarballSha256: candidate.tarballSha256,
    nodekitPackage: candidate.packageName,
    nodekitVersion: candidate.packageVersion,
    promptSha256: run.taskBriefSha256,
    taskSetSha256: run.taskSetSha256,
    trialRunnerSha256: run.trialRunnerSha256,
    protectedEvaluatorSha256: run.protectedEvaluatorSha256,
    protectedBrowserLaneSha256: run.protectedBrowserLaneSha256,
    protectedContainerImage: run.protectedContainerImage,
    protectedContainerImageId: run.protectedContainerImageId,
    providerBrokerSha256: run.providerBrokerSha256,
    protectedIsolationSha256: digest(`${run.runId}/protected-isolation`),
    protectedEvaluationSha256: evidence.find((entry) => entry.kind === "protected-evaluation").sha256,
    evaluatorScreenshotSha256: evidence.find((entry) => entry.kind === "evaluator-screenshot").sha256,
    visualReviewInventorySha256: evidence.find((entry) => entry.kind === "visual-review-inventory").sha256,
    screenshotEvidenceRootSha256: digest(`${run.runId}/screenshot-root`),
    passed: true,
    agentExitCode: 0,
    executor: "docker",
    packageManager: "npm",
    postAgentTreeHash: digest(`${run.runId}/post-agent-tree`).slice(0, 40),
    agentSessionId: `session-${run.runId}`,
    agentVersion: "test-agent 1.0.0",
    agentProcessIsolation,
    agentProcessIsolationSha256: agentProcessIsolation.isolationSha256,
    agentInstructionPolicy: instructionPolicy,
    agentInstructionPolicySha256: instructionPolicy.instructionSetSha256,
    applicationHash: digest(`${run.runId}/application`),
    candidateArchiveSha256: evidence.find((entry) => entry.kind === "candidate-archive").sha256,
    configHash: digest(`${run.runId}/config`),
    durationMs: 60_000,
    substantiveFiles: ["src/workflow.mjs"],
    trialStartedAt: "2026-07-22T12:00:00.000Z",
    generatedAt: "2026-07-22T12:01:00.000Z",
    verdict: "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED",
    freshSession: true,
    agentSessionMode: "ephemeral",
    interventions: 0,
    userReprompts: 0,
    checks: Object.fromEntries(AGENT_EASE_REQUIRED_CHECKS.map((key) => [key, true])),
    evidence,
    evidenceSetSha256: digest(JSON.stringify(evidence)),
  };
  value.receiptSha256 = digest(JSON.stringify(value));
  return value;
}

test("coding-agent isolation rejects raw credential mounts and non-internal networks", () => {
  const run = {
    agentContainerImage: "nodekit/agents:test",
    agentContainerImageId: `sha256:${"9".repeat(64)}`,
    agentDriver: "codex",
    agentModel: "codex-primary-model",
    bootstrapMode: "pre-scaffolded-packed-cli",
    providerBrokerSha256: "5".repeat(64),
    runId: "credential-boundary",
  };
  const isolation = qualifyingManifest({
    ...run,
    agentProfile: "codex",
    model: "codex-primary-model",
    protectedBrowserLaneSha256: "7".repeat(64),
    protectedContainerImage: "nodekit/protected:test",
    protectedContainerImageId: `sha256:${"8".repeat(64)}`,
    protectedEvaluatorSha256: "6".repeat(64),
    taskBriefSha256: "4".repeat(64),
    taskId: "research-map",
    taskSetSha256: "3".repeat(64),
    trialRunnerSha256: "2".repeat(64),
  }, {
    commit: "1".repeat(40), packageName: "@homenshum/nodekit", packageVersion: "0.2.1",
    sourceHash: "a".repeat(64), tarballSha256: "b".repeat(64),
  }).agentProcessIsolation;
  validateCodingAgentIsolation(isolation, run);
  const rawCredentialMount = structuredClone(isolation);
  rawCredentialMount.mounts.push({ destination: "/auth/auth.json", readOnly: true, type: "bind" });
  rawCredentialMount.isolationSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(rawCredentialMount).filter(([key]) => key !== "isolationSha256"))));
  assert.throws(() => validateCodingAgentIsolation(rawCredentialMount, run), /mount boundary/);
  const publicNetwork = structuredClone(isolation);
  publicNetwork.network.internal = false;
  publicNetwork.isolationSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(publicNetwork).filter(([key]) => key !== "isolationSha256"))));
  assert.throws(() => validateCodingAgentIsolation(publicNetwork, run), /internal network/);
});

test("trial and measurement validators bind the exact receipt and no-cherry-pick run set", () => {
  const candidate = {
    commit: "1".repeat(40),
    sourceHash: "2".repeat(64),
    tarballSha256: "3".repeat(64),
    packageName: "@homenshum/nodekit",
    packageVersion: "0.2.1",
  };
  const plan = buildAgentEaseCampaignPlan({
    campaignId: "bound",
    candidateCommit: candidate.commit,
    candidateSourceHash: candidate.sourceHash,
    claudeModel: "claude-primary-model",
    codexModel: "codex-primary-model",
    lowerCostDriver: "codex",
    lowerCostEvidence,
    lowerCostModel: "economy-model",
    nodekitTarball: "/tmp/nodekit.tgz",
    nodekitTarballSha256: candidate.tarballSha256,
    taskBriefById,
    taskSetFile: "/tmp/tasks.json",
    taskSetSha256: "4".repeat(64),
    tasks: taskDocuments,
    trialRunnerSha256: "5".repeat(64),
    protectedEvaluatorFile: "/tmp/protected-evaluator.mjs",
    protectedEvaluatorSha256: "6".repeat(64),
    protectedBrowserLaneFile: "/tmp/protected-browser-lane.mjs",
    protectedBrowserLaneSha256: "7".repeat(64),
    providerBrokerFile: "/tmp/provider-broker.mjs",
    providerBrokerSha256: "a".repeat(64),
    protectedContainerImage: "nodekit/protected:test",
    protectedContainerImageId: `sha256:${"8".repeat(64)}`,
    agentContainerImage: "nodekit/agents:test",
    agentContainerImageId: `sha256:${"9".repeat(64)}`,
  });
  const manifests = new Map();
  const selectedRuns = plan.runs.map((run) => {
    const value = qualifyingManifest(run, candidate);
    validateAgentEaseTrialManifest(value, { candidate, run });
    const fileSha256 = digest(`${run.runId}/manifest`);
    manifests.set(run.runId, { fileSha256, value });
    const selectedEvidence = value.evidence.map((entry) => ({ ...entry, path: `${run.runId}/${entry.path}` }));
    return {
      agentBootstrapSha256: value.agentBootstrapSha256,
      runId: run.runId,
      taskId: run.taskId,
      agentProfile: run.agentProfile,
      agentDriver: run.agentDriver,
      agentCommandSha256: value.agentCommandSha256,
      agentContainerImage: value.agentContainerImage,
      agentContainerImageId: value.agentContainerImageId,
      agentModel: run.model,
      agentVersion: value.agentVersion,
      bootstrapMode: value.bootstrapMode,
      agentProcessIsolationSha256: value.agentProcessIsolationSha256,
      agentSessionId: value.agentSessionId,
      freshSession: true,
      trialStartedAt: value.trialStartedAt,
      generatedAt: value.generatedAt,
      applicationHash: value.applicationHash,
      candidateArchiveSha256: value.candidateArchiveSha256,
      configHash: value.configHash,
      durationMs: value.durationMs,
      promptSha256: run.taskBriefSha256,
      taskSetSha256: value.taskSetSha256,
      trialRunnerSha256: value.trialRunnerSha256,
      nodekitCommit: candidate.commit,
      nodekitSourceHash: candidate.sourceHash,
      nodekitTarballSha256: candidate.tarballSha256,
      nodekitPackage: candidate.packageName,
      nodekitVersion: candidate.packageVersion,
      postAgentTreeHash: value.postAgentTreeHash,
      protectedEvaluatorSha256: value.protectedEvaluatorSha256,
      protectedBrowserLaneSha256: value.protectedBrowserLaneSha256,
      protectedContainerImage: value.protectedContainerImage,
      protectedContainerImageId: value.protectedContainerImageId,
      protectedIsolationSha256: value.protectedIsolationSha256,
      protectedEvaluationSha256: value.protectedEvaluationSha256,
      evaluatorScreenshotSha256: value.evaluatorScreenshotSha256,
      visualReviewInventorySha256: value.visualReviewInventorySha256,
      screenshotEvidenceRootSha256: value.screenshotEvidenceRootSha256,
      receiptSha256: value.receiptSha256,
      manifestSha256: fileSha256,
      manifestPath: `${run.runId}/manifest.json`,
      evidence: selectedEvidence,
      evidenceCount: 19,
      evidenceSetSha256: digest(JSON.stringify(selectedEvidence)),
      passed: true,
      validationPassed: true,
    };
  });
  const verdict = {
    schemaVersion: "nodekit.fresh-agent-verdict/v2",
    passed: true,
    errors: [],
    nodekitCommit: candidate.commit,
    nodekitSourceHash: candidate.sourceHash,
    nodekitIdentity: `${candidate.commit}/${candidate.sourceHash}`,
    releaseCandidate: {
      nodekitCommit: candidate.commit,
      nodekitSourceHash: candidate.sourceHash,
      nodekitTarballSha256: candidate.tarballSha256,
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
    },
    requiredTasks: [...AGENT_EASE_TASK_IDS],
    requiredProfiles: { ...AGENT_EASE_PROFILE_COUNTS },
    requiredRuns: 15,
    observedTrials: 15,
    observedRepositoryTrials: 15,
    ignoredOtherCandidateTrials: 0,
    legacyTrialsIgnored: 0,
    failedTrials: 0,
    allAttemptsSelected: true,
    combinedZeroToAppClaim: true,
    emptyDirectoryAgentCliRuns: 1,
    lowerCostPricingEvidence: {
      agentDriver: "codex",
      evidencePath: "bound/inputs/lower-cost-model-evidence.json",
      evidenceSha256: "a".repeat(64),
      model: "economy-model",
      pricingValidation: {
        ageMs: 0,
        retrievedAt: lowerCostEvidence.observedAt,
        source: lowerCostEvidence.source.url,
        validatedAt: lowerCostEvidence.observedAt,
        verifiedModels: ["economy-model", "primary-model"],
      },
      schemaVersion: "nodekit.lower-cost-pricing-binding/v1",
      snapshotPath: "bound/inputs/lower-cost-source.snapshot.json",
      snapshotSha256: lowerCostEvidence.source.snapshotSha256,
    },
    timing: {
      observed: { maxRunMs: 60_000, medianRunMs: 60_000 },
      schemaVersion: "nodekit.fresh-agent-timing/v1",
      thresholds: {
        maxRunMs: AGENT_EASE_MAX_RUN_DURATION_MS,
        medianRunMs: AGENT_EASE_MEDIAN_RUN_DURATION_MS,
      },
    },
    selectedRuns,
  };
  assert.equal(validateAgentEaseMeasurementVerdict(verdict, { candidate, manifests, runs: plan.runs }).passed, true);
  assert.throws(() => validateAgentEaseMeasurementVerdict({
    ...verdict,
    selectedRuns: verdict.selectedRuns.map((entry, index) => index === 0 ? { ...entry, manifestSha256: "9".repeat(64) } : entry),
  }, { candidate, manifests, runs: plan.runs }), /does not bind/);
  assert.throws(() => validateAgentEaseMeasurementVerdict({
    ...verdict,
    combinedZeroToAppClaim: false,
    emptyDirectoryAgentCliRuns: 0,
    selectedRuns: verdict.selectedRuns.map((entry) => ({ ...entry, bootstrapMode: "pre-scaffolded-packed-cli" })),
  }, { candidate, manifests, runs: plan.runs }), /empty-directory|15-run matrix|does not bind/);
  const first = plan.runs[0];
  const forged = { ...manifests.get(first.runId).value, taskSetSha256: "9".repeat(64) };
  forged.receiptSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== "receiptSha256"))));
  assert.throws(() => validateAgentEaseTrialManifest(forged, { candidate, run: first }), /taskSetSha256/);
  const forgedBootstrap = structuredClone(manifests.get(first.runId).value);
  forgedBootstrap.agentBootstrap.candidateDirectoryInitiallyEmpty = false;
  forgedBootstrap.agentBootstrap.packedCliInvokedInsideAgentProcess = false;
  forgedBootstrap.agentBootstrap.offlineDependencyInstall = false;
  const bootstrapBody = { ...forgedBootstrap.agentBootstrap };
  delete bootstrapBody.bootstrapSha256;
  forgedBootstrap.agentBootstrap.bootstrapSha256 = digest(JSON.stringify(bootstrapBody));
  forgedBootstrap.agentBootstrapSha256 = forgedBootstrap.agentBootstrap.bootstrapSha256;
  forgedBootstrap.agentProcessIsolation.bootstrap = structuredClone(forgedBootstrap.agentBootstrap);
  const isolationBody = { ...forgedBootstrap.agentProcessIsolation };
  delete isolationBody.isolationSha256;
  forgedBootstrap.agentProcessIsolation.isolationSha256 = digest(JSON.stringify(isolationBody));
  forgedBootstrap.agentProcessIsolationSha256 = forgedBootstrap.agentProcessIsolation.isolationSha256;
  const forgedBootstrapBody = { ...forgedBootstrap };
  delete forgedBootstrapBody.receiptSha256;
  forgedBootstrap.receiptSha256 = digest(JSON.stringify(forgedBootstrapBody));
  assert.throws(() => validateAgentEaseTrialManifest(forgedBootstrap, { candidate, run: first }), /bootstrap.*invalid|falsely labels/);
  const evidenceRewrite = structuredClone(manifests.get(first.runId).value);
  evidenceRewrite.evidence[0].path = "agent/../agent/original-prompt.txt";
  evidenceRewrite.evidenceSetSha256 = digest(JSON.stringify(evidenceRewrite.evidence));
  evidenceRewrite.receiptSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(evidenceRewrite).filter(([key]) => key !== "receiptSha256"))));
  assert.throws(() => validateAgentEaseTrialManifest(evidenceRewrite, { candidate, run: first }), /wrong path/);
});

test("protected evaluator rejects candidate-authored and screenshot-root-tampered proof", async () => {
  const protectedBrowserLaneSha256 = "0".repeat(64);
  const protectedContainerImage = "mcr.microsoft.com/playwright:v1.61.1-noble";
  const protectedContainerImageId = `sha256:${"1".repeat(64)}`;
  const expected = {
    applicationHash: "1".repeat(64),
    browserManifestSha256: "2".repeat(64),
    candidateArchiveSha256: "3".repeat(64),
    configHash: "4".repeat(64),
    evaluatorScreenshotSha256: "5".repeat(64),
    evaluatorSha256: "6".repeat(64),
    nodekitCommit: "7".repeat(40),
    nodekitSourceHash: "8".repeat(64),
    nodekitTarballSha256: "9".repeat(64),
    postAgentTreeHash: "a".repeat(40),
    runId: "protected-run",
    screenshotEvidenceRootSha256: "b".repeat(64),
    taskBriefSha256: "c".repeat(64),
    taskId: "research-map",
    taskSetSha256: "d".repeat(64),
  };
  const isolationExpected = {
    browserLaneSha256: protectedBrowserLaneSha256,
    containerImage: protectedContainerImage,
    containerImageId: protectedContainerImageId,
  };
  const producer = {
    authority: "campaign-protected-evaluator",
    candidateEvidenceAccess: false,
    candidateHostAccess: false,
    candidateWriteAccess: false,
    executedAfterCandidateArchive: true,
    externalNetworkEgress: false,
    isolationMode: "docker-internal-two-container",
  };
  const isolation = {
    browserContainer: {
      containerId: "2".repeat(64),
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
    browserLaneSha256: protectedBrowserLaneSha256,
    browserDependencies: [
      { destination: "/runner/node_modules/playwright", fileCount: 10, name: "playwright", treeSha256: "0".repeat(64), version: "1.61.1" },
      { destination: "/runner/node_modules/playwright-core", fileCount: 10, name: "playwright-core", treeSha256: "1".repeat(64), version: "1.61.1" },
      { destination: "/runner/node_modules/@axe-core/playwright", fileCount: 10, name: "@axe-core/playwright", treeSha256: "2".repeat(64), version: "4.12.1" },
      { destination: "/runner/node_modules/axe-core", fileCount: 10, name: "axe-core", treeSha256: "3".repeat(64), version: "4.12.1" },
    ],
    candidateContainer: {
      containerId: "3".repeat(64),
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
    network: { driver: "bridge", internal: true, networkId: "4".repeat(64) },
    schemaVersion: "nodekit.protected-evaluator-isolation/v1",
  };
  isolation.isolationSha256 = digest(JSON.stringify(isolation));
  expected.isolationSha256 = isolation.isolationSha256;
  const inventory = {
    applicationHash: expected.applicationHash,
    automatedReview: true,
    browserManifestSha256: expected.browserManifestSha256,
    candidateArchiveSha256: expected.candidateArchiveSha256,
    configHash: expected.configHash,
    evaluatorScreenshotSha256: expected.evaluatorScreenshotSha256,
    generatedAt: "2026-07-22T12:00:00.000Z",
    humanUsabilityGateSatisfied: false,
    isolation,
    isolationSha256: isolation.isolationSha256,
    issues: [],
    nodekitCommit: expected.nodekitCommit,
    nodekitSourceHash: expected.nodekitSourceHash,
    nodekitTarballSha256: expected.nodekitTarballSha256,
    openIssueCounts: { p0: 0, p1: 0, p2: 0, p3: 0 },
    passed: true,
    postAgentTreeHash: expected.postAgentTreeHash,
    producer,
    runId: expected.runId,
    schemaVersion: "nodekit.visual-review-inventory/v1",
    screenshotCount: 180,
    screenshotEvidenceRootSha256: expected.screenshotEvidenceRootSha256,
    separateFromHumanUsability: true,
    taskId: expected.taskId,
  };
  inventory.inventorySha256 = digest(JSON.stringify(inventory));
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  const groups = Array.from({ length: 4 }, (_, index) => ({ alternatives: [`term-${index}`], group: index + 1, matches: [`term-${index}`], passed: true }));
  const protectedTask = protectedTaskFixture(expected.taskId, expected.runId, expected.candidateArchiveSha256);
  const evaluation = {
    ...expected,
    browserManifestSha256: expected.browserManifestSha256,
    candidateBrowserManifestSha256: expected.browserManifestSha256,
    checks: Object.fromEntries([
      "applicationIdentityBound", "artifactDownloadVerified", "artifactReloadPersistenceVerified", "artifactReopenPersistenceVerified",
      "browserEvidenceBound", "candidateArchiveBound", "candidateTreeBound", "evaluatorBytesBound",
      "guidedInteractionPassed", "independentScreenshotCaptured", "isolationBound", "renderedTaskRelevant", "sourceTaskRelevant", "taskBytesBound",
      "taskInputBound", "taskSetBound", "typedArtifactVerified", "visualReviewPassed",
    ].map((key) => [key, true])),
    generatedAt: "2026-07-22T12:00:01.000Z",
    isolation,
    isolationSha256: isolation.isolationSha256,
    passed: true,
    producer,
    protectedBrowserManifestFile: "protected-browser/screenshot-manifest.json",
    protectedTaskInput: protectedTask.protectedTaskInput,
    protectedTaskInputSha256: protectedTaskInputSha256(protectedTask.protectedTaskInput),
    schemaVersion: "nodekit.protected-agent-evaluation/v2",
    sourceFilesInspected: ["apps/web/public/index.html"],
    taskArtifactEvidence: protectedTask.artifact,
    taskRelevance: {
      renderedGroups: groups,
      renderedTextSha256: "e".repeat(64),
      sourceGroups: groups,
      sourceTextSha256: "f".repeat(64),
    },
    visualReviewInventorySha256: digest(inventoryBytes),
    visualReviewInventorySelfHash: inventory.inventorySha256,
  };
  evaluation.evaluationSha256 = digest(JSON.stringify(evaluation));
  assert.deepEqual(await validateSchema("nodekit.visual-review-inventory.v1.schema.json", inventory, "visual inventory"), []);
  assert.deepEqual(await validateSchema("nodekit.protected-agent-evaluation.v2.schema.json", evaluation, "protected evaluation"), []);
  assert.equal(validateVisualReviewInventory(inventory, { ...expected, ...isolationExpected }).passed, true);
  assert.equal(validateProtectedAgentEvaluation(evaluation, {
    ...expected,
    ...isolationExpected,
    visualReviewInventorySha256: evaluation.visualReviewInventorySha256,
    visualReviewInventorySelfHash: inventory.inventorySha256,
  }).passed, true);
  const legacyEvaluation = structuredClone(evaluation);
  legacyEvaluation.schemaVersion = "nodekit.protected-agent-evaluation/v1";
  delete legacyEvaluation.taskArtifactEvidence;
  delete legacyEvaluation.candidateBrowserManifestSha256;
  delete legacyEvaluation.protectedBrowserManifestFile;
  delete legacyEvaluation.protectedTaskInput;
  delete legacyEvaluation.protectedTaskInputSha256;
  for (const check of ["artifactDownloadVerified", "artifactReloadPersistenceVerified", "artifactReopenPersistenceVerified", "taskInputBound", "typedArtifactVerified"]) {
    delete legacyEvaluation.checks[check];
  }
  legacyEvaluation.evaluationSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(legacyEvaluation).filter(([key]) => key !== "evaluationSha256"))));
  assert.deepEqual(await validateSchema("nodekit.protected-agent-evaluation.v1.schema.json", legacyEvaluation, "legacy protected evaluation"), []);
  assert.equal(validateProtectedAgentEvaluationV1(legacyEvaluation, { ...expected, ...isolationExpected }).passed, true);
  assert.throws(() => validateProtectedAgentEvaluation(legacyEvaluation, { ...expected, ...isolationExpected }), /schemaVersion/);
  const forgedTaskArtifact = structuredClone(evaluation);
  forgedTaskArtifact.taskArtifactEvidence.canonicalContent.question = "";
  const forgedContentSha256 = digest(canonicalJson(forgedTaskArtifact.taskArtifactEvidence.canonicalContent));
  forgedTaskArtifact.taskArtifactEvidence.contentSha256 = forgedContentSha256;
  for (const field of ["marker", "reloadMarker", "reopenMarker"]) {
    forgedTaskArtifact.taskArtifactEvidence[field].contentSha256 = forgedContentSha256;
  }
  forgedTaskArtifact.evaluationSha256 = digest(JSON.stringify(Object.fromEntries(
    Object.entries(forgedTaskArtifact).filter(([key]) => key !== "evaluationSha256"),
  )));
  assert.throws(
    () => validateProtectedAgentEvaluation(forgedTaskArtifact, { ...expected, ...isolationExpected }),
    /canonical content failed replay|research-map content is incomplete/,
  );
  const candidateAuthored = structuredClone(evaluation);
  candidateAuthored.producer.candidateWriteAccess = true;
  candidateAuthored.evaluationSha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(candidateAuthored).filter(([key]) => key !== "evaluationSha256"))));
  assert.throws(() => validateProtectedAgentEvaluation(candidateAuthored, { ...expected, ...isolationExpected }), /candidate-authored/);
  const writableCandidate = structuredClone(evaluation);
  writableCandidate.isolation.candidateContainer.mounts[0].readOnly = false;
  writableCandidate.isolation.isolationSha256 = digest(JSON.stringify(Object.fromEntries(
    Object.entries(writableCandidate.isolation).filter(([key]) => key !== "isolationSha256"),
  )));
  writableCandidate.isolationSha256 = writableCandidate.isolation.isolationSha256;
  writableCandidate.evaluationSha256 = digest(JSON.stringify(Object.fromEntries(
    Object.entries(writableCandidate).filter(([key]) => key !== "evaluationSha256"),
  )));
  assert.throws(
    () => validateProtectedAgentEvaluation(writableCandidate, { ...expected, ...isolationExpected, isolationSha256: writableCandidate.isolationSha256 }),
    /read-only single-mount sandbox/,
  );
  const imageSubstitution = structuredClone(inventory);
  imageSubstitution.isolation.image.id = `sha256:${"9".repeat(64)}`;
  imageSubstitution.isolation.isolationSha256 = digest(JSON.stringify(Object.fromEntries(
    Object.entries(imageSubstitution.isolation).filter(([key]) => key !== "isolationSha256"),
  )));
  imageSubstitution.isolationSha256 = imageSubstitution.isolation.isolationSha256;
  imageSubstitution.inventorySha256 = digest(JSON.stringify(Object.fromEntries(
    Object.entries(imageSubstitution).filter(([key]) => key !== "inventorySha256"),
  )));
  assert.throws(
    () => validateVisualReviewInventory(imageSubstitution, { ...expected, ...isolationExpected, isolationSha256: imageSubstitution.isolationSha256 }),
    /image identity is invalid or drifted/,
  );
  const tamperedInventory = structuredClone(inventory);
  tamperedInventory.screenshotEvidenceRootSha256 = "0".repeat(64);
  tamperedInventory.inventorySha256 = digest(JSON.stringify(Object.fromEntries(Object.entries(tamperedInventory).filter(([key]) => key !== "inventorySha256"))));
  assert.throws(() => validateVisualReviewInventory(tamperedInventory, { ...expected, ...isolationExpected }), /screenshotEvidenceRootSha256/);
});
