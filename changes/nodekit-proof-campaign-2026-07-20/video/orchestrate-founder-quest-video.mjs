#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_PATH = join(HERE, "founder-quest-walkthrough.json");
export const EXPECTED_FEATURE_PROOF_STUDIO_COMMIT =
  "7aafb3e0a48f3c1e74e69a51d9df506186ea4340";
const CONFIG_SCHEMA = "nodekit.campaign-video/v1";
const CAPTURE_MANIFEST_SCHEMA = "nodekit.video-capture-receipt/v1";
const FINAL_RECEIPT_SCHEMA = "nodekit.video-proof-receipt/v1";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const ALLOWED_ACTIONS = new Set([
  "click",
  "fill",
  "goto",
  "scrollTop",
  "scrollY",
  "sleep",
  "waitForText",
]);

export class GateBlockedError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "GateBlockedError";
    this.report = report;
  }
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const sha256Bytes = (value) =>
  createHash("sha256").update(value).digest("hex");
export const sha256File = (path) =>
  sha256Bytes(readFileSync(path));

const loadJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const packageCommand = (name, args = []) =>
  process.platform === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", `${name}.cmd`, ...args],
      }
    : { command: name, args };

const exec = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });

const normalizePath = (path) => resolve(path);
const pathWithin = (root, candidate) => {
  const rel = relative(normalizePath(root), normalizePath(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const resolveInside = (root, path, label) => {
  const candidate = resolve(root, path);
  if (!pathWithin(root, candidate)) {
    throw new Error(`${label} escapes the campaign root: ${path}`);
  }
  return candidate;
};

const unique = (values) => [...new Set(values)];
const captureSteps = (profile) =>
  asArray(profile.steps).filter((step) => typeof step.cap === "string");
export const durationFrames = (profile) =>
  captureSteps(profile).reduce((total, step) => total + Number(step.hold || 60), 0);

const durationSeconds = (profile) => durationFrames(profile) / profile.fps;

const exactKeys = (object, required, label, errors) => {
  for (const key of required) {
    if (!(key in (object || {}))) errors.push(`${label}.${key} is required`);
  }
};

export function lintCampaignConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { passed: false, errors: ["config must be an object"] };
  }
  if (config.schemaVersion !== CONFIG_SCHEMA) {
    errors.push(`schemaVersion must be ${CONFIG_SCHEMA}`);
  }
  if (config.featureProofStudio?.commit !== EXPECTED_FEATURE_PROOF_STUDIO_COMMIT) {
    errors.push(
      `Feature Proof Studio must be pinned to ${EXPECTED_FEATURE_PROOF_STUDIO_COMMIT}`,
    );
  }
  if (config.sourceApplication?.productionUrlToken !== "{{PRODUCTION_URL}}") {
    errors.push("production URL must be injected from deployment evidence");
  }
  const serialized = JSON.stringify(config);
  if (/https?:\/\//i.test(serialized)) {
    errors.push("config must not contain a literal URL; use {{PRODUCTION_URL}}");
  }
  if (/localhost|127\.0\.0\.1|\.invalid\b|\.example\b|\.test\b/i.test(serialized)) {
    errors.push("config contains a local or synthetic host marker");
  }
  if (config.sourceApplication?.mode !== "read-only-synthetic") {
    errors.push("sourceApplication.mode must be read-only-synthetic");
  }
  const productionProof = config.productionProof;
  if (!GIT_SHA.test(productionProof?.sourceCommit || "")) {
    errors.push("productionProof.sourceCommit must be a full git SHA");
  }
  if (!GIT_SHA.test(productionProof?.evidenceCommit || "")) {
    errors.push("productionProof.evidenceCommit must be a full git SHA");
  }
  for (const key of [
    "configHash",
    "appHash",
    "receiptDigest",
    "unifiedReleaseReceiptDigest",
  ]) {
    if (!SHA256.test(productionProof?.[key] || "")) {
      errors.push(`productionProof.${key} must be sha256`);
    }
  }
  if (productionProof?.graphRevision !== "ng1_c9334138") {
    errors.push("productionProof.graphRevision must match the verified graph revision");
  }
  if (productionProof?.hostedChecksPassed !== 15) {
    errors.push("productionProof.hostedChecksPassed must be 15");
  }
  if (productionProof?.isolatedBrowserContexts !== 4) {
    errors.push("productionProof.isolatedBrowserContexts must be 4");
  }
  if (productionProof?.releaseLevel !== "production-certified") {
    errors.push("productionProof.releaseLevel must be production-certified");
  }
  if (productionProof?.releaseReady !== true) {
    errors.push("productionProof.releaseReady must be true");
  }
  if (productionProof?.hostedDeploymentCertified !== true) {
    errors.push("productionProof.hostedDeploymentCertified must be true");
  }
  if (productionProof?.artifactManifestHashesVerified !== 25) {
    errors.push("productionProof.artifactManifestHashesVerified must be 25");
  }
  if (productionProof?.testsPassed !== 18) {
    errors.push("productionProof.testsPassed must be 18");
  }
  if (productionProof?.releaseAuditIssues !== 0) {
    errors.push("productionProof.releaseAuditIssues must be 0");
  }
  for (const key of [
    "consoleErrors",
    "pageErrors",
    "networkErrors",
    "crossOriginErrors",
  ]) {
    if (productionProof?.[key] !== 0) {
      errors.push(`productionProof.${key} must be 0`);
    }
  }
  if (productionProof?.readOnlySynthetic !== true) {
    errors.push("productionProof.readOnlySynthetic must be true");
  }
  if (productionProof?.durableWrites !== false) {
    errors.push("productionProof.durableWrites must be false");
  }
  if (productionProof?.remoteNeo4jWrites !== false) {
    errors.push("productionProof.remoteNeo4jWrites must be false");
  }
  if (config.safety?.mutationsAllowed !== false) {
    errors.push("mutationsAllowed must be false");
  }
  if (config.safety?.publishingAllowed !== false) {
    errors.push("publishingAllowed must be false");
  }
  if (config.safety?.deploymentAllowed !== false) {
    errors.push("deploymentAllowed must be false");
  }

  exactKeys(
    config.paths,
    [
      "campaignRoot",
      "claims",
      "evidenceIndex",
      "deploymentReceipt",
      "browserProofReceipt",
      "screenshotManifest",
      "captureManifest",
      "finalReceipt",
      "outputDirectory",
    ],
    "paths",
    errors,
  );

  const profiles = asArray(config.profiles);
  if (profiles.length !== 2) {
    errors.push("exactly two video profiles are required");
  }
  const ids = profiles.map((profile) => profile.id);
  const compositionIds = profiles.map((profile) => profile.compositionId);
  if (unique(ids).length !== ids.length) errors.push("profile ids must be unique");
  if (unique(compositionIds).length !== compositionIds.length) {
    errors.push("composition ids must be unique");
  }

  const prohibited = asArray(config.safety?.prohibitedSelectorTerms).map((term) =>
    String(term).toLowerCase(),
  );
  for (const profile of profiles) {
    const label = `profiles.${profile?.id || "unknown"}`;
    if (!SAFE_ID.test(profile?.id || "")) errors.push(`${label}.id is invalid`);
    if (!SAFE_ID.test(profile?.compositionId || "")) {
      errors.push(`${label}.compositionId is invalid`);
    }
    if (profile?.fps !== 30) errors.push(`${label}.fps must be 30`);
    if (!Number.isInteger(profile?.width) || !Number.isInteger(profile?.height)) {
      errors.push(`${label} dimensions must be integers`);
    }
    const seconds = durationSeconds(profile);
    if (!Number.isFinite(seconds)) errors.push(`${label} duration is invalid`);
    if (seconds < profile.minimumSeconds || seconds > profile.maximumSeconds) {
      errors.push(
        `${label} duration ${seconds.toFixed(2)}s is outside ${profile.minimumSeconds}-${profile.maximumSeconds}s`,
      );
    }
    if (!profile.outputFile?.endsWith(".mp4")) {
      errors.push(`${label}.outputFile must be an mp4`);
    }
    const steps = asArray(profile.steps);
    if (!steps.length) errors.push(`${label}.steps must not be empty`);
    const firstAction = steps.find((step) => step.act);
    if (
      firstAction?.act !== "goto" ||
      firstAction?.url !== config.sourceApplication?.productionUrlToken
    ) {
      errors.push(`${label} must begin from the evidence-injected production URL`);
    }
    const captions = captureSteps(profile);
    if (captions.length < 7) errors.push(`${label} needs at least seven captured states`);

    for (const [index, step] of steps.entries()) {
      if (step.act && !ALLOWED_ACTIONS.has(step.act)) {
        errors.push(`${label}.steps[${index}] uses unsupported action ${step.act}`);
      }
      if (step.act === "goto" && step.url !== "{{PRODUCTION_URL}}") {
        errors.push(`${label}.steps[${index}] contains a non-evidence URL`);
      }
      if (step.act === "fill" && step.commit && step.commit !== "Enter") {
        errors.push(`${label}.steps[${index}] uses an unsupported fill commit`);
      }
      if (step.act === "waitForText") {
        if (!step.sel || !step.text) {
          errors.push(`${label}.steps[${index}] waitForText requires sel and text`);
        }
        if (
          !Number.isInteger(step.timeoutMs) ||
          step.timeoutMs < 1000 ||
          step.timeoutMs > 15000
        ) {
          errors.push(`${label}.steps[${index}] waitForText timeout must be 1000-15000ms`);
        }
      }
      if (step.sel) {
        const selector = String(step.sel).toLowerCase();
        const unsafeTerm = prohibited.find((term) => selector.includes(term));
        if (unsafeTerm) {
          errors.push(
            `${label}.steps[${index}] selector contains prohibited term ${unsafeTerm}`,
          );
        }
      }
      if (step.cap && (!Number.isInteger(step.hold) || step.hold <= 0)) {
        errors.push(`${label}.steps[${index}] capture hold must be a positive integer`);
      }
    }
  }

  const vertical = profiles.find((profile) => profile.format === "vertical-social");
  if (!vertical || vertical.width !== 1080 || vertical.height !== 1920) {
    errors.push("vertical-social profile must be 1080x1920");
  }
  if (!vertical || vertical.minimumSeconds !== 60 || vertical.maximumSeconds !== 90) {
    errors.push("vertical-social profile must target 60-90 seconds");
  }
  const technical = profiles.find(
    (profile) => profile.format === "technical-landscape",
  );
  if (!technical || technical.width !== 1920 || technical.height !== 1080) {
    errors.push("technical-landscape profile must be 1920x1080");
  }
  if (!technical || technical.minimumSeconds !== 120 || technical.maximumSeconds !== 180) {
    errors.push("technical-landscape profile must target 120-180 seconds");
  }

  return {
    passed: errors.length === 0,
    errors,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      frames: durationFrames(profile),
      seconds: durationSeconds(profile),
      captures: captureSteps(profile).length,
    })),
  };
}

