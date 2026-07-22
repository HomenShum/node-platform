import path from "node:path";
import { writeFile } from "node:fs/promises";
import { evaluateSubmissionManifest } from "../src/lib/submission-gate.mjs";

function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!["repo-root", "manifest", "output"].includes(name)) throw new Error(`unknown option --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return { options, positional };
}

const { options, positional } = parseArguments(process.argv.slice(2));
const repoRoot = path.resolve(options["repo-root"] ?? positional[0] ?? ".");
const manifest = options.manifest ?? positional[1] ?? "proof/submission-manifest.json";
const outputPath = options.output ?? "proof/submission-verdict.json";
const output = await evaluateSubmissionManifest(repoRoot, manifest);
await writeFile(path.resolve(repoRoot, outputPath), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 1;
