#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "./lib/dashboard.mjs";
import { compileAgentDefinition, inspectAgentDefinition } from "./lib/agent-definition.mjs";
import { pathExists } from "./lib/files.mjs";
import { checkRepository, commandFor } from "./lib/repo-check.mjs";
import { loadRegistry, validateRegistry } from "./lib/registry.mjs";
import { adoptProject, createProject, createReferenceProject, recordSetupEvent } from "./lib/scaffold.mjs";
import {
  importUnderstandAnythingCodeGraph,
  queryUnderstandAnythingCodeGraph,
  readUnderstandAnythingCodeGraph,
} from "./lib/understand-anything.mjs";

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
  console.log(`NodeKit

Usage:
  nodekit create <directory> --name <slug> --brief <text>
      [--provider openrouter] [--model openai/gpt-4o-mini] [--backend filesystem]
      [--nodekit-specifier <npm-or-file-spec>] [--sponsors <comma-list>]
      [--package-manager npm|pnpm]
      [--launch-started-at <iso>] [--research-ms <number>] [--local-proof]
      [--no-install] [--no-git]
  nodekit adopt [directory] --name <slug> --brief <text>
  nodekit reference create <reference> <directory> --name <slug> --brief <text>
  nodekit compile [--repo-root <path>] [--check] [--json]
  nodekit inspect [--repo-root <path>] [--json]
  nodekit doctor [--repo-root <path>] [--json]
  nodekit dev|demo|check|proof [--repo-root <path>] [-- <args>]
  nodekit repo check [--repo-root <path>] [--json]
  nodekit registry check [--registry-root <path>] [--json]
  nodekit ecosystem check [--workspace <path>] [--json]
  nodekit dashboard [--workspace <path>] [--write] [--out <path>]
  nodekit graph import [--repo-root <path>] [--graph-dir <path>] [--repo-id <id>] [--commit <sha>] [--json]
  nodekit graph query <terms> [--repo-root <path>] [--limit <number>] [--json]
  nodekit certify [--repo-root <path>] [--json]`);
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
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  if (await pathExists(path.join(repoRoot, "nodeagent.yaml"))) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    const compiled = await compileAgentDefinition(repoRoot, { write: false });
    if (compiled.definition.provider.package === "@earendil-works/pi-ai" && (major < 22 || (major === 22 && minor < 19))) {
      result.errors.unshift("@earendil-works/pi-ai requires Node.js 22.19 or newer");
    }
  }
  result.passed = result.errors.length === 0;
  printResult(result, parsed.options.json);
  if (!result.passed) process.exitCode = 1;
}

function optionEnabled(options, name, defaultValue = true) {
  if (options[`no-${name}`]) return false;
  if (options[name] === false || options[name] === "false") return false;
  return defaultValue;
}

