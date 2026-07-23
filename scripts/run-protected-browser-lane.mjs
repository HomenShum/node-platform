import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const MAX_EXPORTED_ARTIFACT_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_CONTRACTS = Object.freeze({
  "launch-presentation": "launch-presentation",
  "research-map": "research-map",
  "volunteer-onboarding": "volunteer-onboarding-record",
});
const REQUIRED_STATES = Object.freeze([
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
]);
const VIEWPORTS = Object.freeze([
  { id: "desktop", width: 1440, height: 900 },
  { id: "wide", width: 1920, height: 1080 },
  { id: "tablet-landscape", width: 1024, height: 768 },
  { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "mobile-portrait", width: 390, height: 844 },
  { id: "mobile-landscape", width: 844, height: 390 },
]);
const THEMES = Object.freeze(["light", "dark"]);
const MOJIBAKE = /(?:\u00c2\S|\u00c3.|\ufffd|\u00e2[\u0080-\u00bf]{1,2})/u;
const AXE_ENGINE_VERSION = "4.12.1";
const AXE_POLICY = "serious-critical-zero";
const AXE_IMPACTS = Object.freeze(["critical", "serious", "moderate", "minor", "unknown"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return sha256(canonical(value));
}

function axeViolationSummary(results) {
  const violationCounts = Object.fromEntries(AXE_IMPACTS.map((impact) => [impact, 0]));
  const violations = results.violations.map((violation) => {
    const impact = AXE_IMPACTS.includes(violation.impact) ? violation.impact : "unknown";
    violationCounts[impact] += 1;
    return { id: violation.id, impact, nodeCount: violation.nodes.length };
  }).sort((left, right) => `${left.impact}/${left.id}`.localeCompare(`${right.impact}/${right.id}`));
  const seriousCriticalViolations = violationCounts.critical + violationCounts.serious;
  return {
    engine: "axe-core",
    engineVersion: results.testEngine?.version,
    passed: seriousCriticalViolations === 0,
    policy: AXE_POLICY,
    seriousCriticalViolations,
    totalViolations: violations.length,
    violationCounts,
    violations,
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function objectIdentity(value) {
  if (nonEmptyText(value)) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [value.id, value.name, value.email, value.applicationId, value.volunteerId].some(nonEmptyText));
}

function exact(left, right) {
  return canonical(left) === canonical(right);
}

function validateProtectedTaskInput(value, { inputToken, taskId }) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== "nodekit.protected-task-input/v1" || value.taskId !== taskId
    || value.inputToken !== inputToken || !/^challenge_[a-f0-9]{32,64}$/.test(value.nonce ?? "")
    || !SHA256.test(value.generatedAfterCandidateArchiveSha256 ?? "")) throw new Error("protected task input envelope is invalid");
  if (taskId === "research-map") {
    if (!nonEmptyText(value.question) || !value.question.includes(value.nonce) || !Array.isArray(value.sources) || value.sources.length < 2) {
      throw new Error("protected research source packet is incomplete");
    }
    const ids = new Set();
    for (const source of value.sources) {
      if (!nonEmptyText(source?.id) || ids.has(source.id) || !nonEmptyText(source?.title)
        || !nonEmptyText(source?.url) || !source.url.startsWith("https://")
        || !nonEmptyText(source?.publishedAtIso) || !Number.isFinite(Date.parse(source.publishedAtIso))
        || !nonEmptyText(source?.excerpt) || !SHA256.test(source?.contentSha256 ?? "")
        || sha256(source.excerpt) !== source.contentSha256) throw new Error("protected research source packet is invalid");
      ids.add(source.id);
    }
  } else if (taskId === "volunteer-onboarding") {
    if (!value.volunteer || [value.volunteer.id, value.volunteer.name, value.volunteer.email].some((field) => !nonEmptyText(field))
      || !Array.isArray(value.documents) || value.documents.length < 1
      || value.documents.some((document) => !nonEmptyText(document?.id) || !nonEmptyText(document?.type)
        || !["reviewed", "approved"].includes(String(document?.reviewStatus).toLowerCase()))) {
      throw new Error("protected volunteer input is incomplete or cannot confirm onboarding");
    }
  } else if (!value.brief || [value.brief.product, value.brief.audience, value.brief.positioning].some((field) => !nonEmptyText(field))
    || !Array.isArray(value.metrics) || value.metrics.length < 1
    || value.metrics.some((metric) => !nonEmptyText(metric?.id) || !nonEmptyText(metric?.label) || !nonEmptyText(metric?.unit)
      || typeof metric?.value !== "number" || !Number.isFinite(metric.value))) {
    throw new Error("protected launch input is incomplete");
  }
  return value;
}

