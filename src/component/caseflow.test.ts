/// <reference types="vite/client" />
import { componentsGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { modules as componentModules, register } from "../convex-test.js";
import { createNodeKitCaseflowClient } from "../client/index.js";
import { compareCodeUnits, compareReceiptEventBindings, normalizeReceiptBindings } from "../lib/receipt-bindings.mjs";
import { PORTABLE_VALUE_LIMITS } from "../lib/portable-value.mjs";
import { api } from "./_generated/api.js";
import type { ComponentApi } from "./_generated/component.js";
import { canonicalize, contentHash, sha256 } from "./hash.js";
import schema from "./schema.js";
import { initConvexTest } from "./setup.js";

const ACTOR = { id: "user_1", type: "human" };
const SCOPE = "workspace_owner_1";

function artifactArgs<T extends Record<string, unknown> & { content: unknown }>(args: T): T & { contentHash: string } {
  return { ...args, contentHash: contentHash(args.content) };
}

function proposalArgs<T extends Record<string, unknown> & { patch: unknown }>(args: T): T & { patchHash: string } {
  return { ...args, patchHash: contentHash(args.patch) };
}

function exceptionArgs<T extends Record<string, unknown> & { preservedState?: unknown }>(args: T): T & { preservedStateHash: string } {
  return { ...args, preservedStateHash: contentHash(args.preservedState ?? {}) };
}

describe("NodeKit Caseflow Convex component", () => {
  test("defines an isolated nine-table schema and deterministic SHA-256", () => {
    expect(Object.keys(schema.tables).sort()).toEqual([
      "approvals",
      "artifactVersions",
      "artifacts",
      "cases",
      "exceptions",
      "proposals",
      "receipts",
      "runs",
      "timelineEvents",
    ]);
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(canonicalize({ a: 1, A: 2, _: 3 })).toBe('{"A":2,"_":3,"a":1}');
    expect(() => canonicalize({ "not-portable": true })).toThrow(/ASCII identifiers/);
    expect(normalizeReceiptBindings({
      approvalBindings: [{ approvalId: "approval_a" }, { approvalId: "approval_A" }],
      artifactBindings: [{ artifactId: "artifact_2" }, { artifactId: "artifact_10" }],
      eventBindings: [
        { aggregateId: "run_a", aggregateType: "run", eventId: "event_b", sequence: 2 },
        { aggregateId: "run_a", aggregateType: "run", eventId: "event_A", sequence: 2 },
      ],
      proposalBindings: [{ proposalId: "proposal_a" }, { proposalId: "proposal_A" }],
    })).toMatchObject({
      approvalBindings: [{ approvalId: "approval_A" }, { approvalId: "approval_a" }],
      artifactIds: ["artifact_10", "artifact_2"],
      eventIds: ["event_A", "event_b"],
      proposalIds: ["proposal_A", "proposal_a"],
    });

    const fixedReceiptBody = {
      approvalBindings: [{ approvalId: "approval_1", commentHash: "a".repeat(64), decision: "accepted", proposalId: "proposal_1" }],
      artifactBindings: [{ artifactId: "artifact_1", canonicalVersion: 2, contentHash: "b".repeat(64) }],
      artifactIds: ["artifact_1"],
      caseHash: "c".repeat(64),
      caseId: "case_1",
      eventBindings: [{ actorHash: "d".repeat(64), aggregateId: "run_1", aggregateType: "run", eventId: "event_1", eventType: "run.completed", payloadHash: "e".repeat(64), sequence: 1 }],
      eventIds: ["event_1"],
      generatedAt: "2026-07-21T00:00:00.000Z",
      proposalBindings: [{ artifactId: "artifact_1", baseVersion: 1, patchHash: "f".repeat(64), proposalId: "proposal_1", status: "accepted" }],
      proposalIds: ["proposal_1"],
      runHash: "0".repeat(64),
      runId: "run_1",
      schemaVersion: "nodekit.receipt/v2",
      status: "completed",
    };
    expect(contentHash(fixedReceiptBody)).toBe("ba7fa48da69643eccb656f75375168470f0c57fb5c400a4bb50b800f0e01f1d7");
  });

  test("rejects values that cannot round-trip across memory, Convex, and PostgreSQL", async () => {
    const arrayProperty = [1];
    Object.defineProperty(arrayProperty, "4294967295", { enumerable: true, value: "extra" });
    let arrayGetterCalls = 0;
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => {
      arrayGetterCalls += 1;
      return 1;
    } });
    const arrayNonEnumerable: unknown[] = [];
    Object.defineProperty(arrayNonEnumerable, "0", { enumerable: false, value: 1 });
    const nulKey: Record<string, unknown> = {};
    Object.defineProperty(nulKey, "nul\u0000key", { enumerable: true, value: 1 });
    const unpairedKey: Record<string, unknown> = {};
    Object.defineProperty(unpairedKey, "high\ud800", { enumerable: true, value: 1 });
    const reservedPrototypeKey = JSON.parse('{"__proto__":{"safe":true}}');
    const invalidValues: unknown[] = [
      undefined,
      new Date("2026-07-21T00:00:00.000Z"),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Array(1),
      arrayProperty,
      arrayAccessor,
      arrayNonEnumerable,
      Object.assign(Object.create({ inherited: true }), { value: 1 }),
      () => "no",
      Symbol("no"),
      "nul\u0000value",
      "high\ud800",
      "low\udc00",
      nulKey,
      unpairedKey,
      reservedPrototypeKey,
      { "not-portable": true },
    ];
    for (const value of invalidValues) expect(() => canonicalize(value)).toThrow(/portable value/);
    expect(arrayGetterCalls).toBe(0);
    const normalizedEdge = { negativeZero: -0, unicode: "𐀀" };
    expect(canonicalize(normalizedEdge)).toBe('{"negativeZero":0,"unicode":"𐀀"}');
    expect(() => canonicalize(Array.from({ length: PORTABLE_VALUE_LIMITS.maxArrayItems + 1 }, () => null))).toThrow(/arrays cannot exceed/);
    expect(() => canonicalize(Object.fromEntries(Array.from(
      { length: PORTABLE_VALUE_LIMITS.maxObjectFields + 1 },
      (_, index) => [`field_${index}`, null],
    )))).toThrow(/objects cannot exceed/);

    const t = initConvexTest();
    const work = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Preserve provider-portable JSON",
      scopeKey: SCOPE,
      title: "Portable value",
    });
    const run = await t.mutation(api.caseflow.startRun, {
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    });
    await expect(t.mutation(api.caseflow.createArtifact, {
      caseId: work.caseId,
      content: reservedPrototypeKey,
      contentHash: "0".repeat(64),
      runId: run.runId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/contentHash does not match/);
    const artifact = await t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: work.caseId,
      content: { negativeZero: -0, unicode: "𐀀" },
      runId: run.runId,
      scopeKey: SCOPE,
    }));
    const stored = artifact.versions[0]!.content as Record<string, unknown>;
    expect(Object.is(stored.negativeZero, 0)).toBe(true);
    expect(Object.is(stored.negativeZero, -0)).toBe(false);
    expect(stored.unicode).toBe("𐀀");
  });

  test("reserves Convex document depth for Caseflow envelopes at the real component boundary", async () => {
    const t = initConvexTest();
    const work = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Prove the provider nesting boundary",
      scopeKey: SCOPE,
      title: "Portable depth",
    });
    const run = await t.mutation(api.caseflow.startRun, {
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    });
    let atLimit: unknown = null;
    for (let depth = 0; depth < PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth; depth += 1) {
      atLimit = { value: atLimit };
    }
    const input = artifactArgs({
      caseId: work.caseId,
      content: atLimit,
      idempotencyKey: "depth-boundary",
      runId: run.runId,
      scopeKey: SCOPE,
    });
    const artifact = await t.mutation(api.caseflow.createArtifact, input);
    expect(await t.mutation(api.caseflow.createArtifact, input)).toEqual(artifact);
    const event = await t.run((ctx) => ctx.db
      .query("timelineEvents")
      .withIndex("by_scope_idempotency", (q) => q.eq("scopeKey", SCOPE).eq("idempotencyKey", "depth-boundary"))
      .unique());
    expect(event?.idempotencyResult).toBeDefined();

    await expect(t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: work.caseId,
      content: { value: atLimit },
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(`nesting exceeds ${PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth} levels`);
  });

  test("runs the scoped proposal lifecycle, conflict check, retry journal, and receipt v2", async () => {
    const t = initConvexTest();
    const work = await t.mutation(api.caseflow.createCase, {
      actor: ACTOR,
      primaryJob: "Capture an outcome",
      scopeKey: SCOPE,
      title: "Neutral case",
    });
    expect(work.caseId).toMatch(/^case_[a-f0-9]{26}$/);
    const updatedInput = await t.mutation(api.caseflow.updateCaseInput, {
      actor: ACTOR,
      caseId: work.caseId,
      primaryJob: "Produce a verified artifact",
      scopeKey: SCOPE,
      title: "Verified neutral case",
    });
    expect(updatedInput.primaryJob).toBe("Produce a verified artifact");
    const repeatedInput = await t.mutation(api.caseflow.updateCaseInput, {
      actor: ACTOR,
      caseId: work.caseId,
      primaryJob: "Produce a verified artifact",
      scopeKey: SCOPE,
      title: "Verified neutral case",
    });
    expect(repeatedInput).toEqual(updatedInput);
    expect(await t.query(api.caseflow.getCase, { caseId: work.caseId, scopeKey: "another_owner" })).toBeNull();
    await expect(t.mutation(api.caseflow.updateCaseInput, {
      caseId: work.caseId,
      primaryJob: "Cross-owner write",
      scopeKey: "another_owner",
    })).rejects.toThrow(/case not found/);

    const run = await t.mutation(api.caseflow.startRun, {
      actor: ACTOR,
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [
        { id: "intake", label: "Confirm outcome", owner: "user" },
        { id: "review", label: "Review proposal", owner: "user" },
        { id: "complete", label: "Verify completion", owner: "system" },
      ],
    });
    await expect(t.mutation(api.caseflow.startRun, {
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [
        { id: "intake", label: "Changed contract", owner: "user" },
        { id: "working", label: "Prepare a proposal", owner: "agent" },
        { id: "review", label: "Review the proposal", owner: "user" },
        { id: "complete", label: "Verify completion", owner: "system" },
      ],
    })).rejects.toThrow(/stage plan/);
    expect(run.runId).toMatch(/^run_[a-f0-9]{26}$/);
    const entered = await t.mutation(api.caseflow.enterStage, {
      actor: ACTOR,
      idempotencyKey: "enter-review-1",
      runId: run.runId,
      scopeKey: SCOPE,
      stageId: "review",
    });
    const enteredRetry = await t.mutation(api.caseflow.enterStage, {
      actor: ACTOR,
      idempotencyKey: "enter-review-1",
      runId: run.runId,
      scopeKey: SCOPE,
      stageId: "review",
    });
    expect(enteredRetry).toEqual(entered);
    await expect(t.mutation(api.caseflow.enterStage, {
      idempotencyKey: "enter-review-1",
      nextAction: "Different request",
      runId: run.runId,
      scopeKey: SCOPE,
      stageId: "review",
    })).rejects.toThrow(/different enterStage request/);

    const artifact = await t.mutation(api.caseflow.createArtifact, artifactArgs({
      actor: ACTOR,
      caseId: work.caseId,
      content: { state: "baseline" },
      idempotencyKey: "artifact-1",
      kind: "neutral",
      runId: run.runId,
      scopeKey: SCOPE,
      title: "Primary artifact",
    }));
    expect(artifact.artifactId).toMatch(/^artifact_[a-f0-9]{26}$/);
    const artifactRetry = await t.mutation(api.caseflow.createArtifact, artifactArgs({
      actor: ACTOR,
      caseId: work.caseId,
      content: { state: "baseline" },
      idempotencyKey: "artifact-1",
      kind: "neutral",
      runId: run.runId,
      scopeKey: SCOPE,
      title: "Primary artifact",
    }));
    expect(artifactRetry).toEqual(artifact);
    await expect(t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: work.caseId,
      content: { state: "different" },
      idempotencyKey: "artifact-1",
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/different createArtifact request/);
    const foreignCase = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Remain isolated",
      scopeKey: SCOPE,
      title: "Foreign case",
    });
    await expect(t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: foreignCase.caseId,
      content: { state: "must not bind" },
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run does not belong to case/);

    const first = await t.mutation(api.caseflow.createProposal, proposalArgs({
      actor: ACTOR,
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: "proposal-1",
      patch: { state: "accepted result" },
      rationale: "Bounded improvement",
      scopeKey: SCOPE,
    }));
    expect(first.proposalId).toMatch(/^proposal_[a-f0-9]{26}$/);
    const firstRetry = await t.mutation(api.caseflow.createProposal, proposalArgs({
      actor: ACTOR,
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: "proposal-1",
      patch: { state: "accepted result" },
      rationale: "Bounded improvement",
      scopeKey: SCOPE,
    }));
    expect(firstRetry).toEqual(first);
    const stale = await t.mutation(api.caseflow.createProposal, proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: "proposal-2",
      patch: { state: "must not overwrite" },
      scopeKey: SCOPE,
    }));
    const accepted = await t.mutation(api.caseflow.decideProposal, {
      actor: ACTOR,
      comment: "Reviewed",
      decision: "accepted",
      proposalId: first.proposalId,
      scopeKey: SCOPE,
    });
    const acceptedRetry = await t.mutation(api.caseflow.decideProposal, {
      actor: ACTOR,
      comment: "Reviewed",
      decision: "accepted",
      proposalId: first.proposalId,
      scopeKey: SCOPE,
    });
    expect(acceptedRetry.reused).toBe(true);
    expect(acceptedRetry.approval.approvalId).toBe(accepted.approval.approvalId);
    await expect(t.mutation(api.caseflow.decideProposal, {
      actor: ACTOR,
      comment: "Changed comment",
      decision: "accepted",
      proposalId: first.proposalId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/retry does not match/);
    await expect(t.mutation(api.caseflow.decideProposal, {
      actor: { id: "other-reviewer", type: "human" },
      comment: "Reviewed",
      decision: "accepted",
      proposalId: first.proposalId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/retry does not match/);
    const conflicted = await t.mutation(api.caseflow.decideProposal, {
      actor: ACTOR,
      decision: "accepted",
      proposalId: stale.proposalId,
      scopeKey: SCOPE,
    });
    expect(conflicted.proposal.status).toBe("conflicted");
    expect(conflicted.artifact.canonicalVersion).toBe(2);
    const pending = await t.mutation(api.caseflow.createProposal, proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 2,
      patch: { state: "still pending" },
      scopeKey: SCOPE,
    }));
    await expect(t.mutation(api.caseflow.completeRun, {
      runId: run.runId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/pending proposals/);
    await t.mutation(api.caseflow.decideProposal, {
      decision: "rejected",
      proposalId: pending.proposalId,
      scopeKey: SCOPE,
    });

    await t.mutation(api.caseflow.enterStage, {
      runId: run.runId,
      scopeKey: SCOPE,
      stageId: "complete",
    });
    const completed = await t.mutation(api.caseflow.completeRun, {
      actor: ACTOR,
      runId: run.runId,
      scopeKey: SCOPE,
    });
    expect(completed.receipt.schemaVersion).toBe("nodekit.receipt/v2");
    expect(completed.receipt.receiptId).toMatch(/^receipt_[a-f0-9]{26}$/);
    expect(completed.receipt.artifactBindings).toEqual([
      {
        artifactId: artifact.artifactId,
        canonicalVersion: 2,
        contentHash: contentHash({ state: "accepted result" }),
      },
    ]);
    expect(completed.receipt.proposalBindings).toHaveLength(3);
    expect(completed.receipt.approvalBindings).toHaveLength(3);
    expect(completed.receipt.artifactIds).toEqual(completed.receipt.artifactBindings.map((entry) => entry.artifactId));
    expect(completed.receipt.proposalIds).toEqual(completed.receipt.proposalBindings.map((entry) => entry.proposalId));
    expect(completed.receipt.eventIds).toEqual(completed.receipt.eventBindings.map((entry) => entry.eventId));
    expect(completed.receipt.artifactIds).toEqual([...completed.receipt.artifactIds].sort(compareCodeUnits));
    expect(completed.receipt.proposalIds).toEqual([...completed.receipt.proposalIds].sort(compareCodeUnits));
    expect(completed.receipt.approvalBindings.map((entry) => entry.approvalId)).toEqual(
      completed.receipt.approvalBindings.map((entry) => entry.approvalId).sort(compareCodeUnits),
    );
    expect(completed.receipt.eventBindings).toEqual([...completed.receipt.eventBindings].sort(compareReceiptEventBindings));
    expect(completed.receipt.eventBindings.every((entry) => /^[a-f0-9]{64}$/.test(entry.actorHash))).toBe(true);
    expect(completed.receipt.eventBindings.every((entry) => /^[a-f0-9]{64}$/.test(entry.payloadHash))).toBe(true);
    expect(completed.receipt.caseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.receipt.runHash).toMatch(/^[a-f0-9]{64}$/);
    const { receiptHash, receiptId: _receiptId, ...receiptBody } = completed.receipt;
    expect(contentHash(receiptBody)).toBe(receiptHash);
    const repeatedCompletion = await t.mutation(api.caseflow.completeRun, {
      actor: ACTOR,
      runId: run.runId,
      scopeKey: SCOPE,
    });
    expect(repeatedCompletion.reused).toBe(true);
    expect(repeatedCompletion.receipt).toEqual(completed.receipt);
    expect(await t.query(api.caseflow.getArtifact, {
      artifactId: artifact.artifactId,
      scopeKey: SCOPE,
    })).toEqual(accepted.artifact);
    await expect(t.mutation(api.caseflow.updateCaseInput, {
      caseId: work.caseId,
      primaryJob: "Too late",
      scopeKey: SCOPE,
    })).rejects.toThrow(/completed case/);
    await expect(t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: work.caseId,
      content: { state: "late" },
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run is terminal: completed/);
    await expect(t.mutation(api.caseflow.createProposal, proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 2,
      patch: { state: "late" },
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run is terminal: completed/);
    await expect(t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "late_exception",
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run is terminal: completed/);
  });

  test("resolving one of several exceptions keeps the run blocked", async () => {
    const t = initConvexTest();
    const work = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Recover safely",
      scopeKey: SCOPE,
      title: "Exception quorum",
    });
    const run = await t.mutation(api.caseflow.startRun, {
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    });
    const first = await t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "source_missing",
      idempotencyKey: "exception-1",
      preservedState: { completed: 2 },
      runId: run.runId,
      scopeKey: SCOPE,
    }));
    const firstRetry = await t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "source_missing",
      idempotencyKey: "exception-1",
      preservedState: { completed: 2 },
      runId: run.runId,
      scopeKey: SCOPE,
    }));
    expect(firstRetry).toEqual(first);
    const second = await t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "approval_missing",
      idempotencyKey: "exception-2",
      runId: run.runId,
      scopeKey: SCOPE,
    }));
    const partial = await t.mutation(api.caseflow.resolveException, {
      exceptionId: first.exceptionId,
      nextAction: "This must not reactivate yet",
      nextActionOwner: "agent",
      scopeKey: SCOPE,
    });
    expect(partial.run.status).toBe("blocked");
    expect(partial.run.nextAction).toBe("Resolve exception");
    expect(partial.run.nextActionOwner).toBe("user");
    const final = await t.mutation(api.caseflow.resolveException, {
      exceptionId: second.exceptionId,
      nextAction: "Resume preparation",
      nextActionOwner: "agent",
      scopeKey: SCOPE,
    });
    expect(final.run.status).toBe("active");
    expect(final.run.nextActionOwner).toBe("agent");
  });

  test("normalizes stages, blocks ordinary work during exceptions, and receipts safe terminal outcomes", async () => {
    const t = initConvexTest();
    const emptyCase = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Require a real artifact",
      scopeKey: SCOPE,
      title: "Terminal outcomes",
    });
    await expect(t.mutation(api.caseflow.startRun, {
      caseId: emptyCase.caseId,
      scopeKey: SCOPE,
      stages: [
        { id: "same", label: "First", owner: "agent" },
        { id: " same ", label: "Second", owner: "user" },
      ],
    })).rejects.toThrow(/stage ids must be unique/);
    const emptyRun = await t.mutation(api.caseflow.startRun, {
      caseId: emptyCase.caseId,
      scopeKey: SCOPE,
      stages: [{ id: " work ", label: " Work ", owner: " agent " }],
    });
    expect(emptyRun.currentStageId).toBe("work");
    expect(emptyRun.stages[0]).toMatchObject({ id: "work", label: "Work", owner: "agent" });
    await expect(t.mutation(api.caseflow.completeRun, {
      runId: emptyRun.runId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/at least one canonical artifact/);
    const cancellation = await t.mutation(api.caseflow.cancelRun, {
      actor: ACTOR,
      reason: "No longer needed",
      runId: emptyRun.runId,
      scopeKey: SCOPE,
    });
    expect(cancellation.receipt.status).toBe("cancelled");
    expect(cancellation.receipt.artifactIds).toEqual([]);
    const cancellationRetry = await t.mutation(api.caseflow.cancelRun, {
      actor: ACTOR,
      reason: "No longer needed",
      runId: emptyRun.runId,
      scopeKey: SCOPE,
    });
    expect(cancellationRetry.reused).toBe(true);
    await expect(t.mutation(api.caseflow.cancelRun, {
      actor: ACTOR,
      reason: "Different reason",
      runId: emptyRun.runId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/terminal retry does not match/);
    expect((await t.query(api.caseflow.getCase, { caseId: emptyCase.caseId, scopeKey: SCOPE }))?.status).toBe("ready");

    const failureCase = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Preserve partial progress",
      scopeKey: SCOPE,
      title: "Blocked safe failure",
    });
    const failureRun = await t.mutation(api.caseflow.startRun, {
      caseId: failureCase.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    });
    const artifact = await t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: failureCase.caseId,
      content: { partial: true },
      idempotencyKey: " artifact-once ",
      runId: failureRun.runId,
      scopeKey: SCOPE,
    }));
    const artifactRetry = await t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: failureCase.caseId,
      content: { partial: true },
      idempotencyKey: "artifact-once",
      runId: failureRun.runId,
      scopeKey: SCOPE,
    }));
    expect(artifactRetry.artifactId).toBe(artifact.artifactId);
    const pending = await t.mutation(api.caseflow.createProposal, proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { partial: "review" },
      scopeKey: SCOPE,
    }));
    const firstException = await t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "dependency_down",
      preservedState: { partial: true },
      runId: failureRun.runId,
      scopeKey: SCOPE,
    }));
    await t.mutation(api.caseflow.raiseException, exceptionArgs({
      code: "review_paused",
      runId: failureRun.runId,
      scopeKey: SCOPE,
    }));
    await expect(t.mutation(api.caseflow.enterStage, {
      runId: failureRun.runId,
      scopeKey: SCOPE,
      stageId: "work",
    })).rejects.toThrow(/run is not active: blocked/);
    await expect(t.mutation(api.caseflow.createArtifact, artifactArgs({
      caseId: failureCase.caseId,
      content: { late: true },
      runId: failureRun.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run is not active: blocked/);
    await expect(t.mutation(api.caseflow.createProposal, proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { late: true },
      scopeKey: SCOPE,
    }))).rejects.toThrow(/run is not active: blocked/);
    await expect(t.mutation(api.caseflow.decideProposal, {
      decision: "rejected",
      proposalId: pending.proposalId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/run is not active: blocked/);

    const failed = await t.mutation(api.caseflow.failRunSafely, {
      reason: "Dependency remains unavailable",
      runId: failureRun.runId,
      scopeKey: SCOPE,
    });
    expect(failed.receipt.status).toBe("failed_safely");
    expect(failed.receipt.artifactIds).toContain(artifact.artifactId);
    const failedRetry = await t.mutation(api.caseflow.failRunSafely, {
      reason: "Dependency remains unavailable",
      runId: failureRun.runId,
      scopeKey: SCOPE,
    });
    expect(failedRetry.reused).toBe(true);
    expect((await t.query(api.caseflow.getCase, { caseId: failureCase.caseId, scopeKey: SCOPE }))?.status).toBe("ready");
    await expect(t.mutation(api.caseflow.resolveException, {
      exceptionId: firstException.exceptionId,
      scopeKey: SCOPE,
    })).rejects.toThrow(/run is terminal: failed_safely/);
  });

  test("near-limit idempotent results stay separate from small domain event payloads", async () => {
    const t = initConvexTest();
    const work = await t.mutation(api.caseflow.createCase, {
      primaryJob: "Retry a large portable artifact safely",
      scopeKey: SCOPE,
      title: "Large idempotency result",
    });
    const run = await t.mutation(api.caseflow.startRun, {
      caseId: work.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    });
    const largeContent = { payload: "x".repeat(700 * 1_024) };
    const artifactInput = artifactArgs({
      caseId: work.caseId,
      content: largeContent,
      idempotencyKey: "large-artifact",
      runId: run.runId,
      scopeKey: SCOPE,
    });
    const artifact = await t.mutation(api.caseflow.createArtifact, artifactInput);
    expect(await t.mutation(api.caseflow.createArtifact, artifactInput)).toEqual(artifact);
    const proposalInput = proposalArgs({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: "large-proposal",
      patch: largeContent,
      scopeKey: SCOPE,
    });
    const proposal = await t.mutation(api.caseflow.createProposal, proposalInput);
    expect(await t.mutation(api.caseflow.createProposal, proposalInput)).toEqual(proposal);

    const events = await t.run((ctx) => ctx.db.query("timelineEvents").collect());
    for (const key of ["large-artifact", "large-proposal"]) {
      const event = events.find((entry) => entry.idempotencyKey === key);
      expect(event?.idempotencyResult).toBeDefined();
      expect(Object.hasOwn(event?.payload as object, "result")).toBe(false);
      expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThan(1_048_576);
    }
  });

  test("exports a registration helper that runs inside an empty convex-test host", async () => {
    const t = convexTest(undefined, componentModules);
    register(t);
    const components = componentsGeneric() as unknown as { nodekitCaseflow: ComponentApi<"nodekitCaseflow"> };
    const client = createNodeKitCaseflowClient(components.nodekitCaseflow);
    const created = await t.run((ctx) => ctx.runMutation(
      components.nodekitCaseflow.caseflow.createCase,
      { primaryJob: "Verify package registration", scopeKey: SCOPE, title: "Registered component" },
    ));
    expect(created.schemaVersion).toBe("nodekit.case/v1");
    const run = await t.run((ctx) => client.startRun(ctx, {
      caseId: created.caseId,
      scopeKey: SCOPE,
      stages: [{ id: "work", label: "Work", owner: "agent" }],
    }));
    const artifact = await t.run((ctx) => client.createArtifact(ctx, {
      caseId: created.caseId,
      content: { negativeZero: -0 },
      runId: run.runId,
      scopeKey: SCOPE,
    }));
    expect(Object.is((artifact.versions[0]!.content as { negativeZero: number }).negativeZero, 0)).toBe(true);
    await expect(t.run((ctx) => client.createArtifact(ctx, {
      caseId: created.caseId,
      content: JSON.parse('{"__proto__":{"unsafe":true}}'),
      runId: run.runId,
      scopeKey: SCOPE,
    }))).rejects.toThrow(/__proto__ is not supported/);
  });
});