const validateProductionUrl = (value, errors) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push("deployment.url must be a valid URL");
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") errors.push("deployment.url must use https");
  if (parsed.username || parsed.password) errors.push("deployment.url cannot contain credentials");
  if (parsed.search || parsed.hash) errors.push("deployment.url cannot contain query or hash state");
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    host.endsWith(".test") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    errors.push("deployment.url must identify a public production host");
  }
  return parsed;
};

const requiredJson = (path, label, errors) => {
  if (!existsSync(path)) {
    errors.push(`${label} is missing: ${path}`);
    return null;
  }
  try {
    return loadJson(path);
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
};

const compareIdentity = (label, candidate, deployment, errors) => {
  for (const key of ["appId", "deploymentId", "url", "commit", "configHash", "appHash"]) {
    if (candidate?.[key] !== deployment?.[key]) {
      errors.push(`${label}.${key} does not match the deployment receipt`);
    }
  }
};

const assertReceiptIdentityShape = (deployment, expectedAppId, errors) => {
  exactKeys(
    deployment,
    [
      "status",
      "production",
      "appId",
      "deploymentId",
      "url",
      "commit",
      "configHash",
      "appHash",
      "receiptDigest",
      "deployedAt",
    ],
    "deployment",
    errors,
  );
  if (deployment?.status !== "deployed") errors.push("deployment.status must be deployed");
  if (deployment?.production !== true) errors.push("deployment.production must be true");
  if (deployment?.appId !== expectedAppId) {
    errors.push(`deployment.appId must be ${expectedAppId}`);
  }
  if (!GIT_SHA.test(deployment?.commit || "")) errors.push("deployment.commit must be a full git SHA");
  if (!SHA256.test(deployment?.configHash || "")) errors.push("deployment.configHash must be sha256");
  if (!SHA256.test(deployment?.appHash || "")) errors.push("deployment.appHash must be sha256");
  if (!SHA256.test(deployment?.receiptDigest || "")) {
    errors.push("deployment.receiptDigest must be sha256");
  }
  if (!deployment?.deploymentId || typeof deployment.deploymentId !== "string") {
    errors.push("deployment.deploymentId must be non-empty");
  }
  validateProductionUrl(deployment?.url, errors);
};

const validateBrowserProof = (browserProof, deployment, config, errors) => {
  exactKeys(
    browserProof,
    [
      "status",
      "journeyId",
      "appId",
      "deploymentId",
      "url",
      "commit",
      "configHash",
      "appHash",
      "freshUser",
      "readOnlySynthetic",
      "consoleErrors",
      "networkErrors",
      "verifiedAt",
    ],
    "browserProof",
    errors,
  );
  if (browserProof?.status !== config.identityContract.browserProofStatus) {
    errors.push(`browserProof.status must be ${config.identityContract.browserProofStatus}`);
  }
  if (browserProof?.journeyId !== config.journeyId) {
    errors.push(`browserProof.journeyId must be ${config.journeyId}`);
  }
  if (config.identityContract.requireFreshUser && browserProof?.freshUser !== true) {
    errors.push("browserProof.freshUser must be true");
  }
  if (
    config.identityContract.requireReadOnlySynthetic &&
    browserProof?.readOnlySynthetic !== true
  ) {
    errors.push("browserProof.readOnlySynthetic must be true");
  }
  if (browserProof?.consoleErrors !== config.identityContract.maxConsoleErrors) {
    errors.push(`browserProof.consoleErrors must be ${config.identityContract.maxConsoleErrors}`);
  }
  if (browserProof?.networkErrors !== config.identityContract.maxNetworkErrors) {
    errors.push(`browserProof.networkErrors must be ${config.identityContract.maxNetworkErrors}`);
  }
  compareIdentity("browserProof", browserProof, deployment, errors);
};

const validateScreenshots = (manifest, deployment, config, campaignRoot, errors) => {
  exactKeys(
    manifest,
    [
      "status",
      "appId",
      "deploymentId",
      "url",
      "commit",
      "configHash",
      "appHash",
      "screenshots",
    ],
    "screenshotManifest",
    errors,
  );
  if (manifest?.status !== "pass") errors.push("screenshotManifest.status must be pass");
  compareIdentity("screenshotManifest", manifest, deployment, errors);
  const screenshots = asArray(manifest?.screenshots);
  const ids = screenshots.map((item) => item?.id);
  for (const requiredId of config.identityContract.requiredScreenshotIds) {
    if (!ids.includes(requiredId)) {
      errors.push(`screenshotManifest is missing required screenshot ${requiredId}`);
    }
  }
  if (unique(ids).length !== ids.length) errors.push("screenshot ids must be unique");
  for (const [index, screenshot] of screenshots.entries()) {
    if (!screenshot?.id || !screenshot?.path || !SHA256.test(screenshot?.sha256 || "")) {
      errors.push(`screenshotManifest.screenshots[${index}] is incomplete`);
      continue;
    }
    let screenshotPath;
    try {
      screenshotPath = resolveInside(
        campaignRoot,
        screenshot.path,
        `screenshot ${screenshot.id}`,
      );
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    if (!existsSync(screenshotPath)) {
      errors.push(`screenshot ${screenshot.id} is missing: ${screenshot.path}`);
      continue;
    }
    if (sha256File(screenshotPath) !== screenshot.sha256) {
      errors.push(`screenshot ${screenshot.id} sha256 mismatch`);
    }
  }
};

const validateClaim = (claims, evidenceIndex, deployment, config, errors) => {
  const claim = asArray(claims?.claims).find(
    (candidate) => candidate.id === config.sourceApplication.requiredClaimId,
  );
  if (!claim) {
    errors.push(`claim ${config.sourceApplication.requiredClaimId} is missing`);
    return null;
  }
  if (!["verified", "measured"].includes(claim.status)) {
    errors.push(
      `claim ${claim.id} must be verified or measured before capture; current status is ${claim.status}`,
    );
  }
  if (!asArray(claim.evidenceIds).length) {
    errors.push(`claim ${claim.id} has no evidence`);
  }
  const evidenceIds = new Set(
    asArray(evidenceIndex?.evidence).map((evidence) => evidence.id),
  );
  for (const id of asArray(claim.evidenceIds)) {
    if (!evidenceIds.has(id)) errors.push(`claim ${claim.id} references missing evidence ${id}`);
  }
  const expectedScope = {
    commit: config.productionProof?.sourceCommit,
    evidenceCommit: config.productionProof?.evidenceCommit,
    configHash: config.productionProof?.configHash,
    appHash: config.productionProof?.appHash,
    graphRevision: config.productionProof?.graphRevision,
    productionUrl: deployment?.url,
    productionReceiptDigest: config.productionProof?.receiptDigest,
    unifiedReleaseReceiptDigest:
      config.productionProof?.unifiedReleaseReceiptDigest,
    releaseLevel: config.productionProof?.releaseLevel,
    releaseReady: config.productionProof?.releaseReady,
    hostedDeploymentCertified:
      config.productionProof?.hostedDeploymentCertified,
    hostedChecksPassed: config.productionProof?.hostedChecksPassed,
    isolatedBrowserContexts: config.productionProof?.isolatedBrowserContexts,
    artifactManifestHashesVerified:
      config.productionProof?.artifactManifestHashesVerified,
    testsPassed: config.productionProof?.testsPassed,
    releaseAuditIssues: config.productionProof?.releaseAuditIssues,
  };
  for (const [key, value] of Object.entries(expectedScope)) {
    if (claim.scope?.[key] !== value) {
      errors.push(`claim ${claim.id} scope.${key} does not match deployment evidence`);
    }
  }
  for (const [key, value] of Object.entries({
    commit: config.productionProof?.sourceCommit,
    configHash: config.productionProof?.configHash,
    appHash: config.productionProof?.appHash,
    receiptDigest: config.productionProof?.receiptDigest,
  })) {
    if (deployment?.[key] !== value) {
      errors.push(`deployment.${key} does not match the checked-in production proof`);
    }
  }
  return claim;
};

export function validateClaimBinding({
  claims,
  evidenceIndex,
  deployment,
  config,
}) {
  const errors = [];
  const claim = validateClaim(
    claims,
    evidenceIndex,
    deployment,
    config,
    errors,
  );
  return { passed: errors.length === 0, errors, claim };
}

const gitOutput = (args, cwd) =>
  exec("git", ["-C", cwd, ...args], { capture: true }).trim();

const validateFeatureProofStudio = (fpsRoot, config, errors) => {
  if (!fpsRoot || !existsSync(fpsRoot)) {
    errors.push(`Feature Proof Studio repository is missing: ${fpsRoot || "(unset)"}`);
    return null;
  }
  try {
    const exact = gitOutput(
      ["rev-parse", `${config.featureProofStudio.commit}^{commit}`],
      fpsRoot,
    );
    if (exact !== config.featureProofStudio.commit) {
      errors.push("Feature Proof Studio commit did not resolve exactly");
    }
    for (const requiredPath of [
      config.featureProofStudio.captureEntrypoint,
      "src/Walkthrough.jsx",
      "src/walkthrough.data.js",
      "package-lock.json",
    ]) {
      gitOutput(["cat-file", "-e", `${exact}:${requiredPath}`], fpsRoot);
    }
    return exact;
  } catch (error) {
    errors.push(`Feature Proof Studio pin validation failed: ${error.message}`);
    return null;
  }
};

export function resolveCampaignPaths(config, configPath = DEFAULT_CONFIG_PATH) {
  const configDirectory = dirname(resolve(configPath));
  const campaignRoot = resolve(configDirectory, config.paths.campaignRoot);
  return {
    configPath: resolve(configPath),
    configDirectory,
    campaignRoot,
    claims: resolveInside(campaignRoot, config.paths.claims, "claims"),
    evidenceIndex: resolveInside(
      campaignRoot,
      config.paths.evidenceIndex,
      "evidence index",
    ),
    deploymentReceipt: resolveInside(
      campaignRoot,
      config.paths.deploymentReceipt,
      "deployment receipt",
    ),
    browserProofReceipt: resolveInside(
      campaignRoot,
      config.paths.browserProofReceipt,
      "browser proof receipt",
    ),
    screenshotManifest: resolveInside(
      campaignRoot,
      config.paths.screenshotManifest,
      "screenshot manifest",
    ),
    captureManifest: resolveInside(
      campaignRoot,
      config.paths.captureManifest,
      "capture manifest",
    ),
    finalReceipt: resolveInside(
      campaignRoot,
      config.paths.finalReceipt,
      "final receipt",
    ),
    outputDirectory: resolveInside(
      campaignRoot,
      config.paths.outputDirectory,
      "output directory",
    ),
  };
}

export function evaluatePreflight({
  config,
  configPath = DEFAULT_CONFIG_PATH,
  fpsRoot,
  checkRepository = true,
}) {
  const errors = [];
  const lint = lintCampaignConfig(config);
  errors.push(...lint.errors);
  if (!lint.passed) {
    return { passed: false, errors, lint };
  }
  const paths = resolveCampaignPaths(config, configPath);
  const claims = requiredJson(paths.claims, "claim ledger", errors);
  const evidenceIndex = requiredJson(paths.evidenceIndex, "evidence index", errors);
  const deployment = requiredJson(paths.deploymentReceipt, "deployment receipt", errors);
  const browserProof = requiredJson(
    paths.browserProofReceipt,
    "browser proof receipt",
    errors,
  );
  const screenshotManifest = requiredJson(
    paths.screenshotManifest,
    "screenshot manifest",
    errors,
  );

  if (deployment) {
    assertReceiptIdentityShape(
      deployment,
      config.sourceApplication.appId,
      errors,
    );
  }
  if (deployment && browserProof) {
    validateBrowserProof(browserProof, deployment, config, errors);
  }
  if (deployment && screenshotManifest) {
    validateScreenshots(
      screenshotManifest,
      deployment,
      config,
      paths.campaignRoot,
      errors,
    );
  }
  if (deployment && claims && evidenceIndex) {
    validateClaim(claims, evidenceIndex, deployment, config, errors);
  }

  let fpsCommit = null;
  if (checkRepository) {
    fpsCommit = validateFeatureProofStudio(fpsRoot, config, errors);
  }

  return {
    passed: errors.length === 0,
    errors,
    lint,
    paths,
    deployment,
    browserProof,
    screenshotManifest,
    fpsCommit,
  };
}

const requirePassedPreflight = (context) => {
  const report = evaluatePreflight(context);
  if (!report.passed) {
    throw new GateBlockedError(
      "Founder Quest video preflight is blocked by missing or invalid proof",
      report,
    );
  }
  return report;
};

const adaptWalkthroughHostLabel = (stageRoot) => {
  const path = join(stageRoot, "src", "Walkthrough.jsx");
  let source = readFileSync(path, "utf8");
  const replacements = [
    [
      "const Chrome = ({ accent }) => (",
      "const Chrome = ({ accent, browserLabel }) => (",
    ],
    [
      '<span style={{ color: accent }}>🔒</span> parselyfi.streamlit.app',
      '<span style={{ color: accent }}>🔒</span> {browserLabel}',
    ],
    [
      "<Chrome accent={wt.accent} />",
      '<Chrome accent={wt.accent} browserLabel={wt.browserLabel || "verified production"} />',
    ],
    [
      'else if (a.act === "sleep") { await sleep(p, a.ms); }',
      'else if (a.act === "sleep") { await sleep(p, a.ms); }\n  else if (a.act === "waitForText") { await loc(p, a.sel).filter({ hasText: new RegExp(a.text, "i") }).waitFor({ state: "visible", timeout: a.timeoutMs || 10000 }); }',
    ],
  ];
  for (const [before, after] of replacements) {
    if (!source.includes(before)) {
      throw new Error(`Feature Proof Studio adapter anchor is missing: ${before}`);
    }
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
  return sha256File(path);
};

const renderCaptureSpecs = (config, productionUrl) => {
  const host = new URL(productionUrl).hostname;
  const specs = config.profiles.map((profile) => ({
    id: profile.id,
    title: profile.title,
    accent: profile.accent,
    vw: config.featureProofStudio.captureViewport.width,
    vh: config.featureProofStudio.captureViewport.height,
    retries: profile.retries,
    browserLabel: host,
    steps: profile.steps.map((step) => {
      if (step.act === "goto") return { ...step, url: productionUrl };
      return step;
    }),
  }));
  return `// Generated by NodeKit from an evidence-gated campaign spec.\nexport const SOLO_FOUNDER_SPECS = ${JSON.stringify(specs, null, 2)};\n`;
};

const ensureCleanCampaignCommit = (campaignRoot, errors) => {
  const repositoryRoot = gitOutput(["rev-parse", "--show-toplevel"], campaignRoot);
  const status = gitOutput(["status", "--porcelain"], repositoryRoot);
  if (status) errors.push("campaign repository must be clean before capture");
  const commit = gitOutput(["rev-parse", "HEAD"], repositoryRoot);
  if (!GIT_SHA.test(commit)) errors.push("campaign commit is not a full git SHA");
  return { repositoryRoot, commit };
};

const prepareStage = ({ config, paths, fpsRoot, workRoot, deployment }) => {
  const configHash = sha256File(paths.configPath);
  const safeDeploymentId = deployment.deploymentId.replace(/[^A-Za-z0-9.-]/g, "-");
  const stageRoot = resolve(workRoot, `${configHash.slice(0, 12)}-${safeDeploymentId}`);
  if (!pathWithin(workRoot, stageRoot)) {
    throw new Error("computed stage directory escapes work root");
  }
  if (existsSync(stageRoot)) {
    throw new Error(
      `stage already exists; preserve it for forensics or choose a new --work-root: ${stageRoot}`,
    );
  }
  mkdirSync(stageRoot, { recursive: true });
  const archivePath = resolve(workRoot, `${configHash.slice(0, 12)}-${safeDeploymentId}.tar`);
  exec("git", [
    "-C",
    fpsRoot,
    "archive",
    "--format=tar",
    "--output",
    archivePath,
    config.featureProofStudio.commit,
  ]);
  exec("tar", ["-xf", archivePath, "-C", stageRoot]);
  unlinkSync(archivePath);

  const captureScriptPath = join(
    stageRoot,
    config.featureProofStudio.captureEntrypoint,
  );
  const upstreamCaptureSha256 = sha256File(captureScriptPath);
  const adaptedWalkthroughSha256 = adaptWalkthroughHostLabel(stageRoot);
  writeFileSync(
    join(stageRoot, config.featureProofStudio.captureSpecSlot),
    renderCaptureSpecs(config, deployment.url),
  );
  copyFileSync(
    join(paths.configDirectory, "feature-proof-root.jsx"),
    join(stageRoot, "src", "NodeKitCampaignRoot.jsx"),
  );
  copyFileSync(
    join(paths.configDirectory, "feature-proof-index.js"),
    join(stageRoot, "src", "nodekit-campaign-index.js"),
  );
  return {
    stageRoot,
    configHash,
    upstreamCaptureSha256,
    adaptedWalkthroughSha256,
    generatedSpecSha256: sha256File(
      join(stageRoot, config.featureProofStudio.captureSpecSlot),
    ),
    remotionRootSha256: sha256File(
      join(stageRoot, "src", "NodeKitCampaignRoot.jsx"),
    ),
  };
};

const loadCapturedWalkthroughs = async (stageRoot) => {
  const path = join(stageRoot, "src", "walkthrough.data.js");
  const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
  return module.WALKTHROUGHS;
};

const walkFiles = (root) => {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
};

const validateCapture = async (config, stageRoot) => {
  const errors = [];
  const walkthroughs = await loadCapturedWalkthroughs(stageRoot);
  const frames = [];
  for (const profile of config.profiles) {
    const captured = walkthroughs.find((item) => item.id === profile.id);
    const expectedCount = captureSteps(profile).length;
    if (!captured) {
      errors.push(`capture data is missing ${profile.id}`);
      continue;
    }
    if (asArray(captured.steps).length !== expectedCount) {
      errors.push(
        `${profile.id} captured ${asArray(captured.steps).length}/${expectedCount} required states`,
      );
    }
    const frameRoot = join(stageRoot, "public", "wt", profile.id);
    if (!existsSync(frameRoot)) {
      errors.push(`${profile.id} frame directory is missing`);
      continue;
    }
    if (existsSync(join(frameRoot, "zz-fail.png"))) {
      errors.push(`${profile.id} contains Feature Proof Studio failure forensics`);
    }
    for (const file of walkFiles(frameRoot)) {
      if (!file.endsWith(".png")) continue;
      if (statSync(file).size === 0) errors.push(`empty frame: ${file}`);
      frames.push({
        profileId: profile.id,
        path: relative(stageRoot, file).replaceAll("\\", "/"),
        sha256: sha256File(file),
        bytes: statSync(file).size,
      });
    }
  }
  return { passed: errors.length === 0, errors, walkthroughs, frames };
};

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export async function captureCampaign({
  config,
  configPath = DEFAULT_CONFIG_PATH,
  fpsRoot,
  workRoot,
  skipInstall = false,
}) {
  const preflight = requirePassedPreflight({ config, configPath, fpsRoot });
  const repositoryErrors = [];
  const campaignIdentity = ensureCleanCampaignCommit(
    preflight.paths.campaignRoot,
    repositoryErrors,
  );
  if (repositoryErrors.length) {
    throw new GateBlockedError("campaign identity gate failed", {
      passed: false,
      errors: repositoryErrors,
    });
  }
  mkdirSync(workRoot, { recursive: true });
  const stage = prepareStage({
    config,
    paths: preflight.paths,
    fpsRoot,
    workRoot,
    deployment: preflight.deployment,
  });
  if (!skipInstall) {
    const install = packageCommand("npm", ["ci", "--ignore-scripts=false"]);
    exec(install.command, install.args, {
      cwd: stage.stageRoot,
    });
  }
  exec("node", [config.featureProofStudio.captureEntrypoint], {
    cwd: stage.stageRoot,
    env: {
      ...process.env,
      DEMO_URL: preflight.deployment.url,
    },
  });
  const capture = await validateCapture(config, stage.stageRoot);
  if (!capture.passed) {
    throw new GateBlockedError("Feature Proof Studio capture is incomplete", capture);
  }

  const durableCaptureRoot = join(preflight.paths.outputDirectory, "capture");
  if (existsSync(durableCaptureRoot)) {
    throw new Error(
      `durable capture directory already exists; preserve or move it before recapture: ${durableCaptureRoot}`,
    );
  }
  mkdirSync(preflight.paths.outputDirectory, { recursive: true });
  cpSync(join(stage.stageRoot, "public", "wt"), durableCaptureRoot, {
    recursive: true,
    errorOnExist: true,
  });

  const receipt = {
    schemaVersion: CAPTURE_MANIFEST_SCHEMA,
    status: "captured",
    capturedAt: new Date().toISOString(),
    campaignId: config.campaignId,
    journeyId: config.journeyId,
    campaignCommit: campaignIdentity.commit,
    configSha256: stage.configHash,
    deployment: {
      appId: preflight.deployment.appId,
      deploymentId: preflight.deployment.deploymentId,
      url: preflight.deployment.url,
      commit: preflight.deployment.commit,
      configHash: preflight.deployment.configHash,
      appHash: preflight.deployment.appHash,
    },
    featureProofStudio: {
      commit: config.featureProofStudio.commit,
      upstreamCaptureSha256: stage.upstreamCaptureSha256,
      adaptedWalkthroughSha256: stage.adaptedWalkthroughSha256,
      generatedSpecSha256: stage.generatedSpecSha256,
      remotionRootSha256: stage.remotionRootSha256,
      packageLockSha256: sha256File(join(stage.stageRoot, "package-lock.json")),
      walkthroughDataSha256: sha256File(
        join(stage.stageRoot, "src", "walkthrough.data.js"),
      ),
      stageRoot: stage.stageRoot,
    },
    prerequisiteEvidence: {
      deploymentReceiptSha256: sha256File(preflight.paths.deploymentReceipt),
      browserProofReceiptSha256: sha256File(preflight.paths.browserProofReceipt),
      screenshotManifestSha256: sha256File(preflight.paths.screenshotManifest),
    },
    profiles: config.profiles.map((profile) => ({
      id: profile.id,
      expectedCaptures: captureSteps(profile).length,
      durationFrames: durationFrames(profile),
      durationSeconds: durationSeconds(profile),
    })),
    frames: capture.frames,
    durableCaptureRoot: relative(
      preflight.paths.campaignRoot,
      durableCaptureRoot,
    ).replaceAll("\\", "/"),
  };
  writeJson(preflight.paths.captureManifest, receipt);
  return { preflight, receipt };
}

const requireCaptureReceipt = (config, preflight) => {
  const errors = [];
  const receipt = requiredJson(
    preflight.paths.captureManifest,
    "capture manifest",
    errors,
  );
  if (!receipt) {
    throw new GateBlockedError("capture receipt is missing", {
      passed: false,
      errors,
    });
  }
  if (receipt.schemaVersion !== CAPTURE_MANIFEST_SCHEMA) {
    errors.push(`capture receipt schema must be ${CAPTURE_MANIFEST_SCHEMA}`);
  }
  if (receipt.status !== "captured") errors.push("capture receipt status must be captured");
  if (receipt.configSha256 !== sha256File(preflight.paths.configPath)) {
    errors.push("capture receipt config hash is stale");
  }
  compareIdentity("captureReceipt.deployment", receipt.deployment, preflight.deployment, errors);
  if (receipt.featureProofStudio?.commit !== config.featureProofStudio.commit) {
    errors.push("capture receipt Feature Proof Studio commit mismatch");
  }
  if (!existsSync(receipt.featureProofStudio?.stageRoot || "")) {
    errors.push("capture receipt stage root is missing");
  }
  const stageRoot = receipt.featureProofStudio?.stageRoot;
  if (stageRoot && existsSync(stageRoot)) {
    const stageBindings = [
      [
        config.featureProofStudio.captureEntrypoint,
        receipt.featureProofStudio.upstreamCaptureSha256,
        "upstream capture entrypoint",
      ],
      [
        "src/Walkthrough.jsx",
        receipt.featureProofStudio.adaptedWalkthroughSha256,
        "adapted walkthrough",
      ],
      [
        config.featureProofStudio.captureSpecSlot,
        receipt.featureProofStudio.generatedSpecSha256,
        "generated capture spec",
      ],
      [
        "src/NodeKitCampaignRoot.jsx",
        receipt.featureProofStudio.remotionRootSha256,
        "campaign Remotion root",
      ],
      [
        "package-lock.json",
        receipt.featureProofStudio.packageLockSha256,
        "Feature Proof Studio package lock",
      ],
      [
        "src/walkthrough.data.js",
        receipt.featureProofStudio.walkthroughDataSha256,
        "captured walkthrough data",
      ],
    ];
    for (const [relativePath, expectedHash, label] of stageBindings) {
      const path = join(stageRoot, relativePath);
      if (!existsSync(path)) errors.push(`${label} is missing from the capture stage`);
      else if (!SHA256.test(expectedHash || "") || sha256File(path) !== expectedHash) {
        errors.push(`${label} hash does not match the capture receipt`);
      }
    }
    for (const frame of asArray(receipt.frames)) {
      const path = resolve(stageRoot, frame.path || "");
      if (!pathWithin(stageRoot, path)) {
        errors.push(`captured frame escapes stage root: ${frame.path}`);
      } else if (!existsSync(path)) {
        errors.push(`captured frame is missing: ${frame.path}`);
      } else if (!SHA256.test(frame.sha256 || "") || sha256File(path) !== frame.sha256) {
        errors.push(`captured frame hash mismatch: ${frame.path}`);
      }
    }
  }
  for (const [key, path] of [
    ["deploymentReceiptSha256", preflight.paths.deploymentReceipt],
    ["browserProofReceiptSha256", preflight.paths.browserProofReceipt],
    ["screenshotManifestSha256", preflight.paths.screenshotManifest],
  ]) {
    if (receipt.prerequisiteEvidence?.[key] !== sha256File(path)) {
      errors.push(`capture receipt prerequisite ${key} is stale`);
    }
  }
  try {
    const campaignRepository = gitOutput(
      ["rev-parse", "--show-toplevel"],
      preflight.paths.campaignRoot,
    );
    const currentCommit = gitOutput(["rev-parse", "HEAD"], campaignRepository);
    if (receipt.campaignCommit !== currentCommit) {
      errors.push("campaign commit changed after capture");
    }
  } catch (error) {
    errors.push(`could not verify campaign commit after capture: ${error.message}`);
  }
  if (errors.length) {
    throw new GateBlockedError("capture receipt identity gate failed", {
      passed: false,
      errors,
    });
  }
  return receipt;
};

export function buildRenderCommands(config, stageRoot, outputDirectory) {
  return config.profiles.map((profile) => {
    const invocation = packageCommand("npx", [
      "remotion",
      "render",
      config.featureProofStudio.remotionEntrypoint,
      profile.compositionId,
      join(outputDirectory, profile.outputFile),
      "--codec=h264",
      "--concurrency=2",
    ]);
    return {
      profileId: profile.id,
      ...invocation,
      cwd: stageRoot,
    };
  });
}

export function renderCampaign({
  config,
  configPath = DEFAULT_CONFIG_PATH,
  fpsRoot,
}) {
  const preflight = requirePassedPreflight({ config, configPath, fpsRoot });
  const captureReceipt = requireCaptureReceipt(config, preflight);
  mkdirSync(preflight.paths.outputDirectory, { recursive: true });
  const commands = buildRenderCommands(
    config,
    captureReceipt.featureProofStudio.stageRoot,
    preflight.paths.outputDirectory,
  );
  for (const command of commands) {
    exec(command.command, command.args, { cwd: command.cwd });
  }
  return { preflight, captureReceipt, commands };
}

const probeVideo = (path) => {
  const raw = exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-of",
      "json",
      path,
    ],
    { capture: true },
  );
  const parsed = JSON.parse(raw);
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error(`ffprobe found no video stream in ${path}`);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    durationSeconds: Number(stream.duration),
  };
};

