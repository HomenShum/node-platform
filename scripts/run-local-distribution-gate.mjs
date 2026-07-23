#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExactDistributableCandidate,
  runPackageInstallProof,
} from "./run-package-install-proof.mjs";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const REQUIRED_BROWSER_ASSERTIONS = Object.freeze([
  "artifactPrimary",
  "currentActionVisible",
  "mobileContractPresent",
  "proposalBoundaryVisible",
  "semanticLandmarks",
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileReference(repoRoot, file) {
  const bytes = await readFile(file);
  return {
    path: path.relative(repoRoot, file).replaceAll("\\", "/"),
    sha256: digest(bytes),
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function sanitize(value, replacements) {
  let output = String(value ?? "");
  for (const [needle, replacement] of replacements) {
    if (needle) output = output.replaceAll(needle, replacement);
  }
  return output;
}

function execute(ledger, { args, command, cwd, label, replacements, timeoutMs }) {
  const isNpm = /(?:^|[\\/])npm(?:\.cmd)?$/i.test(command);
  const invocation = isNpm
    ? resolveNpmCliInvocation(args)
    : { args, command, displayArgs: args, displayCommand: path.basename(command).replace(/\.cmd$/i, ""), shell: false };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", npm_config_audit: "false", npm_config_fund: "false" },
    maxBuffer: 50 * 1024 * 1024,
    shell: invocation.shell,
    timeout: timeoutMs,
  });
  const stdout = sanitize(result.stdout, replacements);
  const stderr = sanitize(result.stderr, replacements);
  const record = {
    command: sanitize(`${invocation.displayCommand} ${invocation.displayArgs.join(" ")}`, replacements),
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    label,
    startedAt,
    stderrSha256: digest(stderr),
    stdoutSha256: digest(stdout),
  };
  ledger.push(record);
  if (result.error || result.status !== 0) {
    const detail = String(stderr || stdout || result.error?.message || "").trim();
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail.slice(-2_000)}` : ""}`);
  }
  return { stderr, stdout };
}

export function verifyBrowserContractReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "nodekit.browser-contract/v1") errors.push("browser contract schemaVersion is invalid");
  if (receipt?.passed !== true) errors.push("browser contract did not pass");
  if (!String(receipt?.note ?? "").includes("not rendered-browser certification")) {
    errors.push("browser contract must explicitly disclaim rendered-browser certification");
  }
  for (const id of REQUIRED_BROWSER_ASSERTIONS) {
    if (receipt?.assertions?.[id] !== true) errors.push(`browser contract assertion ${id} did not pass`);
  }
  return { errors, passed: errors.length === 0 };
}

