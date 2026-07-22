import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runCaseflowConformance } from "../src/lib/caseflow-conformance.mjs";
import { contentHash } from "../src/lib/caseflow.mjs";
import { createPostgresCaseflow } from "../src/adapters/postgres-caseflow.mjs";
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

const pool = new Pool({ connectionString, max: 8 });
const migrationPath = path.join(repoRoot, "adapters", "postgres", "001_caseflow.sql");
const migration = await readFile(migrationPath, "utf8");
const migrationSha256 = sha256(migration);
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const dirtySource = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^"|"$/g, "").replaceAll("\\", "/"))
  .filter((file) => !/^(?:proof|docs|evolution)\//.test(file));
if (dirtySource.length > 0 && process.env.NODEKIT_ALLOW_DIRTY_CONFORMANCE !== "true") {
  throw new Error(`PostgreSQL conformance requires a clean source candidate; dirty paths: ${dirtySource.join(", ")}`);
}
const nodekitSourceHash = await computeNodeKitSourceHash(repoRoot);
const ownerPrefix = `postgres-conformance-${randomUUID()}`;
const ownerA = `${ownerPrefix}-a`;
const ownerB = `${ownerPrefix}-b`;

try {
  await pool.query(migration);
  const conformance = await runCaseflowConformance(
    () => createPostgresCaseflow({ pool, ownerId: ownerA }),
    { requiredCapabilities: { durableState: true, optimisticConcurrency: true, transactions: true } },
  );

  const runtimeA = createPostgresCaseflow({ pool, ownerId: ownerA });
  const runtimeB = createPostgresCaseflow({ pool, ownerId: ownerB });
  const ownerASnapshot = await runtimeA.snapshot();
  const ownerBSnapshot = await runtimeB.snapshot();
  const ownerIsolation = ownerASnapshot.cases.length === 1 && ownerBSnapshot.cases.length === 0;
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

  const reloaded = createPostgresCaseflow({ pool, ownerId: ownerA });
  const reloadedSnapshot = await reloaded.snapshot();
  const reloadPreservedState = reloadedSnapshot.cases.length === 2
    && reloadedSnapshot.artifacts.find((entry) => entry.artifactId === raceArtifact.artifactId)?.canonicalVersion === 2;
  const completionReceipt = ownerASnapshot.receipts[0];
  const { receiptHash, receiptId, ...receiptBody } = completionReceipt;
  const receiptIntegrity = /^[a-f0-9]{64}$/.test(receiptHash)
    && receiptId.startsWith("receipt_")
    && contentHash(receiptBody) === receiptHash;

  const assertions = {
    crossOwnerDenied,
    ownerIsolation,
    receiptIntegrity,
    reloadPreservedState,
    sameBaseRaceFailedClosed,
    sharedConformancePassed: conformance.passed,
  };
  const serverVersion = (await pool.query("show server_version")).rows[0].server_version;
  const verdict = {
    schemaVersion: "nodekit.postgres-conformance/v1",
    adapter: "@homenshum/nodekit/adapters/postgres",
    assertions,
    candidateCommit,
    capabilities: conformance.capabilities,
    conformance,
    generatedAt: new Date().toISOString(),
    migration: {
      path: "adapters/postgres/001_caseflow.sql",
      sha256: migrationSha256,
    },
    nodekitSourceHash,
    ownerScope: "isolated-test-identities",
    passed: Object.values(assertions).every(Boolean),
    postgres: {
      serverVersion,
    },
  };
  const output = option("--output");
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.passed) process.exitCode = 1;
} finally {
  await pool.end();
}
