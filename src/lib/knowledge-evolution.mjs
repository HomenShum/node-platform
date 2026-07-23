import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { verifyEvidenceGraphNode } from "./evidence-snapshots.mjs";
import { normalizePath } from "./files.mjs";

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
const KNOWLEDGE_ACTION_TYPES = new Set(["GRAPH_RETRIEVE", "EXTERNAL_RESEARCH", "PROPOSE_GRAPH_PATCH", "INSPECT_ARTIFACT", "EXECUTE_TOOL", "REQUEST_APPROVAL", "COMPLETE", "ABSTAIN"]);
const KNOWLEDGE_ACTION_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);
const GRAPH_LOCK_STALE_MS = 120_000;
const GRAPH_LOCK_WAIT_MS = 10_000;
const GRAPH_LOCK_RETRY_MS = 20;

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
  return { root, absolute, relative: normalizePath(relative) };
}

async function existingLstat(target, options) {
  try { return await lstat(target, options); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertSecureGraphPath(root, target, label, { includeLeaf = true } = {}) {
  const rootStatus = await lstat(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) throw new Error(`${label} repository root is not a regular directory`);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} escapes the repository`);
  const segments = relative ? relative.split(path.sep) : [];
  const end = includeLeaf ? segments.length : Math.max(0, segments.length - 1);
  let current = root;
  for (let index = 0; index < end; index += 1) {
    current = path.join(current, segments[index]);
    const status = await existingLstat(current);
    if (!status) continue;
    if (status.isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link: ${normalizePath(path.relative(root, current))}`);
    if (index < end - 1 && !status.isDirectory()) throw new Error(`${label} parent path is not a directory`);
  }
}

async function ensureSecureGraphDirectory(root, directory, label) {
  await assertSecureGraphPath(root, directory, label, { includeLeaf: false });
  const relative = path.relative(root, directory);
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const status = await existingLstat(current);
    if (status) {
      if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`${label} has an unsafe parent: ${normalizePath(path.relative(root, current))}`);
    } else {
      try { await mkdir(current); } catch (error) { if (error?.code !== "EEXIST") throw error; }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(`${label} directory creation was redirected`);
    }
  }
}

function sameGraphFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function stableGraphFile(repoRoot, graphPath, label, { maximumBytes = 64 * 1024 * 1024, targetOverride } = {}) {
  const resolved = containedPath(repoRoot, graphPath);
  const target = targetOverride ?? resolved.absolute;
  await assertSecureGraphPath(resolved.root ?? path.resolve(repoRoot), target, label);
  const root = path.resolve(repoRoot);
  const beforePath = await lstat(target, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.nlink !== 1n) throw new Error(`${label} must be one regular unaliased file`);
  if (beforePath.size > BigInt(maximumBytes)) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  const physicalBefore = await realpath(target);
  const physicalRelation = path.relative(root, physicalBefore);
  if (physicalRelation === ".." || physicalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelation)) throw new Error(`${label} resolves outside the repository`);
  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    try { handle = await open(target, fsConstants.O_RDONLY | noFollow); }
    catch (error) {
      if (!noFollow || !["EINVAL", "ENOTSUP", "UNKNOWN"].includes(error?.code)) throw error;
      handle = await open(target, "r");
    }
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n || !sameGraphFileIdentity(beforePath, openedBefore)) throw new Error(`${label} identity changed before read`);
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const afterPath = await lstat(target, { bigint: true });
    const physicalAfter = await realpath(target);
    if (!sameGraphFileIdentity(openedBefore, openedAfter) || !sameGraphFileIdentity(openedAfter, afterPath)
      || physicalBefore !== physicalAfter || bytes.length !== Number(openedAfter.size)) throw new Error(`${label} identity changed while reading`);
    return { bytes, resolved };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function graphPayload(graph) {
  const copy = clone(graph);
  delete copy.contentHash;
  return copy;
}

function graphHash(graph) {
  return digest(graphPayload(graph));
}

function processAppearsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function recoverStaleGraphLock(repoRoot, graphPath, lockPath) {
  let metadata;
  try {
    metadata = await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) throw new Error("knowledge graph mutation lock is not one regular file");
  if (Date.now() - metadata.mtimeMs < GRAPH_LOCK_STALE_MS) return false;
  let lock = null;
  try {
    lock = JSON.parse((await stableGraphFile(repoRoot, graphPath, "knowledge graph mutation lock", { targetOverride: lockPath, maximumBytes: 4096 })).bytes.toString("utf8"));
  } catch {
    // A process can fail between exclusive creation and writing its identity. Only
    // an old lock is recoverable, so a fresh partial lock remains fail-closed.
  }
  if (processAppearsAlive(lock?.pid)) return false;
  const stalePath = `${lockPath}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
  await rm(stalePath, { force: true });
  return true;
}

async function withGraphMutationLock(repoRoot, graphPath, operation) {
  const resolved = containedPath(repoRoot, graphPath);
  const lockPath = `${resolved.absolute}.mutation.lock`;
  const root = path.resolve(repoRoot);
  await ensureSecureGraphDirectory(root, path.dirname(lockPath), "knowledge graph mutation lock");
  const deadline = Date.now() + GRAPH_LOCK_WAIT_MS;
  let handle;
  const token = randomBytes(24).toString("hex");
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await recoverStaleGraphLock(repoRoot, graphPath, lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(`knowledge graph mutation lock timed out: ${resolved.relative}`);
      await new Promise((resolve) => setTimeout(resolve, GRAPH_LOCK_RETRY_MS));
    }
  }
  const identity = { acquiredAt: now(), graphPath: resolved.relative, pid: process.pid, token };
  await handle.writeFile(`${JSON.stringify(identity)}\n`, "utf8");
  await handle.sync();
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    try {
      const current = JSON.parse((await stableGraphFile(repoRoot, graphPath, "knowledge graph mutation lock", { targetOverride: lockPath, maximumBytes: 4096 })).bytes.toString("utf8"));
      if (current.token !== token) throw new Error(`knowledge graph mutation lock identity changed: ${resolved.relative}`);
      await rm(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function atomicWrite(repoRoot, target, bytes, { beforeAtomicRename } = {}) {
  const root = path.resolve(repoRoot);
  await ensureSecureGraphDirectory(root, path.dirname(target), "knowledge graph persistence");
  const parentBefore = await lstat(path.dirname(target), { bigint: true });
  const targetBefore = await existingLstat(target, { bigint: true });
  if (targetBefore && (targetBefore.isSymbolicLink() || !targetBefore.isFile() || targetBefore.nlink !== 1n)) {
    throw new Error("knowledge graph target must be one regular file");
  }
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (beforeAtomicRename) await beforeAtomicRename({ target, temporary });
    await assertSecureGraphPath(root, target, "knowledge graph persistence");
    const parentAfter = await lstat(path.dirname(target), { bigint: true });
    if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) throw new Error("knowledge graph parent identity changed before commit");
    const targetAfter = await existingLstat(target, { bigint: true });
    if (Boolean(targetBefore) !== Boolean(targetAfter)
      || (targetBefore && !sameGraphFileIdentity(targetBefore, targetAfter))) {
      throw new Error("knowledge graph target identity changed before commit");
    }
    await rename(temporary, target);
    try {
      const directory = await open(path.dirname(target), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      // Directory fsync is not supported on every Windows/filesystem combination.
      // The file bytes themselves were synced before the atomic replacement.
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
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

export function createFileKnowledgeGraphAdapter(repoRoot, { graphPath, beforeAtomicRename } = {}) {
  return {
    id: "file",
    capabilities: {
      atomicCompareAndSwap: true,
      durable: true,
      nativeHypergraphTraversal: false,
      reactiveSubscriptions: false,
    },
    readGraph: () => readKnowledgeGraph(repoRoot, { graphPath }),
    initializeGraph: (options = {}) => initializeKnowledgeGraph(repoRoot, { ...options, graphPath }),
    async compareAndSwap(expected, nextGraph) {
      return withGraphMutationLock(repoRoot, graphPath, async () => {
        const current = await readKnowledgeGraph(repoRoot, { graphPath });
        const expectedVersion = typeof expected === "number" ? expected : expected?.version;
        const expectedContentHash = typeof expected === "object" ? expected?.contentHash : null;
        if (current.version !== expectedVersion || (expectedContentHash && current.contentHash !== expectedContentHash)) {
          return { applied: false, actualVersion: current.version, actualContentHash: current.contentHash };
        }
        await persistKnowledgeGraph(repoRoot, clone(nextGraph), { graphPath, beforeAtomicRename });
        return { applied: true, actualVersion: nextGraph.version, actualContentHash: nextGraph.contentHash, graph: clone(nextGraph) };
      });
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

function evolutionReceiptBody(receipt) {
  const copy = clone(receipt);
  delete copy.receiptHash;
  return copy;
}

function actionReceiptBody(receipt) {
  const copy = clone(receipt);
  delete copy.receiptHash;
  return copy;
}

function actionReceiptRoot(receipts) {
  return digest((receipts ?? []).map((receipt) => receipt.receiptHash));
}

function validateStringList(value, label) {
  const errors = [];
  if (!Array.isArray(value)) return [`${label} must be an array`];
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    if (!nonEmpty(entry)) errors.push(`${label}[${index}] must be a non-empty string`);
    else if (seen.has(entry)) errors.push(`${label} contains duplicate value ${entry}`);
    else seen.add(entry);
  }
  return errors;
}

function validateActionHistory(graph) {
  const errors = [];
  const receipts = graph.actionReceipts ?? [];
  let previousReceiptHash = null;
  const receiptIds = new Set();
  for (const [index, receipt] of receipts.entries()) {
    const label = `actionReceipts[${index}]`;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (receipt.schemaVersion !== KNOWLEDGE_ACTION_SCHEMA) errors.push(`${label}.schemaVersion is invalid`);
    if (!nonEmpty(receipt.receiptId)) errors.push(`${label}.receiptId is required`);
    else if (receiptIds.has(receipt.receiptId)) errors.push(`${label}.receiptId is duplicated`);
    else receiptIds.add(receipt.receiptId);
    if (receipt.sequence !== index + 1) errors.push(`${label}.sequence must equal ${index + 1}`);
    if (receipt.previousReceiptHash !== previousReceiptHash) errors.push(`${label}.previousReceiptHash breaks the receipt chain`);
    if (!/^[a-f0-9]{64}$/u.test(receipt.receiptHash ?? "") || digest(actionReceiptBody(receipt)) !== receipt.receiptHash) {
      errors.push(`${label}.receiptHash does not match the receipt body`);
    }
    if (receipt.graphId !== graph.graphId) errors.push(`${label}.graphId does not match graphId`);
    if (!Number.isInteger(receipt.graphVersion) || receipt.graphVersion < 0 || receipt.graphVersion > graph.version) {
      errors.push(`${label}.graphVersion is outside the graph history`);
    }
    for (const field of ["runId", "caseId", "actorId"]) if (!nonEmpty(receipt[field])) errors.push(`${label}.${field} is required`);
    if (!KNOWLEDGE_ACTION_TYPES.has(receipt.type)) errors.push(`${label}.type is invalid`);
    if (!receipt.input || typeof receipt.input !== "object" || Array.isArray(receipt.input)) errors.push(`${label}.input must be an object`);
    errors.push(...validateStringList(receipt.outputRefs, `${label}.outputRefs`));
    errors.push(...validateStringList(receipt.evidenceRefs, `${label}.evidenceRefs`));
    if (!receipt.budget || typeof receipt.budget !== "object" || Array.isArray(receipt.budget)) errors.push(`${label}.budget must be an object`);
    if (!KNOWLEDGE_ACTION_STATUSES.has(receipt.status)) errors.push(`${label}.status is invalid`);
    if (!nonEmpty(receipt.occurredAt) || Number.isNaN(Date.parse(receipt.occurredAt))
      || new Date(Date.parse(receipt.occurredAt)).toISOString() !== receipt.occurredAt) {
      errors.push(`${label}.occurredAt must be canonical UTC ISO-8601`);
    }
    previousReceiptHash = receipt.receiptHash ?? null;
  }
  return errors;
}

function affectedEntityBindings(graph, operations) {
  const entities = entityMap(graph);
  const affectedIds = [...new Set((operations ?? []).map((operation) => (
    operation.node?.id ?? operation.hyperedge?.id ?? operation.targetId
  )).filter(Boolean))].sort();
  return affectedIds.map((entityId) => {
    const entity = entities.get(entityId);
    if (!entity) throw new Error(`evolution receipt affected entity is missing after apply: ${entityId}`);
    return { entityId, entityHash: digest(entity) };
  });
}

function validateEvolutionHistory(graph) {
  const errors = [];
  const receipts = graph.evolutionReceipts ?? [];
  const replayed = {
    graphId: graph.graphId,
    version: 0,
    nodes: [],
    hyperedges: [],
  };
  let previousReceiptHash = null;
  for (const [index, receipt] of receipts.entries()) {
    const label = `evolutionReceipts[${index}]`;
    if (receipt?.schemaVersion !== "nodekit.graph-evolution-receipt/v1") errors.push(`${label}.schemaVersion is invalid`);
    if (receipt?.graphId !== graph.graphId) errors.push(`${label}.graphId does not match graphId`);
    if (receipt?.decision?.decision !== "accept") errors.push(`${label} is not backed by an accepted decision`);
    if (receipt?.fromVersion !== replayed.version || receipt?.toVersion !== replayed.version + 1) {
      errors.push(`${label} does not advance the graph by exactly one version`);
    }
    if (receipt?.previousReceiptHash !== previousReceiptHash) errors.push(`${label}.previousReceiptHash breaks the receipt chain`);
    if (!/^[a-f0-9]{64}$/u.test(receipt?.receiptHash ?? "") || digest(evolutionReceiptBody(receipt)) !== receipt.receiptHash) {
      errors.push(`${label}.receiptHash does not match the receipt body`);
    }
    if (receipt?.beforeHash !== canonicalStateHash(replayed)) errors.push(`${label}.beforeHash does not match replayed canonical state`);
    if (!Number.isInteger(receipt?.actionReceiptCount) || receipt.actionReceiptCount < 0 || receipt.actionReceiptCount > (graph.actionReceipts ?? []).length) {
      errors.push(`${label}.actionReceiptCount is outside the action history`);
    } else if (receipt.actionReceiptRootHash !== actionReceiptRoot((graph.actionReceipts ?? []).slice(0, receipt.actionReceiptCount))) {
      errors.push(`${label}.actionReceiptRootHash does not bind the action-history prefix`);
    }
    try {
      for (const operation of receipt?.operations ?? []) applyOperation(replayed, operation, receipt.appliedAt);
      replayed.version = receipt.toVersion;
      if (receipt?.afterHash !== canonicalStateHash(replayed)) errors.push(`${label}.afterHash does not match replayed canonical state`);
      const expectedBindings = affectedEntityBindings(replayed, receipt?.operations ?? []);
      if (canonical(expectedBindings) !== canonical(receipt?.entityBindings ?? [])) {
        errors.push(`${label}.entityBindings do not bind the applied entity bytes`);
      }
    } catch (error) {
      errors.push(`${label} cannot be replayed: ${error.message}`);
    }
    previousReceiptHash = receipt?.receiptHash ?? null;
  }
  if (replayed.version !== graph.version || canonicalStateHash(replayed) !== canonicalStateHash(graph)) {
    errors.push("evolution receipt history does not reconstruct the canonical graph state");
  }
  return errors;
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
  if (node.layer === "source" && node.kind !== "evidence") errors.push(`${label} source layer is reserved for authenticated evidence nodes`);
  if (node.kind === "evidence" && node.layer !== "source") errors.push(`${label} evidence nodes must remain in the source layer`);
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
  if (edge.layer === "source") errors.push(`${label} source layer is reserved for authenticated evidence nodes`);
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
  if (!nonEmpty(graph.authority?.ownerId)) errors.push("authority.ownerId is required");
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
  if (Array.isArray(graph.actionReceipts)) errors.push(...validateActionHistory(graph));
  if (Array.isArray(graph.evolutionReceipts)) errors.push(...validateEvolutionHistory(graph));
  if (nonEmpty(graph.contentHash) && graph.contentHash !== graphHash(graph)) errors.push("contentHash does not match graph content");
  return errors;
}

export async function initializeKnowledgeGraph(repoRoot, {
  graphId = `knowledge:${path.basename(path.resolve(repoRoot))}`,
  graphPath,
  ownerId,
  write = true,
} = {}) {
  const resolved = containedPath(repoRoot, graphPath);
  const initialize = async () => {
    if (await existingLstat(resolved.absolute)) return readKnowledgeGraph(repoRoot, { graphPath });
    const createdAt = now();
    const graph = {
      schemaVersion: KNOWLEDGE_GRAPH_SCHEMA,
      graphId,
      version: 0,
      authority: {
        canonicalMutation: "accepted-patch-only",
        destructiveDelete: false,
        oneAuthoritativeGraph: true,
        ownerId: nonEmpty(ownerId) ? ownerId : `local:${graphId}`,
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
    if (write) await atomicWrite(repoRoot, resolved.absolute, Buffer.from(`${JSON.stringify(graph, null, 2)}\n`, "utf8"));
    return graph;
  };
  return write ? withGraphMutationLock(repoRoot, graphPath, initialize) : initialize();
}

export async function readKnowledgeGraph(repoRoot, { graphPath } = {}) {
  const resolved = containedPath(repoRoot, graphPath);
  if (!(await existingLstat(resolved.absolute))) throw new Error(`knowledge graph is missing: ${resolved.relative}; run nodekit graph init`);
  let graph;
  try {
    graph = JSON.parse((await stableGraphFile(repoRoot, graphPath, "knowledge graph")).bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`knowledge graph is invalid JSON: ${resolved.relative}: ${error.message}`);
  }
  const errors = validateKnowledgeGraphDocument(graph);
  if (errors.length) throw new Error(`knowledge graph validation failed:\n${errors.join("\n")}`);
  return graph;
}

async function persistKnowledgeGraph(repoRoot, graph, { graphPath, beforeAtomicRename } = {}) {
  graph.updatedAt = now();
  graph.contentHash = graphHash(graph);
  const errors = validateKnowledgeGraphDocument(graph);
  if (errors.length) throw new Error(`refusing to persist invalid knowledge graph:\n${errors.join("\n")}`);
  const resolved = containedPath(repoRoot, graphPath);
  await atomicWrite(repoRoot, resolved.absolute, Buffer.from(`${JSON.stringify(graph, null, 2)}\n`, "utf8"), { beforeAtomicRename });
  return graph;
}

export function validateGraphPatchShape(patch) {
  const errors = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return ["graph patch must be an object"];
  if (patch.schemaVersion !== KNOWLEDGE_PATCH_SCHEMA) errors.push(`schemaVersion must be ${KNOWLEDGE_PATCH_SCHEMA}`);
  if (!nonEmpty(patch.patchId)) errors.push("patchId is required");
  if (!nonEmpty(patch.graphId)) errors.push("graphId is required");
  if (!Number.isInteger(patch.baseVersion) || patch.baseVersion < 0) errors.push("baseVersion must be a non-negative integer");
  if (!/^[a-f0-9]{64}$/u.test(patch.baseCanonicalHash ?? "")) errors.push("baseCanonicalHash must be a sha256 hash");
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
    if (operation?.type === "UPDATE" && operation.patch?.layer === "source") {
      errors.push(`operations[${index}] UPDATE cannot promote an entity into the immutable source layer`);
    }
    if (operation?.type === "DEPRECATE" && (!nonEmpty(operation.targetId) || !nonEmpty(operation.reason))) {
      errors.push(`operations[${index}] DEPRECATE requires targetId and reason`);
    }
  }
  return errors;
}

export async function proposeGraphPatch(repoRoot, input, { graphPath, write = true } = {}) {
  const propose = async () => {
    const graph = await readKnowledgeGraph(repoRoot, { graphPath });
    const patch = {
    schemaVersion: KNOWLEDGE_PATCH_SCHEMA,
    graphId: input.graphId ?? graph.graphId,
    baseVersion: input.baseVersion ?? graph.version,
    baseCanonicalHash: input.baseCanonicalHash ?? canonicalStateHash(graph),
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
  };
  return write ? withGraphMutationLock(repoRoot, graphPath, propose) : propose();
}

function evidenceRefsForOperation(operation, patch) {
  const entity = operation.node ?? operation.hyperedge;
  return [...new Set([
    ...(patch.evidenceRefs ?? []),
    ...(entity?.evidenceRefs ?? []),
    ...(operation.evidenceRefs ?? []),
    ...(operation.type === "UPDATE" && Array.isArray(operation.patch?.evidenceRefs) ? operation.patch.evidenceRefs : []),
  ])];
}

async function validatePatchAgainstGraph(repoRoot, graph, patch) {
  const errors = validateGraphPatchShape(patch);
  const entities = entityMap(graph);
  const inserts = new Map();
  const evidenceAuthentication = new Map();
  const referencedEvidenceIds = new Set(patch.evidenceRefs ?? []);
  const validationAt = Date.now();
  for (const operation of patch.operations) {
    if (operation.type === "INSERT") {
      const entity = operation.node ?? operation.hyperedge;
      if (entities.has(entity.id) || inserts.has(entity.id)) errors.push(`INSERT target already exists: ${entity.id}`);
      inserts.set(entity.id, entity);
    }
  }
  const available = new Map([...entities, ...inserts]);
  const authenticateEvidence = async (evidence, label) => {
    if (!evidence || evidence.kind !== "evidence" || evidence.layer !== "source" || evidence.deprecatedAt) return false;
    if (!evidenceAuthentication.has(evidence.id)) {
      evidenceAuthentication.set(evidence.id, verifyEvidenceGraphNode(repoRoot, evidence, { at: validationAt })
        .then(() => ({ passed: true }))
        .catch((error) => ({ passed: false, error: error.message })));
    }
    const result = await evidenceAuthentication.get(evidence.id);
    if (!result.passed) errors.push(`${label} evidence authentication failed for ${evidence.id}: ${result.error}`);
    return result.passed;
  };
  for (const [index, operation] of patch.operations.entries()) {
    if (operation.type === "INSERT" && operation.hyperedge) {
      for (const participant of operation.hyperedge.participants) if (!available.has(participant.nodeId)) errors.push(`operations[${index}] references missing participant ${participant.nodeId}`);
    }
    if (["UPDATE", "DEPRECATE"].includes(operation.type)) {
      const target = entities.get(operation.targetId);
      if (!target) errors.push(`${operation.type} target does not exist: ${operation.targetId}`);
      if (target?.layer === "source") errors.push(`${operation.type} cannot mutate immutable source entity ${operation.targetId}`);
      if (operation.type === "UPDATE" && ("id" in operation.patch || "createdAt" in operation.patch)) errors.push(`UPDATE cannot change identity fields for ${operation.targetId}`);
      if (operation.type === "UPDATE" && target) {
        const updated = { ...target, ...operation.patch };
        errors.push(...("participants" in target
          ? validateHyperedge(updated, `operations[${index}].result`)
          : validateNode(updated, `operations[${index}].result`)));
      }
    }
    const entity = operation.node ?? operation.hyperedge;
    const refs = evidenceRefsForOperation(operation, patch);
    for (const reference of refs) referencedEvidenceIds.add(reference);
    const structurallyGroundedSource = operation.type === "INSERT" && entity?.kind === "evidence" && validateEvidenceNode(entity, entity.id).length === 0;
    const selfGroundedSource = structurallyGroundedSource
      ? await authenticateEvidence(entity, `operations[${index}]`)
      : false;
    let refsGrounded = refs.length > 0;
    for (const reference of refs) {
      const evidence = available.get(reference);
      if (!(await authenticateEvidence(evidence, `operations[${index}]`))) refsGrounded = false;
    }
    if (!selfGroundedSource && !refsGrounded) errors.push(`operations[${index}] is not grounded in immutable source evidence`);
    if (selfGroundedSource) referencedEvidenceIds.add(entity.id);
  }
  for (const reference of patch.contradictionRefs) if (!available.has(reference)) errors.push(`contradiction reference does not exist: ${reference}`);
  const freshnessErrors = [...referencedEvidenceIds]
    .map((reference) => available.get(reference))
    .filter((entity) => entity?.kind === "evidence")
    .filter((entity) => entity.freshness?.expiresAt && Date.parse(entity.freshness.expiresAt) <= validationAt)
    .map((entity) => `evidence is stale: ${entity.id}`);
  errors.push(...freshnessErrors);
  const shapeErrors = validateGraphPatchShape(patch);
  return {
    sourceGrounded: !errors.some((entry) => entry.includes("grounded") || entry.includes("authentication failed") || entry.includes("evidence is stale")),
    schemaValid: shapeErrors.length === 0,
    authorityValid: patch.graphId === graph.graphId && graph.authority.canonicalMutation === "accepted-patch-only",
    conflictFree: patch.baseVersion === graph.version
      && patch.baseCanonicalHash === canonicalStateHash(graph)
      && !errors.some((entry) => entry.includes("already exists") || entry.includes("does not exist")),
    freshnessValid: freshnessErrors.length === 0,
    errors: [...new Set(errors)],
  };
}

export async function validateGraphPatch(repoRoot, patchId, { graphPath, write = true } = {}) {
  const validate = async () => {
    const graph = await readKnowledgeGraph(repoRoot, { graphPath });
    const patch = graph.proposals.find((entry) => entry.patchId === patchId);
    if (!patch) throw new Error(`graph patch not found: ${patchId}`);
    if (["rejected", "applied"].includes(patch.status)) throw new Error(`graph patch cannot be validated from status ${patch.status}`);
    patch.validation = await validatePatchAgainstGraph(repoRoot, graph, patch);
    patch.validatedAt = now();
    if (patch.baseVersion !== graph.version || patch.baseCanonicalHash !== canonicalStateHash(graph)) patch.status = "conflicted";
    else if (patch.status === "conflicted") patch.status = "pending";
    if (write) await persistKnowledgeGraph(repoRoot, graph, { graphPath });
    return clone(patch);
  };
  return write ? withGraphMutationLock(repoRoot, graphPath, validate) : validate();
}

export async function decideGraphPatch(repoRoot, patchId, {
  decision,
  principalId,
  reason,
  graphPath,
} = {}) {
  if (!nonEmpty(principalId)) throw new Error("graph patch decision requires principalId");
  if (!["accept", "reject"].includes(decision)) throw new Error("graph patch decision must be accept or reject");
  return withGraphMutationLock(repoRoot, graphPath, async () => {
    const graph = await readKnowledgeGraph(repoRoot, { graphPath });
    const patch = graph.proposals.find((entry) => entry.patchId === patchId);
    if (!patch) throw new Error(`graph patch not found: ${patchId}`);
    if (patch.status !== "pending") throw new Error(`graph patch decision requires pending status, got ${patch.status}`);
    patch.validation = await validatePatchAgainstGraph(repoRoot, graph, patch);
    if (decision === "accept" && (!Object.entries(patch.validation).filter(([key]) => key !== "errors").every(([, value]) => value) || patch.validation.errors.length)) {
      throw new Error(`graph patch failed validation:\n${patch.validation.errors.join("\n")}`);
    }
    patch.status = decision === "accept" ? "accepted" : "rejected";
    patch.decision = { decision, principalId, reason: String(reason ?? ""), decidedAt: now() };
    await persistKnowledgeGraph(repoRoot, graph, { graphPath });
    return clone(patch);
  });
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
  return withGraphMutationLock(repoRoot, graphPath, async () => {
    const graph = await readKnowledgeGraph(repoRoot, { graphPath });
    const patch = graph.proposals.find((entry) => entry.patchId === patchId);
    if (!patch) throw new Error(`graph patch not found: ${patchId}`);
    if (patch.status !== "accepted") throw new Error(`only accepted graph patches can apply; got ${patch.status}`);
    const currentCanonicalHash = canonicalStateHash(graph);
    if (patch.baseVersion !== graph.version || patch.baseCanonicalHash !== currentCanonicalHash) {
      patch.status = "conflicted";
      patch.conflict = {
        actualCanonicalHash: currentCanonicalHash,
        actualVersion: graph.version,
        expectedCanonicalHash: patch.baseCanonicalHash,
        expectedVersion: patch.baseVersion,
      };
      await persistKnowledgeGraph(repoRoot, graph, { graphPath });
      return { graph: clone(graph), patch: clone(patch), status: "conflicted" };
    }
    const validation = await validatePatchAgainstGraph(repoRoot, graph, patch);
    if (validation.errors.length) throw new Error(`accepted graph patch no longer validates:\n${validation.errors.join("\n")}`);
    const beforeHash = currentCanonicalHash;
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
    previousReceiptHash: graph.evolutionReceipts.at(-1)?.receiptHash ?? null,
    entityBindings: affectedEntityBindings(graph, patch.operations),
    actionReceiptCount: graph.actionReceipts.length,
    actionReceiptRootHash: actionReceiptRoot(graph.actionReceipts),
    };
    receipt.receiptHash = digest(evolutionReceiptBody(receipt));
    graph.evolutionReceipts.push(receipt);
    await persistKnowledgeGraph(repoRoot, graph, { graphPath });
    return { graph: clone(graph), receipt: clone(receipt), status: "applied" };
  });
}

export async function recordKnowledgeAction(repoRoot, action, { graphPath } = {}) {
  return withGraphMutationLock(repoRoot, graphPath, async () => {
    const graph = await readKnowledgeGraph(repoRoot, { graphPath });
    if (!KNOWLEDGE_ACTION_TYPES.has(action?.type)) throw new Error(`unsupported knowledge action: ${action?.type}`);
    for (const field of ["runId", "caseId", "actorId"]) if (!nonEmpty(action?.[field])) throw new Error(`knowledge action ${field} is required`);
    if (action.receiptId !== undefined && !nonEmpty(action.receiptId)) throw new Error("knowledge action receiptId must be non-empty");
    const outputRefs = [...new Set(action.outputRefs ?? [])];
    const evidenceRefs = [...new Set(action.evidenceRefs ?? [])];
    const listErrors = [
      ...validateStringList(outputRefs, "knowledge action outputRefs"),
      ...validateStringList(evidenceRefs, "knowledge action evidenceRefs"),
    ];
    if (listErrors.length) throw new Error(`knowledge action is invalid:\n${listErrors.join("\n")}`);
    const occurredAt = action.occurredAt ?? now();
    if (Number.isNaN(Date.parse(occurredAt)) || new Date(Date.parse(occurredAt)).toISOString() !== occurredAt) {
      throw new Error("knowledge action occurredAt must be canonical UTC ISO-8601");
    }
    const status = action.status ?? "completed";
    if (!KNOWLEDGE_ACTION_STATUSES.has(status)) throw new Error(`unsupported knowledge action status: ${status}`);
    const receipt = {
    schemaVersion: KNOWLEDGE_ACTION_SCHEMA,
    receiptId: action.receiptId ?? `knowledge_action_${digest({ action, graphVersion: graph.version, occurredAt }).slice(0, 20)}`,
    sequence: graph.actionReceipts.length + 1,
    previousReceiptHash: graph.actionReceipts.at(-1)?.receiptHash ?? null,
    graphId: graph.graphId,
    graphVersion: graph.version,
    runId: String(action.runId ?? ""),
    caseId: String(action.caseId ?? ""),
    actorId: String(action.actorId ?? ""),
    type: action.type,
    input: clone(action.input ?? {}),
    outputRefs,
    evidenceRefs,
    budget: clone(action.budget ?? {}),
    status,
    occurredAt,
    };
    if (graph.actionReceipts.some((entry) => entry.receiptId === receipt.receiptId)) throw new Error(`knowledge action receipt already exists: ${receipt.receiptId}`);
    receipt.receiptHash = digest(actionReceiptBody(receipt));
    graph.actionReceipts.push(receipt);
    await persistKnowledgeGraph(repoRoot, graph, { graphPath });
    return receipt;
  });
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
