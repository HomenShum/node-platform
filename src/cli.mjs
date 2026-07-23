#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "./lib/dashboard.mjs";
import { compileAgentDefinition, inspectAgentDefinition } from "./lib/agent-definition.mjs";
import { pathExists } from "./lib/files.mjs";
import { checkRepository, commandFor } from "./lib/repo-check.mjs";
import { loadRegistry, validateRegistry } from "./lib/registry.mjs";
import { adoptProject, createProject, recordSetupEvent } from "./lib/scaffold.mjs";
import {
  compileModelIntelligence,
  diagnoseModelFailures,
  initializeHarness,
  writeModelBaseline,
} from "./lib/model-intelligence.mjs";
import {
  benchmarkSkillCandidate,
  compileRoutingPolicy,
  evaluateTournament,
  harnessStatus,
  promoteSkillCandidate,
  proposeSkillCandidates,
  rejectSkillCandidate,
  reviewSkillCandidate,
  rollbackHarness,
  verifyCanary,
} from "./lib/harness-gym.mjs";
import {
  builderGymStatus,
  createBuilderGymLock,
  evaluateBuilderGym,
  initializeBuilderGym,
  inspectBuilderGymVerdict,
  inspectNodeTraceTrajectory,
  recordNodeTraceTrajectory,
} from "./lib/builder-gym.mjs";
import {
  importUnderstandAnythingCodeGraph,
  queryUnderstandAnythingCodeGraph,
  readUnderstandAnythingCodeGraph,
} from "./lib/understand-anything.mjs";
import {
  applyGraphPatch,
  benchmarkKnowledgeRetrieval,
  decideGraphPatch,
  diffKnowledgeGraph,
  initializeKnowledgeGraph,
  inspectKnowledgeGaps,
  proposeGraphPatch,
  queryKnowledgeGraph,
  readKnowledgeGraph,
  recordKnowledgeAction,
  replayKnowledgeGraph,
  validateGraphPatch,
} from "./lib/knowledge-evolution.mjs";
import {
  evidenceSnapshotToGraphNode,
  ingestEvidenceFile,
  verifyEvidenceSnapshot,
} from "./lib/evidence-snapshots.mjs";
import {
  collectExternalResearch,
  createLocalFixtureResearchProvider,
  readLocalResearchFixture,
} from "./lib/research-collector.mjs";
import { proposeHarnessKnowledgePatch } from "./lib/harness-knowledge.mjs";
import {
  compileFrontendPlan,
  createFrontendDirections,
  createFrontendRepairPlan,
  evaluateFrontendTournament,
  initializeFrontendHarness,
  verifyFrontendCanary,
} from "./lib/frontend-specialist.mjs";
import {
  addAtlasAsset,
  addAtlasFlow,
  initializeAtlasStore,
  inspectAtlasRecord,
  listAtlasRecords,
} from "./lib/atlas.mjs";
import {
  atlasDelta,
  atlasPreview,
  atlasRecipe,
  atlasSearch,
} from "./lib/atlas-retrieval.mjs";
import { serveAtlasMcp } from "./lib/atlas-mcp.mjs";
import {
  buildEvolutionDocs,
  checkEvolutionMateriality,
  diffEvolutionLedger,
  draftEvolutionEvent,
  initializeEvolutionLedger,
  proposeEvolutionKnowledgePatch,
  queryEvolutionLedger,
  recordEvolutionRecord,
  verifyEvolutionLedger,
} from "./lib/evolution-ledger.mjs";

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
  nodekit compile [--repo-root <path>] [--check] [--json]
  nodekit inspect [--repo-root <path>] [--json]
  nodekit doctor [--repo-root <path>] [--json]
  nodekit dev|demo|check|proof [--repo-root <path>] [-- <args>]
  nodekit repo check [--repo-root <path>] [--json]
  nodekit registry check [--registry-root <path>] [--json]
  nodekit ecosystem check [--workspace <path>] [--json]
  nodekit dashboard [--workspace <path>] [--write] [--out <path>]
  nodekit graph import [--repo-root <path>] [--graph-dir <path>] [--repo-id <id>] [--commit <sha>] [--json]
  nodekit graph init [--repo-root <path>] [--graph-id <id>] [--owner-id <id>] [--json]
  nodekit graph ingest --input <file> [--repo-root <path>] [--json]
  nodekit graph evidence-ingest --file <path> --source-uri <uri> --media-type <type>
      [--label <text>] [--captured-at <iso>] [--expected-sha256 <hash>] [--locators <json-file>]
      [--expires-at <iso>] [--max-bytes <number>] [--max-locators <number>] [--repo-root <path>] [--json]
  nodekit graph evidence-verify --snapshot <id> [--at <iso>] [--repo-root <path>] [--json]
  nodekit graph inspect [--repo-root <path>] [--json]
  nodekit graph query <terms> [--repo-root <path>] [--limit <number>] [--code] [--json]
  nodekit graph gaps [--repo-root <path>] [--json]
  nodekit graph research <terms> --provider-fixture <json-file>
      [--max-searches <number>] [--max-results <number>] [--max-fetches <number>]
      [--max-bytes-per-fetch <number>] [--max-total-bytes <number>] [--max-duration-ms <number>]
      [--repo-root <path>] [--run-id <id>] [--json]
  nodekit graph propose --patch <file> [--repo-root <path>] [--json]
  nodekit graph validate --patch <id> [--repo-root <path>] [--json]
  nodekit graph apply --patch <id> --approved-by <principal> [--reason <text>] [--repo-root <path>] [--json]
  nodekit graph diff --from <version> [--to <version>] [--repo-root <path>] [--json]
  nodekit graph replay --version <number> [--out <file>] [--repo-root <path>] [--json]
  nodekit graph benchmark --cases <file> [--repo-root <path>] [--json]
  nodekit graph harness-sync [--repo-root <path>] [--json]
  nodekit frontend init [--repo-root <path>] [--json]
  nodekit frontend plan --contract <file> [--route <file>] [--repo-root <path>] [--json]
  nodekit frontend directions --plan <file> [--repo-root <path>] [--json]
  nodekit frontend benchmark --manifest <file> [--repo-root <path>] [--json]
  nodekit frontend repair --benchmark <file> [--repo-root <path>] [--json]
  nodekit frontend canary --receipt <file> [--repo-root <path>] [--json]
  nodekit atlas init [--repo-root <path>] [--json]
  nodekit atlas add --asset <yaml-file> --observation <path>
      [--vendor <path>] [--notice <path>] [--derived-from <sha256>] [--repo-root <path>] [--json]
  nodekit atlas add --flow <yaml-file> [--repo-root <path>] [--json]
  nodekit atlas list [--repo-root <path>] [--json]
  nodekit atlas inspect --id <assetId-or-flowId> [--repo-root <path>] [--json]
  nodekit atlas search <terms...> [--target asset|flow|both] [--kind <list>] [--framework <id>]
      [--language <list>] [--mobile <mode>] [--accessibility A|AA|AAA] [--maturity <floor>]
      [--license-allowlist <spdx-list>] [--no-new-deps] [--limit <1-50>] [--repo-root <path>] [--json]
  nodekit atlas preview --ids <comma-list-max-4> [--repo-root <path>] [--json]
  nodekit atlas recipe --id <assetId> [--flow <flowId>] [--allow-unvetted] [--repo-root <path>] [--json]
  nodekit atlas repair --recipe <file> [--repo-root <path>] [--json]
  nodekit atlas serve --mcp [--repo-root <path>]
  nodekit evolution init [--repo-root <path>] [--json]
  nodekit evolution draft --id <id> --track <track> --category <category> --challenge <text> --resolution <text> --reviewed-by <id>
  nodekit evolution record --file <file> [--repo-root <path>] [--json]
  nodekit evolution verify [--repo-root <path>] [--json]
  nodekit evolution query [--track <track>] [--since <iso>] [--invariant <id>] [--repo-root <path>] [--json]
  nodekit evolution diff --from <commit> --to <commit> [--repo-root <path>] [--json]
  nodekit evolution materiality --from <commit> --to <commit> [--repo-root <path>] [--json]
  nodekit evolution build-docs [--repo-root <path>] [--json]
  nodekit evolution sync-graph [--graph-path <path>] [--repo-root <path>] [--json]
  nodekit harness init [--repo-root <path>] [--json]
  nodekit harness builder init [--repo-root <path>] [--json]
  nodekit harness builder lock --baseline <trajectory> [--repo-root <path>] [--json]
  nodekit harness builder evaluate --lock <lock> --expected-lock-hash <sha256> --baseline <trajectory> --candidate <trajectory> [--repo-root <path>] [--json]
  nodekit harness builder inspect --ref <hash-or-path> [--repo-root <path>] [--json]
  nodekit harness builder status [--repo-root <path>] [--json]
  nodekit harness trajectory record --file <trajectory> [--repo-root <path>] [--json]
  nodekit harness trajectory inspect --ref <hash-or-path> [--repo-root <path>] [--json]
  nodekit models baseline [--repo-root <path>] [--json]
  nodekit models profile [--repo-root <path>] [--json]
  nodekit models inspect [--repo-root <path>] [--json]
  nodekit models diagnose [--repo-root <path>] [--json]
  nodekit skills propose [--repo-root <path>] [--json]
  nodekit skills review --candidate <id> [--repo-root <path>] [--json]
  nodekit skills benchmark --candidate <id> --comparison <file> [--repo-root <path>] [--json]
  nodekit skills promote --candidate <id> --canary <file> --proof-receipt <file> --approval <signed-file>
  nodekit skills reject --candidate <id> --reason <text>
  nodekit routing compile [--repo-root <path>] [--json]
  nodekit routing canary --receipt <file> [--repo-root <path>] [--json]
  nodekit harness tournament --manifest <file> [--repo-root <path>] [--json]
  nodekit harness baseline|inspect|diagnose|propose|benchmark|canary|review|promote
  nodekit harness status [--repo-root <path>] [--json]
  nodekit harness gate [--repo-root <path>] [--json]
  nodekit harness rollback [--repo-root <path>] [--json]
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
  if (!parsed.options.code) {
    try {
      const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
      const output = queryKnowledgeGraph(graph, query, { limit: parsed.options.limit });
      if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`KNOWLEDGE GRAPH ${output.graphId}@v${output.graphVersion}`);
        for (const { entity, score } of output.results) console.log(`  ${score} ${entity.label ?? entity.predicate} (${entity.kind ?? "hyperedge"}:${entity.layer})`);
      }
      await recordKnowledgeAction(repoRoot, {
        type: "GRAPH_RETRIEVE",
        runId: parsed.options["run-id"] ?? "run:nodekit-cli-query",
        caseId: parsed.options["case-id"] ?? "case:nodekit-cli-query",
        actorId: parsed.options["actor-id"] ?? "nodekit-cli",
        input: { query, limit: parsed.options.limit ?? 12 },
        outputRefs: output.results.map((entry) => entry.entity.id),
      }, { graphPath: parsed.options["graph-path"] });
      return;
    } catch (error) {
      if (!String(error.message).includes("knowledge graph is missing")) throw error;
    }
  }
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

