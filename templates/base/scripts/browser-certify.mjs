import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const startedAt = new Date().toISOString();
const started = performance.now();
const runId = process.env.NODEKIT_EASE_RUN_ID ?? `ease_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const port = Number(process.env.NODEKIT_BROWSER_PORT ?? 43000 + (process.pid % 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const evidenceRoot = path.resolve("proof", "ease", runId);
const browserRoot = path.join(evidenceRoot, "browser");
const screenshotRoot = path.join(evidenceRoot, "browser", "screenshots");
const identity = JSON.parse(await readFile(path.resolve(".nodeagent", "application-identity.json"), "utf8"));
const generatedCandidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const nodekitCommit = process.env.NODEKIT_SOURCE_COMMIT ?? null;
const nodekitSourceHash = process.env.NODEKIT_SOURCE_HASH ?? null;
const requiredStates = [
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
];
const viewports = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "wide", width: 1920, height: 1080 },
  { id: "tablet-landscape", width: 1024, height: 768 },
  { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "mobile-portrait", width: 390, height: 844 },
  { id: "mobile-landscape", width: 844, height: 390 },
];
const screenshots = [];
const globalConsole = [];
const globalNetwork = [];
const accessibilityViolations = [];
const phases = [];
const milestones = [];
const evidenceArtifacts = [];
const journeyAssertions = {
  approvalApplied: false,
  proposalVisible: false,
  receiptSurvivedReload: false,
  receiptVisible: false,
};
let firstMeaningfulPaintMs = null;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mark(name, phaseStarted) {
  phases.push({ at: new Date().toISOString(), durationMs: Math.round(performance.now() - phaseStarted), name });
}

function milestone(name) {
  if (!milestones.some((entry) => entry.name === name)) milestones.push({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), name });
}

async function recordArtifact(id, absolutePath) {
  const bytes = await readFile(absolutePath);
  evidenceArtifacts.push({ byteSize: (await stat(absolutePath)).size, id, path: path.relative(evidenceRoot, absolutePath).replaceAll("\\", "/"), sha256: sha256(bytes) });
}

async function waitForServer() {
  const phaseStarted = performance.now();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const health = response.ok ? await response.json() : null;
      if (health?.certificationRunId === runId && health?.serverPid === server.pid) {
        mark("server_readiness", phaseStarted);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Playwright certification server did not become ready");
}

async function capture(page, state, viewport, theme, observations) {
  const relativePng = path.join("browser", "screenshots", `${state}--${viewport.id}--${theme}.png`);
  const absolutePng = path.join(evidenceRoot, relativePng);
  const bytes = await page.screenshot({ path: absolutePng });
  const horizontalOverflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const renderedText = await page.locator("body").innerText();
  const sidecar = {
    applicationHash: identity.applicationHash,
    capturedAt: new Date().toISOString(),
    configHash: identity.configHash,
    consoleErrors: observations.consoleErrors.length,
    elapsedMs: Math.round(performance.now() - started),
    failedRequests: observations.failedRequests.length,
    generatedCandidateCommit,
    horizontalOverflowPx,
    mojibakeDetected: /(?:Â|Ã|â€)/.test(renderedText),
    nodekitCommit,
    nodekitSourceHash,
    pageUrl: page.url(),
    pngSha256: sha256(bytes),
    runId,
    schemaVersion: "nodekit.screenshot-proof/v1",
    serverProcess: { command: `${process.execPath} apps/web/server.mjs`, pid: server.pid },
    state,
    theme,
    viewport: { height: viewport.height, width: viewport.width },
  };
  const sidecarPath = absolutePng.replace(/\.png$/i, ".json");
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  screenshots.push({
    ...sidecar,
    path: relativePng.replaceAll("\\", "/"),
    sidecarPath: path.relative(evidenceRoot, sidecarPath).replaceAll("\\", "/"),
  });
}

await mkdir(screenshotRoot, { recursive: true });
await mkdir(path.join(browserRoot, "video"), { recursive: true });
const server = spawn(process.execPath, [path.resolve("apps", "web", "server.mjs")], {
  env: { ...process.env, NODEKIT_BROWSER_RUN_ID: runId, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
let passed = false;
let error = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    for (const theme of ["light", "dark"]) {
      const canonicalJourney = viewport.id === "desktop" && theme === "light";
      const context = await browser.newContext({
        colorScheme: theme,
        ...(canonicalJourney ? { recordVideo: { dir: path.join(browserRoot, "video"), size: { height: 900, width: 1440 } } } : {}),
        reducedMotion: viewport.id === "mobile-portrait" ? "reduce" : "no-preference",
        viewport: { height: viewport.height, width: viewport.width },
      });
      if (canonicalJourney) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      const video = canonicalJourney ? page.video() : null;
      const observations = { consoleErrors: [], failedRequests: [] };
      page.on("console", (message) => {
        if (message.type() === "error") observations.consoleErrors.push({ text: message.text(), type: message.type() });
      });
      page.on("requestfailed", (request) => observations.failedRequests.push({ error: request.failure()?.errorText ?? "unknown", url: request.url() }));
      if (canonicalJourney) {
        const resetResponse = await fetch(`${baseUrl}/api/reset`, { method: "POST" });
        if (!resetResponse.ok) throw new Error(`canonical journey reset failed with HTTP ${resetResponse.status}`);
        milestone("canonical_state_reset");
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.locator("#case-title").waitFor();
        firstMeaningfulPaintMs = Math.round(performance.now() - started);
        milestone("first_meaningful_paint");
        milestone("neutral_case_visible");
        await page.locator("#propose").click();
        await page.locator("#proposal strong").waitFor();
        journeyAssertions.proposalVisible = true;
        milestone("proposal_visible");
        await page.locator("#approve").click();
        await page.locator("#completion").waitFor({ state: "visible" });
        journeyAssertions.approvalApplied = true;
        journeyAssertions.receiptVisible = (await page.locator("#receipt-id").innerText()).startsWith("Receipt ");
        milestone("approval_applied");
        milestone("receipt_visible");
        const receiptBeforeReload = await page.locator("#receipt-id").innerText();
        await page.reload({ waitUntil: "networkidle" });
        journeyAssertions.receiptSurvivedReload = (await page.locator("#receipt-id").innerText()) === receiptBeforeReload;
        milestone("receipt_reload_confirmed");
      }
      for (const state of requiredStates) {
        await page.goto(`${baseUrl}/?scenario=${state}`, { waitUntil: "networkidle" });
        await page.locator("#case-title").waitFor();
        await page.locator(`body[data-scenario="${state}"]`).waitFor();
        if (firstMeaningfulPaintMs === null) firstMeaningfulPaintMs = Math.round(performance.now() - started);
        if (state === "first_arrival") {
          const inputBox = await page.locator("#primary-input").boundingBox();
          const actionBox = await page.locator("#primary-input button").boundingBox();
          const visibleInputHeight = inputBox ? Math.max(0, Math.min(inputBox.y + inputBox.height, viewport.height) - Math.max(inputBox.y, 0)) : 0;
          if (!inputBox || !actionBox || visibleInputHeight < Math.min(88, inputBox.height)
            || actionBox.y < 0 || actionBox.y + actionBox.height > viewport.height) {
            throw new Error(`primary action is not visible on first arrival for ${viewport.id}/${theme}: ${JSON.stringify({ actionBox, inputBox, viewport, visibleInputHeight })}`);
          }
          if (await page.locator("#reset").isVisible()) {
            throw new Error(`reset control distracts from the first action for ${viewport.id}/${theme}`);
          }
        }
        if (state === "validation_error") {
          await page.locator("#outcome").fill("");
          await page.locator("#primary-input button").click();
          await page.locator("#error").waitFor({ state: "visible" });
        }
        if (state === "approval") await page.locator("#approve").focus();
        if (state === "receipt_inspection" || state === "export_share") {
          await page.locator("#receipt-detail").waitFor({ state: "visible" });
          if (viewport.id === "mobile-landscape" || viewport.id === "mobile-portrait") await page.locator("#receipt-detail").scrollIntoViewIfNeeded();
        }
        if (state === "recoverable_failure" || state === "external_wait") await page.locator("#exception").waitFor({ state: "visible" });
        if (state === "conflict") {
          const copy = await page.locator("#proposal").innerText();
          if (!copy.includes("conflicted")) throw new Error(`conflict state was not visible for ${viewport.id}/${theme}`);
        }
        if (viewport.id === "desktop" && theme === "light") {
          const axe = await new AxeBuilder({ page }).analyze();
          accessibilityViolations.push(...axe.violations
            .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
            .map((violation) => ({
              help: violation.help,
              id: violation.id,
              impact: violation.impact,
              nodes: violation.nodes.map((node) => node.target),
              state,
            })));
        }
        await capture(page, state, viewport, theme, observations);
        if (state === "reload_resume") {
          const proposalBeforeReload = await page.locator("#proposal").innerText();
          await page.reload({ waitUntil: "networkidle" });
          const proposalAfterReload = await page.locator("#proposal").innerText();
          if (!proposalBeforeReload.includes("Proposed change") || proposalAfterReload !== proposalBeforeReload) {
            throw new Error(`proposal did not survive reload for ${viewport.id}/${theme}`);
          }
        }
        if (state === "completed_receipt") {
          const receiptBeforeReload = await page.locator("#receipt-id").innerText();
          await page.reload({ waitUntil: "networkidle" });
          const receiptAfterReload = await page.locator("#receipt-id").innerText();
          if (!receiptBeforeReload.startsWith("Receipt ") || receiptAfterReload !== receiptBeforeReload) {
            throw new Error(`receipt did not survive reload for ${viewport.id}/${theme}`);
          }
        }
      }
      globalConsole.push(...observations.consoleErrors.map((entry) => ({ ...entry, theme, viewport: viewport.id })));
      globalNetwork.push(...observations.failedRequests.map((entry) => ({ ...entry, theme, viewport: viewport.id })));
      if (canonicalJourney) await context.tracing.stop({ path: path.join(browserRoot, "playwright-trace.zip") });
      await context.close();
      if (canonicalJourney && video) {
        const recordedVideo = await video.path();
        await copyFile(recordedVideo, path.join(browserRoot, "journey.webm"));
        await rm(path.join(browserRoot, "video"), { force: true, recursive: true });
        await recordArtifact("playwright-trace", path.join(browserRoot, "playwright-trace.zip"));
        await recordArtifact("browser-video", path.join(browserRoot, "journey.webm"));
      }
      await fetch(`${baseUrl}/api/reset`, { method: "POST" });
    }
  }
  passed = screenshots.length === viewports.length * 2 * requiredStates.length
    && accessibilityViolations.length === 0
    && evidenceArtifacts.length === 2
    && Object.values(journeyAssertions).every(Boolean)
    && screenshots.every((entry) => entry.consoleErrors === 0 && entry.failedRequests === 0 && entry.horizontalOverflowPx === 0 && entry.mojibakeDetected === false);
} catch (caught) {
  error = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
} finally {
  await browser?.close();
  server.kill();
}

const coveredStates = [...new Set(screenshots.map((entry) => entry.state))];
const missingStates = requiredStates.filter((state) => !coveredStates.includes(state));
const manifest = {
  accessibilityViolations,
  applicationHash: identity.applicationHash,
  certified: passed && missingStates.length === 0 && Boolean(nodekitCommit) && Boolean(nodekitSourceHash),
  configHash: identity.configHash,
  consoleErrors: globalConsole,
  coveredStates,
  durationMs: Math.round(performance.now() - started),
  error,
  evidenceArtifacts,
  firstMeaningfulPaintMs,
  generatedAt: new Date().toISOString(),
  generatedCandidateCommit,
  journeyAssertions,
  milestones,
  missingStates,
  networkFailures: globalNetwork,
  nodekitCommit,
  nodekitSourceHash,
  passed,
  phases,
  requiredStates,
  runId,
  schemaVersion: "nodekit.browser-certification/v1",
  serverProcess: { command: `${process.execPath} apps/web/server.mjs`, pid: server.pid },
  screenshots,
  startedAt,
  verdict: passed && missingStates.length === 0 ? "BROWSER_CERTIFIED" : "BROWSER_JOURNEY_PASS_COVERAGE_INCOMPLETE",
};
manifest.manifestSha256 = sha256(Buffer.from(JSON.stringify(manifest)));
await writeFile(path.join(evidenceRoot, "browser", "console.jsonl"), globalConsole.map((entry) => JSON.stringify(entry)).join("\n") + (globalConsole.length ? "\n" : ""));
await writeFile(path.join(evidenceRoot, "browser", "network.jsonl"), globalNetwork.map((entry) => JSON.stringify(entry)).join("\n") + (globalNetwork.length ? "\n" : ""));
await writeFile(path.join(evidenceRoot, "browser", "screenshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.resolve("proof", "browser-certification.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
if (!passed) process.exitCode = 1;
