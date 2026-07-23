import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildEvolutionDocs,
  checkEvolutionMateriality,
  initializeEvolutionLedger,
  proposeEvolutionKnowledgePatch,
  queryEvolutionLedger,
  recordEvolutionRecord,
  verifyEvolutionLedger,
} from "../src/lib/evolution-ledger.mjs";
import { initializeKnowledgeGraph } from "../src/lib/knowledge-evolution.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-evolution-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  await writeFile(path.join(root, "verifier.txt"), "proposal-before-mutation verified\n");
  git(root, ["add", "verifier.txt"]);
  git(root, ["commit", "-m", "test invariant"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const bytes = await readFile(path.join(root, "verifier.txt"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await initializeEvolutionLedger(root);
  const records = [
    { schemaVersion: "nodekit.evolution-evidence/v1", id: "evd:test", kind: "test", artifactRef: "file:verifier.txt", sha256, sourceCommit: commit, generatedAt: new Date().toISOString(), command: "node --test", environment: { platform: process.platform }, verifiesInvariantIds: ["inv:test"], nodeProofReceiptId: "proof:test", result: "pass" },
    { schemaVersion: "nodekit.assumption/v1", id: "asm:test", statement: "Direct mutation was safe", scope: { applications: ["fixture"] }, status: "disproven", introducedByEventId: "evt:test", invalidatedByEventId: "evt:test", supportingEvidenceIds: [], contradictingEvidenceIds: ["evd:test"] },
    { schemaVersion: "nodekit.invariant-claim/v1", id: "inv:test", statement: "Agent writes remain proposals until approval", scope: { applications: ["fixture"] }, enforcement: "runtime-gate", verifierRefs: ["verifier.txt"], introducedByEventId: "evt:test", status: "verified" },
    { schemaVersion: "nodekit.evolution-event/v1", id: "evt:test", projectId: "fixture", repository: "local/fixture", source: { commitSha: commit, occurredAt: new Date().toISOString() }, track: "architecture", category: "runtime", challenge: "Direct mutation corrupted canonical state", observedFailure: "A stale agent write replaced newer work", resolution: "Introduced proposal validation and approval", assumptionIds: ["asm:test"], invariantIds: ["inv:test"], evidenceIds: ["evd:test"], knownLimitations: [], interpretation: { status: "human-reviewed", reviewedBy: "reviewer", reviewedAt: new Date().toISOString() } },
    { schemaVersion: "nodekit.evolution-adoption/v1", id: "adp:test", invariantId: "inv:test", consumer: { repository: "local/fixture", application: "fixture" }, adoptedAtCommit: commit, evidenceIds: ["evd:test"], status: "verified" },
  ];
  await mkdir(path.join(root, "inputs"));
  for (const record of records) {
    const file = path.join(root, "inputs", `${record.id.replace(":", "-")}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    await recordEvolutionRecord(root, path.relative(root, file));
  }
  return { commit, records, root };
}

test("Evolution Ledger verifies causal records, immutable evidence, and consumer adoption", async () => {
  const { root } = await fixture();
  const verdict = await verifyEvolutionLedger(root);
  assert.equal(verdict.passed, true, verdict.issues.join("\n"));
  assert.deepEqual(verdict.counts, { events: 1, assumptions: 1, invariants: 1, evidence: 1, adoptions: 1 });
  const query = await queryEvolutionLedger(root, { invariantId: "inv:test" });
  assert.equal(query.events.length, 1);
  assert.equal(query.adoptions[0].status, "verified");
});

test("Evolution Ledger detects evidence drift and refuses canonical overwrite", async () => {
  const { records, root } = await fixture();
  await writeFile(path.join(root, "verifier.txt"), "drifted\n");
  const verdict = await verifyEvolutionLedger(root);
  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join("\n"), /hash mismatch/);
  const event = records.find((record) => record.schemaVersion === "nodekit.evolution-event/v1");
  event.resolution = "silently overwritten";
  const input = path.join(root, "inputs", "changed-event.json");
  await writeFile(input, `${JSON.stringify(event, null, 2)}\n`);
  await assert.rejects(() => recordEvolutionRecord(root, path.relative(root, input)), /immutable/);
});

test("verified evolution history generates projections and only proposes Knowledge Evolution changes", async () => {
  const { root } = await fixture();
  const docs = await buildEvolutionDocs(root);
  assert.match(await readFile(docs.output, "utf8"), /proposal validation and approval/i);
  await initializeKnowledgeGraph(root, { graphId: "fixture-evolution" });
  const { patch } = await proposeEvolutionKnowledgePatch(root);
  assert.equal(patch.status, "pending");
  assert.equal(patch.operations.some((operation) => operation.node?.kind === "evidence"), true);
  const graph = JSON.parse(await readFile(path.join(root, ".nodeagent", "knowledge", "graph.json"), "utf8"));
  assert.equal(graph.version, 0);
  assert.equal(graph.nodes.length, 0);
});

test("materiality gate blocks unrecorded system changes and accepts a reviewed event in range", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "runtime.mjs"), "export const version = 2;\n");
  git(root, ["add", "src/runtime.mjs"]);
  git(root, ["commit", "-m", "material runtime change"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const blocked = await checkEvolutionMateriality(root, before, after);
  assert.equal(blocked.passed, false);
  assert.deepEqual(blocked.materialFiles, ["src/runtime.mjs"]);

  const event = {
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:material-runtime-change",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "architecture",
    category: "runtime",
    challenge: "Runtime contract changed",
    resolution: "Recorded the reviewed material change",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: [],
    interpretation: { status: "human-reviewed", reviewedBy: "reviewer", reviewedAt: new Date().toISOString() },
  };
  const input = path.join(root, "inputs", "material-event.json");
  await writeFile(input, `${JSON.stringify(event, null, 2)}\n`);
  await recordEvolutionRecord(root, path.relative(root, input));
  const passed = await checkEvolutionMateriality(root, before, after);
  assert.equal(passed.passed, true);
  assert.equal(passed.events[0].id, event.id);
});
