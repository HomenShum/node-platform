#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "./lib/dashboard.mjs";
import { pathExists } from "./lib/files.mjs";
import { checkRepository, commandFor } from "./lib/repo-check.mjs";
import { loadRegistry, validateRegistry } from "./lib/registry.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  const tokens = separator >= 0 ? argv.slice(0, separator) : [...argv];
  const options = {};
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[rawName] = inlineValue;
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      options[rawName] = tokens[index + 1];
      index += 1;
    } else {
      options[rawName] = true;
    }
  }

  return { commandArgs, options, positional };
}

function printHelp() {
  console.log(`NodeKit P0

Usage:
  nodekit doctor [--repo-root <path>] [--json]
  nodekit dev|demo|check|proof [--repo-root <path>] [-- <args>]
  nodekit repo check [--repo-root <path>] [--json]
  nodekit registry check [--registry-root <path>] [--json]
  nodekit ecosystem check [--workspace <path>] [--json]
  nodekit dashboard [--workspace <path>] [--write] [--out <path>]
  nodekit certify [--repo-root <path>] [--json]

P0 owns repository contracts and drift prevention. create/add/upgrade/migrate/release
remain planned commands and are not reported as implemented.`);
}

function summarize(result) {
  const name = result.manifest?.repository ?? path.basename(result.repoRoot);
  return {
    checks: result.checks,
    contractFindings: result.contractFindings,
    errors: result.errors,
    passed: result.passed,
    repository: name,
    sourceFindings: result.sourceFindings,
  };
}

