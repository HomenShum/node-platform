import { createHash, randomUUID } from "node:crypto";
import {
  PORTABLE_VALUE_LIMITS,
  normalizePortableValue,
  normalizeStageDefinitions,
  requireTrimmedText,
  stageDefinitionsMatch,
} from "./portable-value.mjs";
import { normalizeReceiptBindings } from "./receipt-bindings.mjs";
import { runtimeProfiles } from "./runtime-capabilities.mjs";

export const CASEFLOW_SCHEMA_VERSIONS = Object.freeze({
  approval: "nodekit.approval/v1",
  artifact: "nodekit.artifact/v1",
  case: "nodekit.case/v1",
  event: "nodekit.caseflow-event/v1",
  exception: "nodekit.exception/v1",
  proposal: "nodekit.proposal/v1",
  receipt: "nodekit.receipt/v2",
  run: "nodekit.run/v1",
  stage: "nodekit.stage/v1",
});

export const TERMINAL_RUN_STATUSES = Object.freeze([
  "cancelled",
  "completed",
  "failed_safely",
]);

function clone(value) {
  return normalizePortableValue(value);
}

export function nodeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash("sha256").update(canonical(normalizePortableValue(value))).digest("hex");
}

const SYSTEM_ACTOR = Object.freeze({ type: "system", id: "nodekit" });

function actorValue(actor) {
  const normalized = normalizePortableValue(actor ?? SYSTEM_ACTOR, "actor");
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new TypeError("actor must be an object");
  }
  return {
    id: requireTrimmedText(normalized.id, "actor.id"),
    type: requireTrimmedText(normalized.type, "actor.type"),
  };
}

function optionalFields(required, optional) {
  return Object.fromEntries([
    ...Object.entries(required),
    ...Object.entries(optional).filter(([, value]) => value !== undefined),
  ]);
}

