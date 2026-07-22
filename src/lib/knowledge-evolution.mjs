import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath, pathExists } from "./files.mjs";

export const KNOWLEDGE_GRAPH_SCHEMA = "nodekit.knowledge-graph/v1";
export const KNOWLEDGE_PATCH_SCHEMA = "nodekit.graph-patch/v1";
export const KNOWLEDGE_ACTION_SCHEMA = "nodekit.knowledge-action-receipt/v1";
export const KNOWLEDGE_STATE_SCHEMA = "nodekit.knowledge-state/v1";

export const KNOWLEDGE_LAYERS = Object.freeze([
  "source",
  "derived",
  "working",
  "proposal",
  "canonical",
  "hypothesis",
]);

const DEFAULT_GRAPH_PATH = ".nodeagent/knowledge/graph.json";
const PATCH_STATUSES = new Set(["pending", "accepted", "rejected", "conflicted", "applied"]);
const OPERATION_TYPES = new Set(["INSERT", "UPDATE", "DEPRECATE"]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clone(value) {
  return structuredClone(value);
}

function containedPath(repoRoot, candidate = DEFAULT_GRAPH_PATH) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, String(candidate));
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`knowledge graph path must stay inside the repository: ${candidate}`);
  }
  return { absolute, relative: normalizePath(relative) };
}

function graphPayload(graph) {
  const copy = clone(graph);
  delete copy.contentHash;
  return copy;
}

function graphHash(graph) {
  return digest(graphPayload(graph));
}

export function createMemoryKnowledgeGraphAdapter(initialGraph) {
  let current = initialGraph ? clone(initialGraph) : null;
  return {
    id: "memory",
    capabilities: {
      atomicCompareAndSwap: true,
      durable: false,
      nativeHypergraphTraversal: false,
      reactiveSubscriptions: false,
    },
    async readGraph() {
      if (!current) throw new Error("memory knowledge graph is not initialized");
      return clone(current);
    },
    async initializeGraph(graph) {
      if (current) return clone(current);
      const errors = validateKnowledgeGraphDocument(graph);
      if (errors.length) throw new Error(`memory knowledge graph validation failed:\n${errors.join("\n")}`);
      current = clone(graph);
      return clone(current);
    },
    async compareAndSwap(expectedVersion, nextGraph) {
      if (!current) throw new Error("memory knowledge graph is not initialized");
      if (current.version !== expectedVersion) return { applied: false, actualVersion: current.version };
      const errors = validateKnowledgeGraphDocument(nextGraph);
      if (errors.length) throw new Error(`memory knowledge graph validation failed:\n${errors.join("\n")}`);
      current = clone(nextGraph);
      return { applied: true, actualVersion: current.version, graph: clone(current) };
    },
    async exportDocument() {
      if (!current) throw new Error("memory knowledge graph is not initialized");
      return `${JSON.stringify(current, null, 2)}\n`;
    },
  };
}

export function createFileKnowledgeGraphAdapter(repoRoot, { graphPath } = {}) {
  return {
    id: "file",
    capabilities: {
      atomicCompareAndSwap: false,
      durable: true,
      nativeHypergraphTraversal: false,
      reactiveSubscriptions: false,
    },
    readGraph: () => readKnowledgeGraph(repoRoot, { graphPath }),
    initializeGraph: (options = {}) => initializeKnowledgeGraph(repoRoot, { ...options, graphPath }),
    async compareAndSwap(expectedVersion, nextGraph) {
      const current = await readKnowledgeGraph(repoRoot, { graphPath });
      if (current.version !== expectedVersion) return { applied: false, actualVersion: current.version };
      await persistKnowledgeGraph(repoRoot, clone(nextGraph), { graphPath });
      return { applied: true, actualVersion: nextGraph.version, graph: clone(nextGraph) };
    },
    async exportDocument() {
      return `${JSON.stringify(await readKnowledgeGraph(repoRoot, { graphPath }), null, 2)}\n`;
    },
  };
}

