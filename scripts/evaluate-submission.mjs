import path from "node:path";
import { writeFile } from "node:fs/promises";
import { evaluateSubmissionManifest } from "../src/lib/submission-gate.mjs";

const repoRoot = path.resolve(process.argv[2] ?? ".");
const manifest = process.argv[3] ?? "proof/submission-manifest.json";
const output = await evaluateSubmissionManifest(repoRoot, manifest);
await writeFile(path.join(repoRoot, "proof", "submission-verdict.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 1;