export function finalizeCampaign({
  config,
  configPath = DEFAULT_CONFIG_PATH,
  fpsRoot,
}) {
  const preflight = requirePassedPreflight({ config, configPath, fpsRoot });
  const captureReceipt = requireCaptureReceipt(config, preflight);
  const errors = [];
  const videos = [];
  for (const profile of config.profiles) {
    const path = join(preflight.paths.outputDirectory, profile.outputFile);
    if (!existsSync(path)) {
      errors.push(`rendered video is missing: ${profile.outputFile}`);
      continue;
    }
    let probe;
    try {
      probe = probeVideo(path);
    } catch (error) {
      errors.push(`could not probe ${profile.outputFile}: ${error.message}`);
      continue;
    }
    if (probe.width !== profile.width || probe.height !== profile.height) {
      errors.push(
        `${profile.outputFile} is ${probe.width}x${probe.height}; expected ${profile.width}x${profile.height}`,
      );
    }
    if (
      probe.durationSeconds < profile.minimumSeconds ||
      probe.durationSeconds > profile.maximumSeconds
    ) {
      errors.push(
        `${profile.outputFile} duration ${probe.durationSeconds.toFixed(2)}s is outside ${profile.minimumSeconds}-${profile.maximumSeconds}s`,
      );
    }
    videos.push({
      profileId: profile.id,
      compositionId: profile.compositionId,
      path: relative(preflight.paths.campaignRoot, path).replaceAll("\\", "/"),
      sha256: sha256File(path),
      bytes: statSync(path).size,
      ...probe,
    });
  }
  if (errors.length) {
    throw new GateBlockedError("final video proof gate failed", {
      passed: false,
      errors,
    });
  }

  const campaignRoot = gitOutput(
    ["rev-parse", "--show-toplevel"],
    preflight.paths.campaignRoot,
  );
  const receipt = {
    schemaVersion: FINAL_RECEIPT_SCHEMA,
    status: "verified",
    verifiedAt: new Date().toISOString(),
    campaignId: config.campaignId,
    journeyId: config.journeyId,
    campaignCommit: gitOutput(["rev-parse", "HEAD"], campaignRoot),
    configSha256: sha256File(preflight.paths.configPath),
    deployment: captureReceipt.deployment,
    featureProofStudio: {
      commit: config.featureProofStudio.commit,
      captureEntrypoint: config.featureProofStudio.captureEntrypoint,
      remotionEntrypoint: config.featureProofStudio.remotionEntrypoint,
      adaptedWalkthroughSha256:
        captureReceipt.featureProofStudio.adaptedWalkthroughSha256,
      generatedSpecSha256:
        captureReceipt.featureProofStudio.generatedSpecSha256,
      remotionRootSha256:
        captureReceipt.featureProofStudio.remotionRootSha256,
      packageLockSha256:
        captureReceipt.featureProofStudio.packageLockSha256,
      walkthroughDataSha256:
        captureReceipt.featureProofStudio.walkthroughDataSha256,
    },
    prerequisites: {
      deploymentReceiptSha256: sha256File(preflight.paths.deploymentReceipt),
      browserProofReceiptSha256: sha256File(preflight.paths.browserProofReceipt),
      screenshotManifestSha256: sha256File(preflight.paths.screenshotManifest),
      captureManifestSha256: sha256File(preflight.paths.captureManifest),
    },
    videos,
    claimImpact: {
      claimId: "C7_RECURSIVE_LAUNCH",
      statusAfterVideoOnly: "partial",
      note: "Video proof does not verify publication. Public URLs and distribution receipts remain separate gates.",
    },
    limitations: [
      "The demonstrated company and completion receipts are synthetic.",
      "The video proves one read-only production journey, not external approval or unrestricted agent authority.",
      "No deployment, publication, reply, direct message, or paid promotion is performed by this orchestrator.",
    ],
  };
  writeJson(preflight.paths.finalReceipt, receipt);
  return { preflight, receipt };
}

