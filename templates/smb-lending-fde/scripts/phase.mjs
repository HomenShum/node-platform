import { recordFriction } from "./lib/friction.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [phase, state = "completed", ...detailParts] = process.argv.slice(2);
if (!phase || !/^[a-z][a-z0-9-]*$/.test(phase)) throw new Error("usage: npm run phase -- <phase-name> [started|completed|failed] [detail]");
if (!new Set(["started", "completed", "failed"]).has(state)) throw new Error("phase state must be started, completed, or failed");
const normalized = phase.replaceAll("-", "_");
let durationMs;
if (state !== "started") {
  try {
    const receipt = JSON.parse(await readFile(path.resolve("proof", "build-friction.json"), "utf8"));
    const start = [...receipt.events].reverse().find((entry) => entry.name === `${normalized}_started`);
    if (start) durationMs = Math.max(0, Date.now() - Date.parse(start.at));
  } catch {
    // The recorder will create the receipt if this is the first event.
  }
}
await recordFriction(`${normalized}_${state}`, { note: detailParts.join(" ") || undefined }, durationMs);
console.log(`${phase} ${state}`);