async function readJsonInput(repoRoot, candidate, label) {
  if (!candidate) throw new Error(`${label} file is required`);
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, String(candidate));
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} file must stay inside the repository`);
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} file is invalid JSON: ${relative}: ${error.message}`);
  }
}

async function runGraphInit(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const graph = await initializeKnowledgeGraph(repoRoot, {
    graphId: parsed.options["graph-id"],
    graphPath: parsed.options["graph-path"],
    ownerId: parsed.options["owner-id"],
  });
  const output = { passed: true, graphId: graph.graphId, graphVersion: graph.version, ownerId: graph.authority.ownerId, contentHash: graph.contentHash };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`INITIALIZED ${graph.graphId}@v${graph.version} ${graph.contentHash}`);
}

async function runGraphInspect(parsed) {
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = {
    schemaVersion: "nodekit.knowledge-inspection/v1",
    graphId: graph.graphId,
    graphVersion: graph.version,
    contentHash: graph.contentHash,
    nodes: graph.nodes.length,
    hyperedges: graph.hyperedges.length,
    layers: Object.fromEntries(graph.layers.map((layer) => [layer.id, graph.nodes.filter((node) => node.layer === layer.id).length + graph.hyperedges.filter((edge) => edge.layer === layer.id).length])),
    patches: Object.fromEntries(["pending", "accepted", "rejected", "conflicted", "applied"].map((status) => [status, graph.proposals.filter((patch) => patch.status === status).length])),
    actionReceipts: graph.actionReceipts.length,
    evolutionReceipts: graph.evolutionReceipts.length,
    authority: graph.authority,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`KNOWLEDGE ${output.graphId}@v${output.graphVersion} ${output.nodes} nodes ${output.hyperedges} hyperedges ${output.patches.pending} pending patches`);
}

function proposalActor(parsed) {
  return {
    agentId: String(parsed.options["agent-id"] ?? "nodekit-cli"),
    modelRoute: String(parsed.options["model-route"] ?? "deterministic"),
    resolvedModel: String(parsed.options["resolved-model"] ?? "none"),
    harnessVersion: String(parsed.options["harness-version"] ?? "h0"),
  };
}

