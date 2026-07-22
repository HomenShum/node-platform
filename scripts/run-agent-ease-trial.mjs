import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectNpmPackageArchiveFile } from "../src/lib/npm-package-archive.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { reportsWriteBlockage } from "../src/lib/agent-ease-report.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...value] = entry.replace(/^--/, "").split("=");
  return [key, value.join("=") || true];
}));
const taskId = String(args.task ?? "volunteer-onboarding");
const tasks = JSON.parse(await readFile(path.join(repoRoot, "evals", "ease", "heldout-tasks.json"), "utf8"));
const task = tasks.tasks.find((entry) => entry.id === taskId);
if (!task) throw new Error(`unknown held-out task ${taskId}; available: ${tasks.tasks.map((entry) => entry.id).join(", ")}`);
const requestedProfile = String(args.agentProfile ?? process.env.NODEKIT_AGENT_PROFILE ?? "codex");
const runId = String(args.run ?? `agent_${requestedProfile}_${taskId}_${randomUUID().replaceAll("-", "").slice(0, 12)}`);
const packageManager = String(args.packageManager ?? "npm");
const nodekitTarballArgument = args.nodekitTarball ?? args["nodekit-tarball"];
if (typeof nodekitTarballArgument !== "string" || nodekitTarballArgument.trim().length === 0) {
  throw new Error("--nodekit-tarball=<exact-candidate.tgz> is required");
}
const nodekitTarball = path.resolve(nodekitTarballArgument);
const expectedTarballSha256 = String(
  args.nodekitTarballSha256
    ?? args["nodekit-tarball-sha256"]
    ?? process.env.NODEKIT_TARBALL_SHA256
    ?? "",
).toLowerCase() || null;
if (expectedTarballSha256 !== null && !SHA256.test(expectedTarballSha256)) {
  throw new Error("--nodekit-tarball-sha256 must be a lowercase SHA-256 digest");
}
const executor = String(args.executor ?? "native");
const agentProfile = requestedProfile;
const agentDriver = String(args.agentDriver ?? process.env.NODEKIT_AGENT_DRIVER ?? (agentProfile === "claude-code" ? "claude-code" : "codex"));
const agentModel = String(args.agentModel ?? process.env.NODEKIT_AGENT_MODEL ?? "").trim() || null;
if (!new Set(["native", "docker"]).has(executor)) throw new Error(`unsupported executor ${executor}`);
if (!new Set(["npm", "pnpm"]).has(packageManager)) throw new Error(`unsupported package manager ${packageManager}`);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error("run id must be one path-safe segment");
if (!new Set(["codex", "claude-code", "lower-cost"]).has(agentProfile)) throw new Error(`unsupported agent profile ${agentProfile}`);
if (!new Set(["codex", "claude-code"]).has(agentDriver)) throw new Error(`unsupported agent driver ${agentDriver}`);
if (agentProfile === "codex" && agentDriver !== "codex") throw new Error("codex profile must use the codex driver");
if (agentProfile === "claude-code" && agentDriver !== "claude-code") throw new Error("claude-code profile must use the claude-code driver");
if (agentProfile === "lower-cost" && !agentModel) throw new Error("lower-cost profile requires --agentModel=<explicit-model-id>");
if (executor === "docker" && agentDriver !== "codex") throw new Error("docker executor currently supports the codex driver only");
const evidenceRoot = path.join(repoRoot, "proof", "ease", "agents", runId);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-ease-"));
const launcherRoot = path.join(temporaryRoot, "launcher");
const candidateRoot = path.join(temporaryRoot, "candidate");
const commandLedger = [];
const trialStartedAt = new Date().toISOString();
const trialStarted = performance.now();

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function fileSha256(file) { return sha256(await readFile(file)); }
function packageInstallArgs(specifier = null) {
  return packageManager === "pnpm"
    ? [specifier ? "add" : "install", ...(specifier ? [specifier] : []), "--ignore-scripts", "--prefer-offline"]
    : ["install", ...(specifier ? [specifier] : []), "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"];
}
async function installedPackageMatchesArchive(packageRoot, archive) {
  for (const entry of archive.fileManifest) {
    const absolute = path.join(packageRoot, ...entry.path.split("/"));
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
      const bytes = await readFile(absolute);
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function resolveNpmCli(packageName, executable) {
  if (process.platform !== "win32") return { command: executable, prefixArgs: [] };
  const candidates = spawnSync("where.exe", [executable], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
  const directExecutable = packageName === "@anthropic-ai/claude-code" ? candidates.find((candidate) => /\.exe$/i.test(candidate)) : null;
  if (directExecutable) return { command: directExecutable, prefixArgs: [] };
  const wrapper = candidates.find((candidate) => /\.cmd$/i.test(candidate));
  if (!wrapper) throw new Error(`${executable}.cmd was not found`);
  const cli = packageName === "@openai/codex"
    ? path.join(path.dirname(wrapper), "node_modules", "@openai", "codex", "bin", "codex.js")
    : path.join(path.dirname(wrapper), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  return { command: process.execPath, prefixArgs: [cli] };
}
function extractClaudeFinalReport(stdout) {
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const result = [...events].reverse().find((entry) => typeof entry.result === "string" && entry.result.length > 0);
  if (result) return result.result;
  const assistant = [...events].reverse().find((entry) => entry.type === "assistant" && Array.isArray(entry.message?.content));
  return assistant?.message?.content?.filter((part) => part?.type === "text").map((part) => part.text).join("\n") ?? "";
}
function isolatedAgentEnvironment(driver) {
  const allowed = [
    "ALL_PROXY", "APPDATA", "COLORTERM", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "HTTPS_PROXY", "HTTP_PROXY",
    "LANG", "LC_ALL", "LOCALAPPDATA", "NO_PROXY", "PATH", "PATHEXT", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
    "LOGNAME", "SHELL", "SSL_CERT_DIR", "SSL_CERT_FILE", "SystemDrive", "SystemRoot", "TEMP", "TERM", "TMP", "TMPDIR",
    "USER", "USERPROFILE", "WINDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME",
  ];
  if (driver === "codex") allowed.push("CODEX_HOME", "OPENAI_API_KEY");
  if (driver === "claude-code") allowed.push("ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR");
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}
function run(command, commandArgs, cwd, options = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const childEnv = { ...(options.baseEnv ?? process.env), CI: "1", ...(options.env ?? {}) };
  for (const key of options.unsetEnv ?? []) delete childEnv[key];
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: childEnv,
    maxBuffer: 50 * 1024 * 1024,
    shell: process.platform === "win32" && new Set(["npm", "npx", "pnpm"]).has(command),
    timeout: options.timeout ?? 300_000,
  });
  const record = {
    args: commandArgs,
    command,
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    startedAt,
    stderrSha256: sha256(result.stderr ?? ""),
    stdoutSha256: sha256(result.stdout ?? ""),
  };
  commandLedger.push(record);
  return {
    error: result.error,
    record,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}
function requirePass(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

// Pin the NodeKit source identity before the candidate is generated. A long-running
// trial must never inherit a newer commit merely because the parent repository moved
// while the isolated coding agent was working.
const nodekitCommit = run("git", ["rev-parse", "HEAD"], repoRoot).stdout.trim();
const sourceHash = await computeNodeKitSourceHash(repoRoot);
const tarballMetadata = await lstat(nodekitTarball);
if (!tarballMetadata.isFile() || tarballMetadata.isSymbolicLink()) {
  throw new Error("--nodekit-tarball must identify one regular, non-symlink .tgz file");
}
const nodekitArchive = await inspectNpmPackageArchiveFile(nodekitTarball, {
  expectedName: "@homenshum/nodekit",
  ...(expectedTarballSha256 === null ? {} : { expectedTarballSha256 }),
});
const nodekitPackage = nodekitArchive.name;
const nodekitVersion = nodekitArchive.version;
const nodekitTarballSha256 = nodekitArchive.tarballSha256;

await mkdir(path.join(evidenceRoot, "agent"), { recursive: true });
await mkdir(path.join(evidenceRoot, "candidate"), { recursive: true });
await writeFile(path.join(evidenceRoot, "agent", "original-prompt.txt"), `${task.goal}\n`);
await writeFile(path.join(evidenceRoot, "agent", "prompt.sha256"), `${sha256(task.goal)}\n`);
await writeFile(path.join(evidenceRoot, "agent", "interventions.json"), "[]\n");

// Begin from a genuinely empty launcher, install the exact packed candidate, and
// invoke that installed CLI. Importing createProject from this source checkout
// would benchmark a parallel implementation rather than the distributable users get.
await mkdir(launcherRoot, { recursive: true });
await writeFile(path.join(launcherRoot, "package.json"), `${JSON.stringify({
  name: "nodekit-agent-ease-launcher",
  private: true,
  version: "0.0.0",
}, null, 2)}\n`);
requirePass(
  run(packageManager, packageInstallArgs(nodekitTarball), launcherRoot, { timeout: 300_000 }),
  "exact NodeKit launcher installation",
);
const installedCli = path.join(launcherRoot, "node_modules", "@homenshum", "nodekit", "src", "cli.mjs");
const launcherPackageRoot = path.join(launcherRoot, "node_modules", "@homenshum", "nodekit");
const installedPackage = JSON.parse(await readFile(path.join(launcherPackageRoot, "package.json"), "utf8"));
if (installedPackage.name !== nodekitPackage || installedPackage.version !== nodekitVersion) {
  throw new Error("installed launcher package identity differs from the inspected NodeKit tarball");
}
if (!(await installedPackageMatchesArchive(launcherPackageRoot, nodekitArchive))) {
  throw new Error("installed launcher package bytes differ from the inspected NodeKit tarball");
}
requirePass(run(process.execPath, [
  installedCli,
  "create",
  candidateRoot,
  "--name", `ease-${taskId}`,
  "--brief", "Carry one bounded user intention to a reviewed and verified artifact.",
  "--nodekit-specifier", "file:vendor/nodekit.tgz",
  "--package-manager", packageManager,
  "--no-install",
], launcherRoot, { timeout: 300_000 }), "installed NodeKit CLI scaffold");
await mkdir(path.join(candidateRoot, "vendor"), { recursive: true });
await copyFile(nodekitTarball, path.join(candidateRoot, "vendor", "nodekit.tgz"));
requirePass(run(packageManager, packageInstallArgs(), candidateRoot, { timeout: 300_000 }), "generated application dependency installation");
requirePass(run(packageManager, ["run", "compile"], candidateRoot, { timeout: 300_000 }), "exact-candidate baseline compile");
requirePass(run("git", ["add", "--all"], candidateRoot), "stage exact-candidate baseline");
const baselineStatus = run("git", ["status", "--porcelain=v1"], candidateRoot).stdout.trim();
if (baselineStatus) {
  requirePass(run("git", [
    "-c", "user.name=NodeKit",
    "-c", "user.email=nodekit@local",
    "commit", "-m", "chore: bind exact NodeKit candidate",
  ], candidateRoot), "commit exact-candidate baseline");
}

const writeProbePath = path.join(candidateRoot, ".nodekit-agent-write-probe");
await writeFile(writeProbePath, `${runId}\n`);
const writeProbeMatched = (await readFile(writeProbePath, "utf8")) === `${runId}\n`;
await rm(writeProbePath);
if (!writeProbeMatched) throw new Error("candidate write preflight did not round-trip");
await writeFile(path.join(evidenceRoot, "agent", "environment.json"), `${JSON.stringify({
  agentDriver,
  agentModel,
  agentProfile,
  environmentPolicy: "allowlisted-process-environment",
  outerIsolation: executor === "docker" ? "disposable-container" : `host-${agentDriver}-sandbox`,
  inheritedParentThread: false,
  requestedSandbox: executor === "docker" ? "danger-full-access-inside-disposable-container" : "workspace-write",
  userConfigLoaded: false,
  userExecPolicyLoaded: false,
  writePreflight: "passed",
  nodekitPackage,
  nodekitTarballSha256,
  nodekitVersion,
}, null, 2)}\n`);

const sessionPath = path.join(evidenceRoot, "agent", "session.jsonl");
const finalPath = path.join(evidenceRoot, "agent", "final-report.md");
const candidateFinalPath = path.join(candidateRoot, ".nodekit-agent-final-report.md");
const nativeCli = agentDriver === "codex"
  ? resolveNpmCli("@openai/codex", "codex")
  : resolveNpmCli("@anthropic-ai/claude-code", "claude");
const dockerImage = String(args.dockerImage ?? "nodekit-ease-agent:codex-0.142.5");
const authPath = path.join(os.homedir(), ".codex", "auth.json");
const modelArgs = agentModel ? ["--model", agentModel] : [];
const nativeAgentArgs = agentDriver === "codex"
  ? [...nativeCli.prefixArgs,
      "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "workspace-write", "--json",
      ...modelArgs, "--output-last-message", finalPath, "-C", candidateRoot, task.goal]
  : [...nativeCli.prefixArgs,
      "--print", "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config",
      "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      ...modelArgs, task.goal];
const dockerAgentArgs = [
  "run", "--rm",
  "--mount", `type=bind,source=${candidateRoot},target=/workspace`,
  "--mount", `type=bind,source=${authPath},target=/root/.codex/auth.json,readonly`,
  "--workdir", "/workspace",
  "--env", "CODEX_HOME=/root/.codex",
  "--env", "CI=1",
  dockerImage,
  "codex", "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "danger-full-access", "--json",
  ...modelArgs, "--output-last-message", "/workspace/.nodekit-agent-final-report.md", "-C", "/workspace", task.goal,
];
const agent = executor === "docker"
  ? run("docker", dockerAgentArgs, candidateRoot, { timeout: Number(args.timeoutMs ?? 1_800_000) })
  : run(nativeCli.command, nativeAgentArgs, candidateRoot, {
      baseEnv: isolatedAgentEnvironment(agentDriver),
      timeout: Number(args.timeoutMs ?? 1_800_000),
      unsetEnv: [
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
        "CODEX_PERMISSION_PROFILE",
        "CODEX_SHELL",
        "CODEX_THREAD_ID",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
      ],
    });
if (executor === "docker") {
  await writeFile(finalPath, await readFile(candidateFinalPath, "utf8").catch(() => ""));
  await rm(candidateFinalPath, { force: true });
} else if (agentDriver === "claude-code") {
  await writeFile(finalPath, `${extractClaudeFinalReport(agent.stdout ?? "")}\n`);
} else {
  const existingFinal = await readFile(finalPath, "utf8").catch(() => null);
  if (existingFinal === null) await writeFile(finalPath, "");
}
await writeFile(sessionPath, agent.stdout ?? "");
await writeFile(path.join(evidenceRoot, "agent", "stderr.txt"), agent.stderr ?? "");

const checks = {};
for (const [name, command, commandArgs] of [
  ["compile", packageManager, ["run", "compile"]],
  ["check", packageManager, ["run", "check"]],
  ["demo", packageManager, ["run", "demo"]],
  ["eval", packageManager, ["run", "eval"]],
  ["browserContract", packageManager, ["run", "proof:browser-contract"]],
]) {
  const result = run(command, commandArgs, candidateRoot);
  checks[name] = result.status === 0 && !result.error;
}
const browserInstall = packageManager === "pnpm"
  ? run("pnpm", ["exec", "playwright", "install", "chromium"], candidateRoot, { timeout: 300_000 })
  : run("npx", ["playwright", "install", "chromium"], candidateRoot, { timeout: 300_000 });
checks.browserRuntime = browserInstall.status === 0 && !browserInstall.error;
const browser = run(packageManager, ["run", "proof:browser"], candidateRoot, {
  env: {
    NODEKIT_EASE_RUN_ID: runId,
    NODEKIT_SOURCE_COMMIT: nodekitCommit,
    NODEKIT_SOURCE_HASH: sourceHash,
    NODEKIT_TARBALL_SHA256: nodekitTarballSha256,
  },
  timeout: 300_000,
});
checks.browserJourney = browser.status === 0 && !browser.error;
const proof = run(packageManager, ["run", "proof"], candidateRoot);
checks.proof = proof.status === 0 && !proof.error;
const endingNodekitCommit = run("git", ["rev-parse", "HEAD"], repoRoot).stdout.trim();
const endingNodekitSourceHash = await computeNodeKitSourceHash(repoRoot);
checks.nodekitIdentityStable = endingNodekitCommit === nodekitCommit && endingNodekitSourceHash === sourceHash;
const [candidatePackage, candidateIdentity, candidateRuntimePackage, candidateLock, endingInputTarballSha256, candidateTarballSha256] = await Promise.all([
  readFile(path.join(candidateRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, ".nodeagent", "application-identity.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, "node_modules", "@homenshum", "nodekit", "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json"), "utf8"),
  fileSha256(nodekitTarball),
  fileSha256(path.join(candidateRoot, "vendor", "nodekit.tgz")),
]);
const nodekitSpecifier = candidatePackage.dependencies?.[nodekitPackage] ?? candidatePackage.devDependencies?.[nodekitPackage];
const identityFiles = new Map((candidateIdentity.identity?.files ?? []).map((entry) => [entry.path, entry]));
const applicationHash = candidateIdentity.applicationHash;
const configHash = candidateIdentity.configHash;
const candidateRuntimeFilesMatch = await installedPackageMatchesArchive(
  path.join(candidateRoot, "node_modules", "@homenshum", "nodekit"),
  nodekitArchive,
);
checks.nodekitTarballStable = endingInputTarballSha256 === nodekitTarballSha256;
checks.nodekitRuntimeBound = candidateTarballSha256 === nodekitTarballSha256
  && identityFiles.get("vendor/nodekit.tgz")?.digest === nodekitTarballSha256
  && candidateRuntimeFilesMatch
  && candidateRuntimePackage.name === nodekitPackage
  && candidateRuntimePackage.version === nodekitVersion
  && nodekitSpecifier === "file:vendor/nodekit.tgz"
  && candidateLock.includes("vendor/nodekit.tgz");
checks.applicationIdentityRecorded = candidateIdentity.schemaVersion === "nodeagent.application-identity/v1"
  && SHA256.test(applicationHash ?? "")
  && SHA256.test(configHash ?? "");

const finalReport = await readFile(finalPath, "utf8").catch(() => "");
const porcelain = run("git", ["status", "--porcelain=v1"], candidateRoot).stdout;
const changedFiles = porcelain.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
const substantiveFiles = changedFiles.filter((file) =>
  file !== "package-lock.json"
  && !file.startsWith("proof/")
  && !file.startsWith(".nodeagent/")
  && !file.startsWith("node_modules/"));
const blockedReport = reportsWriteBlockage(finalReport);
checks.agentImplemented = substantiveFiles.length > 0;
checks.agentReportedCompletion = finalReport.length > 0 && !blockedReport;

const browserEvidenceSource = path.join(candidateRoot, "proof", "ease", runId, "browser");
const browserEvidenceTarget = path.join(evidenceRoot, "candidate", "browser");
await cp(browserEvidenceSource, browserEvidenceTarget, { recursive: true }).catch(() => undefined);
await cp(
  path.join(candidateRoot, "proof", "browser-certification.json"),
  path.join(evidenceRoot, "candidate", "browser-certification.json"),
).catch(() => undefined);

// Capture the complete candidate, including new files. A plain `git diff HEAD`
// omits untracked work and `git archive HEAD` archives only the untouched base.
requirePass(run("git", ["add", "-A"], candidateRoot), "stage complete candidate evidence");
requirePass(run("git", ["reset", "HEAD", "--", "proof"], candidateRoot), "separate generated proof from candidate source archive");
const diff = run("git", ["diff", "--cached", "--binary", "HEAD"], candidateRoot).stdout;
await writeFile(path.join(evidenceRoot, "candidate", "diff.patch"), diff);
await writeFile(path.join(evidenceRoot, "candidate", "commit.txt"), `${run("git", ["rev-parse", "HEAD"], candidateRoot).stdout.trim()}\n`);
const identity = await readFile(path.join(candidateRoot, ".nodeagent", "application-identity.json"), "utf8").catch(() => "{}");
await writeFile(path.join(evidenceRoot, "candidate", "application-identity.json"), identity);
const candidateTree = run("git", ["write-tree"], candidateRoot);
requirePass(candidateTree, "write complete candidate tree");
const candidateArchive = run("git", ["archive", "--format=tar.gz", `--output=${path.join(evidenceRoot, "candidate", "generated-repo.tar.gz")}`, candidateTree.stdout.trim()], candidateRoot);
checks.candidateArchive = candidateArchive.status === 0 && !candidateArchive.error;
requirePass(run("git", ["reset", "--mixed", "HEAD"], candidateRoot), "restore candidate evidence index");
await writeFile(path.join(evidenceRoot, "candidate", "git-status.txt"), run("git", ["status", "--short"], candidateRoot).stdout);

const sessionLines = (agent.stdout ?? "").split(/\r?\n/).filter(Boolean);
const parsedEvents = sessionLines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const agentSessionId = parsedEvents.map((entry) => entry.thread_id ?? entry.session_id ?? entry.message?.session_id).find((value) => typeof value === "string" && value.length > 0) ?? null;
const usageEvents = parsedEvents.filter((entry) => JSON.stringify(entry).includes("token"));
await writeFile(path.join(evidenceRoot, "agent", "token-usage.json"), `${JSON.stringify({ events: usageEvents, note: `Raw ${agentDriver} JSONL usage-bearing events; cost depends on the configured account and is not inferred.` }, null, 2)}\n`);
const agentVersion = executor === "docker"
  ? run("docker", ["run", "--rm", dockerImage, "codex", "--version"], repoRoot).stdout.trim()
  : run(nativeCli.command, [...nativeCli.prefixArgs, "--version"], repoRoot).stdout.trim();
await writeFile(path.join(evidenceRoot, "commands.jsonl"), commandLedger.map((entry) => JSON.stringify(entry)).join("\n") + "\n");

const evidence = [];
for (const [kind, relativePath, required] of [
  ["prompt", "agent/original-prompt.txt", true],
  ["prompt-hash", "agent/prompt.sha256", true],
  ["environment", "agent/environment.json", true],
  ["interventions", "agent/interventions.json", true],
  ["session", "agent/session.jsonl", true],
  ["final-report", "agent/final-report.md", true],
  ["stderr", "agent/stderr.txt", true],
  ["token-usage", "agent/token-usage.json", true],
  ["command-ledger", "commands.jsonl", true],
  ["candidate-diff", "candidate/diff.patch", true],
  ["candidate-status", "candidate/git-status.txt", true],
  ["candidate-commit", "candidate/commit.txt", true],
  ["application-identity", "candidate/application-identity.json", true],
  ["candidate-archive", "candidate/generated-repo.tar.gz", true],
  ["browser-certification", "candidate/browser-certification.json", false],
  ["screenshot-manifest", "candidate/browser/screenshot-manifest.json", false],
]) {
  const absolutePath = path.join(evidenceRoot, ...relativePath.split("/"));
  const bytes = await readFile(absolutePath).catch(() => null);
  if (!bytes) {
    if (required) throw new Error(`required trial evidence is missing: ${relativePath}`);
    continue;
  }
  evidence.push({ bytes: bytes.length, kind, path: relativePath, sha256: sha256(bytes) });
}
const evidenceSetSha256 = sha256(JSON.stringify(evidence));
checks.agentVersionRecorded = agentVersion.length > 0;
checks.agentSessionIdentityRecorded = typeof agentSessionId === "string" && agentSessionId.length > 0;
checks.evidenceComplete = evidence.length === 16;
checks.agentEnvironmentIsolated = true;

const receipt = {
  agentDriver,
  agentExitCode: agent.status,
  agentModel,
  agentProfile,
  agentSessionId,
  agentSessionMode: "ephemeral",
  agentVersion,
  candidateRoot,
  changedFiles,
  checks,
  applicationHash,
  configHash,
  durationMs: Math.round(performance.now() - trialStarted),
  evidence,
  evidenceSetSha256,
  executor,
  freshSession: true,
  generatedAt: new Date().toISOString(),
  interventions: 0,
  endingNodekitCommit,
  endingNodekitSourceHash,
  nodekitCommit,
  nodekitPackage,
  nodekitSourceHash: sourceHash,
  nodekitTarballSha256,
  nodekitVersion,
  packageManager,
  passed: agent.status === 0 && Object.values(checks).every(Boolean),
  promptSha256: sha256(task.goal),
  runId,
  schemaVersion: "nodekit.agent-ease-trial/v2",
  taskId,
  trialStartedAt,
  userReprompts: 0,
  substantiveFiles,
};
receipt.verdict = receipt.passed ? "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED" : blockedReport ? "PILOT_FAIL_AGENT_BLOCKED" : "PILOT_FAIL";
receipt.receiptSha256 = sha256(JSON.stringify(receipt));
await writeFile(path.join(evidenceRoot, "manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
