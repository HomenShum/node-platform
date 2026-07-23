import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentEaseCampaignPlan,
  parseAgentEaseCliArgs,
  validateAgentEaseMeasurementVerdict,
  validateAgentEaseTrialManifest,
  validateIndependentSourceArchive,
  validateOfficialPricingSnapshot,
} from "../src/lib/agent-ease-campaign.mjs";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "../src/lib/distributable-candidate.mjs";
import { inspectNpmPackageArchiveFile } from "../src/lib/npm-package-archive.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ARGUMENT_SPEC = Object.freeze({
  allowed: [
    "agent-container-image", "campaign", "candidate", "claude-model", "codex-model", "concurrency", "dry-run", "executor",
    "lower-cost-driver", "lower-cost-evidence", "lower-cost-model", "nodekit-tarball",
    "nodekit-tarball-sha256", "output", "package-manager", "protected-container-image", "root", "source-hash", "timeout-ms",
  ],
  boolean: ["dry-run"],
});
let args;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PROTECTED_INPUT_PATHS = Object.freeze([
  "evals/ease/heldout-tasks.json",
  "scripts/evaluate-agent-ease.mjs",
  "scripts/run-agent-ease-matrix.mjs",
  "scripts/run-agent-provider-broker.mjs",
  "scripts/run-agent-ease-trial.mjs",
  "scripts/run-protected-browser-lane.mjs",
  "scripts/run-protected-agent-evaluator.mjs",
  "src/lib/agent-ease-campaign.mjs",
  "src/lib/agent-ease-report.mjs",
  "src/lib/immutable-package-snapshot.mjs",
  "src/lib/ease-evidence.mjs",
  "src/lib/protected-browser-evidence.mjs",
  "src/lib/npm-package-archive.mjs",
  "src/lib/npm-cli-invocation.mjs",
  "src/lib/schema-validation.mjs",
  "src/lib/source-hash.mjs",
  "src/lib/submission-attestation.mjs",
  "src/lib/submission-gate.mjs",
  "schemas/nodekit.protected-agent-evaluation.v2.schema.json",
  "schemas/nodekit.protected-browser-screenshot-manifest.v1.schema.json",
  "schemas/nodekit.protected-screenshot-proof.v1.schema.json",
]);

function requiredArgument(name) {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`--${name}=<value> is required`);
  return value.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeVerdictPathsForCampaignValidation(verdict, campaignRunsRoot) {
  const prefix = path.relative(repoRoot, campaignRunsRoot).replaceAll("\\", "/");
  if (!prefix || prefix.startsWith("../") || path.isAbsolute(prefix)) {
    throw new Error("agent campaign runs must stay inside the repository evidence namespace");
  }
  const stripPrefix = (value) => {
    const normalized = String(value ?? "");
    const expectedPrefix = `${prefix}/`;
    if (!normalized.startsWith(expectedPrefix)) {
      throw new Error(`agent campaign evidence path is outside ${expectedPrefix}: ${normalized}`);
    }
    return normalized.slice(expectedPrefix.length);
  };
  const normalized = structuredClone(verdict);
  normalized.selectedRuns = normalized.selectedRuns.map((run) => {
    const evidence = run.evidence.map((entry) => ({
      ...entry,
      path: stripPrefix(entry.path),
    }));
    return {
      ...run,
      evidence,
      evidenceSetSha256: sha256(JSON.stringify(evidence)),
      manifestPath: stripPrefix(run.manifestPath),
    };
  });
  return normalized;
}

function credentialPreflight(driver) {
  const prefix = driver === "codex" ? "NODEKIT_CODEX" : "NODEKIT_CLAUDE";
  const expectedScope = driver === "codex" ? "responses:write" : "messages:write";
  const key = process.env[`${prefix}_SCOPED_API_KEY`];
  const expiresAt = process.env[`${prefix}_CREDENTIAL_EXPIRES_AT`];
  const scope = process.env[`${prefix}_CREDENTIAL_SCOPE`];
  const remainingMs = Date.parse(expiresAt ?? "") - Date.now();
  if (typeof key !== "string" || key.length < 20
    || !Number.isFinite(remainingMs) || remainingMs < 5 * 60_000 || remainingMs > 24 * 60 * 60_000
    || scope !== expectedScope) {
    throw new Error(`${driver} requires a 5-minute-to-24-hour scoped provider key (${prefix}_SCOPED_API_KEY, ${prefix}_CREDENTIAL_EXPIRES_AT, ${prefix}_CREDENTIAL_SCOPE=${expectedScope}); raw host login credentials are rejected`);
  }
  return {
    driver,
    expiresAt: new Date(Date.parse(expiresAt)).toISOString(),
    fingerprintSha256: sha256(key),
    scope,
  };
}

