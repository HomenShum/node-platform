import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  aggregateHostedDeveloperTiming,
  validateHostedTimingPair,
} from "../src/lib/developer-timing-aggregation.mjs";

const commit = "a".repeat(40);
const sourceHash = "b".repeat(64);
const tarballHash = "c".repeat(64);
const workflowHash = "d".repeat(64);
const lanes = ["windows/npm", "windows/pnpm", "ubuntu/npm", "ubuntu/pnpm", "macos/npm", "macos/pnpm"];
const digest = (value) => createHash("sha256").update(value).digest("hex");

function timingReceipt(lane, cacheClass, index) {
  const packageManager = lane.split("/")[1];
  const receipt = {
    apiKeysRequired: 0,
    applicationHash: digest(`${packageManager}-application`),
    cacheClass,
    cacheIsolated: true,
    ciProvenance: {
      githubRunAttempt: 1,
      githubRunId: cacheClass === "cold" ? "111" : "222",
      githubSha: commit,
      githubWorkflowRef: "HomenShum/node-platform/.github/workflows/ease-proof.yml@refs/tags/nodekit-ease-candidate",
      provider: "github-actions",
      runnerArch: lane.startsWith("macos/") ? "ARM64" : "X64",
      runnerImageOs: lane.split("/")[0],
      runnerImageVersion: "20260722.1",
      runnerName: `hosted-${lane.split("/")[0]}-${index}`,
      runnerOs: lane.split("/")[0],
      workflowFileSha256: workflowHash,
    },
    configHash: digest(`${packageManager}-config`),
    consoleErrors: 0,
    failedCommands: 0,
    generatedAt: "2026-07-22T00:00:00.000Z",
    generatedCandidateArchiveBytes: 1024,
    generatedCandidateArchiveSha256: digest(`${packageManager}-candidate-archive`),
    generatedCandidateCommit: (packageManager === "npm" ? "e" : "f").repeat(40),
    horizontalOverflowPx: 0,
    lane,
    manualDecisions: 0,
    measurements: {
      browserRuntimeInstallationMs: 1,
      compileMs: 1,
      dependencyInstallationMs: 3,
      firstMeaningfulPaintMs: 1,
      generatedAppInstallationMs: 1,
      launcherInstallationMs: 1,
      neutralJourneyMs: 1,
      scaffoldGenerationMs: 1,
      serverReadinessMs: 1,
      totalMs: 10,
    },
    nodeVersion: "v22.0.0",
    nodekitCommit: commit,
    nodekitPackage: "@homenshum/nodekit",
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: tarballHash,
    nodekitVersion: "0.2.1",
    operatingSystem: `${{ windows: "win32-10.0.0-x64", ubuntu: "linux-6.0.0-x64", macos: "darwin-25.0.0-arm64" }[lane.split("/")[0]]}`,
    packageManager,
    packageManagerVersion: packageManager === "npm" ? "10.9.0" : "10.13.1",
    receiptProduced: true,
    reloadPreserved: true,
    runId: `${cacheClass}-${lane.replace("/", "-")}-${index}`,
    schemaVersion: "nodekit.developer-timing-run/v1",
    sourceEdits: 0,
    timerBoundary: "empty-launcher-before-package-json-to-completed-proof",
  };
  return { ...receipt, receiptSha256: digest(JSON.stringify(receipt)) };
}

function matrix() {
  return lanes.flatMap((lane) => ["cold", "warm"].flatMap((cacheClass) => (
    Array.from({ length: 5 }, (_, index) => timingReceipt(lane, cacheClass, index))
  )));
}

test("hosted timing pair binds one cold run and one warm run to one candidate", () => {
  assert.deepEqual(validateHostedTimingPair(matrix(), {
    coldRunId: "111",
    expectedCommit: commit,
    warmRunId: "222",
  }), []);
});

test("hosted timing pair fails closed on a third run, duplicate receipt, or workflow drift", () => {
  const receipts = matrix();
  receipts[0].ciProvenance.githubRunId = "333";
  receipts[1] = structuredClone(receipts[2]);
  receipts[3].ciProvenance.workflowFileSha256 = "9".repeat(64);
  const errors = validateHostedTimingPair(receipts, {
    coldRunId: "111",
    expectedCommit: commit,
    warmRunId: "222",
  });
  assert.match(errors.join("\n"), /exactly one GitHub workflow run/);
  assert.match(errors.join("\n"), /duplicate or missing receipt run IDs/);
  assert.match(errors.join("\n"), /duplicate or missing receipt hashes/);
  assert.match(errors.join("\n"), /share one valid workflow-file hash/);
});

test("hosted timing aggregation writes the canonical 60-run matrix and verdict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-hosted-timing-"));
  try {
    const inputDirectory = path.join(root, "downloaded");
    for (const [index, receipt] of matrix().entries()) {
      const directory = path.join(inputDirectory, `developer-timing-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "developer-timing-run.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    }
    const output = path.join(root, "proof/ease/developer-timing-runs.json");
    const verdictOutput = path.join(root, "proof/ease/developer-timing-verdict.json");
    const result = await aggregateHostedDeveloperTiming({
      coldRunId: "111",
      expectedCommit: commit,
      inputDirectory,
      output,
      verdictOutput,
      warmRunId: "222",
    });
    assert.equal(result.passed, true, result.verdict.errors.join("\n"));
    assert.equal(result.files, 60);
    assert.equal(result.uniqueRuns, 60);
    const runs = JSON.parse(await readFile(output, "utf8"));
    const verdict = JSON.parse(await readFile(verdictOutput, "utf8"));
    assert.equal(runs.length, 60);
    assert.equal(verdict.observedRuns, 60);
    assert.equal(verdict.supportingEvidence[0].kind, "timing-receipts");
    assert.equal(verdict.supportingEvidence[0].sha256, digest(await readFile(output)));

    const cliOutput = path.join(root, "proof/ease/cli-runs.json");
    const cliVerdict = path.join(root, "proof/ease/cli-verdict.json");
    const cli = spawnSync(process.execPath, [
      path.resolve("scripts/aggregate-developer-timing.mjs"),
      inputDirectory,
      cliOutput,
      cliVerdict,
      "--cold-run-id=111",
      "--warm-run-id=222",
      `--expected-commit=${commit}`,
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.equal(JSON.parse(await readFile(cliOutput, "utf8")).length, 60);
    assert.equal(JSON.parse(await readFile(cliVerdict, "utf8")).passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
