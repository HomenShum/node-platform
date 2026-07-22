import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const port = 42731;
const runId = `browser_contract_${randomUUID()}`;
const child = spawn(process.execPath, [path.resolve("apps/web/server.mjs")], {
  env: { ...process.env, NODEKIT_BROWSER_RUN_ID: runId, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const health = response.ok ? await response.json() : null;
      ready = health?.certificationRunId === runId && health?.serverPid === child.pid;
      if (ready) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("browser-proof server did not become ready");
  const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
  const state = await fetch(`http://127.0.0.1:${port}/api/state`).then((response) => response.json());
  const assertions = {
    artifactPrimary: page.indexOf("Primary artifact") < page.indexOf("Agent activity"),
    currentActionVisible: page.includes("Current action") && Boolean(state.run.nextAction),
    mobileContractPresent: page.includes("viewport") && page.includes("review-tab"),
    proposalBoundaryVisible: /data-nodekit-review-boundary=["']proposal["']/.test(page),
    semanticLandmarks: /<main[\s>]/.test(page) && /<aside[\s>]/.test(page),
  };
  const receipt = { assertions, generatedAt: new Date().toISOString(), note: "Structural live HTTP and source-DOM contract only. This is not rendered-browser certification.", passed: Object.values(assertions).every(Boolean), schemaVersion: "nodekit.browser-contract/v1" };
  await mkdir("proof", { recursive: true });
  await writeFile(path.resolve("proof", "browser-contract.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await recordFriction(receipt.passed ? "browser_contract_completed" : "browser_contract_failed", assertions);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  child.kill();
}
