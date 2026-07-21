import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

async function readJson(relative, required = true) {
  try { return JSON.parse(await readFile(path.resolve(relative), "utf8")); }
  catch (error) { if (!required && error.code === "ENOENT") return null; throw new Error(`missing or invalid ${relative}`); }
}

const [demo, evaluation, browser, identity] = await Promise.all([
  readJson("proof/demo-receipt.json"),
  readJson("proof/eval-receipt.json"),
  readJson("proof/browser-proof.json", false),
  readJson(".nodeagent/application-identity.json"),
]);
const checks = {
  browserQa: browser === null ? null : browser.passed === true,
  deterministicDemo: demo.passed === true,
  deterministicEvaluation: evaluation.passed === true,
  identityBound: typeof identity.applicationHash === "string" && typeof identity.configHash === "string",
  secretFree: !/(?:sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(JSON.stringify({ browser, demo, evaluation })),
};
const localReady = checks.deterministicDemo && checks.deterministicEvaluation && checks.identityBound && checks.secretFree;
const receipt = {
  applicationHash: identity.applicationHash,
  checks,
  configHash: identity.configHash,
  generatedAt: new Date().toISOString(),
  level: checks.browserQa === true && localReady ? "browser-certified" : "local-ready",
  missingReleaseGates: [...(browser === null ? ["browserQa"] : []), "deployment"],
  passed: localReady,
  releaseReady: false,
  schemaVersion: "nodekit.proof-receipt/v1",
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "release-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "proof_passed" : "proof_failed", checks);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