function validateTaskContent(taskId, protectedInput, content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("canonical task artifact content must be an object");
  if (content.inputToken !== protectedInput.inputToken) throw new Error("canonical artifact did not preserve the exact hidden input token");
  if (taskId === "research-map") {
    const question = content.question ?? content.researchQuestion;
    const sources = content.sources ?? content.references ?? content.citations;
    const comparisons = content.comparisons ?? content.findings;
    if (question !== protectedInput.question) throw new Error("research map did not preserve the exact hidden question");
    if (!Array.isArray(sources) || sources.length !== protectedInput.sources.length) throw new Error("research map source count drifted");
    const sourceIds = new Set();
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const supplied = protectedInput.sources[index];
      if (!source || !["id", "title", "url", "publishedAtIso", "contentSha256", "excerpt"]
        .every((field) => source[field] === supplied[field])) throw new Error("research map did not preserve the immutable source packet exactly");
      if (sourceIds.has(source.id)) throw new Error("research map source IDs are not unique");
      sourceIds.add(source.id);
    }
    if (!Array.isArray(comparisons) || comparisons.length < 1) throw new Error("research map needs at least one comparison");
    const referenced = new Set();
    for (const comparison of comparisons) {
      const refs = comparison?.sourceIds ?? comparison?.sourceRefs ?? comparison?.sources;
      if (!Array.isArray(refs) || refs.length < 1 || refs.some((id) => !sourceIds.has(typeof id === "string" ? id : id?.id))) {
        throw new Error("research map comparison does not reference its declared sources");
      }
      refs.forEach((id) => referenced.add(typeof id === "string" ? id : id?.id));
    }
    if (referenced.size !== sourceIds.size) throw new Error("research map comparisons do not cover every supplied source");
    return { comparisonCount: comparisons.length, questionPresent: true, sourceCount: sources.length };
  }
  if (taskId === "volunteer-onboarding") {
    const identity = content.volunteer ?? content.applicant ?? content.application;
    const documents = content.documents ?? content.documentReviews ?? content.checklist;
    const completion = content.completion ?? content.onboarding;
    if (!objectIdentity(identity) || !exact(identity, protectedInput.volunteer)) throw new Error("volunteer onboarding did not preserve the supplied volunteer exactly");
    if (!Array.isArray(documents) || documents.length !== protectedInput.documents.length
      || documents.some((document, index) => !["id", "type", "reviewStatus"]
        .every((field) => document?.[field] === protectedInput.documents[index][field]))) throw new Error("volunteer onboarding did not preserve supplied documents exactly");
    if (String(completion?.status ?? content.completionStatus).toLowerCase() !== "confirmed") {
      throw new Error("volunteer onboarding completion is not confirmed");
    }
    return { completionConfirmed: true, documentCount: documents.length, identityPresent: true };
  }
  const brief = content.brief ?? content.productBrief;
  const metrics = content.metrics ?? content.productMetrics;
  const slides = content.slides ?? content.deck?.slides;
  const review = content.review ?? content.approval;
  const metricValues = Array.isArray(metrics)
    ? metrics.map((entry) => (typeof entry === "number" ? entry : entry?.value))
    : Object.values(metrics ?? {});
  if (!exact(brief, protectedInput.brief)) throw new Error("launch presentation did not preserve the exact supplied brief");
  if (!Array.isArray(metrics) || metrics.length !== protectedInput.metrics.length
    || metrics.some((metric, index) => !["id", "label", "value", "unit"]
      .every((field) => metric?.[field] === protectedInput.metrics[index][field]))) throw new Error("launch presentation did not preserve exact supplied metrics");
  if (!metricValues.some((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("launch presentation lacks a numeric metric");
  }
  if (!Array.isArray(slides) || slides.length < 3) throw new Error("launch presentation needs at least three slides");
  const metricIds = new Set(protectedInput.metrics.map((metric) => metric.id));
  const referenced = new Set();
  for (const slide of slides) {
    const refs = slide?.metricIds ?? slide?.metrics;
    if (!nonEmptyText(slide?.title) || !Array.isArray(refs) || refs.length < 1
      || refs.some((id) => !metricIds.has(typeof id === "string" ? id : id?.id))) throw new Error("launch slide is not grounded in supplied metrics");
    refs.forEach((id) => referenced.add(typeof id === "string" ? id : id?.id));
  }
  if (referenced.size !== metricIds.size) throw new Error("launch slides do not cover every supplied metric");
  if (String(review?.status ?? content.reviewStatus).toLowerCase() !== "approved") {
    throw new Error("launch presentation review is not approved");
  }
  return { briefPresent: true, metricCount: metricValues.length, reviewApproved: true, slideCount: slides.length };
}

function validateExportedBundle(bundle, { expectedArtifactType, protectedTaskInput, taskId }) {
  if (bundle?.schemaVersion !== "nodekit.portable-proof-bundle/v1") throw new Error("exported proof bundle schema is invalid");
  if (bundle.receipt?.schemaVersion !== "nodekit.receipt/v2") throw new Error("exported receipt schema is invalid");
  if (bundle.case?.caseId !== bundle.run?.caseId || bundle.run?.runId !== bundle.receipt?.runId) {
    throw new Error("exported case, run, and receipt identities do not match");
  }
  const artifact = bundle.artifact;
  if (artifact?.kind !== expectedArtifactType || !nonEmptyText(artifact.artifactId)
    || !Number.isInteger(artifact.canonicalVersion) || artifact.canonicalVersion < 2) {
    throw new Error("exported artifact type, identity, or canonical version is invalid");
  }
  const canonicalVersion = artifact.versions?.find((entry) => entry.version === artifact.canonicalVersion);
  if (!canonicalVersion || canonicalVersion.contentHash !== contentHash(canonicalVersion.content)) {
    throw new Error("exported canonical artifact content hash is invalid");
  }
  const binding = bundle.receipt.artifactBindings?.find((entry) => entry.artifactId === artifact.artifactId);
  if (!binding || binding.canonicalVersion !== artifact.canonicalVersion || binding.contentHash !== canonicalVersion.contentHash) {
    throw new Error("exported receipt is not bound to the canonical artifact version");
  }
  const { receiptHash, receiptId, ...receiptBody } = bundle.receipt;
  if (!receiptId || receiptHash !== contentHash(receiptBody)) throw new Error("exported receipt hash is invalid");
  const domainSummary = validateTaskContent(taskId, protectedTaskInput, canonicalVersion.content);
  return {
    content: canonicalVersion.content,
    domainSummary,
    marker: {
      artifactId: artifact.artifactId,
      canonicalVersion: artifact.canonicalVersion,
      contentSha256: canonicalVersion.contentHash,
      type: artifact.kind,
    },
  };
}

function sameMarker(left, right) {
  return Boolean(left && right
    && left.artifactId === right.artifactId
    && left.canonicalVersion === right.canonicalVersion
    && left.contentSha256 === right.contentSha256
    && left.type === right.type);
}

async function readMarker(page) {
  const artifact = page.locator("#artifact");
  await artifact.waitFor({ state: "visible" });
  const marker = await artifact.evaluate((element) => ({
    artifactId: element.getAttribute("data-nodekit-artifact-id"),
    canonicalVersion: Number(element.getAttribute("data-nodekit-artifact-version")),
    contentSha256: element.getAttribute("data-nodekit-artifact-content-sha256"),
    type: element.getAttribute("data-nodekit-artifact-type"),
  }));
  if (!nonEmptyText(marker.artifactId) || !Number.isInteger(marker.canonicalVersion) || marker.canonicalVersion < 2
    || !/^[a-f0-9]{64}$/.test(marker.contentSha256 ?? "") || !nonEmptyText(marker.type)) {
    throw new Error("#artifact lacks the required canonical artifact metadata tuple");
  }
  return marker;
}

async function waitForCompletion(page) {
  await page.getByText("Completion verified", { exact: true }).first().waitFor({ state: "visible" });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      const health = response.ok ? await response.json() : null;
      if (health?.status === "ok") return health;
    } catch {
      // The server starts concurrently. Retry only within the bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("isolated candidate server did not become healthy within 20 seconds");
}

async function captureProtectedScreenshotMatrix(browser, { baseUrl, candidateArchiveSha256, outputRoot, runId, taskId }) {
  const matrixRoot = path.join(outputRoot, "protected-browser");
  const screenshotRoot = path.join(matrixRoot, "screenshots");
  await mkdir(screenshotRoot, { recursive: true });
  const screenshots = [];
  const globalConsole = [];
  const globalNetwork = [];
  const accessibilityTotals = Object.fromEntries(AXE_IMPACTS.map((impact) => [impact, 0]));
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const resetResponse = await fetch(`${baseUrl}/api/reset`, { method: "POST" });
      if (!resetResponse.ok) throw new Error(`protected matrix reset failed with HTTP ${resetResponse.status}`);
      const context = await browser.newContext({
        colorScheme: theme,
        reducedMotion: viewport.id === "mobile-portrait" ? "reduce" : "no-preference",
        viewport: { height: viewport.height, width: viewport.width },
      });
      const page = await context.newPage();
      const observations = { consoleErrors: [], failedRequests: [] };
      page.on("console", (message) => {
        if (message.type() === "error") observations.consoleErrors.push(message.text());
      });
      page.on("requestfailed", (request) => observations.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
      for (const state of REQUIRED_STATES) {
        const consoleStart = observations.consoleErrors.length;
        const requestStart = observations.failedRequests.length;
        await page.goto(`${baseUrl}/?scenario=${state}`, { waitUntil: "networkidle" });
        await page.locator(`body[data-scenario="${state}"]`).waitFor({ state: "visible" });
        if (state === "validation_error") {
          await page.locator("#outcome").fill("");
          await page.locator("#primary-input").evaluate((form) => form.requestSubmit());
          await page.locator("#error").waitFor({ state: "visible" });
        }
        if (["receipt_inspection", "export_share"].includes(state)) {
          await page.locator("#receipt-detail").waitFor({ state: "visible" });
        }
        const horizontalOverflowPx = await page.evaluate(() => Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ));
        const renderedText = (await page.locator("body").innerText()).normalize("NFKC");
        const accessibility = axeViolationSummary(await new AxeBuilder({ page }).analyze());
        if (accessibility.engineVersion !== AXE_ENGINE_VERSION || accessibility.passed !== true) {
          throw new Error(`protected Axe contract failed for ${state}/${viewport.id}/${theme}: ${JSON.stringify(accessibility)}`);
        }
        for (const impact of AXE_IMPACTS) accessibilityTotals[impact] += accessibility.violationCounts[impact];
        const consoleErrors = observations.consoleErrors.slice(consoleStart);
        const failedRequests = observations.failedRequests.slice(requestStart);
        const filename = `${state}--${viewport.id}--${theme}`;
        const relativePng = `protected-browser/screenshots/${filename}.png`;
        const absolutePng = path.join(outputRoot, ...relativePng.split("/"));
        const png = await page.screenshot({ animations: "disabled", fullPage: false, path: absolutePng });
        if (png.length < 256 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`protected screenshot ${filename} is malformed`);
        const sidecar = {
          authority: "campaign-protected-browser",
          accessibility,
          candidateArchiveSha256,
          consoleErrors: consoleErrors.length,
          failedRequests: failedRequests.length,
          horizontalOverflowPx,
          mojibakeDetected: MOJIBAKE.test(renderedText),
          pageUrl: page.url(),
          pngSha256: sha256(png),
          runId,
          schemaVersion: "nodekit.protected-screenshot-proof/v1",
          state,
          taskId,
          theme,
          viewport: { height: viewport.height, width: viewport.width },
          viewportId: viewport.id,
        };
        if (sidecar.consoleErrors !== 0 || sidecar.failedRequests !== 0 || sidecar.horizontalOverflowPx !== 0 || sidecar.mojibakeDetected) {
          throw new Error(`protected screenshot contract failed for ${filename}: ${JSON.stringify(sidecar)}`);
        }
        const relativeSidecar = `protected-browser/screenshots/${filename}.json`;
        const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
        await writeFile(path.join(outputRoot, ...relativeSidecar.split("/")), sidecarBytes, { flag: "wx" });
        screenshots.push({
          ...sidecar,
          path: relativePng,
          pngBytes: png.length,
          sidecarBytes: sidecarBytes.length,
          sidecarPath: relativeSidecar,
          sidecarSha256: sha256(sidecarBytes),
        });
      }
      globalConsole.push(...observations.consoleErrors.map((message) => ({ message, theme, viewportId: viewport.id })));
      globalNetwork.push(...observations.failedRequests.map((message) => ({ message, theme, viewportId: viewport.id })));
      await context.close();
    }
  }
  const records = screenshots.map((screenshot) => ({
    path: screenshot.path,
    pngSha256: screenshot.pngSha256,
    sidecarPath: screenshot.sidecarPath,
    sidecarSha256: screenshot.sidecarSha256,
    state: screenshot.state,
    theme: screenshot.theme,
    viewport: screenshot.viewport,
    viewportId: screenshot.viewportId,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const screenshotEvidenceRootSha256 = sha256(JSON.stringify(records));
  const covered = new Set(screenshots.map((screenshot) => `${screenshot.state}/${screenshot.viewportId}/${screenshot.theme}`));
  const expectedCount = REQUIRED_STATES.length * VIEWPORTS.length * THEMES.length;
  const passed = screenshots.length === expectedCount
    && covered.size === expectedCount
    && new Set(screenshots.map((screenshot) => screenshot.path).filter(Boolean)).size === expectedCount
    && new Set(screenshots.map((screenshot) => screenshot.pngSha256)).size === expectedCount
    && globalConsole.length === 0
    && globalNetwork.length === 0;
  if (!passed) throw new Error("protected screenshot matrix is incomplete, duplicated, or unhealthy");
  const manifest = {
    accessibilityAudit: {
      engine: "axe-core",
      engineVersion: AXE_ENGINE_VERSION,
      passed: accessibilityTotals.critical === 0 && accessibilityTotals.serious === 0,
      policy: AXE_POLICY,
      scans: screenshots.length,
      seriousCriticalViolations: accessibilityTotals.critical + accessibilityTotals.serious,
      totalViolations: Object.values(accessibilityTotals).reduce((total, count) => total + count, 0),
      violationCounts: accessibilityTotals,
    },
    candidateArchiveSha256,
    certificationScope: [
      "rendered-state-coverage",
      "console-health",
      "request-health",
      "horizontal-overflow",
      "mojibake",
      "axe-serious-critical",
    ],
    certified: true,
    consoleErrors: globalConsole,
    coveredStates: [...REQUIRED_STATES],
    generatedAt: new Date().toISOString(),
    networkFailures: globalNetwork,
    passed: true,
    producer: {
      authority: "campaign-protected-browser",
      candidateHostAccess: false,
      candidateWriteAccess: false,
      externalNetworkEgress: false,
    },
    requiredStates: [...REQUIRED_STATES],
    runId,
    schemaVersion: "nodekit.protected-browser-screenshot-manifest/v1",
    screenshotEvidenceRootSha256,
    screenshots,
    taskId,
    themes: [...THEMES],
    viewports: VIEWPORTS.map((viewport) => ({ ...viewport })),
  };
  manifest.manifestSha256 = sha256(JSON.stringify(manifest));
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(matrixRoot, "screenshot-manifest.json"), manifestBytes, { flag: "wx" });
  return { manifest, manifestBytes };
}

async function externalNetworkIsBlocked() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "1.1.1.1", port: 80 });
    const done = (blocked) => {
      socket.destroy();
      resolve(blocked);
    };
    socket.setTimeout(2_000);
    socket.once("connect", () => done(false));
    socket.once("error", () => done(true));
    socket.once("timeout", () => done(true));
  });
}

