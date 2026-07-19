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
  readJson("pi-live-receipt.json"),
  readJson("browser-proof.json"),
  readJson("deployment-receipt.json"),
  readJson("build-friction.json"),
]);
const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
const secretFree = !secretPattern.test(JSON.stringify({ browser, demo, deployment, evaluation, live, friction }));
const deploymentPassed = deployment.passed === true || deployment.status === "pass";
const receipt = {
  checks: {
    deterministicDemo: demo.schemaVersion === "nodekit.experiment-receipt/v1",
    deterministicEvaluation: evaluation.passed === true,
    livePi: live.status === "pass",
    browserQa: browser.passed === true,
    deployment: deploymentPassed,
    secretFree,
  },
  generatedAt: new Date().toISOString(),
  passed: evaluation.passed === true && live.status === "pass" && browser.passed === true && deploymentPassed && secretFree,
  schemaVersion: "nodekit.release-proof/v1",
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "release-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "proof_passed" : "proof_failed", receipt.checks, Date.now() - started);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
else await import("./timeline.mjs");
