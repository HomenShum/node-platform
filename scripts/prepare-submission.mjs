import path from "node:path";
import { prepareSubmissionManifest } from "../src/lib/submission-preparation.mjs";

const candidateRef = process.argv[2] ?? "HEAD";
const repoRoot = path.resolve(process.argv[3] ?? ".");
const outputPath = process.argv[4] ?? "proof/submission-manifest.json";

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
