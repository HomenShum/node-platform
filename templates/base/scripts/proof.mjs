import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

async function readJson(relative, required = true) {
  try { return JSON.parse(await readFile(path.resolve(relative), "utf8")); }
  catch (error) { if (!required && error.code === "ENOENT") return null; throw new Error(`missing or invalid ${relative}`); }
}

const [demo, evaluation, browserContract, browserJourney, identity] = await Promise.all([
  readJson("proof/demo-receipt.json"),
  readJson("proof/eval-receipt.json"),
  readJson("proof/browser-contract.json", false),
  readJson("proof/browser-certification.json", false),
  readJson(".nodeagent/application-identity.json"),
]);
const checks = {
  browserContractPassed: browserContract === null ? null : browserContract.passed === true,
  browserJourneyPassed: browserJourney === null ? null : browserJourney.passed === true,
  browserCertified: browserJourney === null ? null : browserJourney.certified === true,
  deterministicDemo: demo.passed === true,
  deterministicEvaluation: evaluation.passed === true,
  identityBound: typeof identity.applicationHash === "string" && typeof identity.configHash === "string",
  secretFree: !/(?:sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(JSON.stringify({ browserContract, browserJourney, demo, evaluation })),
};
const suppliedBrowserEvidencePassed = checks.browserContractPassed !== false
  && checks.browserJourneyPassed !== false;
const localReady = checks.deterministicDemo
  && checks.deterministicEvaluation
  && checks.identityBound
  && checks.secretFree
  && suppliedBrowserEvidencePassed;
const receipt = {
  applicationHash: identity.applicationHash,
  checks,
  configHash: identity.configHash,
  generatedAt: new Date().toISOString(),
  level: checks.browserCertified === true && localReady ? "browser-certified" : "local-ready",
  missingReleaseGates: [...(checks.browserCertified === true ? [] : ["browserCertification"]), "deployment", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers"],
  passed: localReady,
  releaseReady: false,
  schemaVersion: "nodekit.proof-receipt/v1",
};
await mkdir("proof", { recursive: true });
await writeFile(path.resolve("proof", "release-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(receipt.passed ? "proof_passed" : "proof_failed", checks);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
