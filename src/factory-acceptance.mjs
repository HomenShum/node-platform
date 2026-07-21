import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAgentDefinition } from "./lib/agent-definition.mjs";
import { createProject } from "./lib/scaffold.mjs";
import { computeNodeKitSourceHash } from "./lib/source-hash.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.env.NODEKIT_PACKAGE_MANAGER ?? "npm";
const runId = process.env.NODEKIT_EASE_RUN_ID ?? `ease_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runCommand(cwd, command, args, { env = {}, timeout = 180_000 } = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", ...env },
    shell: process.platform === "win32" && new Set(["npm", "npx", "pnpm"]).has(command),
    timeout,
  });
  const phase = {
    args,
    command,
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    failed: Boolean(result.error) || result.status !== 0,
    startedAt,
    stderrSha256: digest(result.stderr ?? ""),
    stdoutSha256: digest(result.stdout ?? ""),
  };
  if (result.error) throw Object.assign(result.error, { phase });
  if (result.status !== 0) throw Object.assign(new Error(`${command} ${args.join(" ")} failed in ${cwd}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`), { phase });
  return { phase, stdout: result.stdout ?? "" };
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

async function acceptBase(root, sourceIdentity) {
  const phases = [];
  const target = path.join(root, "domain-blank-base");
  const scaffoldStarted = performance.now();
  await createProject({
    brief: "Carry one bounded user intention to a reviewed and verified artifact.",
    git: true,
    install: false,
    name: "factory-domain-blank-base",
    packageManager,
    target,
  });
  phases.push({ durationMs: Math.round(performance.now() - scaffoldStarted), name: "scaffold_generation", startedAt: new Date().toISOString() });

  const installArgs = packageManager === "pnpm"
    ? ["install", "--prefer-offline"]
    : ["install", "--prefer-offline", "--no-audit", "--no-fund"];
  phases.push({ ...runCommand(target, packageManager, installArgs, { timeout: 300_000 }).phase, name: "dependency_installation" });
  phases.push({ ...runCommand(target, "git", ["add", "--all"]).phase, name: "candidate_stage_after_install" });
  const status = runCommand(target, "git", ["status", "--porcelain"]).stdout.trim();
  if (status) {
    phases.push({
      ...runCommand(target, "git", ["-c", "user.name=NodeKit", "-c", "user.email=nodekit@local", "commit", "-m", "chore: lock generated dependencies"]).phase,
      name: "candidate_lock_commit",
    });
  }
  const candidateCommit = await currentGitCommit(target);

  phases.push({ ...runPackageScript(target, "compile").phase, name: "compile" });
  const compiled = await compileAgentDefinition(target);
  for (const [script, name] of [["check", "deterministic_checks"], ["demo", "neutral_journey"], ["eval", "evaluation"], ["proof:browser-contract", "browser_contract"]]) {
    phases.push({ ...runPackageScript(target, script).phase, name });
  }

  const browserInstall = packageManager === "pnpm"
    ? runCommand(target, "pnpm", ["exec", "playwright", "install", "chromium"], { timeout: 300_000 })
    : runCommand(target, "npx", ["playwright", "install", "chromium"], { timeout: 300_000 });
  phases.push({ ...browserInstall.phase, name: "browser_runtime_installation" });
  phases.push({
    ...runPackageScript(target, "proof:browser", {
      env: {
        NODEKIT_EASE_RUN_ID: runId,
        NODEKIT_SOURCE_COMMIT: sourceIdentity.commit,
        NODEKIT_SOURCE_HASH: sourceIdentity.hash,
      },
      timeout: 300_000,
    }).phase,
    name: "rendered_browser_journey",
  });
  phases.push({ ...runPackageScript(target, "proof").phase, name: "receipt_completion" });

  const [packageJson, lock, proof, browserContract, browserJourney, currentIdentity, resolvedDefinition, figuredOut, experience] = await Promise.all([
    readJson(path.join(target, "package.json")),
    readFile(path.join(target, packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json"), "utf8").then(() => true).catch(() => false),
    readJson(path.join(target, "proof", "release-proof.json")),
    readJson(path.join(target, "proof", "browser-contract.json")),
    readJson(path.join(target, "proof", "browser-certification.json")),
    readJson(path.join(target, ".nodeagent", "application-identity.json")),
    readJson(path.join(target, ".nodeagent", "resolved-definition.json")),
    readFile(path.join(target, "docs", "FIGURED_OUT.md"), "utf8"),
    readFile(path.join(target, "product", "EXPERIENCE.yaml"), "utf8"),
  ]);
  const dependency = packageJson.dependencies?.["@homenshum/nodekit"] ?? packageJson.devDependencies?.["@homenshum/nodekit"];
  const checks = {
    browserContractPassed: browserContract.passed === true,
    browserJourneyPassed: browserJourney.passed === true,
    candidateCommitted: /^[a-f0-9]{40}$/.test(candidateCommit),
    compileReproducible: currentIdentity.applicationHash === compiled.definition.applicationHash,
    domainBlank: !/lending|research-loop|founderquest/i.test(`${figuredOut}\n${experience}`),
    easeCertificationHonest: browserJourney.certified === true
      && browserJourney.missingStates.length === 0
      && browserJourney.coveredStates.length === browserJourney.requiredStates.length,
    figuredOutContract: figuredOut.includes("Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt"),
    lockCreated: lock === true,
    proofIdentityBound: proof.applicationHash === currentIdentity.applicationHash && proof.configHash === currentIdentity.configHash,
    proofPassed: proof.passed === true && proof.releaseReady === false,
    runtimeHashBound: currentIdentity.identity?.files?.some((file) => file.path === "vendor/nodekit/src/cli.mjs"),
    runtimeNotMisclassified: Object.values(resolvedDefinition.discovered ?? {}).flat().every((entry) => !String(entry).startsWith("vendor/")),
    runtimeSpecifierPortable: dependency === "file:vendor/nodekit",
  };
  if (!Object.values(checks).every(Boolean)) throw new Error(`domain-blank base factory acceptance failed: ${JSON.stringify(checks)}`);
  return {
    applicationHash: currentIdentity.applicationHash,
    browserManifestDigest: browserJourney.manifestSha256,
    candidateCommit,
    checks,
    configHash: currentIdentity.configHash,
    dependency,
    phases,
    proofDigest: digest(proof),
    target,
    template: "domain-blank-base",
  };
}

const startedAt = new Date().toISOString();
const started = performance.now();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-factory-acceptance-"));
let receipt;
try {
  console.log(`FACTORY ACCEPTANCE domain-blank-base (${packageManager})`);
  const sourceIdentity = { commit: await currentGitCommit(repoRoot), hash: await computeNodeKitSourceHash(repoRoot) };
  const result = await acceptBase(temporaryRoot, sourceIdentity);
  const evidenceSource = path.join(result.target, "proof", "ease", runId);
  const evidenceTarget = path.join(repoRoot, "proof", "ease", "latest");
  await rm(evidenceTarget, { force: true, recursive: true });
  await mkdir(evidenceTarget, { recursive: true });
  await cp(evidenceSource, evidenceTarget, { recursive: true });
  runCommand(result.target, "git", ["archive", "--format=tar.gz", `--output=${path.join(evidenceTarget, "candidate.tar.gz")}`, "HEAD"]);

  receipt = {
    base: { ...result, target: undefined },
    cacheClass: process.env.NODEKIT_CACHE_CLASS ?? "warm-or-unknown",
    durationMs: Math.round(performance.now() - started),
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    nodekitCommit: sourceIdentity.commit,
    nodekitSourceHash: sourceIdentity.hash,
    operatingSystem: `${os.platform()}-${os.release()}-${os.arch()}`,
    packageManager,
    passed: true,
    runId,
    schemaVersion: "nodekit.ease-proof-run/v1",
    startedAt,
    submissionReady: false,
    submissionBlockers: ["developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment", "proofloopEaseVerification"],
    verdict: "EASE_NOT_CERTIFIED",
  };
  receipt.receiptDigest = digest(receipt);
  await mkdir(path.join(repoRoot, "proof"), { recursive: true });
  await writeFile(path.join(repoRoot, "proof", "factory-acceptance.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(evidenceTarget, "manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (process.env.NODEKIT_KEEP_ACCEPTANCE !== "1") await rm(temporaryRoot, { force: true, recursive: true });
  else console.log(`FACTORY ACCEPTANCE WORKSPACES ${temporaryRoot}`);
}
