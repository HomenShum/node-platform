import path from "node:path";
import { prepareSubmissionManifest } from "../src/lib/submission-preparation.mjs";

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
    if (!["candidate", "repo-root", "output"].includes(name)) {
      throw new Error(`unknown option --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return { options, positional };
}

const { options, positional } = parseArguments(process.argv.slice(2));
const candidateRef = options.candidate ?? positional[0] ?? "HEAD";
const repoRoot = path.resolve(options["repo-root"] ?? positional[1] ?? ".");
const outputPath = options.output ?? positional[2] ?? "proof/submission-manifest.json";

const result = await prepareSubmissionManifest({ candidateRef, outputPath, repoRoot });
const passedGates = result.manifest.gates.filter((gate) => gate.passed).length;
console.log(JSON.stringify({
  candidateCommit: result.manifest.candidateCommit,
  outputPath: result.outputPath,
  passedGates,
  requiredGates: result.manifest.gates.length,
  sourceChanges: result.sourceChanges,
  sourceIsExact: result.sourceIsExact,
  submissionReady: passedGates === result.manifest.gates.length && result.sourceIsExact,
}, null, 2));
