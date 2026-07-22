import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNodeKitSourceHash } from "./lib/source-hash.mjs";
import { requiredSubmissionGates } from "./lib/submission-gate.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.env.NODEKIT_PACKAGE_MANAGER ?? "npm";
const runId = process.env.NODEKIT_EASE_RUN_ID ?? `ease_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const cacheClass = process.env.NODEKIT_CACHE_CLASS ?? "warm-or-unknown";

if (!["npm", "pnpm"].includes(packageManager)) {
  throw new Error(`unsupported NODEKIT_PACKAGE_MANAGER ${packageManager}; expected npm or pnpm`);
}
if (!["cold", "warm", "warm-or-unknown"].includes(cacheClass)) {
  throw new Error(`unsupported NODEKIT_CACHE_CLASS ${cacheClass}; expected cold, warm, or warm-or-unknown`);
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileDigest(file) {
  return digest(await readFile(file));
}

function runCommand(cwd, command, args, {
  displayArgs = args,
  env = {},
  measured = true,
  timeout = 180_000,
} = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", npm_config_audit: "false", npm_config_fund: "false", ...env },
    shell: process.platform === "win32" && new Set(["npm", "npx", "pnpm"]).has(command),
    timeout,
  });
  const phase = {
    args: displayArgs,
    command,
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    failed: Boolean(result.error) || result.status !== 0,
    measured,
    startedAt,
    stderrSha256: digest(result.stderr ?? ""),
    stdoutSha256: digest(result.stdout ?? ""),
  };
  if (result.error) throw Object.assign(result.error, { phase });
  if (result.status !== 0) throw Object.assign(new Error(`${command} ${args.join(" ")} failed in ${cwd}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`), { phase });
  return { phase, stdout: result.stdout ?? "" };
}

function packageInstallArgs(cache, specifier = null) {
  if (packageManager === "pnpm") {
    return [specifier ? "add" : "install", ...(specifier ? [specifier] : []), "--ignore-scripts", "--prefer-offline", "--store-dir", cache];
  }
  return ["install", ...(specifier ? [specifier] : []), "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", "--cache", cache];
}

function playwrightInstallCommand() {
  return packageManager === "pnpm"
    ? { command: "pnpm", args: ["exec", "playwright", "install", "chromium"] }
    : { command: "npm", args: ["exec", "--", "playwright", "install", "chromium"] };
}

function runPackageScript(cwd, script, options) {
  return runCommand(cwd, packageManager, ["run", script], options);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function currentGitCommit(cwd) {
  return runCommand(cwd, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

async function assertCleanCandidate(sourceIdentity) {
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const pathspecs = ["package.json", ...(packageJson.files ?? [])].map((entry) => String(entry).replace(/^\.\//, ""));
  const status = runCommand(repoRoot, "git", ["status", "--porcelain=v1", "--untracked-files=all", "--", ...pathspecs]).stdout.trim();
  if (status) throw new Error(`factory acceptance requires a clean distributable candidate:\n${status}`);
  const [commit, sourceHash] = await Promise.all([currentGitCommit(repoRoot), computeNodeKitSourceHash(repoRoot)]);
  if (commit !== sourceIdentity.commit || sourceHash !== sourceIdentity.hash) throw new Error("candidate identity changed while preparing factory acceptance");
  return packageJson;
}

async function prepareCandidateTarball(temporaryRoot, sourceIdentity) {
  const packageJson = await assertCleanCandidate(sourceIdentity);
  const destination = path.join(temporaryRoot, "candidate-package");
  await mkdir(destination, { recursive: true });
  const packed = runCommand(repoRoot, "npm", ["pack", "--json", "--pack-destination", destination], {
    displayArgs: ["pack", "--json", "--pack-destination", "<candidate-package>"],
    measured: false,
    timeout: 300_000,
  });
  const records = JSON.parse(packed.stdout.replace(/^\uFEFF/, "").trim());
  if (!Array.isArray(records) || records.length !== 1) throw new Error("npm pack did not return exactly one candidate archive");
  const record = records[0];
  if (record.name !== packageJson.name || record.version !== packageJson.version) throw new Error("packed candidate identity does not match package.json");
  const tarball = path.join(destination, record.filename);
  const tarballInfo = await stat(tarball);
  const tarballSha256 = await fileDigest(tarball);
  if (tarballInfo.size <= 0 || !SHA256.test(tarballSha256)) throw new Error("packed candidate archive is empty or invalid");
  await assertCleanCandidate(sourceIdentity);
  return {
    name: record.name,
    packagingPhase: packed.phase,
    tarball,
    tarballBytes: tarballInfo.size,
    tarballSha256,
    version: record.version,
  };
}

function isolatedEnvironment(root) {
  return { PLAYWRIGHT_BROWSERS_PATH: path.join(root, "playwright-browsers") };
}

async function initializeLauncher(launcher) {
  await mkdir(launcher, { recursive: true });
  await writeFile(path.join(launcher, "package.json"), `${JSON.stringify({ name: "nodekit-empty-launcher", private: true, version: "0.0.0" }, null, 2)}\n`);
}

function installedCli(launcher) {
  return path.join(launcher, "node_modules", "@homenshum", "nodekit", "src", "cli.mjs");
}

async function scaffoldFromInstalledCandidate({ environment, launcher, target, tarball, cache, measured, phases }) {
  const initializationStarted = performance.now();
  const initializationStartedAt = new Date().toISOString();
  await initializeLauncher(launcher);
  phases.push({
    durationMs: Math.round(performance.now() - initializationStarted),
    measured,
    name: "launcher_initialization",
    startedAt: initializationStartedAt,
  });
  phases.push({
    ...runCommand(launcher, packageManager, packageInstallArgs(cache, tarball), {
      displayArgs: packageInstallArgs("<isolated-cache>", "<exact-nodekit-tarball>"),
      env: environment,
      measured,
      timeout: 300_000,
    }).phase,
    name: "launcher_installation",
  });
  phases.push({
    ...runCommand(launcher, process.execPath, [
      installedCli(launcher),
      "create",
      target,
      "--name", "factory-domain-blank-base",
      "--brief", "Carry one bounded user intention to a reviewed and verified artifact.",
      "--nodekit-specifier", "file:vendor/nodekit.tgz",
      "--package-manager", packageManager,
      "--no-install",
      ...(measured ? [] : ["--no-git"]),
    ], {
      displayArgs: ["<installed-nodekit-cli>", "create", "<empty-target>", "--name", "factory-domain-blank-base", "--brief", "<neutral-brief>", "--nodekit-specifier", "file:vendor/nodekit.tgz", "--package-manager", packageManager, "--no-install", ...(measured ? [] : ["--no-git"])],
      env: environment,
      measured,
      timeout: 300_000,
    }).phase,
    name: "scaffold_generation",
  });
  const bindingStarted = performance.now();
  const bindingStartedAt = new Date().toISOString();
  await mkdir(path.join(target, "vendor"), { recursive: true });
  await copyFile(tarball, path.join(target, "vendor", "nodekit.tgz"));
  phases.push({ durationMs: Math.round(performance.now() - bindingStarted), measured, name: "exact_tarball_binding", startedAt: bindingStartedAt });
  phases.push({
    ...runCommand(target, packageManager, packageInstallArgs(cache), {
      displayArgs: packageInstallArgs("<isolated-cache>"),
      env: environment,
      measured,
      timeout: 300_000,
    }).phase,
    name: "generated_application_installation",
  });
  const browserInstall = playwrightInstallCommand();
  phases.push({
    ...runCommand(target, browserInstall.command, browserInstall.args, { env: environment, measured, timeout: 300_000 }).phase,
    name: "browser_runtime_installation",
  });
}

async function primeWarmCache(root, candidate, cache, environment) {
  const phases = [];
  await scaffoldFromInstalledCandidate({
    cache,
    environment,
    launcher: path.join(root, "prime-launcher"),
    measured: false,
    phases,
    target: path.join(root, "prime-app"),
    tarball: candidate.tarball,
  });
  await Promise.all([
    rm(path.join(root, "prime-launcher"), { force: true, recursive: true }),
    rm(path.join(root, "prime-app"), { force: true, recursive: true }),
  ]);
  return phases;
}

async function acceptBase(root, sourceIdentity, candidate) {
  const phases = [];
  const launcher = path.join(root, "launcher");
  const target = path.join(root, "domain-blank-base");
  const isolatedCache = path.join(root, `${packageManager}-cache`);
  const environment = isolatedEnvironment(root);
  const timerBoundary = "empty-launcher-before-package-json-to-completed-proof";
  const startedAt = new Date().toISOString();
  const started = performance.now();

  await scaffoldFromInstalledCandidate({ cache: isolatedCache, environment, launcher, measured: true, phases, target, tarball: candidate.tarball });
  phases.push({ ...runCommand(target, "git", ["add", "--all"], { env: environment }).phase, name: "candidate_stage_after_install" });
  const status = runCommand(target, "git", ["status", "--porcelain"], { env: environment }).stdout.trim();
  if (status) {
    phases.push({
      ...runCommand(target, "git", ["-c", "user.name=NodeKit", "-c", "user.email=nodekit@local", "commit", "-m", "chore: bind exact candidate dependencies"], { env: environment }).phase,
      name: "candidate_lock_commit",
    });
  }
  const candidateCommit = await currentGitCommit(target);

  phases.push({ ...runPackageScript(target, "compile", { env: environment }).phase, name: "compile" });
  for (const [script, name] of [["check", "deterministic_checks"], ["demo", "neutral_journey"], ["eval", "evaluation"], ["proof:browser-contract", "browser_contract"]]) {
    phases.push({ ...runPackageScript(target, script, { env: environment }).phase, name });
  }
  phases.push({
    ...runPackageScript(target, "proof:browser", {
      env: {
        ...environment,
        NODEKIT_EASE_RUN_ID: runId,
        NODEKIT_SOURCE_COMMIT: sourceIdentity.commit,
        NODEKIT_SOURCE_HASH: sourceIdentity.hash,
        NODEKIT_TARBALL_SHA256: candidate.tarballSha256,
      },
      timeout: 300_000,
    }).phase,
    name: "rendered_browser_journey",
  });
  phases.push({ ...runPackageScript(target, "proof", { env: environment }).phase, name: "receipt_completion" });

  const durationMs = Math.round(performance.now() - started);
  const lockName = packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  const [packageJson, lockBytes, proof, browserContract, browserJourney, currentIdentity, resolvedDefinition, figuredOut, experience, installedRuntimePackage] = await Promise.all([
    readJson(path.join(target, "package.json")),
    readFile(path.join(target, lockName)),
    readJson(path.join(target, "proof", "release-proof.json")),
    readJson(path.join(target, "proof", "browser-contract.json")),
    readJson(path.join(target, "proof", "browser-certification.json")),
    readJson(path.join(target, ".nodeagent", "application-identity.json")),
    readJson(path.join(target, ".nodeagent", "resolved-definition.json")),
    readFile(path.join(target, "docs", "FIGURED_OUT.md"), "utf8"),
    readFile(path.join(target, "product", "EXPERIENCE.yaml"), "utf8"),
    readJson(path.join(target, "node_modules", "@homenshum", "nodekit", "package.json")),
  ]);
  const dependency = packageJson.dependencies?.[candidate.name] ?? packageJson.devDependencies?.[candidate.name];
  const generatedTarballSha256 = await fileDigest(path.join(target, "vendor", "nodekit.tgz"));
  const lockText = lockBytes.toString("utf8");
  const identityFiles = new Map((currentIdentity.identity?.files ?? []).map((entry) => [entry.path, entry]));
  const checks = {
    browserContractPassed: browserContract.passed === true,
    browserJourneyPassed: browserJourney.passed === true,
    candidateCommitted: /^[a-f0-9]{40}$/.test(candidateCommit),
    compileReproducible: proof.applicationHash === currentIdentity.applicationHash && proof.configHash === currentIdentity.configHash,
    domainBlank: !/lending|research-loop|founderquest/i.test(`${figuredOut}\n${experience}`),
    easeCertificationHonest: browserJourney.certified === true
      && browserJourney.missingStates.length === 0
      && browserJourney.coveredStates.length === browserJourney.requiredStates.length,
    figuredOutContract: figuredOut.includes("Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt"),
    lockCreated: lockBytes.length > 0,
    proofIdentityBound: proof.applicationHash === currentIdentity.applicationHash && proof.configHash === currentIdentity.configHash,
    proofPassed: proof.passed === true && proof.releaseReady === false,
    runtimeHashBound: generatedTarballSha256 === candidate.tarballSha256
      && identityFiles.get("vendor/nodekit.tgz")?.digest === candidate.tarballSha256
      && installedRuntimePackage.name === candidate.name
      && installedRuntimePackage.version === candidate.version
      && lockText.includes("file:vendor/nodekit.tgz"),
    runtimeNotMisclassified: Object.values(resolvedDefinition.discovered ?? {}).flat().every((entry) => !String(entry).startsWith("vendor/")),
    runtimeSpecifierPortable: dependency === "file:vendor/nodekit.tgz",
  };
  if (!Object.values(checks).every(Boolean)) throw new Error(`domain-blank base factory acceptance failed: ${JSON.stringify(checks)}`);
  return {
    applicationHash: currentIdentity.applicationHash,
    browserManifestDigest: browserJourney.manifestSha256,
    candidateCommit,
    checks,
    configHash: currentIdentity.configHash,
    dependency,
    durationMs,
    phases,
    proofDigest: digest(proof),
    startedAt,
    timerBoundary,
    timingEvidence: {
      cacheClass,
      cacheIsolated: cacheClass === "cold" || cacheClass === "warm",
      firstMeaningfulPaintMs: browserJourney.firstMeaningfulPaintMs,
      horizontalOverflowPx: Math.max(0, ...browserJourney.screenshots.map((entry) => entry.horizontalOverflowPx ?? 0)),
      neutralJourneyMs: browserJourney.milestones.find((entry) => entry.name === "receipt_reload_confirmed")?.elapsedMs,
      reloadPreserved: browserJourney.journeyAssertions?.receiptSurvivedReload === true,
      serverReadinessMs: browserJourney.phases.find((entry) => entry.name === "server_readiness")?.durationMs,
    },
    target,
    template: "domain-blank-base",
  };
}

async function ciProvenance(sourceCommit) {
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const workflowFile = path.join(repoRoot, ".github", "workflows", "ease-proof.yml");
  const workflowFileSha256 = await fileDigest(workflowFile).catch(() => null);
  return {
    githubRunAttempt: githubActions ? Number(process.env.GITHUB_RUN_ATTEMPT) : null,
    githubRunId: githubActions ? process.env.GITHUB_RUN_ID ?? null : null,
    githubSha: githubActions ? process.env.GITHUB_SHA ?? null : null,
    githubWorkflowRef: githubActions ? process.env.GITHUB_WORKFLOW_REF ?? null : null,
    provider: githubActions ? "github-actions" : "local",
    runnerArch: process.env.RUNNER_ARCH ?? os.arch(),
    runnerImageOs: process.env.ImageOS ?? null,
    runnerImageVersion: process.env.ImageVersion ?? null,
    runnerName: process.env.RUNNER_NAME ?? os.hostname(),
    runnerOs: process.env.RUNNER_OS ?? os.platform(),
    sourceCommitMatchesGithubSha: githubActions ? process.env.GITHUB_SHA === sourceCommit : null,
    workflowFileSha256,
  };
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-factory-acceptance-"));
let receipt;
try {
  console.log(`FACTORY ACCEPTANCE domain-blank-base (${packageManager})`);
  const sourceIdentity = { commit: await currentGitCommit(repoRoot), hash: await computeNodeKitSourceHash(repoRoot) };
  const candidate = await prepareCandidateTarball(temporaryRoot, sourceIdentity);
  const packageManagerVersion = runCommand(repoRoot, packageManager, ["--version"], { measured: false }).stdout.trim();
  const journeyRoot = path.join(temporaryRoot, "measured-journey");
  await mkdir(journeyRoot, { recursive: true });
  const environment = isolatedEnvironment(journeyRoot);
  const cache = path.join(journeyRoot, `${packageManager}-cache`);
  const primingPhases = cacheClass === "warm" ? await primeWarmCache(journeyRoot, candidate, cache, environment) : [];
  const result = await acceptBase(journeyRoot, sourceIdentity, candidate);
  const evidenceSource = path.join(result.target, "proof", "ease", runId);
  const evidenceTarget = path.join(repoRoot, "proof", "ease", "latest");
  await rm(evidenceTarget, { force: true, recursive: true });
  await mkdir(evidenceTarget, { recursive: true });
  await cp(evidenceSource, evidenceTarget, { recursive: true });
  const candidateArchive = path.join(evidenceTarget, "candidate.tar.gz");
  runCommand(result.target, "git", ["archive", "--format=tar.gz", `--output=${candidateArchive}`, "HEAD"], {
    displayArgs: ["archive", "--format=tar.gz", "--output=<evidence>/candidate.tar.gz", "HEAD"],
  });
  const candidateArchiveInfo = await stat(candidateArchive);
  const candidateArchiveSha256 = await fileDigest(candidateArchive);

  receipt = {
    base: { ...result, target: undefined },
    cacheClass,
    cacheIsolated: result.timingEvidence.cacheIsolated,
    ciProvenance: await ciProvenance(sourceIdentity.commit),
    durationMs: result.durationMs,
    generatedAt: new Date().toISOString(),
    generatedCandidateArchiveBytes: candidateArchiveInfo.size,
    generatedCandidateArchiveSha256: candidateArchiveSha256,
    nodeVersion: process.version,
    nodekitCommit: sourceIdentity.commit,
    nodekitPackage: candidate.name,
    nodekitSourceHash: sourceIdentity.hash,
    nodekitTarballBytes: candidate.tarballBytes,
    nodekitTarballSha256: candidate.tarballSha256,
    nodekitVersion: candidate.version,
    operatingSystem: `${os.platform()}-${os.release()}-${os.arch()}`,
    packageManager,
    packageManagerVersion,
    packagingPhase: candidate.packagingPhase,
    passed: true,
    primingPhases,
    runId,
    schemaVersion: "nodekit.ease-proof-run/v1",
    startedAt: result.startedAt,
    submissionReady: false,
    submissionBlockers: [...requiredSubmissionGates],
    timerBoundary: result.timerBoundary,
    verdict: "EASE_NOT_CERTIFIED",
  };
  receipt.receiptDigest = digest(receipt);
  await mkdir(path.join(repoRoot, "proof"), { recursive: true });
  await writeFile(path.join(repoRoot, "proof", "factory-acceptance.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(evidenceTarget, "manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  if (cacheClass === "cold" || cacheClass === "warm") {
    const phase = (name) => result.phases.find((entry) => entry.name === name);
    const installParts = {
      browserRuntimeInstallationMs: phase("browser_runtime_installation")?.durationMs,
      generatedAppInstallationMs: phase("generated_application_installation")?.durationMs,
      launcherInstallationMs: phase("launcher_installation")?.durationMs,
    };
    const timingReceipt = {
      apiKeysRequired: 0,
      applicationHash: result.applicationHash,
      cacheClass,
      cacheIsolated: result.timingEvidence.cacheIsolated,
      ciProvenance: receipt.ciProvenance,
      consoleErrors: 0,
      configHash: result.configHash,
      failedCommands: result.phases.filter((entry) => entry.failed === true).length,
      generatedAt: receipt.generatedAt,
      generatedCandidateArchiveBytes: candidateArchiveInfo.size,
      generatedCandidateArchiveSha256: candidateArchiveSha256,
      generatedCandidateCommit: result.candidateCommit,
      horizontalOverflowPx: result.timingEvidence.horizontalOverflowPx,
      lane: `${os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "ubuntu"}/${packageManager}`,
      manualDecisions: 0,
      measurements: {
        compileMs: phase("compile")?.durationMs,
        dependencyInstallationMs: Object.values(installParts).reduce((sum, value) => sum + value, 0),
        firstMeaningfulPaintMs: result.timingEvidence.firstMeaningfulPaintMs,
        neutralJourneyMs: result.timingEvidence.neutralJourneyMs,
        scaffoldGenerationMs: phase("scaffold_generation")?.durationMs,
        serverReadinessMs: result.timingEvidence.serverReadinessMs,
        totalMs: result.durationMs,
        ...installParts,
      },
      nodeVersion: receipt.nodeVersion,
      nodekitCommit: sourceIdentity.commit,
      nodekitPackage: candidate.name,
      nodekitSourceHash: sourceIdentity.hash,
      nodekitTarballSha256: candidate.tarballSha256,
      nodekitVersion: candidate.version,
      operatingSystem: receipt.operatingSystem,
      packageManager,
      packageManagerVersion,
      receiptProduced: result.checks.proofPassed,
      reloadPreserved: result.timingEvidence.reloadPreserved,
      runId,
      schemaVersion: "nodekit.developer-timing-run/v1",
      sourceEdits: 0,
      timerBoundary: result.timerBoundary,
    };
    timingReceipt.receiptSha256 = digest(timingReceipt);
    await writeFile(path.join(repoRoot, "proof", "ease", "developer-timing-run.json"), `${JSON.stringify(timingReceipt, null, 2)}\n`);
    await writeFile(path.join(evidenceTarget, "developer-timing-run.json"), `${JSON.stringify(timingReceipt, null, 2)}\n`);
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (process.env.NODEKIT_KEEP_ACCEPTANCE !== "1") await rm(temporaryRoot, { force: true, recursive: true });
  else console.log(`FACTORY ACCEPTANCE WORKSPACES ${temporaryRoot}`);
}
