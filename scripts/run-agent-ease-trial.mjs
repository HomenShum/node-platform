import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { inspectNpmPackageArchiveFile } from "../src/lib/npm-package-archive.mjs";
import { createImmutablePackageSnapshot, installedPackageExactlyMatchesArchive, packageArchivesMatch } from "../src/lib/immutable-package-snapshot.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { reportsWriteBlockage } from "../src/lib/agent-ease-report.mjs";
import { validateProtectedBrowserEvidence } from "../src/lib/protected-browser-evidence.mjs";
import { validateSubmissionScreenshotPng } from "../src/lib/submission-gate.mjs";
import {
  parseAgentEaseCliArgs,
  validateProtectedAgentEvaluation,
  validateVisualReviewInventory,
} from "../src/lib/agent-ease-campaign.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(`Run one protected fresh-agent trial. Prefer the campaign orchestrator:
  npm run ease:run-agent-matrix -- --help

This low-level command requires exact candidate, source, tarball, task-set, task-brief,
trial-runner, and protected-evaluator paths plus SHA-256 bindings. It writes only into a new
evidence root and cannot issue external attestations or human-usability claims.`);
  process.exit(0);
}
const args = parseAgentEaseCliArgs(process.argv.slice(2), {
  allowed: [
    "agent-container-image", "agent-container-image-id", "agentContainerImage", "agentContainerImageId",
    "agentDriver", "agentModel", "agentProfile", "bootstrap-mode", "bootstrapMode", "candidate", "dockerImage", "evidence-root", "evidenceRoot",
    "executor", "nodekit-tarball", "nodekit-tarball-sha256", "nodekitTarball", "nodekitTarballSha256",
    "packageManager", "run", "source-hash", "sourceHash", "task", "task-brief-file", "task-brief-sha256",
    "task-set-file", "task-set-sha256", "taskBriefFile", "taskBriefSha256", "taskSetFile", "taskSetSha256",
    "timeoutMs", "trial-runner-sha256", "trialRunnerSha256", "protected-evaluator-file", "protected-evaluator-sha256",
    "protectedEvaluatorFile", "protectedEvaluatorSha256",
    "protected-browser-lane-file", "protected-browser-lane-sha256", "protectedBrowserLaneFile", "protectedBrowserLaneSha256",
    "provider-broker-file", "provider-broker-sha256", "providerBrokerFile", "providerBrokerSha256",
    "protected-container-image", "protected-container-image-id", "protectedContainerImage", "protectedContainerImageId",
  ],
});
function aliasedArgument(keys, label) {
  const present = keys.filter((key) => Object.hasOwn(args, key));
  if (present.length > 1) throw new Error(`${label} was supplied through multiple aliases: ${present.map((key) => `--${key}`).join(", ")}`);
  return present.length === 1 ? args[present[0]] : undefined;
}
const taskId = String(args.task ?? "volunteer-onboarding");
const taskBriefArgument = aliasedArgument(["taskBriefFile", "task-brief-file"], "task brief file");
const taskBriefSha256 = String(aliasedArgument(["taskBriefSha256", "task-brief-sha256"], "task brief hash") ?? "").toLowerCase();
const taskSetArgument = aliasedArgument(["taskSetFile", "task-set-file"], "task set file");
const taskSetSha256 = String(aliasedArgument(["taskSetSha256", "task-set-sha256"], "task set hash") ?? "").toLowerCase();
const expectedTrialRunnerSha256 = String(aliasedArgument(["trialRunnerSha256", "trial-runner-sha256"], "trial runner hash") ?? "").toLowerCase();
const protectedEvaluatorArgument = aliasedArgument(["protectedEvaluatorFile", "protected-evaluator-file"], "protected evaluator file");
const expectedProtectedEvaluatorSha256 = String(aliasedArgument(["protectedEvaluatorSha256", "protected-evaluator-sha256"], "protected evaluator hash") ?? "").toLowerCase();
const protectedBrowserLaneArgument = aliasedArgument(["protectedBrowserLaneFile", "protected-browser-lane-file"], "protected browser lane file");
const expectedProtectedBrowserLaneSha256 = String(aliasedArgument(["protectedBrowserLaneSha256", "protected-browser-lane-sha256"], "protected browser lane hash") ?? "").toLowerCase();
const providerBrokerArgument = aliasedArgument(["providerBrokerFile", "provider-broker-file"], "provider broker file");
const expectedProviderBrokerSha256 = String(aliasedArgument(["providerBrokerSha256", "provider-broker-sha256"], "provider broker hash") ?? "").toLowerCase();
const protectedContainerImage = String(aliasedArgument(["protectedContainerImage", "protected-container-image"], "protected container image") ?? "");
const protectedContainerImageId = String(aliasedArgument(["protectedContainerImageId", "protected-container-image-id"], "protected container image ID") ?? "").toLowerCase();
const agentContainerImage = String(aliasedArgument(["agentContainerImage", "agent-container-image", "dockerImage"], "agent container image") ?? "");
const agentContainerImageId = String(aliasedArgument(["agentContainerImageId", "agent-container-image-id"], "agent container image ID") ?? "").toLowerCase();
const expectedCandidateCommit = String(args.candidate ?? "").toLowerCase();
const expectedCandidateSourceHash = String(aliasedArgument(["sourceHash", "source-hash"], "source hash") ?? "").toLowerCase();
if (typeof taskBriefArgument !== "string" || taskBriefArgument.trim().length === 0) {
  throw new Error("--task-brief-file=<immutable-task.txt> is required");
}
if (typeof taskSetArgument !== "string" || taskSetArgument.trim().length === 0) {
  throw new Error("--task-set-file=<immutable-task-set.json> is required");
}
if (!SHA256.test(taskBriefSha256)) throw new Error("--task-brief-sha256 must be a lowercase SHA-256 digest");
if (!SHA256.test(taskSetSha256)) throw new Error("--task-set-sha256 must be a lowercase SHA-256 digest");
if (!SHA256.test(expectedTrialRunnerSha256)) throw new Error("--trial-runner-sha256 must be a lowercase SHA-256 digest");
if (typeof protectedEvaluatorArgument !== "string" || protectedEvaluatorArgument.trim().length === 0) {
  throw new Error("--protected-evaluator-file=<external-evaluator.mjs> is required");
}
if (!SHA256.test(expectedProtectedEvaluatorSha256)) throw new Error("--protected-evaluator-sha256 must be a lowercase SHA-256 digest");
if (typeof protectedBrowserLaneArgument !== "string" || protectedBrowserLaneArgument.trim().length === 0) {
  throw new Error("--protected-browser-lane-file=<external-browser-runner.mjs> is required");
}
if (!SHA256.test(expectedProtectedBrowserLaneSha256)) throw new Error("--protected-browser-lane-sha256 must be a lowercase SHA-256 digest");
if (typeof providerBrokerArgument !== "string" || providerBrokerArgument.trim().length === 0) {
  throw new Error("--provider-broker-file=<protected-provider-broker.mjs> is required");
}
if (!SHA256.test(expectedProviderBrokerSha256)) throw new Error("--provider-broker-sha256 must be a lowercase SHA-256 digest");
if (protectedContainerImage.length === 0) throw new Error("--protected-container-image=<reference> is required");
if (!/^sha256:[a-f0-9]{64}$/.test(protectedContainerImageId)) throw new Error("--protected-container-image-id must be an exact Docker image ID");
if (agentContainerImage.length === 0) throw new Error("--agent-container-image=<reference> is required");
if (!/^sha256:[a-f0-9]{64}$/.test(agentContainerImageId)) throw new Error("--agent-container-image-id must be an exact Docker image ID");
if (!/^[a-f0-9]{40}$/.test(expectedCandidateCommit)) throw new Error("--candidate must be a lowercase 40-character commit");
if (!SHA256.test(expectedCandidateSourceHash)) throw new Error("--source-hash must be a lowercase SHA-256 digest");
const taskBriefFile = path.resolve(taskBriefArgument);
const taskSetFile = path.resolve(taskSetArgument);
const trialRunnerFile = fileURLToPath(import.meta.url);
const protectedEvaluatorFile = path.resolve(protectedEvaluatorArgument);
const protectedBrowserLaneFile = path.resolve(protectedBrowserLaneArgument);
const providerBrokerFile = path.resolve(providerBrokerArgument);
for (const [label, file] of [["task brief", taskBriefFile], ["task set", taskSetFile], ["trial runner", trialRunnerFile], ["protected evaluator", protectedEvaluatorFile], ["protected browser lane", protectedBrowserLaneFile], ["provider broker", providerBrokerFile]]) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic-link file`);
}
const [taskBriefBytes, taskSetBytes, trialRunnerBytes, protectedEvaluatorBytes, protectedBrowserLaneBytes, providerBrokerBytes] = await Promise.all([
  readFile(taskBriefFile),
  readFile(taskSetFile),
  readFile(trialRunnerFile),
  readFile(protectedEvaluatorFile),
  readFile(protectedBrowserLaneFile),
  readFile(providerBrokerFile),
]);
if (sha256(taskBriefBytes) !== taskBriefSha256) throw new Error("immutable task brief hash mismatch");
if (sha256(taskSetBytes) !== taskSetSha256) throw new Error("immutable task set hash mismatch");
if (sha256(trialRunnerBytes) !== expectedTrialRunnerSha256) throw new Error("trial runner hash mismatch");
if (sha256(protectedEvaluatorBytes) !== expectedProtectedEvaluatorSha256) throw new Error("protected evaluator hash mismatch");
if (sha256(protectedBrowserLaneBytes) !== expectedProtectedBrowserLaneSha256) throw new Error("protected browser lane hash mismatch");
if (sha256(providerBrokerBytes) !== expectedProviderBrokerSha256) throw new Error("protected provider broker hash mismatch");
const taskGoal = new TextDecoder("utf-8", { fatal: true }).decode(taskBriefBytes);
if (taskGoal.trim().length === 0 || taskGoal !== taskGoal.trim()) {
  throw new Error("immutable task brief must be non-empty canonical text without surrounding whitespace");
}
const taskSet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(taskSetBytes));
const taskFromSet = taskSet?.schemaVersion === "nodekit.agent-ease-tasks/v1"
  && Array.isArray(taskSet.tasks)
  ? taskSet.tasks.find((entry) => entry?.id === taskId)
  : null;