async function runGraphIngest(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const input = await readJsonInput(repoRoot, parsed.options.input, "graph ingest input");
  const patch = await proposeGraphPatch(repoRoot, {
    operations: [
      ...(input.nodes ?? []).map((node) => ({ type: "INSERT", node })),
      ...(input.hyperedges ?? []).map((hyperedge) => ({ type: "INSERT", hyperedge })),
    ],
    evidenceRefs: input.evidenceRefs ?? [],
    contradictionRefs: input.contradictionRefs ?? [],
    proposedBy: input.proposedBy ?? proposalActor(parsed),
    confidence: input.confidence ?? 1,
  }, { graphPath: parsed.options["graph-path"] });
  const output = {
    passed: true,
    proposalOnly: true,
    byteAuthenticated: false,
    warning: "Preconstructed graph input is not a byte-authenticated evidence capture; use graph evidence-ingest for source evidence.",
    patch,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`PROPOSED PRECONSTRUCTED GRAPH INPUT ${patch.patchId} (${patch.operations.length} operations); canonical graph unchanged; source bytes not authenticated`);
}

async function runGraphEvidenceIngest(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const sourceFile = parsed.options.file;
  const sourceUri = parsed.options["source-uri"];
  const mediaType = parsed.options["media-type"];
  if (!sourceFile || !sourceUri || !mediaType) {
    throw new Error("graph evidence-ingest requires --file, --source-uri, and --media-type");
  }
  let locators = [];
  if (parsed.options.locators) {
    const locatorInput = await readJsonInput(repoRoot, parsed.options.locators, "evidence locators");
    locators = Array.isArray(locatorInput) ? locatorInput : locatorInput.locators;
    if (!Array.isArray(locators)) throw new Error("evidence locators file must be an array or contain a locators array");
  }
  const { snapshot, sourcePath } = await ingestEvidenceFile(repoRoot, {
    file: sourceFile,
    sourceUri,
    mediaType,
    capturedAt: parsed.options["captured-at"],
    expectedSha256: parsed.options["expected-sha256"],
    expiresAt: parsed.options["expires-at"],
    locators,
  }, {
    limits: {
      maximumBytes: parsed.options["max-bytes"],
      maximumLocators: parsed.options["max-locators"],
    },
  });
  const verification = await verifyEvidenceSnapshot(repoRoot, snapshot.snapshotId);
  if (!verification.passed) throw new Error(`evidence snapshot failed immediate verification: ${snapshot.snapshotId}`);
  const node = evidenceSnapshotToGraphNode(snapshot, {
    label: parsed.options.label ?? path.basename(String(sourceFile)),
    confidence: parsed.options.confidence ?? 1,
    properties: { ingestSourcePath: sourcePath, ingestActor: proposalActor(parsed).agentId },
  });
  const patch = await proposeGraphPatch(repoRoot, {
    operations: [{ type: "INSERT", node }],
    evidenceRefs: [],
    contradictionRefs: [],
    proposedBy: proposalActor(parsed),
    confidence: Number(parsed.options.confidence ?? 1),
  }, { graphPath: parsed.options["graph-path"] });
  const output = { passed: true, proposalOnly: true, sourcePath, snapshot, verification, patch };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`SNAPSHOTTED ${snapshot.snapshotId} ${snapshot.raw.sha256}; proposed ${patch.patchId}; canonical graph unchanged`);
}

async function runGraphEvidenceVerify(parsed) {
  const snapshotId = parsed.options.snapshot;
  if (!snapshotId) throw new Error("graph evidence-verify requires --snapshot <id>");
  const output = await verifyEvidenceSnapshot(repoRootFrom(parsed), String(snapshotId), { at: parsed.options.at });
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`EVIDENCE ${output.passed ? "VERIFIED" : "BLOCKED"} ${output.snapshotId} hash=${output.hashMatches} fresh=${output.fresh}`);
  if (!output.passed) process.exitCode = 1;
}

async function runGraphPropose(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const input = await readJsonInput(repoRoot, parsed.options.patch, "graph patch");
  const patch = await proposeGraphPatch(repoRoot, {
    ...input,
    proposedBy: input.proposedBy ?? proposalActor(parsed),
  }, { graphPath: parsed.options["graph-path"] });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, patch }, null, 2));
  else console.log(`PROPOSED ${patch.patchId}@v${patch.baseVersion}; validate then apply with explicit approval`);
}

async function runGraphValidate(parsed) {
  const patchId = parsed.options.patch;
  if (!patchId) throw new Error("graph validate requires --patch <id>");
  const patch = await validateGraphPatch(repoRootFrom(parsed), String(patchId), { graphPath: parsed.options["graph-path"] });
  const passed = patch.validation.errors.length === 0 && Object.entries(patch.validation).filter(([key]) => key !== "errors").every(([, value]) => value);
  if (parsed.options.json) console.log(JSON.stringify({ passed, patch }, null, 2));
  else {
    console.log(`GRAPH PATCH ${passed ? "VALID" : "BLOCKED"} ${patch.patchId}`);
    for (const error of patch.validation.errors) console.log(`  ${error}`);
  }
  if (!passed) process.exitCode = 1;
}

async function runGraphApply(parsed) {
  const patchId = parsed.options.patch;
  const principalId = parsed.options["approved-by"];
  if (!patchId || !principalId) throw new Error("graph apply requires --patch <id> and --approved-by <principal>");
  const repoRoot = repoRootFrom(parsed);
  let graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  let patch = graph.proposals.find((entry) => entry.patchId === patchId);
  if (!patch) throw new Error(`graph patch not found: ${patchId}`);
  if (patch.status === "pending" || patch.status === "conflicted") {
    patch = await validateGraphPatch(repoRoot, String(patchId), { graphPath: parsed.options["graph-path"] });
    if (patch.status !== "pending") throw new Error(`graph patch is ${patch.status}; create a rebased proposal`);
    patch = await decideGraphPatch(repoRoot, String(patchId), {
      decision: "accept",
      principalId: String(principalId),
      reason: parsed.options.reason,
      graphPath: parsed.options["graph-path"],
    });
  }
  const output = await applyGraphPatch(repoRoot, String(patchId), { graphPath: parsed.options["graph-path"] });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, ...output }, null, 2));
  else console.log(`APPLIED ${patchId} v${output.receipt.fromVersion}->v${output.receipt.toVersion} ${output.receipt.receiptId}`);
}

