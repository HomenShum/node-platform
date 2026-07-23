import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDeveloperTimingMatrix } from "./ease-evidence.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const RUN_ID = /^\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function findReceiptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return findReceiptFiles(absolute);
    return entry.isFile() && entry.name === "developer-timing-run.json" ? [absolute] : [];
  }));
  return nested.flat();
}

export async function readDeveloperTimingReceipts(directory) {
  const files = (await findReceiptFiles(path.resolve(directory))).sort(lexical);
  const receipts = [];
  for (const file of files) {
    let receipt;
    try {
      receipt = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: invalid timing receipt JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    receipts.push({ file, receipt });
  }
  return receipts;
}

function setValues(receipts, selector) {
  return new Set(receipts.map(selector).filter((value) => value !== null && value !== undefined));
}

export function validateHostedTimingPair(receipts, options = {}) {
  const errors = [];
  const coldRunId = options.coldRunId === undefined ? null : String(options.coldRunId);
  const warmRunId = options.warmRunId === undefined ? null : String(options.warmRunId);
  const expectedCommit = options.expectedCommit === undefined ? null : String(options.expectedCommit).toLowerCase();

  if (coldRunId !== null && !RUN_ID.test(coldRunId)) errors.push("declared cold GitHub run ID must contain only digits");
  if (warmRunId !== null && !RUN_ID.test(warmRunId)) errors.push("declared warm GitHub run ID must contain only digits");
  if (coldRunId !== null && warmRunId !== null && coldRunId === warmRunId) errors.push("cold and warm evidence must come from distinct GitHub workflow runs");
  if (expectedCommit !== null && !COMMIT.test(expectedCommit)) errors.push("expected commit must be a lowercase 40-character Git commit");

  if (receipts.length !== 60) errors.push(`hosted timing aggregation requires exactly 60 receipt files, found ${receipts.length}`);
  const cold = receipts.filter((receipt) => receipt?.cacheClass === "cold");
  const warm = receipts.filter((receipt) => receipt?.cacheClass === "warm");
  if (cold.length !== 30) errors.push(`hosted cold workflow must contribute exactly 30 receipts, found ${cold.length}`);
  if (warm.length !== 30) errors.push(`hosted warm workflow must contribute exactly 30 receipts, found ${warm.length}`);
  if (cold.length + warm.length !== receipts.length) errors.push("hosted timing input contains a receipt outside the cold/warm cache classes");

  const runIds = setValues(receipts, (receipt) => receipt?.runId);
  if (runIds.size !== receipts.length) errors.push("hosted timing input contains duplicate or missing receipt run IDs");
  const receiptHashes = setValues(receipts, (receipt) => receipt?.receiptSha256);
  if (receiptHashes.size !== receipts.length) errors.push("hosted timing input contains duplicate or missing receipt hashes");

  const coldHostedRuns = setValues(cold, (receipt) => receipt?.ciProvenance?.githubRunId);
  const warmHostedRuns = setValues(warm, (receipt) => receipt?.ciProvenance?.githubRunId);
  if (coldHostedRuns.size !== 1) errors.push(`cold receipts must come from exactly one GitHub workflow run, found ${coldHostedRuns.size}`);
  if (warmHostedRuns.size !== 1) errors.push(`warm receipts must come from exactly one GitHub workflow run, found ${warmHostedRuns.size}`);
  const actualColdRunId = coldHostedRuns.size === 1 ? String([...coldHostedRuns][0]) : null;
  const actualWarmRunId = warmHostedRuns.size === 1 ? String([...warmHostedRuns][0]) : null;
  if (actualColdRunId !== null && actualWarmRunId !== null && actualColdRunId === actualWarmRunId) {
    errors.push("cold and warm receipts resolve to the same GitHub workflow run");
  }
  if (coldRunId !== null && actualColdRunId !== coldRunId) errors.push(`cold receipts came from GitHub run ${actualColdRunId ?? "unknown"}, expected ${coldRunId}`);
  if (warmRunId !== null && actualWarmRunId !== warmRunId) errors.push(`warm receipts came from GitHub run ${actualWarmRunId ?? "unknown"}, expected ${warmRunId}`);

  for (const [cacheClass, values] of [["cold", cold], ["warm", warm]]) {
    const attempts = setValues(values, (receipt) => receipt?.ciProvenance?.githubRunAttempt);
    if (attempts.size !== 1) errors.push(`${cacheClass} receipts must come from exactly one workflow attempt, found ${attempts.size}`);
    const providers = setValues(values, (receipt) => receipt?.ciProvenance?.provider);
    if (providers.size !== 1 || !providers.has("github-actions")) errors.push(`${cacheClass} receipts must come only from GitHub Actions hosted runners`);
  }

  const candidateIdentities = setValues(receipts, (receipt) => COMMIT.test(receipt?.nodekitCommit ?? "") && SHA256.test(receipt?.nodekitSourceHash ?? "")
    ? `${receipt.nodekitCommit}/${receipt.nodekitSourceHash}`
    : null);
  if (candidateIdentities.size !== 1) errors.push(`hosted timing receipts must share one commit/source identity, found ${candidateIdentities.size}`);
  const tarballIdentities = setValues(receipts, (receipt) => SHA256.test(receipt?.nodekitTarballSha256 ?? "")
    ? `${receipt?.nodekitPackage ?? "unknown"}@${receipt?.nodekitVersion ?? "unknown"}/${receipt.nodekitTarballSha256}`
    : null);
  if (tarballIdentities.size !== 1) errors.push(`hosted timing receipts must share one package/tarball identity, found ${tarballIdentities.size}`);
  const workflowHashes = setValues(receipts, (receipt) => receipt?.ciProvenance?.workflowFileSha256);
  if (workflowHashes.size !== 1 || !SHA256.test([...workflowHashes][0] ?? "")) errors.push(`hosted timing receipts must share one valid workflow-file hash, found ${workflowHashes.size}`);
  const workflowRefs = setValues(receipts, (receipt) => receipt?.ciProvenance?.githubWorkflowRef);
  if (workflowRefs.size !== 1) errors.push(`hosted timing receipts must share one workflow ref, found ${workflowRefs.size}`);
  const githubShas = setValues(receipts, (receipt) => receipt?.ciProvenance?.githubSha);
  if (githubShas.size !== 1) errors.push(`hosted timing receipts must share one GitHub head SHA, found ${githubShas.size}`);
  if (expectedCommit !== null) {
    const actualCandidateCommits = setValues(receipts, (receipt) => receipt?.nodekitCommit);
    if (actualCandidateCommits.size !== 1 || !actualCandidateCommits.has(expectedCommit)) errors.push(`timing receipts are not bound to expected NodeKit commit ${expectedCommit}`);
    if (githubShas.size !== 1 || !githubShas.has(expectedCommit)) errors.push(`timing GitHub provenance is not bound to expected commit ${expectedCommit}`);
  }

  return errors;
}

export async function aggregateHostedDeveloperTiming({
  coldRunId,
  expectedCommit,
  inputDirectory,
  output,
  verdictOutput,
  warmRunId,
}) {
  const loaded = await readDeveloperTimingReceipts(inputDirectory);
  const receipts = loaded.map(({ receipt }) => receipt)
    .sort((left, right) => lexical(`${left?.lane}/${left?.cacheClass}/${left?.runId}`, `${right?.lane}/${right?.cacheClass}/${right?.runId}`));
  const receiptBytes = Buffer.from(`${JSON.stringify(receipts, null, 2)}\n`);
  const verdict = evaluateDeveloperTimingMatrix(receipts);
  const hostedErrors = validateHostedTimingPair(receipts, { coldRunId, expectedCommit, warmRunId });
  verdict.errors = [...new Set([...verdict.errors, ...hostedErrors])];
  verdict.passed = verdict.passed === true && hostedErrors.length === 0;
  verdict.supportingEvidence = [{
    kind: "timing-receipts",
    path: path.relative(process.cwd(), output).replaceAll("\\", "/"),
    sha256: sha256(receiptBytes),
  }];

  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(path.dirname(verdictOutput), { recursive: true });
  await writeFile(output, receiptBytes);
  await writeFile(verdictOutput, `${JSON.stringify(verdict, null, 2)}\n`);
  return {
    files: loaded.length,
    inputDirectory,
    output,
    passed: verdict.passed,
    uniqueRuns: new Set(receipts.map((receipt) => receipt?.runId)).size,
    verdict,
    verdictOutput,
  };
}
