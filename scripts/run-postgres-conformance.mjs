import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "../src/lib/distributable-candidate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.NODEKIT_POSTGRES_URL;
if (!connectionString) throw new Error("NODEKIT_POSTGRES_URL is required");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const candidateTarballOption = option("--candidate-tarball");
if (!candidateTarballOption) throw new Error("--candidate-tarball is required; live conformance must exercise the exact packed release candidate");
const candidateTarballPath = await realpath(path.resolve(candidateTarballOption));
const candidateTarballMetadata = await lstat(candidateTarballPath, { bigint: true });
if (!candidateTarballMetadata.isFile() || candidateTarballMetadata.isSymbolicLink()) {
  throw new Error("--candidate-tarball must be a regular non-symlink file");
}
const candidateTarballBytes = await readFile(candidateTarballPath);
const nodekitTarballSha256 = sha256(candidateTarballBytes);
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const dirtySource = parseGitStatusPorcelainZ(execFileSync("git", [
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
  "--",
  ...distributablePathspecs(packageJson),
], {
  cwd: repoRoot,
  encoding: "buffer",
  maxBuffer: 64 * 1024 * 1024,
}));
assertCleanDistributablePaths(dirtySource, "PostgreSQL conformance");
const nodekitSourceHash = await computeNodeKitSourceHash(repoRoot);
const releaseCandidate = {
  nodekitCommit: candidateCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  packageName: packageJson.name,
  packageVersion: packageJson.version,
};
if (releaseCandidate.packageName !== "@homenshum/nodekit") throw new Error("candidate package name is not @homenshum/nodekit");

// Install the packed candidate into a disposable consumer. Importing the
// adapter or conformance harness from this source checkout would allow a live
// database pass to certify different bytes than consumers will install.
const installRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-postgres-candidate-"));
let pool;
const ownerPrefix = `postgres-conformance-${randomUUID()}`;
const ownerA = `${ownerPrefix}-a`;
const ownerB = `${ownerPrefix}-b`;
const ownerRace = `${ownerPrefix}-race`;
const ownerKnowledge = `${ownerPrefix}-knowledge`;
const ownerKnowledgeOther = `${ownerPrefix}-knowledge-other`;
const ownerKnowledgeRace = `${ownerPrefix}-knowledge-race`;

