import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./schema-validation.mjs";

export const PROTECTED_BROWSER_STATES = Object.freeze([
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
]);

export const PROTECTED_BROWSER_VIEWPORTS = Object.freeze([
  Object.freeze({ height: 900, id: "desktop", width: 1440 }),
  Object.freeze({ height: 1080, id: "wide", width: 1920 }),
  Object.freeze({ height: 768, id: "tablet-landscape", width: 1024 }),
  Object.freeze({ height: 1024, id: "tablet-portrait", width: 768 }),
  Object.freeze({ height: 844, id: "mobile-portrait", width: 390 }),
  Object.freeze({ height: 390, id: "mobile-landscape", width: 844 }),
]);

export const PROTECTED_BROWSER_THEMES = Object.freeze(["light", "dark"]);

const SHA256 = /^[a-f0-9]{64}$/;
export const PROTECTED_BROWSER_EVIDENCE_LIMITS = Object.freeze({
  closureBytes: 1024 * 1024 * 1024,
  manifestBytes: 4 * 1024 * 1024,
  pngBytes: 25 * 1024 * 1024,
  sidecarBytes: 2 * 1024 * 1024,
});
const MAX_PROTECTED_BROWSER_CLOSURE_BYTES = PROTECTED_BROWSER_EVIDENCE_LIMITS.closureBytes;
const EXPECTED_SCREENSHOT_COUNT = PROTECTED_BROWSER_STATES.length
  * PROTECTED_BROWSER_VIEWPORTS.length
  * PROTECTED_BROWSER_THEMES.length;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function exact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalEvidencePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && path.posix.normalize(value) === value
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

