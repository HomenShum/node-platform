import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../backend/filesystem/store.mjs";
import {
  approveProposal,
  createReceipt,
  deterministicProposal,
  runExperiment,
  startSession,
} from "../agent/experiment-loop.mjs";
import { assertSmbLendingPackRegistry } from "../agent/runtime/smb-lending-pack-registry.mjs";

test("compiled SMB lending pack fails closed when YAML declarations drift from concrete modules", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-pack-drift-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const authored = await readFile(path.resolve("packs", "primary", "pack.yaml"), "utf8");
  const drifted = path.join(root, "pack.yaml");
  await writeFile(drifted, authored.replace("lending.inspect-file", "lending.unimplemented-file"), "utf8");

  assert.throws(
    () => assertSmbLendingPackRegistry({ packPath: drifted }),
    /declaration\/module mismatch.*lending\.unimplemented-file/i,
  );
});

test("proposal, human approval, and receipt record concrete pack tool and validator hashes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-pack-runtime-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createFileStore(path.join(root, "session.json"));
  const session = await startSession(store);

  const proposed = await runExperiment(store, deterministicProposal(1, session));
  assert.equal(proposed.experiment.decision, "keep");
  const afterProposal = await store.load();
  const proposalTools = afterProposal.events
    .filter((entry) => entry.type === "tool.executed")
    .map((entry) => entry.details);
  assert.deepEqual(proposalTools.map((entry) => entry.toolId), [
    "lending.inspect-file",
    "lending.propose-document-request",
  ]);
  assert.ok(proposalTools.every((entry) => /^[a-f0-9]{64}$/.test(entry.outputHash)));
  const proposalValidators = afterProposal.events
    .filter((entry) => entry.type === "validator.completed")
    .map((entry) => entry.details);
  assert.deepEqual(proposalValidators.map((entry) => entry.validatorId), [
    "synthetic-data-only",
    "human-authority-boundary",
    "document-request-is-missing",
  ]);
  assert.ok(proposalValidators.every((entry) => entry.passed === true && /^[a-f0-9]{64}$/.test(entry.outputHash)));

  const approved = await approveProposal(store, proposed.experiment.id);
  assert.equal(approved.documents.find((document) => document.id === "operating-bank-statements-q2")?.status, "requested");
  const approvalEvent = approved.events.find((entry) => entry.type === "proposal.approved");
  assert.deepEqual(approvalEvent.details.registry.toolIds, ["lending.approve-proposal"]);
  assert.ok(approvalEvent.details.registry.toolOutputHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)));

  const receipt = await createReceipt(approved);
  assert.deepEqual(receipt.packRegistry.toolIds, [
    "lending.inspect-file",
    "lending.propose-document-request",
    "lending.approve-proposal",
  ]);
  assert.deepEqual(receipt.packRegistry.validatorIds, [
    "synthetic-data-only",
    "human-authority-boundary",
    "document-request-is-missing",
    "receipt-is-secret-free",
  ]);
  assert.deepEqual(receipt.packRegistry.receiptValidation.validatorIds, ["receipt-is-secret-free"]);
  assert.ok(receipt.packRegistry.receiptValidation.validatorOutputHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});