async function runGraphGaps(parsed) {
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = inspectKnowledgeGaps(graph);
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GAPS unresolved=${output.unresolved.length} unsupported=${output.unsupported.length} stale=${output.staleEvidence.length} pending=${output.pendingPatches.length}`);
}

async function runGraphResearch(parsed) {
  const query = parsed.positional.slice(2).join(" ");
  if (!query) throw new Error("graph research requires a typed knowledge-gap query");
  const fixturePath = parsed.options["provider-fixture"];
  if (!fixturePath) throw new Error("graph research requires --provider-fixture <json-file>; live providers must be supplied through the provider-neutral library port");
  const repoRoot = repoRootFrom(parsed);
  const fixture = await readLocalResearchFixture(repoRoot, fixturePath);
  const provider = createLocalFixtureResearchProvider(repoRoot, fixture);
  const output = await collectExternalResearch(repoRoot, {
    provider,
    query,
    graphPath: parsed.options["graph-path"],
    runId: parsed.options["run-id"] ?? `research:${Date.now()}`,
    caseId: parsed.options["case-id"] ?? "case:knowledge-research",
    actorId: parsed.options["actor-id"] ?? "nodekit-cli",
    gapIds: String(parsed.options["gap-ids"] ?? "").split(",").filter(Boolean),
    proposedBy: proposalActor(parsed),
    limits: {
      maximumSearches: parsed.options["max-searches"],
      maximumResultsPerSearch: parsed.options["max-results"],
      maximumFetches: parsed.options["max-fetches"],
      maximumBytesPerFetch: parsed.options["max-bytes-per-fetch"],
      maximumTotalBytes: parsed.options["max-total-bytes"],
      maximumLocatorsPerDocument: parsed.options["max-locators"],
      maximumDurationMs: parsed.options["max-duration-ms"],
    },
  });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, ...output }, null, 2));
  else console.log(`COLLECTED ${output.collection.collectionId}; snapshotted ${output.collection.fetches.length} documents; proposed ${output.patch.patchId}; canonical graph unchanged`);
}

async function runGraphDiff(parsed) {
  if (parsed.options.from === undefined) throw new Error("graph diff requires --from <version>");
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = diffKnowledgeGraph(graph, parsed.options.from, parsed.options.to ?? graph.version);
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GRAPH DIFF v${output.fromVersion}->v${output.toVersion}: ${output.patchIds.length} patches ${output.operations.length} operations`);
}

async function runGraphReplay(parsed) {
  if (parsed.options.version === undefined) throw new Error("graph replay requires --version <number>");
  const repoRoot = repoRootFrom(parsed);
  const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  const output = replayKnowledgeGraph(graph, parsed.options.version);
  if (parsed.options.out) {
    const root = path.resolve(repoRoot);
    const destination = path.resolve(root, String(parsed.options.out));
    const relation = path.relative(root, destination);
    if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error("graph replay output must stay inside the repository");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`REPLAYED ${output.graphId}@v${output.version} ${output.nodes.length} nodes ${output.hyperedges.length} hyperedges`);
}

async function runGraphBenchmark(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const cases = await readJsonInput(repoRoot, parsed.options.cases, "graph benchmark cases");
  const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  const output = benchmarkKnowledgeRetrieval(graph, Array.isArray(cases) ? cases : cases.cases, { limit: parsed.options.limit });
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GRAPH BENCHMARK flat=${output.results.flat.averageRecall.toFixed(3)} static=${output.results.staticGraph.averageRecall.toFixed(3)} evolving=${output.results.evolvingGraph.averageRecall.toFixed(3)}`);
}

async function runGraphHarnessSync(parsed) {
  const output = await proposeHarnessKnowledgePatch(repoRootFrom(parsed), {
    graphPath: parsed.options["graph-path"],
    agentId: parsed.options["agent-id"],
  });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, proposalOnly: true, ...output }, null, 2));
  else if (output.unchanged) console.log(`HARNESS KNOWLEDGE UNCHANGED (${output.observationCount} observations)`);
  else console.log(`PROPOSED HARNESS KNOWLEDGE ${output.patch.patchId} (${output.patch.operations.length} operations); canonical graph unchanged`);
}

async function runFrontendInit(parsed) {
  const output = await initializeFrontendHarness(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED Frontend Gym at ${value.frontendRoot}; preferred route remains unprofiled`);
}

async function runFrontendPlan(parsed) {
  const output = await compileFrontendPlan(repoRootFrom(parsed), requireOption(parsed, "contract"), parsed.options.route);
  printStructured(output, parsed, (value) => `PLANNED ${value.plan.planId}; 3 directions required; route ${value.plan.routeStatus}; deployment unauthorized`);
}

async function runFrontendDirections(parsed) {
  const output = await createFrontendDirections(repoRootFrom(parsed), requireOption(parsed, "plan"));
  printStructured(output, parsed, (value) => `CREATED ${value.directionSet.directionSetId}: collaborative workspace, artifact studio, and domain-native hypotheses`);
}

async function runFrontendBenchmark(parsed) {
  const output = await evaluateFrontendTournament(repoRootFrom(parsed), requireOption(parsed, "manifest"));
  printStructured(output, parsed, (value) => `FRONTEND TOURNAMENT ${value.decisive ? "DECISIVE" : "BLOCKED"}: provisional ${value.decision.selectedCandidateId}; promotion unauthorized`);
  if (!output.decisive) process.exitCode = 1;
}

async function runFrontendRepair(parsed) {
  const output = await createFrontendRepairPlan(repoRootFrom(parsed), requireOption(parsed, "benchmark"));
  printStructured(output, parsed, (value) => `REPAIR ${value.repair.repairId}: maximum ${value.repair.maximumRounds} bounded rounds; prior implementation preserved`);
}

async function runFrontendCanary(parsed) {
  const output = await verifyFrontendCanary(repoRootFrom(parsed), requireOption(parsed, "receipt"));
  printStructured(output, parsed, (value) => `FRONTEND CANARY ${value.passed ? "PASS" : "BLOCKED"}`);
  if (!output.passed) process.exitCode = 1;
}

