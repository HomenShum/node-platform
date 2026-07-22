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
for (const file of files) {
  const receipt = JSON.parse(await readFile(file, "utf8"));
  if (receipt.schemaVersion !== "nodekit.developer-timing-run/v1") throw new Error(`${file}: unexpected schemaVersion`);
  if (byRun.has(receipt.runId)) throw new Error(`duplicate timing runId ${receipt.runId}`);
  byRun.set(receipt.runId, receipt);
}
const receipts = [...byRun.values()].sort((a, b) => `${a.lane}/${a.cacheClass}/${a.runId}`.localeCompare(`${b.lane}/${b.cacheClass}/${b.runId}`));
const verdict = evaluateDeveloperTimingMatrix(receipts);
await writeFile(output, `${JSON.stringify(receipts, null, 2)}\n`);
await writeFile(output.replace(/\.json$/, "-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, output, ...verdict }, null, 2));
if (!verdict.passed) process.exitCode = 1;
