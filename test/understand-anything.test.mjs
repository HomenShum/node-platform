import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  importUnderstandAnythingCodeGraph,
  queryUnderstandAnythingCodeGraph,
  readUnderstandAnythingCodeGraph,
} from "../src/lib/understand-anything.mjs";

const execFileAsync = promisify(execFile);

async function initializeRepository(root) {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "nodekit@example.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "fixture\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
}

function fixtureGraph(commitSha) {
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
      gitCommitHash: commitSha,
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
  const commitSha = await initializeRepository(root);
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph(commitSha)));

  const snapshot = await importUnderstandAnythingCodeGraph(root, {
    commitSha,
    repoId: "proofloop",
  });

  assert.equal(snapshot.kind, "codebase");
  assert.equal(snapshot.nodes[0].id, `codebase:proofloop@${commitSha}:file:runner`);
  assert.equal(snapshot.edges[0].source, `codebase:proofloop@${commitSha}:file:runner`);
  assert.equal(snapshot.layers[0].nodeIds[1], `codebase:proofloop@${commitSha}:function:run`);
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
  const commitSha = await initializeRepository(root);
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph(commitSha)));

  const snapshot = await importUnderstandAnythingCodeGraph(root, { commitSha, repoId: "fixture" });
  const result = queryUnderstandAnythingCodeGraph(snapshot, "durable runner");

  assert.equal(result.matched[0].node.name, "Runner");
  assert.equal(result.edges.length, 1);
  assert.equal(result.schemaVersion, "nodekit.code-graph-query/v1");
  await assert.rejects(
    () => importUnderstandAnythingCodeGraph(root, { graphDir: "../outside" }),
    /must stay inside the repository/,
  );
});

test("rejects stale or falsely pinned Understand Anything graphs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ua-stale-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const commitSha = await initializeRepository(root);
  const graphDir = path.join(root, ".understand-anything");
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph("deadbeef")));
  await assert.rejects(() => importUnderstandAnythingCodeGraph(root), /does not match repository HEAD/);
  await writeFile(path.join(graphDir, "knowledge-graph.json"), JSON.stringify(fixtureGraph(commitSha)));
  await assert.rejects(() => importUnderstandAnythingCodeGraph(root, { commitSha: "cafebabe" }), /requested code graph commit/);
});
