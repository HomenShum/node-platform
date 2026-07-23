import { createHash } from "node:crypto";
import { validateKnowledgeGraphDocument } from "./knowledge-evolution.mjs";

export const KNOWLEDGE_RETRIEVAL_SCHEMA = "nodekit.knowledge-retrieval-receipt/v1";
export const KNOWLEDGE_PROJECTION_SCHEMA = "nodekit.accepted-knowledge-projection/v1";
export const KNOWLEDGE_QUERY_MAX_LENGTH = 4_096;
export const KNOWLEDGE_QUERY_MAX_LIST_ITEMS = 100;
export const KNOWLEDGE_QUERY_MAX_ID_LENGTH = 512;
export const KNOWLEDGE_QUERY_MAX_PREDICATE_LENGTH = 256;
export const KNOWLEDGE_RETRIEVAL_MAX_LIMIT = 100;
export const KNOWLEDGE_RETRIEVAL_MAX_DEPTH = 8;
export const KNOWLEDGE_RECEIPT_REPLAY_PAGE_SIZE = 100;

const REJECTED_STATUSES = new Set(["deprecated", "rejected", "stale", "superseded"]);
const RETRIEVAL_INPUT_FIELDS = new Set([
  "at",
  "caseId",
  "graphId",
  "limit",
  "maxDepth",
  "minimumFacts",
  "mode",
  "predicates",
  "query",
  "runId",
  "seedIds",
  "sessionId",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function knowledgeRuntimeHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function plainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
  return value;
}

function boundedOptionalString(value, label, maximumLength, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > maximumLength) throw new Error(`${label} must not exceed ${maximumLength} characters`);
  return value;
}

