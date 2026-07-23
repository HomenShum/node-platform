import { knowledgeRuntimeHash } from "./knowledge-runtime.mjs";

export const KNOWLEDGE_CONTEXT_PACK_SCHEMA = "nodekit.knowledge-context-pack/v1";

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

/**
 * Binds governed knowledge retrieval to an actual NodeKit Caseflow run. The
 * consumer never reads pending proposals directly: its only input is the
 * runtime's accepted-knowledge retrieval result.
 */
export function createKnowledgeContextConsumer({ knowledgeRuntime, caseflowRuntime } = {}) {
  if (!knowledgeRuntime || typeof knowledgeRuntime.retrieve !== "function") throw new Error("knowledgeRuntime.retrieve is required");
  if (!caseflowRuntime || typeof caseflowRuntime.snapshot !== "function") throw new Error("caseflowRuntime.snapshot is required");
  const ownerId = nonEmpty(knowledgeRuntime.ownerId, "knowledgeRuntime.ownerId");
  const caseflowOwnerId = nonEmpty(caseflowRuntime.ownerId, "caseflowRuntime.ownerId");
  if (ownerId !== caseflowOwnerId) throw new Error(`Caseflow and knowledge runtime owner mismatch: ${caseflowOwnerId} != ${ownerId}`);

  return {
    async prepareRunContext(input = {}) {
      const caseId = nonEmpty(input.caseId, "caseId");
      const runId = nonEmpty(input.runId, "runId");
      const graphId = nonEmpty(input.graphId, "graphId");
      const sessionId = nonEmpty(input.sessionId, "sessionId");
      if (input.ownerId !== undefined && nonEmpty(input.ownerId, "ownerId") !== ownerId) throw new Error("knowledge context input ownerId does not match the bound runtimes");
      const snapshot = await caseflowRuntime.snapshot();
      const nodeCase = snapshot.cases.find((entry) => entry.caseId === caseId);
      const run = snapshot.runs.find((entry) => entry.runId === runId);
      if (!nodeCase) throw new Error(`knowledge context case not found: ${caseId}`);
      if (!run || run.caseId !== caseId) throw new Error(`knowledge context run is not bound to case ${caseId}: ${runId}`);
      if (["cancelled", "completed", "failed_safely"].includes(run.status)) throw new Error(`knowledge context cannot be prepared for terminal run ${runId}`);

      const retrieved = await knowledgeRuntime.retrieve({
        graphId,
        caseId,
        runId,
        sessionId,
        query: String(input.query ?? ""),
        seedIds: input.seedIds ?? [],
        predicates: input.predicates ?? [],
        maxDepth: input.maxDepth ?? 2,
        minimumFacts: input.minimumFacts ?? 1,
        limit: input.limit ?? 12,
        at: input.at,
      });
      const pack = {
        schemaVersion: KNOWLEDGE_CONTEXT_PACK_SCHEMA,
        ownerId,
        caseId,
        runId,
        sessionId,
        graph: {
          graphId: retrieved.receipt.graphId,
          graphVersion: retrieved.receipt.graphVersion,
          graphContentHash: retrieved.receipt.graphContentHash,
          projectionHash: retrieved.receipt.projectionHash,
        },
        policy: clone(retrieved.receipt.policy),
        decision: clone(retrieved.decision),
        facts: retrieved.facts.map((fact) => ({
          id: fact.id,
          kind: fact.kind,
          label: fact.label,
          confidence: fact.confidence,
          properties: clone(fact.properties ?? {}),
          evidenceRefs: clone(fact.evidenceRefs),
        })),
        relationships: retrieved.hyperedges.map((edge) => ({
          id: edge.id,
          predicate: edge.predicate,
          participants: clone(edge.participants),
          evidenceRefs: clone(edge.evidenceRefs),
        })),
        provenance: {
          evidence: clone(retrieved.receipt.evidence),
          evolutionReceiptIds: clone(retrieved.receipt.evolutionReceiptIds),
          retrievalReceiptId: retrieved.receipt.receiptId,
          retrievalReceiptHash: retrieved.receipt.receiptHash,
          repeatSession: retrieved.receipt.repeatSession,
          previousReceiptIds: clone(retrieved.receipt.previousReceiptIds),
        },
      };
      if (retrieved.receipt.ownerId !== ownerId) throw new Error("knowledge retrieval receipt owner does not match the bound Caseflow runtime");
      pack.contextHash = knowledgeRuntimeHash(pack);
      return pack;
    },
  };
}