function receiptHash(value) {
  return sha256(JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receiptSha256"))));
}

function git(commandArgs, options = {}) {
  const result = spawnSync("git", commandArgs, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${commandArgs.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout;
}

function resolveProtectedContainerImage(reference) {
  const version = spawnSync("docker", ["version", "--format={{json .Server}}"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
  });
  if (version.status !== 0 || version.error) {
    throw new Error(`Docker is mandatory for protected fresh-agent certification; no host fallback is permitted\n${version.stdout ?? ""}\n${version.stderr ?? ""}`);
  }
  const inspected = spawnSync("docker", ["image", "inspect", reference], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
  });
  if (inspected.status !== 0 || inspected.error) {
    throw new Error(`protected evaluator image ${reference} is unavailable; pull/provision it before starting the campaign\n${inspected.stdout ?? ""}\n${inspected.stderr ?? ""}`);
  }
  const records = JSON.parse(inspected.stdout);
  if (!Array.isArray(records) || records.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(records[0]?.Id ?? "")) {
    throw new Error("protected evaluator image did not resolve to one exact image ID");
  }
  return Object.freeze({ id: records[0].Id, reference });
}

async function readExactCandidateFile(relativePath, commit) {
  const absolutePath = path.join(repoRoot, ...relativePath.split("/"));
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`protected campaign input must be a regular non-symbolic-link file: ${relativePath}`);
  }
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (tracked.status !== 0 || tracked.error) throw new Error(`protected campaign input is not tracked: ${relativePath}`);
  const candidate = spawnSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (candidate.status !== 0 || candidate.error) {
    throw new Error(`protected campaign input is absent from candidate ${commit}: ${relativePath}`);
  }
  const liveBytes = await readFile(absolutePath);
  const [realRepoRoot, realInputPath] = await Promise.all([realpath(repoRoot), realpath(absolutePath)]);
  const realContainment = path.relative(realRepoRoot, realInputPath);
  if (realContainment === "" || realContainment === ".." || realContainment.startsWith(`..${path.sep}`) || path.isAbsolute(realContainment)) {
    throw new Error(`protected campaign input resolves outside the candidate repository: ${relativePath}`);
  }
  if (!liveBytes.equals(candidate.stdout)) {
    throw new Error(`protected campaign input differs from candidate ${commit}: ${relativePath}`);
  }
  return Object.freeze({
    bytes: liveBytes,
    path: relativePath,
    sha256: sha256(liveBytes),
  });
}

async function assertProtectedInputsStable(inputs) {
  for (const input of inputs) {
    const absolutePath = path.join(repoRoot, ...input.path.split("/"));
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || sha256(await readFile(absolutePath)) !== input.sha256) {
      throw new Error(`protected campaign input changed during execution: ${input.path}`);
    }
  }
}

export async function independentlyPackCandidate({
  candidateCommit,
  candidateSourceHash,
  sourceRoot = repoRoot,
}) {
  if (!COMMIT.test(candidateCommit)) throw new Error("isolated pack candidateCommit must be a lowercase 40-character commit");
  if (!SHA256.test(candidateSourceHash)) throw new Error("isolated pack candidateSourceHash must be a lowercase SHA-256 digest");
  const authoritativeRoot = await realpath(path.resolve(sourceRoot));
  const isolationRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-campaign-pack-"));
  const isolatedSourceRoot = path.join(isolationRoot, "source");
  const destination = path.join(isolationRoot, "packed");
  try {
    const readAuthoritativeCommit = () => spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: authoritativeRoot,
      encoding: "utf8",
      shell: false,
    });
    const beforeCommit = readAuthoritativeCommit();
    if (beforeCommit.error || beforeCommit.status !== 0 || beforeCommit.stdout.trim().toLowerCase() !== candidateCommit) {
      throw new Error("authoritative source HEAD changed before the isolated source copy was created");
    }
    const packageJson = JSON.parse(await readFile(path.join(authoritativeRoot, "package.json"), "utf8"));
    const pathspecs = distributablePathspecs(packageJson);
    const dirty = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspecs], {
      cwd: authoritativeRoot,
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      shell: false,
    });
    if (dirty.error || dirty.status !== 0) throw new Error("could not verify authoritative source cleanliness before isolated packing");
    assertCleanDistributablePaths(parseGitStatusPorcelainZ(dirty.stdout), "isolated agent campaign pack");
    const copiedPaths = new Set();
    const copySource = async (source) => {
      const metadata = await lstat(source);
      const relativePath = path.relative(authoritativeRoot, source);
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error("isolated source path escapes the authoritative repository");
      }
      if (metadata.isSymbolicLink()) throw new Error(`isolated source cannot contain a symbolic link: ${relativePath}`);
      if (metadata.isDirectory()) {
        const children = await readdir(source);
        children.sort();
        for (const child of children) await copySource(path.join(source, child));
        return;
      }
      if (!metadata.isFile()) throw new Error(`isolated source input is not a regular file: ${relativePath}`);
      const portablePath = relativePath.replaceAll("\\", "/");
      if (copiedPaths.has(portablePath)) return;
      copiedPaths.add(portablePath);
      const target = path.join(isolatedSourceRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      await chmod(target, metadata.mode & 0o777);
    };
    for (const pathspec of pathspecs) {
      await copySource(path.join(authoritativeRoot, ...pathspec.split("/")));
    }
    const isolatedSourceHash = await computeNodeKitSourceHash(isolatedSourceRoot);
    if (isolatedSourceHash !== candidateSourceHash) {
      throw new Error(`isolated exact-source hash ${isolatedSourceHash} does not match ${candidateSourceHash}`);
    }
    const afterCommit = readAuthoritativeCommit();
    if (afterCommit.error || afterCommit.status !== 0 || afterCommit.stdout.trim().toLowerCase() !== candidateCommit
      || await computeNodeKitSourceHash(authoritativeRoot) !== candidateSourceHash) {
      throw new Error("authoritative source commit or bytes changed while the isolated source copy was created");
    }
    // npm receives only disposable, validated distribution bytes. No Git
    // metadata or filesystem link points back to the authoritative checkout.
    await mkdir(destination, { recursive: false });
    const invocation = resolveNpmCliInvocation([
      "pack", "--json", "--ignore-scripts", "--pack-destination", destination,
    ]);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: isolatedSourceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_ignore_scripts: "true",
      },
      maxBuffer: 32 * 1024 * 1024,
      shell: invocation.shell,
      timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`independent script-disabled npm pack failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim().slice(-2_000)}`);
    }
    let records;
    try {
      records = JSON.parse(String(result.stdout).replace(/^\uFEFF/, "").trim());
    } catch (error) {
      throw new Error(`independent npm pack did not emit valid JSON: ${error.message}`);
    }
    if (!Array.isArray(records) || records.length !== 1 || typeof records[0]?.filename !== "string"
      || path.basename(records[0].filename) !== records[0].filename || !records[0].filename.endsWith(".tgz")) {
      throw new Error("independent npm pack did not emit exactly one safe archive filename");
    }
    return await inspectNpmPackageArchiveFile(path.join(destination, records[0].filename), {
      expectedName: "@homenshum/nodekit",
    });
  } finally {
    await rm(isolationRoot, { force: true, recursive: true });
  }
}