function canonicalStateHash(graph) {
  return digest({
    graphId: graph.graphId,
    version: graph.version,
    nodes: graph.nodes,
    hyperedges: graph.hyperedges,
  });
}

function entityMap(graph) {
  return new Map([...graph.nodes, ...graph.hyperedges].map((entity) => [entity.id, entity]));
}

function patchIdFor(patch) {
  return `patch_${digest({
    baseVersion: patch.baseVersion,
    contradictionRefs: patch.contradictionRefs ?? [],
    evidenceRefs: patch.evidenceRefs ?? [],
    graphId: patch.graphId,
    operations: patch.operations,
    proposedBy: patch.proposedBy,
  }).slice(0, 20)}`;
}

function validateEvidenceNode(node, label) {
  const errors = [];
  if (!nonEmpty(node.contentHash) || !/^[a-f0-9]{64}$/.test(node.contentHash)) {
    errors.push(`${label} evidence anchor requires a sha256 contentHash`);
  }
  if (!nonEmpty(node.sourceUri)) errors.push(`${label} evidence anchor requires sourceUri`);
  if (!nonEmpty(node.capturedAt) || Number.isNaN(Date.parse(node.capturedAt))) {
    errors.push(`${label} evidence anchor requires capturedAt`);
  }
  if (node.region) {
    for (const field of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(node.region[field]) || node.region[field] < 0) errors.push(`${label} region.${field} must be non-negative`);
    }
  }
  if (node.timeRange && (!Number.isFinite(node.timeRange.startMs) || !Number.isFinite(node.timeRange.endMs) || node.timeRange.startMs < 0 || node.timeRange.endMs < node.timeRange.startMs)) {
    errors.push(`${label} timeRange must be ordered non-negative milliseconds`);
  }
  return errors;
}

function validateNode(node, label = "node") {
  const errors = [];
  if (!node || typeof node !== "object" || Array.isArray(node)) return [`${label} must be an object`];
  if (!nonEmpty(node.id)) errors.push(`${label}.id is required`);
  if (!nonEmpty(node.kind)) errors.push(`${label}.kind is required`);
  if (!nonEmpty(node.label)) errors.push(`${label}.label is required`);
  if (!KNOWLEDGE_LAYERS.includes(node.layer)) errors.push(`${label}.layer is invalid`);
  if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) errors.push(`${label}.confidence must be between 0 and 1`);
  if (!Array.isArray(node.evidenceRefs)) errors.push(`${label}.evidenceRefs must be an array`);
  if (node.kind === "evidence") errors.push(...validateEvidenceNode(node, label));
  return errors;
}

function validateHyperedge(edge, label = "hyperedge") {
  const errors = [];
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) return [`${label} must be an object`];
  if (!nonEmpty(edge.id)) errors.push(`${label}.id is required`);
  if (!nonEmpty(edge.predicate)) errors.push(`${label}.predicate is required`);
  if (!KNOWLEDGE_LAYERS.includes(edge.layer)) errors.push(`${label}.layer is invalid`);
  if (!Array.isArray(edge.participants) || edge.participants.length < 2) errors.push(`${label}.participants requires at least two entries`);
  for (const [index, participant] of (edge.participants ?? []).entries()) {
    if (!nonEmpty(participant?.nodeId) || !nonEmpty(participant?.role)) errors.push(`${label}.participants[${index}] requires nodeId and role`);
  }
  if (!Number.isFinite(edge.confidence) || edge.confidence < 0 || edge.confidence > 1) errors.push(`${label}.confidence must be between 0 and 1`);
  if (!Array.isArray(edge.evidenceRefs)) errors.push(`${label}.evidenceRefs must be an array`);
  return errors;
}

