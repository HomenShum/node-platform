import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_EASE_MAX_RUN_DURATION_MS,
  AGENT_EASE_MEDIAN_RUN_DURATION_MS,
  AGENT_EASE_REQUIRED_CHECKS,
  parseAgentEaseCliArgs,
  validateAgentBootstrap,
  validateAgentInstructionPolicy,
  validateCodingAgentIsolation,
  validateLowerCostEvidence,
  validateOfficialPricingSnapshot,
  validateProtectedAgentEvaluation,
  validateVisualReviewInventory,
} from "../src/lib/agent-ease-campaign.mjs";
import { inspectNpmPackageArchiveFile } from "../src/lib/npm-package-archive.mjs";
import { validateProtectedBrowserEvidence } from "../src/lib/protected-browser-evidence.mjs";
import { resolveSubmissionEvidenceClosure, validateSubmissionScreenshotPng } from "../src/lib/submission-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseAgentEaseCliArgs(process.argv.slice(2), {
  allowed: [
    "candidate", "evidence-repo-root", "nodekit-tarball", "nodekit-tarball-sha256",
    "lower-cost-evidence", "lower-cost-snapshot", "output", "root", "source-hash",
  ],
});
const root = path.resolve(String(options.root ?? "proof/ease/agents"));
const output = path.resolve(String(options.output ?? "proof/ease/fresh-agent-verdict.json"));
const evidenceRepoRoot = path.resolve(String(options["evidence-repo-root"] ?? repoRoot));
const candidateCommit = String(options.candidate ?? process.env.NODEKIT_SOURCE_COMMIT ?? "").toLowerCase();
const candidateSourceHash = String(options["source-hash"] ?? process.env.NODEKIT_SOURCE_HASH ?? "").toLowerCase();
const candidateTarballArgument = options["nodekit-tarball"];
if (typeof candidateTarballArgument !== "string" || candidateTarballArgument.trim().length === 0) {
  throw new Error("--nodekit-tarball=<exact-candidate.tgz> is required");
}
const candidateTarball = path.resolve(candidateTarballArgument);
const lowerCostEvidenceArgument = options["lower-cost-evidence"];
const lowerCostSnapshotArgument = options["lower-cost-snapshot"];
if (typeof lowerCostEvidenceArgument !== "string" || lowerCostEvidenceArgument.trim().length === 0) {
  throw new Error("--lower-cost-evidence=<preserved-official-evidence.json> is required");
}
if (typeof lowerCostSnapshotArgument !== "string" || lowerCostSnapshotArgument.trim().length === 0) {
  throw new Error("--lower-cost-snapshot=<preserved-official-snapshot.json> is required");
}
const lowerCostEvidenceFile = path.resolve(lowerCostEvidenceArgument);
const lowerCostSnapshotFile = path.resolve(lowerCostSnapshotArgument);
const expectedTarballSha256 = String(
  options["nodekit-tarball-sha256"]
    ?? process.env.NODEKIT_TARBALL_SHA256
    ?? "",
).toLowerCase() || undefined;
const candidateTarballMetadata = await lstat(candidateTarball);
if (!candidateTarballMetadata.isFile() || candidateTarballMetadata.isSymbolicLink()) {
  throw new Error("--nodekit-tarball must identify one regular, non-symlink .tgz file");
}
const inspectedCandidate = await inspectNpmPackageArchiveFile(candidateTarball, {
  expectedName: "@homenshum/nodekit",
  ...(expectedTarballSha256 === undefined ? {} : { expectedTarballSha256 }),
});
async function readRegularEvidence(file, label) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic-link file`);
  const [realRoot, realFile] = await Promise.all([realpath(evidenceRepoRoot), realpath(file)]);
  const relative = path.relative(realRoot, realFile);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside --evidence-repo-root`);
  }
  const bytes = await readFile(file);
  return { bytes, path: relative.replaceAll("\\", "/"), sha256: sha256(bytes) };
}
const [lowerCostEvidenceRecord, lowerCostSnapshotRecord] = await Promise.all([
  readRegularEvidence(lowerCostEvidenceFile, "lower-cost evidence"),
  readRegularEvidence(lowerCostSnapshotFile, "lower-cost source snapshot"),
]);
const lowerCostEvidenceRaw = JSON.parse(lowerCostEvidenceRecord.bytes.toString("utf8"));
const lowerCostEvidence = validateLowerCostEvidence(lowerCostEvidenceRaw);
if (lowerCostEvidence.source.snapshotSha256 !== lowerCostSnapshotRecord.sha256) {
  throw new Error("lower-cost evidence does not bind the supplied official source snapshot");
}
const lowerCostSnapshot = JSON.parse(lowerCostSnapshotRecord.bytes.toString("utf8"));
const lowerCostValidatedAt = new Date().toISOString();
const lowerCostPricingValidation = {
  ...validateOfficialPricingSnapshot(lowerCostSnapshot, lowerCostEvidence, { referenceTime: lowerCostValidatedAt }),
  validatedAt: lowerCostValidatedAt,
};
const lowerCostPricingEvidence = Object.freeze({
  agentDriver: lowerCostEvidence.agentDriver,
  evidencePath: lowerCostEvidenceRecord.path,
  evidenceSha256: lowerCostEvidenceRecord.sha256,
  model: lowerCostEvidence.model,
  pricingValidation: lowerCostPricingValidation,
  schemaVersion: "nodekit.lower-cost-pricing-binding/v1",
  snapshotPath: lowerCostSnapshotRecord.path,
  snapshotSha256: lowerCostSnapshotRecord.sha256,
});
const tasksDocumentBytes = await readFile(path.join(repoRoot, "evals", "ease", "heldout-tasks.json"));
const tasksDocument = JSON.parse(tasksDocumentBytes.toString("utf8"));
const requiredTaskSetSha256 = sha256(tasksDocumentBytes);
const taskById = new Map(tasksDocument.tasks.map((task) => [task.id, task]));
const requiredTasks = ["research-map", "volunteer-onboarding", "launch-presentation"];
const requiredProfiles = Object.freeze({ codex: 3, "claude-code": 1, "lower-cost": 1 });
const requiredRuns = requiredTasks.length * Object.values(requiredProfiles).reduce((total, count) => total + count, 0);
const requiredEvidenceByKind = Object.freeze({
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
const requiredEvidenceKinds = Object.keys(requiredEvidenceByKind);
const requiredTrialChecks = AGENT_EASE_REQUIRED_CHECKS;
const protectedProviderBrokerSha256 = sha256(await readFile(path.join(repoRoot, "scripts", "run-agent-provider-broker.mjs")));
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const releaseCandidate = COMMIT.test(candidateCommit) && SHA256.test(candidateSourceHash)
  ? Object.freeze({
      nodekitCommit: candidateCommit,
      nodekitSourceHash: candidateSourceHash,
      nodekitTarballSha256: inspectedCandidate.tarballSha256,
      packageName: inspectedCandidate.name,
      packageVersion: inspectedCandidate.version,
    })
  : null;

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function lexical(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function exactSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && [...new Set(values)].sort().join("\n") === [...expected].sort().join("\n");
}
function receiptHash(value) {
  const { receiptSha256: _receiptSha256, ...body } = value;
  return sha256(JSON.stringify(body));
}
const protectedEvaluatorSha256 = sha256(await readFile(path.join(repoRoot, "scripts", "run-protected-agent-evaluator.mjs")));
const protectedBrowserLaneSha256 = sha256(await readFile(path.join(repoRoot, "scripts", "run-protected-browser-lane.mjs")));
const protectedTrialRunnerSha256 = sha256(await readFile(path.join(repoRoot, "scripts", "run-agent-ease-trial.mjs")));
function isCanonicalEvidencePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && path.posix.normalize(value) === value
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
const manifests = [];
const legacyTrials = [];
const invalidManifestPaths = [];
for (const entry of directories) {
  if (!entry.isDirectory()) continue;
  const file = path.join(root, entry.name, "manifest.json");
  try {
    const bytes = await readFile(file);
    const value = JSON.parse(bytes.toString("utf8"));
    if (value.schemaVersion === "nodekit.agent-ease-trial/v1") {
      legacyTrials.push({ file, value });
      continue;
    }
    if (value.schemaVersion === "nodekit.agent-ease-trial/v2") manifests.push({ bytes, directory: path.dirname(file), file, value });
    else invalidManifestPaths.push(path.relative(root, file).replaceAll("\\", "/"));
  } catch {
    invalidManifestPaths.push(path.relative(root, file).replaceAll("\\", "/"));
  }
}

const errors = invalidManifestPaths.map((file) => `invalid or incomplete trial manifest: ${file}`);
if (!COMMIT.test(candidateCommit)) errors.push("--candidate=<40-char-commit> is required");
if (!SHA256.test(candidateSourceHash)) errors.push("--source-hash=<64-char-source-hash> is required");
for (const trial of legacyTrials.filter(({ value }) => value.nodekitCommit === candidateCommit && value.nodekitSourceHash === candidateSourceHash)) {
  errors.push(`exact candidate contains a non-qualifying v1 attempt: ${path.relative(root, trial.file).replaceAll("\\", "/")}`);
}

const selected = manifests
  .filter(({ value }) => value.nodekitCommit === candidateCommit && value.nodekitSourceHash === candidateSourceHash)
  .sort((a, b) => lexical(`${a.value.taskId}/${a.value.agentProfile}/${a.value.runId}`, `${b.value.taskId}/${b.value.agentProfile}/${b.value.runId}`));
if (selected.length !== requiredRuns) errors.push(`exact candidate requires ${requiredRuns} total trials; observed ${selected.length}`);

const runIds = new Set();
const manifestHashes = new Set();
const sessionIds = new Set();
const sessionEvidenceHashes = new Set();
const selectedRuns = [];
for (const trial of selected) {
  const value = trial.value;
  const runErrors = [];
  const trialRealDirectory = await realpath(trial.directory);
  const runRelativeManifestPath = path.relative(root, trial.file).replaceAll("\\", "/");
  const manifestPath = path.relative(evidenceRepoRoot, trial.file).replaceAll("\\", "/");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runId ?? "") || runRelativeManifestPath !== `${value.runId}/manifest.json`) runErrors.push("runId does not match its path-safe evidence directory");
  if (!isCanonicalEvidencePath(manifestPath)) runErrors.push("trial manifest is outside the declared evidence repository root or is not canonical");
  if (runIds.has(value.runId)) runErrors.push("duplicate runId");
  runIds.add(value.runId);
  if (value.passed !== true) runErrors.push("trial did not pass");
  if (value.agentExitCode !== 0) runErrors.push("agent process did not exit successfully");
  if (!new Set(["native", "docker"]).has(value.executor)) runErrors.push(`unsupported executor ${value.executor ?? "missing"}`);
  if (!new Set(["npm", "pnpm"]).has(value.packageManager)) runErrors.push(`unsupported package manager ${value.packageManager ?? "missing"}`);
  if (value.verdict !== "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED") runErrors.push("trial verdict is not the qualifying pilot-pass state");
  if (value.nodekitPackage !== inspectedCandidate.name) runErrors.push("trial package name does not match the exact candidate tarball");
  if (value.nodekitVersion !== inspectedCandidate.version) runErrors.push("trial package version does not match the exact candidate tarball");
  if (value.nodekitTarballSha256 !== inspectedCandidate.tarballSha256) runErrors.push("trial tarball SHA-256 does not match the exact candidate tarball");
  if (!SHA256.test(value.applicationHash ?? "") || !SHA256.test(value.configHash ?? "")) runErrors.push("generated application identity is missing");
  if (!COMMIT.test(value.postAgentTreeHash ?? "") || !SHA256.test(value.candidateArchiveSha256 ?? "")) {
    runErrors.push("post-agent tree or candidate archive identity is missing");
  }
  if (value.freshSession !== true || value.agentSessionMode !== "ephemeral") runErrors.push("session was not recorded as fresh and ephemeral");
  if (typeof value.agentSessionId !== "string" || value.agentSessionId.trim().length === 0) runErrors.push("agent session identity is missing");
  else if (sessionIds.has(value.agentSessionId)) runErrors.push("agent session identity is reused");
  else sessionIds.add(value.agentSessionId);
  if (value.interventions !== 0 || value.userReprompts !== 0) runErrors.push("intervention or reprompt recorded");
  if (!Array.isArray(value.substantiveFiles) || value.substantiveFiles.length === 0) runErrors.push("no substantive files");
  if (!value.checks
    || !exactSet(Object.keys(value.checks), requiredTrialChecks)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    runErrors.push("one or more exact required checks failed or were omitted");
  }
  if (value.nodekitCommit !== candidateCommit || value.nodekitSourceHash !== candidateSourceHash) runErrors.push("trial source identity does not match the exact candidate");
  if (value.endingNodekitCommit !== candidateCommit || value.endingNodekitSourceHash !== candidateSourceHash) runErrors.push("NodeKit identity changed during trial");
  if (!Object.hasOwn(requiredProfiles, value.agentProfile)) runErrors.push(`unsupported agent profile ${value.agentProfile}`);
  if (!new Set(["codex", "claude-code"]).has(value.agentDriver)) runErrors.push(`unsupported agent driver ${value.agentDriver}`);
  if (value.agentProfile === "codex" && value.agentDriver !== "codex") runErrors.push("codex profile used the wrong driver");
  if (value.agentProfile === "claude-code" && value.agentDriver !== "claude-code") runErrors.push("claude-code profile used the wrong driver");
  if (typeof value.agentModel !== "string" || value.agentModel.trim().length === 0) runErrors.push("live brokered profile omitted its explicit model");
  if (typeof value.agentVersion !== "string" || value.agentVersion.trim().length === 0) runErrors.push("agent version is missing");
  if (!validDate(value.trialStartedAt) || !validDate(value.generatedAt) || Date.parse(value.generatedAt) < Date.parse(value.trialStartedAt)) runErrors.push("trial timestamps are invalid");
  const task = taskById.get(value.taskId);
  if (!task) runErrors.push(`unknown held-out task ${value.taskId}`);
  else if (value.promptSha256 !== sha256(task.goal)) runErrors.push("prompt hash does not match the immutable held-out task");
  if (!SHA256.test(value.taskSetSha256 ?? "") || !SHA256.test(value.trialRunnerSha256 ?? "")
    || !SHA256.test(value.protectedEvaluatorSha256 ?? "") || !SHA256.test(value.protectedBrowserLaneSha256 ?? "")
    || !SHA256.test(value.protectedIsolationSha256 ?? "") || !/^sha256:[a-f0-9]{64}$/.test(value.protectedContainerImageId ?? "")
    || typeof value.protectedContainerImage !== "string" || value.protectedContainerImage.length === 0
    || !SHA256.test(value.agentCommandSha256 ?? "") || !SHA256.test(value.agentProcessIsolationSha256 ?? "")
    || !SHA256.test(value.agentInstructionPolicySha256 ?? "") || !SHA256.test(value.agentBootstrapSha256 ?? "")
    || !SHA256.test(value.providerBrokerSha256 ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.agentContainerImageId ?? "")
    || typeof value.agentContainerImage !== "string" || value.agentContainerImage.length === 0) {
    runErrors.push("protected task-set, trial-runner, or evaluator identity is missing");
  }
  try {
    validateCodingAgentIsolation(value.agentProcessIsolation, {
      agentCommandSha256: value.agentCommandSha256,
      agentContainerImage: value.agentContainerImage,
      agentContainerImageId: value.agentContainerImageId,
      agentDriver: value.agentDriver,
      agentModel: value.agentModel,
      bootstrapMode: value.bootstrapMode,
      nodekitTarballSha256: value.nodekitTarballSha256,
      providerBrokerSha256: value.providerBrokerSha256,
    });
    if (value.agentProcessIsolationSha256 !== value.agentProcessIsolation?.isolationSha256) {
      runErrors.push("coding-agent isolation hash does not bind its receipt");
    }
  } catch (error) {
    runErrors.push(`coding-agent isolation failed: ${error.message}`);
  }
  try {
    validateAgentBootstrap(value.agentBootstrap, {
      mode: value.bootstrapMode,
      nodekitTarballSha256: value.nodekitTarballSha256,
    });
    if (value.agentBootstrapSha256 !== value.agentBootstrap?.bootstrapSha256
      || value.agentBootstrapSha256 !== value.agentProcessIsolation?.bootstrap?.bootstrapSha256) {
      runErrors.push("agent bootstrap receipt is not hash-bound to its isolation receipt");
    }
  } catch (error) {
    runErrors.push(`agent bootstrap failed: ${error.message}`);
  }
  try {
    validateAgentInstructionPolicy(value.agentInstructionPolicy, { agentDriver: value.agentDriver });
    if (value.agentInstructionPolicySha256 !== value.agentInstructionPolicy?.instructionSetSha256
      || value.agentInstructionPolicySha256 !== value.agentProcessIsolation?.instructions?.instructionSetSha256) {
      runErrors.push("agent instruction policy is not hash-bound to its isolation receipt");
    }
  } catch (error) {
    runErrors.push(`agent instruction policy failed: ${error.message}`);
  }
  if (value.taskSetSha256 !== requiredTaskSetSha256) runErrors.push("task-set hash does not match the protected held-out task bytes");
  if (value.trialRunnerSha256 !== protectedTrialRunnerSha256) runErrors.push("trial-runner hash does not match the protected evaluator path");
  if (value.protectedBrowserLaneSha256 !== protectedBrowserLaneSha256) runErrors.push("browser-lane hash does not match the protected evaluator path");
  if (value.providerBrokerSha256 !== protectedProviderBrokerSha256) runErrors.push("provider-broker hash does not match the protected evaluator path");
  if (!SHA256.test(value.receiptSha256 ?? "") || value.receiptSha256 !== receiptHash(value)) runErrors.push("receipt hash is invalid");
  if (!Array.isArray(value.evidence)) runErrors.push("evidence manifest is missing");
  else {
    const transcriptSessionIds = new Set();
    let applicationIdentity = null;
    let browserCertificationBytes = null;
    let browserManifest = null;
    let browserManifestBytes = null;
    let browserManifestReference = null;
    let environment = null;
    let protectedEvaluation = null;
    let protectedEvaluationBytes = null;
    let evaluatorScreenshotBytes = null;
    let visualReviewInventory = null;
    let visualReviewInventoryBytes = null;
    if (!exactSet(value.evidence.map((entry) => entry.kind), requiredEvidenceKinds)) runErrors.push("evidence manifest is incomplete or contains duplicate kinds");
    if (value.evidenceSetSha256 !== sha256(JSON.stringify(value.evidence))) runErrors.push("evidence-set hash is invalid");
    if (value.evidence.find((entry) => entry.kind === "candidate-archive")?.sha256 !== value.candidateArchiveSha256) {
      runErrors.push("candidate archive evidence does not bind candidateArchiveSha256");
    }
    const paths = new Set();
    for (const evidence of value.evidence) {
      if (!isCanonicalEvidencePath(evidence.path)) {
        runErrors.push(`evidence path is not canonical: ${evidence.path}`);
        continue;
      }
      if (requiredEvidenceByKind[evidence.kind] !== evidence.path) {
        runErrors.push(`evidence kind ${evidence.kind ?? "missing"} uses unexpected path ${evidence.path}`);
      }
      if (paths.has(evidence.path)) runErrors.push(`duplicate evidence path ${evidence.path}`);
      paths.add(evidence.path);
      const absolute = path.resolve(trial.directory, evidence.path ?? "");
      const containment = path.relative(trial.directory, absolute);
      if (containment === "" || containment.startsWith(`..${path.sep}`) || containment === ".." || path.isAbsolute(containment)) {
        runErrors.push(`evidence escapes run directory: ${evidence.path}`);
        continue;
      }
      try {
        const realEvidencePath = await realpath(absolute);
        const realContainment = path.relative(trialRealDirectory, realEvidencePath);
        if (realContainment === "" || realContainment.startsWith(`..${path.sep}`) || realContainment === ".." || path.isAbsolute(realContainment)) {
          runErrors.push(`evidence resolves outside run directory: ${evidence.path}`);
          continue;
        }
        const metadata = await lstat(absolute);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          runErrors.push(`evidence is not a regular file: ${evidence.path}`);
          continue;
        }
        const bytes = await readFile(absolute);
        if (bytes.length !== evidence.bytes) runErrors.push(`evidence byte count mismatch: ${evidence.path}`);
        if (sha256(bytes) !== evidence.sha256) runErrors.push(`evidence hash mismatch: ${evidence.path}`);
        if (evidence.kind === "prompt" && task && bytes.toString("utf8") !== `${task.goal}\n`) runErrors.push("recorded prompt does not match the immutable held-out task");
        if (evidence.kind === "prompt-hash" && bytes.toString("utf8") !== `${value.promptSha256}\n`) runErrors.push("prompt-hash evidence does not bind the recorded prompt hash");
        if (evidence.kind === "application-identity") {
          try {
            applicationIdentity = JSON.parse(bytes.toString("utf8"));
          } catch {
            runErrors.push("application-identity evidence is not valid JSON");
          }
        }
        if (evidence.kind === "environment") {
          try {
            environment = JSON.parse(bytes.toString("utf8"));
          } catch {
            runErrors.push("environment evidence is not valid JSON");
          }
        }
        if (evidence.kind === "browser-certification") browserCertificationBytes = bytes;
        if (evidence.kind === "screenshot-manifest") {
          browserManifestBytes = bytes;
          browserManifestReference = {
            bytes: evidence.bytes,
            kind: "screenshot-manifest",
            path: path.relative(evidenceRepoRoot, absolute).replaceAll("\\", "/"),
            sha256: evidence.sha256,
          };
          try {
            browserManifest = JSON.parse(bytes.toString("utf8"));
          } catch {
            runErrors.push("screenshot-manifest evidence is not valid JSON");
          }
        }
        if (evidence.kind === "protected-evaluation") {
          protectedEvaluationBytes = bytes;
          try {
            protectedEvaluation = JSON.parse(bytes.toString("utf8"));
          } catch {
            runErrors.push("protected-evaluation evidence is not valid JSON");
          }
        }
        if (evidence.kind === "evaluator-screenshot") evaluatorScreenshotBytes = bytes;
        if (evidence.kind === "visual-review-inventory") {
          visualReviewInventoryBytes = bytes;
          try {
            visualReviewInventory = JSON.parse(bytes.toString("utf8"));
          } catch {
            runErrors.push("visual-review-inventory evidence is not valid JSON");
          }
        }
        if (evidence.kind === "interventions") {
          try {
            const interventions = JSON.parse(bytes.toString("utf8"));
            if (!Array.isArray(interventions) || interventions.length !== 0) runErrors.push("interventions evidence is not the required empty ledger");
          } catch {
            runErrors.push("interventions evidence is not valid JSON");
          }
        }
        if (evidence.kind === "session") {
          if (sessionEvidenceHashes.has(evidence.sha256)) runErrors.push("session transcript hash is reused");
          else sessionEvidenceHashes.add(evidence.sha256);
          for (const line of bytes.toString("utf8").split(/\r?\n/).filter(Boolean)) {
            try {
              const event = JSON.parse(line);
              const sessionId = event.thread_id ?? event.session_id ?? event.message?.session_id;
              if (typeof sessionId === "string" && sessionId.length > 0) transcriptSessionIds.add(sessionId);
            } catch {
              // Non-JSON session lines cannot establish a fresh session identity.
            }
          }
        }
      } catch {
        runErrors.push(`evidence is missing: ${evidence.path}`);
      }
    }
    if (!transcriptSessionIds.has(value.agentSessionId)) runErrors.push("session transcript does not bind the recorded agent session identity");
    if (applicationIdentity?.schemaVersion !== "nodeagent.application-identity/v1"
      || applicationIdentity?.applicationHash !== value.applicationHash
      || applicationIdentity?.configHash !== value.configHash) {
      runErrors.push("application-identity evidence does not bind the generated applicationHash/configHash");
    }
    if (environment?.agentModel !== value.agentModel
      || environment?.nodekitPackage !== value.nodekitPackage
      || environment?.nodekitVersion !== value.nodekitVersion
      || environment?.nodekitTarballSha256 !== value.nodekitTarballSha256
      || environment?.nodekitCommit !== value.nodekitCommit
      || environment?.nodekitSourceHash !== value.nodekitSourceHash
      || environment?.taskBriefSha256 !== value.promptSha256
      || environment?.taskSetSha256 !== value.taskSetSha256
      || environment?.trialRunnerSha256 !== value.trialRunnerSha256
      || environment?.protectedEvaluatorSha256 !== value.protectedEvaluatorSha256
      || environment?.protectedBrowserLaneSha256 !== value.protectedBrowserLaneSha256
      || environment?.protectedContainerImage !== value.protectedContainerImage
      || environment?.protectedContainerImageId !== value.protectedContainerImageId
      || environment?.agentContainerImage !== value.agentContainerImage
      || environment?.agentContainerImageId !== value.agentContainerImageId
      || environment?.agentCommandSha256 !== value.agentCommandSha256
      || environment?.agentProcessIsolationSha256 !== value.agentProcessIsolationSha256
      || environment?.agentInstructionPolicySha256 !== value.agentInstructionPolicySha256
      || environment?.providerBrokerSha256 !== value.providerBrokerSha256
      || JSON.stringify(environment?.agentInstructionPolicy) !== JSON.stringify(value.agentInstructionPolicy)
      || JSON.stringify(environment?.agentProcessIsolation) !== JSON.stringify(value.agentProcessIsolation)) {
      runErrors.push("environment evidence does not bind the exact NodeKit package identity");
    }
    if (!browserCertificationBytes || !browserManifestBytes || !browserCertificationBytes.equals(browserManifestBytes)) {
      runErrors.push("browser certification is not byte-identical to its screenshot manifest");
    }
    if (browserManifest?.nodekitCommit !== candidateCommit
      || browserManifest?.nodekitSourceHash !== candidateSourceHash
      || browserManifest?.nodekitIdentity !== `${candidateCommit}/${candidateSourceHash}`
      || browserManifest?.nodekitTarballSha256 !== inspectedCandidate.tarballSha256
      || browserManifest?.nodekitSourceBound !== true
      || browserManifest?.nodekitTarballBound !== true
      || browserManifest?.applicationHash !== value.applicationHash
      || browserManifest?.configHash !== value.configHash
      || browserManifest?.runId !== value.runId
      || !COMMIT.test(browserManifest?.generatedCandidateCommit ?? "")) {
      runErrors.push("browser certification does not bind the exact trial, package, and generated application identity");
    }
    if (browserManifestReference) {
      try {
        const closure = await resolveSubmissionEvidenceClosure(evidenceRepoRoot, "previewDeployment", {
          applicationHash: value.applicationHash,
          configHash: value.configHash,
          deploymentCommit: browserManifest?.generatedCandidateCommit,
          evidence: [browserManifestReference],
          nodekitCommit: candidateCommit,
          nodekitIdentity: `${candidateCommit}/${candidateSourceHash}`,
          nodekitSourceHash: candidateSourceHash,
          releaseCandidate: {
            nodekitCommit: candidateCommit,
            nodekitSourceHash: candidateSourceHash,
            nodekitTarballSha256: inspectedCandidate.tarballSha256,
            packageName: inspectedCandidate.name,
            packageVersion: inspectedCandidate.version,
          },
        });
        if (closure.length !== 366) runErrors.push(`browser evidence closure has ${closure.length} files; expected 366`);
      } catch (error) {
        runErrors.push(`browser evidence closure failed: ${error.message}`);
      }
    }
    const candidateBrowserManifestSha256 = browserManifestBytes ? sha256(browserManifestBytes) : null;
    let protectedBrowser = null;
    try {
      if (protectedEvaluation?.protectedBrowserManifestFile !== "protected-browser/screenshot-manifest.json") {
        throw new Error("protected evaluation does not identify the canonical protected browser manifest");
      }
      protectedBrowser = await validateProtectedBrowserEvidence({
        evidenceRoot: path.join(trial.directory, "evaluator"),
        expected: {
          candidateArchiveSha256: value.candidateArchiveSha256,
          runId: protectedEvaluation.protectedTaskInput?.inputToken,
          taskId: value.taskId,
        },
        manifestFile: protectedEvaluation.protectedBrowserManifestFile,
        validatePng: validateSubmissionScreenshotPng,
      });
      if (protectedBrowser.closure.length !== 361) {
        throw new Error(`protected browser evidence closure has ${protectedBrowser.closure.length} files; expected 361`);
      }
    } catch (error) {
      runErrors.push(`protected browser evidence closure failed: ${error.message}`);
    }
    const protectedBrowserManifestSha256 = protectedBrowser?.manifestSha256 ?? null;
    const screenshotEvidenceRootSha256 = protectedBrowser?.screenshotEvidenceRootSha256 ?? null;
    const evaluatorScreenshotSha256 = evaluatorScreenshotBytes ? sha256(evaluatorScreenshotBytes) : null;
    const visualReviewInventorySha256 = visualReviewInventoryBytes ? sha256(visualReviewInventoryBytes) : null;
    const protectedEvaluationSha256 = protectedEvaluationBytes ? sha256(protectedEvaluationBytes) : null;
    if (!evaluatorScreenshotBytes
      || evaluatorScreenshotBytes.length < 256
      || !evaluatorScreenshotBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      runErrors.push("independent evaluator screenshot is missing, malformed, or implausibly small");
    }
    try {
      validateVisualReviewInventory(visualReviewInventory, {
        applicationHash: value.applicationHash,
        protectedBrowserManifestSha256,
        candidateArchiveSha256: value.candidateArchiveSha256,
        configHash: value.configHash,
        evaluatorScreenshotSha256,
        nodekitCommit: candidateCommit,
        nodekitSourceHash: candidateSourceHash,
        nodekitTarballSha256: inspectedCandidate.tarballSha256,
        postAgentTreeHash: value.postAgentTreeHash,
        runId: value.runId,
        browserLaneSha256: value.protectedBrowserLaneSha256,
        containerImage: value.protectedContainerImage,
        containerImageId: value.protectedContainerImageId,
        isolationSha256: value.protectedIsolationSha256,
        screenshotEvidenceRootSha256,
        taskId: value.taskId,
      });
    } catch (error) {
      runErrors.push(`visual review inventory failed: ${error.message}`);
    }
    try {
      validateProtectedAgentEvaluation(protectedEvaluation, {
        applicationHash: value.applicationHash,
        candidateBrowserManifestSha256,
        protectedBrowserManifestSha256,
        candidateArchiveSha256: value.candidateArchiveSha256,
        configHash: value.configHash,
        evaluatorScreenshotSha256,
        evaluatorSha256: protectedEvaluatorSha256,
        nodekitCommit: candidateCommit,
        nodekitSourceHash: candidateSourceHash,
        nodekitTarballSha256: inspectedCandidate.tarballSha256,
        postAgentTreeHash: value.postAgentTreeHash,
        runId: value.runId,
        browserLaneSha256: value.protectedBrowserLaneSha256,
        containerImage: value.protectedContainerImage,
        containerImageId: value.protectedContainerImageId,
        isolationSha256: value.protectedIsolationSha256,
        screenshotEvidenceRootSha256,
        taskBriefSha256: value.promptSha256,
        taskId: value.taskId,
        taskSetSha256: value.taskSetSha256,
        visualReviewInventorySha256,
        visualReviewInventorySelfHash: visualReviewInventory?.inventorySha256,
      });
    } catch (error) {
      runErrors.push(`protected task evaluation failed: ${error.message}`);
    }
    if (value.protectedEvaluatorSha256 !== protectedEvaluatorSha256
      || value.protectedEvaluationSha256 !== protectedEvaluationSha256
      || value.evaluatorScreenshotSha256 !== evaluatorScreenshotSha256
      || value.visualReviewInventorySha256 !== visualReviewInventorySha256
      || value.screenshotEvidenceRootSha256 !== screenshotEvidenceRootSha256
      || value.protectedIsolationSha256 !== protectedEvaluation?.isolationSha256
      || value.protectedIsolationSha256 !== visualReviewInventory?.isolationSha256
      || protectedEvaluation?.isolationSha256 !== visualReviewInventory?.isolationSha256) {
      runErrors.push("trial receipt does not bind the protected evaluator and visual-review evidence");
    }
  }
  const manifestSha256 = sha256(trial.bytes);
  if (manifestHashes.has(manifestSha256)) runErrors.push("duplicate manifest hash");
  manifestHashes.add(manifestSha256);
  const normalizedEvidence = (value.evidence ?? []).map((entry) => ({
    ...entry,
    path: isCanonicalEvidencePath(entry.path)
      ? path.relative(evidenceRepoRoot, path.resolve(trial.directory, entry.path)).replaceAll("\\", "/")
      : String(entry.path ?? ""),
  }));
  for (const entry of normalizedEvidence) {
    if (!isCanonicalEvidencePath(entry.path)) runErrors.push(`normalized evidence path is not canonical: ${entry.path}`);
  }
  for (const error of runErrors) errors.push(`${value.runId}: ${error}`);
  selectedRuns.push({
    agentBootstrapSha256: value.agentBootstrapSha256,
    agentCommandSha256: value.agentCommandSha256,
    agentContainerImage: value.agentContainerImage,
    agentContainerImageId: value.agentContainerImageId,
    agentDriver: value.agentDriver,
    agentModel: value.agentModel,
    agentProfile: value.agentProfile,
    agentSessionId: value.agentSessionId,
    agentVersion: value.agentVersion,
    bootstrapMode: value.bootstrapMode,
    agentProcessIsolationSha256: value.agentProcessIsolationSha256,
    agentInstructionPolicySha256: value.agentInstructionPolicySha256,
    applicationHash: value.applicationHash,
    configHash: value.configHash,
    candidateArchiveSha256: value.candidateArchiveSha256,
    durationMs: value.durationMs,
    evidence: normalizedEvidence,
    evidenceCount: normalizedEvidence.length,
    evidenceSetSha256: sha256(JSON.stringify(normalizedEvidence)),
    freshSession: value.freshSession,
    generatedAt: value.generatedAt,
    manifestPath,
    manifestSha256,
    nodekitCommit: value.nodekitCommit,
    nodekitPackage: value.nodekitPackage,
    nodekitSourceHash: value.nodekitSourceHash,
    nodekitTarballSha256: value.nodekitTarballSha256,
    nodekitVersion: value.nodekitVersion,
    passed: value.passed,
    promptSha256: value.promptSha256,
    postAgentTreeHash: value.postAgentTreeHash,
    protectedEvaluatorSha256: value.protectedEvaluatorSha256,
    protectedBrowserLaneSha256: value.protectedBrowserLaneSha256,
    providerBrokerSha256: value.providerBrokerSha256,
    protectedContainerImage: value.protectedContainerImage,
    protectedContainerImageId: value.protectedContainerImageId,
    protectedIsolationSha256: value.protectedIsolationSha256,
    protectedEvaluationSha256: value.protectedEvaluationSha256,
    evaluatorScreenshotSha256: value.evaluatorScreenshotSha256,
    visualReviewInventorySha256: value.visualReviewInventorySha256,
    screenshotEvidenceRootSha256: value.screenshotEvidenceRootSha256,
    receiptSha256: value.receiptSha256,
    runId: value.runId,
    taskId: value.taskId,
    taskSetSha256: value.taskSetSha256,
    trialStartedAt: value.trialStartedAt,
    trialRunnerSha256: value.trialRunnerSha256,
    validationPassed: runErrors.length === 0,
  });
}

