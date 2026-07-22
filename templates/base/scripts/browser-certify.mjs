import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { contentHash } from "@homenshum/nodekit/caseflow";
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
const pendingReviewStates = new Set(["proposal_pending", "approval", "reload_resume"]);
const completedReviewStates = new Set(["completed_receipt", "receipt_inspection", "export_share"]);
const intakeReviewStates = new Set(["first_arrival", "orientation", "input", "validation_error"]);
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
  activityModeOperable: false,
  approvalApplied: false,
  conflictRecovered: false,
  exceptionRecovered: false,
  exportBlockedBeforeCompletion: false,
  exportDownloadedAndVerified: false,
  outcomeConfirmed: false,
  proposalBlockedBeforeConfirmation: false,
  proposalVisible: false,
  receiptSurvivedReload: false,
  receiptVisible: false,
  shareSummaryProduced: false,
  stateActionsCoherent: false,
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

async function verifyExportedProof(absolutePath) {
  const bundle = JSON.parse(await readFile(absolutePath, "utf8"));
  if (bundle.schemaVersion !== "nodekit.portable-proof-bundle/v1") throw new Error("exported proof bundle schema is invalid");
  if (bundle.receipt?.schemaVersion !== "nodekit.receipt/v2") throw new Error("exported receipt schema is invalid");
  if (bundle.case?.caseId !== bundle.run?.caseId || bundle.run?.runId !== bundle.receipt?.runId) {
    throw new Error("exported case, run, and receipt identities do not match");
  }
  const artifact = bundle.artifact;
  const canonicalVersion = artifact?.versions?.find((entry) => entry.version === artifact.canonicalVersion);
  if (!canonicalVersion || canonicalVersion.contentHash !== contentHash(canonicalVersion.content)) {
    throw new Error("exported canonical artifact content hash is invalid");
  }
  const binding = bundle.receipt.artifactBindings?.find((entry) => entry.artifactId === artifact.artifactId);
  if (!binding || binding.canonicalVersion !== artifact.canonicalVersion || binding.contentHash !== canonicalVersion.contentHash) {
    throw new Error("exported receipt is not bound to the canonical artifact version");
  }
  const { receiptHash, receiptId, ...receiptBody } = bundle.receipt;
  if (!receiptId || receiptHash !== contentHash(receiptBody)) throw new Error("exported receipt hash is invalid");
  return bundle;
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
    mojibakeDetected: /(?:\u00c2\S|\u00c3.|\ufffd|\u00e2[\u0080-\u00bf]{1,2})/u.test(renderedText),
    nodekitCommit,
    nodekitIdentity: nodekitCommit && nodekitSourceHash ? `${nodekitCommit}/${nodekitSourceHash}` : null,
    nodekitSourceHash,
    pageUrl: page.url(),
    pngSha256: sha256(bytes),
    runId,
    schemaVersion: "nodekit.screenshot-proof/v1",
    serverProcess: { command: `${process.execPath} apps/web/server.mjs`, pid: server.pid },
    state,
    theme,
    viewportId: viewport.id,
    viewport: { height: viewport.height, width: viewport.width },
  };
  const sidecarPath = absolutePng.replace(/\.png$/i, ".json");
  const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
  await writeFile(sidecarPath, sidecarBytes);
  screenshots.push({
    ...sidecar,
    path: relativePng.replaceAll("\\", "/"),
    pngBytes: bytes.length,
    sidecarBytes: sidecarBytes.length,
    sidecarPath: path.relative(evidenceRoot, sidecarPath).replaceAll("\\", "/"),
    sidecarSha256: sha256(sidecarBytes),
  });
}

