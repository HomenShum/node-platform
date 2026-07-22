#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";
import { assertExactDistributableCandidate } from "./run-package-install-proof.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const ISSUE_INPUT = "engineering-issues.input.json";
const ENGINEERING_CONTROL_PATHS = Object.freeze([
  ".github/workflows/ease-proof.yml",
  "engineering-issues.input.json",
  "scripts",
  "test",
  "tsconfig.component.json",
  "tsconfig.component-test.json",
  "tsconfig.public.json",
  "vitest.component.config.mjs",
]);

export const ENGINEERING_HEALTH_CHECKS = Object.freeze([
  Object.freeze({ id: "repositoryTests", command: "npm run test:repository", executable: "npm", args: ["run", "test:repository"] }),
  Object.freeze({ id: "componentTests", command: "npm run test:component", executable: "npm", args: ["run", "test:component"] }),
  Object.freeze({ id: "publicTypecheck", command: "npm run typecheck:public", executable: "npm", args: ["run", "typecheck:public"] }),
  Object.freeze({ id: "componentTypecheck", command: "npm run typecheck:component", executable: "npm", args: ["run", "typecheck:component"] }),
  Object.freeze({ id: "componentBuild", command: "npm run build:component", executable: "npm", args: ["run", "build:component"] }),
  Object.freeze({ id: "packageAudit", command: "npm run audit:prod", executable: "npm", args: ["run", "audit:prod"] }),
  Object.freeze({ id: "registry", command: "npm run registry:check", executable: "npm", args: ["run", "registry:check"] }),
  Object.freeze({ id: "ecosystem", command: "npm run ecosystem:check", executable: "npm", args: ["run", "ecosystem:check"] }),
  Object.freeze({ id: "evolution", command: "npm run evolution:verify", executable: "npm", args: ["run", "evolution:verify"] }),
  Object.freeze({ id: "distributionClean", command: "node scripts/run-local-distribution-gate.mjs", executable: "node", args: [] }),
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slash(value) {
  return value.replaceAll("\\", "/");
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileReference(repoRoot, file) {
  const bytes = await readFile(file);
  return { path: slash(path.relative(repoRoot, file)), sha256: digest(bytes) };
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed with exit code ${result.status ?? "unknown"}`);
  return result.stdout.trim();
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function assertEngineeringControlClean(repoRoot) {
  const status = git(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...ENGINEERING_CONTROL_PATHS,
  ]);
  if (status) throw new Error("engineering gate scripts, tests, workflow, type configurations, or issue input are uncommitted");
}

function sanitize(value, repoRoot) {
  let sanitized = String(value ?? "").replaceAll(repoRoot, "<repo>");
  for (const homeDirectory of [process.env.USERPROFILE, process.env.HOME]) {
    if (homeDirectory) sanitized = sanitized.replaceAll(homeDirectory, "<home>");
  }
  return sanitized;
}

export function validateEngineeringIssueInventory(inventory) {
  const errors = [];
  if (inventory?.schemaVersion !== "nodekit.engineering-issue-input/v1") errors.push("engineering issue input schemaVersion is invalid");
  if (!Array.isArray(inventory?.issues)) errors.push("engineering issue inventory issues must be an array");
  const issues = Array.isArray(inventory?.issues) ? inventory.issues : [];
  const unresolved = issues.filter((issue) => issue?.status === "open");
  const unresolvedP0 = unresolved.filter((issue) => issue?.severity === "p0").length;
  const unresolvedP1 = unresolved.filter((issue) => issue?.severity === "p1").length;
  for (const [index, issue] of issues.entries()) {
    if (!issue || typeof issue !== "object") errors.push(`engineering issue ${index} must be an object`);
    else {
      if (typeof issue.id !== "string" || issue.id.length === 0) errors.push(`engineering issue ${index} requires an id`);
      if (!["p0", "p1", "p2", "p3"].includes(issue.severity)) errors.push(`engineering issue ${index} has an invalid severity`);
      if (!["open", "closed"].includes(issue.status)) errors.push(`engineering issue ${index} has an invalid status`);
      if (typeof issue.source !== "string" || issue.source.length === 0) errors.push(`engineering issue ${index} requires a source`);
    }
  }
  return { errors, passed: errors.length === 0, unresolvedP0, unresolvedP1 };
}

async function assertPublishedSurface(repoRoot) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const attestation = packageJson.exports?.["./submission-attestation"];
  if (attestation?.types !== "./src/submission-attestation.d.mts"
    || attestation?.import !== "./src/submission-attestation.mjs"
    || attestation?.default !== "./src/submission-attestation.mjs") {
    throw new Error("package metadata is missing the exact submission-attestation public export");
  }
  for (const [name, target] of [
    ["nodekit-attestation-sign", "scripts/sign-submission-attestation.mjs"],
    ["nodekit-attestation-verify", "scripts/verify-submission-attestation.mjs"],
  ]) {
    if (packageJson.bin?.[name] !== target || !packageJson.files?.includes(target)) {
      throw new Error(`package metadata is missing the exact ${name} bin or packed file`);
    }
    await stat(path.join(repoRoot, target));
  }
  const templatePackage = JSON.parse(await readFile(path.join(repoRoot, "templates", "base", "package.json"), "utf8"));
  if (templatePackage.scripts?.["proof:browser-contract"] !== "node scripts/browser-proof.mjs") {
    throw new Error("base template is missing the structural browser-contract command");
  }
  if (templatePackage.scripts?.["proof:browser"] !== "node scripts/browser-certify.mjs") {
    throw new Error("base template is missing the rendered browser-certification command");
  }
  await Promise.all([
    stat(path.join(repoRoot, "templates", "base", "scripts", "browser-proof.mjs")),
    stat(path.join(repoRoot, "templates", "base", "scripts", "browser-certify.mjs")),
  ]);
  return packageJson;
}

export async function runLocalCandidatePreflight({
  candidateCommit,
  repoRoot = defaultRepoRoot,
  sourceHash,
} = {}) {
  repoRoot = path.resolve(repoRoot);
  candidateCommit ??= git(repoRoot, ["rev-parse", "HEAD"]);
  sourceHash ??= await computeNodeKitSourceHash(repoRoot);
  if (!COMMIT.test(candidateCommit)) throw new Error("candidate commit must be a full lowercase 40-character Git commit");
  if (!SHA256.test(sourceHash)) throw new Error("source hash must be a lowercase 64-character SHA-256 digest");
  await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
  assertEngineeringControlClean(repoRoot);
  const inventoryPath = path.join(repoRoot, ISSUE_INPUT);
  const inventoryStatus = git(repoRoot, ["status", "--porcelain=v1", "--", ISSUE_INPUT]);
  if (inventoryStatus) throw new Error("engineering issue input must be committed and unchanged");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const issueCheck = validateEngineeringIssueInventory(inventory);
  if (!issueCheck.passed) throw new Error(issueCheck.errors.join("; "));
  if (issueCheck.unresolvedP0 !== 0 || issueCheck.unresolvedP1 !== 0) {
    throw new Error(`unresolved engineering blockers remain: P0=${issueCheck.unresolvedP0}, P1=${issueCheck.unresolvedP1}`);
  }
  const packageJson = await assertPublishedSurface(repoRoot);
  return {
    candidateCommit,
    inventory,
    inventoryPath,
    issueCheck,
    nodekitIdentity: `${candidateCommit}/${sourceHash}`,
    packageJson,
    repoRoot,
    sourceHash,
  };
}

async function executeHealthCommand({ candidateCommit, check, index, nodekitSourceHash, repoRoot, outputRoot, args, timeoutMs }) {
  const command = check.executable === "npm" ? npmCommand() : process.execPath;
  const commandArgs = check.executable === "node"
    ? [path.join(repoRoot, "scripts", "run-local-distribution-gate.mjs"), ...args]
    : check.args;
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    maxBuffer: 100 * 1024 * 1024,
    shell: check.executable === "npm" && process.platform === "win32",
    timeout: timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const stdout = sanitize(result.stdout, repoRoot);
  const stderr = sanitize(result.stderr, repoRoot);
  const logPath = path.join(outputRoot, "commands", `${String(index + 1).padStart(2, "0")}-${check.id}.log`);
  const log = [
    `$ ${check.command}${check.id === "distributionClean" ? " --candidate <commit> --source-hash <sha256>" : ""}`,
    "",
    "[stdout]",
    stdout,
    "",
    "[stderr]",
    stderr,
    "",
  ].join("\n");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, log, "utf8");
  const receipt = {
    schemaVersion: "nodekit.engineering-check-receipt/v1",
    candidateCommit,
    nodekitSourceHash,
    checkId: check.id,
    command: `${check.command}${check.id === "distributionClean" ? " --candidate <commit> --source-hash <sha256>" : ""}`,
    exitCode: result.status,
    startedAt,
    completedAt,
  };
  if (result.error || result.status !== 0) {
    const detail = String(stderr || stdout || result.error?.message || "").trim();
    const error = new Error(`${check.id} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail.slice(-2_000)}` : ""}`);
    error.commandReceipt = { ...receipt, diagnosticLog: await fileReference(repoRoot, logPath) };
    throw error;
  }
  const schemaErrors = await validateSchema("nodekit.engineering-check-receipt.v1.schema.json", receipt, `${check.id} receipt`);
  if (schemaErrors.length > 0) throw new Error(schemaErrors.join("; "));
  const receiptPath = path.join(outputRoot, "checks", `${String(index + 1).padStart(2, "0")}-${check.id}.json`);
  await writeJson(receiptPath, receipt);
  const reference = await fileReference(repoRoot, receiptPath);
  return { diagnosticLog: await fileReference(repoRoot, logPath), receipt, reference: { id: check.id, ...reference } };
}