if (!taskFromSet || taskFromSet.goal !== taskGoal) {
  throw new Error(`immutable task brief ${taskId} does not match the bound held-out task set`);
}
const task = Object.freeze({ goal: taskGoal, id: taskId });
const requestedProfile = String(args.agentProfile ?? process.env.NODEKIT_AGENT_PROFILE ?? "codex");
const runId = String(args.run ?? `agent_${requestedProfile}_${taskId}_${randomUUID().replaceAll("-", "").slice(0, 12)}`);
const packageManager = String(args.packageManager ?? "npm");
const nodekitTarballArgument = aliasedArgument(["nodekitTarball", "nodekit-tarball"], "NodeKit tarball");
if (typeof nodekitTarballArgument !== "string" || nodekitTarballArgument.trim().length === 0) {
  throw new Error("--nodekit-tarball=<exact-candidate.tgz> is required");
}
const nodekitTarball = path.resolve(nodekitTarballArgument);
const expectedTarballSha256 = String(
  aliasedArgument(["nodekitTarballSha256", "nodekit-tarball-sha256"], "NodeKit tarball hash")
    ?? process.env.NODEKIT_TARBALL_SHA256
    ?? "",
).toLowerCase() || null;
if (expectedTarballSha256 !== null && !SHA256.test(expectedTarballSha256)) {
  throw new Error("--nodekit-tarball-sha256 must be a lowercase SHA-256 digest");
}
const executor = String(args.executor ?? "docker");
const agentProfile = requestedProfile;
const agentDriver = String(args.agentDriver ?? process.env.NODEKIT_AGENT_DRIVER ?? (agentProfile === "claude-code" ? "claude-code" : "codex"));
const agentModel = String(args.agentModel ?? process.env.NODEKIT_AGENT_MODEL ?? "").trim() || null;
const bootstrapMode = String(aliasedArgument(["bootstrapMode", "bootstrap-mode"], "bootstrap mode") ?? "pre-scaffolded-packed-cli");
if (executor !== "docker") throw new Error("qualifying fresh-agent trials require the Docker executor; native host execution is not certifiable");
if (packageManager !== "npm") {
  throw new Error("qualifying fresh-agent campaigns require npm; pnpm remains covered by the separate developer-timing matrix");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error("run id must be one path-safe segment");
if (!new Set(["codex", "claude-code", "lower-cost"]).has(agentProfile)) throw new Error(`unsupported agent profile ${agentProfile}`);
if (!new Set(["codex", "claude-code"]).has(agentDriver)) throw new Error(`unsupported agent driver ${agentDriver}`);
if (!new Set(["pre-scaffolded-packed-cli", "agent-process-packed-cli-from-empty"]).has(bootstrapMode)) throw new Error(`unsupported bootstrap mode ${bootstrapMode}`);
if (bootstrapMode === "agent-process-packed-cli-from-empty" && packageManager !== "npm") throw new Error("protected empty-directory agent bootstrap currently requires npm");
if (agentProfile === "codex" && agentDriver !== "codex") throw new Error("codex profile must use the codex driver");
if (agentProfile === "claude-code" && agentDriver !== "claude-code") throw new Error("claude-code profile must use the claude-code driver");
if (!agentModel) throw new Error("every live brokered profile requires --agentModel=<explicit-model-id>");
const evidenceParentArgument = aliasedArgument(["evidenceRoot", "evidence-root"], "evidence root");
const evidenceParent = path.resolve(typeof evidenceParentArgument === "string" && evidenceParentArgument.trim().length > 0
  ? evidenceParentArgument
  : path.join(repoRoot, "proof", "ease", "agents"));
const evidenceRoot = path.join(evidenceParent, runId);
const evidenceContainment = path.relative(evidenceParent, evidenceRoot);
if (evidenceContainment.startsWith(`..${path.sep}`) || evidenceContainment === ".." || path.isAbsolute(evidenceContainment)) {
  throw new Error("run evidence path escaped its evidence root");
}
const existingEvidence = await readdir(evidenceRoot).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
if (existingEvidence.length > 0) {
  throw new Error(`trial evidence root must be new and empty: ${evidenceRoot}`);
}
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-ease-"));
const launcherRoot = path.join(temporaryRoot, "launcher");
const candidateRoot = path.join(temporaryRoot, "candidate");
const referenceRoot = path.join(temporaryRoot, "reference");
const npmCacheRoot = path.join(temporaryRoot, "npm-cache");
const cacheWarmRoot = path.join(temporaryRoot, "cache-warm");
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
function extractClaudeFinalReport(stdout) {
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const result = [...events].reverse().find((entry) => typeof entry.result === "string" && entry.result.length > 0);
  if (result) return result.result;
  const assistant = [...events].reverse().find((entry) => entry.type === "assistant" && Array.isArray(entry.message?.content));
  return assistant?.message?.content?.filter((part) => part?.type === "text").map((part) => part.text).join("\n") ?? "";
}
function candidateToolEnvironment() {
  const allowed = [
    "APPDATA", "COLORTERM", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL", "LOCALAPPDATA",
    "PATH", "PATHEXT", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "SHELL", "SystemDrive", "SystemRoot",
    "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERPROFILE", "WINDIR",
  ];
  return Object.fromEntries(allowed.filter((key) => typeof process.env[key] === "string").map((key) => [key, process.env[key]]));
}
function sanitizedEvidenceText(value) {
  let output = String(value ?? "");
  const secretValues = Object.entries(process.env)
    .filter(([key, entry]) => /(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(key) && typeof entry === "string" && entry.length >= 8)
    .map(([, entry]) => entry)
    .sort((left, right) => right.length - left.length);
  for (const secret of secretValues) output = output.replaceAll(secret, "[REDACTED]");
  output = output
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, "[REDACTED_JWT]");
  return output;
}
function codingAgentCommandEvents(stdout) {
  const commands = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if ((value.type === "command_execution" || value.type === "tool_use" || value.type === "command")
      && typeof value.command === "string" && value.command.trim().length > 0) {
      commands.push(value.command.trim());
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  for (const line of String(stdout ?? "").split(/\r?\n/).filter(Boolean)) {
    try { visit(JSON.parse(line)); } catch { /* Non-JSON diagnostics are preserved but do not prove tool use. */ }
  }
  return commands;
}
function exactAgentScaffoldCommand(id) {
  return `node /protected/nodekit-package/src/cli.mjs create /workspace --name ease-${id} --brief 'Carry one bounded user intention to a reviewed and verified artifact.' --nodekit-specifier file:vendor/nodekit.tgz --package-manager npm --no-install`;
}
function verifyAgentInitiatedBootstrap(stdout) {
  const commands = codingAgentCommandEvents(stdout);
  const requiredScaffold = exactAgentScaffoldCommand(taskId);
  return {
    commandCount: commands.length,
    firstMutatingCommandSha256: commands.length > 0 ? sha256(commands[0]) : null,
    passed: commands.length > 0 && commands[0] === requiredScaffold,
    scaffoldCommandSha256: commands.length > 0 && commands[0] === requiredScaffold ? sha256(commands[0]) : null,
  };
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
async function directoryIsEmpty(directory) {
  return (await readdir(directory).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error))).length === 0;
}
function runCandidateCommand(commandArgs, options = {}) {
  const environmentArgs = Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return run("docker", [
    "run", "--rm", "--network", "none",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "512", "--memory", "2g", "--cpus", "2", "--shm-size", "1g",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
    "--mount", `type=bind,source=${candidateRoot},target=/workspace`,
    "--workdir", "/workspace",
    "--env", "CI=1", "--env", "HOME=/tmp", "--env", "NO_COLOR=1",
    "--env", "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
    ...environmentArgs,
    protectedContainerImageId,
    ...commandArgs,
  ], repoRoot, { baseEnv: candidateToolEnvironment(), timeout: options.timeout ?? 300_000 });
}

function runCandidateScript(script, options = {}) {
  return runCandidateCommand(["npm", "run", script], options);
}

function readScopedProviderCredential() {
  const provider = agentDriver === "codex" ? "openai" : "anthropic";
  const prefix = agentDriver === "codex" ? "NODEKIT_CODEX" : "NODEKIT_CLAUDE";
  const value = process.env[`${prefix}_SCOPED_API_KEY`];
  const expiresAt = process.env[`${prefix}_CREDENTIAL_EXPIRES_AT`];
  const scope = process.env[`${prefix}_CREDENTIAL_SCOPE`];
  const expectedScope = agentDriver === "codex" ? "responses:write" : "messages:write";
  if (typeof value !== "string" || value.length < 20) {
    throw new Error(`${prefix}_SCOPED_API_KEY is required; raw CLI login files and long-lived host credentials are not certifiable`);
  }
  const expiresAtMs = Date.parse(expiresAt ?? "");
  const remainingMs = expiresAtMs - Date.now();
  if (!Number.isFinite(expiresAtMs) || remainingMs < 5 * 60_000 || remainingMs > 24 * 60 * 60_000) {
    throw new Error(`${prefix}_CREDENTIAL_EXPIRES_AT must be 5 minutes to 24 hours in the future`);
  }
  if (scope !== expectedScope) throw new Error(`${prefix}_CREDENTIAL_SCOPE must be exactly ${expectedScope}`);
  return Object.freeze({
    expiresAt: new Date(expiresAtMs).toISOString(),
    fingerprintSha256: sha256(value),
    provider,
    scope,
    value,
  });
}

async function runIsolatedCodingAgent(commandArgs, instructionPolicy, agentBootstrap) {
  const credential = readScopedProviderCredential();
  const suffix = sha256(`${runId}:${randomUUID()}`).slice(0, 16);
  const containerName = `nodekit-agent-${suffix}`;
  const brokerName = `nodekit-provider-broker-${suffix}`;
  const networkName = `nodekit-agent-net-${suffix}`;
  const providerEnvironment = agentDriver === "codex"
    ? { CODEX_HOME: "/tmp/nodekit-home/.codex", OPENAI_API_KEY: "broker-managed", OPENAI_BASE_URL: "http://provider-broker:8080/v1" }
    : { ANTHROPIC_API_KEY: "broker-managed", ANTHROPIC_BASE_URL: "http://provider-broker:8080", CLAUDE_CONFIG_DIR: "/tmp/nodekit-home/.claude" };
  const protectedBootstrapMounts = agentBootstrap.mode === "agent-process-packed-cli-from-empty"
    ? [
        [launcherPackageRoot, "/protected/nodekit-package"],
        [nodekitSnapshot, "/protected/nodekit.tgz"],
        [npmCacheRoot, "/protected/npm-cache"],
        [path.join(instructionRoot, "AGENTS.md"), "/AGENTS.md"],
        [path.join(instructionRoot, "CLAUDE.md"), "/CLAUDE.md"],
      ]
    : [];
  const effectiveCommandArgs = commandArgs;
  const networkCreated = run("docker", ["network", "create", "--driver", "bridge", "--internal", networkName], repoRoot, {
    baseEnv: candidateToolEnvironment(), timeout: 30_000,
  });
  requirePass(networkCreated, "create coding-agent internal network");
  const networkId = networkCreated.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(networkId)) throw new Error("coding-agent network ID is invalid");
  const brokerCreateArgs = [
    "create", "--name", brokerName,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
    "--mount", `type=bind,source=${providerBrokerFile},target=/trusted/run-agent-provider-broker.mjs,readonly`,
    "--env", "NODEKIT_BROKER_API_KEY",
    "--env", `NODEKIT_BROKER_EXPIRES_AT=${credential.expiresAt}`,
    "--env", `NODEKIT_BROKER_PROVIDER=${credential.provider}`,
    "--env", `NODEKIT_BROKER_ALLOWED_MODEL=${agentModel}`,
    "--env", "NODEKIT_BROKER_MAX_REQUESTS=128",
    agentContainerImageId,
    "node", "/trusted/run-agent-provider-broker.mjs",
  ];
  const createArgs = [
    "create", "--name", containerName,
    "--network", networkName,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "512", "--memory", "4g", "--cpus", "2", "--shm-size", "1g",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=1g",
    "--mount", `type=bind,source=${candidateRoot},target=/workspace`,
    ...protectedBootstrapMounts.flatMap(([source, destination]) => ["--mount", `type=bind,source=${source},target=${destination},readonly`]),
    "--workdir", "/workspace",
    "--env", "CI=1", "--env", "HOME=/tmp/nodekit-home", "--env", "NO_COLOR=1",
    ...Object.entries(providerEnvironment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    agentContainerImageId,
    ...effectiveCommandArgs,
  ];
  let containerCreated = false;
  let brokerCreated = false;
  try {
    const brokerCreatedResult = run("docker", brokerCreateArgs, repoRoot, {
      baseEnv: { ...candidateToolEnvironment(), NODEKIT_BROKER_API_KEY: credential.value }, timeout: 60_000,
    });
    requirePass(brokerCreatedResult, "create protected provider broker");
    brokerCreated = true;
    const brokerId = brokerCreatedResult.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(brokerId)) throw new Error("provider broker container ID is invalid");
    requirePass(run("docker", ["network", "connect", "--alias", "provider-broker", networkName, brokerName], repoRoot, {
      baseEnv: candidateToolEnvironment(), timeout: 30_000,
    }), "connect protected provider broker");
    requirePass(run("docker", ["start", brokerName], repoRoot, { baseEnv: candidateToolEnvironment(), timeout: 30_000 }), "start protected provider broker");
    requirePass(run("docker", ["exec", brokerName, "node", "-e", "let n=0;const check=()=>fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)throw new Error('not ready')}).catch(()=>{if(++n>=50)process.exit(1);setTimeout(check,100)});check()"], repoRoot, {
      baseEnv: candidateToolEnvironment(), timeout: 30_000,
    }), "health-check protected provider broker");
    const created = run("docker", createArgs, repoRoot, { baseEnv: candidateToolEnvironment(), timeout: 60_000 });
    requirePass(created, "create isolated coding-agent container");
    containerCreated = true;
    const containerId = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("isolated coding-agent container ID is invalid");
    if (agentBootstrap.mode === "agent-process-packed-cli-from-empty" && !(await directoryIsEmpty(candidateRoot))) {
      throw new Error("coding-agent workspace was not empty at the instant its agent container was ready to start");
    }
    const inspected = run("docker", ["container", "inspect", containerName, brokerName], repoRoot, {
      baseEnv: candidateToolEnvironment(),
      timeout: 30_000,
    });
    requirePass(inspected, "inspect isolated coding-agent container");
    const records = JSON.parse(inspected.stdout);
    const record = records?.find((entry) => entry?.Id === containerId);
    const brokerRecord = records?.find((entry) => entry?.Id === brokerId);
    const mounts = Array.isArray(record?.Mounts) ? record.Mounts : [];
    const brokerMounts = Array.isArray(brokerRecord?.Mounts) ? brokerRecord.Mounts : [];
    const host = record?.HostConfig ?? {};
    const brokerHost = brokerRecord?.HostConfig ?? {};
    const candidateMount = mounts.find((entry) => entry.Destination === "/workspace");
    const expectedMountDestinations = ["/workspace", ...protectedBootstrapMounts.map(([, destination]) => destination)].sort();
    const networkInspection = run("docker", ["network", "inspect", networkName], repoRoot, {
      baseEnv: candidateToolEnvironment(), timeout: 30_000,
    });
    requirePass(networkInspection, "inspect coding-agent internal network");
    const networkRecord = JSON.parse(networkInspection.stdout)?.[0];
    const attachedIds = Object.keys(networkRecord?.Containers ?? {}).sort();
    const checks = {
      brokerExactImageBound: brokerRecord?.Image === agentContainerImageId,
      brokerCredentialExpiryBound: Array.isArray(brokerRecord?.Config?.Env)
        && brokerRecord.Config.Env.includes(`NODEKIT_BROKER_EXPIRES_AT=${credential.expiresAt}`),
      brokerModelBound: Array.isArray(brokerRecord?.Config?.Env)
        && brokerRecord.Config.Env.includes(`NODEKIT_BROKER_ALLOWED_MODEL=${agentModel}`),
      brokerNoPublishedPorts: Object.keys(brokerHost.PortBindings ?? {}).length === 0,
      brokerRunnerBound: brokerMounts.length === 1
        && brokerMounts[0]?.Destination === "/trusted/run-agent-provider-broker.mjs"
        && brokerMounts[0]?.RW === false,
      capabilitiesDropped: Array.isArray(host.CapDrop) && host.CapDrop.some((entry) => String(entry).toUpperCase() === "ALL"),
      bootstrapContractBound: agentBootstrap.bootstrapSha256 === sha256(JSON.stringify(Object.fromEntries(
        Object.entries(agentBootstrap).filter(([key]) => key !== "bootstrapSha256"),
      ))) && (agentBootstrap.mode === "pre-scaffolded-packed-cli"
        ? protectedBootstrapMounts.length === 0
          && agentBootstrap.agentInitiatedScaffold === false
          && agentBootstrap.workspaceEmptyAtAgentStart === false
          && agentBootstrap.firstWorkspaceWriteFromAgentSession === false
        : agentBootstrap.candidateDirectoryInitiallyEmpty === true
          && agentBootstrap.packedCliInvokedInsideAgentProcess === true
          && agentBootstrap.offlineDependencyInstall === true
          && agentBootstrap.agentInitiatedScaffold === true
          && agentBootstrap.workspaceEmptyAtAgentStart === true
          && agentBootstrap.firstWorkspaceWriteFromAgentSession === true
          && protectedBootstrapMounts.length === 5),
      candidateOnlyWritableHostMount: candidateMount?.RW === true && candidateMount?.Type === "bind"
        && mounts.filter((entry) => entry.RW === true).length === 1,
      containerCommandBound: JSON.stringify(record?.Config?.Cmd ?? []) === JSON.stringify(effectiveCommandArgs),
      credentialBrokered: credential.scope.length > 0 && credential.expiresAt.length > 0,
      dockerSocketAbsent: !mounts.some((entry) => /docker(?:\.sock)?$/i.test(String(entry.Source ?? "")) || /docker(?:\.sock)?$/i.test(String(entry.Destination ?? ""))),
      exactImageBound: record?.Image === agentContainerImageId,
      hostNamespacesNotShared: host.PidMode !== "host" && host.IpcMode !== "host" && host.NetworkMode !== "host",
      instructionPolicyBound: instructionPolicy.rulesIgnored === false && instructionPolicy.parentContextInherited === false,
      internalNetworkBound: networkRecord?.Internal === true && host.NetworkMode === networkName,
      noCredentialMount: mounts.every((entry) => !/auth|credential|secret/i.test(String(entry.Destination ?? ""))),
      noEvidenceOrEvaluatorMount: mounts.every((entry) => expectedMountDestinations.includes(entry.Destination))
        && mounts.every((entry) => !/evidence|evaluator|task-brief|task-set/i.test(String(entry.Source ?? ""))),
      noNewPrivileges: Array.isArray(host.SecurityOpt) && host.SecurityOpt.includes("no-new-privileges:true"),
      noPublishedPorts: Object.keys(host.PortBindings ?? {}).length === 0,
      providerBrokerOnlyPeer: attachedIds.length === 2 && attachedIds.includes(containerId) && attachedIds.includes(brokerId),
      readOnlyRootFilesystem: host.ReadonlyRootfs === true,
      scopedMountSet: mounts.length === expectedMountDestinations.length
        && JSON.stringify(mounts.map((entry) => entry.Destination).sort()) === JSON.stringify(expectedMountDestinations)
        && mounts.filter((entry) => entry.Destination !== "/workspace").every((entry) => entry.RW === false),
    };
    if (!Object.values(checks).every(Boolean)) throw new Error("coding-agent container isolation inspection failed");
    const isolation = {
      broker: {
        allowedModel: agentModel,
        containerId: brokerId,
        expiresAt: credential.expiresAt,
        imageId: agentContainerImageId,
        runnerSha256: expectedProviderBrokerSha256,
      },
      bootstrap: { ...agentBootstrap },
      checks,
      commandSha256: sha256(JSON.stringify(effectiveCommandArgs)),
      containerId,
      credential: {
        expiresAt: credential.expiresAt,
        fingerprintSha256: credential.fingerprintSha256,
        provider: credential.provider,
        scope: credential.scope,
      },
      driver: agentDriver,
      image: { id: agentContainerImageId, reference: agentContainerImage },
      instructions: instructionPolicy,
      mode: "docker-candidate-only",
      mounts: mounts.map((entry) => ({
        destination: entry.Destination,
        readOnly: entry.RW === false,
        type: entry.Type,
      })).sort((left, right) => left.destination.localeCompare(right.destination)),
      network: { id: networkId, internal: true, name: networkName },
      schemaVersion: "nodekit.coding-agent-isolation/v1",
    };
    isolation.isolationSha256 = sha256(JSON.stringify(isolation));
    const started = run("docker", ["start", "--attach", containerName], repoRoot, {
      baseEnv: candidateToolEnvironment(),
      timeout: Number(args.timeoutMs ?? 1_800_000),
    });
    return { ...started, isolation };
  } finally {
    if (containerCreated) spawnSync("docker", ["container", "rm", "--force", containerName], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...candidateToolEnvironment(), CI: "1" },
      shell: false,
    });
    if (brokerCreated) spawnSync("docker", ["container", "rm", "--force", brokerName], {
      cwd: repoRoot, encoding: "utf8", env: { ...candidateToolEnvironment(), CI: "1" }, shell: false,
    });
    spawnSync("docker", ["network", "rm", networkName], {
      cwd: repoRoot, encoding: "utf8", env: { ...candidateToolEnvironment(), CI: "1" }, shell: false,
    });
  }
}

