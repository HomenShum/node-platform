import path from "node:path";
import { prepareSubmissionManifest } from "../src/lib/submission-preparation.mjs";
import { evaluateSubmissionManifest } from "../src/lib/submission-gate.mjs";
import { parseTrustedAttestationKeysJson } from "../src/lib/submission-attestation.mjs";

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
const trustedAttestationKeys = parseTrustedAttestationKeysJson(process.env.NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON ?? "{}");

const result = await prepareSubmissionManifest({ candidateRef, outputPath, repoRoot, trustedAttestationKeys });
const passedGates = result.manifest.gates.filter((gate) => gate.passed).length;
let evaluation;
try {
  evaluation = await evaluateSubmissionManifest(repoRoot, result.outputPath, { trustedAttestationKeys });
} catch (error) {
  evaluation = { errors: [error.message], passed: false };
}
console.log(JSON.stringify({
  candidateCommit: result.manifest.candidateCommit,
  outputPath: result.outputPath,
  passedGates,
  requiredGates: result.manifest.gates.length,
  sourceChanges: result.sourceChanges,
  sourceIsExact: result.sourceIsExact,
  // This status comes from the full evaluator, including cross-gate identity,
  // attestation, evidence-closure, and signed-candidate consistency checks.
  // Per-gate preparation booleans alone are never a publication decision.
  submissionReady: evaluation.passed === true,
  evaluationErrors: evaluation.errors ?? [],
}, null, 2));
