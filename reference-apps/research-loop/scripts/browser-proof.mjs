import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const observationsPath = path.resolve("proof", "browser", "qa-observations.json");
const observations = JSON.parse(await readFile(observationsPath, "utf8"));
const edge = JSON.parse(await readFile(path.resolve("proof", "edge-qa.json"), "utf8"));
const screenshotPaths = observations.screenshots ?? [];
const screenshots = [];
for (const relative of screenshotPaths) {
  const file = path.resolve(relative);
  const bytes = await readFile(file);
  const metadata = await stat(file);
  screenshots.push({ bytes: metadata.size, path: relative.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") });
}

const checks = {
  accessibilitySemantics: observations.accessibility?.passed === true,
  appOriginConsoleErrors: observations.console?.appOriginErrors === 0,
  edgeCases: edge.passed === true,
  mainFlow: observations.mainFlow?.passed === true,
  reloadPersistence: observations.reload?.passed === true,
  responsive: observations.responsive?.passed === true,
  screenshotsPresent: screenshots.length >= 4 && screenshots.every((entry) => entry.bytes > 0),
};
const passed = Object.values(checks).every(Boolean);
const completedAt = new Date().toISOString();
const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(observations.startedAt));
const receipt = {
  checks,
  completedAt,
  durationMs,
  observations,
  passed,
  schemaVersion: "nodekit.browser-proof/v1",
  screenshots,
};
await writeFile(path.resolve("proof", "browser-proof.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await recordFriction(passed ? "browser_qa_completed" : "browser_qa_failed", { checks }, durationMs);
console.log(JSON.stringify({ checks, durationMs, passed }, null, 2));
if (!passed) process.exitCode = 1;