const baseUrl = requiredEnvironment("NODEKIT_PROTECTED_BASE_URL");
const expectedRunId = requiredEnvironment("NODEKIT_PROTECTED_RUN_ID");
const taskId = requiredEnvironment("NODEKIT_PROTECTED_TASK_ID");
const expectedArtifactType = requiredEnvironment("NODEKIT_PROTECTED_ARTIFACT_TYPE");
const protectedTaskInputFile = path.resolve(requiredEnvironment("NODEKIT_PROTECTED_TASK_INPUT_FILE"));
const expectedProtectedTaskInputSha256 = requiredEnvironment("NODEKIT_PROTECTED_TASK_INPUT_SHA256");
const outputRoot = path.resolve(requiredEnvironment("NODEKIT_PROTECTED_OUTPUT_ROOT"));
if (TASK_CONTRACTS[taskId] !== expectedArtifactType) throw new Error("protected task/artifact contract is unsupported or inconsistent");
if (outputRoot !== "/output") throw new Error("protected browser output must be the isolated /output mount");
if (protectedTaskInputFile !== "/output/protected-task-input.json" || !SHA256.test(expectedProtectedTaskInputSha256)) {
  throw new Error("protected task input must use the isolated browser-only input path and a SHA-256 binding");
}
await mkdir(outputRoot, { recursive: true });
const protectedTaskInput = validateProtectedTaskInput(
  JSON.parse(await readFile(protectedTaskInputFile, "utf8")),
  { inputToken: expectedRunId, taskId },
);
if (sha256(canonical(protectedTaskInput)) !== expectedProtectedTaskInputSha256) {
  throw new Error("protected task input hash does not match the evaluator binding");
}