async function createFreshEvidenceRoot(root, forbiddenInputs) {
  const absoluteRoot = path.resolve(root);
  const parent = path.dirname(absoluteRoot);
  const parsed = path.parse(parent);
  let cursor = parsed.root;
  for (const segment of path.relative(parsed.root, parent).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`campaign evidence parent traverses a link or non-directory: ${cursor}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(cursor, { recursive: false });
    }
  }
  await mkdir(absoluteRoot, { recursive: false });
  const rootMetadata = await lstat(absoluteRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("campaign evidence root was not created as a fresh directory");
  }
  const realRoot = await realpath(absoluteRoot);
  for (const forbidden of forbiddenInputs) {
    const realForbidden = await realpath(path.resolve(forbidden));
    const relative = path.relative(realRoot, realForbidden);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`campaign evidence root aliases or contains a protected input: ${forbidden}`);
    }
  }
  return realRoot;
}

function containedFile(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\\") || relativePath.startsWith("/")
    || /^[A-Za-z]:/.test(relativePath) || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`non-canonical campaign evidence path: ${relativePath}`);
  }
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  const containment = path.relative(root, absolutePath);
  if (containment === "" || containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
    throw new Error(`campaign evidence path escapes its run: ${relativePath}`);
  }
  return absolutePath;
}

async function verifyTrialEvidence(runRoot, receipt, expectations) {
  const reopened = new Map();
  const realRunRoot = await realpath(runRoot);
  for (const evidence of receipt.evidence) {
    const absolutePath = containedFile(runRoot, evidence.path);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${receipt.runId}: evidence is not a regular file: ${evidence.path}`);
    }
    const realEvidencePath = await realpath(absolutePath);
    const realContainment = path.relative(realRunRoot, realEvidencePath);
    if (realContainment === "" || realContainment === ".." || realContainment.startsWith(`..${path.sep}`) || path.isAbsolute(realContainment)) {
      throw new Error(`${receipt.runId}: evidence resolves outside its run: ${evidence.path}`);
    }
    const first = await readFile(absolutePath);
    const second = await readFile(absolutePath);
    if (!first.equals(second) || first.length !== evidence.bytes || sha256(first) !== evidence.sha256) {
      throw new Error(`${receipt.runId}: reopened evidence does not match manifest: ${evidence.path}`);
    }
    reopened.set(evidence.kind, first);
  }
  if (!reopened.get("prompt")?.equals(Buffer.from(`${expectations.taskGoal}\n`, "utf8"))
    || reopened.get("prompt-hash")?.toString("utf8") !== `${receipt.promptSha256}\n`) {
    throw new Error(`${receipt.runId}: prompt evidence does not bind the immutable task brief`);
  }
  const environment = JSON.parse(reopened.get("environment").toString("utf8"));
  if (environment.nodekitPackage !== expectations.candidate.packageName
    || environment.nodekitVersion !== expectations.candidate.packageVersion
    || environment.nodekitTarballSha256 !== expectations.candidate.tarballSha256
    || environment.nodekitCommit !== expectations.candidate.commit
    || environment.nodekitSourceHash !== expectations.candidate.sourceHash
    || environment.taskBriefSha256 !== receipt.promptSha256
    || environment.taskSetSha256 !== receipt.taskSetSha256
    || environment.trialRunnerSha256 !== receipt.trialRunnerSha256
    || environment.protectedEvaluatorSha256 !== receipt.protectedEvaluatorSha256
    || environment.protectedBrowserLaneSha256 !== receipt.protectedBrowserLaneSha256
    || environment.protectedContainerImage !== receipt.protectedContainerImage
    || environment.protectedContainerImageId !== receipt.protectedContainerImageId) {
    throw new Error(`${receipt.runId}: environment evidence does not bind the exact candidate`);
  }
  const interventions = JSON.parse(reopened.get("interventions").toString("utf8"));
  if (!Array.isArray(interventions) || interventions.length !== 0) {
    throw new Error(`${receipt.runId}: intervention ledger is not empty`);
  }
  const applicationIdentity = JSON.parse(reopened.get("application-identity").toString("utf8"));
  if (applicationIdentity.schemaVersion !== "nodeagent.application-identity/v1"
    || applicationIdentity.applicationHash !== receipt.applicationHash
    || applicationIdentity.configHash !== receipt.configHash) {
    throw new Error(`${receipt.runId}: application identity evidence does not bind the receipt`);
  }
  const sessionIds = new Set();
  for (const line of reopened.get("session").toString("utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const sessionId = event.thread_id ?? event.session_id ?? event.message?.session_id;
      if (typeof sessionId === "string" && sessionId.length > 0) sessionIds.add(sessionId);
    } catch {
      // Raw non-JSON lines cannot establish the required session binding.
    }
  }
  if (!sessionIds.has(receipt.agentSessionId)) {
    throw new Error(`${receipt.runId}: session evidence does not bind the fresh agent session`);
  }
}

