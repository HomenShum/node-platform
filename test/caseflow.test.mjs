import assert from "node:assert/strict";
import test from "node:test";
import { CASEFLOW_SCHEMA_VERSIONS, contentHash, createMemoryCaseflow } from "../src/lib/caseflow.mjs";
import { runCaseflowConformance } from "../src/lib/caseflow-conformance.mjs";
import { normalizePortableValue, PORTABLE_VALUE_LIMITS } from "../src/lib/portable-value.mjs";
import {
  compareCodeUnits,
  compareReceiptEventBindings,
  normalizeReceiptBindings,
} from "../src/lib/receipt-bindings.mjs";
import { negotiateRuntimeCapabilities, runtimeProfiles } from "../src/lib/runtime-capabilities.mjs";

test("memory runtime passes the provider-neutral adapter conformance suite", async () => {
  const result = await runCaseflowConformance(() => createMemoryCaseflow());
  assert.equal(result.passed, true);
  assert.equal(result.capabilities.provider, "memory");
});

test("host-bound conformance verifies server-derived identity without requiring caller actor control", async () => {
  const createHostBoundRuntime = () => {
    const runtime = createMemoryCaseflow();
    return new Proxy(runtime, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "decideProposal") {
          return (input) => target.decideProposal({ ...input, actor: { id: "authenticated-host-member", type: "human" } });
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  const result = await runCaseflowConformance(createHostBoundRuntime, {
    actorMode: "host-bound",
    verifyHostAuthorization: async ({ caseId, runtime }) => caseId.startsWith("case_") && Boolean(await runtime.snapshot()),
  });
  assert.equal(result.actorMode, "host-bound");
  assert.equal(result.assertions.hostAuthorizationBoundary, true);
  assert.equal(result.passed, true);

  const unproven = await runCaseflowConformance(createHostBoundRuntime, { actorMode: "host-bound" });
  assert.equal(unproven.assertions.hostAuthorizationBoundary, false);
  assert.equal(unproven.passed, false);
});

test("runtime capability negotiation is provider-native and fails closed", () => {
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.convex).passed, true);
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.postgres).passed, true);
  assert.equal(negotiateRuntimeCapabilities(runtimeProfiles.supabase).passed, true);
  const memoryProduction = negotiateRuntimeCapabilities(runtimeProfiles.memory);
  assert.equal(memoryProduction.passed, false);
  assert.equal(memoryProduction.missing.some((entry) => entry.name === "durableState"), true);
});

test("portable values reject representation drift before hashing or storage", () => {
  const sparse = [];
  sparse.length = 1;
  const arrayProperty = [1];
  Object.defineProperty(arrayProperty, "4294967295", { enumerable: true, value: "extra" });
  let arrayGetterCalls = 0;
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => {
    arrayGetterCalls += 1;
    return 1;
  } });
  const arrayNonEnumerable = [];
  Object.defineProperty(arrayNonEnumerable, "0", { enumerable: false, value: 1 });
  const customPrototype = Object.assign(Object.create({ inherited: true }), { value: 1 });
  const symbolKey = { value: 1 };
  symbolKey[Symbol("hidden")] = true;
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  const nulKey = {};
  Object.defineProperty(nulKey, "nul\u0000key", { enumerable: true, value: 1 });
  const unpairedKey = {};
  Object.defineProperty(unpairedKey, "high\ud800", { enumerable: true, value: 1 });
  const reservedPrototypeKey = JSON.parse('{"__proto__":{"safe":true}}');
  const invalid = [
    undefined,
    { nested: undefined },
    new Date(),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    sparse,
    arrayProperty,
    arrayAccessor,
    arrayNonEnumerable,
    customPrototype,
    () => true,
    Symbol("value"),
    symbolKey,
    accessor,
    "nul\u0000value",
    "high\ud800",
    "low\udc00",
    nulKey,
    unpairedKey,
    reservedPrototypeKey,
  ];
  for (const value of invalid) {
    assert.throws(() => normalizePortableValue(value), /portable value/);
    assert.throws(() => contentHash(value), /portable value/);
  }
  assert.equal(arrayGetterCalls, 0);
  const source = { z: [{ valid: true }], a: null };
  const normalized = normalizePortableValue(source);
  assert.deepEqual(normalized, source);
  assert.notEqual(normalized, source);
  assert.notEqual(normalized.z, source.z);

  const jsonEdge = { negativeZero: -0, unicode: "𐀀" };
  const normalizedEdge = normalizePortableValue(jsonEdge);
  assert.equal(Object.getPrototypeOf(normalizedEdge), Object.prototype);
  assert.equal(Object.is(normalizedEdge.negativeZero, 0), true);
  assert.equal(Object.is(normalizedEdge.negativeZero, -0), false);
  assert.equal(normalizedEdge.unicode, "𐀀");
  assert.equal(JSON.stringify(normalizedEdge), '{"negativeZero":0,"unicode":"𐀀"}');
});

