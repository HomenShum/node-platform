import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const friction = JSON.parse(await readFile(path.resolve("proof", "build-friction.json"), "utf8"));
const first = friction.events.find((entry) => entry.name === "launch_started") ?? friction.events[0];
const last = friction.events.at(-1);
const elapsedMs = Math.max(0, Date.parse(last.at) - Date.parse(first.at));
const durations = Object.fromEntries(friction.events.filter((entry) => Number.isFinite(entry.durationMs)).map((entry) => [entry.name, entry.durationMs]));
const required = ["research_completed", "scaffold_completed", "install_completed", "implementation_completed", "compile_completed", "deterministic_demo_passed", "tests_passed", "eval_passed", "pi_live_smoke_passed", "browser_qa_completed", "deployment_completed", "proof_passed"];
const observed = new Set(friction.events.map((entry) => entry.name));
const missing = required.filter((name) => !observed.has(name));
const report = {
  budget: { hackathonHours: [2, 4], targetMinutes: 30 },
  durations,
  elapsedMinutes: Number((elapsedMs / 60_000).toFixed(2)),
  missing,
  passed: missing.length === 0 && elapsedMs <= 30 * 60_000,
  schemaVersion: "nodekit.launch-timeline/v1",
};
await writeFile(path.resolve("proof", "launch-timeline.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
