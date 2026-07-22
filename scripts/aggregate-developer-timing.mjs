import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDeveloperTimingMatrix } from "../src/lib/ease-evidence.mjs";

const root = path.resolve(process.argv[2] ?? "proof/ease/downloaded");
const output = path.resolve(process.argv[3] ?? "proof/ease/developer-timing-runs.json");

async function findReceipts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return findReceipts(absolute);
    return entry.name === "developer-timing-run.json" ? [absolute] : [];
  }));
  return nested.flat();
}

const files = await findReceipts(root);
const byRun = new Map();
let duplicateCopies = 0;
for (const file of files) {
  const receipt = JSON.parse(await readFile(file, "utf8"));
  if (receipt.schemaVersion !== "nodekit.developer-timing-run/v1") throw new Error(`${file}: unexpected schemaVersion`);
  const existing = byRun.get(receipt.runId);
  if (existing) {
    if (JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) {
      throw new Error(`conflicting timing receipts for runId ${receipt.runId}: ${existing.file} and ${file}`);
    }
    duplicateCopies += 1;
    continue;
  }
  byRun.set(receipt.runId, { file, receipt });
}
const receipts = [...byRun.values()].map(({ receipt }) => receipt).sort((a, b) => `${a.lane}/${a.cacheClass}/${a.runId}`.localeCompare(`${b.lane}/${b.cacheClass}/${b.runId}`));
const verdict = evaluateDeveloperTimingMatrix(receipts);
await writeFile(output, `${JSON.stringify(receipts, null, 2)}\n`);
await writeFile(output.replace(/\.json$/, "-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, uniqueRuns: receipts.length, duplicateCopies, output, ...verdict }, null, 2));
if (!verdict.passed) process.exitCode = 1;
