import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "proof/ease/agents");
const output = path.resolve(process.argv[3] ?? "proof/ease/fresh-agent-verdict.json");
const requiredTasks = ["research-map", "volunteer-onboarding", "launch-presentation"];

const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
const manifests = [];
for (const entry of directories) {
  if (!entry.isDirectory()) continue;
  const file = path.join(root, entry.name, "manifest.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.schemaVersion === "nodekit.agent-ease-trial/v1") manifests.push(value);
  } catch {
    // Incomplete or non-trial evidence is not silently promoted.
  }
}

const errors = [];
const selected = [];
for (const taskId of requiredTasks) {
  const passing = manifests
    .filter((entry) => entry.taskId === taskId && entry.passed === true)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  if (passing.length === 0) {
    errors.push(`${taskId}: no passing authentic trial`);
    continue;
  }
  const trial = passing[0];
  if (trial.interventions !== 0 || trial.userReprompts !== 0) errors.push(`${taskId}: intervention or reprompt recorded`);
  if (!Array.isArray(trial.substantiveFiles) || trial.substantiveFiles.length === 0) errors.push(`${taskId}: no substantive files`);
  if (!trial.checks || !Object.values(trial.checks).every(Boolean)) errors.push(`${taskId}: one or more required checks failed`);
  if (!/^[a-f0-9]{40}$/.test(trial.nodekitCommit ?? "")) errors.push(`${taskId}: missing immutable NodeKit commit`);
  if (!/^[a-f0-9]{64}$/.test(trial.nodekitSourceHash ?? "")) errors.push(`${taskId}: missing NodeKit source hash`);
  selected.push(trial);
}
const identities = new Set(selected.map((entry) => `${entry.nodekitCommit}/${entry.nodekitSourceHash}`));
if (identities.size > 1) errors.push("held-out trials do not share one immutable NodeKit identity");
const verdict = {
  errors,
  nodekitCommit: identities.size === 1 ? [...identities][0].split("/")[0] : null,
  nodekitSourceHash: identities.size === 1 ? [...identities][0].split("/")[1] : null,
  nodekitIdentity: identities.size === 1 ? [...identities][0] : null,
  observedTrials: manifests.length,
  passed: errors.length === 0 && selected.length === requiredTasks.length,
  requiredTasks,
  schemaVersion: "nodekit.fresh-agent-verdict/v1",
  selectedRuns: selected.map((entry) => ({ runId: entry.runId, taskId: entry.taskId, receiptSha256: entry.receiptSha256 })),
};
await writeFile(output, `${JSON.stringify(verdict, null, 2)}\n`);
console.log(JSON.stringify(verdict, null, 2));
if (!verdict.passed) process.exitCode = 1;
