import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath, pathExists } from "./files.mjs";

const SNAPSHOT_SCHEMA = "nodekit.code-graph-snapshot/v1";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function containedPath(repoRoot, candidate, label) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository: ${candidate}`);
  }
  return { absolute, relative: normalizePath(relative || ".") };
}

function string(value) {
  return typeof value === "string" ? value : "";
}

function validateGraph(graph, source) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    throw new Error(`Understand Anything graph is not an object: ${source}`);
  }
  if (graph.kind && graph.kind !== "codebase") {
    throw new Error(`Understand Anything graph must be kind=codebase: ${source}`);
  }
  if (!graph.project || typeof graph.project !== "object") {
    throw new Error(`Understand Anything graph is missing project metadata: ${source}`);
  }
  for (const collection of ["nodes", "edges", "layers", "tour"]) {
    if (!Array.isArray(graph[collection])) {
      throw new Error(`Understand Anything graph is missing ${collection}: ${source}`);
    }
  }
  const nodeIds = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node !== "object" || !string(node.id) || !string(node.name)) {
      throw new Error(`Understand Anything graph has an invalid node: ${source}`);
    }
    if (nodeIds.has(node.id)) throw new Error(`Understand Anything graph has duplicate node id ${node.id}: ${source}`);
    nodeIds.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!edge || typeof edge !== "object" || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Understand Anything graph has an invalid edge reference: ${source}`);
    }
  }
}

function namespaceId(namespace, id) {
  return `${namespace}:${id}`;
}

function normalizeTerms(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((term) => term.length > 1);
}

function scoreNode(node, terms) {
  if (terms.length === 0) return 0;
  const name = string(node.name).toLowerCase();
  const tags = Array.isArray(node.tags) ? node.tags.join(" ").toLowerCase() : "";
  const summary = string(node.summary).toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 8;
    if (tags.includes(term)) score += 4;
    if (summary.includes(term)) score += 1;
  }
  return score;
}

export async function importUnderstandAnythingCodeGraph(repoRoot, {
  commitSha = "uncommitted",
  graphDir = ".understand-anything",
  repoId = path.basename(path.resolve(repoRoot)),
  write = true,
} = {}) {
  const resolved = containedPath(repoRoot, graphDir, "graph directory");
  const graphPath = path.join(resolved.absolute, "knowledge-graph.json");
  if (!(await pathExists(graphPath))) {
    throw new Error(`Understand Anything graph is missing: ${normalizePath(path.relative(repoRoot, graphPath))}`);
  }
  const sourceBytes = await readFile(graphPath);
  let graph;
  try {
    graph = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error(`Understand Anything graph is invalid JSON: ${normalizePath(path.relative(repoRoot, graphPath))}`);
  }
  validateGraph(graph, normalizePath(path.relative(repoRoot, graphPath)));

  const namespace = `codebase:${repoId}@${commitSha}`;
  const nodes = graph.nodes.map((node) => ({
    ...node,
    id: namespaceId(namespace, node.id),
    sourceId: node.id,
  }));
  const edges = graph.edges.map((edge, index) => ({
    ...edge,
    id: namespaceId(namespace, `edge:${index}`),
    source: namespaceId(namespace, edge.source),
    sourceId: edge.source,
    target: namespaceId(namespace, edge.target),
    targetId: edge.target,
  }));
  const layers = graph.layers.map((layer) => ({
    ...layer,
    id: namespaceId(namespace, layer.id),
    nodeIds: layer.nodeIds.map((nodeId) => namespaceId(namespace, nodeId)),
    sourceId: layer.id,
  }));
  const tour = graph.tour.map((step) => ({
    ...step,
    nodeIds: step.nodeIds.map((nodeId) => namespaceId(namespace, nodeId)),
  }));
  const snapshot = {
    commitSha,
    contentHash: hash(sourceBytes),
    generatedAt: new Date().toISOString(),
    kind: "codebase",
    layers,
    namespace,
    nodes,
    project: graph.project,
    repoId,
    schemaVersion: SNAPSHOT_SCHEMA,
    source: {
      graphVersion: string(graph.version),
      path: normalizePath(path.relative(repoRoot, graphPath)),
      provider: "understand-anything",
    },
    tour,
    edges,
  };

  if (write) {
    const outputRoot = path.join(repoRoot, ".nodeagent", "code-graph");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(
      path.join(outputRoot, "understand-anything.snapshot.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
  return snapshot;
}

export async function readUnderstandAnythingCodeGraph(repoRoot, { snapshotPath } = {}) {
  const relative = snapshotPath ?? ".nodeagent/code-graph/understand-anything.snapshot.json";
  const resolved = containedPath(repoRoot, relative, "code graph snapshot");
  if (!(await pathExists(resolved.absolute))) throw new Error(`code graph snapshot is missing: ${resolved.relative}`);
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(resolved.absolute, "utf8"));
  } catch {
    throw new Error(`code graph snapshot is invalid JSON: ${resolved.relative}`);
  }
  if (snapshot?.schemaVersion !== SNAPSHOT_SCHEMA || snapshot?.kind !== "codebase") {
    throw new Error(`code graph snapshot has an unsupported schema: ${resolved.relative}`);
  }
  return snapshot;
}

export function queryUnderstandAnythingCodeGraph(snapshot, query, { limit = 8 } = {}) {
  const terms = normalizeTerms(query);
  const matched = snapshot.nodes
    .map((node) => ({ node, score: scoreNode(node, terms) }))
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score || left.node.name.localeCompare(right.node.name))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 50)));
  const nodeIds = new Set(matched.map((entry) => entry.node.id));
  const edges = snapshot.edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
  return {
    edges,
    matched: matched.map(({ node, score }) => ({ node, score })),
    query: String(query ?? ""),
    schemaVersion: "nodekit.code-graph-query/v1",
    source: {
      commitSha: snapshot.commitSha,
      contentHash: snapshot.contentHash,
      repoId: snapshot.repoId,
    },
  };
}
