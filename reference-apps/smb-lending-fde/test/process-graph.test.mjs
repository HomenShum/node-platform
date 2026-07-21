import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { queryProcessGraph } from "../agent/process-graph.mjs";
import { startSession } from "../agent/experiment-loop.mjs";

test("process graph queries use edges, source references, and authority boundaries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-process-graph-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const session = await startSession(createFileStore(path.join(root, "session.json")));
  const blocked = queryProcessGraph(session, "why_blocked");
  assert.equal(blocked.highlightNodeIds[0], "document-collection");
  assert.equal(blocked.evidence[0].sourceRef.sha256, session.sourcePackets[0].sha256);
  const pathResult = queryProcessGraph(session, "critical_path");
  assert.deepEqual(pathResult.pathNodeIds, ["intake", "document-collection", "financial-spreading", "policy-review", "underwriter"]);
  assert.match(queryProcessGraph(session, "authority").answer, /human underwriter/i);
});
