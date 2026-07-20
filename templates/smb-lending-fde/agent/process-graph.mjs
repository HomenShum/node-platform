function pathThroughGraph(graph, startId = "intake", goalId = "underwriter") {
  const adjacency = new Map();
  for (const [from, to] of graph.edges ?? []) {
    const next = adjacency.get(from) ?? [];
    next.push(to);
    adjacency.set(from, next);
  }
  const queue = [[startId]];
  const visited = new Set([startId]);
  while (queue.length) {
    const current = queue.shift();
    const node = current.at(-1);
    if (node === goalId) return current;
    for (const next of adjacency.get(node) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push([...current, next]); }
    }
  }
  throw new Error("the process graph has no bounded path to human underwriter review");
}
function missingEvidence(session) { return session.documents.filter((document) => document.status === "missing").map((document) => ({ documentId: document.id, label: document.label, sourceRef: document.sourceRef })); }
function requestedEvidence(session) { return session.documents.filter((document) => document.status === "requested").map((document) => ({ documentId: document.id, label: document.label, sourceRef: document.sourceRef })); }
export function queryProcessGraph(session, operation) {
  if (!session?.graph?.nodes || !session?.graph?.edges) throw new Error("a lending-file process graph is required");
  const criticalPath = pathThroughGraph(session.graph);
  const missing = missingEvidence(session);
  const requested = requestedEvidence(session);
  switch (operation) {
    case "why_blocked": return { answer: missing.length ? `Document collection is blocked by ${missing.map((item) => item.label).join(", ")}. The next bounded action is a human-reviewed request; no credit decision is available.` : requested.length ? `Document collection is waiting for ${requested.map((item) => item.label).join(", ")} to be supplied. This local request did not notify an applicant or bank.` : "No required source packet is marked missing. The file may advance only through the remaining human-owned stages.", evidence: missing.length ? missing : requested, highlightNodeIds: ["document-collection"], operation, pathNodeIds: criticalPath };
    case "critical_path": return { answer: `The bounded path is ${criticalPath.join(" -> ")}. It ends at human underwriter review and does not produce a lending decision.`, evidence: [...missing, ...requested], highlightNodeIds: criticalPath, operation, pathNodeIds: criticalPath };
    case "authority": return { answer: "The agent may inspect synthetic evidence and propose one missing-document request. A human underwriter or credit authority owns any credit decision, exception approval, and final file disposition.", evidence: [], highlightNodeIds: ["underwriter"], operation, pathNodeIds: criticalPath };
    default: throw new Error("unsupported graph question");
  }
}
