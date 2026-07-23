import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPiSmoke } from "../integrations/pi-ai/provider.mjs";
import { recordFriction } from "./lib/friction.mjs";

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 45_000);
try {
  const started = Date.now();
  const result = await runPiSmoke({ signal: controller.signal });
  await mkdir("proof", { recursive: true });
  await writeFile(path.resolve("proof", "pi-live-receipt.json"), `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`);
  await recordFriction("pi_live_smoke_passed", { model: result.model, provider: result.provider, totalTokens: result.usage.totalTokens }, Date.now() - started);
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(timeout);
}
