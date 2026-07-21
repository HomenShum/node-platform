import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDeveloperTimingMatrix, evaluateFreshUserStudy } from "../src/lib/ease-evidence.mjs";

const [mode, inputArg, outputArg] = process.argv.slice(2);
if (!mode || !["developer", "humans"].includes(mode)) {
  console.error("usage: node scripts/evaluate-ease-evidence.mjs <developer|humans> [input.json] [output.json]");
  process.exit(2);
}
const input = path.resolve(inputArg ?? (mode === "humans" ? "proof/ease/fresh-users.json" : "proof/ease/developer-timing-runs.json"));
const output = path.resolve(outputArg ?? (mode === "humans" ? "proof/ease/fresh-users-verdict.json" : "proof/ease/developer-timing-verdict.json"));
let value;
try {
  value = JSON.parse(await readFile(input, "utf8"));
} catch (error) {
  console.error(`unable to read ${input}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const verdict = mode === "humans" ? evaluateFreshUserStudy(value) : evaluateDeveloperTimingMatrix(Array.isArray(value) ? value : value.runs ?? []);
await writeFile(output, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.passed ? 0 : 1);
