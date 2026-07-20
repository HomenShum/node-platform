import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function recordFriction(name, detail = {}, durationMs) {
  const file = path.resolve("proof", "build-friction.json");
  let receipt;
  try {
    receipt = JSON.parse(await readFile(file, "utf8"));
  } catch {
    receipt = { events: [], repairLoops: 0, schemaVersion: "nodekit.build-friction/v1" };
  }
  if (name.endsWith("_failed")) receipt.repairLoops = (receipt.repairLoops ?? 0) + 1;
  receipt.events.push({ at: new Date().toISOString(), detail, ...(durationMs === undefined ? {} : { durationMs }), name });
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
}
