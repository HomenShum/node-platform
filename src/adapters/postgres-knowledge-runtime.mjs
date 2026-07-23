import { validateKnowledgeGraphDocument } from "../lib/knowledge-evolution.mjs";
import { retrieveAcceptedKnowledge } from "../lib/knowledge-runtime.mjs";

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function parseDocument(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

async function rollback(client) {
  try { await client.query("rollback"); } catch { /* preserve the original failure */ }
}

export function createPostgresKnowledgeRuntime({ pool, ownerId, clock = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new Error("PostgreSQL knowledge runtime requires a pool with query() and connect()");
  nonEmpty(ownerId, "ownerId");

  return {
    provider: "postgres",
    ownerId,
    capabilities: Object.freeze({ transactions: true, optimisticConcurrency: true, durable: true, graphTraversal: true, repeatSessionRetrieval: true }),

    async projectGraph({ graph, expectedVersion = null }) {
      const validation = validateKnowledgeGraphDocument(graph);
      if (validation.length > 0) throw new Error(`PostgreSQL knowledge projection requires a valid graph:\n${validation.join("\n")}`);
      if (graph.authority?.ownerId !== ownerId) {
        throw new Error(`knowledge graph owner mismatch: expected ${ownerId}, received ${graph.authority?.ownerId ?? "missing"}`);
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${graph.graphId}`]);
        const currentResult = await client.query(
          "select graph_version, content_hash from nodekit.knowledge_projections where owner_id = $1 and graph_id = $2 for update",
          [ownerId, graph.graphId],
        );
        const current = currentResult.rows[0];
        const currentVersion = current ? Number(current.graph_version) : null;
        if (current && currentVersion === graph.version && current.content_hash === graph.contentHash) {
          await client.query("commit");
          return { applied: true, reused: true, conflict: false, actualVersion: graph.version };
        }
        if ((!current && expectedVersion !== null) || (current && expectedVersion !== currentVersion)) {
          await client.query("rollback");
          return { applied: false, reused: false, conflict: true, actualVersion: currentVersion };
        }
        if (current && graph.version !== currentVersion + 1) {
          throw new Error(`knowledge projection version must advance exactly once from ${currentVersion} to ${currentVersion + 1}`);
        }
        if (current) {
          await client.query(
            "update nodekit.knowledge_projections set graph_version = $3, content_hash = $4, graph_document = $5::jsonb, updated_at = $6::timestamptz where owner_id = $1 and graph_id = $2",
            [ownerId, graph.graphId, graph.version, graph.contentHash, JSON.stringify(graph), clock()],
          );
        } else {
          await client.query(
            "insert into nodekit.knowledge_projections (owner_id, graph_id, graph_version, content_hash, graph_document, updated_at) values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)",
            [ownerId, graph.graphId, graph.version, graph.contentHash, JSON.stringify(graph), clock()],
          );
        }
        await client.query("commit");
        return { applied: true, reused: false, conflict: false, actualVersion: graph.version };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async readGraph(graphId) {
      const result = await pool.query(
        "select graph_document from nodekit.knowledge_projections where owner_id = $1 and graph_id = $2",
        [ownerId, nonEmpty(graphId, "graphId")],
      );
      if (!result.rows[0]) throw new Error(`knowledge graph not found for owner ${ownerId}: ${graphId}`);
      const graph = parseDocument(result.rows[0].graph_document);
      const validation = validateKnowledgeGraphDocument(graph);
      if (validation.length > 0) throw new Error(`stored PostgreSQL knowledge graph is invalid:\n${validation.join("\n")}`);
      return graph;
    },

    async retrieve(input) {
      const graphId = nonEmpty(input?.graphId, "graphId");
      const sessionId = nonEmpty(input?.sessionId, "sessionId");
      const client = await pool.connect();
      try {
        await client.query("begin");
        const projectionResult = await client.query(
          "select graph_document from nodekit.knowledge_projections where owner_id = $1 and graph_id = $2",
          [ownerId, graphId],
        );
        if (!projectionResult.rows[0]) throw new Error(`knowledge graph not found for owner ${ownerId}: ${graphId}`);
        const graph = parseDocument(projectionResult.rows[0].graph_document);
        const validation = validateKnowledgeGraphDocument(graph);
        if (validation.length > 0) throw new Error(`stored PostgreSQL knowledge graph is invalid:\n${validation.join("\n")}`);
        await client.query(
          "insert into nodekit.knowledge_sessions (owner_id, graph_id, session_id, last_sequence, updated_at) values ($1, $2, $3, 0, $4::timestamptz) on conflict (owner_id, graph_id, session_id) do nothing",
          [ownerId, graphId, sessionId, clock()],
        );
        const sessionResult = await client.query(
          "select last_sequence from nodekit.knowledge_sessions where owner_id = $1 and graph_id = $2 and session_id = $3 for update",
          [ownerId, graphId, sessionId],
        );
        const historyResult = await client.query(
          "select receipt from nodekit.knowledge_retrieval_receipts where owner_id = $1 and graph_id = $2 and session_id = $3 order by sequence",
          [ownerId, graphId, sessionId],
        );
        const history = historyResult.rows.map((row) => parseDocument(row.receipt));
        const output = retrieveAcceptedKnowledge(graph, input, { ownerId, history, occurredAt: clock() });
        const nextSequence = Number(sessionResult.rows[0]?.last_sequence ?? 0) + 1;
        await client.query(
          "insert into nodekit.knowledge_retrieval_receipts (owner_id, graph_id, session_id, sequence, receipt_id, receipt_hash, receipt, occurred_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)",
          [ownerId, graphId, sessionId, nextSequence, output.receipt.receiptId, output.receipt.receiptHash, JSON.stringify(output.receipt), output.receipt.occurredAt],
        );
        await client.query(
          "update nodekit.knowledge_sessions set last_sequence = $4, updated_at = $5::timestamptz where owner_id = $1 and graph_id = $2 and session_id = $3",
          [ownerId, graphId, sessionId, nextSequence, output.receipt.occurredAt],
        );
        await client.query("commit");
        return output;
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async listSessionReceipts({ graphId, sessionId }) {
      const result = await pool.query(
        "select receipt from nodekit.knowledge_retrieval_receipts where owner_id = $1 and graph_id = $2 and session_id = $3 order by sequence",
        [ownerId, nonEmpty(graphId, "graphId"), nonEmpty(sessionId, "sessionId")],
      );
      return result.rows.map((row) => parseDocument(row.receipt));
    },
  };
}
