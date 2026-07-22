import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const tasks = JSON.parse(await readFile(path.resolve("evals", "ease", "heldout-tasks.json"), "utf8")).tasks;
const profiles = { codex: 3, "claude-code": 1, "lower-cost": 1 };
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
});
const passingChecks = Object.freeze(Object.fromEntries([
  "agentEnvironmentIsolated", "agentImplemented", "agentReportedCompletion", "agentSessionIdentityRecorded", "agentVersionRecorded",
  "applicationIdentityRecorded", "browserContract", "browserJourney", "browserRuntime", "candidateArchive", "check", "compile", "demo",
  "eval", "evidenceComplete", "nodekitIdentityStable", "nodekitRuntimeBound", "nodekitTarballStable", "proof",
].map((name) => [name, true])));

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

function evidenceBytes(kind, { agentSessionId, applicationHash, configHash, packageCandidate, promptSha256, runId, task }) {
  if (kind === "session") return Buffer.from(`${JSON.stringify({ type: "thread.started", thread_id: agentSessionId })}\n`);
  if (kind === "prompt") return Buffer.from(`${task.goal}\n`);
  if (kind === "prompt-hash") return Buffer.from(`${promptSha256}\n`);
  if (kind === "environment") return Buffer.from(`${JSON.stringify({
    nodekitPackage: packageCandidate.packageName,
    nodekitTarballSha256: packageCandidate.nodekitTarballSha256,
    nodekitVersion: packageCandidate.packageVersion,
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
  const firstEvidencePath = [];
  const manifestPaths = [];
  for (const task of tasks) {
    for (const [agentProfile, count] of Object.entries(profiles)) {
      for (let index = 0; index < count; index += 1) {
        const runId = `agent_${task.id}_${agentProfile}_${index + 1}`;
        const agentSessionId = `session_${runId}`;
        const runRoot = path.join(root, runId);
        const applicationHash = digest(`${runId}/application`);
        const configHash = digest(`${runId}/config`);
        const promptSha256 = digest(task.goal);
        const evidence = [];
        for (const [kind, relative] of Object.entries(evidencePaths)) {
          const bytes = evidenceBytes(kind, { agentSessionId, applicationHash, configHash, packageCandidate, promptSha256, runId, task });
          const absolute = path.join(runRoot, ...relative.split("/"));
          await mkdir(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, bytes);
          evidence.push({ bytes: bytes.length, kind, path: relative, sha256: digest(bytes) });
          if (firstEvidencePath.length === 0) firstEvidencePath.push(absolute);
        }
        const receipt = {
          agentDriver: agentProfile === "claude-code" ? "claude-code" : "codex",
          agentExitCode: 0,
          agentModel: agentProfile === "lower-cost" ? "test-lower-cost-model" : null,
          agentProfile,
          agentSessionId,
          agentSessionMode: "ephemeral",
          agentVersion: `${agentProfile} test version`,
          applicationHash,
          candidateRoot: `/tmp/${runId}`,
          changedFiles: ["agent/workflow.mjs"],
          checks: { ...passingChecks },
          configHash,
          durationMs: 1,
          evidence,
          evidenceSetSha256: digest(JSON.stringify(evidence)),
          executor: "native",
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
          promptSha256,
          runId,
          schemaVersion: "nodekit.agent-ease-trial/v2",
          taskId: task.id,
          trialStartedAt: "2026-07-22T00:00:00.000Z",
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
  return { firstEvidencePath: firstEvidencePath[0], manifestPaths };
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
  const { firstEvidencePath } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  const passed = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.equal(verdict.passed, true);
  assert.equal(verdict.requiredRuns, 15);
  assert.equal(verdict.selectedRuns.length, 15);
  assert.equal(verdict.allAttemptsSelected, true);
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
  const { manifestPaths } = await createMatrix(root, candidateCommit, sourceHash, packageCandidate);
  await rewriteReceipt(manifestPaths[0], (receipt) => {
    receipt.evidence.find((entry) => entry.kind === "prompt").path = "agent//original-prompt.txt";
    receipt.evidenceSetSha256 = digest(JSON.stringify(receipt.evidence));
  });
  await rewriteReceipt(manifestPaths[1], (receipt) => { receipt.applicationHash = "3".repeat(64); });
  await rewriteReceipt(manifestPaths[2], (receipt) => { delete receipt.checks.nodekitRuntimeBound; });
  const blocked = evaluate(root, output, candidateCommit, sourceHash, packageCandidate);
  assert.equal(blocked.status, 1);
  const verdict = JSON.parse(await readFile(output, "utf8"));
  assert.match(verdict.errors.join("\n"), /evidence path is not canonical/);
  assert.match(verdict.errors.join("\n"), /application-identity evidence does not bind/);
  assert.match(verdict.errors.join("\n"), /exact required checks failed or were omitted/);
});