export function validateKnowledgeGraphDocument(graph) {
  const errors = [];
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return ["knowledge graph must be an object"];
  if (graph.schemaVersion !== KNOWLEDGE_GRAPH_SCHEMA) errors.push(`schemaVersion must be ${KNOWLEDGE_GRAPH_SCHEMA}`);
  if (!nonEmpty(graph.graphId)) errors.push("graphId is required");
  if (!Number.isInteger(graph.version) || graph.version < 0) errors.push("version must be a non-negative integer");
  for (const collection of ["nodes", "hyperedges", "proposals", "actionReceipts", "evolutionReceipts"]) {
    if (!Array.isArray(graph[collection])) errors.push(`${collection} must be an array`);
  }
  if (!graph.authority || graph.authority.canonicalMutation !== "accepted-patch-only") {
    errors.push("authority.canonicalMutation must be accepted-patch-only");
  }
  const ids = new Set();
  for (const [index, node] of (graph.nodes ?? []).entries()) {
    errors.push(...validateNode(node, `nodes[${index}]`));
    if (ids.has(node?.id)) errors.push(`duplicate entity id ${node.id}`);
    ids.add(node?.id);
  }
  for (const [index, edge] of (graph.hyperedges ?? []).entries()) {
    errors.push(...validateHyperedge(edge, `hyperedges[${index}]`));
    if (ids.has(edge?.id)) errors.push(`duplicate entity id ${edge.id}`);
    ids.add(edge?.id);
  }
  for (const [index, edge] of (graph.hyperedges ?? []).entries()) {
    for (const participant of edge.participants ?? []) if (!ids.has(participant.nodeId)) errors.push(`hyperedges[${index}] references missing node ${participant.nodeId}`);
  }
  if (nonEmpty(graph.contentHash) && graph.contentHash !== graphHash(graph)) errors.push("contentHash does not match graph content");
  return errors;
}

