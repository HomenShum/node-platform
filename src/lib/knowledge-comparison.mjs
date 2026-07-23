import { replayKnowledgeGraph } from "./knowledge-evolution.mjs";
import { knowledgeRuntimeHash, retrieveAcceptedKnowledge } from "./knowledge-runtime.mjs";

export const KNOWLEDGE_COMPARISON_DEFINITION_SCHEMA = "nodekit.protected-knowledge-comparison-definition/v1";
export const KNOWLEDGE_COMPARISON_RESULT_SCHEMA = "nodekit.protected-knowledge-comparison-result/v1";
export const KNOWLEDGE_COMPARISON_EXECUTION_SCHEMA = "nodekit.knowledge-comparison-execution/v1";
export const KNOWLEDGE_COMPARISON_PROFILES = Object.freeze(["flat", "staticGraph", "evolvingGraph"]);

const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const RELEASE_CANDIDATE_FIELDS = Object.freeze([
  "nodekitCommit",
  "nodekitSourceHash",
  "nodekitTarballSha256",
  "packageName",
  "packageVersion",
]);

const EVALUATOR = Object.freeze({
  id: "nodekit:accepted-knowledge-evaluator",
  version: "1.0.0",
  successRule: "all expected facts returned; no forbidden fact returned; abstention exactly matches the protected case",
  unsupportedEdgeRule: "unsupported edges are never traversed or surfaced as support",
  metrics: ["success", "abstainCorrect", "unsupportedEdgeCount", "turns", "tokens", "latencyMs", "costUsd"],
});

function clone(value) {
  return structuredClone(value);
}