export function createMemoryCaseflow({ clock = () => new Date().toISOString() } = {}) {
  const state = {
    approvals: new Map(),
    artifacts: new Map(),
    cases: new Map(),
    events: [],
    exceptions: new Map(),
    proposals: new Map(),
    receipts: new Map(),
    runs: new Map(),
  };
  const idempotencyJournal = new Map();

  function idempotent(idempotencyKey, request, operation) {
    if (idempotencyKey === undefined) return operation();
    const key = requireTrimmedText(idempotencyKey, "idempotencyKey");
    const requestHash = contentHash(request);
    const existing = idempotencyJournal.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error(`idempotencyKey was already used for a different request: ${key}`);
      return clone(existing.result);
    }
    const result = operation();
    idempotencyJournal.set(key, { requestHash, result: clone(result) });
    return result;
  }

  function requireRecord(collection, recordId, label) {
    const value = collection.get(recordId);
    if (!value) throw new Error(`${label} not found: ${recordId}`);
    return value;
  }

  function requireNonTerminalRun(runId) {
    const run = requireRecord(state.runs, runId, "run");
    if (TERMINAL_RUN_STATUSES.includes(run.status)) throw new Error(`run is terminal: ${run.status}`);
    return run;
  }

  function requireActiveRun(runId) {
    const run = requireNonTerminalRun(runId);
    if (run.status !== "active") throw new Error(`run is not active: ${run.status}`);
    return run;
  }

  function emit(aggregateType, aggregateId, eventType, payload = {}, actor) {
    const event = {
      actor: actorValue(actor),
      aggregateId,
      aggregateType,
      eventId: nodeId("event"),
      eventType,
      occurredAt: clock(),
      payload: clone(payload),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
      sequence: state.events.filter((entry) => entry.aggregateId === aggregateId).length + 1,
    };
    state.events.push(event);
    return event;
  }

  function createCase({ title, primaryJob, actor }) {
    const eventActor = actorValue(actor);
    const normalizedTitle = requireTrimmedText(title, "case title");
    const normalizedPrimaryJob = requireTrimmedText(primaryJob, "case primaryJob");
    const createdAt = clock();
    const record = {
      caseId: nodeId("case"),
      createdAt,
      currentRunId: null,
      primaryJob: normalizedPrimaryJob,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.case,
      status: "ready",
      title: normalizedTitle,
      updatedAt: createdAt,
    };
    state.cases.set(record.caseId, record);
    emit("case", record.caseId, "case.created", record, eventActor);
    return clone(record);
  }

  function updateCaseInput({ caseId, primaryJob, title, actor }) {
    const eventActor = actorValue(actor);
    const record = requireRecord(state.cases, caseId, "case");
    if (record.status === "completed") throw new Error("completed case input cannot be changed");
    const nextPrimaryJob = primaryJob === undefined ? record.primaryJob : requireTrimmedText(primaryJob, "case primaryJob");
    const nextTitle = title === undefined ? record.title : requireTrimmedText(title, "case title");
    if (record.primaryJob === nextPrimaryJob && record.title === nextTitle) return clone(record);
    Object.assign(record, { primaryJob: nextPrimaryJob, title: nextTitle, updatedAt: clock() });
    emit("case", caseId, "case.updated", { primaryJob: record.primaryJob, title: record.title }, eventActor);
    return clone(record);
  }

  function startRun({ caseId, stages, actor }) {
    const eventActor = actorValue(actor);
    const caseRecord = requireRecord(state.cases, caseId, "case");
    const normalizedStages = normalizeStageDefinitions(stages);
    if (caseRecord.currentRunId) {
      const current = state.runs.get(caseRecord.currentRunId);
      if (current && !TERMINAL_RUN_STATUSES.includes(current.status)) {
        if (!stageDefinitionsMatch(current.stages, normalizedStages)) {
          throw new Error("active run stages do not match requested stage plan");
        }
        return clone(current);
      }
    }
    const createdAt = clock();
    const run = {
      caseId,
      createdAt,
      currentStageId: normalizedStages[0].id,
      nextAction: normalizedStages[0].label,
      nextActionOwner: normalizedStages[0].owner,
      runId: nodeId("run"),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.run,
      stages: normalizedStages,
      status: "active",
      updatedAt: createdAt,
    };
    state.runs.set(run.runId, run);
    Object.assign(caseRecord, { currentRunId: run.runId, status: "in_progress", updatedAt: createdAt });
    emit("run", run.runId, "run.started", run, eventActor);
    emit("run", run.runId, "stage.entered", { stageId: run.currentStageId }, eventActor);
    return clone(run);
  }

  function enterStage({ runId, stageId, nextAction, nextActionOwner, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const normalizedStageId = requireTrimmedText(stageId, "stageId");
    const request = optionalFields({ actor: eventActor, operation: "enterStage", runId, stageId: normalizedStageId }, { nextAction, nextActionOwner });
    return idempotent(idempotencyKey, request, () => {
      const run = requireActiveRun(runId);
      const targetIndex = run.stages.findIndex((stage) => stage.id === normalizedStageId);
      if (targetIndex < 0) throw new Error(`stage not found: ${normalizedStageId}`);
      run.stages = run.stages.map((stage, index) => ({
        ...stage,
        status: index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending",
      }));
      Object.assign(run, {
        currentStageId: normalizedStageId,
        nextAction: nextAction === undefined ? run.stages[targetIndex].label : requireTrimmedText(nextAction, "nextAction"),
        nextActionOwner: nextActionOwner === undefined ? run.stages[targetIndex].owner : requireTrimmedText(nextActionOwner, "nextActionOwner"),
        updatedAt: clock(),
      });
      emit("run", runId, "stage.entered", { nextAction: run.nextAction, nextActionOwner: run.nextActionOwner, stageId: normalizedStageId }, eventActor);
      return clone(run);
    });
  }

  function createArtifact({ caseId, runId, kind, title, content, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const portableContent = normalizePortableValue(content, "content", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    const normalizedKind = kind === undefined ? "generic" : requireTrimmedText(kind, "kind");
    const normalizedTitle = title === undefined ? "Artifact" : requireTrimmedText(title, "title");
    const request = { actor: eventActor, caseId, content: portableContent, kind: normalizedKind, operation: "createArtifact", runId, title: normalizedTitle };
    return idempotent(idempotencyKey, request, () => {
      requireRecord(state.cases, caseId, "case");
      const run = requireActiveRun(runId);
      if (run.caseId !== caseId) throw new Error("run does not belong to case");
      const createdAt = clock();
      const artifact = {
        artifactId: nodeId("artifact"),
        caseId,
        canonicalVersion: 1,
        createdAt,
        kind: normalizedKind,
        runId,
        schemaVersion: CASEFLOW_SCHEMA_VERSIONS.artifact,
        title: normalizedTitle,
        updatedAt: createdAt,
        versions: [{ content: portableContent, contentHash: contentHash(portableContent), createdAt, version: 1 }],
      };
      state.artifacts.set(artifact.artifactId, artifact);
      emit("artifact", artifact.artifactId, "artifact.created", { artifactId: artifact.artifactId, version: 1 }, eventActor);
      return clone(artifact);
    });
  }

  function createProposal({ artifactId, baseVersion, patch, rationale, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const portablePatch = normalizePortableValue(patch, "patch", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    if (!Number.isInteger(baseVersion) || baseVersion < 1) throw new Error("baseVersion must be a positive integer");
    if (rationale !== undefined && typeof rationale !== "string") throw new TypeError("rationale must be a string");
    const normalizedRationale = rationale ?? "";
    const request = { actor: eventActor, artifactId, baseVersion, operation: "createProposal", patch: portablePatch, rationale: normalizedRationale };
    return idempotent(idempotencyKey, request, () => {
      const artifact = requireRecord(state.artifacts, artifactId, "artifact");
      requireActiveRun(artifact.runId);
      if (baseVersion !== artifact.canonicalVersion) {
        throw new Error(`proposal base version ${baseVersion} is stale; canonical version is ${artifact.canonicalVersion}`);
      }
      const createdAt = clock();
      const proposal = {
        artifactId,
        baseVersion,
        createdAt,
        patch: portablePatch,
        proposalId: nodeId("proposal"),
        rationale: normalizedRationale,
        schemaVersion: CASEFLOW_SCHEMA_VERSIONS.proposal,
        status: "pending",
      };
      state.proposals.set(proposal.proposalId, proposal);
      emit("proposal", proposal.proposalId, "proposal.created", {
        artifactId: proposal.artifactId,
        baseVersion: proposal.baseVersion,
        proposalId: proposal.proposalId,
      }, eventActor);
      return clone(proposal);
    });
  }

  function decideProposal({ proposalId, decision, actor, comment = "" }) {
    const eventActor = actorValue(actor);
    if (typeof comment !== "string") throw new TypeError("comment must be a string");
    if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("decision must be accepted or rejected");
    const proposal = requireRecord(state.proposals, proposalId, "proposal");
    const artifact = requireRecord(state.artifacts, proposal.artifactId, "artifact");
    if (proposal.status !== "pending") {
      const existingApproval = [...state.approvals.values()].find((entry) => entry.proposalId === proposalId);
      const existingDecisionEvent = [...state.events].reverse().find((entry) =>
        entry.aggregateType === "proposal"
          && entry.aggregateId === proposalId
          && entry.eventType === `proposal.${proposal.status}`,
      );
      const repeatedDecisionMatches = existingApproval?.decision === decision
        && existingApproval.comment === comment
        && existingDecisionEvent !== undefined
        && contentHash(existingDecisionEvent.actor) === contentHash(eventActor)
        && (proposal.status === decision || (proposal.status === "conflicted" && decision === "accepted"));
      if (!repeatedDecisionMatches) throw new Error(`proposal retry does not match original decision request; proposal is already ${proposal.status}`);
      return { approval: clone(existingApproval), artifact: clone(artifact), proposal: clone(proposal), reused: true };
    }
    requireActiveRun(artifact.runId);
    const decidedAt = clock();
    const approval = {
      approvalId: nodeId("approval"),
      comment,
      decidedAt,
      decision,
      proposalId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.approval,
    };
    state.approvals.set(approval.approvalId, approval);
    if (decision === "accepted" && proposal.baseVersion !== artifact.canonicalVersion) {
      proposal.status = "conflicted";
      emit("proposal", proposalId, "proposal.conflicted", { canonicalVersion: artifact.canonicalVersion }, eventActor);
      return { approval: clone(approval), artifact: clone(artifact), proposal: clone(proposal), reused: false };
    }
    proposal.status = decision;
    if (decision === "accepted") {
      const nextVersion = artifact.canonicalVersion + 1;
      artifact.canonicalVersion = nextVersion;
      artifact.updatedAt = decidedAt;
      artifact.versions.push({
        content: clone(proposal.patch),
        contentHash: contentHash(proposal.patch),
        createdAt: decidedAt,
        proposalId,
        version: nextVersion,
      });
      emit("artifact", artifact.artifactId, "artifact.version_created", { proposalId, version: nextVersion }, eventActor);
    }
    emit("proposal", proposalId, `proposal.${proposal.status}`, { approvalId: approval.approvalId }, eventActor);
    return { approval: clone(approval), artifact: clone(artifact), proposal: clone(proposal), reused: false };
  }

  function raiseException({ runId, code, message, preservedState, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const normalizedCode = requireTrimmedText(code ?? "unknown", "code");
    const normalizedMessage = requireTrimmedText(message ?? "An exception occurred.", "message");
    const portableState = normalizePortableValue(preservedState ?? {}, "preservedState", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    const request = { actor: eventActor, code: normalizedCode, message: normalizedMessage, operation: "raiseException", preservedState: portableState, runId };
    return idempotent(idempotencyKey, request, () => {
      const run = requireNonTerminalRun(runId);
      const exception = {
        code: normalizedCode,
        exceptionId: nodeId("exception"),
        message: normalizedMessage,
        preservedState: portableState,
        raisedAt: clock(),
        resolution: null,
        runId,
        schemaVersion: CASEFLOW_SCHEMA_VERSIONS.exception,
        status: "open",
      };
      state.exceptions.set(exception.exceptionId, exception);
      Object.assign(run, { status: "blocked", nextAction: "Resolve exception", nextActionOwner: "user", updatedAt: clock() });
      emit("run", runId, "exception.raised", {
        code: exception.code,
        exceptionId: exception.exceptionId,
        messageHash: contentHash(exception.message),
        preservedStateHash: contentHash(exception.preservedState),
      }, eventActor);
      return clone(exception);
    });
  }

  function resolveException({ exceptionId, resolution, nextAction, nextActionOwner, actor }) {
    const eventActor = actorValue(actor);
    const exception = requireRecord(state.exceptions, exceptionId, "exception");
    if (exception.status !== "open") throw new Error("exception is already resolved");
    const run = requireNonTerminalRun(exception.runId);
    exception.status = "resolved";
    exception.resolution = requireTrimmedText(resolution ?? "resolved", "resolution");
    exception.resolvedAt = clock();
    const hasAnotherOpenException = [...state.exceptions.values()].some((entry) => entry.runId === run.runId && entry.status === "open");
    Object.assign(run, hasAnotherOpenException
      ? { status: "blocked", nextAction: "Resolve remaining exception", nextActionOwner: "user", updatedAt: clock() }
      : {
          status: "active",
          nextAction: nextAction === undefined ? "Continue run" : requireTrimmedText(nextAction, "nextAction"),
          nextActionOwner: nextActionOwner === undefined ? "system" : requireTrimmedText(nextActionOwner, "nextActionOwner"),
          updatedAt: clock(),
        });
    emit("run", run.runId, "exception.resolved", { exceptionId, resolution: exception.resolution }, eventActor);
    return { exception: clone(exception), run: clone(run) };
  }

  function terminalizeRun({ runId, status, reason, actor }) {
    const run = requireRecord(state.runs, runId, "run");
    const terminalActor = actorValue(actor);
    const eventType = `run.${status}`;
    const terminalPayload = status === "completed" ? {} : { reason };
    if (run.status === status) {
      const receipt = [...state.receipts.values()].find((entry) => entry.runId === runId);
      if (!receipt) throw new Error(`${status} run is missing its receipt`);
      const terminalEvent = state.events.find((entry) => entry.aggregateId === runId && entry.eventType === eventType);
      if (!terminalEvent
        || contentHash(terminalEvent.actor) !== contentHash(terminalActor)
        || contentHash(terminalEvent.payload) !== contentHash(terminalPayload)) {
        throw new Error("terminal retry does not match the original request");
      }
      return { receipt: clone(receipt), run: clone(run), reused: true };
    }
    if (TERMINAL_RUN_STATUSES.includes(run.status)) throw new Error(`run is terminal: ${run.status}`);
    if (status === "completed" && run.status !== "active") throw new Error(`run is not active: ${run.status}`);

    const runArtifacts = [...state.artifacts.values()].filter((entry) => entry.runId === runId);
    const runArtifactIds = runArtifacts.map((entry) => entry.artifactId);
    if (status === "completed") {
      if (runArtifacts.length === 0) throw new Error("run must have at least one canonical artifact");
      if ([...state.exceptions.values()].some((entry) => entry.runId === runId && entry.status === "open")) {
        throw new Error("run has unresolved exceptions");
      }
      if ([...state.proposals.values()].some((entry) => runArtifactIds.includes(entry.artifactId) && entry.status === "pending")) {
        throw new Error("run has pending proposals");
      }
    }

    const terminalAt = clock();
    Object.assign(run, {
      status,
      nextAction: status === "completed" ? "Review receipt" : "Start a new run",
      nextActionOwner: "user",
      updatedAt: terminalAt,
      ...(status === "completed" ? { stages: run.stages.map((stage) => ({ ...stage, status: "completed" })) } : {}),
    });
    const caseRecord = requireRecord(state.cases, run.caseId, "case");
    Object.assign(caseRecord, { status: status === "completed" ? "completed" : "ready", updatedAt: terminalAt });
    emit("run", runId, eventType, terminalPayload, terminalActor);
    const rawArtifactBindings = [...state.artifacts.values()].filter((entry) => entry.runId === runId).map((entry) => {
      const version = entry.versions.find((candidate) => candidate.version === entry.canonicalVersion);
      return { artifactId: entry.artifactId, canonicalVersion: entry.canonicalVersion, contentHash: version.contentHash };
    });
    const rawArtifactIds = rawArtifactBindings.map((entry) => entry.artifactId);
    const rawProposalBindings = [...state.proposals.values()].filter((entry) => rawArtifactIds.includes(entry.artifactId)).map((entry) => ({
      artifactId: entry.artifactId,
      baseVersion: entry.baseVersion,
      patchHash: contentHash(entry.patch),
      proposalId: entry.proposalId,
      status: entry.status,
    }));
    const rawProposalIds = rawProposalBindings.map((entry) => entry.proposalId);
    const rawApprovalBindings = [...state.approvals.values()].filter((entry) => rawProposalIds.includes(entry.proposalId)).map((entry) => ({
      approvalId: entry.approvalId,
      commentHash: contentHash(entry.comment),
      decision: entry.decision,
      proposalId: entry.proposalId,
    }));
    const rawEventBindings = state.events.filter((entry) => entry.aggregateId === runId || rawArtifactIds.includes(entry.aggregateId) || rawProposalIds.includes(entry.aggregateId)).map((entry) => ({
      actorHash: contentHash(entry.actor),
      aggregateId: entry.aggregateId,
      aggregateType: entry.aggregateType,
      eventId: entry.eventId,
      eventType: entry.eventType,
      payloadHash: contentHash(entry.payload),
      sequence: entry.sequence,
    }));
    const {
      approvalBindings,
      artifactBindings,
      artifactIds,
      eventBindings,
      eventIds,
      proposalBindings,
      proposalIds,
    } = normalizeReceiptBindings({
      approvalBindings: rawApprovalBindings,
      artifactBindings: rawArtifactBindings,
      eventBindings: rawEventBindings,
      proposalBindings: rawProposalBindings,
    });
    const receiptBody = {
      approvalBindings,
      artifactBindings,
      artifactIds,
      caseHash: contentHash(caseRecord),
      caseId: run.caseId,
      eventBindings,
      eventIds,
      generatedAt: terminalAt,
      proposalBindings,
      proposalIds,
      runHash: contentHash(run),
      runId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
      status,
    };
    const receipt = { ...receiptBody, receiptId: nodeId("receipt"), receiptHash: contentHash(receiptBody) };
    state.receipts.set(receipt.receiptId, receipt);
    emit("run", runId, "receipt.created", { receiptHash: receipt.receiptHash, receiptId: receipt.receiptId }, terminalActor);
    return { receipt: clone(receipt), run: clone(run), reused: false };
  }

  function completeRun({ runId, actor }) {
    return terminalizeRun({ actor, runId, status: "completed" });
  }

  function cancelRun({ runId, reason, actor }) {
    return terminalizeRun({
      actor,
      reason: requireTrimmedText(reason ?? "Cancelled by request.", "reason"),
      runId,
      status: "cancelled",
    });
  }

  function failRunSafely({ runId, reason, actor }) {
    return terminalizeRun({
      actor,
      reason: requireTrimmedText(reason ?? "Run failed safely.", "reason"),
      runId,
      status: "failed_safely",
    });
  }

  function snapshot() {
    return clone(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value instanceof Map ? [...value.values()] : value])));
  }

  return {
    capabilities: runtimeProfiles.memory,
    cancelRun,
    completeRun,
    createArtifact,
    createCase,
    createProposal,
    decideProposal,
    enterStage,
    failRunSafely,
    raiseException,
    resolveException,
    snapshot,
    startRun,
    updateCaseInput,
  };
}