function boundedInteger(value, label, { fallback, minimum, maximum }) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function boundedUniqueStrings(value, label, maximumLength) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > KNOWLEDGE_QUERY_MAX_LIST_ITEMS) {
    throw new Error(`${label} must contain at most ${KNOWLEDGE_QUERY_MAX_LIST_ITEMS} items`);
  }
  const output = [];
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) throw new Error(`${label}[${index}] must be a non-empty string`);
    const normalized = item.trim();
    if (normalized.length > maximumLength) throw new Error(`${label}[${index}] must not exceed ${maximumLength} characters`);
    if (seen.has(normalized)) throw new Error(`${label} must contain unique items`);
    seen.add(normalized);
    output.push(normalized);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${label} must be a timestamp`);
  const instant = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error(`${label} must be a timestamp`);
  return new Date(instant).toISOString();
}

function normalizedRetrievalInput(input, options) {
  plainRecord(input, "knowledge retrieval input");
  plainRecord(options, "knowledge retrieval options");
  const unknown = Object.keys(input).filter((field) => !RETRIEVAL_INPUT_FIELDS.has(field));
  if (unknown.length > 0) throw new Error(`knowledge retrieval input contains unknown fields: ${unknown.sort().join(", ")}`);
  const query = boundedOptionalString(input.query, "query", KNOWLEDGE_QUERY_MAX_LENGTH);
  const limit = boundedInteger(input.limit, "limit", { fallback: 12, minimum: 1, maximum: KNOWLEDGE_RETRIEVAL_MAX_LIMIT });
  const maxDepth = boundedInteger(input.maxDepth, "maxDepth", { fallback: 2, minimum: 0, maximum: KNOWLEDGE_RETRIEVAL_MAX_DEPTH });
  const minimumFacts = boundedInteger(input.minimumFacts, "minimumFacts", { fallback: 1, minimum: 1, maximum: KNOWLEDGE_RETRIEVAL_MAX_LIMIT });
  if (minimumFacts > limit) throw new Error("minimumFacts must not exceed limit");
  if (input.mode !== undefined && input.mode !== "flat" && input.mode !== "graph") {
    throw new Error("mode must be flat or graph");
  }
  const seedIds = boundedUniqueStrings(input.seedIds, "seedIds", KNOWLEDGE_QUERY_MAX_ID_LENGTH);
  const predicates = boundedUniqueStrings(input.predicates, "predicates", KNOWLEDGE_QUERY_MAX_PREDICATE_LENGTH);
  const effectiveAt = canonicalTimestamp(input.at ?? options.at ?? options.occurredAt ?? Date.now(), "knowledge retrieval at");
  return {
    at: effectiveAt,
    caseId: boundedOptionalString(input.caseId, "caseId", KNOWLEDGE_QUERY_MAX_ID_LENGTH),
    graphId: input.graphId === undefined ? undefined : nonEmpty(boundedOptionalString(input.graphId, "graphId", KNOWLEDGE_QUERY_MAX_ID_LENGTH), "graphId").trim(),
    limit,
    maxDepth,
    minimumFacts,
    mode: input.mode ?? "graph",
    predicates,
    query,
    runId: boundedOptionalString(input.runId, "runId", KNOWLEDGE_QUERY_MAX_ID_LENGTH),
    seedIds,
    sessionId: nonEmpty(boundedOptionalString(input.sessionId, "sessionId", KNOWLEDGE_QUERY_MAX_ID_LENGTH, "session:unbound"), "sessionId").trim(),
  };
}

function receiptHistoryLink(history, { graphId, ownerId, sessionId }) {
  if (!Array.isArray(history)) throw new Error("knowledge retrieval history must be an array");
  const previous = history.at(-1);
  if (history.length === 0) return { historySequence: 1, previousReceiptHash: null, previousReceiptIds: [], repeatSession: false };
  if (!previous) throw new Error("knowledge retrieval history must end with a receipt");
  plainRecord(previous, "previous knowledge retrieval receipt");
  if (previous.ownerId !== ownerId || previous.graphId !== graphId || previous.sessionId !== sessionId) {
    throw new Error("previous knowledge retrieval receipt identity does not match the current owner, graph, and session");
  }
  const receiptId = nonEmpty(previous.receiptId, "previous knowledge retrieval receiptId");
  if (receiptId.length > KNOWLEDGE_QUERY_MAX_ID_LENGTH) throw new Error(`previous knowledge retrieval receiptId must not exceed ${KNOWLEDGE_QUERY_MAX_ID_LENGTH} characters`);
  if (typeof previous.receiptHash !== "string" || !/^[a-f0-9]{64}$/u.test(previous.receiptHash)) {
    throw new Error("previous knowledge retrieval receiptHash must be a SHA-256 digest");
  }
  const { receiptHash, ...previousBody } = previous;
  if (knowledgeRuntimeHash(previousBody) !== receiptHash) throw new Error("previous knowledge retrieval receiptHash is invalid");
  if (!Number.isSafeInteger(previous.historySequence) || previous.historySequence < 1 || previous.historySequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("previous knowledge retrieval historySequence must be a positive integer");
  }
  return {
    historySequence: previous.historySequence + 1,
    previousReceiptHash: receiptHash,
    previousReceiptIds: [receiptId],
    repeatSession: true,
  };
}

function requireGraphOwner(graph, ownerId) {
  const owner = nonEmpty(ownerId, "ownerId");
  const graphOwner = nonEmpty(graph?.authority?.ownerId, "graph.authority.ownerId");
  if (graphOwner !== owner) throw new Error(`knowledge graph owner mismatch: expected ${owner}, received ${graphOwner}`);
  return owner;
}

function tokenize(value) {
  return [...new Set(String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .map((token) => token.replace(/(?:ing|ed|es|s)$/u, ""))
    .filter((token) => token.length > 1))];
}

function entityTokens(entity) {
  return tokenize(canonical({
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    aliases: entity.properties?.aliases,
    keywords: entity.properties?.keywords,
    properties: entity.properties,
  }));
}

function lexicalScore(entity, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const tokens = new Set(entityTokens(entity));
  const labelTokens = new Set(tokenize(entity.label));
  return queryTokens.reduce((score, token) => score + (labelTokens.has(token) ? 8 : tokens.has(token) ? 3 : 0), 0);
}

function statusIsRejected(entity) {
  const status = String(entity?.status ?? entity?.properties?.status ?? "").toLowerCase();
  return REJECTED_STATUSES.has(status);
}

function isFresh(entity, at) {
  const expiresAt = entity?.freshness?.expiresAt;
  return !expiresAt || (Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > at);
}

function acceptedEntityReceipts(graph) {
  const receiptsByEntity = new Map();
  for (const receipt of graph.evolutionReceipts ?? []) {
    if (receipt?.decision?.decision !== "accept" || !Number.isInteger(receipt.toVersion) || receipt.toVersion > graph.version) continue;
    for (const operation of receipt.operations ?? []) {
      const id = operation.node?.id ?? operation.hyperedge?.id ?? operation.targetId;
      if (!id) continue;
      const ids = receiptsByEntity.get(id) ?? [];
      ids.push(receipt.receiptId);
      receiptsByEntity.set(id, ids);
    }
  }
  return receiptsByEntity;
}

function evidenceIsAcceptedAndCurrent(entity, receiptsByEntity, at) {
  return entity?.kind === "evidence"
    && entity.layer === "source"
    && receiptsByEntity.has(entity.id)
    && !entity.deprecatedAt
    && !statusIsRejected(entity)
    && isFresh(entity, at);
}

export function createAcceptedKnowledgeProjection(graph, { at = Date.now() } = {}) {
  const errors = validateKnowledgeGraphDocument(graph);
  if (errors.length > 0) throw new Error(`knowledge projection requires a valid graph:\n${errors.join("\n")}`);
  const instant = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(instant)) throw new Error("knowledge projection at must be a timestamp");

  const receiptsByEntity = acceptedEntityReceipts(graph);
  const allNodes = new Map(graph.nodes.map((entity) => [entity.id, entity]));
  const currentEvidence = new Map(graph.nodes
    .filter((entity) => evidenceIsAcceptedAndCurrent(entity, receiptsByEntity, instant))
    .map((entity) => [entity.id, entity]));
  const exclusions = { deprecated: [], rejected: [], stale: [], unaccepted: [], unsupported: [], wrongLayer: [] };
  const facts = [];

  for (const node of graph.nodes) {
    if (node.kind === "evidence") continue;
    if (!receiptsByEntity.has(node.id)) { exclusions.unaccepted.push(node.id); continue; }
    if (node.deprecatedAt) { exclusions.deprecated.push(node.id); continue; }
    if (statusIsRejected(node)) { exclusions.rejected.push(node.id); continue; }
    if (!isFresh(node, instant)) { exclusions.stale.push(node.id); continue; }
    if (node.layer !== "canonical") { exclusions.wrongLayer.push(node.id); continue; }
    const evidenceRefs = [...new Set(node.evidenceRefs ?? [])];
    if (evidenceRefs.length === 0 || evidenceRefs.some((id) => !currentEvidence.has(id))) {
      if (evidenceRefs.some((id) => {
        const evidence = allNodes.get(id);
        return evidence?.freshness?.expiresAt && Date.parse(evidence.freshness.expiresAt) <= instant;
      })) exclusions.stale.push(node.id);
      else exclusions.unsupported.push(node.id);
      continue;
    }
    facts.push(clone(node));
  }

  const factIds = new Set(facts.map((fact) => fact.id));
  const evidenceIds = new Set(facts.flatMap((fact) => fact.evidenceRefs));
  const hyperedges = [];
  for (const edge of graph.hyperedges) {
    if (!receiptsByEntity.has(edge.id)) { exclusions.unaccepted.push(edge.id); continue; }
    if (edge.deprecatedAt) { exclusions.deprecated.push(edge.id); continue; }
    if (statusIsRejected(edge)) { exclusions.rejected.push(edge.id); continue; }
    if (!isFresh(edge, instant)) { exclusions.stale.push(edge.id); continue; }
    if (edge.layer !== "canonical") { exclusions.wrongLayer.push(edge.id); continue; }
    const evidenceRefs = [...new Set(edge.evidenceRefs ?? [])];
    const participantIds = edge.participants.map((participant) => participant.nodeId);
    const participantsSupported = participantIds.every((id) => factIds.has(id) || currentEvidence.has(id));
    if (!participantsSupported || evidenceRefs.length === 0 || evidenceRefs.some((id) => !currentEvidence.has(id))) {
      exclusions.unsupported.push(edge.id);
      continue;
    }
    evidenceRefs.forEach((id) => evidenceIds.add(id));
    hyperedges.push(clone(edge));
  }

  const evolutionReceiptIds = [...new Set([
    ...facts.flatMap((fact) => receiptsByEntity.get(fact.id) ?? []),
    ...hyperedges.flatMap((edge) => receiptsByEntity.get(edge.id) ?? []),
  ])].sort();
  const projection = {
    schemaVersion: KNOWLEDGE_PROJECTION_SCHEMA,
    graphId: graph.graphId,
    graphVersion: graph.version,
    graphContentHash: graph.contentHash,
    projectedAt: new Date(instant).toISOString(),
    facts,
    evidence: [...evidenceIds].sort().map((id) => clone(currentEvidence.get(id))).filter(Boolean),
    hyperedges,
    evolutionReceiptIds,
    evolutionReceiptBindings: Object.fromEntries([...receiptsByEntity.entries()].map(([id, receiptIds]) => [id, [...new Set(receiptIds)].sort()])),
    exclusions: Object.fromEntries(Object.entries(exclusions).map(([reason, ids]) => [reason, [...new Set(ids)].sort()])),
  };
  projection.projectionHash = knowledgeRuntimeHash(projection);
  return projection;
}

function traverseProjection(projection, seedIds, { maxDepth, predicates }) {
  const allowedPredicates = predicates?.length ? new Set(predicates) : null;
  const factIds = new Set(projection.facts.map((fact) => fact.id));
  const visited = new Set(seedIds.filter((id) => factIds.has(id)));
  const traversedHyperedgeIds = new Set();
  let frontier = [...visited];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    const frontierIds = new Set(frontier);
    for (const edge of projection.hyperedges) {
      if (allowedPredicates && !allowedPredicates.has(edge.predicate)) continue;
      if (!edge.participants.some((participant) => frontierIds.has(participant.nodeId))) continue;
      traversedHyperedgeIds.add(edge.id);
      for (const participant of edge.participants) {
        if (!factIds.has(participant.nodeId) || visited.has(participant.nodeId)) continue;
        visited.add(participant.nodeId);
        next.push(participant.nodeId);
      }
    }
    frontier = next;
  }
  return { factIds: visited, traversedHyperedgeIds };
}

export function retrieveAcceptedKnowledge(graph, input = {}, options = {}) {
  const ownerId = requireGraphOwner(graph, options.ownerId);
  const normalized = normalizedRetrievalInput(input, options);
  const history = options.history ?? [];
  if (!Array.isArray(history)) throw new Error("knowledge retrieval history must be an array");
  const {
    at,
    caseId,
    graphId,
    limit,
    maxDepth,
    minimumFacts,
    mode,
    predicates,
    query,
    runId,
    seedIds: requestedSeeds,
    sessionId,
  } = normalized;
  if (graphId !== undefined && graphId !== graph.graphId) {
    throw new Error(`knowledge retrieval graph mismatch: expected ${graph.graphId}, received ${graphId}`);
  }
  const projection = createAcceptedKnowledgeProjection(graph, { at });
  const queryTokens = tokenize(query);
  const ranked = projection.facts
    .map((fact) => ({ fact, score: lexicalScore(fact, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.fact.id.localeCompare(right.fact.id));
  const seedIds = requestedSeeds.length > 0 ? requestedSeeds : ranked.slice(0, Math.min(limit, 4)).map((entry) => entry.fact.id);
  const traversal = mode === "flat"
    ? { factIds: new Set(seedIds), traversedHyperedgeIds: new Set() }
    : traverseProjection(projection, seedIds, { maxDepth, predicates });
  const rankedIds = new Set(ranked.map((entry) => entry.fact.id));
  const scoreByFactId = new Map(ranked.map((entry) => [entry.fact.id, entry.score]));
  const selected = projection.facts
    .filter((fact) => traversal.factIds.has(fact.id) || (requestedSeeds.length === 0 && rankedIds.has(fact.id)))
    .sort((left, right) => {
      const leftScore = scoreByFactId.get(left.id) ?? 0;
      const rightScore = scoreByFactId.get(right.id) ?? 0;
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })
    .slice(0, limit);
  const selectedEvidenceIds = new Set(selected.flatMap((fact) => fact.evidenceRefs));
  const selectedFactIds = new Set(selected.map((fact) => fact.id));
  const selectedEdges = projection.hyperedges
    .filter((edge) => traversal.traversedHyperedgeIds.has(edge.id)
      && edge.participants.some((participant) => selectedFactIds.has(participant.nodeId)))
    .slice(0, limit);
  selectedEdges.flatMap((edge) => edge.evidenceRefs).forEach((id) => selectedEvidenceIds.add(id));
  const evidence = projection.evidence.filter((item) => selectedEvidenceIds.has(item.id));
  const selectedEvolutionEntityIds = [...new Set([
    ...selected.map((fact) => fact.id),
    ...selectedEdges.map((edge) => edge.id),
    ...evidence.map((item) => item.id),
  ])];
  const selectedEvolutionReceiptIds = [...new Set(selectedEvolutionEntityIds.flatMap((id) => projection.evolutionReceiptBindings[id] ?? []))].sort();
  const decision = selected.length >= minimumFacts
    ? { status: "SUPPORTED", reason: "ACCEPTED_CANONICAL_EVIDENCE_FOUND" }
    : { status: "ABSTAIN", reason: "INSUFFICIENT_ACCEPTED_EVIDENCE" };
  const historyLink = receiptHistoryLink(history, { graphId: projection.graphId, ownerId, sessionId });
  const occurredAt = canonicalTimestamp(options.occurredAt ?? at, "knowledge retrieval occurredAt");
  const queryContract = {
    schemaVersion: "nodekit.knowledge-query/v1",
    query,
    seedIds: requestedSeeds,
    predicates,
    limit,
    minimumFacts,
    maxDepth,
    mode,
    projectionAt: projection.projectedAt,
  };
  const queryHash = knowledgeRuntimeHash(queryContract);
  const receiptBase = {
    schemaVersion: KNOWLEDGE_RETRIEVAL_SCHEMA,
    ownerId,
    graphId: projection.graphId,
    graphVersion: projection.graphVersion,
    graphContentHash: projection.graphContentHash,
    projectionHash: projection.projectionHash,
    sessionId,
    caseId,
    runId,
    repeatSession: historyLink.repeatSession,
    historySequence: historyLink.historySequence,
    previousReceiptIds: historyLink.previousReceiptIds,
    previousReceiptHash: historyLink.previousReceiptHash,
    query,
    queryHash,
    policy: {
      acceptedCanonicalOnly: true,
      excludeDeprecated: true,
      excludeRejected: true,
      excludeStale: true,
      queryHash,
      seedIds: requestedSeeds,
      predicates,
      limit,
      minimumFacts,
      maxDepth,
      mode,
      projectionAt: projection.projectedAt,
      history: {
        linkage: "immediate-predecessor",
        maxPreviousReceiptIds: 1,
        replayOrder: "ascending-sequence",
        replayPageSize: KNOWLEDGE_RECEIPT_REPLAY_PAGE_SIZE,
      },
    },
    selectedFactIds: selected.map((fact) => fact.id),
    traversedHyperedgeIds: selectedEdges.map((edge) => edge.id),
    evolutionReceiptIds: selectedEvolutionReceiptIds,
    evidence: evidence.map((item) => ({ id: item.id, contentHash: item.contentHash, sourceUri: item.sourceUri, capturedAt: item.capturedAt })),
    excluded: projection.exclusions,
    decision,
    occurredAt,
  };
  const receiptId = `knowledge_retrieval_${knowledgeRuntimeHash(receiptBase).slice(0, 24)}`;
  const receipt = { ...receiptBase, receiptId };
  receipt.receiptHash = knowledgeRuntimeHash(receipt);
  return { projection, facts: selected, hyperedges: selectedEdges, evidence, decision, receipt };
}

export function createMemoryKnowledgeStore() {
  return { projections: new Map(), receipts: new Map() };
}

export function createMemoryKnowledgeRuntime({ ownerId, store = createMemoryKnowledgeStore(), clock = () => new Date().toISOString() } = {}) {
  nonEmpty(ownerId, "ownerId");
  const keyFor = (graphId) => `${ownerId}\u0000${graphId}`;
  const sessionKey = (graphId, sessionId) => `${ownerId}\u0000${graphId}\u0000${sessionId}`;
  return {
    provider: "memory",
    capabilities: Object.freeze({ transactions: true, optimisticConcurrency: true, durable: false, graphTraversal: true, repeatSessionRetrieval: true }),
    ownerId,
    async projectGraph({ graph, expectedVersion = null }) {
      requireGraphOwner(graph, ownerId);
      createAcceptedKnowledgeProjection(graph, { at: Date.parse(clock()) });
      const key = keyFor(graph.graphId);
      const current = store.projections.get(key);
      if (current?.contentHash === graph.contentHash && current?.version === graph.version) return { applied: true, reused: true, actualVersion: graph.version };
      if (!current && expectedVersion !== null) return { applied: false, reused: false, conflict: true, actualVersion: null };
      if (current && expectedVersion !== current.version) return { applied: false, reused: false, conflict: true, actualVersion: current.version };
      if (current && graph.version !== current.version + 1) throw new Error(`knowledge projection version must advance exactly once from ${current.version} to ${current.version + 1}`);
      store.projections.set(key, { version: graph.version, contentHash: graph.contentHash, graph: clone(graph) });
      return { applied: true, reused: false, conflict: false, actualVersion: graph.version };
    },
    async readGraph(graphId) {
      const current = store.projections.get(keyFor(nonEmpty(graphId, "graphId")));
      if (!current) throw new Error(`knowledge graph not found for owner ${ownerId}: ${graphId}`);
      return clone(current.graph);
    },
    async retrieve(input) {
      const graph = await this.readGraph(input.graphId);
      const key = sessionKey(input.graphId, nonEmpty(input.sessionId, "sessionId"));
      const history = store.receipts.get(key) ?? [];
      const output = retrieveAcceptedKnowledge(graph, input, { ownerId, history, occurredAt: clock() });
      history.push(clone(output.receipt));
      store.receipts.set(key, history);
      return clone(output);
    },
    async listSessionReceipts({ graphId, sessionId }) {
      return clone(store.receipts.get(sessionKey(graphId, sessionId)) ?? []);
    },
  };
}