export async function initializeKnowledgeGraph(repoRoot, {
  graphId = `knowledge:${path.basename(path.resolve(repoRoot))}`,
  graphPath,
  write = true,
} = {}) {
  const resolved = containedPath(repoRoot, graphPath);
  if (await pathExists(resolved.absolute)) return readKnowledgeGraph(repoRoot, { graphPath });
  const createdAt = now();
  const graph = {
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA,
    graphId,
    version: 0,
    authority: {
      canonicalMutation: "accepted-patch-only",
      destructiveDelete: false,
      oneAuthoritativeGraph: true,
    },
    layers: KNOWLEDGE_LAYERS.map((id) => ({ id, writableThrough: id === "source" ? "ingest-proposal" : "graph-patch" })),
    nodes: [],
    hyperedges: [],
    proposals: [],
    actionReceipts: [],
    evolutionReceipts: [],
    genesis: { createdAt, graphId },
    createdAt,
    updatedAt: createdAt,
  };
  graph.contentHash = graphHash(graph);
  if (write) {
    await mkdir(path.dirname(resolved.absolute), { recursive: true });
    await writeFile(resolved.absolute, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  }
  return graph;
}

export async function readKnowledgeGraph(repoRoot, { graphPath } = {}) {
  const resolved = containedPath(repoRoot, graphPath);
  if (!(await pathExists(resolved.absolute))) throw new Error(`knowledge graph is missing: ${resolved.relative}; run nodekit graph init`);
  let graph;
  try {
    graph = JSON.parse(await readFile(resolved.absolute, "utf8"));
  } catch (error) {
    throw new Error(`knowledge graph is invalid JSON: ${resolved.relative}: ${error.message}`);
  }
  const errors = validateKnowledgeGraphDocument(graph);
  if (errors.length) throw new Error(`knowledge graph validation failed:\n${errors.join("\n")}`);
  return graph;
}

async function persistKnowledgeGraph(repoRoot, graph, { graphPath } = {}) {
  graph.updatedAt = now();
  graph.contentHash = graphHash(graph);
  const resolved = containedPath(repoRoot, graphPath);
  await mkdir(path.dirname(resolved.absolute), { recursive: true });
  await writeFile(resolved.absolute, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return graph;
}

export function validateGraphPatchShape(patch) {
  const errors = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return ["graph patch must be an object"];
  if (patch.schemaVersion !== KNOWLEDGE_PATCH_SCHEMA) errors.push(`schemaVersion must be ${KNOWLEDGE_PATCH_SCHEMA}`);
  if (!nonEmpty(patch.patchId)) errors.push("patchId is required");
  if (!nonEmpty(patch.graphId)) errors.push("graphId is required");
  if (!Number.isInteger(patch.baseVersion) || patch.baseVersion < 0) errors.push("baseVersion must be a non-negative integer");
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) errors.push("operations must be non-empty");
  if (!Array.isArray(patch.evidenceRefs)) errors.push("evidenceRefs must be an array");
  if (!Array.isArray(patch.contradictionRefs)) errors.push("contradictionRefs must be an array");
  if (!patch.proposedBy || !["agentId", "modelRoute", "resolvedModel", "harnessVersion"].every((key) => nonEmpty(patch.proposedBy[key]))) {
    errors.push("proposedBy requires agentId, modelRoute, resolvedModel, and harnessVersion");
  }
  if (!Number.isFinite(patch.confidence) || patch.confidence < 0 || patch.confidence > 1) errors.push("confidence must be between 0 and 1");
  if (!PATCH_STATUSES.has(patch.status)) errors.push("status is invalid");
  for (const [index, operation] of (patch.operations ?? []).entries()) {
    if (!OPERATION_TYPES.has(operation?.type)) errors.push(`operations[${index}].type is invalid`);
    if (operation?.type === "INSERT") {
      if (Boolean(operation.node) === Boolean(operation.hyperedge)) errors.push(`operations[${index}] INSERT requires exactly one node or hyperedge`);
      if (operation.node) errors.push(...validateNode(operation.node, `operations[${index}].node`));
      if (operation.hyperedge) errors.push(...validateHyperedge(operation.hyperedge, `operations[${index}].hyperedge`));
    }
    if (operation?.type === "UPDATE" && (!nonEmpty(operation.targetId) || !operation.patch || typeof operation.patch !== "object" || Array.isArray(operation.patch))) {
      errors.push(`operations[${index}] UPDATE requires targetId and object patch`);
    }
    if (operation?.type === "DEPRECATE" && (!nonEmpty(operation.targetId) || !nonEmpty(operation.reason))) {
      errors.push(`operations[${index}] DEPRECATE requires targetId and reason`);
    }
  }
  return errors;
}

export async function proposeGraphPatch(repoRoot, input, { graphPath, write = true } = {}) {
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const patch = {
    schemaVersion: KNOWLEDGE_PATCH_SCHEMA,
    graphId: input.graphId ?? graph.graphId,
    baseVersion: input.baseVersion ?? graph.version,
    operations: clone(input.operations ?? []),
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
    contradictionRefs: [...new Set(input.contradictionRefs ?? [])],
    proposedBy: clone(input.proposedBy ?? {}),
    confidence: input.confidence ?? 0,
    validation: {
      sourceGrounded: false,
      schemaValid: false,
      authorityValid: false,
      conflictFree: false,
      freshnessValid: false,
      errors: [],
    },
    status: "pending",
    proposedAt: input.proposedAt ?? now(),
  };
  patch.patchId = input.patchId ?? patchIdFor(patch);
  const errors = validateGraphPatchShape(patch);
  if (errors.length) throw new Error(`graph patch proposal is invalid:\n${errors.join("\n")}`);
  if (graph.proposals.some((entry) => entry.patchId === patch.patchId)) throw new Error(`graph patch already exists: ${patch.patchId}`);
  graph.proposals.push(patch);
  if (write) await persistKnowledgeGraph(repoRoot, graph, { graphPath });
  return patch;
}

function evidenceRefsForOperation(operation, patch) {
  const entity = operation.node ?? operation.hyperedge;
  return [...new Set([...(patch.evidenceRefs ?? []), ...(entity?.evidenceRefs ?? []), ...(operation.evidenceRefs ?? [])])];
}

function validatePatchAgainstGraph(graph, patch) {
  const errors = validateGraphPatchShape(patch);
  const entities = entityMap(graph);
  const inserts = new Map();
  for (const operation of patch.operations) {
    if (operation.type === "INSERT") {
      const entity = operation.node ?? operation.hyperedge;
      if (entities.has(entity.id) || inserts.has(entity.id)) errors.push(`INSERT target already exists: ${entity.id}`);
      inserts.set(entity.id, entity);
    }
  }
  const available = new Map([...entities, ...inserts]);
  for (const [index, operation] of patch.operations.entries()) {
    if (operation.type === "INSERT" && operation.hyperedge) {
      for (const participant of operation.hyperedge.participants) if (!available.has(participant.nodeId)) errors.push(`operations[${index}] references missing participant ${participant.nodeId}`);
    }
    if (["UPDATE", "DEPRECATE"].includes(operation.type)) {
      const target = entities.get(operation.targetId);
      if (!target) errors.push(`${operation.type} target does not exist: ${operation.targetId}`);
      if (target?.layer === "source") errors.push(`${operation.type} cannot mutate immutable source entity ${operation.targetId}`);
      if (operation.type === "UPDATE" && ("id" in operation.patch || "createdAt" in operation.patch)) errors.push(`UPDATE cannot change identity fields for ${operation.targetId}`);
    }
    const entity = operation.node ?? operation.hyperedge;
    const refs = evidenceRefsForOperation(operation, patch);
    const selfGroundedSource = operation.type === "INSERT" && entity?.kind === "evidence" && validateEvidenceNode(entity, entity.id).length === 0;
    const refsGrounded = refs.length > 0 && refs.every((reference) => {
      const evidence = available.get(reference);
      return evidence?.kind === "evidence" && evidence.layer === "source" && !evidence.deprecatedAt;
    });
    if (!selfGroundedSource && !refsGrounded) errors.push(`operations[${index}] is not grounded in immutable source evidence`);
  }
  for (const reference of patch.contradictionRefs) if (!available.has(reference)) errors.push(`contradiction reference does not exist: ${reference}`);
  const freshnessErrors = [...available.values()]
    .filter((entity) => evidenceRefsForOperation({ node: entity }, patch).includes(entity.id))
    .filter((entity) => entity.freshness?.expiresAt && Date.parse(entity.freshness.expiresAt) <= Date.now())
    .map((entity) => `evidence is stale: ${entity.id}`);
  errors.push(...freshnessErrors);
  const shapeErrors = validateGraphPatchShape(patch);
  return {
    sourceGrounded: !errors.some((entry) => entry.includes("grounded") || entry.includes("evidence is stale")),
    schemaValid: shapeErrors.length === 0,
    authorityValid: patch.graphId === graph.graphId && graph.authority.canonicalMutation === "accepted-patch-only",
    conflictFree: patch.baseVersion === graph.version && !errors.some((entry) => entry.includes("already exists") || entry.includes("does not exist")),
    freshnessValid: freshnessErrors.length === 0,
    errors: [...new Set(errors)],
  };
}

export async function validateGraphPatch(repoRoot, patchId, { graphPath, write = true } = {}) {
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const patch = graph.proposals.find((entry) => entry.patchId === patchId);
  if (!patch) throw new Error(`graph patch not found: ${patchId}`);
  if (["rejected", "applied"].includes(patch.status)) throw new Error(`graph patch cannot be validated from status ${patch.status}`);
  patch.validation = validatePatchAgainstGraph(graph, patch);
  patch.validatedAt = now();
  if (patch.baseVersion !== graph.version) patch.status = "conflicted";
  else if (patch.status === "conflicted") patch.status = "pending";
  if (write) await persistKnowledgeGraph(repoRoot, graph, { graphPath });
  return clone(patch);
}

export async function decideGraphPatch(repoRoot, patchId, {
  decision,
  principalId,
  reason,
  graphPath,
} = {}) {
  if (!nonEmpty(principalId)) throw new Error("graph patch decision requires principalId");
  if (!["accept", "reject"].includes(decision)) throw new Error("graph patch decision must be accept or reject");
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const patch = graph.proposals.find((entry) => entry.patchId === patchId);
  if (!patch) throw new Error(`graph patch not found: ${patchId}`);
  if (patch.status !== "pending") throw new Error(`graph patch decision requires pending status, got ${patch.status}`);
  patch.validation = validatePatchAgainstGraph(graph, patch);
  if (decision === "accept" && (!Object.entries(patch.validation).filter(([key]) => key !== "errors").every(([, value]) => value) || patch.validation.errors.length)) {
    throw new Error(`graph patch failed validation:\n${patch.validation.errors.join("\n")}`);
  }
  patch.status = decision === "accept" ? "accepted" : "rejected";
  patch.decision = { decision, principalId, reason: String(reason ?? ""), decidedAt: now() };
  await persistKnowledgeGraph(repoRoot, graph, { graphPath });
  return clone(patch);
}

function applyOperation(graph, operation, timestamp) {
  if (operation.type === "INSERT") {
    const entity = clone(operation.node ?? operation.hyperedge);
    entity.createdAt ??= timestamp;
    entity.updatedAt ??= timestamp;
    if (operation.node) graph.nodes.push(entity);
    else graph.hyperedges.push(entity);
    return;
  }
  const collections = [graph.nodes, graph.hyperedges];
  const collection = collections.find((entries) => entries.some((entry) => entry.id === operation.targetId));
  const index = collection.findIndex((entry) => entry.id === operation.targetId);
  if (operation.type === "UPDATE") {
    collection[index] = { ...collection[index], ...clone(operation.patch), updatedAt: timestamp };
    return;
  }
  collection[index] = {
    ...collection[index],
    deprecatedAt: timestamp,
    deprecationReason: operation.reason,
    updatedAt: timestamp,
  };
}

export async function applyGraphPatch(repoRoot, patchId, { graphPath } = {}) {
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const patch = graph.proposals.find((entry) => entry.patchId === patchId);
  if (!patch) throw new Error(`graph patch not found: ${patchId}`);
  if (patch.status !== "accepted") throw new Error(`only accepted graph patches can apply; got ${patch.status}`);
  if (patch.baseVersion !== graph.version) {
    patch.status = "conflicted";
    await persistKnowledgeGraph(repoRoot, graph, { graphPath });
    throw new Error(`stale graph patch baseVersion ${patch.baseVersion}; canonical version is ${graph.version}`);
  }
  const validation = validatePatchAgainstGraph(graph, patch);
  if (validation.errors.length) throw new Error(`accepted graph patch no longer validates:\n${validation.errors.join("\n")}`);
  const beforeHash = canonicalStateHash(graph);
  const appliedAt = now();
  for (const operation of patch.operations) applyOperation(graph, operation, appliedAt);
  const fromVersion = graph.version;
  graph.version += 1;
  patch.status = "applied";
  patch.appliedAt = appliedAt;
  const receipt = {
    schemaVersion: "nodekit.graph-evolution-receipt/v1",
    receiptId: `graph_receipt_${digest({ patchId, fromVersion, appliedAt }).slice(0, 20)}`,
    graphId: graph.graphId,
    patchId,
    fromVersion,
    toVersion: graph.version,
    beforeHash,
    afterHash: canonicalStateHash(graph),
    operations: clone(patch.operations),
    evidenceRefs: clone(patch.evidenceRefs),
    decision: clone(patch.decision),
    appliedAt,
  };
  graph.evolutionReceipts.push(receipt);
  await persistKnowledgeGraph(repoRoot, graph, { graphPath });
  return { graph: clone(graph), receipt: clone(receipt) };
}

export async function recordKnowledgeAction(repoRoot, action, { graphPath } = {}) {
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const allowed = new Set(["GRAPH_RETRIEVE", "EXTERNAL_RESEARCH", "PROPOSE_GRAPH_PATCH", "INSPECT_ARTIFACT", "EXECUTE_TOOL", "REQUEST_APPROVAL", "COMPLETE", "ABSTAIN"]);
  if (!allowed.has(action?.type)) throw new Error(`unsupported knowledge action: ${action?.type}`);
  const receipt = {
    schemaVersion: KNOWLEDGE_ACTION_SCHEMA,
    receiptId: action.receiptId ?? `knowledge_action_${digest({ action, graphVersion: graph.version, at: now() }).slice(0, 20)}`,
    graphId: graph.graphId,
    graphVersion: graph.version,
    runId: String(action.runId ?? ""),
    caseId: String(action.caseId ?? ""),
    actorId: String(action.actorId ?? ""),
    type: action.type,
    input: clone(action.input ?? {}),
    outputRefs: [...new Set(action.outputRefs ?? [])],
    evidenceRefs: [...new Set(action.evidenceRefs ?? [])],
    budget: clone(action.budget ?? {}),
    status: action.status ?? "completed",
    occurredAt: action.occurredAt ?? now(),
  };
  graph.actionReceipts.push(receipt);
  await persistKnowledgeGraph(repoRoot, graph, { graphPath });
  return receipt;
}

function normalizeTerms(query) {
  return String(query ?? "").toLowerCase().split(/[^a-z0-9_/-]+/).filter((term) => term.length > 1);
}

function entityScore(entity, terms) {
  if (!terms.length) return 1;
  const text = canonical({
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    predicate: entity.predicate,
    properties: entity.properties,
    participants: entity.participants,
  }).toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? (String(entity.label ?? entity.predicate ?? "").toLowerCase().includes(term) ? 8 : 2) : 0), 0);
}