// Pin the NodeKit source identity before the candidate is generated. A long-running
// trial must never inherit a newer commit merely because the parent repository moved
// while the isolated coding agent was working.
const nodekitCommit = run("git", ["rev-parse", "HEAD"], repoRoot).stdout.trim();
const sourceHash = await computeNodeKitSourceHash(repoRoot);
if (nodekitCommit !== expectedCandidateCommit || sourceHash !== expectedCandidateSourceHash) {
  throw new Error("trial repository identity does not match the exact campaign candidate");
}
const tarballMetadata = await lstat(nodekitTarball);
if (!tarballMetadata.isFile() || tarballMetadata.isSymbolicLink()) {
  throw new Error("--nodekit-tarball must identify one regular, non-symlink .tgz file");
}
const nodekitSnapshotResult = await createImmutablePackageSnapshot(
  nodekitTarball,
  path.join(temporaryRoot, "candidate-input", "nodekit.tgz"),
  {
  expectedName: "@homenshum/nodekit",
  ...(expectedTarballSha256 === null ? {} : { expectedTarballSha256 }),
  },
);
const nodekitSnapshot = nodekitSnapshotResult.destination;
const nodekitArchive = nodekitSnapshotResult.archive;
const nodekitPackage = nodekitArchive.name;
const nodekitVersion = nodekitArchive.version;
const nodekitTarballSha256 = nodekitArchive.tarballSha256;
const protectedImageInspection = run("docker", ["image", "inspect", protectedContainerImage], repoRoot, {
  baseEnv: candidateToolEnvironment(),
  timeout: 30_000,
});
requirePass(protectedImageInspection, "protected candidate-check image inspection");
const protectedImageRecords = JSON.parse(protectedImageInspection.stdout);
if (!Array.isArray(protectedImageRecords) || protectedImageRecords.length !== 1
  || protectedImageRecords[0]?.Id !== protectedContainerImageId) {
  throw new Error("protected candidate-check image does not match the exact campaign image ID");
}
const agentImageInspection = run("docker", ["image", "inspect", agentContainerImage], repoRoot, {
  baseEnv: candidateToolEnvironment(),
  timeout: 30_000,
});
requirePass(agentImageInspection, "coding-agent image inspection");
const agentImageRecords = JSON.parse(agentImageInspection.stdout);
if (!Array.isArray(agentImageRecords) || agentImageRecords.length !== 1
  || agentImageRecords[0]?.Id !== agentContainerImageId) {
  throw new Error("coding-agent image does not match the exact campaign image ID");
}

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
  run(packageManager, packageInstallArgs(nodekitSnapshot), launcherRoot, { timeout: 300_000 }),
  "exact NodeKit launcher installation",
);
const installedCli = path.join(launcherRoot, "node_modules", "@homenshum", "nodekit", "src", "cli.mjs");
const launcherPackageRoot = path.join(launcherRoot, "node_modules", "@homenshum", "nodekit");
const installedPackage = JSON.parse(await readFile(path.join(launcherPackageRoot, "package.json"), "utf8"));
if (installedPackage.name !== nodekitPackage || installedPackage.version !== nodekitVersion) {
  throw new Error("installed launcher package identity differs from the inspected NodeKit tarball");
}
if (!(await installedPackageExactlyMatchesArchive(launcherPackageRoot, nodekitArchive))) {
  throw new Error("installed launcher package bytes differ from the inspected NodeKit tarball");
}
const installedCliSha256 = await fileSha256(installedCli);
const scaffoldArgs = [
  installedCli,
  "create",
  candidateRoot,
  "--name", `ease-${taskId}`,
  "--brief", "Carry one bounded user intention to a reviewed and verified artifact.",
  "--nodekit-specifier", "file:vendor/nodekit.tgz",
  "--package-manager", packageManager,
  "--no-install",
];
const exactAgentBootstrapCommand = exactAgentScaffoldCommand(taskId);
const agentBootstrapInstruction = [
  "Protected empty-directory setup contract:",
  "- /workspace is empty. You, the coding agent, must initialize it; the trusted launcher will not scaffold or write application files for you.",
  `- Your first workspace-mutating command must be exactly: ${exactAgentBootstrapCommand}`,
  "- Then create /workspace/vendor, copy /protected/nodekit.tgz to /workspace/vendor/nodekit.tgz, copy the read-only /protected/npm-cache into /tmp/nodekit-npm-cache, and run npm install --offline --cache /tmp/nodekit-npm-cache --ignore-scripts --no-audit --no-fund from /workspace.",
  "- Run npm run compile before specializing the generated application.",
  "- Do not use network package installation and do not replace the exact mounted NodeKit tarball.",
].join("\n");
const agentBootstrapBody = {
  candidateDirectoryInitiallyEmpty: bootstrapMode === "agent-process-packed-cli-from-empty",
  commandSha256: bootstrapMode === "agent-process-packed-cli-from-empty"
    ? sha256(exactAgentBootstrapCommand)
    : sha256(JSON.stringify(scaffoldArgs)),
  agentInitiatedScaffold: bootstrapMode === "agent-process-packed-cli-from-empty",
  firstWorkspaceWriteFromAgentSession: bootstrapMode === "agent-process-packed-cli-from-empty",
  nodekitCliSha256: installedCliSha256,
  nodekitTarballSha256,
  offlineDependencyInstall: bootstrapMode === "agent-process-packed-cli-from-empty",
  packedCliInvokedInsideAgentProcess: bootstrapMode === "agent-process-packed-cli-from-empty",
  mode: bootstrapMode,
  schemaVersion: "nodekit.agent-bootstrap/v1",
  workspaceEmptyAtAgentStart: bootstrapMode === "agent-process-packed-cli-from-empty",
};
const agentBootstrap = {
  ...agentBootstrapBody,
  bootstrapSha256: sha256(JSON.stringify(agentBootstrapBody)),
};

