import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProject } from "../src/lib/scaffold.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...value] = entry.replace(/^--/, "").split("=");
  return [key, value.join("=") || true];
}));
const taskId = String(args.task ?? "volunteer-onboarding");
const tasks = JSON.parse(await readFile(path.join(repoRoot, "evals", "ease", "heldout-tasks.json"), "utf8"));
const task = tasks.tasks.find((entry) => entry.id === taskId);
if (!task) throw new Error(`unknown held-out task ${taskId}; available: ${tasks.tasks.map((entry) => entry.id).join(", ")}`);
const runId = String(args.run ?? `agent_${taskId}_${randomUUID().replaceAll("-", "").slice(0, 12)}`);
const packageManager = String(args.packageManager ?? "npm");
const evidenceRoot = path.join(repoRoot, "proof", "ease", "agents", runId);
const candidateRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "nodekit-agent-ease-")), "candidate");
const commandLedger = [];
const trialStartedAt = new Date().toISOString();
const trialStarted = performance.now();

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function run(command, commandArgs, cwd, options = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", ...(options.env ?? {}) },
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

await mkdir(path.join(evidenceRoot, "agent"), { recursive: true });
await mkdir(path.join(evidenceRoot, "candidate"), { recursive: true });
await writeFile(path.join(evidenceRoot, "agent", "original-prompt.txt"), `${task.goal}\n`);
await writeFile(path.join(evidenceRoot, "agent", "prompt.sha256"), `${sha256(task.goal)}\n`);
await writeFile(path.join(evidenceRoot, "agent", "interventions.json"), "[]\n");

const scaffoldStarted = performance.now();
await createProject({ brief: "Carry one bounded user intention to a reviewed and verified artifact.", git: true, install: false, name: `ease-${taskId}`, packageManager, target: candidateRoot });
commandLedger.push({ command: "nodekit create", durationMs: Math.round(performance.now() - scaffoldStarted), exitCode: 0, startedAt: trialStartedAt });
const installArgs = packageManager === "pnpm" ? ["install", "--prefer-offline"] : ["install", "--prefer-offline", "--no-audit", "--no-fund"];
requirePass(run(packageManager, installArgs, candidateRoot, { timeout: 300_000 }), "dependency installation");

const sessionPath = path.join(evidenceRoot, "agent", "session.jsonl");
const finalPath = path.join(evidenceRoot, "agent", "final-report.md");
const codexWrapper = process.platform === "win32"
  ? spawnSync("where.exe", ["codex.cmd"], { encoding: "utf8" }).stdout.split(/\r?\n/).find(Boolean)
  : undefined;
const agentCommand = process.platform === "win32" ? process.execPath : "codex";
const agentPrefixArgs = process.platform === "win32"
  ? [path.join(path.dirname(codexWrapper ?? ""), "node_modules", "@openai", "codex", "bin", "codex.js")]
  : [];
if (process.platform === "win32" && !codexWrapper) throw new Error("codex.cmd was not found");
const agent = run(agentCommand, [...agentPrefixArgs,
  "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "workspace-write", "--json",
  "--output-last-message", finalPath, "-C", candidateRoot, task.goal,
], candidateRoot, { timeout: Number(args.timeoutMs ?? 1_800_000) });
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
const nodekitCommit = run("git", ["rev-parse", "HEAD"], repoRoot).stdout.trim();
const sourceHash = await computeNodeKitSourceHash(repoRoot);
const browser = run(packageManager, ["run", "proof:browser"], candidateRoot, {
  env: { NODEKIT_EASE_RUN_ID: runId, NODEKIT_SOURCE_COMMIT: nodekitCommit, NODEKIT_SOURCE_HASH: sourceHash },
  timeout: 300_000,
});
checks.browserJourney = browser.status === 0 && !browser.error;
const proof = run(packageManager, ["run", "proof"], candidateRoot);
checks.proof = proof.status === 0 && !proof.error;

const finalReport = await readFile(finalPath, "utf8").catch(() => "");
const porcelain = run("git", ["status", "--porcelain=v1"], candidateRoot).stdout;
const changedFiles = porcelain.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
const substantiveFiles = changedFiles.filter((file) =>
  file !== "package-lock.json"
  && !file.startsWith("proof/")
  && !file.startsWith(".nodeagent/")
  && !file.startsWith("node_modules/"));
const blockedReport = /\b(blocked|read-only|no repository files were changed|please restart with write access)\b/i.test(finalReport);
checks.agentImplemented = substantiveFiles.length > 0;
checks.agentReportedCompletion = finalReport.length > 0 && !blockedReport;

const browserEvidenceSource = path.join(candidateRoot, "proof", "ease", runId, "browser");
const browserEvidenceTarget = path.join(evidenceRoot, "candidate", "browser");
await cp(browserEvidenceSource, browserEvidenceTarget, { recursive: true }).catch(() => undefined);
await cp(
  path.join(candidateRoot, "proof", "browser-certification.json"),
  path.join(evidenceRoot, "candidate", "browser-certification.json"),
).catch(() => undefined);

const diff = run("git", ["diff", "--binary", "HEAD"], candidateRoot).stdout;
await writeFile(path.join(evidenceRoot, "candidate", "diff.patch"), diff);
await writeFile(path.join(evidenceRoot, "candidate", "git-status.txt"), run("git", ["status", "--short"], candidateRoot).stdout);
await writeFile(path.join(evidenceRoot, "candidate", "commit.txt"), `${run("git", ["rev-parse", "HEAD"], candidateRoot).stdout.trim()}\n`);
const identity = await readFile(path.join(candidateRoot, ".nodeagent", "application-identity.json"), "utf8").catch(() => "{}");
await writeFile(path.join(evidenceRoot, "candidate", "application-identity.json"), identity);
run("git", ["archive", "--format=tar.gz", `--output=${path.join(evidenceRoot, "candidate", "generated-repo.tar.gz")}`, "HEAD"], candidateRoot);

const sessionLines = (agent.stdout ?? "").split(/\r?\n/).filter(Boolean);
const parsedEvents = sessionLines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const usageEvents = parsedEvents.filter((entry) => JSON.stringify(entry).includes("token"));
await writeFile(path.join(evidenceRoot, "agent", "token-usage.json"), `${JSON.stringify({ events: usageEvents, note: "Raw Codex JSONL usage-bearing events; cost depends on the configured account and is not inferred." }, null, 2)}\n`);
await writeFile(path.join(evidenceRoot, "commands.jsonl"), commandLedger.map((entry) => JSON.stringify(entry)).join("\n") + "\n");

const receipt = {
  agentExitCode: agent.status,
  agentVersion: run(agentCommand, [...agentPrefixArgs, "--version"], repoRoot).stdout.trim(),
  candidateRoot,
  changedFiles,
  checks,
  durationMs: Math.round(performance.now() - trialStarted),
  generatedAt: new Date().toISOString(),
  interventions: 0,
  packageManager,
  passed: agent.status === 0 && Object.values(checks).every(Boolean),
  promptSha256: sha256(task.goal),
  runId,
  schemaVersion: "nodekit.agent-ease-trial/v1",
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