export function queryKnowledgeGraph(graph, query, { limit = 12, layers = ["canonical", "working", "source", "hypothesis", "derived"] } = {}) {
  const terms = normalizeTerms(query);
  const allowedLayers = new Set(layers);
  const entities = [...graph.nodes, ...graph.hyperedges]
    .filter((entity) => allowedLayers.has(entity.layer) && !entity.deprecatedAt)
    .map((entity) => ({ entity, score: entityScore(entity, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.entity.id.localeCompare(right.entity.id))
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 100)));
  const selectedIds = new Set(entities.map((entry) => entry.entity.id));
  const supportingHyperedges = graph.hyperedges.filter((edge) => !edge.deprecatedAt && edge.participants.some((participant) => selectedIds.has(participant.nodeId)));
  return {
    schemaVersion: "nodekit.knowledge-query/v1",
    graphId: graph.graphId,
    graphVersion: graph.version,
    query: String(query ?? ""),
    results: entities,
    supportingHyperedges,
  };
}

export function inspectKnowledgeGaps(graph, { at = Date.now() } = {}) {
  const unresolved = graph.nodes.filter((node) => !node.deprecatedAt && ["question", "contradiction", "gap"].includes(node.kind));
  const unsupported = graph.nodes.filter((node) => !node.deprecatedAt && node.kind !== "evidence" && node.layer !== "hypothesis" && (node.evidenceRefs?.length ?? 0) === 0);
  const staleEvidence = graph.nodes.filter((node) => node.kind === "evidence" && node.freshness?.expiresAt && Date.parse(node.freshness.expiresAt) <= at);
  const pendingPatches = graph.proposals.filter((patch) => ["pending", "conflicted"].includes(patch.status));
  return {
    schemaVersion: "nodekit.knowledge-gaps/v1",
    graphId: graph.graphId,
    graphVersion: graph.version,
    pendingPatches,
    staleEvidence,
    unresolved,
    unsupported,
  };
}

