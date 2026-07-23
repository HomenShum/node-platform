import path from "node:path";
import { aggregateHostedDeveloperTiming } from "../src/lib/developer-timing-aggregation.mjs";

function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const [rawName, inlineValue] = argument.slice(2).split(/=(.*)/s, 2);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${rawName} requires a value`);
    options[rawName] = value;
  }
  return { options, positional };
}

const { options, positional } = parseArguments(process.argv.slice(2));
const inputDirectory = path.resolve(positional[0] ?? "proof/ease/downloaded");
const output = path.resolve(positional[1] ?? "proof/ease/developer-timing-runs.json");
const verdictOutput = path.resolve(positional[2] ?? "proof/ease/developer-timing-verdict.json");
const result = await aggregateHostedDeveloperTiming({
  coldRunId: options["cold-run-id"] ?? process.env.NODEKIT_COLD_GITHUB_RUN_ID,
  expectedCommit: options["expected-commit"] ?? process.env.NODEKIT_EXPECTED_COMMIT,
  inputDirectory,
  output,
  verdictOutput,
  warmRunId: options["warm-run-id"] ?? process.env.NODEKIT_WARM_GITHUB_RUN_ID,
});
console.log(JSON.stringify({
  errors: result.verdict.errors,
  files: result.files,
  inputDirectory: result.inputDirectory,
  output: result.output,
  passed: result.passed,
  uniqueRuns: result.uniqueRuns,
  verdictOutput: result.verdictOutput,
}, null, 2));
if (!result.passed) process.exitCode = 1;
