import { createHash } from "node:crypto";
import { compileModelIntelligence } from "./model-intelligence.mjs";
import { proposeGraphPatch, readKnowledgeGraph } from "./knowledge-evolution.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function safe(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_.:/-]+/g, "-").replace(/-+/g, "-");
}

export async function proposeHarnessKnowledgePatch(repoRoot, {
  graphPath,
  agentId = "nodekit:harness-knowledge-compiler",
} = {}) {
  const graph = await readKnowledgeGraph(repoRoot, { graphPath });
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const existing = new Set([...graph.nodes, ...graph.hyperedges].map((entity) => entity.id));
  const operations = [];
  const evidenceRefs = [];

  function insertNode(node) {
    if (existing.has(node.id)) return;
    existing.add(node.id);
    operations.push({ type: "INSERT", node });
  }

  function insertHyperedge(hyperedge) {
    if (existing.has(hyperedge.id)) return;
    existing.add(hyperedge.id);
    operations.push({ type: "INSERT", hyperedge });
  }

  for (const observation of compiled.observations) {
    const observationHash = hash(observation);
    const evidenceId = `evidence:model-observation:${safe(observation.runId)}@${observationHash.slice(0, 12)}`;
    evidenceRefs.push(evidenceId);
    insertNode({
      id: evidenceId,
      kind: "evidence",
      label: `Evaluated model observation ${observation.runId}`,
      layer: "source",
      confidence: 1,
      evidenceRefs: [],
      contentHash: observationHash,
      sourceUri: `nodekit:model-observation:${observation.runId}`,
      capturedAt: observation.observedAt ?? new Date(0).toISOString(),
      properties: { proofReceiptId: observation.proofReceiptId, evidenceRefs: observation.evidenceRefs },
    });

    const taskId = `task:${safe(observation.applicationId)}:${safe(observation.taskId)}`;
    const modelId = `model:${safe(observation.model.resolvedProvider)}:${safe(observation.model.resolvedModel)}`;
    const harnessId = `harness:${safe(observation.applicationId)}:${safe(observation.harness.version)}@${observation.harness.hash.slice(0, 12)}`;
    insertNode({ id: taskId, kind: "task", label: `${observation.taskFamily}: ${observation.taskId}`, layer: "derived", confidence: 1, evidenceRefs: [evidenceId], properties: { applicationId: observation.applicationId, taskFamily: observation.taskFamily } });
    insertNode({ id: modelId, kind: "model", label: `${observation.model.resolvedProvider}/${observation.model.resolvedModel}`, layer: "derived", confidence: 1, evidenceRefs: [evidenceId], properties: observation.model });
    insertNode({ id: harnessId, kind: "harness", label: `Harness ${observation.harness.version}`, layer: "derived", confidence: 1, evidenceRefs: [evidenceId], properties: observation.harness });

    const participants = [
      { nodeId: evidenceId, role: "observation" },
      { nodeId: taskId, role: "task" },
      { nodeId: modelId, role: "model" },
      { nodeId: harnessId, role: "harness" },
    ];
    for (const failure of observation.failures) {
      const failureId = `failure:${safe(observation.applicationId)}:${safe(failure.failureId)}`;
      insertNode({ id: failureId, kind: "failure", label: failure.failureClass, layer: "derived", confidence: 1, evidenceRefs: [evidenceId], properties: failure });
      participants.push({ nodeId: failureId, role: "failure" });
    }
    insertHyperedge({
      id: `hyperedge:model-run:${safe(observation.runId)}@${observationHash.slice(0, 12)}`,
      predicate: "model-performed-task-under-harness",
      layer: "derived",
      participants,
      confidence: 1,
      evidenceRefs: [evidenceId],
      properties: {
        cognitive: observation.cognitive,
        execution: observation.execution,
        artifact: observation.artifact,
        efficiency: observation.efficiency,
      },
    });
  }

  if (operations.length === 0) return { unchanged: true, patch: null, observationCount: compiled.observations.length };
  const patch = await proposeGraphPatch(repoRoot, {
    operations,
    evidenceRefs,
    contradictionRefs: [],
    proposedBy: {
      agentId,
      modelRoute: "deterministic-compiler",
      resolvedModel: "none",
      harnessVersion: compiled.harness.version,
    },
    confidence: 1,
  }, { graphPath });
  return { unchanged: false, patch, observationCount: compiled.observations.length };
}
