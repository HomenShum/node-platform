import type { CaseflowRuntime } from "./caseflow.mjs";

export type KnowledgeGraphDocument = {
  schemaVersion: "nodekit.knowledge-graph/v1";
  graphId: string;
  version: number;
  contentHash: string;
  authority: Record<string, unknown> & { ownerId: string };
  nodes: Array<Record<string, unknown> & { id: string; kind: string; label: string; layer: string; confidence: number; evidenceRefs: string[] }>;
  hyperedges: Array<Record<string, unknown> & { id: string; predicate: string; layer: string; participants: Array<{ nodeId: string; role: string }>; evidenceRefs: string[] }>;
  proposals: Array<Record<string, unknown>>;
  actionReceipts: Array<Record<string, unknown>>;
  evolutionReceipts: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type KnowledgeRetrievalInput = {
  graphId: string;
  sessionId: string;
  caseId?: string;
  runId?: string;
  query?: string;
  seedIds?: string[];
  predicates?: string[];
  maxDepth?: number;
  minimumFacts?: number;
  limit?: number;
  at?: number | string;
  mode?: "flat" | "graph";
};

export type KnowledgeRetrievalPolicy = {
  acceptedCanonicalOnly: true;
  excludeDeprecated: true;
  excludeRejected: true;
  excludeStale: true;
  queryHash: string;
  seedIds: string[];
  predicates: string[];
  limit: number;
  minimumFacts: number;
  maxDepth: number;
  mode: "flat" | "graph";
  projectionAt: string;
  history: {
    linkage: "immediate-predecessor";
    maxPreviousReceiptIds: 1;
    replayOrder: "ascending-sequence";
    replayPageSize: 100;
  };
};

export type KnowledgeRetrievalReceipt = Record<string, unknown> & {
  receiptId: string;
  receiptHash: string;
  repeatSession: boolean;
  historySequence: number;
  previousReceiptIds: [] | [string];
  previousReceiptHash: string | null;
  query: string;
  queryHash: string;
  policy: KnowledgeRetrievalPolicy;
};

export type KnowledgeRetrievalOutput = {
  projection: Record<string, unknown>;
  facts: KnowledgeGraphDocument["nodes"];
  hyperedges: KnowledgeGraphDocument["hyperedges"];
  evidence: KnowledgeGraphDocument["nodes"];
  decision: { status: "SUPPORTED" | "ABSTAIN"; reason: string };
  receipt: KnowledgeRetrievalReceipt;
};

export type KnowledgeReleaseCandidate = {
  nodekitCommit: string;
  nodekitSourceHash: string;
  nodekitTarballSha256: string;
  packageName: "@homenshum/nodekit";
  packageVersion: string;
};

export interface KnowledgeRuntime {
  provider: string;
  ownerId: string;
  capabilities: Readonly<{ transactions: boolean; optimisticConcurrency: boolean; durable: boolean; graphTraversal: boolean; repeatSessionRetrieval: boolean }>;
  projectGraph(input: { graph: KnowledgeGraphDocument; expectedVersion?: number | null }): Promise<{ applied: boolean; reused: boolean; conflict?: boolean; actualVersion: number | null }>;
  readGraph(graphId: string): Promise<KnowledgeGraphDocument>;
  retrieve(input: KnowledgeRetrievalInput): Promise<KnowledgeRetrievalOutput>;
  listSessionReceipts(input: { graphId: string; sessionId: string }): Promise<Array<Record<string, unknown>>>;
}

export const KNOWLEDGE_RETRIEVAL_SCHEMA: "nodekit.knowledge-retrieval-receipt/v1";
export const KNOWLEDGE_PROJECTION_SCHEMA: "nodekit.accepted-knowledge-projection/v1";
export const KNOWLEDGE_QUERY_MAX_LENGTH: 4096;
export const KNOWLEDGE_QUERY_MAX_LIST_ITEMS: 100;
export const KNOWLEDGE_QUERY_MAX_ID_LENGTH: 512;
export const KNOWLEDGE_QUERY_MAX_PREDICATE_LENGTH: 256;
export const KNOWLEDGE_RETRIEVAL_MAX_LIMIT: 100;
export const KNOWLEDGE_RETRIEVAL_MAX_DEPTH: 8;
export const KNOWLEDGE_RECEIPT_REPLAY_PAGE_SIZE: 100;
export const KNOWLEDGE_CONTEXT_PACK_SCHEMA: "nodekit.knowledge-context-pack/v1";
export const KNOWLEDGE_COMPARISON_DEFINITION_SCHEMA: "nodekit.protected-knowledge-comparison-definition/v1";
export const KNOWLEDGE_COMPARISON_RESULT_SCHEMA: "nodekit.protected-knowledge-comparison-result/v1";
export const KNOWLEDGE_COMPARISON_EXECUTION_SCHEMA: "nodekit.knowledge-comparison-execution/v1";
export const KNOWLEDGE_COMPARISON_PROFILES: readonly ["flat", "staticGraph", "evolvingGraph"];

export function knowledgeRuntimeHash(value: unknown): string;
export function createAcceptedKnowledgeProjection(graph: KnowledgeGraphDocument, options?: { at?: number | string }): Record<string, unknown>;
export function retrieveAcceptedKnowledge(graph: KnowledgeGraphDocument, input: Partial<KnowledgeRetrievalInput>, options: { ownerId: string; history?: Array<Record<string, unknown>>; occurredAt?: string; at?: number | string }): KnowledgeRetrievalOutput;
export function createMemoryKnowledgeStore(): { projections: Map<string, unknown>; receipts: Map<string, unknown> };
export function createMemoryKnowledgeRuntime(options: { ownerId: string; store?: ReturnType<typeof createMemoryKnowledgeStore>; clock?: () => string }): KnowledgeRuntime;
export function createKnowledgeContextConsumer(options: { knowledgeRuntime: KnowledgeRuntime; caseflowRuntime: CaseflowRuntime }): {
  prepareRunContext(input: KnowledgeRetrievalInput & { caseId: string; runId: string }): Promise<Record<string, unknown> & { contextHash: string; decision: KnowledgeRetrievalOutput["decision"] }>;
};
export function createProtectedKnowledgeComparisonDefinition(input: { comparisonId: string; cases: Array<Record<string, unknown>> }): Record<string, unknown> & { definitionSha256: string };
export function createKnowledgeComparisonExecutionReceipt(input: {
  definition: Record<string, unknown> & { definitionSha256: string };
  profile: "flat" | "staticGraph" | "evolvingGraph";
  caseId: string;
  graph: KnowledgeGraphDocument;
  retrievalReceipt: Record<string, unknown> & { receiptHash: string };
  turns: number;
  tokens: number;
  latencyMs: number;
  costUsd: number;
  releaseCandidate: KnowledgeReleaseCandidate;
  generatedAt?: string;
}): Record<string, unknown> & { executionSha256: string; releaseCandidate: KnowledgeReleaseCandidate };
export function runProtectedKnowledgeComparison(input: {
  definition: Record<string, unknown> & { definitionSha256: string };
  definitionEvidencePath: string;
  definitionEvidenceSha256: string;
  expectedDefinitionSha256?: string;
  graphs: Record<"flat" | "staticGraph" | "evolvingGraph", KnowledgeGraphDocument>;
  graphEvidence: Record<"flat" | "staticGraph" | "evolvingGraph", { path: string; sha256: string }>;
  measurements: Record<string, Record<string, { turns: number; tokens: number; latencyMs: number; costUsd: number; executionReceiptPath: string; executionReceiptSha256: string; execution: Record<string, unknown> & { executionSha256: string } }>>;
  releaseCandidate: KnowledgeReleaseCandidate;
  completedAt?: string;
}): Record<string, unknown> & { resultSha256: string; releaseCandidate: KnowledgeReleaseCandidate; adoptionClaim: false; status: "ENGINEERING_COMPARISON_ONLY" };