function optionList(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function printAtlasUsage() {
  console.log(`nodekit atlas <sub>

  nodekit atlas init [--repo-root <path>] [--json]
  nodekit atlas add --asset <yaml-file> --observation <path>
      [--vendor <path>] [--notice <path>] [--derived-from <sha256>] [--repo-root <path>] [--json]
  nodekit atlas add --flow <yaml-file> [--repo-root <path>] [--json]
  nodekit atlas list [--repo-root <path>] [--json]
  nodekit atlas inspect --id <assetId-or-flowId> [--repo-root <path>] [--json]
  nodekit atlas search <terms...> [--target asset|flow|both] [--framework <id>] [--mobile <mode>]
      [--accessibility A|AA|AAA] [--maturity <floor>] [--license-allowlist <spdx-list>] [--limit <1-50>] [--json]
  nodekit atlas preview --ids <comma-list-max-4> [--repo-root <path>] [--json]
  nodekit atlas recipe --id <assetId> [--flow <flowId>] [--allow-unvetted] [--repo-root <path>] [--json]
  nodekit atlas repair --recipe <file> [--repo-root <path>] [--json]
  nodekit atlas serve --mcp [--repo-root <path>]

Flags come last: nodekit atlas list --repo-root . --json`);
}

async function runAtlasInit(parsed) {
  const output = await initializeAtlasStore(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED atlas store at ${value.atlasRoot}; no assets registered`);
}

async function runAtlasAdd(parsed) {
  if (parsed.options.flow !== undefined && parsed.options.asset !== undefined) {
    throw new Error("atlas add takes either --asset or --flow, not both");
  }
  if (parsed.options.flow !== undefined) {
    const output = await addAtlasFlow(repoRootFrom(parsed), { flowFile: requireOption(parsed, "flow") });
    printStructured(output, parsed, (value) => `${value.duplicate ? "UNCHANGED" : "REGISTERED"} ${value.flow.flowId}; ${value.flow.card.stateCoverage} states covered; maturity ${value.flow.quality.maturity}; nothing promoted`);
    return;
  }
  const output = await addAtlasAsset(repoRootFrom(parsed), {
    assetFile: requireOption(parsed, "asset"),
    observationFile: requireOption(parsed, "observation"),
    vendorFile: parsed.options.vendor === true ? undefined : parsed.options.vendor,
    noticeFile: parsed.options.notice === true ? undefined : parsed.options.notice,
    derivedFromSha256: parsed.options["derived-from"] === true ? undefined : parsed.options["derived-from"],
  });
  printStructured(output, parsed, (value) => `${value.duplicate ? "UNCHANGED" : "REGISTERED"} ${value.asset.assetId} (reuseMode ${value.asset.source.reuseMode}, ${value.asset.source.license.identifier}); maturity ${value.asset.quality.maturity}; nothing promoted`);
}

async function runAtlasList(parsed) {
  const output = await listAtlasRecords(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `LISTED ${value.counts.assets} assets, ${value.counts.flows} flows; byte identity not re-verified`);
}

async function runAtlasInspect(parsed) {
  const output = await inspectAtlasRecord(repoRootFrom(parsed), requireOption(parsed, "id"));
  printStructured(output, parsed, (value) => `ATLAS ${value.passed ? "PASS" : "BLOCKED"} ${value.id}: ${value.issues.length} issues, ${value.snapshotChecks.length} snapshots re-verified; nothing promoted`);
  if (!output.passed) process.exitCode = 1;
}

async function runAtlasSearch(parsed) {
  const terms = parsed.positional.slice(2).join(" ").trim();
  if (!terms) throw new Error("atlas search requires search terms");
  const target = parsed.options.target === true ? undefined : parsed.options.target;
  const output = await atlasSearch(repoRootFrom(parsed), {
    terms,
    target,
    kind: optionList(parsed, "kind"),
    framework: parsed.options.framework === true ? undefined : parsed.options.framework,
    language: optionList(parsed, "language"),
    mobile: parsed.options.mobile === true ? undefined : parsed.options.mobile,
    accessibility: parsed.options.accessibility === true ? undefined : parsed.options.accessibility,
    maturityFloor: parsed.options.maturity === true ? undefined : parsed.options.maturity,
    licenseAllowlist: optionList(parsed, "license-allowlist"),
    noNewDeps: parsed.options["no-new-deps"] === true,
    limit: parsed.options.limit === true ? undefined : parsed.options.limit,
  });
  printStructured(output, parsed, (value) => {
    const excludedTotal = Object.values(value.excluded).reduce((sum, count) => sum + count, 0);
    return `FOUND ${value.assets.length} assets, ${value.flows.length} flows (${excludedTotal} excluded by constraints); decision ${value.decision.status}; no compatibility determination made; nothing selected, vendored, or promoted`;
  });
  if (output.decision.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasPreview(parsed) {
  const ids = optionList(parsed, "ids");
  const output = await atlasPreview(repoRootFrom(parsed), { ids });
  printStructured(output, parsed, (value) => `PREVIEWED ${value.candidates.filter((entry) => entry.preview).length} candidates; ${value.differences.length} differing fields; decision ${value.decision.status}; nothing installed`);
  if (output.decision.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasRecipe(parsed) {
  const output = await atlasRecipe(repoRootFrom(parsed), {
    id: requireOption(parsed, "id"),
    flowId: parsed.options.flow === true ? undefined : parsed.options.flow,
    allowUnvetted: parsed.options["allow-unvetted"] === true,
  });
  printStructured(output, parsed, (value) => {
    if (value.status) return `ATLAS ${value.status} ${value.reason}; nothing installed`;
    return `RECIPE ${value.recipeId} for ${value.assetId}; ${value.files.length} files, ${value.responseBytes} bytes; deployment not authorized`;
  });
  if (output.status === "REFUSED" || output.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasRepair(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const recipe = await readJsonInput(repoRoot, requireOption(parsed, "recipe"), "atlas recipe");
  const output = await atlasDelta(repoRoot, { recipe });
  printStructured(output, parsed, (value) => {
    if (value.status === "UNCHANGED") return `UNCHANGED ${value.recipeHash ?? "recipe"}; no repair needed`;
    if (value.status === "CHANGED") return `CHANGED ${value.changedPaths.length} paths, ${value.changedFiles.length} files; ${value.repairSteps.length} repair steps; nothing installed`;
    return `ATLAS ${value.status} ${value.reason ?? ""}; a fresh selection is required`.trim();
  });
  if (["SUPERSEDED", "GONE", "REFETCH_REQUIRED"].includes(output.status)) process.exitCode = 1;
}

async function runAtlasServe(parsed) {
  if (parsed.options.mcp !== true) throw new Error("atlas serve currently supports only --mcp");
  await serveAtlasMcp(repoRootFrom(parsed));
}

async function runEvolutionInit(parsed) {
  const output = await initializeEvolutionLedger(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED Evolution Ledger at ${value.evolutionRoot}`);
}

async function runEvolutionDraft(parsed) {
  const output = await draftEvolutionEvent(repoRootFrom(parsed), {
    id: requireOption(parsed, "id"),
    repository: parsed.options.repository,
    projectId: parsed.options["project-id"],
    commitSha: parsed.options.commit,
    pullRequest: parsed.options.pr,
    track: requireOption(parsed, "track"),
    category: requireOption(parsed, "category"),
    challenge: requireOption(parsed, "challenge"),
    observedFailure: parsed.options.failure,
    resolution: requireOption(parsed, "resolution"),
    reviewedBy: requireOption(parsed, "reviewed-by"),
    assumptionIds: optionList(parsed, "assumptions"),
    invariantIds: optionList(parsed, "invariants"),
    evidenceIds: optionList(parsed, "evidence"),
    knownLimitations: optionList(parsed, "limitations"),
  });
  printStructured(output, parsed, (value) => `DRAFTED ${value.event.id}; record remains separate from canonical history`);
}

async function runEvolutionRecord(parsed) {
  const output = await recordEvolutionRecord(repoRootFrom(parsed), requireOption(parsed, "file"));
  printStructured(output, parsed, (value) => `${value.duplicate ? "UNCHANGED" : "RECORDED"} ${value.record.id}`);
}

async function runEvolutionVerify(parsed) {
  const output = await verifyEvolutionLedger(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `EVOLUTION ${value.passed ? "PASS" : "BLOCKED"}: ${value.counts.events} events, ${value.counts.invariants} invariants, ${value.counts.adoptions} adoptions`);
  if (!output.passed) process.exitCode = 1;
}

async function runEvolutionQuery(parsed) {
  const output = await queryEvolutionLedger(repoRootFrom(parsed), { track: parsed.options.track, since: parsed.options.since, invariantId: parsed.options.invariant });
  printStructured(output, parsed, (value) => `EVOLUTION QUERY: ${value.events.length} events, ${value.invariants.length} invariants, ${value.evidence.length} evidence records`);
}

async function runEvolutionDiff(parsed) {
  const output = await diffEvolutionLedger(repoRootFrom(parsed), requireOption(parsed, "from"), requireOption(parsed, "to"));
  printStructured(output, parsed, (value) => `EVOLUTION DIFF ${value.from}..${value.to}: ${value.events.length} material events`);
}

async function runEvolutionMateriality(parsed) {
  const output = await checkEvolutionMateriality(repoRootFrom(parsed), requireOption(parsed, "from"), requireOption(parsed, "to"));
  printStructured(output, parsed, (value) => `EVOLUTION MATERIALITY ${value.passed ? "PASS" : "BLOCKED"}: ${value.materialFiles.length} material files, ${value.events.length} recorded events`);
  if (!output.passed) process.exitCode = 1;
}

async function runEvolutionBuildDocs(parsed) {
  const output = await buildEvolutionDocs(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `BUILT ${value.output} with ${value.adoptionMap.length} adoption records`);
}

async function runEvolutionSyncGraph(parsed) {
  const output = await proposeEvolutionKnowledgePatch(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  printStructured({ ...output, proposalOnly: true }, parsed, (value) => `PROPOSED EVOLUTION KNOWLEDGE ${value.patch.patchId}; approval is still required`);
}

function repoRootFrom(parsed) {
  return path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
}

async function runHarnessInit(parsed) {
  const root = repoRootFrom(parsed);
  const output = await initializeHarness(root);
  if (parsed.options.json) console.log(JSON.stringify({ ...output, passed: true }, null, 2));
  else {
    console.log(`INITIALIZED Harness Gym for ${output.applicationId}`);
    console.log(`  ${output.created.length} files created; existing files preserved`);
    console.log("  Frontend Gym initialized with an unprofiled evidence-ranked route and three-direction contract");
    console.log("  automatic promotion disabled; no model capability claims were created");
  }
}

async function runBuilderGymInit(parsed) {
  const output = await initializeBuilderGym(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `INITIALIZED Builder Gym for ${value.applicationId}; evaluator ${value.evaluatorHash.slice(0, 12)}; promotion disabled`);
}

async function runBuilderGymEvaluate(parsed) {
  const output = await evaluateBuilderGym(repoRootFrom(parsed), {
    baseline: requireOption(parsed, "baseline"),
    candidate: requireOption(parsed, "candidate"),
    lock: requireOption(parsed, "lock"),
    expectedLockHash: requireOption(parsed, "expected-lock-hash"),
  });
  printStructured(output, parsed, (value) => `BUILDER GYM ${value.passed ? "PASS" : "REGRESSION"}: ${value.outcome}; real-world claim and promotion not authorized`);
  if (!output.passed) process.exitCode = 1;
}

async function runBuilderGymLock(parsed) {
  const output = await createBuilderGymLock(repoRootFrom(parsed), requireOption(parsed, "baseline"));
  printStructured(output, parsed, (value) => `LOCKED Builder Gym baseline ${value.baselineTrajectoryHash.slice(0, 12)}; evaluator ${value.evaluatorHash.slice(0, 12)}`);
}

async function runBuilderGymStatus(parsed) {
  const output = await builderGymStatus(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `BUILDER GYM: ${value.trajectoryCount} trajectories, ${value.lockCount} locks, ${value.verdictCount} verdicts, ${value.protectedTaskCount} protected tasks; real-world evidence absent`);
}

async function runBuilderGymInspect(parsed) {
  const output = await inspectBuilderGymVerdict(repoRootFrom(parsed), requireOption(parsed, "ref"));
  printStructured(output, parsed, (value) => `BUILDER GYM VERDICT VERIFIED ${value.verdict.comparisonId}; promotion not authorized`);
}

async function runTrajectoryRecord(parsed) {
  const output = await recordNodeTraceTrajectory(repoRootFrom(parsed), requireOption(parsed, "file"));
  printStructured(output, parsed, (value) => `RECORDED ${value.trajectory.trajectoryId}; protected evaluator ${value.evaluatorHash.slice(0, 12)}`);
}

async function runTrajectoryInspect(parsed) {
  const output = await inspectNodeTraceTrajectory(repoRootFrom(parsed), requireOption(parsed, "ref"));
  printStructured(output, parsed, (value) => `NODETRACE VERIFIED ${value.trajectory.trajectoryId}; seven verdict dimensions present`);
}

async function runModelsBaseline(parsed) {
  const { receipt, output } = await writeModelBaseline(repoRootFrom(parsed));
  if (parsed.options.json) console.log(JSON.stringify({ ...receipt, output, passed: true }, null, 2));
  else {
    console.log(`BASELINED ${receipt.applicationId}: ${receipt.observationCount} observations, ${receipt.capabilityCardCount} cards`);
    console.log(`  status ${receipt.status}; provider calls 0; routing not certified`);
    console.log(`  receipt ${output}`);
  }
}

async function runModelsProfile(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed));
  const output = { ...compiled.registry, passed: true };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`PROFILED ${output.applicationId}: ${output.observations} observations, ${output.cards.length} evidence-backed cards (${output.status})`);
}