async function runCreate(parsed) {
  const target = parsed.positional[1];
  if (!target) throw new Error("create requires a target directory");
  const localProof = parsed.options["local-proof"] === true || parsed.options["local-proof"] === "true";
  if (localProof && !optionEnabled(parsed.options, "git")) {
    throw new Error("--local-proof requires the default local Git candidate; omit --no-git so NodeKit can bind receipts to an immutable commit");
  }
  const nodekitSpecifier = parsed.options["nodekit-specifier"] ?? parsed.options["nodekit-source"];
  const result = await createProject({
    backend: parsed.options.backend,
    brief: parsed.options.brief,
    git: optionEnabled(parsed.options, "git"),
    install: optionEnabled(parsed.options, "install"),
    launchStartedAt: parsed.options["launch-started-at"],
    model: parsed.options.model,
    name: parsed.options.name ?? path.basename(path.resolve(target)),
    nodekitSpecifier,
    packageManager: parsed.options["package-manager"],
    provider: parsed.options.provider,
    researchMs: parsed.options["research-ms"] === undefined ? undefined : Number(parsed.options["research-ms"]),
    secretRef: parsed.options["secret-ref"],
    sponsors: String(parsed.options.sponsors ?? "").split(",").filter(Boolean),
    target,
  });
  const compileStarted = Date.now();
  const compiled = await compileAgentDefinition(result.target);
  await recordSetupEvent(result.target, "compile_completed", { configHash: compiled.definition.configHash }, Date.now() - compileStarted);
  if (localProof) {
    const scripts = ["demo.mjs", "eval.mjs", "proof.mjs"];
    for (const script of scripts) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(result.target, "scripts", script)], {
          cwd: result.target,
          env: process.env,
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${script} exited ${code}`));
        });
      });
    }
  }
  console.log(`CREATED ${result.name} at ${result.target}${result.candidateCommit ? ` (${result.candidateCommit.slice(0, 12)})` : ""}`);
  console.log(`NEXT cd ${quoteArgument(result.target)} && ${result.packageManager} run compile && ${result.packageManager} run demo`);
}

async function runReferenceCreate(parsed) {
  const reference = parsed.positional[2];
  const target = parsed.positional[3];
  if (!reference || !target) throw new Error("reference create requires a reference name and target directory");
  const result = await createReferenceProject({
    brief: parsed.options.brief,
    git: optionEnabled(parsed.options, "git"),
    install: optionEnabled(parsed.options, "install"),
    name: parsed.options.name ?? path.basename(path.resolve(target)),
    nodekitSpecifier: parsed.options["nodekit-specifier"] ?? parsed.options["nodekit-source"],
    packageManager: parsed.options["package-manager"],
    reference,
    target,
  });
  await compileAgentDefinition(result.target);
  console.log(`CREATED REFERENCE ${reference} at ${result.target}`);
  console.log("This is an explicitly labeled example, not NodeKit's primary application foundation.");
}

async function runAdopt(parsed) {
  const target = path.resolve(String(parsed.positional[1] ?? parsed.options["repo-root"] ?? process.cwd()));
  const result = await adoptProject({
    backend: parsed.options.backend,
    brief: parsed.options.brief,
    model: parsed.options.model,
    name: parsed.options.name ?? path.basename(target),
    nodekitSpecifier: parsed.options["nodekit-specifier"] ?? parsed.options["nodekit-source"],
    provider: parsed.options.provider,
    secretRef: parsed.options["secret-ref"],
    target,
  });
  console.log(`ADOPTED ${result.name} at ${result.target}`);
  console.log("NodeKit only added missing harness files; existing auth, routes, CSS, and schemas were preserved.");
  console.log(`COLLISIONS ${result.collisions.length}; inspect proof/adoption-receipt.json before installation.`);
}

async function runCompile(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const result = await compileAgentDefinition(repoRoot, {
    check: Boolean(parsed.options.check),
    write: !parsed.options.check,
  });
  const output = {
    application: result.definition.application.id,
    applicationHash: result.definition.applicationHash,
    configHash: result.definition.configHash,
    contracts: result.definition.contracts,
    fileCount: result.definition.fileCount,
    passed: true,
    schemaVersion: "nodekit.compile/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`${parsed.options.check ? "CURRENT" : "COMPILED"} ${output.application} ${output.configHash.slice(0, 12)} (${output.fileCount} authored files)`);
}

async function runInspect(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const output = inspectAgentDefinition(await compileAgentDefinition(repoRoot, { write: false }));
  if (parsed.options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`${output.application.name} (${output.application.id})`);
  console.log(`  runtime ${output.runtime.engine}/${output.runtime.profile}`);
  console.log(`  provider ${output.provider.adapter}:${output.provider.model.provider}/${output.provider.model.id}`);
  console.log(`  backend ${output.backend.adapter}`);
  console.log(`  contracts event=${output.contracts.event} trace=${output.contracts.trace}`);
  console.log(`  config ${output.configHash}`);
  console.log(`  application ${output.applicationHash}`);
  console.log(`  files ${output.fileCount}`);
  for (const [name, count] of Object.entries(output.discovered)) console.log(`  ${name} ${count}`);
  for (const secret of output.secrets) console.log(`  secret ${secret.name}: ${secret.configured ? "configured" : "missing"}`);
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

async function runGraphImport(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const snapshot = await importUnderstandAnythingCodeGraph(repoRoot, {
    commitSha: parsed.options.commit,
    graphDir: parsed.options["graph-dir"],
    repoId: parsed.options["repo-id"],
  });
  const output = {
    commitSha: snapshot.commitSha,
    contentHash: snapshot.contentHash,
    layers: snapshot.layers.length,
    nodes: snapshot.nodes.length,
    passed: true,
    repoId: snapshot.repoId,
    schemaVersion: "nodekit.graph-import/v1",
    source: snapshot.source,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`IMPORTED ${output.repoId}@${output.commitSha} ${output.nodes} nodes ${output.layers} layers`);
}

async function runGraphQuery(parsed) {
  const query = parsed.positional.slice(2).join(" ");
  if (!query) throw new Error("graph query requires search terms");
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const snapshot = await readUnderstandAnythingCodeGraph(repoRoot, {
    snapshotPath: parsed.options["snapshot-path"],
  });
  const output = queryUnderstandAnythingCodeGraph(snapshot, query, {
    limit: parsed.options.limit,
  });
  if (parsed.options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`CODE GRAPH ${output.source.repoId}@${output.source.commitSha}`);
  for (const { node, score } of output.matched) console.log(`  ${score} ${node.name} (${node.type})`);
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
  if (first === "create") {
    await runCreate(parsed);
    return;
  }
  if (first === "reference" && second === "create") {
    await runReferenceCreate(parsed);
    return;
  }
  if (first === "adopt") {
    await runAdopt(parsed);
    return;
  }
  if (first === "compile") {
    await runCompile(parsed);
    return;
  }
  if (first === "inspect") {
    await runInspect(parsed);
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
  if (first === "graph" && second === "import") {
    await runGraphImport(parsed);
    return;
  }
  if (first === "graph" && second === "query") {
    await runGraphQuery(parsed);
    return;
  }
  throw new Error(`unknown command: ${parsed.positional.join(" ")}`);
}

main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = 1;
});