let instructionRoot = candidateRoot;
if (bootstrapMode === "agent-process-packed-cli-from-empty") {
  // The real candidate stays empty until the coding-agent container process starts.
  // A separate, inaccessible reference scaffold binds the exact project-local
  // instructions that Codex/Claude must auto-load after the in-container CLI step.
  const referenceArgs = [...scaffoldArgs];
  referenceArgs[2] = referenceRoot;
  referenceArgs.push("--no-git");
  requirePass(run(process.execPath, referenceArgs, launcherRoot, { timeout: 300_000 }), "protected reference instruction scaffold");
  instructionRoot = referenceRoot;

  await mkdir(cacheWarmRoot, { recursive: true });
  await writeFile(path.join(cacheWarmRoot, "package.json"), `${JSON.stringify({
    name: "nodekit-agent-offline-cache",
    private: true,
    version: "0.0.0",
  }, null, 2)}\n`);
  requirePass(run("npm", [
    "install", nodekitSnapshot, "@axe-core/playwright@4.12.1", "playwright@1.61.1",
    "--ignore-scripts", "--cache", npmCacheRoot, "--no-audit", "--no-fund",
  ], cacheWarmRoot, { timeout: 300_000 }), "warm protected offline dependency cache");
  await mkdir(candidateRoot, { recursive: true });
  if (!(await directoryIsEmpty(candidateRoot))) throw new Error("coding-agent bootstrap candidate directory was not empty before container creation");
} else {
  requirePass(run(process.execPath, scaffoldArgs, launcherRoot, { timeout: 300_000 }), "installed NodeKit CLI scaffold");
  await mkdir(path.join(candidateRoot, "vendor"), { recursive: true });
  await copyFile(nodekitSnapshot, path.join(candidateRoot, "vendor", "nodekit.tgz"));
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
}