function printResult(result, json) {
  const summary = summarize(result);
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`${summary.passed ? "PASS" : "FAIL"} ${summary.repository}`);
  for (const check of summary.checks) {
    console.log(`  ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
  }
  for (const error of summary.errors) console.error(`  ERROR ${error}`);
}

async function registryFrom(options) {
  const root = path.resolve(String(options["registry-root"] ?? packageRoot));
  return loadRegistry(root);
}

async function checkOne(options) {
  const registry = await registryFrom(options);
  const repoRoot = path.resolve(String(options["repo-root"] ?? process.cwd()));
  return checkRepository(repoRoot, registry);
}

async function runShell(command, cwd, args) {
  const suffix = args.length > 0 ? ` -- ${args.map(quoteArgument).join(" ")}` : "";
  await new Promise((resolve, reject) => {
    const child = spawn(`${command}${suffix}`, {
      cwd,
      env: process.env,
      shell: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function runLifecycle(name, parsed) {
  const result = await checkOne(parsed.options);
  if (!result.passed) {
    printResult(result, parsed.options.json);
    process.exitCode = 1;
    return;
  }
  const command = commandFor(result.manifest, name);
  if (!command) throw new Error(`${name} is not declared in nodekit.yaml`);
  await runShell(command, result.repoRoot, parsed.commandArgs);
}

async function runRegistryCheck(parsed) {
  const registry = await registryFrom(parsed.options);
  const errors = validateRegistry(registry);
  const output = { errors, passed: errors.length === 0, schemaVersion: "nodeplatform.registry-check/v1" };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${output.passed ? "PASS" : "FAIL"} Node Platform registry`);
    for (const error of errors) console.error(`  ERROR ${error}`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function collectEcosystem(parsed) {
  const registry = await registryFrom(parsed.options);
  const workspace = path.resolve(String(parsed.options.workspace ?? path.dirname(registry.root)));
  const results = [];

  for (const repository of registry.repositoryCatalog.repositories) {
    if (repository.commandProfile === "untracked") continue;
    const repoRoot = repository.name === "node-platform"
      ? registry.root
      : path.join(workspace, repository.name);
    if (!(await pathExists(repoRoot))) {
      results.push({
        checks: [],
        contractFindings: [],
        errors: [`repository checkout is missing at ${repoRoot}`],
        manifest: null,
        name: repository.name,
        passed: false,
        repoRoot,
        sourceFindings: [],
      });
      continue;
    }
    results.push(await checkRepository(repoRoot, registry));
  }
  return { registry, results };
}

async function runEcosystemCheck(parsed) {
  const { results } = await collectEcosystem(parsed);
  const output = {
    passed: results.every((result) => result.passed),
    repositories: results.map(summarize),
    schemaVersion: "nodeplatform.ecosystem-check/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    for (const result of results) printResult(result, false);
    console.log(`${output.passed ? "PASS" : "FAIL"} ecosystem conformance`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function runDashboard(parsed) {
  const { registry, results } = await collectEcosystem(parsed);
  const markdown = renderDashboard(results, registry);
  if (!parsed.options.write) {
    console.log(markdown);
    return;
  }
  const output = path.resolve(
    String(parsed.options.out ?? path.join(registry.root, "docs", "ECOSYSTEM_STATUS.md")),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, markdown, "utf8");
  console.log(`WROTE ${output}`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

async function runDoctor(parsed) {
  const result = await checkOne(parsed.options);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  result.checks.unshift({
    detail: process.versions.node,
    id: "node-version",
    passed: nodeMajor >= 20,
  });
  if (nodeMajor < 20) result.errors.unshift("Node.js 20 or newer is required");
  result.passed = result.errors.length === 0;
  printResult(result, parsed.options.json);
  if (!result.passed) process.exitCode = 1;
}

async function runCertify(parsed) {
  const result = await checkOne(parsed.options);
  const criteria = {
    architectureConformance: result.sourceFindings.every((finding) => finding.excepted),
    canonicalOwnership: (result.manifest?.canonicalFor ?? []).every((concept) =>
      Boolean(concept),
    ),
    commonCommands: result.checks
      .filter((check) => check.id.startsWith("command:"))
      .every((check) => check.passed),
    duplicateContractFreeze: result.contractFindings.every((finding) => finding.declared),
    environmentContract: result.manifest?.environment?.contractVersion === "nodeplatform.env/v1",
    lifecycle: Boolean(result.manifest?.lifecycle),
    noKey: ["certified", "not-applicable"].includes(result.manifest?.noKey?.status),
    proofReceipt: Boolean(result.manifest?.proof?.receiptSchema),
  };
  const met = Object.values(criteria).filter(Boolean).length;
  const output = {
    criteria,
    errors: result.errors,
    level: "p0-contract",
    passed: result.passed && met === Object.keys(criteria).length,
    repository: result.manifest?.repository ?? path.basename(result.repoRoot),
    score: `${met}/${Object.keys(criteria).length}`,
    schemaVersion: "nodeplatform.certification/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`P0 ${output.passed ? "PASS" : "BLOCKED"} ${output.repository} ${output.score}`);
    for (const [criterion, passed] of Object.entries(criteria)) {
      console.log(`  ${passed ? "PASS" : "BLOCKED"} ${criterion}`);
    }
    for (const error of output.errors) console.error(`  ERROR ${error}`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [first, second] = parsed.positional;
  if (!first || first === "help" || first === "--help") {
    printHelp();
    return;
  }
  if (["dev", "demo", "check", "proof"].includes(first)) {
    await runLifecycle(first, parsed);
    return;
  }
  if (first === "doctor") {
    await runDoctor(parsed);
    return;
  }
  if (first === "certify") {
    await runCertify(parsed);
    return;
  }
  if (first === "repo" && second === "check") {
    const result = await checkOne(parsed.options);
    printResult(result, parsed.options.json);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (first === "registry" && second === "check") {
    await runRegistryCheck(parsed);
    return;
  }
  if (first === "ecosystem" && second === "check") {
    await runEcosystemCheck(parsed);
    return;
  }
  if (first === "dashboard") {
    await runDashboard(parsed);
    return;
  }
  throw new Error(`unknown command: ${parsed.positional.join(" ")}`);
}

main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = 1;
});