export function createEngineeringHealthVerdict({
  candidateCommit,
  commands,
  issueInventory,
  nodekitSourceHash,
  releaseCandidate,
  completedAt = new Date().toISOString(),
} = {}) {
  const expectedIds = ENGINEERING_HEALTH_CHECKS.map((entry) => entry.id);
  const actualIds = (commands ?? []).map((entry) => entry.id);
  const exactCommands = JSON.stringify(actualIds) === JSON.stringify(expectedIds)
    && commands.every((entry) => typeof entry.path === "string" && SHA256.test(entry.sha256 ?? ""));
  const identityMatches = releaseCandidate?.nodekitCommit === candidateCommit
    && releaseCandidate?.nodekitSourceHash === nodekitSourceHash
    && SHA256.test(releaseCandidate?.nodekitTarballSha256 ?? "")
    && typeof releaseCandidate?.packageName === "string"
    && typeof releaseCandidate?.packageVersion === "string";
  const zeroBlockers = issueInventory?.p0 === 0 && issueInventory?.p1 === 0;
  const checks = Object.fromEntries(expectedIds.map((id) => [id, commands?.some((entry) => entry.id === id) === true]));
  const passed = exactCommands && identityMatches && zeroBlockers && Object.values(checks).every(Boolean);
  return {
    schemaVersion: "nodekit.engineering-health-verdict/v1",
    candidateCommit,
    nodekitCommit: candidateCommit,
    nodekitSourceHash,
    nodekitIdentity: `${candidateCommit}/${nodekitSourceHash}`,
    releaseCandidate,
    completedAt,
    passed,
    checks,
    unresolved: { p0: issueInventory?.p0, p1: issueInventory?.p1 },
    commands,
    issueInventory,
  };
}