const serverHealth = await waitForHealth(baseUrl);
if (serverHealth.certificationRunId !== null) throw new Error("candidate server received a certification-mode oracle");
const egressBlocked = await externalNetworkIsBlocked();
if (!egressBlocked) throw new Error("protected browser lane unexpectedly reached the public internet");

const consoleErrors = [];
const failedRequests = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const protectedMatrix = await captureProtectedScreenshotMatrix(browser, {
    baseUrl,
    candidateArchiveSha256: protectedTaskInput.generatedAfterCandidateArchiveSha256,
    outputRoot,
    runId: expectedRunId,
    taskId,
  });
  const resetResponse = await fetch(`${baseUrl}/api/reset`, { method: "POST" });
  if (!resetResponse.ok) throw new Error(`protected task-journey reset failed with HTTP ${resetResponse.status}`);
  const context = await browser.newContext({ colorScheme: "light", viewport: { height: 900, width: 1440 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const inputToken = protectedTaskInput.inputToken;
  const submittedOutcome = JSON.stringify(protectedTaskInput);
  await page.locator("#outcome").fill(submittedOutcome);
  await page.locator("#primary-input").evaluate((form) => form.requestSubmit());
  await page.getByText("Outcome confirmed", { exact: true }).waitFor({ state: "visible" });
  await page.locator("#propose").click();
  await page.getByText("Proposal ready for review", { exact: true }).waitFor({ state: "visible" });
  await page.locator("#approve").click();
  await waitForCompletion(page);
  const marker = await readMarker(page);
  if (marker.type !== expectedArtifactType) throw new Error(`rendered artifact type ${marker.type} does not match ${expectedArtifactType}`);
  const downloadControl = page.locator("#download-proof");
  if (!(await downloadControl.isVisible())) throw new Error("completed task lacks a visible #download-proof control");
  const [download] = await Promise.all([page.waitForEvent("download"), downloadControl.click()]);
  const exportPath = path.join(outputRoot, "task-artifact.json");
  await download.saveAs(exportPath);
  const exportMetadata = await stat(exportPath);
  if (!exportMetadata.isFile() || exportMetadata.size < 32 || exportMetadata.size > MAX_EXPORTED_ARTIFACT_BYTES) {
    throw new Error("downloaded task artifact has an invalid byte size");
  }
  const exportBytes = await readFile(exportPath);
  const bundle = JSON.parse(exportBytes.toString("utf8"));
  const verified = validateExportedBundle(bundle, { expectedArtifactType, protectedTaskInput, taskId });
  if (!sameMarker(marker, verified.marker)) throw new Error("rendered artifact tuple does not match downloaded canonical artifact");

  await page.reload({ waitUntil: "networkidle" });
  await waitForCompletion(page);
  const reloadMarker = await readMarker(page);
  if (!sameMarker(marker, reloadMarker)) throw new Error("canonical artifact tuple did not survive reload");
  await context.close();

  const reopenContext = await browser.newContext({ colorScheme: "light", viewport: { height: 900, width: 1440 } });
  const reopenPage = await reopenContext.newPage();
  reopenPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  reopenPage.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await reopenPage.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForCompletion(reopenPage);
  const reopenMarker = await readMarker(reopenPage);
  if (!sameMarker(marker, reopenMarker)) throw new Error("canonical artifact tuple did not survive a fresh browser context");
  const visibleText = (await reopenPage.locator("body").innerText()).normalize("NFKC");
  const domMetrics = await reopenPage.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    hasArtifact: Boolean(document.querySelector("#artifact")),
    hasHeading: Boolean(document.querySelector("h1")?.textContent?.trim()),
    hasReview: Boolean(document.querySelector("#review")),
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    title: document.title,
  }));
  const screenshot = await reopenPage.screenshot({ fullPage: true });
  await reopenContext.close();
  if (screenshot.length < 256 || !screenshot.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("isolated browser screenshot is malformed or implausibly small");
  }
  const screenshotSha256 = sha256(screenshot);
  await writeFile(path.join(outputRoot, "task-relevance.png"), screenshot, { flag: "wx" });
  const taskArtifactEvidence = {
    domainSummary: verified.domainSummary,
    exportBytes: exportBytes.length,
    exportFile: "task-artifact.json",
    exportSha256: sha256(exportBytes),
    inputTokenSha256: sha256(inputToken),
    marker,
    reloadMarker,
    reopenMarker,
    taskId,
  };
  const result = {
    artifactDownloadVerified: true,
    artifactReloadPersistenceVerified: true,
    artifactReopenPersistenceVerified: true,
    browserVersion: browser.version(),
    consoleErrors,
    domMetrics,
    externalNetworkEgressBlocked: true,
    failedRequests,
    guidedInteractionPassed: true,
    runId: expectedRunId,
    schemaVersion: "nodekit.protected-browser-lane-result/v2",
    protectedTaskInputSha256: expectedProtectedTaskInputSha256,
    protectedScreenshotManifestFile: "protected-browser/screenshot-manifest.json",
    protectedScreenshotManifestSha256: sha256(protectedMatrix.manifestBytes),
    protectedScreenshotEvidenceRootSha256: protectedMatrix.manifest.screenshotEvidenceRootSha256,
    protectedScreenshotCount: protectedMatrix.manifest.screenshots.length,
    screenshotSha256,
    serverHealth: {
      candidateCertificationMarkerAbsent: true,
      status: serverHealth.status,
    },
    taskArtifactEvidence,
    taskId,
    taskInputBound: true,
    typedArtifactVerified: true,
    visibleText,
  };
  result.resultSha256 = sha256(JSON.stringify(result));
  await writeFile(path.join(outputRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ passed: true, resultSha256: result.resultSha256 }));
} finally {
  await browser?.close().catch(() => undefined);
}