export function diffKnowledgeGraph(graph, fromVersion, toVersion = graph.version) {
  const from = Number(fromVersion);
  const to = Number(toVersion);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > graph.version) throw new Error(`invalid graph diff range ${fromVersion}..${toVersion}`);
  const receipts = graph.evolutionReceipts.filter((receipt) => receipt.fromVersion >= from && receipt.toVersion <= to);
  return {
    schemaVersion: "nodekit.knowledge-diff/v1",
    graphId: graph.graphId,
    fromVersion: from,
    toVersion: to,
    patchIds: receipts.map((receipt) => receipt.patchId),
    operations: receipts.flatMap((receipt) => receipt.operations.map((operation) => ({ patchId: receipt.patchId, ...operation }))),
    receipts: receipts.map(({ operations, ...receipt }) => receipt),
  };
}

export function replayKnowledgeGraph(graph, targetVersion = graph.version) {
  const target = Number(targetVersion);
  if (!Number.isInteger(target) || target < 0 || target > graph.version) throw new Error(`invalid replay target version ${targetVersion}`);
  const replayed = {
    ...clone(graph),
    version: 0,
    nodes: [],
    hyperedges: [],
    proposals: [],
    actionReceipts: graph.actionReceipts.filter((receipt) => receipt.graphVersion <= target),
    evolutionReceipts: [],
    contentHash: "",
  };
  for (const receipt of graph.evolutionReceipts.filter((entry) => entry.toVersion <= target).sort((a, b) => a.toVersion - b.toVersion)) {
    for (const operation of receipt.operations) applyOperation(replayed, operation, receipt.appliedAt);
    replayed.version = receipt.toVersion;
    replayed.evolutionReceipts.push(clone(receipt));
  }
  replayed.proposals = graph.proposals.filter((patch) => patch.status === "applied" && patch.appliedAt && graph.evolutionReceipts.some((receipt) => receipt.patchId === patch.patchId && receipt.toVersion <= target));
  replayed.contentHash = graphHash(replayed);
  return replayed;
}

