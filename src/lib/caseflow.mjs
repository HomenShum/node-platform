import { createHash, randomUUID } from "node:crypto";
import { runtimeProfiles } from "./runtime-capabilities.mjs";

export const CASEFLOW_SCHEMA_VERSIONS = Object.freeze({
  approval: "nodekit.approval/v1",
  artifact: "nodekit.artifact/v1",
  case: "nodekit.case/v1",
  event: "nodekit.caseflow-event/v1",
  exception: "nodekit.exception/v1",
  proposal: "nodekit.proposal/v1",
  receipt: "nodekit.receipt/v1",
  run: "nodekit.run/v1",
  stage: "nodekit.stage/v1",
});

export const TERMINAL_RUN_STATUSES = Object.freeze([
  "cancelled",
  "completed",
  "failed_safely",
]);

function clone(value) {
  return structuredClone(value);
}

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
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

  function requireRecord(collection, recordId, label) {
    const value = collection.get(recordId);
    if (!value) throw new Error(`${label} not found: ${recordId}`);
    return value;
  }

  function emit(aggregateType, aggregateId, eventType, payload = {}, actor = { type: "system", id: "nodekit" }) {
    const event = {
      actor,
      aggregateId,
      aggregateType,
      eventId: id("event"),
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
    if (!String(title ?? "").trim()) throw new Error("case title is required");
    if (!String(primaryJob ?? "").trim()) throw new Error("case primaryJob is required");
    const createdAt = clock();
    const record = {
      caseId: id("case"),
      createdAt,
      currentRunId: null,
      primaryJob: String(primaryJob).trim(),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.case,
      status: "ready",
      title: String(title).trim(),
      updatedAt: createdAt,
    };
    state.cases.set(record.caseId, record);
    emit("case", record.caseId, "case.created", record, actor);
    return clone(record);
  }

  function startRun({ caseId, stages, actor }) {
    const caseRecord = requireRecord(state.cases, caseId, "case");
    if (!Array.isArray(stages) || stages.length === 0) throw new Error("run stages are required");
    if (caseRecord.currentRunId) {
      const current = state.runs.get(caseRecord.currentRunId);
      if (current && !TERMINAL_RUN_STATUSES.includes(current.status)) return clone(current);
    }
    const normalizedStages = stages.map((stage, index) => ({
      id: String(stage.id ?? `stage-${index + 1}`),
      label: String(stage.label ?? stage.id ?? `Stage ${index + 1}`),
      owner: stage.owner ?? "system",
      status: index === 0 ? "active" : "pending",
    }));
    const createdAt = clock();
    const run = {
      caseId,
      createdAt,
      currentStageId: normalizedStages[0].id,
      nextAction: normalizedStages[0].label,
      nextActionOwner: normalizedStages[0].owner,
      runId: id("run"),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.run,
      stages: normalizedStages,
      status: "active",
      updatedAt: createdAt,
    };
    state.runs.set(run.runId, run);
    Object.assign(caseRecord, { currentRunId: run.runId, status: "in_progress", updatedAt: createdAt });
    emit("run", run.runId, "run.started", run, actor);
    emit("run", run.runId, "stage.entered", { stageId: run.currentStageId }, actor);
    return clone(run);
  }

  function enterStage({ runId, stageId, nextAction, nextActionOwner, actor }) {
    const run = requireRecord(state.runs, runId, "run");
    if (TERMINAL_RUN_STATUSES.includes(run.status)) throw new Error(`run is terminal: ${run.status}`);
    const targetIndex = run.stages.findIndex((stage) => stage.id === stageId);
    if (targetIndex < 0) throw new Error(`stage not found: ${stageId}`);
    run.stages = run.stages.map((stage, index) => ({
      ...stage,
      status: index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending",
    }));
    Object.assign(run, {
      currentStageId: stageId,
      nextAction: nextAction ?? run.stages[targetIndex].label,
      nextActionOwner: nextActionOwner ?? run.stages[targetIndex].owner,
      updatedAt: clock(),
    });
    emit("run", runId, "stage.entered", { nextAction: run.nextAction, nextActionOwner: run.nextActionOwner, stageId }, actor);
    return clone(run);
  }

  function createArtifact({ caseId, runId, kind, title, content, actor }) {
    requireRecord(state.cases, caseId, "case");
    requireRecord(state.runs, runId, "run");
    const createdAt = clock();
    const artifact = {
      artifactId: id("artifact"),
      caseId,
      canonicalVersion: 1,
      createdAt,
      kind: kind ?? "generic",
      runId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.artifact,
      title: String(title ?? "Artifact"),
      updatedAt: createdAt,
      versions: [{ content: clone(content), contentHash: contentHash(content), createdAt, version: 1 }],
    };
    state.artifacts.set(artifact.artifactId, artifact);
    emit("artifact", artifact.artifactId, "artifact.created", { artifactId: artifact.artifactId, version: 1 }, actor);
    return clone(artifact);
  }

  function createProposal({ artifactId, baseVersion, patch, rationale, actor }) {
    const artifact = requireRecord(state.artifacts, artifactId, "artifact");
    if (baseVersion !== artifact.canonicalVersion) {
      throw new Error(`proposal base version ${baseVersion} is stale; canonical version is ${artifact.canonicalVersion}`);
    }
    const createdAt = clock();
    const proposal = {
      artifactId,
      baseVersion,
      createdAt,
      patch: clone(patch),
      proposalId: id("proposal"),
      rationale: String(rationale ?? ""),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.proposal,
      status: "pending",
    };
    state.proposals.set(proposal.proposalId, proposal);
    emit("proposal", proposal.proposalId, "proposal.created", proposal, actor);
    return clone(proposal);
  }

  function decideProposal({ proposalId, decision, actor, comment = "" }) {
    if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("decision must be accepted or rejected");
    const proposal = requireRecord(state.proposals, proposalId, "proposal");
    if (proposal.status !== "pending") throw new Error(`proposal is already ${proposal.status}`);
    const artifact = requireRecord(state.artifacts, proposal.artifactId, "artifact");
    const decidedAt = clock();
    const approval = {
      approvalId: id("approval"),
      comment: String(comment),
      decidedAt,
      decision,
      proposalId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.approval,
    };
    state.approvals.set(approval.approvalId, approval);
    if (decision === "accepted" && proposal.baseVersion !== artifact.canonicalVersion) {
      proposal.status = "conflicted";
      emit("proposal", proposalId, "proposal.conflicted", { canonicalVersion: artifact.canonicalVersion }, actor);
      return { approval: clone(approval), artifact: clone(artifact), proposal: clone(proposal) };
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
      emit("artifact", artifact.artifactId, "artifact.version_created", { proposalId, version: nextVersion }, actor);
    }
    emit("proposal", proposalId, `proposal.${proposal.status}`, { approvalId: approval.approvalId }, actor);
    return { approval: clone(approval), artifact: clone(artifact), proposal: clone(proposal) };
  }

  function raiseException({ runId, code, message, preservedState, actor }) {
    const run = requireRecord(state.runs, runId, "run");
    const exception = {
      code: String(code ?? "unknown"),
      exceptionId: id("exception"),
      message: String(message ?? "An exception occurred."),
      preservedState: clone(preservedState ?? {}),
      raisedAt: clock(),
      resolution: null,
      runId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.exception,
      status: "open",
    };
    state.exceptions.set(exception.exceptionId, exception);
    Object.assign(run, { status: "blocked", nextAction: "Resolve exception", nextActionOwner: "user", updatedAt: clock() });
    emit("run", runId, "exception.raised", { code: exception.code, exceptionId: exception.exceptionId }, actor);
    return clone(exception);
  }

  function resolveException({ exceptionId, resolution, nextAction, nextActionOwner, actor }) {
    const exception = requireRecord(state.exceptions, exceptionId, "exception");
    if (exception.status !== "open") throw new Error("exception is already resolved");
    exception.status = "resolved";
    exception.resolution = String(resolution ?? "resolved");
    exception.resolvedAt = clock();
    const run = requireRecord(state.runs, exception.runId, "run");
    Object.assign(run, { status: "active", nextAction: nextAction ?? "Continue run", nextActionOwner: nextActionOwner ?? "system", updatedAt: clock() });
    emit("run", run.runId, "exception.resolved", { exceptionId, resolution: exception.resolution }, actor);
    return { exception: clone(exception), run: clone(run) };
  }

  function completeRun({ runId, actor }) {
    const run = requireRecord(state.runs, runId, "run");
    if ([...state.exceptions.values()].some((entry) => entry.runId === runId && entry.status === "open")) {
      throw new Error("run has unresolved exceptions");
    }
    run.status = "completed";
    run.nextAction = "Review receipt";
    run.nextActionOwner = "user";
    run.updatedAt = clock();
    run.stages = run.stages.map((stage) => ({ ...stage, status: "completed" }));
    const caseRecord = requireRecord(state.cases, run.caseId, "case");
    Object.assign(caseRecord, { status: "completed", updatedAt: clock() });
    emit("run", runId, "run.completed", {}, actor);
    const artifactIds = [...state.artifacts.values()].filter((entry) => entry.runId === runId).map((entry) => entry.artifactId);
    const proposalIds = [...state.proposals.values()].filter((entry) => artifactIds.includes(entry.artifactId)).map((entry) => entry.proposalId);
    const receiptBody = {
      artifactIds,
      caseId: run.caseId,
      eventIds: state.events.filter((entry) => entry.aggregateId === runId || artifactIds.includes(entry.aggregateId) || proposalIds.includes(entry.aggregateId)).map((entry) => entry.eventId),
      generatedAt: clock(),
      proposalIds,
      runId,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
      status: "completed",
    };
    const receipt = { ...receiptBody, receiptId: id("receipt"), receiptHash: contentHash(receiptBody) };
    state.receipts.set(receipt.receiptId, receipt);
    emit("run", runId, "receipt.created", { receiptHash: receipt.receiptHash, receiptId: receipt.receiptId }, actor);
    return { receipt: clone(receipt), run: clone(run) };
  }

  function snapshot() {
    return clone(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value instanceof Map ? [...value.values()] : value])));
  }

  return {
    capabilities: runtimeProfiles.memory,
    completeRun,
    createArtifact,
    createCase,
    createProposal,
    decideProposal,
    enterStage,
    raiseException,
    resolveException,
    snapshot,
    startRun,
  };
}