export async function runLocalDistributionGate({
  candidateCommit,
  output,
  repoRoot = defaultRepoRoot,
  sourceHash,
  timeoutMs = 300_000,
} = {}) {
  repoRoot = path.resolve(repoRoot);
  if (!COMMIT.test(candidateCommit ?? "")) throw new Error("--candidate must be a full lowercase 40-character Git commit");
  if (!SHA256.test(sourceHash ?? "")) throw new Error("--source-hash must be a lowercase 64-character SHA-256 digest");
  const candidateRoot = path.join(repoRoot, "proof", "ease", "candidates", candidateCommit, sourceHash);
  const engineeringRoot = path.join(candidateRoot, "engineering-health");
  const outputPath = output ? path.resolve(output) : path.join(engineeringRoot, "distribution-clean.json");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-local-distribution-"));
  const launcherRoot = path.join(tempRoot, "launcher");
  const generatedRoot = path.join(tempRoot, "generated-app");
  const replacements = [[repoRoot, "<repo>"], [tempRoot, "<temp>"]];
  const ledger = [];
  try {
    const packageProof = await runPackageInstallProof({
      candidateCommit,
      repoRoot,
      sourceHash,
      timeoutMs,
    });
    if (!packageProof.passed) throw new Error("exact package/archive proof did not pass");
    const tarballPath = path.join(repoRoot, packageProof.tarball);

    await mkdir(launcherRoot, { recursive: true });
    await writeJson(path.join(launcherRoot, "package.json"), {
      name: "nodekit-local-browser-contract-launcher",
      private: true,
      type: "module",
      version: "0.0.0",
    });
    execute(ledger, {
      args: ["install", tarballPath, "--ignore-scripts", "--no-audit", "--no-fund"],
      command: npmCommand(),
      cwd: launcherRoot,
      label: "install exact packed NodeKit for browser-contract readiness",
      replacements,
      timeoutMs,
    });
    const installedRoot = path.join(launcherRoot, "node_modules", "@homenshum", "nodekit");
    const installedPackage = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
    if (installedPackage.name !== packageProof.package || installedPackage.version !== packageProof.version) {
      throw new Error("browser-contract launcher installed a different NodeKit package identity");
    }
    const installedCli = path.join(installedRoot, installedPackage.bin.nodekit);
    execute(ledger, {
      args: [
        installedCli,
        "create",
        generatedRoot,
        "--name", "nodekit-local-browser-contract",
        "--brief", "Carry one neutral case from intention to a verified artifact.",
        "--nodekit-specifier", "file:vendor/nodekit.tgz",
        "--package-manager", "npm",
        "--no-install",
        "--no-git",
      ],
      command: process.execPath,
      cwd: launcherRoot,
      label: "create exact packed browser-contract application",
      replacements,
      timeoutMs,
    });
    await mkdir(path.join(generatedRoot, "vendor"), { recursive: true });
    await copyFile(tarballPath, path.join(generatedRoot, "vendor", "nodekit.tgz"));
    execute(ledger, {
      args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      command: npmCommand(),
      cwd: generatedRoot,
      label: "install exact browser-contract application",
      replacements,
      timeoutMs,
    });
    execute(ledger, {
      args: ["run", "proof:browser-contract"],
      command: npmCommand(),
      cwd: generatedRoot,
      label: "run structural live HTTP browser contract",
      replacements,
      timeoutMs,
    });
    const browserReceiptSource = path.join(generatedRoot, "proof", "browser-contract.json");
    const browserReceipt = JSON.parse(await readFile(browserReceiptSource, "utf8"));
    const browserVerification = verifyBrowserContractReceipt(browserReceipt);
    if (!browserVerification.passed) throw new Error(browserVerification.errors.join("; "));
    await mkdir(engineeringRoot, { recursive: true });
    const browserReceiptPath = path.join(engineeringRoot, "browser-contract.json");
    await copyFile(browserReceiptSource, browserReceiptPath);

    const ending = await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
    if (ending.actualCommit !== candidateCommit || ending.actualSourceHash !== sourceHash) {
      throw new Error("candidate identity changed during local distribution proof");
    }
    const packageProofPath = path.join(candidateRoot, "package", "package-install-verdict.json");
    const verdict = {
      schemaVersion: "nodekit.local-distribution-gate/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity: `${candidateCommit}/${sourceHash}`,
      releaseCandidate: packageProof.releaseCandidate,
      checks: {
        browserContractReadiness: true,
        candidateIdentityStable: true,
        exactPackageArchiveProof: true,
      },
      evidence: {
        browserContract: await fileReference(repoRoot, browserReceiptPath),
        packageInstallProof: await fileReference(repoRoot, packageProofPath),
      },
      commands: ledger,
      certificationStatus: "LOCAL_STRUCTURAL_READINESS_ONLY",
      externalCertificationPerformed: false,
      renderedBrowserCertificationPerformed: false,
      deployPerformed: false,
      publicationPerformed: false,
      passed: true,
      generatedAt: new Date().toISOString(),
    };
    await writeJson(outputPath, verdict);
    return { outputPath, verdict };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseLocalDistributionArguments(argv) {
  const candidateCommit = option(argv, "--candidate");
  const sourceHash = option(argv, "--source-hash");
  if (!candidateCommit) throw new Error("--candidate is required");
  if (!sourceHash) throw new Error("--source-hash is required");
  const timeoutValue = option(argv, "--timeout-ms");
  const timeoutMs = timeoutValue === null ? undefined : Number(timeoutValue);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return {
    candidateCommit,
    output: option(argv, "--output") ?? undefined,
    repoRoot: option(argv, "--repo-root") ?? defaultRepoRoot,
    sourceHash,
    timeoutMs,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    const { outputPath, verdict } = await runLocalDistributionGate(parseLocalDistributionArguments(process.argv.slice(2)));
    console.log(`LOCAL DISTRIBUTION PASS ${verdict.nodekitIdentity}`);
    console.log(`LOCAL STRUCTURAL BROWSER CONTRACT PASS (NOT RENDERED CERTIFICATION)`);
    console.log(`VERDICT ${outputPath}`);
  } catch (error) {
    console.error(`LOCAL DISTRIBUTION FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
