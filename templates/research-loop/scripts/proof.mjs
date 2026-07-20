import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();

async function readJson(name, required = true) {
  try {
    return JSON.parse(await readFile(path.resolve("proof", name), "utf8"));
  } catch (error) {
    if (!required && error.code === "ENOENT") return null;
    throw new Error(`missing or invalid proof/${name}; run the corresponding gate first`);
  }
}

const [demo, evaluation, live, browser, deployment, friction] = await Promise.all([
  readJson("demo-receipt.json"),
  readJson("eval-receipt.json"),
  readJson("pi-live-receipt.json", false),
  readJson("browser-proof.json", false),
  readJson("deployment-receipt.json", false),
  readJson("build-friction.json"),
]);
const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
const secretFree = !secretPattern.test(JSON.stringify({ browser, demo, deployment, evaluation, live, friction }));
const deterministicDemo = demo.schemaVersion === "nodekit.experiment-receipt/v1";
const deterministicEvaluation = evaluation.passed === true;
const livePi = live === null ? null : live.status === "pass";
const browserQa = browser === null ? null : browser.passed === true;
const deploymentPassed = deployment === null
  ? null
  : deployment.passed === true || deployment.status === "pass";
const optionalChecksPassed = [livePi, browserQa, deploymentPassed]
  .every((value) => value === null || value === true);
const localReady = deterministicDemo && deterministicEvaluation && secretFree && optionalChecksPassed;
const releaseReady = localReady && livePi === true && browserQa === true && deploymentPassed === true;
const receipt = {
  checks: {
    deterministicDemo,
    deterministicEvaluation,
    livePi,
    browserQa,
    deployment: deploymentPassed,
    secretFree,
  },
  generatedAt: new Date().toISOString(),
  level: releaseReady ? "release-ready" : "local-ready",
  missingReleaseGates: [
    ...(live === null ? ["livePi"] : []),
    ...(browser === null ? ["browserQa"] : []),
    ...(deployment === null ? ["deployment"] : []),
  ],
  passed: localReady,
  releaseReady,
  schemaVersion: "nodekit.proof-receipt/v1",
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "release-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "proof_passed" : "proof_failed", receipt.checks, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
else if (receipt.releaseReady) await import("./timeline.mjs");