export async function runLocalCandidateProof({
  candidateCommit,
  repoRoot = defaultRepoRoot,
  sourceHash,
  timeoutMs = 1_200_000,
} = {}) {
  const preflight = await runLocalCandidatePreflight({ candidateCommit, repoRoot, sourceHash });
  ({ candidateCommit, repoRoot, sourceHash } = preflight);
  const outputRoot = path.join(repoRoot, "proof", "ease", "candidates", candidateCommit, sourceHash, "engineering-health");
  const canonicalVerdictPath = path.join(repoRoot, "proof", "engineering-health-verdict.json");
  const scopedVerdictPath = path.join(outputRoot, "engineering-health-verdict.json");
  const distributionOutput = path.join(outputRoot, "distribution-clean.json");
  await rm(outputRoot, { force: true, recursive: true });
  await rm(canonicalVerdictPath, { force: true });
  await mkdir(outputRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const commandResults = [];
  try {
    const issueInventoryPath = path.join(outputRoot, "issue-inventory.json");
    const issueInventoryValue = {
      schemaVersion: "nodekit.engineering-issue-inventory/v1",
      candidateCommit,
      nodekitSourceHash: sourceHash,
      generatedAt: new Date().toISOString(),
      counts: { p0: preflight.issueCheck.unresolvedP0, p1: preflight.issueCheck.unresolvedP1 },
      issues: preflight.inventory.issues,
    };
    const issueSchemaErrors = await validateSchema("nodekit.engineering-issue-inventory.v1.schema.json", issueInventoryValue, "engineering issue inventory");
    if (issueSchemaErrors.length > 0) throw new Error(issueSchemaErrors.join("; "));
    await writeJson(issueInventoryPath, issueInventoryValue);
    for (const [index, check] of ENGINEERING_HEALTH_CHECKS.entries()) {
      const args = check.id === "distributionClean"
        ? ["--candidate", candidateCommit, "--source-hash", sourceHash, "--repo-root", repoRoot, "--output", distributionOutput, "--timeout-ms", String(timeoutMs)]
        : [];
      commandResults.push(await executeHealthCommand({
        candidateCommit,
        check,
        index,
        nodekitSourceHash: sourceHash,
        repoRoot,
        outputRoot,
        args,
        timeoutMs,
      }));
    }
    await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
    assertEngineeringControlClean(repoRoot);
    const distribution = JSON.parse(await readFile(distributionOutput, "utf8"));
    if (distribution.passed !== true || distribution.certificationStatus !== "LOCAL_STRUCTURAL_READINESS_ONLY") {
      throw new Error("distributionClean did not produce the required local-only passing verdict");
    }
    const issueReference = await fileReference(repoRoot, issueInventoryPath);
    const issueInventory = {
      ...issueReference,
      p0: preflight.issueCheck.unresolvedP0,
      p1: preflight.issueCheck.unresolvedP1,
    };
    const verdict = createEngineeringHealthVerdict({
      candidateCommit,
      commands: commandResults.map((entry) => entry.reference),
      issueInventory,
      nodekitSourceHash: sourceHash,
      releaseCandidate: distribution.releaseCandidate,
    });
    if (!verdict.passed) throw new Error("engineering health verdict failed closed");
    const verdictSchemaErrors = await validateSchema("nodekit.engineering-health-verdict.v1.schema.json", verdict, "engineering health verdict");
    if (verdictSchemaErrors.length > 0) throw new Error(verdictSchemaErrors.join("; "));
    await writeJson(scopedVerdictPath, verdict);
    await writeJson(canonicalVerdictPath, verdict);
    return { canonicalVerdictPath, scopedVerdictPath, verdict };
  } catch (error) {
    const failedCommand = error.commandReceipt ?? null;
    await writeJson(path.join(repoRoot, "proof", "engineering-health-failure.json"), {
      schemaVersion: "nodekit.engineering-health-failure/v1",
      candidateCommit,
      nodekitSourceHash: sourceHash,
      certificationStatus: "LOCAL_ENGINEERING_FAILED",
      completedChecks: commandResults.map((entry) => entry.receipt),
      failedCommand,
      error: sanitize(error.message, repoRoot),
      externalCertificationPerformed: false,
      deployPerformed: false,
      publicationPerformed: false,
      passed: false,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseLocalCandidateArguments(argv) {
  const preflight = argv.includes("--preflight");
  const candidateCommit = option(argv, "--candidate") ?? undefined;
  const sourceHash = option(argv, "--source-hash") ?? undefined;
  if (!preflight && !candidateCommit) throw new Error("--candidate is required for candidate:prove");
  if (!preflight && !sourceHash) throw new Error("--source-hash is required for candidate:prove");
  const timeoutValue = option(argv, "--timeout-ms");
  const timeoutMs = timeoutValue === null ? undefined : Number(timeoutValue);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return {
    candidateCommit,
    preflight,
    repoRoot: option(argv, "--repo-root") ?? defaultRepoRoot,
    sourceHash,
    timeoutMs,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    const options = parseLocalCandidateArguments(process.argv.slice(2));
    if (options.preflight) {
      const result = await runLocalCandidatePreflight(options);
      console.log(`LOCAL CANDIDATE PREFLIGHT PASS ${result.nodekitIdentity}`);
      console.log(`NEXT npm run candidate:prove -- --candidate ${result.candidateCommit} --source-hash ${result.sourceHash}`);
      console.log("NOT EXTERNALLY CERTIFIED; NO DEPLOYMENT, PUBLICATION, OR SUBMISSION WAS PERFORMED");
    } else {
      const result = await runLocalCandidateProof(options);
      console.log(`LOCAL ENGINEERING PASS ${result.verdict.nodekitIdentity}`);
      console.log(`VERDICT ${result.canonicalVerdictPath}`);
      console.log("NOT EXTERNALLY CERTIFIED; NO DEPLOYMENT, PUBLICATION, OR SUBMISSION WAS PERFORMED");
    }
  } catch (error) {
    console.error(`LOCAL CANDIDATE GATE FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