test("portable values enforce the conservative Convex intersection at exact boundaries", () => {
  const arrayAtLimit = Array.from({ length: PORTABLE_VALUE_LIMITS.maxArrayItems }, () => null);
  assert.equal(normalizePortableValue(arrayAtLimit).length, PORTABLE_VALUE_LIMITS.maxArrayItems);
  assert.throws(
    () => normalizePortableValue(Array.from({ length: PORTABLE_VALUE_LIMITS.maxArrayItems + 1 }, () => null)),
    /arrays cannot exceed/,
  );

  const objectAtLimit = Object.fromEntries(Array.from(
    { length: PORTABLE_VALUE_LIMITS.maxObjectFields },
    (_, index) => [`field_${index}`, null],
  ));
  assert.equal(Object.keys(normalizePortableValue(objectAtLimit)).length, PORTABLE_VALUE_LIMITS.maxObjectFields);
  assert.throws(
    () => normalizePortableValue({ ...objectAtLimit, overflow: true }),
    /objects cannot exceed/,
  );

  const keyAtLimit = `a${"b".repeat(PORTABLE_VALUE_LIMITS.maxObjectKeyLength - 1)}`;
  assert.equal(Object.hasOwn(normalizePortableValue({ [keyAtLimit]: true }), keyAtLimit), true);
  assert.throws(
    () => normalizePortableValue({ [`a${"b".repeat(PORTABLE_VALUE_LIMITS.maxObjectKeyLength)}`]: true }),
    /keys cannot exceed/,
  );
  assert.throws(() => normalizePortableValue({ "not-portable": true }), /ASCII identifiers/);
  assert.throws(
    () => normalizePortableValue({ payload: "x".repeat(PORTABLE_VALUE_LIMITS.maxEncodedBytes) }),
    /encoded size cannot exceed/,
  );

  let atLimit = null;
  for (let depth = 0; depth < PORTABLE_VALUE_LIMITS.maxNestingDepth; depth += 1) atLimit = { value: atLimit };
  assert.doesNotThrow(() => normalizePortableValue(atLimit));
  assert.throws(() => normalizePortableValue({ value: atLimit }), /nesting exceeds/);
});

test("receipt bindings use locale-independent portable ID order and complete event tie-breakers", () => {
  const normalized = normalizeReceiptBindings({
    approvalBindings: [
      { approvalId: "approval_a" },
      { approvalId: "approval_-" },
      { approvalId: "approval_A" },
      { approvalId: "approval__" },
    ],
    artifactBindings: [
      { artifactId: "artifact_2" },
      { artifactId: "artifact_10" },
      { artifactId: "artifact_A" },
      { artifactId: "artifact_a" },
    ],
    eventBindings: [
      { aggregateId: "run_a", aggregateType: "run", eventId: "event_b", sequence: 2 },
      { aggregateId: "run_a", aggregateType: "run", eventId: "event_A", sequence: 2 },
      { aggregateId: "run_a", aggregateType: "run", eventId: "event_z", sequence: 10 },
      { aggregateId: "run_A", aggregateType: "run", eventId: "event_z", sequence: 1 },
      { aggregateId: "artifact_z", aggregateType: "artifact", eventId: "event_z", sequence: 1 },
    ],
    proposalBindings: [
      { proposalId: "proposal_a" },
      { proposalId: "proposal_-" },
      { proposalId: "proposal_A" },
      { proposalId: "proposal__" },
    ],
  });

  assert.deepEqual(normalized.artifactIds, ["artifact_10", "artifact_2", "artifact_A", "artifact_a"]);
  assert.deepEqual(normalized.proposalIds, ["proposal_-", "proposal_A", "proposal__", "proposal_a"]);
  assert.deepEqual(normalized.approvalBindings.map((entry) => entry.approvalId), ["approval_-", "approval_A", "approval__", "approval_a"]);
  assert.deepEqual(normalized.eventIds, ["event_z", "event_z", "event_A", "event_b", "event_z"]);
  assert.deepEqual(normalized.eventBindings.map(({ aggregateType, aggregateId, sequence, eventId }) =>
    `${aggregateType}:${aggregateId}:${sequence}:${eventId}`), [
    "artifact:artifact_z:1:event_z",
    "run:run_A:1:event_z",
    "run:run_a:2:event_A",
    "run:run_a:2:event_b",
    "run:run_a:10:event_z",
  ]);
  assert.equal(compareCodeUnits("A", "a") < 0, true);
  assert.equal(compareReceiptEventBindings(normalized.eventBindings[0], normalized.eventBindings[1]) < 0, true);
});