const emptyDirectoryAgentCliRuns = selectedRuns.filter((entry) => entry.bootstrapMode === "agent-process-packed-cli-from-empty").length;
if (emptyDirectoryAgentCliRuns !== 1) {
  errors.push(`exact campaign requires one protected empty-directory packed-CLI agent lane; observed ${emptyDirectoryAgentCliRuns}`);
}
const lowerCostRuns = selectedRuns.filter((entry) => entry.agentProfile === "lower-cost");
if (lowerCostRuns.length !== requiredTasks.length
  || lowerCostRuns.some((entry) => entry.agentDriver !== lowerCostPricingEvidence.agentDriver
    || entry.agentModel !== lowerCostPricingEvidence.model)) {
  errors.push("lower-cost profile runs do not match the preserved official pricing evidence driver and model");
}
const orderedDurations = selectedRuns.map((entry) => entry.durationMs).sort((left, right) => left - right);
const medianDurationMs = orderedDurations.length % 2 === 1
  ? orderedDurations[(orderedDurations.length - 1) / 2]
  : (orderedDurations[orderedDurations.length / 2 - 1] + orderedDurations[orderedDurations.length / 2]) / 2;
const maxDurationMs = orderedDurations.at(-1);
if (orderedDurations.some((duration) => !Number.isInteger(duration) || duration < 0 || duration > AGENT_EASE_MAX_RUN_DURATION_MS)) {
  errors.push(`fresh-agent run exceeded the preregistered ${AGENT_EASE_MAX_RUN_DURATION_MS}ms maximum`);
}
if (!Number.isFinite(medianDurationMs) || medianDurationMs > AGENT_EASE_MEDIAN_RUN_DURATION_MS) {
  errors.push(`fresh-agent median exceeded the preregistered ${AGENT_EASE_MEDIAN_RUN_DURATION_MS}ms threshold`);
}