async function runModelsInspect(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed), { write: false });
  const output = {
    applicationId: compiled.harness.applicationId,
    harnessVersion: compiled.harness.version,
    harnessHash: compiled.resolved.harnessHash,
    benchmarkHash: compiled.resolved.benchmarkHash,
    status: compiled.registry.status,
    observationCount: compiled.observations.length,
    cards: compiled.cards.map((card) => ({
      confidence: card.confidence,
      model: card.model,
      scope: card.scope,
      status: card.status,
    })),
    routingCertified: false,
    automaticPromotion: false,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${output.applicationId} Harness ${output.harnessVersion}: ${output.status}`);
    console.log(`  observations ${output.observationCount}; cards ${output.cards.length}`);
    console.log("  routing uncertified; automatic promotion disabled");
    for (const card of output.cards) console.log(`  ${card.scope.level} ${card.model.resolvedProvider}/${card.model.resolvedModel}: ${card.status}, ${card.confidence.level} confidence`);
  }
}

async function runModelsDiagnose(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed), { write: false });
  const clusters = diagnoseModelFailures(compiled.observations);
  const output = {
    schemaVersion: "nodekit.model-diagnosis/v1",
    applicationId: compiled.harness.applicationId,
    observationCount: compiled.observations.length,
    clusters,
    skillCandidates: clusters.filter((cluster) => cluster.skillCandidateEligible).length,
    passed: true,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`DIAGNOSED ${output.applicationId}: ${clusters.length} failure clusters, ${output.skillCandidates} eligible for skill-candidate review`);
    for (const cluster of clusters) console.log(`  ${cluster.count}x ${cluster.failureClass} (${cluster.probableCause}) ${cluster.model}${cluster.skillCandidateEligible ? " [candidate threshold met]" : ""}`);
  }
}

function requireOption(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") throw new Error(`--${name} is required`);
  return String(value);
}

function printStructured(output, parsed, textSummary) {
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(textSummary(output));
}

async function runSkillsPropose(parsed) {
  const output = await proposeSkillCandidates(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `PROPOSED ${value.candidates.length} evidence-backed skill candidates; none promoted`);
}

async function runSkillsReview(parsed) {
  const output = await reviewSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"));
  printStructured(output, parsed, (value) => `REVIEWED ${value.candidate.candidateId}: ${value.candidate.status} (${value.skill.id}@${value.skill.version})`);
}

async function runSkillsBenchmark(parsed) {
  const output = await benchmarkSkillCandidate(
    repoRootFrom(parsed),
    requireOption(parsed, "candidate"),
    requireOption(parsed, "comparison"),
  );
  printStructured(output, parsed, (value) => `BENCHMARK ${value.passed ? "PASS" : "FAIL"} ${value.candidateId}; meaningful improvement ${value.meaningfulImprovement}`);
  if (!output.passed) process.exitCode = 1;
}

async function runSkillsPromote(parsed) {
  const output = await promoteSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"), {
    approvalPath: requireOption(parsed, "approval"),
    canaryPath: requireOption(parsed, "canary"),
    proofPath: requireOption(parsed, "proof-receipt"),
  });
  printStructured(output, parsed, (value) => `PROMOTED ${value.promotion.candidateId} to ${value.nextVersion}; rollback ${value.promotion.rollbackVersion}`);
}

async function runSkillsReject(parsed) {
  const output = await rejectSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"), requireOption(parsed, "reason"));
  printStructured(output, parsed, (value) => `REJECTED ${value.candidateId}: ${value.reason}`);
}

async function runRoutingCompile(parsed) {
  const output = await compileRoutingPolicy(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `COMPILED provisional routing policy with ${value.routes.length} task-family routes; promotion not authorized`);
}

async function runRoutingCanary(parsed) {
  const output = await verifyCanary(repoRootFrom(parsed), requireOption(parsed, "receipt"));
  printStructured(output, parsed, (value) => `CANARY PASS ${value.receiptId} for ${value.candidateId}; trusted evaluator ${value.trustedKeyId}`);
}

async function runHarnessTournament(parsed) {
  const output = await evaluateTournament(repoRootFrom(parsed), requireOption(parsed, "manifest"));
  printStructured(output, parsed, (value) => `TOURNAMENT ${value.tournamentId}: ${value.decisive ? `provisional winner ${value.winner}` : "no decisive winner"}; promotion not authorized`);
}

async function runHarnessStatus(parsed) {
  const output = await harnessStatus(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `HARNESS ${value.version}: ${value.observations} observations, ${value.capabilityCards} cards, ${value.skillCandidates.length} candidates; Builder Gym ${value.builderGym.trajectories} trajectories; routing uncertified`);
}

async function runHarnessRollback(parsed) {
  const output = await rollbackHarness(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `ROLLED BACK ${value.from} -> ${value.to}; version history preserved`);
}

async function runHarnessGate(parsed) {
  const output = await harnessStatus(repoRootFrom(parsed));
  const checks = {
    activeVersionPromoted: /^h[1-9]\d*$/.test(output.version),
    automaticPromotionDisabled: output.automaticPromotion === false,
    benchmarkBound: typeof output.benchmarkHash === "string" && output.benchmarkHash.length === 64,
    builderGymMechanicsReady: output.builderGym.mechanicsReady === true,
    builderGymPromotionDisabled: output.builderGym.automaticPromotion === false && output.builderGym.promotionAuthorized === false,
    noOpenCandidates: output.skillCandidates.every((entry) => !["proposed", "reviewed", "benchmark-passed"].includes(entry.status)),
    routingCertified: output.routingCertified === true,
  };
  const result = { ...output, checks, passed: Object.values(checks).every(Boolean), schemaVersion: "nodekit.harness-gate/v1" };
  printStructured(result, parsed, (value) => `HARNESS GATE ${value.passed ? "PASS" : "BLOCKED"} ${value.version}`);
  if (!result.passed) process.exitCode = 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [first, second, third] = parsed.positional;
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
  if (first === "graph" && second === "init") {
    await runGraphInit(parsed);
    return;
  }
  if (first === "graph" && second === "ingest") {
    await runGraphIngest(parsed);
    return;
  }
  if (first === "graph" && second === "evidence-ingest") {
    await runGraphEvidenceIngest(parsed);
    return;
  }
  if (first === "graph" && second === "evidence-verify") {
    await runGraphEvidenceVerify(parsed);
    return;
  }
  if (first === "graph" && second === "inspect") {
    await runGraphInspect(parsed);
    return;
  }
  if (first === "graph" && second === "query") {
    await runGraphQuery(parsed);
    return;
  }
  if (first === "graph" && second === "gaps") {
    await runGraphGaps(parsed);
    return;
  }
  if (first === "graph" && second === "research") {
    await runGraphResearch(parsed);
    return;
  }
  if (first === "graph" && second === "propose") {
    await runGraphPropose(parsed);
    return;
  }
  if (first === "graph" && second === "validate") {
    await runGraphValidate(parsed);
    return;
  }
  if (first === "graph" && second === "apply") {
    await runGraphApply(parsed);
    return;
  }
  if (first === "graph" && second === "diff") {
    await runGraphDiff(parsed);
    return;
  }
  if (first === "graph" && second === "replay") {
    await runGraphReplay(parsed);
    return;
  }
  if (first === "graph" && second === "benchmark") {
    await runGraphBenchmark(parsed);
    return;
  }
  if (first === "graph" && second === "harness-sync") {
    await runGraphHarnessSync(parsed);
    return;
  }
  if (first === "frontend" && second === "init") {
    await runFrontendInit(parsed);
    return;
  }
  if (first === "frontend" && second === "plan") {
    await runFrontendPlan(parsed);
    return;
  }
  if (first === "frontend" && second === "directions") {
    await runFrontendDirections(parsed);
    return;
  }
  if (first === "frontend" && second === "benchmark") {
    await runFrontendBenchmark(parsed);
    return;
  }
  if (first === "frontend" && second === "repair") {
    await runFrontendRepair(parsed);
    return;
  }
  if (first === "frontend" && second === "canary") {
    await runFrontendCanary(parsed);
    return;
  }
  if (first === "atlas" && second === "init") {
    await runAtlasInit(parsed);
    return;
  }
  if (first === "atlas" && second === "add") {
    await runAtlasAdd(parsed);
    return;
  }
  if (first === "atlas" && second === "list") {
    await runAtlasList(parsed);
    return;
  }
  if (first === "atlas" && second === "inspect") {
    await runAtlasInspect(parsed);
    return;
  }
  if (first === "atlas" && second === "search") {
    await runAtlasSearch(parsed);
    return;
  }
  if (first === "atlas" && second === "preview") {
    await runAtlasPreview(parsed);
    return;
  }
  if (first === "atlas" && second === "recipe") {
    await runAtlasRecipe(parsed);
    return;
  }
  if (first === "atlas" && second === "repair") {
    await runAtlasRepair(parsed);
    return;
  }
  if (first === "atlas" && second === "serve") {
    await runAtlasServe(parsed);
    return;
  }
  if (first === "atlas") {
    printAtlasUsage();
    if (second) process.exitCode = 1;
    return;
  }
  if (first === "evolution" && second === "init") {
    await runEvolutionInit(parsed);
    return;
  }
  if (first === "evolution" && second === "draft") {
    await runEvolutionDraft(parsed);
    return;
  }
  if (first === "evolution" && second === "record") {
    await runEvolutionRecord(parsed);
    return;
  }
  if (first === "evolution" && second === "verify") {
    await runEvolutionVerify(parsed);
    return;
  }
  if (first === "evolution" && second === "query") {
    await runEvolutionQuery(parsed);
    return;
  }
  if (first === "evolution" && second === "diff") {
    await runEvolutionDiff(parsed);
    return;
  }
  if (first === "evolution" && second === "materiality") {
    await runEvolutionMateriality(parsed);
    return;
  }
  if (first === "evolution" && second === "build-docs") {
    await runEvolutionBuildDocs(parsed);
    return;
  }
  if (first === "evolution" && second === "sync-graph") {
    await runEvolutionSyncGraph(parsed);
    return;
  }
  if (first === "harness" && second === "init") {
    await runHarnessInit(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "init") {
    await runBuilderGymInit(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "evaluate") {
    await runBuilderGymEvaluate(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "lock") {
    await runBuilderGymLock(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "status") {
    await runBuilderGymStatus(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "inspect") {
    await runBuilderGymInspect(parsed);
    return;
  }
  if (first === "harness" && second === "trajectory" && third === "record") {
    await runTrajectoryRecord(parsed);
    return;
  }
  if (first === "harness" && second === "trajectory" && third === "inspect") {
    await runTrajectoryInspect(parsed);
    return;
  }
  if (first === "models" && second === "baseline") {
    await runModelsBaseline(parsed);
    return;
  }
  if (first === "models" && second === "profile") {
    await runModelsProfile(parsed);
    return;
  }
  if (first === "models" && second === "inspect") {
    await runModelsInspect(parsed);
    return;
  }
  if (first === "models" && second === "diagnose") {
    await runModelsDiagnose(parsed);
    return;
  }
  if (first === "harness" && second === "baseline") {
    await runModelsBaseline(parsed);
    return;
  }
  if (first === "harness" && second === "inspect") {
    await runModelsInspect(parsed);
    return;
  }
  if (first === "harness" && second === "diagnose") {
    await runModelsDiagnose(parsed);
    return;
  }
  if (first === "harness" && second === "propose") {
    await runSkillsPropose(parsed);
    return;
  }
  if (first === "harness" && second === "benchmark") {
    await runSkillsBenchmark(parsed);
    return;
  }
  if (first === "harness" && second === "canary") {
    await runRoutingCanary(parsed);
    return;
  }
  if (first === "harness" && second === "review") {
    await runSkillsReview(parsed);
    return;
  }
  if (first === "harness" && second === "promote") {
    await runSkillsPromote(parsed);
    return;
  }
  if (first === "skills" && second === "propose") {
    await runSkillsPropose(parsed);
    return;
  }
  if (first === "skills" && second === "review") {
    await runSkillsReview(parsed);
    return;
  }
  if (first === "skills" && second === "benchmark") {
    await runSkillsBenchmark(parsed);
    return;
  }
  if (first === "skills" && second === "promote") {
    await runSkillsPromote(parsed);
    return;
  }
  if (first === "skills" && second === "reject") {
    await runSkillsReject(parsed);
    return;
  }
  if (first === "routing" && second === "compile") {
    await runRoutingCompile(parsed);
    return;
  }
  if (first === "routing" && second === "canary") {
    await runRoutingCanary(parsed);
    return;
  }
  if (first === "harness" && second === "tournament") {
    await runHarnessTournament(parsed);
    return;
  }
  if (first === "harness" && second === "status") {
    await runHarnessStatus(parsed);
    return;
  }
  if (first === "harness" && second === "gate") {
    await runHarnessGate(parsed);
    return;
  }
  if (first === "harness" && second === "rollback") {
    await runHarnessRollback(parsed);
    return;
  }
  throw new Error(`unknown command: ${parsed.positional.join(" ")}`);
}

main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = 1;
});