test("memory caseflow carries one guided transaction to a content-addressed receipt", () => {
  let tick = 0;
  const runtime = createMemoryCaseflow({ clock: () => `2026-07-21T00:00:${String(tick++).padStart(2, "0")}.000Z` });
  const work = runtime.createCase({ title: "Neutral case", primaryJob: "Produce one reviewable artifact" });
  const run = runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "intake", label: "Confirm the intended outcome", owner: "user" },
      { id: "working", label: "Prepare a proposal", owner: "agent" },
      { id: "review", label: "Review the proposal", owner: "user" },
      { id: "complete", label: "Verify completion", owner: "system" },
    ],
  });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Primary artifact", content: { state: "baseline" } });
  runtime.enterStage({ runId: run.runId, stageId: "working" });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { state: "reviewed result" }, rationale: "Complete the bounded case." });
  runtime.enterStage({ runId: run.runId, stageId: "review" });
  const decided = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  runtime.enterStage({ runId: run.runId, stageId: "complete" });
  const completed = runtime.completeRun({ runId: run.runId });

  assert.equal(runtime.capabilities.provider, "memory");
  assert.match(work.caseId, /^case_[a-f0-9]{26}$/);
  assert.match(run.runId, /^run_[a-f0-9]{26}$/);
  assert.match(artifact.artifactId, /^artifact_[a-f0-9]{26}$/);
  assert.match(proposal.proposalId, /^proposal_[a-f0-9]{26}$/);
  assert.equal(decided.artifact.canonicalVersion, 2);
  assert.equal(completed.receipt.schemaVersion, CASEFLOW_SCHEMA_VERSIONS.receipt);
  assert.match(completed.receipt.receiptId, /^receipt_[a-f0-9]{26}$/);
  assert.match(completed.receipt.receiptHash, /^[a-f0-9]{64}$/);
  const { receiptId: _receiptId, receiptHash: _receiptHash, ...receiptBody } = completed.receipt;
  assert.equal(contentHash(receiptBody), completed.receipt.receiptHash);
  assert.equal(completed.receipt.artifactBindings[0].contentHash, decided.artifact.versions.at(-1).contentHash);
  assert.equal(completed.receipt.proposalBindings[0].patchHash, contentHash(proposal.patch));
  assert.equal(completed.receipt.approvalBindings[0].decision, "accepted");
  assert.equal(completed.receipt.eventBindings.every((entry) => /^[a-f0-9]{64}$/.test(entry.actorHash) && /^[a-f0-9]{64}$/.test(entry.payloadHash)), true);
  assert.equal(runtime.snapshot().cases[0].status, "completed");
});

test("memory receipts normalize bindings and derive every ID array from that order", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Ordering case", primaryJob: "Normalize receipt bindings" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const artifacts = [1, 2, 3].map((value) => runtime.createArtifact({
    caseId: work.caseId,
    content: { value },
    runId: run.runId,
    title: `Artifact ${value}`,
  }));
  for (const artifact of artifacts) {
    const proposal = runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { accepted: artifact.title },
    });
    runtime.decideProposal({ decision: "accepted", proposalId: proposal.proposalId });
  }
  const { receipt } = runtime.completeRun({ runId: run.runId });

  assert.deepEqual(receipt.artifactIds, receipt.artifactBindings.map((entry) => entry.artifactId));
  assert.deepEqual(receipt.proposalIds, receipt.proposalBindings.map((entry) => entry.proposalId));
  assert.deepEqual(receipt.eventIds, receipt.eventBindings.map((entry) => entry.eventId));
  assert.deepEqual(receipt.artifactIds, [...receipt.artifactIds].sort(compareCodeUnits));
  assert.deepEqual(receipt.proposalIds, [...receipt.proposalIds].sort(compareCodeUnits));
  assert.deepEqual(
    receipt.approvalBindings.map((entry) => entry.approvalId),
    receipt.approvalBindings.map((entry) => entry.approvalId).sort(compareCodeUnits),
  );
  assert.deepEqual(receipt.eventBindings, [...receipt.eventBindings].sort(compareReceiptEventBindings));
});