if (bootstrapMode === "pre-scaffolded-packed-cli") {
  const writeProbePath = path.join(candidateRoot, ".nodekit-agent-write-probe");
  await writeFile(writeProbePath, `${runId}\n`);
  const writeProbeMatched = (await readFile(writeProbePath, "utf8")) === `${runId}\n`;
  await rm(writeProbePath);
  if (!writeProbeMatched) throw new Error("candidate write preflight did not round-trip");
}
await writeFile(path.join(evidenceRoot, "agent", "environment.json"), `${JSON.stringify({
  agentDriver,
  agentModel,
  agentProfile,
  agentBootstrap: Object.fromEntries(Object.entries(agentBootstrap).filter(([key]) => key !== "shell")),
  agentBootstrapSha256: agentBootstrap.bootstrapSha256,
  environmentPolicy: "allowlisted-process-environment",
  outerIsolation: executor === "docker" ? "disposable-container" : `host-${agentDriver}-sandbox`,
  inheritedParentThread: false,
  requestedSandbox: executor === "docker" ? "danger-full-access-inside-disposable-container" : "workspace-write",
  userConfigLoaded: false,
  userExecPolicyLoaded: false,
  writePreflight: bootstrapMode === "agent-process-packed-cli-from-empty" ? "enforced-by-container-bootstrap" : "passed",
  nodekitPackage,
  nodekitTarballSha256,
  nodekitVersion,
  nodekitCommit,
  nodekitSourceHash: sourceHash,
  taskBriefSha256,
  taskSetSha256,
  trialRunnerSha256: expectedTrialRunnerSha256,
  protectedEvaluatorSha256: expectedProtectedEvaluatorSha256,
  protectedBrowserLaneSha256: expectedProtectedBrowserLaneSha256,
  providerBrokerSha256: expectedProviderBrokerSha256,
  protectedContainerImage,
  protectedContainerImageId,
  agentContainerImage,
  agentContainerImageId,
}, null, 2)}\n`);