async function assertReviewState(page, state, viewport, theme) {
  const context = `${state}/${viewport.id}/${theme}`;
  const mobile = viewport.width <= 640;
  const expectation = completedReviewStates.has(state)
    ? { action: "none", eyebrow: "VERIFIED RESULT", title: "Completion evidence" }
    : state === "conflict"
      ? { action: "conflict", eyebrow: "CONFLICT CONTAINED", title: "Resolve version conflict" }
      : state === "recoverable_failure"
        ? { action: "recovery", eyebrow: "RECOVERY REQUIRED", title: "Resume from preserved state" }
        : state === "external_wait"
          ? { action: "none", eyebrow: "WAITING SAFELY", title: "External reviewer owns the next action" }
          : pendingReviewStates.has(state)
            ? { action: "pending", eyebrow: "DECISION REQUIRED", title: "Review proposed change" }
            : intakeReviewStates.has(state)
              ? { action: "none", eyebrow: "NEXT STEP", title: "Confirm the intended outcome" }
              : { action: "propose", eyebrow: "NEXT STEP", title: "Prepare a reviewable change" };
  const eyebrow = (await page.locator("#review-eyebrow").innerText()).trim();
  const title = (await page.locator("#review-title").innerText()).trim();
  if (eyebrow !== expectation.eyebrow || title !== expectation.title) {
    throw new Error(`review state copy is incoherent for ${context}: ${JSON.stringify({ eyebrow, expectedEyebrow: expectation.eyebrow, title, expectedTitle: expectation.title })}`);
  }
  const visible = expectation.action === "pending"
    ? mobile ? ["mobile-approve", "mobile-reject"] : ["approve", "reject"]
    : expectation.action === "conflict"
      ? [mobile ? "mobile-resolve-conflict" : "resolve-conflict"]
      : expectation.action === "recovery"
        ? [mobile ? "mobile-resume" : "resume"]
      : expectation.action === "propose" ? [mobile ? "mobile-propose" : "propose"] : [];
  const controls = ["propose", "approve", "reject", "resume", "resolve-conflict", "mobile-propose", "mobile-approve", "mobile-reject", "mobile-resume", "mobile-resolve-conflict"];
  for (const id of visible) {
    if (!(await page.locator(`#${id}`).isVisible())) throw new Error(`${id} should be visible for ${context}`);
  }
  for (const id of controls.filter((id) => !visible.includes(id))) {
    if (!(await page.locator(`#${id}`).isHidden())) throw new Error(`${id} should be hidden for ${context}`);
  }
  if (mobile && visible.length > 0) {
    const actionBox = await page.locator("#mobile-action").boundingBox();
    if (!actionBox || actionBox.x < 0 || actionBox.y < 0 || actionBox.x + actionBox.width > viewport.width || actionBox.y + actionBox.height > viewport.height) {
      throw new Error(`mobile current action is outside the initial viewport for ${context}: ${JSON.stringify(actionBox)}`);
    }
  }
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
        await page.locator("#activity-tab").click();
        const activityOpened = await page.locator("#activity").getAttribute("open");
        const activityPressed = await page.locator("#activity-tab").getAttribute("aria-pressed");
        await page.locator("#review-tab").click();
        journeyAssertions.activityModeOperable = activityOpened !== null
          && activityPressed === "true"
          && await page.locator("#activity").getAttribute("open") === null
          && await page.locator("#review-tab").getAttribute("aria-pressed") === "true";
        milestone("activity_mode_verified");
        const prematureExport = await page.request.get(`${baseUrl}/api/export`);
        journeyAssertions.exportBlockedBeforeCompletion = !prematureExport.ok();
        if (prematureExport.ok()) throw new Error("server exported proof before the case completed");
        const prematureProposal = await page.request.post(`${baseUrl}/api/propose`, { data: {} });
        journeyAssertions.proposalBlockedBeforeConfirmation = !prematureProposal.ok();
        if (prematureProposal.ok()) throw new Error("server accepted a proposal before the outcome was confirmed");
        await page.locator("#outcome").fill("Produce one bounded, reviewable, and verifiable result.");
        await page.locator("#primary-input button").click();
        await page.locator('body[data-scenario="running"]').waitFor();
        journeyAssertions.outcomeConfirmed = (await page.locator("#current-action").innerText()).includes("Prepare the bounded proposal");
        milestone("outcome_confirmed");
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
        await assertReviewState(page, state, viewport, theme);
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
          if (viewport.id === "mobile-landscape" || viewport.id === "mobile-portrait") {
            await page.locator("#review").evaluate((element) => element.scrollIntoView({ block: "start" }));
          }
        }
        if (state === "export_share") {
          if (!(await page.locator("#download-proof").isVisible()) || !(await page.locator("#copy-share").isVisible())) {
            throw new Error(`export actions are not visible for ${viewport.id}/${theme}`);
          }
          if (canonicalJourney) {
            const exportPath = path.join(browserRoot, "nodekit-proof.json");
            const downloadPromise = page.waitForEvent("download");
            await page.locator("#download-proof").click();
            const download = await downloadPromise;
            await download.saveAs(exportPath);
            await verifyExportedProof(exportPath);
            await recordArtifact("portable-proof-bundle", exportPath);
            journeyAssertions.exportDownloadedAndVerified = true;
            milestone("export_downloaded_and_reopened");
            await page.locator("#copy-share").click();
            await page.locator("#copy-status").waitFor({ state: "visible" });
            journeyAssertions.shareSummaryProduced = (await page.locator("#copy-status").innerText()).trim().length > 0;
          }
        } else if (!(await page.locator("#receipt-actions").isHidden())) {
          throw new Error(`export actions leaked into ${state}/${viewport.id}/${theme}`);
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
        if (canonicalJourney && state === "conflict") {
          await page.locator("#resolve-conflict").click();
          await page.locator('body[data-scenario="completed_receipt"]').waitFor();
          await page.locator("#completion").waitFor({ state: "visible" });
          journeyAssertions.conflictRecovered = (await page.locator("#receipt-id").innerText()).startsWith("Receipt ");
        }
        if (canonicalJourney && state === "recoverable_failure") {
          await page.locator("#resume").click();
          await page.locator('body[data-scenario="running"]').waitFor();
          journeyAssertions.exceptionRecovered = await page.locator("#exception").isHidden();
        }
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
  const consolePath = path.join(browserRoot, "console.jsonl");
  const networkPath = path.join(browserRoot, "network.jsonl");
  await writeFile(consolePath, globalConsole.map((entry) => JSON.stringify(entry)).join("\n") + (globalConsole.length ? "\n" : ""));
  await writeFile(networkPath, globalNetwork.map((entry) => JSON.stringify(entry)).join("\n") + (globalNetwork.length ? "\n" : ""));
  await recordArtifact("browser-console", consolePath);
  await recordArtifact("browser-network", networkPath);
  journeyAssertions.stateActionsCoherent = true;
  passed = screenshots.length === viewports.length * 2 * requiredStates.length
    && accessibilityViolations.length === 0
    && evidenceArtifacts.length === 5
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
const certified = passed
  && missingStates.length === 0
  && Boolean(nodekitCommit)
  && Boolean(nodekitSourceHash);
const manifest = {
  accessibilityViolations,
  applicationHash: identity.applicationHash,
  certified,
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
  nodekitIdentity: nodekitCommit && nodekitSourceHash ? `${nodekitCommit}/${nodekitSourceHash}` : null,
  nodekitSourceHash,
  passed,
  phases,
  requiredStates,
  runId,
  schemaVersion: "nodekit.browser-certification/v1",
  serverProcess: { command: `${process.execPath} apps/web/server.mjs`, pid: server.pid },
  screenshots,
  startedAt,
  verdict: certified
    ? "BROWSER_CERTIFIED"
    : passed && missingStates.length === 0
      ? "BROWSER_JOURNEY_PASS_IDENTITY_UNBOUND"
      : "BROWSER_JOURNEY_PASS_COVERAGE_INCOMPLETE",
};
manifest.manifestSha256 = sha256(Buffer.from(JSON.stringify(manifest)));
await writeFile(path.join(evidenceRoot, "browser", "screenshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.resolve("proof", "browser-certification.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
if (!certified) process.exitCode = 1;