test("memory caseflow fails stale proposals closed and preserves the canonical artifact", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Concurrency case", primaryJob: "Preserve human-authoritative state" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "review", label: "Review", owner: "user" }] });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Artifact", content: { value: 1 } });
  const first = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const stale = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 99 } });
  runtime.decideProposal({ proposalId: first.proposalId, decision: "accepted" });
  const result = runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });

  assert.equal(result.proposal.status, "conflicted");
  assert.equal(result.artifact.canonicalVersion, 2);
  assert.deepEqual(result.artifact.versions.at(-1).content, { value: 2 });
});

test("memory caseflow makes exception recovery and next-action ownership explicit", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Recovery case", primaryJob: "Recover without losing valid work" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "working", label: "Work", owner: "agent" }] });
  const raised = runtime.raiseException({ runId: run.runId, code: "source_unavailable", message: "A source could not be reached", preservedState: { completedItems: 2 } });
  assert.equal(runtime.snapshot().runs[0].status, "blocked");
  assert.equal(runtime.snapshot().runs[0].nextActionOwner, "user");
  const resolved = runtime.resolveException({ exceptionId: raised.exceptionId, resolution: "Use the attached source", nextAction: "Resume preparation", nextActionOwner: "agent" });
  assert.equal(resolved.run.status, "active");
  assert.equal(resolved.run.nextActionOwner, "agent");
});

test("case intake persists idempotently and multiple exceptions remain contained", () => {
  let tick = 0;
  const runtime = createMemoryCaseflow({ clock: () => `2026-07-21T00:02:${String(tick++).padStart(2, "0")}.000Z` });
  const work = runtime.createCase({ title: "Intake", primaryJob: "Draft outcome" });
  const updated = runtime.updateCaseInput({ caseId: work.caseId, primaryJob: "Confirmed outcome" });
  const repeated = runtime.updateCaseInput({ caseId: work.caseId, primaryJob: "Confirmed outcome" });
  assert.equal(updated.primaryJob, "Confirmed outcome");
  assert.equal(repeated.updatedAt, updated.updatedAt);
  assert.equal(runtime.snapshot().events.filter((entry) => entry.eventType === "case.updated").length, 1);
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "working", label: "Work", owner: "agent" }] });
  const first = runtime.raiseException({ runId: run.runId, code: "first" });
  const second = runtime.raiseException({ runId: run.runId, code: "second" });
  const partial = runtime.resolveException({ exceptionId: first.exceptionId, nextActionOwner: "agent" });
  assert.equal(partial.run.status, "blocked");
  assert.equal(partial.run.nextActionOwner, "user");
  const recovered = runtime.resolveException({ exceptionId: second.exceptionId, nextActionOwner: "agent" });
  assert.equal(recovered.run.status, "active");
  assert.equal(recovered.run.nextActionOwner, "agent");
});

test("memory caseflow retries decisions and completion without duplicate writes", () => {
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Retry safety", primaryJob: "Apply once" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  assert.throws(
    () => runtime.startRun({ caseId: work.caseId, stages: [{ id: "ignored", label: "Ignored", owner: "system" }] }),
    /stage plan/,
  );
  const reusedRun = runtime.startRun({ caseId: work.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  assert.equal(reusedRun.runId, run.runId);
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Result", content: { value: 1 } });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const actor = { id: "reviewer", type: "human" };
  const first = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted", actor, comment: "Exact review" });
  const repeated = runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted", actor, comment: "Exact review" });
  assert.equal(first.reused, false);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.approval.approvalId, first.approval.approvalId);
  assert.throws(
    () => runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted", actor, comment: "Changed" }),
    /retry does not match/,
  );
  assert.throws(
    () => runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted", actor: { id: "other", type: "human" }, comment: "Exact review" }),
    /retry does not match/,
  );
  assert.equal(runtime.snapshot().artifacts[0].versions.length, 2);
  const completed = runtime.completeRun({ runId: run.runId });
  const retriedCompletion = runtime.completeRun({ runId: run.runId });
  assert.equal(retriedCompletion.reused, true);
  assert.equal(retriedCompletion.receipt.receiptId, completed.receipt.receiptId);
  assert.equal(runtime.snapshot().receipts.length, 1);
});
