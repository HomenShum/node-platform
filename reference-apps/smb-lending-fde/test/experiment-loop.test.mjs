import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../backend/filesystem/store.mjs";
import { approveProposal, deterministicProposal, intervene, listSyntheticCases, nextDeterministicProposal, runExperiment, startSession } from "../agent/experiment-loop.mjs";

test("lending loop rejects credit decisions, proposes a bounded request, persists intervention, and resumes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-loop-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createFileStore(path.join(root, "session.json"));
  const baseline = await startSession(store);
  assert.equal(baseline.sourcePackets.length, 1);
  assert.match(baseline.sourcePackets[0].sha256, /^[a-f0-9]{64}$/);
  const bad = await runExperiment(store, deterministicProposal(0));
  assert.equal(bad.experiment.decision, "revert");
  assert.match(bad.experiment.reason, /human-underwriter-only/);
  assert.equal(nextDeterministicProposal(await store.load()).action, "request_document");
  await intervene(store, "request the operating statements; do not change the lending authority boundary");
  const good = await runExperiment(store, deterministicProposal(1));
  assert.equal(good.experiment.decision, "keep");
  assert.match(good.experiment.intervention.instruction, /lending authority boundary/);
  assert.equal(good.experiment.proposal.status, "pending_approval");
  assert.equal(good.experiment.proposal.evidence[0].sourceRef.sha256, baseline.sourcePackets[0].sha256);
  assert.match(good.experiment.proposal.evidence[0].sourceRef.locator, /^\/documents\//);
  const approved = await approveProposal(store, good.experiment.id);
  assert.equal(approved.documents.find((document) => document.id === "operating-bank-statements-q2").status, "requested");
  approved.status = "proposing";
  await store.save(approved);
  const resumed = await startSession(store);
  assert.equal(resumed.sessionId, baseline.sessionId);
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.proposals.length, 1);
  assert.ok(resumed.events.some((entry) => entry.type === "session.recovered"));
});

test("held-out healthcare fixture receives a case-specific bounded document request", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-lending-heldout-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createFileStore(path.join(root, "session.json"));
  const cases = listSyntheticCases();
  assert.equal(cases.some((entry) => entry.caseId === "harbor-view-medical-equipment"), true);
  const session = await startSession(store, { caseId: "harbor-view-medical-equipment" });
  const outOfBounds = await runExperiment(store, deterministicProposal(0, session));
  assert.equal(outOfBounds.experiment.decision, "revert");
  const request = await runExperiment(store, deterministicProposal(1, session));
  assert.equal(request.experiment.proposal.documentId, "guarantor-personal-financial-statement");
  const approved = await approveProposal(store, request.experiment.id);
  assert.equal(approved.documents.find((document) => document.id === "guarantor-personal-financial-statement").status, "requested");
});

test("live proposals fail closed without explicit per-action consent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-lending-live-consent-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createFileStore(path.join(root, "session.json"));
  const session = await startSession(store);
  const result = await runExperiment(store, {
    action: "request_document",
    documentId: session.readiness.missingDocumentIds[0],
    model: { id: "test-model", mode: "live", provider: "test-provider" },
    rationale: "Test the explicit external-model consent boundary.",
  });
  assert.equal(result.experiment.decision, "revert");
  assert.match(result.experiment.reason, /explicit per-action consent/);
});
