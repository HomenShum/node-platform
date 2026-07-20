import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  importUnderstandAnythingCodeGraph,
  queryUnderstandAnythingCodeGraph,
  readUnderstandAnythingCodeGraph,
} from "../src/lib/understand-anything.mjs";

function fixtureGraph() {
  return {
    edges: [
      { direction: "forward", source: "file:runner", target: "function:run", type: "contains", weight: 1 },
    ],
    kind: "codebase",
    layers: [
      { description: "Runtime", id: "runtime", name: "Runtime", nodeIds: ["file:runner", "function:run"] },
    ],
    nodes: [
      {
        complexity: "moderate",
        filePath: "src/runner.ts",
        id: "file:runner",
        name: "Runner",
        summary: "Durable task runner.",
        tags: ["proof", "runner"],
        type: "file",
      },
      {
        complexity: "moderate",
        filePath: "src/runner.ts",
        id: "function:run",
        name: "runProofProgram",
        summary: "Runs a proof program.",
        tags: ["program"],
        type: "function",
      },
    ],
    project: {
      analyzedAt: "2026-07-20T12:00:00.000Z",
      description: "Fixture",
      frameworks: ["Node"],
      gitCommitHash: "abc123",
      languages: ["TypeScript"],
      name: "Fixture",
    },
    tour: [],
    version: "2.9.0",
  };
}

test("imports a pinned Understand Anything code graph as a namespaced snapshot", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ua-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const graphDir = path.join(root, ".understand-anything");
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph()));

  const snapshot = await importUnderstandAnythingCodeGraph(root, {
    commitSha: "deadbeef",
    repoId: "proofloop",
  });

  assert.equal(snapshot.kind, "codebase");
  assert.equal(snapshot.nodes[0].id, "codebase:proofloop@deadbeef:file:runner");
  assert.equal(snapshot.edges[0].source, "codebase:proofloop@deadbeef:file:runner");
  assert.equal(snapshot.layers[0].nodeIds[1], "codebase:proofloop@deadbeef:function:run");
  assert.equal(snapshot.source.provider, "understand-anything");
  assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);

  const persisted = await readUnderstandAnythingCodeGraph(root);
  assert.equal(persisted.contentHash, snapshot.contentHash);
  assert.equal(
    JSON.parse(await readFile(path.join(root, ".nodeagent", "code-graph", "understand-anything.snapshot.json"), "utf8")).schemaVersion,
    "nodekit.code-graph-snapshot/v1",
  );
});

test("queries the imported graph without treating it as an autonomous write authority", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ua-query-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const graphDir = path.join(root, ".understand-anything");
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph()));

  const snapshot = await importUnderstandAnythingCodeGraph(root, { commitSha: "abc123", repoId: "fixture" });
  const result = queryUnderstandAnythingCodeGraph(snapshot, "durable runner");

  assert.equal(result.matched[0].node.name, "Runner");
  assert.equal(result.edges.length, 1);
  assert.equal(result.schemaVersion, "nodekit.code-graph-query/v1");
  await assert.rejects(
    () => importUnderstandAnythingCodeGraph(root, { graphDir: "../outside" }),
    /must stay inside the repository/,
  );
});
