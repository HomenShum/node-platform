import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.resolve("proof", name), "utf8"));
  } catch {
    throw new Error(`missing or invalid proof/${name}; run the corresponding gate first`);
  }
}

const [demo, evaluation, benchmark, friction, applicationIdentity] = await Promise.all([
  readJson("demo-receipt.json"),
  readJson("eval-receipt.json"),
  readJson("agentic-rl-benchmark.json"),
  readJson("build-friction.json"),
  readFile(path.resolve(".nodeagent", "application-identity.json"), "utf8").then(JSON.parse),
]);
const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
const checks = {
  deterministicDemo: demo.schemaVersion === "nodekit.founderquest-rl-receipt/v1",
  deterministicEvaluation: evaluation.passed === true,
  identityBound: typeof applicationIdentity.applicationHash === "string" && typeof applicationIdentity.configHash === "string",
  protectedHeldout: benchmark.assertions?.heldoutProtected === true,
  secretFree: !secretPattern.test(JSON.stringify({ benchmark, demo, evaluation, friction })),
  unsafeActionRejected: benchmark.assertions?.unsafeActionRejected === true,
};
const passed = Object.values(checks).every(Boolean);
const receipt = {
  applicationHash: applicationIdentity.applicationHash,
  checks,
  configHash: applicationIdentity.configHash,
  generatedAt: new Date().toISOString(),
  level: passed ? "local-research-ready" : "blocked",
  limitations: [
    "No actual reinforcement-learning training occurred.",
    "No external provider, browser, deployment, business, legal, financial, healthcare, or regulatory workflow was used.",
    "Promotion beyond replay requires an independently designed environment, frozen heldout scorer, human safety review, browser proof, and authorized deployment review.",
  ],
  missingReleaseGates: ["human-approved-training-plan", "browserQa", "deployment"],
  passed,
  releaseReady: false,
  schemaVersion: "nodekit.proof-receipt/v1",
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "release-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(passed ? "proof_passed" : "proof_failed", checks, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!passed) process.exitCode = 1;