try {
  await writeFile(path.join(installRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  const immutableTarballPath = path.join(installRoot, "candidate.tgz");
  await writeFile(immutableTarballPath, candidateTarballBytes, { flag: "wx" });
  if (sha256(await readFile(immutableTarballPath)) !== nodekitTarballSha256) throw new Error("immutable candidate tarball copy hash mismatch");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCommand, [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", immutableTarballPath,
  ], { cwd: installRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const consumerRequire = createRequire(path.join(installRoot, "package.json"));
  const adapterPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres"));
  const caseflowPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/caseflow"));
  const knowledgeRuntimePath = await realpath(consumerRequire.resolve("@homenshum/nodekit/knowledge-runtime"));
  const knowledgeAdapterPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/knowledge"));
  const installedPackagePath = await realpath(consumerRequire.resolve("@homenshum/nodekit/package.json"));
  const migrationPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/migration.sql"));
  const knowledgeMigrationPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/knowledge-migration.sql"));
  for (const installedPath of [adapterPath, caseflowPath, knowledgeRuntimePath, knowledgeAdapterPath, installedPackagePath, migrationPath, knowledgeMigrationPath]) {
    const relative = path.relative(installRoot, installedPath);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`packed-candidate import escaped its disposable installation: ${installedPath}`);
    }
  }
  const installedPackageBytes = await readFile(installedPackagePath);
  const installedPackage = JSON.parse(installedPackageBytes.toString("utf8"));
  if (installedPackage.name !== releaseCandidate.packageName || installedPackage.version !== releaseCandidate.packageVersion) {
    throw new Error("installed packed candidate identity does not match the source release identity");
  }
  const [{ createPostgresCaseflow }, { contentHash, runCaseflowConformance }, { createPostgresKnowledgeRuntime }, { knowledgeRuntimeHash }] = await Promise.all([
    import(pathToFileURL(adapterPath).href),
    import(pathToFileURL(caseflowPath).href),
    import(pathToFileURL(knowledgeAdapterPath).href),
    import(pathToFileURL(knowledgeRuntimePath).href),
  ]);
  if (typeof createPostgresCaseflow !== "function" || typeof contentHash !== "function" || typeof runCaseflowConformance !== "function"
    || typeof createPostgresKnowledgeRuntime !== "function" || typeof knowledgeRuntimeHash !== "function") {
    throw new Error("installed packed candidate is missing required PostgreSQL/conformance exports");
  }
  const migration = await readFile(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  const knowledgeMigration = await readFile(knowledgeMigrationPath, "utf8");
  const knowledgeMigrationSha256 = sha256(knowledgeMigration);
  pool = new Pool({ connectionString, max: 8 });
  await pool.query(migration);
  await pool.query(knowledgeMigration);
  const conformance = await runCaseflowConformance(
    () => createPostgresCaseflow({ pool, ownerId: ownerA }),
    { requiredCapabilities: { durableState: true, optimisticConcurrency: true, transactions: true } },
  );

  const runtimeA = createPostgresCaseflow({ pool, ownerId: ownerA });
  const runtimeB = createPostgresCaseflow({ pool, ownerId: ownerB });
  const ownerASnapshot = await runtimeA.snapshot();
  const ownerBSnapshot = await runtimeB.snapshot();
  const ownerIsolation = ownerASnapshot.cases.length > 0 && ownerBSnapshot.cases.length === 0;
  let crossOwnerDenied = false;
  try {
    await runtimeB.startRun({ caseId: ownerASnapshot.cases[0].caseId, stages: [{ id: "working", label: "Working", owner: "agent" }] });
  } catch (error) {
    crossOwnerDenied = /case not found/.test(String(error?.message));
  }

  const raceCase = await runtimeA.createCase({ title: "Same-base race", primaryJob: "Apply exactly one proposal" });
  const raceRun = await runtimeA.startRun({
    caseId: raceCase.caseId,
    stages: [
      { id: "working", label: "Working", owner: "agent" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  });
  const raceArtifact = await runtimeA.createArtifact({ caseId: raceCase.caseId, runId: raceRun.runId, title: "Race artifact", content: { value: 1 } });
  const proposalA = await runtimeA.createProposal({ artifactId: raceArtifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const proposalB = await runtimeA.createProposal({ artifactId: raceArtifact.artifactId, baseVersion: 1, patch: { value: 3 } });
  const race = await Promise.all([
    runtimeA.decideProposal({ proposalId: proposalA.proposalId, decision: "accepted" }),
    runtimeA.decideProposal({ proposalId: proposalB.proposalId, decision: "accepted" }),
  ]);
  const raceStatuses = race.map((entry) => entry.proposal.status).sort();
  const sameBaseRaceFailedClosed = JSON.stringify(raceStatuses) === JSON.stringify(["accepted", "conflicted"])
    && race.every((entry) => entry.artifact.canonicalVersion === 2);

  const raceWriter = createPostgresCaseflow({ pool, ownerId: ownerRace });
  const raceCompleter = createPostgresCaseflow({ pool, ownerId: ownerRace });
  const boundaryCase = await raceWriter.createCase({ title: "Artifact completion barrier", primaryJob: "Never omit a committed artifact" });
  const boundaryRun = await raceWriter.startRun({
    caseId: boundaryCase.caseId,
    stages: [{ id: "work", label: "Work", owner: "agent" }],
  });
  const baselineArtifact = await raceWriter.createArtifact({
    caseId: boundaryCase.caseId,
    runId: boundaryRun.runId,
    title: "Baseline artifact",
    content: { baseline: true },
  });
  const [lateArtifactResult, completionResult] = await Promise.allSettled([
    raceWriter.createArtifact({
      caseId: boundaryCase.caseId,
      runId: boundaryRun.runId,
      title: "Racing artifact",
      content: { racing: true },
    }),
    raceCompleter.completeRun({ runId: boundaryRun.runId }),
  ]);
  const completionWon = completionResult.status === "fulfilled";
  const artifactCompletionRaceAtomic = completionWon && (
    lateArtifactResult.status === "fulfilled"
      ? completionResult.value.receipt.artifactIds.includes(lateArtifactResult.value.artifactId)
      : /run is terminal: completed/.test(String(lateArtifactResult.reason?.message))
  ) && completionResult.value.receipt.artifactIds.includes(baselineArtifact.artifactId);

  const reloaded = createPostgresCaseflow({ pool, ownerId: ownerA });
  const reloadedSnapshot = await reloaded.snapshot();
  const reloadPreservedState = reloadedSnapshot.cases.some((entry) => entry.caseId === raceCase.caseId)
    && reloadedSnapshot.artifacts.find((entry) => entry.artifactId === raceArtifact.artifactId)?.canonicalVersion === 2;
  const completionReceipt = ownerASnapshot.receipts[0];
  const { receiptHash, receiptId, ...receiptBody } = completionReceipt;
  const receiptIntegrity = /^[a-f0-9]{64}$/.test(receiptHash)
    && receiptId.startsWith("receipt_")
    && contentHash(receiptBody) === receiptHash;

  const knowledgeGraph = (ownerId, graphId, createdAt) => {
    const body = {
      schemaVersion: "nodekit.knowledge-graph/v1",
      graphId,
      version: 0,
      authority: { canonicalMutation: "accepted-patch-only", destructiveDelete: false, oneAuthoritativeGraph: true, ownerId },
      layers: ["source", "derived", "working", "proposal", "canonical", "hypothesis"].map((id) => ({ id, writableThrough: id === "source" ? "ingest-proposal" : "graph-patch" })),
      nodes: [],
      hyperedges: [],
      proposals: [],
      actionReceipts: [],
      evolutionReceipts: [],
      genesis: { createdAt, graphId },
      createdAt,
      updatedAt: createdAt,
    };
    return { ...body, contentHash: knowledgeRuntimeHash(body) };
  };
  const knowledgeRuntime = createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge });
  const knowledgeGraphId = `knowledge:${ownerPrefix}`;
  const projectedGraph = knowledgeGraph(ownerKnowledge, knowledgeGraphId, "2026-07-22T00:00:00.000Z");
  const projected = await knowledgeRuntime.projectGraph({ graph: projectedGraph, expectedVersion: null });
  const reloadedGraph = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge }).readGraph(knowledgeGraphId);
  const firstRetrieval = await knowledgeRuntime.retrieve({ graphId: knowledgeGraphId, sessionId: "session-1", query: "missing", minimumFacts: 1 });
  const secondRetrieval = await knowledgeRuntime.retrieve({ graphId: knowledgeGraphId, sessionId: "session-1", query: "missing", minimumFacts: 1 });
  const durableKnowledgeReceipts = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge }).listSessionReceipts({ graphId: knowledgeGraphId, sessionId: "session-1" });
  let knowledgeOwnerIsolation = false;
  try {
    await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeOther }).readGraph(knowledgeGraphId);
  } catch (error) {
    knowledgeOwnerIsolation = /knowledge graph not found/.test(String(error?.message));
  }
  const raceGraphId = `knowledge:${ownerPrefix}:race`;
  const raceKnowledgeA = knowledgeGraph(ownerKnowledgeRace, raceGraphId, "2026-07-22T00:00:00.000Z");
  const raceKnowledgeB = knowledgeGraph(ownerKnowledgeRace, raceGraphId, "2026-07-22T00:00:00.001Z");
  const raceKnowledgeResults = await Promise.allSettled([
    createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).projectGraph({ graph: raceKnowledgeA, expectedVersion: null }),
    createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).projectGraph({ graph: raceKnowledgeB, expectedVersion: null }),
  ]);
  const raceKnowledgeStored = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).readGraph(raceGraphId);
  const knowledgeFirstCreateRaceAtomic = raceKnowledgeResults.filter((entry) => entry.status === "fulfilled").length === 1
    && raceKnowledgeResults.filter((entry) => entry.status === "rejected").length === 1
    && [raceKnowledgeA.contentHash, raceKnowledgeB.contentHash].includes(raceKnowledgeStored.contentHash);

  const assertions = {
    artifactCompletionRaceAtomic,
    crossOwnerDenied,
    ownerIsolation,
    receiptIntegrity,
    reloadPreservedState,
    sameBaseRaceFailedClosed,
    sharedConformancePassed: conformance.passed,
    knowledgeFirstCreateRaceAtomic,
    knowledgeOwnerIsolation,
    knowledgePackageExportsResolved: true,
    knowledgeProjectionApplied: projected.applied === true && projected.actualVersion === 0,
    knowledgeProjectionReloaded: reloadedGraph.contentHash === projectedGraph.contentHash,
    knowledgeRetrievalReceiptDurable: firstRetrieval.decision.status === "ABSTAIN"
      && secondRetrieval.receipt.repeatSession === true
      && durableKnowledgeReceipts.length === 2
      && durableKnowledgeReceipts[1].previousReceiptIds.includes(firstRetrieval.receipt.receiptId),
  };
  const serverVersion = (await pool.query("show server_version")).rows[0].server_version;
  const serverVersionNum = Number((await pool.query("show server_version_num")).rows[0].server_version_num);
  const verdict = {
    schemaVersion: "nodekit.postgres-conformance/v2",
    adapter: "@homenshum/nodekit/adapters/postgres",
    assertions,
    candidateCommit,
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${nodekitSourceHash}`,
    releaseCandidate,
    capabilities: conformance.capabilities,
    conformance,
    environment: "live-postgresql",
    testedAt: new Date().toISOString(),
    migration: {
      packagePath: "adapters/postgres/001_caseflow.sql",
      sha256: migrationSha256,
    },
    knowledgeMigration: {
      packagePath: "adapters/postgres/002_knowledge_runtime.sql",
      sha256: knowledgeMigrationSha256,
    },
    nodekitSourceHash,
    ownerScope: "isolated-test-identities",
    packageInstallation: {
      installTool: "npm",
      isolated: true,
      lifecycleScriptsDisabled: true,
      packageJsonSha256: sha256(installedPackageBytes),
      resolvedAdapterPath: path.relative(installRoot, adapterPath).replaceAll("\\", "/"),
      resolvedKnowledgeAdapterPath: path.relative(installRoot, knowledgeAdapterPath).replaceAll("\\", "/"),
      immutableTarballCopySha256: sha256(await readFile(immutableTarballPath)),
      sourceCheckoutImported: false,
    },
    passed: Object.values(assertions).every(Boolean),
    postgres: {
      serverVersion,
      serverVersionNum,
    },
    errors: [],
    publicationPerformed: false,
    deployPerformed: false,
  };
  const output = option("--output");
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(verdict, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.passed) process.exitCode = 1;
} finally {
  if (pool) {
    await pool.query("delete from nodekit.knowledge_projections where owner_id = any($1::text[])", [[ownerKnowledge, ownerKnowledgeOther, ownerKnowledgeRace]]).catch(() => {});
    await pool.query("delete from nodekit.cases where owner_id = any($1::text[])", [[ownerA, ownerB, ownerRace]]).catch(() => {});
    await pool.end();
  }
  await rm(installRoot, { recursive: true, force: true });
}