const sessionPath = path.join(evidenceRoot, "agent", "session.jsonl");
const finalPath = path.join(evidenceRoot, "agent", "final-report.md");
const candidateFinalPath = path.join(candidateRoot, ".nodekit-agent-final-report.md");
const modelArgs = agentModel ? ["--model", agentModel] : [];
const instructionFiles = await Promise.all(["AGENTS.md", "CLAUDE.md"].map(async (relativePath) => {
  const absolutePath = path.join(instructionRoot, relativePath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${relativePath} must be a regular project-local instruction file`);
  const bytes = await readFile(absolutePath);
  return { path: relativePath, sha256: sha256(bytes) };
}));
const claudeInstructions = await readFile(path.join(instructionRoot, "CLAUDE.md"), "utf8");
if (!/^@AGENTS\.md$/m.test(claudeInstructions)) throw new Error("CLAUDE.md must import the canonical project-local AGENTS.md instructions");
const instructionPolicy = {
  automaticPath: agentDriver === "codex" ? "AGENTS.md" : "CLAUDE.md",
  canonicalPath: "AGENTS.md",
  files: instructionFiles,
  loadedPaths: agentDriver === "codex" ? ["AGENTS.md"] : ["CLAUDE.md", "AGENTS.md"],
  parentContextInherited: false,
  routingDirective: agentDriver === "claude-code" ? "@AGENTS.md" : null,
  rulesIgnored: false,
  schemaVersion: "nodekit.agent-instruction-policy/v1",
};
instructionPolicy.instructionSetSha256 = sha256(JSON.stringify(instructionPolicy));
const effectiveAgentTaskPrompt = bootstrapMode === "agent-process-packed-cli-from-empty"
  ? `${agentBootstrapInstruction}\n\nHeld-out application task:\n${task.goal}`
  : task.goal;
const agentCommand = agentDriver === "codex"
  ? ["codex", "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "danger-full-access", "--json",
      ...(bootstrapMode === "agent-process-packed-cli-from-empty" ? ["--skip-git-repo-check"] : []),
      ...modelArgs, "--output-last-message", "/workspace/.nodekit-agent-final-report.md", "-C", "/workspace", effectiveAgentTaskPrompt]
  : ["claude", "--print", "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config",
      "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      ...modelArgs, effectiveAgentTaskPrompt];
const agent = await runIsolatedCodingAgent(agentCommand, instructionPolicy, agentBootstrap);
if (agentDriver === "codex") {
  await writeFile(finalPath, sanitizedEvidenceText(await readFile(candidateFinalPath, "utf8").catch(() => "")));
  await rm(candidateFinalPath, { force: true });
} else {
  await writeFile(finalPath, `${sanitizedEvidenceText(extractClaudeFinalReport(agent.stdout ?? ""))}\n`);
}
await writeFile(sessionPath, sanitizedEvidenceText(agent.stdout ?? ""));
await writeFile(path.join(evidenceRoot, "agent", "stderr.txt"), sanitizedEvidenceText(agent.stderr ?? ""));
const agentBootstrapSession = bootstrapMode === "agent-process-packed-cli-from-empty"
  ? verifyAgentInitiatedBootstrap(agent.stdout)
  : { commandCount: 0, firstMutatingCommandSha256: null, passed: true, scaffoldCommandSha256: null };
const agentEnvironmentFile = path.join(evidenceRoot, "agent", "environment.json");
const agentEnvironmentEvidence = JSON.parse(await readFile(agentEnvironmentFile, "utf8"));
agentEnvironmentEvidence.agentProcessIsolation = agent.isolation;
agentEnvironmentEvidence.agentProcessIsolationSha256 = agent.isolation.isolationSha256;
agentEnvironmentEvidence.agentCommandSha256 = agent.isolation.commandSha256;
agentEnvironmentEvidence.agentInstructionPolicy = instructionPolicy;
agentEnvironmentEvidence.agentInstructionPolicySha256 = instructionPolicy.instructionSetSha256;
agentEnvironmentEvidence.agentBootstrapSession = agentBootstrapSession;
await writeFile(agentEnvironmentFile, `${JSON.stringify(agentEnvironmentEvidence, null, 2)}\n`);

const checks = {};
const endingInstructionFiles = await Promise.all(instructionFiles.map(async (entry) => ({
  path: entry.path,
  sha256: await fileSha256(path.join(candidateRoot, entry.path)),
})));
checks.localInstructionsBound = JSON.stringify(endingInstructionFiles) === JSON.stringify(instructionFiles)
  && agent.isolation.instructions.instructionSetSha256 === instructionPolicy.instructionSetSha256;
checks.agentBootstrapBound = agent.isolation?.bootstrap?.bootstrapSha256 === agentBootstrap.bootstrapSha256
  && agent.isolation?.bootstrap?.mode === bootstrapMode
  && agent.isolation?.bootstrap?.nodekitCliSha256 === installedCliSha256
  && agent.isolation?.bootstrap?.nodekitTarballSha256 === nodekitTarballSha256
  && (bootstrapMode === "pre-scaffolded-packed-cli"
    ? agent.isolation.bootstrap.candidateDirectoryInitiallyEmpty === false
      && agent.isolation.bootstrap.packedCliInvokedInsideAgentProcess === false
      && agent.isolation.bootstrap.offlineDependencyInstall === false
    : agent.isolation.bootstrap.candidateDirectoryInitiallyEmpty === true
      && agent.isolation.bootstrap.packedCliInvokedInsideAgentProcess === true
      && agent.isolation.bootstrap.offlineDependencyInstall === true
      && agent.isolation.bootstrap.agentInitiatedScaffold === true
      && agent.isolation.bootstrap.workspaceEmptyAtAgentStart === true
      && agent.isolation.bootstrap.firstWorkspaceWriteFromAgentSession === true
      && agentBootstrapSession.passed === true);
const candidateSandboxResults = [];
for (const [name, script] of [
  ["compile", "compile"],
  ["check", "check"],
  ["demo", "demo"],
  ["eval", "eval"],
  ["browserContract", "proof:browser-contract"],
]) {
  const result = runCandidateScript(script);
  candidateSandboxResults.push(result);
  checks[name] = result.status === 0 && !result.error;
}
const browserRuntime = runCandidateCommand(["node", "-e", "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"]);
candidateSandboxResults.push(browserRuntime);
checks.browserRuntime = browserRuntime.status === 0 && !browserRuntime.error;
requirePass(run("git", ["add", "-A"], candidateRoot), "stage post-agent candidate identity");
requirePass(run("git", ["reset", "HEAD", "--", "proof"], candidateRoot), "exclude generated proof from post-agent identity");
const postAgentTree = run("git", ["write-tree"], candidateRoot);
requirePass(postAgentTree, "write post-agent candidate tree");
const postAgentTreeHash = postAgentTree.stdout.trim();
if (!/^[a-f0-9]{40}$/.test(postAgentTreeHash)) throw new Error("post-agent candidate tree hash is invalid");
requirePass(run("git", ["reset", "--mixed", "HEAD"], candidateRoot), "restore post-agent candidate index");
const browser = runCandidateScript("proof:browser", {
  env: {
    NODEKIT_EASE_RUN_ID: runId,
    NODEKIT_POST_AGENT_TREE_HASH: postAgentTreeHash,
    NODEKIT_SOURCE_COMMIT: nodekitCommit,
    NODEKIT_SOURCE_HASH: sourceHash,
    NODEKIT_TARBALL_SHA256: nodekitTarballSha256,
  },
  timeout: 300_000,
});
candidateSandboxResults.push(browser);
checks.browserJourney = browser.status === 0 && !browser.error;
const proof = runCandidateScript("proof");
candidateSandboxResults.push(proof);
checks.proof = proof.status === 0 && !proof.error;
const endingNodekitCommit = run("git", ["rev-parse", "HEAD"], repoRoot).stdout.trim();
const endingNodekitSourceHash = await computeNodeKitSourceHash(repoRoot);
checks.nodekitIdentityStable = endingNodekitCommit === nodekitCommit && endingNodekitSourceHash === sourceHash;
const vendorTarball = path.join(candidateRoot, "vendor", "nodekit.tgz");
const [candidatePackage, candidateIdentity, candidateRuntimePackage, candidateLock, endingInputTarballSha256, endingSnapshotTarballSha256, candidateTarballSha256, vendorArchive] = await Promise.all([
  readFile(path.join(candidateRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, ".nodeagent", "application-identity.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, "node_modules", "@homenshum", "nodekit", "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(candidateRoot, packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json"), "utf8"),
  fileSha256(nodekitTarball),
  fileSha256(nodekitSnapshot),
  fileSha256(vendorTarball),
  inspectNpmPackageArchiveFile(vendorTarball, {
    expectedName: nodekitPackage,
    expectedTarballSha256: nodekitTarballSha256,
  }),
]);
const nodekitSpecifier = candidatePackage.dependencies?.[nodekitPackage] ?? candidatePackage.devDependencies?.[nodekitPackage];
const identityFiles = new Map((candidateIdentity.identity?.files ?? []).map((entry) => [entry.path, entry]));
const applicationHash = candidateIdentity.applicationHash;
const configHash = candidateIdentity.configHash;
const candidateRuntimeFilesMatch = await installedPackageExactlyMatchesArchive(
  path.join(candidateRoot, "node_modules", "@homenshum", "nodekit"),
  nodekitArchive,
);
checks.nodekitTarballStable = endingInputTarballSha256 === nodekitTarballSha256
  && endingSnapshotTarballSha256 === nodekitTarballSha256;
checks.nodekitRuntimeBound = candidateTarballSha256 === nodekitTarballSha256
  && packageArchivesMatch(nodekitArchive, vendorArchive)
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

const [endingTaskBriefBytes, endingTaskSetBytes, endingTrialRunnerBytes, endingProtectedEvaluatorBytes, endingProtectedBrowserLaneBytes, endingProviderBrokerBytes] = await Promise.all([
  readFile(taskBriefFile),
  readFile(taskSetFile),
  readFile(trialRunnerFile),
  readFile(protectedEvaluatorFile),
  readFile(protectedBrowserLaneFile),
  readFile(providerBrokerFile),
]);
if (sha256(endingTaskBriefBytes) !== taskBriefSha256
  || sha256(endingTaskSetBytes) !== taskSetSha256
  || sha256(endingTrialRunnerBytes) !== expectedTrialRunnerSha256
  || sha256(endingProtectedEvaluatorBytes) !== expectedProtectedEvaluatorSha256
  || sha256(endingProtectedBrowserLaneBytes) !== expectedProtectedBrowserLaneSha256
  || sha256(endingProviderBrokerBytes) !== expectedProviderBrokerSha256) {
  throw new Error("protected task, trial-runner, evaluator, browser-lane, or provider-broker bytes changed during the trial");
}

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
checks.postAgentTreeStable = candidateTree.stdout.trim() === postAgentTreeHash;
const candidateArchive = run("git", ["archive", "--format=tar.gz", `--output=${path.join(evidenceRoot, "candidate", "generated-repo.tar.gz")}`, candidateTree.stdout.trim()], candidateRoot);
checks.candidateArchive = candidateArchive.status === 0 && !candidateArchive.error;
const candidateArchiveSha256 = checks.candidateArchive
  ? await fileSha256(path.join(evidenceRoot, "candidate", "generated-repo.tar.gz"))
  : null;
requirePass(run("git", ["reset", "--mixed", "HEAD"], candidateRoot), "restore candidate evidence index");
await writeFile(path.join(evidenceRoot, "candidate", "git-status.txt"), run("git", ["status", "--short"], candidateRoot).stdout);

// The generated repository never grades its own task relevance. This evaluator
// lives outside the candidate workspace, is content-addressed by the campaign,
// and runs only after the exact candidate tree/archive and browser evidence exist.
const evaluatorOutputRoot = path.join(evidenceRoot, "evaluator");
const protectedEvaluationFile = path.join(evaluatorOutputRoot, "protected-task-evaluation.json");
const visualReviewInventoryFile = path.join(evaluatorOutputRoot, "visual-review-inventory.json");
const evaluatorScreenshotFile = path.join(evaluatorOutputRoot, "task-relevance.png");
const protectedEvaluationRun = run(process.execPath, [
  protectedEvaluatorFile,
  `--browser-lane-file=${protectedBrowserLaneFile}`,
  `--browser-lane-sha256=${expectedProtectedBrowserLaneSha256}`,
  `--application-hash=${applicationHash}`,
  `--browser-manifest=${path.join(evidenceRoot, "candidate", "browser", "screenshot-manifest.json")}`,
  `--candidate-archive=${path.join(evidenceRoot, "candidate", "generated-repo.tar.gz")}`,
  `--candidate-archive-sha256=${candidateArchiveSha256}`,
  `--candidate-root=${candidateRoot}`,
  `--config-hash=${configHash}`,
  `--container-image=${protectedContainerImage}`,
  `--container-image-id=${protectedContainerImageId}`,
  `--evaluator-sha256=${expectedProtectedEvaluatorSha256}`,
  `--nodekit-commit=${nodekitCommit}`,
  `--nodekit-source-hash=${sourceHash}`,
  `--nodekit-tarball-sha256=${nodekitTarballSha256}`,
  `--output-root=${evaluatorOutputRoot}`,
  `--post-agent-tree-hash=${postAgentTreeHash}`,
  `--run-id=${runId}`,
  `--task-brief-file=${taskBriefFile}`,
  `--task-brief-sha256=${taskBriefSha256}`,
  `--task-id=${taskId}`,
  `--task-set-file=${taskSetFile}`,
  `--task-set-sha256=${taskSetSha256}`,
], repoRoot, { timeout: 900_000 });
let protectedEvaluation = null;
let visualReviewInventory = null;
let protectedEvaluationValidated = false;
try {
  protectedEvaluation = JSON.parse(await readFile(protectedEvaluationFile, "utf8"));
  visualReviewInventory = JSON.parse(await readFile(visualReviewInventoryFile, "utf8"));
  const evaluatorScreenshotSha256 = await fileSha256(evaluatorScreenshotFile);
  const visualReviewInventorySha256 = await fileSha256(visualReviewInventoryFile);
  if (protectedEvaluation.protectedBrowserManifestFile !== "protected-browser/screenshot-manifest.json") {
    throw new Error("protected evaluation does not identify the canonical protected browser manifest");
  }
  const protectedBrowser = await validateProtectedBrowserEvidence({
    evidenceRoot: evaluatorOutputRoot,
    expected: {
      candidateArchiveSha256,
      runId: protectedEvaluation.protectedTaskInput?.inputToken,
      taskId,
    },
    manifestFile: protectedEvaluation.protectedBrowserManifestFile,
    validatePng: validateSubmissionScreenshotPng,
  });
  const candidateBrowserManifestSha256 = await fileSha256(path.join(evidenceRoot, "candidate", "browser", "screenshot-manifest.json"));
  validateVisualReviewInventory(visualReviewInventory, {
    applicationHash,
    protectedBrowserManifestSha256: protectedBrowser.manifestSha256,
    candidateArchiveSha256,
    configHash,
    evaluatorScreenshotSha256,
    nodekitCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256,
    postAgentTreeHash,
    runId,
    browserLaneSha256: expectedProtectedBrowserLaneSha256,
    containerImage: protectedContainerImage,
    containerImageId: protectedContainerImageId,
    isolationSha256: protectedEvaluation.isolationSha256,
    screenshotEvidenceRootSha256: protectedBrowser.screenshotEvidenceRootSha256,
    taskId,
  });
  validateProtectedAgentEvaluation(protectedEvaluation, {
    applicationHash,
    candidateBrowserManifestSha256,
    protectedBrowserManifestSha256: protectedBrowser.manifestSha256,
    candidateArchiveSha256,
    configHash,
    evaluatorScreenshotSha256,
    evaluatorSha256: expectedProtectedEvaluatorSha256,
    nodekitCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256,
    postAgentTreeHash,
    runId,
    browserLaneSha256: expectedProtectedBrowserLaneSha256,
    containerImage: protectedContainerImage,
    containerImageId: protectedContainerImageId,
    isolationSha256: visualReviewInventory.isolationSha256,
    screenshotEvidenceRootSha256: protectedBrowser.screenshotEvidenceRootSha256,
    taskBriefSha256,
    taskId,
    taskSetSha256,
    visualReviewInventorySha256,
    visualReviewInventorySelfHash: visualReviewInventory.inventorySha256,
  });
  protectedEvaluationValidated = true;
} catch {
  // Preserve the evaluator's emitted files for diagnosis; the trial checks below
  // fail closed and prevent the result from qualifying.
}
checks.protectedEvaluation = protectedEvaluationRun.status === 0
  && !protectedEvaluationRun.error
  && protectedEvaluation?.passed === true
  && protectedEvaluationValidated;
checks.protectedEvaluatorStable = sha256(await readFile(protectedEvaluatorFile)) === expectedProtectedEvaluatorSha256;
checks.protectedIsolation = protectedEvaluation?.checks?.isolationBound === true
  && protectedEvaluation?.isolationSha256 === visualReviewInventory?.isolationSha256
  && protectedEvaluation?.isolation?.browserLaneSha256 === expectedProtectedBrowserLaneSha256
  && protectedEvaluation?.isolation?.image?.id === protectedContainerImageId;
checks.taskSpecificOutput = protectedEvaluation?.checks?.renderedTaskRelevant === true
  && protectedEvaluation?.checks?.sourceTaskRelevant === true
  && protectedEvaluation?.checks?.guidedInteractionPassed === true
  && protectedEvaluation?.checks?.taskInputBound === true
  && protectedEvaluation?.checks?.typedArtifactVerified === true
  && protectedEvaluation?.checks?.artifactDownloadVerified === true
  && protectedEvaluation?.checks?.artifactReloadPersistenceVerified === true
  && protectedEvaluation?.checks?.artifactReopenPersistenceVerified === true;
checks.visualReview = visualReviewInventory?.passed === true
  && visualReviewInventory?.openIssueCounts?.p0 === 0
  && visualReviewInventory?.openIssueCounts?.p1 === 0
  && visualReviewInventory?.separateFromHumanUsability === true;

const sessionLines = (agent.stdout ?? "").split(/\r?\n/).filter(Boolean);
const parsedEvents = sessionLines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const agentSessionId = parsedEvents.map((entry) => entry.thread_id ?? entry.session_id ?? entry.message?.session_id).find((value) => typeof value === "string" && value.length > 0) ?? null;
const usageEvents = parsedEvents.filter((entry) => JSON.stringify(entry).includes("token"));
const usageSummary = usageEvents.map((entry) => {
  const serialized = JSON.stringify(entry);
  const numeric = Object.fromEntries(Object.entries(entry).filter(([key, value]) => /(?:token|cost|usage)/i.test(key) && Number.isFinite(value)));
  return { numeric, rawEventSha256: sha256(serialized), type: typeof entry.type === "string" ? entry.type : null };
});
await writeFile(path.join(evidenceRoot, "agent", "token-usage.json"), `${JSON.stringify({
  events: usageSummary,
  note: `${agentDriver} usage metadata only; raw usage-bearing JSON is hash-bound but not duplicated into evidence.`,
}, null, 2)}\n`);
const agentVersionCommand = agentDriver === "codex" ? "codex" : "claude";
const agentVersionResult = run("docker", [
  "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges:true", "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
  agentContainerImageId, agentVersionCommand, "--version",
], repoRoot, { baseEnv: candidateToolEnvironment(), timeout: 30_000 });
requirePass(agentVersionResult, "read coding-agent version from exact isolated image");
const agentVersion = agentVersionResult.stdout.trim();
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
  ["protected-evaluation", "evaluator/protected-task-evaluation.json", true],
  ["evaluator-screenshot", "evaluator/task-relevance.png", true],
  ["visual-review-inventory", "evaluator/visual-review-inventory.json", true],
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
checks.evidenceComplete = evidence.length === 19;
checks.agentEnvironmentIsolated = agent.isolation?.schemaVersion === "nodekit.coding-agent-isolation/v1"
  && agent.isolation?.image?.id === agentContainerImageId
  && agent.isolation?.driver === agentDriver
  && agent.isolation?.isolationSha256 === sha256(JSON.stringify(Object.fromEntries(
    Object.entries(agent.isolation).filter(([key]) => key !== "isolationSha256"),
  )))
  && Object.values(agent.isolation?.checks ?? {}).every((value) => value === true)
  && protectedImageRecords[0].Id === protectedContainerImageId
  && candidateSandboxResults.length === 8
  && candidateSandboxResults.every((result) => result.record.args.includes("--network")
    && result.record.args[result.record.args.indexOf("--network") + 1] === "none"
    && result.record.args.includes("--read-only")
    && result.record.args.includes("no-new-privileges:true"));

const receipt = {
  agentBootstrap: Object.fromEntries(Object.entries(agentBootstrap).filter(([key]) => key !== "shell")),
  agentBootstrapSession,
  agentBootstrapSha256: agentBootstrap.bootstrapSha256,
  agentCommandSha256: agent.isolation.commandSha256,
  agentContainerImage,
  agentContainerImageId,
  agentDriver,
  agentExitCode: agent.status,
  agentModel,
  agentProfile,
  agentSessionId,
  agentSessionMode: "ephemeral",
  agentVersion,
  agentProcessIsolation: agent.isolation,
  agentProcessIsolationSha256: agent.isolation.isolationSha256,
  agentInstructionPolicy: instructionPolicy,
  agentInstructionPolicySha256: instructionPolicy.instructionSetSha256,
  candidateRoot,
  bootstrapMode,
  changedFiles,
  checks,
  applicationHash,
  candidateArchiveSha256,
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
  postAgentTreeHash,
  protectedEvaluatorSha256: expectedProtectedEvaluatorSha256,
  protectedBrowserLaneSha256: expectedProtectedBrowserLaneSha256,
  protectedContainerImage,
  protectedContainerImageId,
  providerBrokerSha256: expectedProviderBrokerSha256,
  protectedIsolationSha256: protectedEvaluation?.isolationSha256 ?? null,
  protectedEvaluationSha256: evidence.find((entry) => entry.kind === "protected-evaluation")?.sha256 ?? null,
  evaluatorScreenshotSha256: evidence.find((entry) => entry.kind === "evaluator-screenshot")?.sha256 ?? null,
  visualReviewInventorySha256: evidence.find((entry) => entry.kind === "visual-review-inventory")?.sha256 ?? null,
  screenshotEvidenceRootSha256: protectedEvaluation?.screenshotEvidenceRootSha256 ?? null,
  passed: agent.status === 0 && Object.values(checks).every(Boolean),
  promptSha256: sha256(task.goal),
  runId,
  schemaVersion: "nodekit.agent-ease-trial/v2",
  taskId,
  taskSetSha256,
  trialStartedAt,
  trialRunnerSha256: expectedTrialRunnerSha256,
  userReprompts: 0,
  substantiveFiles,
};
receipt.verdict = receipt.passed ? "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED" : blockedReport ? "PILOT_FAIL_AGENT_BLOCKED" : "PILOT_FAIL";
receipt.receiptSha256 = sha256(JSON.stringify(receipt));
await writeFile(path.join(evidenceRoot, "manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
