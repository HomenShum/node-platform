import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectNpmPackageArchiveFile } from "../src/lib/npm-package-archive.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
const options = Object.fromEntries(rawArgs.filter((entry) => entry.startsWith("--")).map((entry) => {
  const [key, ...value] = entry.replace(/^--/, "").split("=");
  return [key, value.join("=") || true];
}));
const positional = rawArgs.filter((entry) => !entry.startsWith("--"));
const root = path.resolve(String(options.root ?? positional[0] ?? "proof/ease/agents"));
const output = path.resolve(String(options.output ?? positional[1] ?? "proof/ease/fresh-agent-verdict.json"));
const evidenceRepoRoot = path.resolve(String(options["evidence-repo-root"] ?? repoRoot));
const candidateCommit = String(options.candidate ?? process.env.NODEKIT_SOURCE_COMMIT ?? "").toLowerCase();
const candidateSourceHash = String(options.sourceHash ?? options["source-hash"] ?? process.env.NODEKIT_SOURCE_HASH ?? "").toLowerCase();
const candidateTarballArgument = options.nodekitTarball ?? options["nodekit-tarball"];
if (typeof candidateTarballArgument !== "string" || candidateTarballArgument.trim().length === 0) {
  throw new Error("--nodekit-tarball=<exact-candidate.tgz> is required");
}
const candidateTarball = path.resolve(candidateTarballArgument);
const expectedTarballSha256 = String(
  options.nodekitTarballSha256
    ?? options["nodekit-tarball-sha256"]
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
const tasksDocument = JSON.parse(await readFile(path.join(repoRoot, "evals", "ease", "heldout-tasks.json"), "utf8"));
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
});
const requiredEvidenceKinds = Object.keys(requiredEvidenceByKind);
const requiredTrialChecks = Object.freeze([
  "agentEnvironmentIsolated",
  "agentImplemented",
  "agentReportedCompletion",
  "agentSessionIdentityRecorded",
  "agentVersionRecorded",
  "applicationIdentityRecorded",
  "browserContract",
  "browserJourney",
  "browserRuntime",
  "candidateArchive",
  "check",
  "compile",
  "demo",
  "eval",
  "evidenceComplete",
  "nodekitIdentityStable",
  "nodekitRuntimeBound",
  "nodekitTarballStable",
  "proof",
]);
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
  if (value.agentProfile === "lower-cost" && (typeof value.agentModel !== "string" || value.agentModel.trim().length === 0)) runErrors.push("lower-cost profile omitted its explicit model");
  if (typeof value.agentVersion !== "string" || value.agentVersion.trim().length === 0) runErrors.push("agent version is missing");
  if (!validDate(value.trialStartedAt) || !validDate(value.generatedAt) || Date.parse(value.generatedAt) < Date.parse(value.trialStartedAt)) runErrors.push("trial timestamps are invalid");
  const task = taskById.get(value.taskId);
  if (!task) runErrors.push(`unknown held-out task ${value.taskId}`);
  else if (value.promptSha256 !== sha256(task.goal)) runErrors.push("prompt hash does not match the immutable held-out task");
  if (!SHA256.test(value.receiptSha256 ?? "") || value.receiptSha256 !== receiptHash(value)) runErrors.push("receipt hash is invalid");
  if (!Array.isArray(value.evidence)) runErrors.push("evidence manifest is missing");
  else {
    const transcriptSessionIds = new Set();
    let applicationIdentity = null;
    let environment = null;
    if (!exactSet(value.evidence.map((entry) => entry.kind), requiredEvidenceKinds)) runErrors.push("evidence manifest is incomplete or contains duplicate kinds");
    if (value.evidenceSetSha256 !== sha256(JSON.stringify(value.evidence))) runErrors.push("evidence-set hash is invalid");
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
    if (environment?.nodekitPackage !== value.nodekitPackage
      || environment?.nodekitVersion !== value.nodekitVersion
      || environment?.nodekitTarballSha256 !== value.nodekitTarballSha256) {
      runErrors.push("environment evidence does not bind the exact NodeKit package identity");
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
    agentDriver: value.agentDriver,
    agentModel: value.agentModel,
    agentProfile: value.agentProfile,
    agentSessionId: value.agentSessionId,
    agentVersion: value.agentVersion,
    applicationHash: value.applicationHash,
    configHash: value.configHash,
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
    receiptSha256: value.receiptSha256,
    runId: value.runId,
    taskId: value.taskId,
    trialStartedAt: value.trialStartedAt,
    validationPassed: runErrors.length === 0,
  });
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
  errors,
  failedTrials: selectedRuns.filter((entry) => entry.passed !== true || entry.validationPassed !== true).length,
  ignoredOtherCandidateTrials: manifests.length - selected.length,
  legacyTrialsIgnored: legacyTrials.length,
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
