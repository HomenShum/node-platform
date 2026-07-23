import {
  createKnowledgeContextConsumer,
  createMemoryKnowledgeRuntime,
  createMemoryKnowledgeStore,
  createProtectedKnowledgeComparisonDefinition,
  KNOWLEDGE_CONTEXT_PACK_SCHEMA,
  type KnowledgeGraphDocument,
  type KnowledgeRuntime,
} from "@homenshum/nodekit/knowledge-runtime";
import { createMemoryCaseflow } from "@homenshum/nodekit/caseflow";
import { createPostgresKnowledgeRuntime } from "@homenshum/nodekit/adapters/postgres/knowledge";
import type { PostgreSqlPool } from "@homenshum/nodekit/adapters/postgres";

const store = createMemoryKnowledgeStore();
const memory: KnowledgeRuntime = createMemoryKnowledgeRuntime({ ownerId: "owner:typed", store });
const caseflow = createMemoryCaseflow();
const consumer = createKnowledgeContextConsumer({ knowledgeRuntime: memory, caseflowRuntime: caseflow });
void consumer.prepareRunContext({ graphId: "graph:typed", caseId: "case:typed", runId: "run:typed", sessionId: "session:typed", query: "safe apply" });
KNOWLEDGE_CONTEXT_PACK_SCHEMA satisfies "nodekit.knowledge-context-pack/v1";

declare const graph: KnowledgeGraphDocument;
void memory.projectGraph({ graph, expectedVersion: null });
const definition = createProtectedKnowledgeComparisonDefinition({
  comparisonId: "typed-comparison",
  cases: [
    { caseId: "one", query: "one", expectedEntityIds: ["fact:one"], at: "2026-07-22T00:00:00.000Z" },
    { caseId: "two", query: "two", expectAbstain: true, at: "2026-07-22T00:00:00.000Z" },
    { caseId: "three", query: "three", expectAbstain: true, at: "2026-07-22T00:00:00.000Z" },
  ],
});
definition.definitionSha256 satisfies string;

declare const pool: PostgreSqlPool;
const postgres = createPostgresKnowledgeRuntime({ pool, ownerId: "owner:typed" });
void postgres.readGraph("graph:typed");