async function readContainedRegularFile(root, relativePath, label, { maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error(`${label} has an invalid verifier byte limit`);
  if (!canonicalEvidencePath(relativePath)) throw new Error(`${label} path is not canonical: ${relativePath}`);
  const absolute = path.resolve(root, ...relativePath.split("/"));
  const lexical = path.relative(root, absolute);
  if (lexical === "" || lexical === ".." || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) {
    throw new Error(`${label} escapes its protected evidence root: ${relativePath}`);
  }
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is not a regular non-symlink file: ${relativePath}`);
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte verifier limit: ${relativePath}`);
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolute)]);
  const realRelative = path.relative(realRoot, realFile);
  if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`${label} resolves outside its protected evidence root: ${relativePath}`);
  }
  const bytes = await readFile(absolute);
  // Recheck after reading so a file changed between lstat and read still fails closed.
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte verifier limit: ${relativePath}`);
  return { absolute, bytes, relativePath };
}

function assertDeclaredEvidenceBudget(manifestBytes, screenshots) {
  let declaredClosureBytes = manifestBytes;
  for (const screenshot of screenshots) {
    const tuple = `${screenshot?.state}/${screenshot?.viewportId}/${screenshot?.theme}`;
    if (!Number.isInteger(screenshot?.pngBytes) || screenshot.pngBytes < 256
      || screenshot.pngBytes > PROTECTED_BROWSER_EVIDENCE_LIMITS.pngBytes) {
      throw new Error(`protected screenshot PNG declaration exceeds its verifier limit: ${tuple}`);
    }
    if (!Number.isInteger(screenshot?.sidecarBytes) || screenshot.sidecarBytes < 2
      || screenshot.sidecarBytes > PROTECTED_BROWSER_EVIDENCE_LIMITS.sidecarBytes) {
      throw new Error(`protected screenshot sidecar declaration exceeds its verifier limit: ${tuple}`);
    }
    const next = declaredClosureBytes + screenshot.pngBytes + screenshot.sidecarBytes;
    if (!Number.isSafeInteger(next) || next > MAX_PROTECTED_BROWSER_CLOSURE_BYTES) {
      throw new Error(`protected browser declared closure exceeds ${MAX_PROTECTED_BROWSER_CLOSURE_BYTES} bytes`);
    }
    declaredClosureBytes = next;
  }
  return declaredClosureBytes;
}

function expectedTupleSet() {
  return new Set(PROTECTED_BROWSER_STATES.flatMap((state) => PROTECTED_BROWSER_VIEWPORTS.flatMap((viewport) => (
    PROTECTED_BROWSER_THEMES.map((theme) => `${state}/${viewport.id}/${theme}`)
  ))));
}

function screenshotEvidenceRoot(screenshots) {
  const records = screenshots.map((screenshot) => ({
    path: screenshot.path,
    pngSha256: screenshot.pngSha256,
    sidecarPath: screenshot.sidecarPath,
    sidecarSha256: screenshot.sidecarSha256,
    state: screenshot.state,
    theme: screenshot.theme,
    viewport: screenshot.viewport,
    viewportId: screenshot.viewportId,
  })).sort((left, right) => String(left.path).localeCompare(String(right.path)));
  return { records, sha256: sha256(canonicalJson(records)) };
}

/**
 * Reopens and validates the complete campaign-protected browser evidence closure.
 * `validatePng` is injected by the caller so the submission signer can use its own
 * CRC, decode, dimension, blank-image, and decoded-pixel validator without this
 * module depending on the gate implementation.
 */
export async function validateProtectedBrowserEvidence({
  evidenceRoot,
  expected,
  manifestFile = "protected-browser/screenshot-manifest.json",
  validatePng,
}) {
  if (typeof validatePng !== "function") throw new Error("protected browser evidence requires a trusted PNG validator");
  const root = path.resolve(evidenceRoot);
  const manifestRecord = await readContainedRegularFile(root, manifestFile, "protected browser manifest", {
    maxBytes: PROTECTED_BROWSER_EVIDENCE_LIMITS.manifestBytes,
  });
  let manifest;
  try {
    manifest = JSON.parse(manifestRecord.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`protected browser manifest is not valid JSON: ${error.message}`);
  }
  const manifestSchemaErrors = await validateSchema(
    "nodekit.protected-browser-screenshot-manifest.v1.schema.json",
    manifest,
    "protected browser manifest",
  );
  if (manifestSchemaErrors.length > 0) throw new Error(manifestSchemaErrors.join("; "));
  const manifestBody = { ...manifest };
  delete manifestBody.manifestSha256;
  const expectedScope = [
    "rendered-state-coverage",
    "console-health",
    "request-health",
    "horizontal-overflow",
    "mojibake",
    "axe-serious-critical",
  ];
  if (manifest.schemaVersion !== "nodekit.protected-browser-screenshot-manifest/v1"
    || manifest.producer?.authority !== "campaign-protected-browser"
    || manifest.producer?.candidateHostAccess !== false
    || manifest.producer?.candidateWriteAccess !== false
    || manifest.producer?.externalNetworkEgress !== false
    || manifest.certified !== true
    || manifest.passed !== true
    || manifest.runId !== expected.runId
    || manifest.taskId !== expected.taskId
    || manifest.candidateArchiveSha256 !== expected.candidateArchiveSha256
    || manifest.accessibilityAudit?.engine !== "axe-core"
    || manifest.accessibilityAudit?.engineVersion !== "4.12.1"
    || manifest.accessibilityAudit?.policy !== "serious-critical-zero"
    || manifest.accessibilityAudit?.scans !== EXPECTED_SCREENSHOT_COUNT
    || manifest.accessibilityAudit?.passed !== true
    || manifest.accessibilityAudit?.seriousCriticalViolations !== 0
    || manifest.accessibilityAudit?.violationCounts?.critical !== 0
    || manifest.accessibilityAudit?.violationCounts?.serious !== 0
    || Object.hasOwn(manifest, "accessibilityViolations")
    || !exact(manifest.certificationScope, expectedScope)
    || !exact(manifest.requiredStates, PROTECTED_BROWSER_STATES)
    || !exact(manifest.coveredStates, PROTECTED_BROWSER_STATES)
    || !exact(manifest.viewports, PROTECTED_BROWSER_VIEWPORTS)
    || !exact(manifest.themes, PROTECTED_BROWSER_THEMES)
    || !Array.isArray(manifest.consoleErrors) || manifest.consoleErrors.length !== 0
    || !Array.isArray(manifest.networkFailures) || manifest.networkFailures.length !== 0
    || !SHA256.test(manifest.manifestSha256 ?? "")
    || manifest.manifestSha256 !== sha256(canonicalJson(manifestBody))) {
    throw new Error("protected browser manifest provenance, scope, identity, or self-hash is invalid");
  }
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== EXPECTED_SCREENSHOT_COUNT) {
    throw new Error(`protected browser manifest must contain exactly ${EXPECTED_SCREENSHOT_COUNT} screenshots`);
  }
  assertDeclaredEvidenceBudget(manifestRecord.bytes.length, manifest.screenshots);

  const expectedTuples = expectedTupleSet();
  const observedTuples = new Set();
  const childPaths = new Set();
  const compressedHashes = new Set();
  const decodedPixelHashes = new Set();
  const closure = [{
    bytes: manifestRecord.bytes.length,
    kind: "protected-browser-manifest",
    path: manifestFile,
    sha256: sha256(manifestRecord.bytes),
  }];
  let closureBytes = manifestRecord.bytes.length;
  const accessibilityTotals = Object.fromEntries(["critical", "serious", "moderate", "minor", "unknown"].map((impact) => [impact, 0]));

  for (const screenshot of manifest.screenshots) {
    const viewport = PROTECTED_BROWSER_VIEWPORTS.find((entry) => entry.id === screenshot?.viewportId);
    const tuple = `${screenshot?.state}/${screenshot?.viewportId}/${screenshot?.theme}`;
    if (!expectedTuples.has(tuple) || observedTuples.has(tuple) || !viewport
      || !exact(screenshot.viewport, { height: viewport.height, width: viewport.width })) {
      throw new Error(`protected browser screenshot tuple is invalid or duplicated: ${tuple}`);
    }
    observedTuples.add(tuple);
    const filename = `${screenshot.state}--${screenshot.viewportId}--${screenshot.theme}`;
    const expectedPngPath = `protected-browser/screenshots/${filename}.png`;
    const expectedSidecarPath = `protected-browser/screenshots/${filename}.json`;
    if (screenshot.path !== expectedPngPath || screenshot.sidecarPath !== expectedSidecarPath
      || !SHA256.test(screenshot.pngSha256 ?? "") || !SHA256.test(screenshot.sidecarSha256 ?? "")
      || !Number.isInteger(screenshot.pngBytes) || screenshot.pngBytes < 256
      || screenshot.pngBytes > PROTECTED_BROWSER_EVIDENCE_LIMITS.pngBytes
      || !Number.isInteger(screenshot.sidecarBytes) || screenshot.sidecarBytes < 2
      || screenshot.sidecarBytes > PROTECTED_BROWSER_EVIDENCE_LIMITS.sidecarBytes) {
      throw new Error(`protected browser screenshot metadata is invalid: ${tuple}`);
    }
    if (childPaths.has(screenshot.path) || childPaths.has(screenshot.sidecarPath)) {
      throw new Error(`protected browser child path is reused: ${tuple}`);
    }
    childPaths.add(screenshot.path);
    childPaths.add(screenshot.sidecarPath);
    const [pngRecord, sidecarRecord] = await Promise.all([
      readContainedRegularFile(root, screenshot.path, "protected screenshot PNG", {
        maxBytes: PROTECTED_BROWSER_EVIDENCE_LIMITS.pngBytes,
      }),
      readContainedRegularFile(root, screenshot.sidecarPath, "protected screenshot sidecar", {
        maxBytes: PROTECTED_BROWSER_EVIDENCE_LIMITS.sidecarBytes,
      }),
    ]);
    if (pngRecord.bytes.length !== screenshot.pngBytes || sha256(pngRecord.bytes) !== screenshot.pngSha256) {
      throw new Error(`protected screenshot PNG bytes do not match the manifest: ${tuple}`);
    }
    if (sidecarRecord.bytes.length !== screenshot.sidecarBytes || sha256(sidecarRecord.bytes) !== screenshot.sidecarSha256) {
      throw new Error(`protected screenshot sidecar bytes do not match the manifest: ${tuple}`);
    }
    if (compressedHashes.has(screenshot.pngSha256)) throw new Error(`protected screenshot compressed bytes are reused: ${tuple}`);
    compressedHashes.add(screenshot.pngSha256);
    const decoded = validatePng(pngRecord.bytes, { screenshot, tuple: `protected/${tuple}` });
    if (!decoded || !SHA256.test(decoded.pixelSha256 ?? "")
      || decoded.width !== viewport.width || decoded.height !== viewport.height) {
      throw new Error(`protected screenshot decoded pixels are invalid: ${tuple}`);
    }
    if (decodedPixelHashes.has(decoded.pixelSha256)) throw new Error(`protected screenshot decoded pixels are reused: ${tuple}`);
    decodedPixelHashes.add(decoded.pixelSha256);

    let sidecar;
    try {
      sidecar = JSON.parse(sidecarRecord.bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`protected screenshot sidecar is not valid JSON (${tuple}): ${error.message}`);
    }
    const sidecarSchemaErrors = await validateSchema(
      "nodekit.protected-screenshot-proof.v1.schema.json",
      sidecar,
      `protected screenshot sidecar ${tuple}`,
    );
    if (sidecarSchemaErrors.length > 0) throw new Error(sidecarSchemaErrors.join("; "));
    if (sidecar.schemaVersion !== "nodekit.protected-screenshot-proof/v1"
      || sidecar.authority !== "campaign-protected-browser"
      || sidecar.candidateArchiveSha256 !== expected.candidateArchiveSha256
      || sidecar.runId !== expected.runId || sidecar.taskId !== expected.taskId
      || sidecar.state !== screenshot.state || sidecar.theme !== screenshot.theme
      || sidecar.viewportId !== screenshot.viewportId || !exact(sidecar.viewport, screenshot.viewport)
      || sidecar.pngSha256 !== screenshot.pngSha256
      || sidecar.consoleErrors !== 0 || sidecar.failedRequests !== 0
      || sidecar.horizontalOverflowPx !== 0 || sidecar.mojibakeDetected !== false
      || sidecar.pageUrl !== screenshot.pageUrl
      || sidecar.accessibility?.engine !== "axe-core"
      || sidecar.accessibility?.engineVersion !== "4.12.1"
      || sidecar.accessibility?.policy !== "serious-critical-zero"
      || sidecar.accessibility?.passed !== true
      || sidecar.accessibility?.seriousCriticalViolations !== 0
      || sidecar.accessibility?.violationCounts?.critical !== 0
      || sidecar.accessibility?.violationCounts?.serious !== 0
      || !Array.isArray(sidecar.accessibility?.violations)
      || sidecar.accessibility.totalViolations !== sidecar.accessibility.violations.length
      || !exact(sidecar.accessibility, screenshot.accessibility)) {
      throw new Error(`protected screenshot sidecar does not bind its exact healthy state: ${tuple}`);
    }
    for (const impact of Object.keys(accessibilityTotals)) {
      const count = sidecar.accessibility.violationCounts?.[impact];
      if (!Number.isInteger(count) || count < 0) throw new Error(`protected Axe count is invalid for ${tuple}/${impact}`);
      accessibilityTotals[impact] += count;
    }
    closure.push(
      { bytes: pngRecord.bytes.length, kind: "protected-browser-screenshot", path: screenshot.path, sha256: screenshot.pngSha256 },
      { bytes: sidecarRecord.bytes.length, kind: "protected-browser-sidecar", path: screenshot.sidecarPath, sha256: screenshot.sidecarSha256 },
    );
    closureBytes += pngRecord.bytes.length + sidecarRecord.bytes.length;
    if (closureBytes > MAX_PROTECTED_BROWSER_CLOSURE_BYTES) {
      throw new Error(`protected browser closure exceeds ${MAX_PROTECTED_BROWSER_CLOSURE_BYTES} bytes`);
    }
  }
  if (observedTuples.size !== EXPECTED_SCREENSHOT_COUNT
    || [...expectedTuples].some((tuple) => !observedTuples.has(tuple))) {
    throw new Error("protected browser screenshot Cartesian product is incomplete");
  }
  const rootRecord = screenshotEvidenceRoot(manifest.screenshots);
  if (manifest.screenshotEvidenceRootSha256 !== rootRecord.sha256) {
    throw new Error("protected browser screenshot evidence root does not match its exact child records");
  }
  const accessibilityTotal = Object.values(accessibilityTotals).reduce((total, count) => total + count, 0);
  if (!exact(manifest.accessibilityAudit.violationCounts, accessibilityTotals)
    || manifest.accessibilityAudit.totalViolations !== accessibilityTotal) {
    throw new Error("protected browser accessibility aggregate does not match its exact sidecars");
  }
  return Object.freeze({
    closure: Object.freeze(closure),
    closureBytes,
    manifest,
    manifestBytes: manifestRecord.bytes,
    manifestSha256: sha256(manifestRecord.bytes),
    screenshotCount: EXPECTED_SCREENSHOT_COUNT,
    screenshotEvidenceRootSha256: rootRecord.sha256,
  });
}