export function benchmarkKnowledgeRetrieval(graph, cases, { limit = 8 } = {}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("knowledge benchmark requires non-empty cases");
  const profiles = {
    flat: KNOWLEDGE_LAYERS,
    staticGraph: ["source", "canonical"],
    evolvingGraph: ["source", "derived", "working", "canonical", "hypothesis"],
  };
  const results = {};
  for (const [profile, layers] of Object.entries(profiles)) {
    const evaluations = cases.map((entry) => {
      const output = queryKnowledgeGraph(graph, entry.query, { limit, layers });
      const returned = new Set(output.results.map((result) => result.entity.id));
      const expected = [...new Set(entry.expectedEntityIds ?? [])];
      const hits = expected.filter((id) => returned.has(id));
      return { caseId: entry.caseId, expected, returned: [...returned], recall: expected.length ? hits.length / expected.length : 1 };
    });
    results[profile] = {
      averageRecall: evaluations.reduce((sum, entry) => sum + entry.recall, 0) / evaluations.length,
      cases: evaluations,
    };
  }
  return {
    schemaVersion: "nodekit.knowledge-benchmark/v1",
    graphId: graph.graphId,
    graphVersion: graph.version,
    ablations: {
      insert: graph.evolutionReceipts.some((receipt) => receipt.operations.some((operation) => operation.type === "INSERT")),
      update: graph.evolutionReceipts.some((receipt) => receipt.operations.some((operation) => operation.type === "UPDATE")),
      deprecate: graph.evolutionReceipts.some((receipt) => receipt.operations.some((operation) => operation.type === "DEPRECATE")),
      externalResearch: graph.actionReceipts.some((receipt) => receipt.type === "EXTERNAL_RESEARCH"),
    },
    results,
  };
}

export function createKnowledgeState(graph, input = {}) {
  return {
    schemaVersion: KNOWLEDGE_STATE_SCHEMA,
    caseId: String(input.caseId ?? ""),
    runId: String(input.runId ?? ""),
    goal: String(input.goal ?? ""),
    graphId: graph.graphId,
    graphVersion: graph.version,
    selectedSubgraphIds: [...new Set(input.selectedSubgraphIds ?? [])],
    actionHistory: clone(input.actionHistory ?? graph.actionReceipts),
    currentArtifactIds: [...new Set(input.currentArtifactIds ?? [])],
    currentTaskIds: [...new Set(input.currentTaskIds ?? [])],
    unresolvedQuestionIds: graph.nodes.filter((node) => node.kind === "question" && !node.deprecatedAt).map((node) => node.id),
    contradictionIds: graph.nodes.filter((node) => node.kind === "contradiction" && !node.deprecatedAt).map((node) => node.id),
    permissions: clone(input.permissions ?? { retrieve: true, propose: true, apply: false }),
    budget: clone(input.budget ?? { maximumGraphEdits: 10, maximumSearches: 3, maximumToolCalls: 20, maximumTokens: 20_000 }),
  };
}