for (const taskId of requiredTasks) {
  for (const [agentProfile, count] of Object.entries(requiredProfiles)) {
    const observed = selectedRuns.filter((entry) => entry.taskId === taskId && entry.agentProfile === agentProfile).length;
    if (observed !== count) errors.push(`${taskId}/${agentProfile}: required ${count}, observed ${observed}`);
  }
}
if (sha256(await readFile(candidateTarball)) !== inspectedCandidate.tarballSha256) {
  errors.push("exact candidate tarball changed while the fresh-agent verdict was evaluated");
}

const verdict = {
  allAttemptsSelected: selectedRuns.length === selected.length,
  combinedZeroToAppClaim: emptyDirectoryAgentCliRuns === 1,
  emptyDirectoryAgentCliRuns,
  errors,
  failedTrials: selectedRuns.filter((entry) => entry.passed !== true || entry.validationPassed !== true).length,
  ignoredOtherCandidateTrials: manifests.length - selected.length,
  legacyTrialsIgnored: legacyTrials.length,
  lowerCostPricingEvidence,
  nodekitCommit: COMMIT.test(candidateCommit) ? candidateCommit : null,
  nodekitIdentity: COMMIT.test(candidateCommit) && SHA256.test(candidateSourceHash) ? `${candidateCommit}/${candidateSourceHash}` : null,
  nodekitSourceHash: SHA256.test(candidateSourceHash) ? candidateSourceHash : null,
  observedRepositoryTrials: manifests.length,
  observedTrials: selected.length,
  passed: errors.length === 0 && selectedRuns.length === requiredRuns,
  releaseCandidate,
  requiredProfiles,
  requiredRuns,
  requiredTasks,
  schemaVersion: "nodekit.fresh-agent-verdict/v2",
  selectedRuns,
  timing: {
    observed: { maxRunMs: maxDurationMs, medianRunMs: medianDurationMs },
    schemaVersion: "nodekit.fresh-agent-timing/v1",
    thresholds: { maxRunMs: AGENT_EASE_MAX_RUN_DURATION_MS, medianRunMs: AGENT_EASE_MEDIAN_RUN_DURATION_MS },
  },
};
// This command produces the measured, unsigned verdict body. The decisive
// submission schema intentionally also requires attestationPayload and a
// trusted detached attestation, which an external verifier adds only after
// reviewing these exact evidence bytes. Submission evaluation remains
// fail-closed for this raw output; the measurement command must not mark a
// successful real trial matrix as failed merely because it has not yet been
// externally signed.
await writeFile(output, `${JSON.stringify(verdict, null, 2)}\n`);
console.log(JSON.stringify(verdict, null, 2));
if (!verdict.passed) process.exitCode = 1;