function selfHash(value, field) {
  const body = clone(value);
  delete body[field];
  return knowledgeRuntimeHash(body);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function evidencePath(value, label) {
  const normalized = nonEmpty(value, label).replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a canonical repository-relative path`);
  }
  return normalized;
}

function releaseCandidate(value, label = "releaseCandidate") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required`);
  const keys = Object.keys(value).sort();
  const expectedKeys = [...RELEASE_CANDIDATE_FIELDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error(`${label} must contain exactly ${RELEASE_CANDIDATE_FIELDS.join(", ")}`);
  const normalized = {
    nodekitCommit: nonEmpty(value.nodekitCommit, `${label}.nodekitCommit`),
    nodekitSourceHash: nonEmpty(value.nodekitSourceHash, `${label}.nodekitSourceHash`),
    nodekitTarballSha256: nonEmpty(value.nodekitTarballSha256, `${label}.nodekitTarballSha256`),
    packageName: nonEmpty(value.packageName, `${label}.packageName`),
    packageVersion: nonEmpty(value.packageVersion, `${label}.packageVersion`),
  };
  if (!COMMIT.test(normalized.nodekitCommit)) throw new Error(`${label}.nodekitCommit must be a lowercase 40-character Git commit`);
  if (!SHA256.test(normalized.nodekitSourceHash)) throw new Error(`${label}.nodekitSourceHash must be a lowercase SHA-256 digest`);
  if (!SHA256.test(normalized.nodekitTarballSha256)) throw new Error(`${label}.nodekitTarballSha256 must be a lowercase SHA-256 digest`);
  if (normalized.packageName !== "@homenshum/nodekit") throw new Error(`${label}.packageName must be @homenshum/nodekit`);
  if (!PACKAGE_VERSION.test(normalized.packageVersion)) throw new Error(`${label}.packageVersion must be a semantic version`);
  return normalized;
}

function assertSameReleaseCandidate(actual, expected, label) {
  const normalized = releaseCandidate(actual, label);
  for (const field of RELEASE_CANDIDATE_FIELDS) {
    if (normalized[field] !== expected[field]) throw new Error(`${label}.${field} does not match the exact release candidate`);
  }
  return normalized;
}

function normalizeCase(entry, index) {
  const normalized = {
    caseId: nonEmpty(entry?.caseId, `cases[${index}].caseId`),
    query: String(entry?.query ?? ""),
    seedIds: [...new Set(entry?.seedIds ?? [])].sort(),
    predicates: [...new Set(entry?.predicates ?? [])].sort(),
    expectedEntityIds: [...new Set(entry?.expectedEntityIds ?? [])].sort(),
    forbiddenEntityIds: [...new Set(entry?.forbiddenEntityIds ?? [])].sort(),
    expectAbstain: entry?.expectAbstain === true,
    minimumFacts: Math.max(1, Number(entry?.minimumFacts) || 1),
    maxDepth: Math.max(0, Math.min(Number(entry?.maxDepth ?? 2), 8)),
    at: nonEmpty(entry?.at, `cases[${index}].at`),
  };
  if (!Number.isFinite(Date.parse(normalized.at))) throw new Error(`cases[${index}].at must be an ISO timestamp`);
  if (!normalized.expectAbstain && normalized.expectedEntityIds.length === 0) throw new Error(`cases[${index}] requires expectedEntityIds or expectAbstain`);
  normalized.inputSha256 = knowledgeRuntimeHash(normalized);
  return normalized;
}

export function createProtectedKnowledgeComparisonDefinition({ comparisonId, cases } = {}) {
  if (!Array.isArray(cases) || cases.length < 3) throw new Error("protected knowledge comparison requires at least three cases");
  const normalizedCases = cases.map(normalizeCase);
  if (new Set(normalizedCases.map((entry) => entry.caseId)).size !== normalizedCases.length) throw new Error("protected knowledge comparison case IDs must be unique");
  const base = {
    schemaVersion: KNOWLEDGE_COMPARISON_DEFINITION_SCHEMA,
    comparisonId: nonEmpty(comparisonId, "comparisonId"),
    profiles: [...KNOWLEDGE_COMPARISON_PROFILES],
    cases: normalizedCases,
    evaluator: clone(EVALUATOR),
    protectedBenchmarkSha256: knowledgeRuntimeHash(normalizedCases),
    evaluatorSha256: knowledgeRuntimeHash(EVALUATOR),
  };
  return { ...base, definitionSha256: knowledgeRuntimeHash(base) };
}

function verifyDefinition(definition, expectedDefinitionSha256) {
  nonEmpty(expectedDefinitionSha256, "expectedDefinitionSha256");
  if (definition?.schemaVersion !== KNOWLEDGE_COMPARISON_DEFINITION_SCHEMA) throw new Error("invalid protected knowledge comparison definition schema");
  const { definitionSha256, ...base } = definition;
  if (knowledgeRuntimeHash(base) !== definitionSha256) throw new Error("protected knowledge comparison definition hash mismatch");
  if (definitionSha256 !== expectedDefinitionSha256) throw new Error("protected knowledge comparison does not match the externally locked definition hash");
  if (knowledgeRuntimeHash(definition.cases) !== definition.protectedBenchmarkSha256) throw new Error("protected knowledge benchmark hash mismatch");
  if (knowledgeRuntimeHash(definition.evaluator) !== definition.evaluatorSha256 || definition.evaluatorSha256 !== knowledgeRuntimeHash(EVALUATOR)) {
    throw new Error("protected knowledge evaluator changed");
  }
  if (JSON.stringify(definition.profiles) !== JSON.stringify(KNOWLEDGE_COMPARISON_PROFILES)) throw new Error("protected knowledge comparison profiles changed");
  for (const [index, entry] of definition.cases.entries()) {
    const { inputSha256, ...body } = entry;
    if (knowledgeRuntimeHash(body) !== inputSha256) throw new Error(`protected knowledge case hash mismatch at index ${index}`);
  }
}

function metricFor(measurements, profile, entry, definition, graph, exactReleaseCandidate) {
  const caseId = entry.caseId;
  const metric = measurements?.[profile]?.[caseId];
  if (!metric) throw new Error(`measured execution metrics are required for ${profile}/${caseId}`);
  const normalized = {};
  for (const name of ["turns", "tokens", "latencyMs", "costUsd"]) {
    const value = Number(metric[name]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${profile}/${caseId}.${name} must be a non-negative measured number`);
    normalized[name] = value;
  }
  if (!Number.isInteger(normalized.turns) || !Number.isInteger(normalized.tokens)) throw new Error(`${profile}/${caseId} turns and tokens must be integers`);
  const receiptSha256 = nonEmpty(metric.executionReceiptSha256, `${profile}/${caseId}.executionReceiptSha256`);
  if (!/^[a-f0-9]{64}$/u.test(receiptSha256)) throw new Error(`${profile}/${caseId}.executionReceiptSha256 must be a SHA-256 digest`);
  normalized.executionReceipt = {
    path: evidencePath(metric.executionReceiptPath, `${profile}/${caseId}.executionReceiptPath`),
    sha256: receiptSha256,
  };
  const execution = clone(metric.execution);
  if (execution?.schemaVersion !== KNOWLEDGE_COMPARISON_EXECUTION_SCHEMA) throw new Error(`${profile}/${caseId} execution receipt schema is invalid`);
  const { executionSha256, ...executionBody } = execution;
  if (knowledgeRuntimeHash(executionBody) !== executionSha256) throw new Error(`${profile}/${caseId} execution receipt self-hash is invalid`);
  const expected = {
    comparisonId: definition.comparisonId,
    profile,
    caseId,
    definitionSha256: definition.definitionSha256,
    caseInputSha256: entry.inputSha256,
    evaluatorSha256: definition.evaluatorSha256,
    ownerId: graph.authority.ownerId,
    graphId: graph.graphId,
    graphVersion: graph.version,
    graphContentHash: graph.contentHash,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (execution[field] !== value) throw new Error(`${profile}/${caseId} execution receipt ${field} does not match protected inputs`);
  }
  for (const name of ["turns", "tokens", "latencyMs", "costUsd"]) {
    if (execution[name] !== normalized[name]) throw new Error(`${profile}/${caseId} metrics differ from the content-addressed execution receipt`);
  }
  execution.releaseCandidate = assertSameReleaseCandidate(
    execution.releaseCandidate,
    exactReleaseCandidate,
    `${profile}/${caseId} execution receipt releaseCandidate`,
  );
  normalized.execution = execution;
  return normalized;
}

function evaluateCase(graph, profile, entry, metrics) {
  const output = retrieveAcceptedKnowledge(graph, {
    query: entry.query,
    seedIds: entry.seedIds,
    predicates: entry.predicates,
    minimumFacts: entry.minimumFacts,
    maxDepth: entry.maxDepth,
    mode: profile === "flat" ? "flat" : "graph",
    sessionId: `comparison:${entry.caseId}`,
    at: entry.at,
  }, { ownerId: graph.authority.ownerId, occurredAt: entry.at });
  const returned = new Set(output.facts.map((fact) => fact.id));
  const missingExpected = entry.expectedEntityIds.filter((id) => !returned.has(id));
  const returnedForbidden = entry.forbiddenEntityIds.filter((id) => returned.has(id));
  const abstained = output.decision.status === "ABSTAIN";
  const abstainCorrect = abstained === entry.expectAbstain;
  const unsupportedEdgeIds = output.projection.exclusions.unsupported
    .filter((id) => graph.hyperedges.some((edge) => edge.id === id));
  const surfacedUnsupported = output.hyperedges.filter((edge) => unsupportedEdgeIds.includes(edge.id)).map((edge) => edge.id);
  const success = missingExpected.length === 0 && returnedForbidden.length === 0 && abstainCorrect && surfacedUnsupported.length === 0;
  if (selfHash(metrics.execution.retrievalReceipt, "receiptHash") !== metrics.execution.retrievalReceipt.receiptHash
    || JSON.stringify(metrics.execution.retrievalReceipt) !== JSON.stringify(output.receipt)) {
    throw new Error(`${profile}/${entry.caseId} execution receipt does not bind the recomputed retrieval receipt`);
  }
  const publicMetrics = clone(metrics);
  delete publicMetrics.execution;
  return {
    caseId: entry.caseId,
    caseInputSha256: entry.inputSha256,
    evaluatorSha256: knowledgeRuntimeHash(EVALUATOR),
    decision: output.decision.status,
    returnedEntityIds: [...returned].sort(),
    missingExpected,
    returnedForbidden,
    abstainCorrect,
    unsupportedEdgeCount: unsupportedEdgeIds.length,
    surfacedUnsupportedEdgeIds: surfacedUnsupported,
    success,
    metrics: publicMetrics,
    retrievalReceiptHash: output.receipt.receiptHash,
  };
}

export function createKnowledgeComparisonExecutionReceipt({
  definition,
  profile,
  caseId,
  graph,
  retrievalReceipt,
  turns,
  tokens,
  latencyMs,
  costUsd,
  releaseCandidate: exactReleaseCandidate,
  generatedAt = new Date().toISOString(),
} = {}) {
  verifyDefinition(definition, definition?.definitionSha256);
  if (!KNOWLEDGE_COMPARISON_PROFILES.includes(profile)) throw new Error(`unsupported knowledge comparison profile: ${profile}`);
  const entry = definition.cases.find((candidate) => candidate.caseId === caseId);
  if (!entry) throw new Error(`protected knowledge comparison case is missing: ${caseId}`);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("knowledge comparison execution generatedAt must be an ISO timestamp");
  const numeric = { turns: Number(turns), tokens: Number(tokens), latencyMs: Number(latencyMs), costUsd: Number(costUsd) };
  if (!Number.isInteger(numeric.turns) || !Number.isInteger(numeric.tokens) || numeric.turns < 0 || numeric.tokens < 0
    || !Number.isFinite(numeric.latencyMs) || !Number.isFinite(numeric.costUsd) || numeric.latencyMs < 0 || numeric.costUsd < 0) {
    throw new Error("knowledge comparison execution metrics must be measured non-negative numbers");
  }
  if (selfHash(retrievalReceipt, "receiptHash") !== retrievalReceipt?.receiptHash) throw new Error("knowledge comparison execution retrieval receipt hash is invalid");
  const candidate = releaseCandidate(exactReleaseCandidate);
  const body = {
    schemaVersion: KNOWLEDGE_COMPARISON_EXECUTION_SCHEMA,
    comparisonId: definition.comparisonId,
    profile,
    caseId,
    definitionSha256: definition.definitionSha256,
    caseInputSha256: entry.inputSha256,
    evaluatorSha256: definition.evaluatorSha256,
    ownerId: graph.authority.ownerId,
    graphId: graph.graphId,
    graphVersion: graph.version,
    graphContentHash: graph.contentHash,
    releaseCandidate: candidate,
    retrievalReceipt: clone(retrievalReceipt),
    ...numeric,
    generatedAt,
  };
  return { ...body, executionSha256: knowledgeRuntimeHash(body) };
}

export function runProtectedKnowledgeComparison({
  definition,
  definitionEvidencePath,
  definitionEvidenceSha256,
  expectedDefinitionSha256,
  graphs,
  graphEvidence,
  measurements,
  releaseCandidate: exactReleaseCandidate,
  completedAt = new Date().toISOString(),
} = {}) {
  verifyDefinition(definition, expectedDefinitionSha256);
  const candidate = releaseCandidate(exactReleaseCandidate);
  if (!Number.isFinite(Date.parse(completedAt))) throw new Error("completedAt must be an ISO timestamp");
  if (!/^[a-f0-9]{64}$/u.test(definitionEvidenceSha256 ?? "")) throw new Error("definitionEvidenceSha256 must be the SHA-256 of the exact definition file bytes");
  const graphIds = new Set(KNOWLEDGE_COMPARISON_PROFILES.map((profile) => graphs?.[profile]?.graphId));
  if (graphIds.size !== 1 || graphIds.has(undefined)) throw new Error("all knowledge comparison profiles must use snapshots from the same graph");
  const ownerIds = new Set(KNOWLEDGE_COMPARISON_PROFILES.map((profile) => graphs?.[profile]?.authority?.ownerId));
  if (ownerIds.size !== 1 || ownerIds.has(undefined)) throw new Error("all knowledge comparison profiles must bind the same owner");
  if (graphs.flat.contentHash !== graphs.evolvingGraph.contentHash) throw new Error("flat retrieval must use the exact evolving-graph snapshot with traversal disabled");
  if (graphs.staticGraph.version > graphs.evolvingGraph.version) throw new Error("static graph cannot be newer than the evolving graph");
  const replayedStatic = replayKnowledgeGraph(graphs.evolvingGraph, graphs.staticGraph.version);
  for (const field of ["nodes", "hyperedges", "evolutionReceipts"]) {
    if (JSON.stringify(graphs.staticGraph[field]) !== JSON.stringify(replayedStatic[field])) {
      throw new Error(`static graph ${field} must be the exact byte-bound prefix of the evolving graph history`);
    }
  }
  const profileResults = {};
  for (const profile of KNOWLEDGE_COMPARISON_PROFILES) {
    const graph = graphs?.[profile];
    if (!graph) throw new Error(`graph snapshot is required for ${profile}`);
    const graphReference = graphEvidence?.[profile];
    if (!/^[a-f0-9]{64}$/u.test(graphReference?.sha256 ?? "")) throw new Error(`graphEvidence.${profile}.sha256 must bind the exact graph snapshot bytes`);
    const cases = definition.cases.map((entry) => evaluateCase(
      graph,
      profile,
      entry,
      metricFor(measurements, profile, entry, definition, graph, candidate),
    ));
    profileResults[profile] = {
      graphId: graph.graphId,
      graphVersion: graph.version,
      graphContentHash: graph.contentHash,
      ownerId: graph.authority.ownerId,
      graphSnapshot: {
        path: evidencePath(graphReference.path, `graphEvidence.${profile}.path`),
        sha256: graphReference.sha256,
      },
      cases,
      successRate: cases.filter((entry) => entry.success).length / cases.length,
      abstainAccuracy: cases.filter((entry) => entry.abstainCorrect).length / cases.length,
      unsupportedEdgeCount: cases.reduce((sum, entry) => sum + entry.unsupportedEdgeCount, 0),
      turns: cases.reduce((sum, entry) => sum + entry.metrics.turns, 0),
      tokens: cases.reduce((sum, entry) => sum + entry.metrics.tokens, 0),
      latencyMs: cases.reduce((sum, entry) => sum + entry.metrics.latencyMs, 0),
      costUsd: cases.reduce((sum, entry) => sum + entry.metrics.costUsd, 0),
    };
  }
  const resultBase = {
    schemaVersion: KNOWLEDGE_COMPARISON_RESULT_SCHEMA,
    comparisonId: definition.comparisonId,
    definitionSha256: definition.definitionSha256,
    protectedBenchmarkSha256: definition.protectedBenchmarkSha256,
    evaluatorSha256: definition.evaluatorSha256,
    releaseCandidate: candidate,
    definitionEvidence: {
      path: evidencePath(definitionEvidencePath, "definitionEvidencePath"),
      sha256: definitionEvidenceSha256,
    },
    sameInputs: Object.values(profileResults).every((profile) => profile.cases.every((entry, index) => entry.caseInputSha256 === definition.cases[index].inputSha256)),
    protectedEvaluatorUnchanged: Object.values(profileResults).every((profile) => profile.cases.every((entry) => entry.evaluatorSha256 === definition.evaluatorSha256)),
    profiles: profileResults,
    completedAt,
    adoptionClaim: false,
    status: "ENGINEERING_COMPARISON_ONLY",
  };
  return { ...resultBase, resultSha256: knowledgeRuntimeHash(resultBase) };
}
