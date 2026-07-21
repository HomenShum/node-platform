import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { deterministicProposal, intervene, runExperiment, startSession } from "../agent/experiment-loop.mjs";

test("metric loop reverts regressions, persists intervention, and resumes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-loop-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createFileStore(path.join(root, "session.json"));
  const baseline = await startSession(store, { fixtureRoot: path.resolve("fixtures/corpus") });
  const bad = await runExperiment(store, deterministicProposal(0), { fixtureRoot: path.resolve("fixtures/corpus") });
  assert.equal(bad.experiment.decision, "revert");
  await intervene(store, "test context width; do not change the corpus");
  const good = await runExperiment(store, deterministicProposal(1), { fixtureRoot: path.resolve("fixtures/corpus") });
  assert.equal(good.experiment.decision, "keep");
  assert.match(good.experiment.intervention.instruction, /do not change the corpus/);
  const resumed = await startSession(store, { fixtureRoot: path.resolve("fixtures/corpus") });
  assert.equal(resumed.sessionId, baseline.sessionId);
  assert.equal(resumed.experiments.length, 2);
});
