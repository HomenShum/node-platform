/**
 * Provider-neutral Caseflow conformance. An adapter may return values directly
 * or as promises; the suite observes behavior rather than storage mechanics.
 */
export async function runCaseflowConformance(createRuntime, {
  actorMode = "caller-supplied",
  requiredCapabilities = { optimisticConcurrency: true, transactions: true },
  verifyHostAuthorization,
} = {}) {
  if (!new Set(["caller-supplied", "host-bound"]).has(actorMode)) throw new Error(`unsupported conformance actorMode: ${actorMode}`);
  const runtime = await createRuntime();
  const work = await runtime.createCase({ title: "Adapter conformance", primaryJob: "Preserve one reviewed artifact" });
  const updatedWork = await runtime.updateCaseInput({ caseId: work.caseId, primaryJob: "Preserve one reviewed and verified artifact" });
  const repeatedUpdate = await runtime.updateCaseInput({ caseId: work.caseId, primaryJob: "Preserve one reviewed and verified artifact" });
  let invalidStagesRejected = false;
  try {
    await runtime.startRun({
      caseId: work.caseId,
      stages: [
        { id: "duplicate", label: "First", owner: "agent" },
        { id: " duplicate ", label: "Second", owner: "user" },
      ],
    });
  } catch (error) {
    invalidStagesRejected = /stage ids must be unique/.test(String(error?.message));
  }
  const run = await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: " working ", label: " Prepare ", owner: " agent " },
      { id: " review ", label: " Review ", owner: " user " },
      { id: " complete ", label: " Complete ", owner: " system " },
    ],
  });
  const reusedRun = await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "working", label: "Prepare", owner: "agent" },
      { id: "review", label: "Review", owner: "user" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  });
  let mismatchedActiveRunPlanRejected = false;
  try {
    await runtime.startRun({
      caseId: work.caseId,
      stages: [
        { id: "working", label: "A different contract", owner: "agent" },
        { id: "review", label: "Review", owner: "user" },
        { id: "complete", label: "Complete", owner: "system" },
      ],
    });
  } catch (error) {
    mismatchedActiveRunPlanRejected = /stage plan/.test(String(error?.message));
  }
  const artifactInput = { caseId: work.caseId, runId: run.runId, title: "Artifact", content: { value: 1 }, idempotencyKey: " conformance-artifact " };
  const artifact = await runtime.createArtifact(artifactInput);
  const repeatedArtifact = await runtime.createArtifact({ ...artifactInput, idempotencyKey: "conformance-artifact" });
  let conflictingRetryFailedClosed = false;
  try {
    await runtime.createArtifact({ ...artifactInput, content: { value: 404 } });
  } catch (error) {
    conflictingRetryFailedClosed = /idempotencyKey was already used for a different request/.test(String(error?.message));
  }
  const acceptedInput = { artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 2 }, idempotencyKey: "conformance-proposal" };
  const accepted = await runtime.createProposal(acceptedInput);
  const repeatedProposal = await runtime.createProposal(acceptedInput);
  const stale = await runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { value: 99 } });
  const decisionActor = { id: "conformance-reviewer", type: "human" };
  const firstDecision = await runtime.decideProposal({ proposalId: accepted.proposalId, decision: "accepted", actor: decisionActor, comment: "Reviewed exactly" });
  const repeatedDecision = await runtime.decideProposal({ proposalId: accepted.proposalId, decision: "accepted", actor: decisionActor, comment: "Reviewed exactly" });
  let mismatchedDecisionRetryRejected = false;
  try {
    await runtime.decideProposal({ proposalId: accepted.proposalId, decision: "accepted", actor: decisionActor, comment: "Changed comment" });
  } catch (error) {
    mismatchedDecisionRetryRejected = /retry does not match/.test(String(error?.message));
  }
  let mismatchedDecisionActorRejected = false;
  let alternateActorDecision = null;
  try {
    alternateActorDecision = await runtime.decideProposal({ proposalId: accepted.proposalId, decision: "accepted", actor: { id: "other-reviewer", type: "human" }, comment: "Reviewed exactly" });
  } catch (error) {
    mismatchedDecisionActorRejected = /retry does not match/.test(String(error?.message));
  }
  const staleDecision = await runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });
  const pending = await runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 2, patch: { value: 3 } });
  let pendingProposalBlockedCompletion = false;
  try {
    await runtime.completeRun({ runId: run.runId });
  } catch (error) {
    pendingProposalBlockedCompletion = /pending proposals/.test(String(error?.message));
  }
  await runtime.decideProposal({ proposalId: pending.proposalId, decision: "rejected" });
  const blockedPending = await runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 2, patch: { value: 5 } });
  const exceptionInput = { runId: run.runId, code: "conformance_pause", message: "Exercise recovery", preservedState: { canonicalVersion: 2 }, idempotencyKey: "conformance-exception" };
  const raised = await runtime.raiseException(exceptionInput);
  const repeatedException = await runtime.raiseException(exceptionInput);
  const secondRaised = await runtime.raiseException({ runId: run.runId, code: "conformance_review", message: "Exercise multiple exception containment", preservedState: { canonicalVersion: 2 } });
  const blockedMutationResults = await Promise.all([
    () => runtime.enterStage({ runId: run.runId, stageId: "review" }),
    () => runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Blocked artifact", content: { value: 6 } }),
    () => runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 2, patch: { value: 6 } }),
    () => runtime.decideProposal({ proposalId: blockedPending.proposalId, decision: "rejected" }),
  ].map(async (operation) => {
    try {
      await operation();
      return false;
    } catch (error) {
      return /run is not active: blocked/.test(String(error?.message));
    }
  }));
  const partialRecovery = await runtime.resolveException({ exceptionId: raised.exceptionId, resolution: "First issue resolved", nextAction: "Verify", nextActionOwner: "system" });
  const recovered = await runtime.resolveException({ exceptionId: secondRaised.exceptionId, resolution: "Resume", nextAction: "Verify", nextActionOwner: "system" });
  await runtime.decideProposal({ proposalId: blockedPending.proposalId, decision: "rejected" });
  const stageInput = { runId: run.runId, stageId: "complete", idempotencyKey: "conformance-stage" };
  const enteredStage = await runtime.enterStage(stageInput);
  const repeatedStage = await runtime.enterStage(stageInput);
  const completed = await runtime.completeRun({ runId: run.runId });
  const repeatedCompletion = await runtime.completeRun({ runId: run.runId });
  const snapshot = await runtime.snapshot();
  const terminalMutationResults = await Promise.all([
    () => runtime.createArtifact({ caseId: work.caseId, runId: run.runId, title: "Late artifact", content: { value: 4 } }),
    () => runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 2, patch: { value: 4 } }),
    () => runtime.raiseException({ runId: run.runId, code: "late_exception" }),
  ].map(async (operation) => {
    try {
      await operation();
      return false;
    } catch (error) {
      return /run is terminal: completed/.test(String(error?.message));
    }
  }));
  const isolationSource = await runtime.createCase({ title: "Isolation source", primaryJob: "Own a run" });
  const isolationTarget = await runtime.createCase({ title: "Isolation target", primaryJob: "Reject a foreign run" });
  const isolationRun = await runtime.startRun({ caseId: isolationSource.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  let crossCaseArtifactRejected = false;
  try {
    await runtime.createArtifact({ caseId: isolationTarget.caseId, runId: isolationRun.runId, title: "Cross-case artifact", content: {} });
  } catch (error) {
    crossCaseArtifactRejected = /run does not belong to case|run not found/.test(String(error?.message));
  }
  const { receiptId: _receiptId, receiptHash: _receiptHash, ...receiptBody } = completed.receipt;
  const canonicalArtifact = snapshot.artifacts.find((entry) => entry.artifactId === artifact.artifactId);
  const acceptedBinding = completed.receipt.proposalBindings.find((entry) => entry.proposalId === accepted.proposalId);

  const noArtifactCase = await runtime.createCase({ title: "No artifact completion", primaryJob: "Reject false completion" });
  const noArtifactRun = await runtime.startRun({ caseId: noArtifactCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  let noArtifactCompletionRejected = false;
  try {
    await runtime.completeRun({ runId: noArtifactRun.runId });
  } catch (error) {
    noArtifactCompletionRejected = /at least one canonical artifact/.test(String(error?.message));
  }
  const cancelActor = { id: "conformance-user", type: "human" };
  const cancellation = await runtime.cancelRun({ runId: noArtifactRun.runId, reason: "No longer needed", actor: cancelActor });
  const repeatedCancellation = await runtime.cancelRun({ runId: noArtifactRun.runId, reason: "No longer needed", actor: cancelActor });
  let mismatchedCancellationRejected = false;
  try {
    await runtime.cancelRun({ runId: noArtifactRun.runId, reason: "Different reason", actor: cancelActor });
  } catch (error) {
    mismatchedCancellationRejected = /terminal retry does not match/.test(String(error?.message));
  }

  const failureCase = await runtime.createCase({ title: "Safe failure", primaryJob: "Preserve partial state" });
  const failureRun = await runtime.startRun({ caseId: failureCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const failureArtifact = await runtime.createArtifact({ caseId: failureCase.caseId, runId: failureRun.runId, content: { partial: true } });
  const failedSafely = await runtime.failRunSafely({ runId: failureRun.runId, reason: "Dependency unavailable" });
  const repeatedFailure = await runtime.failRunSafely({ runId: failureRun.runId, reason: "Dependency unavailable" });
  const terminalSnapshot = await runtime.snapshot();

  const arrayProperty = [1];
  Object.defineProperty(arrayProperty, "4294967295", { enumerable: true, value: "extra" });
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => "read must not execute" });
  const arrayNonEnumerable = [];
  Object.defineProperty(arrayNonEnumerable, "0", { enumerable: false, value: "hidden" });
  const nulKey = {};
  Object.defineProperty(nulKey, "nul\u0000key", { enumerable: true, value: true });
  const unpairedKey = {};
  Object.defineProperty(unpairedKey, "high\ud800", { enumerable: true, value: true });
  let overNested = null;
  for (let depth = 0; depth < 17; depth += 1) overNested = { value: overNested };
  const invalidValues = [
    undefined,
    new Date("2026-07-21T00:00:00.000Z"),
    1n,
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
    JSON.parse('{"__proto__":{"safe":true}}'),
    { "not-portable": true },
    Array.from({ length: 8_193 }, () => null),
    Object.fromEntries(Array.from({ length: 1_025 }, (_, index) => [`field_${index}`, null])),
    overNested,
  ];
  const portableValueRejections = await Promise.all(invalidValues.map(async (content) => {
    const valueCase = await runtime.createCase({ title: "Portable value", primaryJob: "Reject unsupported data" });
    const valueRun = await runtime.startRun({ caseId: valueCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
    try {
      await runtime.createArtifact({ caseId: valueCase.caseId, runId: valueRun.runId, content });
      return false;
    } catch (error) {
      return /portable value/.test(String(error?.message));
    }
  }));
  const normalizedValueCase = await runtime.createCase({ title: "Normalized portable value", primaryJob: "Preserve JSON semantics" });
  const normalizedValueRun = await runtime.startRun({ caseId: normalizedValueCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const normalizedValueArtifact = await runtime.createArtifact({
    caseId: normalizedValueCase.caseId,
    runId: normalizedValueRun.runId,
    content: { negativeZero: -0, unicode: "𐀀" },
  });
  const normalizedValue = normalizedValueArtifact.versions[0].content;

  let hostAuthorizationEnforced = actorMode === "caller-supplied";
  if (actorMode === "host-bound" && typeof verifyHostAuthorization === "function") {
    try {
      hostAuthorizationEnforced = await verifyHostAuthorization({
        artifactId: artifact.artifactId,
        caseId: work.caseId,
        proposalId: accepted.proposalId,
        runId: run.runId,
        runtime,
      }) === true;
    } catch {
      hostAuthorizationEnforced = false;
    }
  }

  let payloadAtDepthLimit = null;
  for (let depth = 0; depth < PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth; depth += 1) {
    payloadAtDepthLimit = { value: payloadAtDepthLimit };
  }
  const depthCase = await runtime.createCase({ title: "Portable depth", primaryJob: "Preserve the provider boundary" });
  const depthRun = await runtime.startRun({ caseId: depthCase.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
  const depthInput = {
    caseId: depthCase.caseId,
    content: payloadAtDepthLimit,
    idempotencyKey: "portable-depth-boundary",
    runId: depthRun.runId,
  };
  const depthArtifact = await runtime.createArtifact(depthInput);
  const repeatedDepthArtifact = await runtime.createArtifact(depthInput);
  let overDepthPayloadRejected = false;
  try {
    await runtime.createArtifact({
      caseId: depthCase.caseId,
      content: { value: payloadAtDepthLimit },
      runId: depthRun.runId,
    });
  } catch (error) {
    overDepthPayloadRejected = /nesting exceeds/.test(String(error?.message));
  }

  const assertions = {
    activeRunStartIsIdempotent: reusedRun.runId === run.runId,
    activeRunStagePlanMismatchFailsClosed: mismatchedActiveRunPlanRejected,
    blockedRunRejectsOrdinaryMutations: blockedMutationResults.every(Boolean),
    caseInputUpdateIsIdempotent: updatedWork.primaryJob === "Preserve one reviewed and verified artifact"
      && repeatedUpdate.updatedAt === updatedWork.updatedAt,
    canonicalVersionAdvancedOnce: firstDecision.artifact.canonicalVersion === 2,
    contentAddressedReceipt: completed.receipt.schemaVersion === "nodekit.receipt/v2"
      && /^[a-f0-9]{64}$/.test(completed.receipt.receiptHash)
      && contentHash(receiptBody) === completed.receipt.receiptHash
      && completed.receipt.artifactBindings.some((entry) => entry.artifactId === artifact.artifactId
        && entry.canonicalVersion === canonicalArtifact.canonicalVersion
        && entry.contentHash === canonicalArtifact.versions.at(-1).contentHash)
      && acceptedBinding.patchHash === contentHash(accepted.patch)
      && completed.receipt.approvalBindings.some((entry) => entry.approvalId === firstDecision.approval.approvalId)
      && completed.receipt.eventBindings.length > 0
      && completed.receipt.eventBindings.every((entry) => /^[a-f0-9]{64}$/.test(entry.actorHash) && /^[a-f0-9]{64}$/.test(entry.payloadHash)),
    exceptionStatePreserved: raised.preservedState.canonicalVersion === 2,
    explicitRetryKeysAreIdempotent: repeatedArtifact.artifactId === artifact.artifactId
      && repeatedProposal.proposalId === accepted.proposalId
      && repeatedException.exceptionId === raised.exceptionId
      && repeatedStage.updatedAt === enteredStage.updatedAt,
    idempotencyKeyReuseWithDifferentInputFailsClosed: conflictingRetryFailedClosed,
    idempotencyKeysAreTrimmed: repeatedArtifact.artifactId === artifact.artifactId,
    hostAuthorizationBoundary: hostAuthorizationEnforced,
    invalidPortableValuesFailClosed: portableValueRejections.every(Boolean),
    portablePayloadDepthReservesProviderEnvelope: depthArtifact.artifactId === repeatedDepthArtifact.artifactId
      && overDepthPayloadRejected,
    portableNormalizationPreservesJsonSemantics: Object.getPrototypeOf(normalizedValue) === Object.prototype
      && Object.is(normalizedValue.negativeZero, 0)
      && !Object.is(normalizedValue.negativeZero, -0)
      && normalizedValue.unicode === "𐀀",
    invalidStagesFailClosed: invalidStagesRejected,
    multipleExceptionsRemainBlocked: partialRecovery.run.status === "blocked" && partialRecovery.run.nextActionOwner === "user",
    nextActionOwnerExplicit: recovered.run.nextActionOwner === "system",
    oneAuthoritativeCase: snapshot.cases.length === 1 && snapshot.cases[0].status === "completed",
    pendingProposalBlocksCompletion: pendingProposalBlockedCompletion,
    successfulCompletionRequiresCanonicalArtifact: noArtifactCompletionRejected,
    repeatedCompletionIsIdempotent: repeatedCompletion.reused === true
      && repeatedCompletion.receipt.receiptId === completed.receipt.receiptId
      && repeatedCompletion.receipt.receiptHash === completed.receipt.receiptHash,
    repeatedDecisionIsIdempotent: repeatedDecision.reused === true
      && repeatedDecision.approval.approvalId === firstDecision.approval.approvalId
      && repeatedDecision.artifact.canonicalVersion === 2
      && mismatchedDecisionRetryRejected
      && (actorMode === "host-bound"
        ? alternateActorDecision?.reused === true
          && alternateActorDecision.approval.approvalId === firstDecision.approval.approvalId
          && alternateActorDecision.artifact.canonicalVersion === 2
        : mismatchedDecisionActorRejected),
    staleProposalFailedClosed: staleDecision.proposal.status === "conflicted"
      && staleDecision.artifact.versions.at(-1).content.value === 2,
    terminalReceiptBoundaryIsImmutable: terminalMutationResults.every(Boolean),
    runCannotBindArtifactAcrossCases: crossCaseArtifactRejected,
    stageDefinitionsAreTrimmed: run.currentStageId === "working"
      && run.stages[0].label === "Prepare"
      && run.stages[0].owner === "agent",
    terminalCancellationIsReceiptedAndIdempotent: cancellation.receipt.status === "cancelled"
      && cancellation.run.status === "cancelled"
      && repeatedCancellation.reused === true
      && repeatedCancellation.receipt.receiptId === cancellation.receipt.receiptId
      && mismatchedCancellationRejected
      && terminalSnapshot.cases.find((entry) => entry.caseId === noArtifactCase.caseId)?.status === "ready",
    terminalFailureIsReceiptedAndPreservesArtifacts: failedSafely.receipt.status === "failed_safely"
      && failedSafely.receipt.artifactIds.includes(failureArtifact.artifactId)
      && repeatedFailure.reused === true
      && terminalSnapshot.cases.find((entry) => entry.caseId === failureCase.caseId)?.status === "ready",
  };
  return {
    actorMode,
    assertions,
    capabilityNegotiation: negotiateRuntimeCapabilities(runtime.capabilities, requiredCapabilities),
    capabilities: runtime.capabilities,
    passed: Object.values(assertions).every(Boolean)
      && negotiateRuntimeCapabilities(runtime.capabilities, requiredCapabilities).passed,
    schemaVersion: "nodekit.adapter-conformance/v1",
  };
}
import { negotiateRuntimeCapabilities } from "./runtime-capabilities.mjs";
import { contentHash } from "./caseflow.mjs";
import { PORTABLE_VALUE_LIMITS } from "./portable-value.mjs";