async function verifyCampaignReceipts({ campaign, candidate, evidenceRoot, plan, taskGoals, trialEvidenceRoot }) {
  const entries = await readdir(trialEvidenceRoot, { withFileTypes: true }).catch(() => []);
  const expectedRunIds = plan.runs.map((run) => run.runId);
  const observedRunIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (entries.some((entry) => !entry.isDirectory())
    || observedRunIds.length !== expectedRunIds.length
    || [...observedRunIds].sort().join("\n") !== [...expectedRunIds].sort().join("\n")) {
    throw new Error("trial evidence root does not contain the exact planned 15-run directory set");
  }
  if (!Array.isArray(campaign.trials) || campaign.trials.length !== 15
    || [...campaign.trials.map((trial) => trial.runId)].sort().join("\n") !== [...expectedRunIds].sort().join("\n")) {
    throw new Error("campaign trial ledger does not contain the exact planned 15-run set");
  }

  const campaignTrials = new Map(campaign.trials.map((trial) => [trial.runId, trial]));
  const manifests = new Map();
  for (const run of plan.runs) {
    const runRoot = path.join(trialEvidenceRoot, run.runId);
    const manifestFile = path.join(runRoot, "manifest.json");
    const metadata = await lstat(manifestFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${run.runId}: manifest is not a regular file`);
    const first = await readFile(manifestFile);
    const second = await readFile(manifestFile);
    if (!first.equals(second)) throw new Error(`${run.runId}: manifest changed while it was reopened`);
    const fileSha256 = sha256(first);
    const trialLedger = campaignTrials.get(run.runId);
    if (trialLedger?.receiptSha256 !== fileSha256 || trialLedger?.exitCode !== 0
      || trialLedger?.taskId !== run.taskId || trialLedger?.agentProfile !== run.agentProfile
      || trialLedger?.agentDriver !== run.agentDriver || trialLedger?.model !== (run.model ?? null)
      || path.resolve(String(trialLedger?.receiptFile ?? "")) !== manifestFile) {
      throw new Error(`${run.runId}: campaign trial ledger does not bind the reopened manifest`);
    }
    for (const [stream, expectedHash] of [["stdout", trialLedger.stdoutSha256], ["stderr", trialLedger.stderrSha256]]) {
      const logFile = path.join(evidenceRoot, `${run.runId}.${stream}.log`);
      const logMetadata = await lstat(logFile);
      if (!logMetadata.isFile() || logMetadata.isSymbolicLink() || sha256(await readFile(logFile)) !== expectedHash) {
        throw new Error(`${run.runId}: ${stream} log does not match the campaign ledger`);
      }
    }
    const value = JSON.parse(first.toString("utf8"));
    validateAgentEaseTrialManifest(value, { candidate, run });
    await verifyTrialEvidence(runRoot, value, { candidate, taskGoal: taskGoals.get(run.taskId) });
    manifests.set(run.runId, { fileSha256, value });
  }
  return manifests;
}

function runChild(command, commandArgs, cwd) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => resolve({
      durationMs: Math.round(performance.now() - started),
      error: error.message,
      exitCode: null,
      startedAt,
      stderr: Buffer.concat(stderr),
      stdout: Buffer.concat(stdout),
    }));
    child.on("close", (exitCode) => resolve({
      durationMs: Math.round(performance.now() - started),
      error: null,
      exitCode,
      startedAt,
      stderr: Buffer.concat(stderr),
      stdout: Buffer.concat(stdout),
    }));
  });
}

async function writeCampaign(file, campaign) {
  campaign.receiptSha256 = receiptHash(campaign);
  await writeFile(file, `${JSON.stringify(campaign, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(`Run the exact 15-session fresh-agent Ease campaign.

Required:
  --candidate=<40-char-commit>
  --source-hash=<sha256>
  --nodekit-tarball=<exact-candidate.tgz>
  --nodekit-tarball-sha256=<sha256>
  --campaign=<path-safe-id>
  --lower-cost-driver=<codex|claude-code>
  --lower-cost-model=<explicit-model-id>
  --lower-cost-evidence=<official-pricing-evidence.json>

Required live model pins:
  --codex-model=<id>         --claude-model=<id>

Optional:
  --executor=docker           --package-manager=npm
  --concurrency=<1..3>       --timeout-ms=<milliseconds>
  --agent-container-image=<pre-provisioned-codex-and-claude-image>
  --protected-container-image=<pre-provisioned-image>
  --root=<new-evidence-dir>  --output=<verdict-inside-root>
  --dry-run

The command refuses dirty distributable/protected inputs, independently repacks the candidate,
retains every attempt, and never mints external attestation or human-usability evidence.`);
  process.exit(0);
}
args = parseAgentEaseCliArgs(process.argv.slice(2), CLI_ARGUMENT_SPEC);
const candidateCommit = requiredArgument("candidate").toLowerCase();
const candidateSourceHash = requiredArgument("source-hash").toLowerCase();
const candidateTarball = path.resolve(requiredArgument("nodekit-tarball"));
const candidateTarballSha256 = requiredArgument("nodekit-tarball-sha256").toLowerCase();
const campaignId = requiredArgument("campaign");
const lowerCostDriver = requiredArgument("lower-cost-driver");
const lowerCostModel = requiredArgument("lower-cost-model");
const lowerCostEvidenceFile = path.resolve(requiredArgument("lower-cost-evidence"));
if (!COMMIT.test(candidateCommit)) throw new Error("--candidate must be a lowercase 40-character commit");
if (!SHA256.test(candidateSourceHash)) throw new Error("--source-hash must be a lowercase SHA-256 digest");
if (!SHA256.test(candidateTarballSha256)) throw new Error("--nodekit-tarball-sha256 must be a lowercase SHA-256 digest");
const lowerCostEvidenceMetadata = await lstat(lowerCostEvidenceFile);
if (!lowerCostEvidenceMetadata.isFile() || lowerCostEvidenceMetadata.isSymbolicLink()) {
  throw new Error("--lower-cost-evidence must identify a regular non-symbolic-link JSON file");
}
const candidateTarballMetadata = await lstat(candidateTarball);
if (!candidateTarballMetadata.isFile() || candidateTarballMetadata.isSymbolicLink()) {
  throw new Error("--nodekit-tarball must identify a regular non-symbolic-link .tgz file");
}

const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const dirty = parseGitStatusPorcelainZ(git([
  "status", "--porcelain=v1", "-z", "--", ...distributablePathspecs(packageJson),
], { encoding: "buffer" }));
assertCleanDistributablePaths(dirty, "agent ease campaign");
const [actualCommit, actualSourceHash, archive, lowerCostEvidenceBytes] = await Promise.all([
  Promise.resolve(git(["rev-parse", "HEAD"]).trim().toLowerCase()),
  computeNodeKitSourceHash(repoRoot),
  inspectNpmPackageArchiveFile(candidateTarball, {
    expectedName: "@homenshum/nodekit",
    expectedTarballSha256: candidateTarballSha256,
  }),
  readFile(lowerCostEvidenceFile),
]);
if (actualCommit !== candidateCommit) throw new Error(`HEAD ${actualCommit} does not match candidate ${candidateCommit}`);
if (actualSourceHash !== candidateSourceHash) throw new Error(`source hash ${actualSourceHash} does not match ${candidateSourceHash}`);
const protectedInputs = await Promise.all(PROTECTED_INPUT_PATHS.map((relativePath) => readExactCandidateFile(relativePath, candidateCommit)));
const protectedInputByPath = new Map(protectedInputs.map((entry) => [entry.path, entry]));
const sourceArchive = await independentlyPackCandidate({
  candidateCommit,
  candidateSourceHash,
});
const sourceArchiveChecks = validateIndependentSourceArchive(sourceArchive, archive);
const afterPackCommit = git(["rev-parse", "HEAD"]).trim().toLowerCase();
const afterPackSourceHash = await computeNodeKitSourceHash(repoRoot);
const dirtyAfterPack = parseGitStatusPorcelainZ(git([
  "status", "--porcelain=v1", "-z", "--", ...distributablePathspecs(packageJson),
], { encoding: "buffer" }));
assertCleanDistributablePaths(dirtyAfterPack, "agent ease campaign after independent source pack");
if (afterPackCommit !== candidateCommit || afterPackSourceHash !== candidateSourceHash) {
  throw new Error("candidate commit or source bytes changed during independent source packing");
}
await assertProtectedInputsStable(protectedInputs);
const taskSetInput = protectedInputByPath.get("evals/ease/heldout-tasks.json");
const tasksDocument = JSON.parse(taskSetInput.bytes.toString("utf8"));
const lowerCostEvidence = JSON.parse(lowerCostEvidenceBytes.toString("utf8"));
const protectedContainer = resolveProtectedContainerImage(
  typeof args["protected-container-image"] === "string"
    ? args["protected-container-image"]
    : "mcr.microsoft.com/playwright:v1.61.1-noble",
);
const agentContainer = resolveProtectedContainerImage(
  typeof args["agent-container-image"] === "string"
    ? args["agent-container-image"]
    : "nodekit-ease-agent:codex-0.142.5-claude-2.1.185",
);
const evidenceRoot = path.resolve(typeof args.root === "string"
  ? args.root
  : path.join(repoRoot, "proof", "ease", "agent-campaigns", candidateCommit, campaignId));
const trialEvidenceRoot = path.join(evidenceRoot, "runs");
const taskSetFile = path.join(evidenceRoot, "inputs", "evals", "ease", "heldout-tasks.json");
const taskBriefById = Object.fromEntries((tasksDocument.tasks ?? []).map((task) => [task.id, {
  file: path.join(evidenceRoot, "inputs", "tasks", `${task.id}.txt`),
  sha256: sha256(Buffer.from(task.goal, "utf8")),
}]));
const plan = buildAgentEaseCampaignPlan({
  campaignId,
  candidateCommit,
  candidateSourceHash,
  claudeModel: requiredArgument("claude-model"),
  codexModel: requiredArgument("codex-model"),
  executor: typeof args.executor === "string" ? args.executor : "docker",
  agentContainerImage: agentContainer.reference,
  agentContainerImageId: agentContainer.id,
  evidenceRoot: trialEvidenceRoot,
  lowerCostDriver,
  lowerCostEvidence,
  lowerCostModel,
  nodekitTarball: candidateTarball,
  nodekitTarballSha256: candidateTarballSha256,
  packageManager: typeof args["package-manager"] === "string" ? args["package-manager"] : "npm",
  taskBriefById,
  taskSetFile,
  taskSetSha256: taskSetInput.sha256,
  tasks: tasksDocument.tasks,
  timeoutMs: Number.isInteger(Number(args["timeout-ms"])) ? Number(args["timeout-ms"]) : undefined,
  trialRunnerSha256: protectedInputByPath.get("scripts/run-agent-ease-trial.mjs").sha256,
  protectedEvaluatorFile: path.join(repoRoot, "scripts", "run-protected-agent-evaluator.mjs"),
  protectedEvaluatorSha256: protectedInputByPath.get("scripts/run-protected-agent-evaluator.mjs").sha256,
  protectedBrowserLaneFile: path.join(repoRoot, "scripts", "run-protected-browser-lane.mjs"),
  protectedBrowserLaneSha256: protectedInputByPath.get("scripts/run-protected-browser-lane.mjs").sha256,
  providerBrokerFile: path.join(repoRoot, "scripts", "run-agent-provider-broker.mjs"),
  providerBrokerSha256: protectedInputByPath.get("scripts/run-agent-provider-broker.mjs").sha256,
  protectedContainerImage: protectedContainer.reference,
  protectedContainerImageId: protectedContainer.id,
});
const lowerCostSnapshotFile = path.resolve(
  path.dirname(lowerCostEvidenceFile),
  ...plan.lowerCostEvidence.source.snapshotPath.split("/"),
);
const lowerCostSnapshotMetadata = await lstat(lowerCostSnapshotFile);
if (!lowerCostSnapshotMetadata.isFile() || lowerCostSnapshotMetadata.isSymbolicLink()) {
  throw new Error("lower-cost evidence source snapshot must be a regular non-symbolic-link file");
}
const lowerCostSnapshotBytes = await readFile(lowerCostSnapshotFile);
if (sha256(lowerCostSnapshotBytes) !== plan.lowerCostEvidence.source.snapshotSha256) {
  throw new Error("lower-cost evidence source snapshot hash does not match its recorded SHA-256");
}
const lowerCostSnapshot = JSON.parse(lowerCostSnapshotBytes.toString("utf8"));
const pricingValidation = validateOfficialPricingSnapshot(lowerCostSnapshot, plan.lowerCostEvidence, {
  referenceTime: new Date(),
});
const verdictFile = path.resolve(typeof args.output === "string"
  ? args.output
  : path.join(evidenceRoot, "fresh-agent-verdict.json"));
const verdictContainment = path.relative(evidenceRoot, verdictFile);
if (verdictContainment === "" || verdictContainment === ".." || verdictContainment.startsWith(`..${path.sep}`)
  || path.isAbsolute(verdictContainment)) {
  throw new Error("fresh-agent verdict output must be a distinct file inside the new campaign evidence root");
}
const campaignFile = path.join(evidenceRoot, "campaign.json");
if (path.dirname(verdictFile) !== evidenceRoot || path.basename(verdictFile) === path.basename(campaignFile)) {
  throw new Error("fresh-agent verdict output must be a unique top-level file in the campaign evidence root");
}
const campaign = {
  campaignId,
  candidate: {
    commit: candidateCommit,
    packageName: archive.name,
    packageVersion: archive.version,
    sourceHash: candidateSourceHash,
    sourcePack: {
      canonicalManifestSha256: sourceArchive.canonicalManifestSha256,
      checks: sourceArchiveChecks,
      fileCount: sourceArchive.fileCount,
      unpackedSize: sourceArchive.unpackedSize,
    },
    tarballSha256: archive.tarballSha256,
  },
  generatedAt: new Date().toISOString(),
  lowerCostEvidence: {
    ...plan.lowerCostEvidence,
    evidenceFileSha256: sha256(lowerCostEvidenceBytes),
    preservedEvidencePath: "inputs/lower-cost-model-evidence.json",
    preservedSnapshotPath: "inputs/lower-cost-source.snapshot.json",
    pricingValidation,
  },
  plan: plan.runs.map(({ args: commandArgs, ...run }) => ({ ...run, commandArgs })),
  planSha256: sha256(JSON.stringify(plan)),
  schemaVersion: "nodekit.agent-ease-campaign/v1",
  status: args["dry-run"] ? "planned" : "running",
  protectedEvaluatorIsolation: {
    browserLaneSha256: protectedInputByPath.get("scripts/run-protected-browser-lane.mjs").sha256,
    containerImage: protectedContainer.reference,
    containerImageId: protectedContainer.id,
    requiredMode: "docker-internal-two-container",
  },
  codingAgentIsolation: {
    containerImage: agentContainer.reference,
    containerImageId: agentContainer.id,
    requiredMode: "docker-candidate-only",
    requiredDrivers: ["codex", "claude-code"],
    providerBrokerSha256: protectedInputByPath.get("scripts/run-agent-provider-broker.mjs").sha256,
    credentialPolicy: "short-lived-scoped-provider-key-only",
  },
  protectedInputs: protectedInputs.map(({ bytes: _bytes, ...entry }) => ({
    ...entry,
    preservedPath: `inputs/candidate/${entry.path}`,
  })),
  trials: [],
  verdictFile,
};

if (args["dry-run"]) {
  campaign.receiptSha256 = receiptHash(campaign);
  console.log(JSON.stringify(campaign, null, 2));
  process.exit(0);
}

campaign.codingAgentIsolation.credentialPreflight = [credentialPreflight("codex"), credentialPreflight("claude-code")];

await createFreshEvidenceRoot(evidenceRoot, [
  candidateTarball,
  lowerCostEvidenceFile,
  lowerCostSnapshotFile,
  ...protectedInputs.map((input) => path.join(repoRoot, ...input.path.split("/"))),
]);
for (const input of protectedInputs) {
  const preserved = path.join(evidenceRoot, "inputs", "candidate", ...input.path.split("/"));
  await mkdir(path.dirname(preserved), { recursive: true });
  await writeFile(preserved, input.bytes, { flag: "wx" });
}
await mkdir(path.dirname(taskSetFile), { recursive: true });
await writeFile(taskSetFile, taskSetInput.bytes, { flag: "wx" });
for (const task of tasksDocument.tasks) {
  const binding = taskBriefById[task.id];
  await mkdir(path.dirname(binding.file), { recursive: true });
  await writeFile(binding.file, task.goal, { encoding: "utf8", flag: "wx" });
}
await writeFile(path.join(evidenceRoot, "inputs", "lower-cost-model-evidence.json"), lowerCostEvidenceBytes, { flag: "wx" });
await writeFile(path.join(evidenceRoot, "inputs", "lower-cost-source.snapshot.json"), lowerCostSnapshotBytes, { flag: "wx" });
await writeCampaign(campaignFile, campaign);
const trialScript = path.join(repoRoot, "scripts", "run-agent-ease-trial.mjs");
const concurrency = Math.max(1, Math.min(3, Number.parseInt(String(args.concurrency ?? "1"), 10) || 1));
let cursor = 0;
let persistQueue = Promise.resolve();

function persistCampaign() {
  persistQueue = persistQueue.then(() => writeCampaign(campaignFile, campaign));
  return persistQueue;
}

async function worker() {
  while (cursor < plan.runs.length) {
    const index = cursor;
    cursor += 1;
    const run = plan.runs[index];
    const result = await runChild(process.execPath, [trialScript, ...run.args], repoRoot);
    const stdoutFile = path.join(evidenceRoot, `${run.runId}.stdout.log`);
    const stderrFile = path.join(evidenceRoot, `${run.runId}.stderr.log`);
    await Promise.all([
      writeFile(stdoutFile, result.stdout),
      writeFile(stderrFile, result.stderr),
    ]);
    const receiptFile = path.join(trialEvidenceRoot, run.runId, "manifest.json");
    const receiptBytes = await readFile(receiptFile).catch(() => null);
    campaign.trials.push({
      agentDriver: run.agentDriver,
      agentProfile: run.agentProfile,
      durationMs: result.durationMs,
      error: result.error,
      exitCode: result.exitCode,
      receiptFile,
      receiptSha256: receiptBytes ? sha256(receiptBytes) : null,
      runId: run.runId,
      model: run.model ?? null,
      startedAt: result.startedAt,
      stderrSha256: sha256(result.stderr),
      stdoutSha256: sha256(result.stdout),
      taskId: run.taskId,
    });
    await persistCampaign();
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
campaign.trials.sort((left, right) => plan.runs.findIndex((run) => run.runId === left.runId) - plan.runs.findIndex((run) => run.runId === right.runId));
const endingCommit = git(["rev-parse", "HEAD"]).trim().toLowerCase();
const endingSourceHash = await computeNodeKitSourceHash(repoRoot);
campaign.identityStable = endingCommit === candidateCommit && endingSourceHash === candidateSourceHash;
const verificationErrors = [];
try {
  await assertProtectedInputsStable(protectedInputs);
} catch (error) {
  verificationErrors.push(error.message);
}
const evaluation = await runChild(process.execPath, [
  path.join(repoRoot, "scripts", "evaluate-agent-ease.mjs"),
  `--root=${trialEvidenceRoot}`,
  `--output=${verdictFile}`,
  `--evidence-repo-root=${repoRoot}`,
  `--candidate=${candidateCommit}`,
  `--source-hash=${candidateSourceHash}`,
  `--nodekit-tarball=${candidateTarball}`,
  `--nodekit-tarball-sha256=${candidateTarballSha256}`,
  `--lower-cost-evidence=${path.join(evidenceRoot, "inputs", "lower-cost-model-evidence.json")}`,
  `--lower-cost-snapshot=${path.join(evidenceRoot, "inputs", "lower-cost-source.snapshot.json")}`,
], repoRoot);
await Promise.all([
  writeFile(path.join(evidenceRoot, "evaluator.stdout.log"), evaluation.stdout),
  writeFile(path.join(evidenceRoot, "evaluator.stderr.log"), evaluation.stderr),
]);
let verdictBytes = null;
let verdict = null;
let manifests = null;
try {
  await assertProtectedInputsStable(protectedInputs);
  if (sha256(await readFile(candidateTarball)) !== candidateTarballSha256) {
    throw new Error("exact candidate tarball changed during the campaign");
  }
  for (const input of protectedInputs) {
    const preserved = path.join(evidenceRoot, "inputs", "candidate", ...input.path.split("/"));
    const metadata = await lstat(preserved);
    if (!metadata.isFile() || metadata.isSymbolicLink() || sha256(await readFile(preserved)) !== input.sha256) {
      throw new Error(`preserved protected input is invalid: ${input.path}`);
    }
  }
  if (sha256(await readFile(taskSetFile)) !== taskSetInput.sha256) throw new Error("preserved task set changed");
  for (const task of tasksDocument.tasks) {
    if (sha256(await readFile(taskBriefById[task.id].file)) !== taskBriefById[task.id].sha256) {
      throw new Error(`preserved task brief changed: ${task.id}`);
    }
  }
  if (sha256(await readFile(path.join(evidenceRoot, "inputs", "lower-cost-model-evidence.json"))) !== sha256(lowerCostEvidenceBytes)
    || sha256(await readFile(path.join(evidenceRoot, "inputs", "lower-cost-source.snapshot.json"))) !== sha256(lowerCostSnapshotBytes)) {
    throw new Error("preserved official lower-cost evidence changed");
  }
  manifests = await verifyCampaignReceipts({
    campaign,
    candidate: campaign.candidate,
    evidenceRoot,
    plan,
    taskGoals: new Map(tasksDocument.tasks.map((task) => [task.id, task.goal])),
    trialEvidenceRoot,
  });
  const verdictMetadata = await lstat(verdictFile);
  if (!verdictMetadata.isFile() || verdictMetadata.isSymbolicLink()) throw new Error("measurement verdict is not a regular file");
  const firstVerdictBytes = await readFile(verdictFile);
  const secondVerdictBytes = await readFile(verdictFile);
  if (!firstVerdictBytes.equals(secondVerdictBytes)) throw new Error("measurement verdict changed while it was reopened");
  verdictBytes = firstVerdictBytes;
  verdict = JSON.parse(verdictBytes.toString("utf8"));
  validateAgentEaseMeasurementVerdict(normalizeVerdictPathsForCampaignValidation(verdict, trialEvidenceRoot), {
    candidate: campaign.candidate,
    manifests,
    runs: plan.runs,
  });
} catch (error) {
  verificationErrors.push(error.message);
}
campaign.evaluator = {
  durationMs: evaluation.durationMs,
  error: evaluation.error,
  exitCode: evaluation.exitCode,
  measurementPassed: verdict?.passed === true,
  stderrSha256: sha256(evaluation.stderr),
  stdoutSha256: sha256(evaluation.stdout),
  verdictSha256: verdictBytes ? sha256(verdictBytes) : null,
};
campaign.verifiedReceiptCount = manifests?.size ?? 0;
campaign.verificationErrors = verificationErrors;
campaign.measurementPassed = campaign.identityStable
  && campaign.trials.length === 15
  && campaign.trials.every((trial) => trial.exitCode === 0 && trial.receiptSha256)
  && evaluation.exitCode === 0
  && verdict?.passed === true
  && manifests?.size === 15
  && verificationErrors.length === 0;
// The repository evaluator intentionally emits an unsigned measurement body.
// A campaign can prove the measured matrix succeeded, but it cannot mint its
// own independent submission attestation. That external gate remains false.
campaign.passed = false;
campaign.submissionCertified = false;
campaign.status = campaign.measurementPassed
  ? "measurement-passed-awaiting-independent-attestation"
  : "failed";
campaign.completedAt = new Date().toISOString();
await writeCampaign(campaignFile, campaign);
console.log(JSON.stringify(campaign, null, 2));
if (!campaign.measurementPassed) process.exitCode = 1;
}