const parseArgs = (argv) => {
  const args = [...argv];
  const command = args.shift() || "lint";
  const options = { command, skipInstall: false };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--config") options.configPath = resolve(args.shift());
    else if (arg === "--fps-root") options.fpsRoot = resolve(args.shift());
    else if (arg === "--work-root") options.workRoot = resolve(args.shift());
    else if (arg === "--skip-install") options.skipInstall = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

const inferredFpsRoot = (config, configPath) =>
  resolve(
    dirname(configPath),
    process.env.FEATURE_PROOF_STUDIO_ROOT ||
      config.featureProofStudio.repositoryPathHint,
  );

const cli = async () => {
  const options = parseArgs(process.argv.slice(2));
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const config = loadJson(configPath);
  const fpsRoot = options.fpsRoot || inferredFpsRoot(config, configPath);
  const paths = resolveCampaignPaths(config, configPath);
  const workRoot =
    options.workRoot ||
    resolve(
      gitOutput(["rev-parse", "--show-toplevel"], paths.campaignRoot),
      ".tmp",
      "nodekit-proof-video",
    );

  let result;
  if (options.command === "lint") {
    result = lintCampaignConfig(config);
    if (!result.passed) throw new GateBlockedError("video spec lint failed", result);
  } else if (options.command === "preflight") {
    result = requirePassedPreflight({ config, configPath, fpsRoot });
  } else if (options.command === "capture") {
    result = await captureCampaign({
      config,
      configPath,
      fpsRoot,
      workRoot,
      skipInstall: options.skipInstall,
    });
  } else if (options.command === "render") {
    result = renderCampaign({ config, configPath, fpsRoot });
  } else if (options.command === "finalize") {
    result = finalizeCampaign({ config, configPath, fpsRoot });
  } else if (options.command === "all") {
    await captureCampaign({
      config,
      configPath,
      fpsRoot,
      workRoot,
      skipInstall: options.skipInstall,
    });
    renderCampaign({ config, configPath, fpsRoot });
    result = finalizeCampaign({ config, configPath, fpsRoot });
  } else {
    throw new Error(
      `Unknown command ${options.command}; expected lint, preflight, capture, render, finalize, or all`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  cli().catch((error) => {
    const blocked = error instanceof GateBlockedError;
    const payload = {
      status: blocked ? "blocked" : "error",
      message: error.message,
      ...(error.report ? { report: error.report } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(blocked ? 2 : 1);
  });
}
