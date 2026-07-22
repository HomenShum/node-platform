import { randomUUID } from "node:crypto";
import {
  CASEFLOW_SCHEMA_VERSIONS,
  TERMINAL_RUN_STATUSES,
  contentHash,
} from "../lib/caseflow.mjs";
import { runtimeProfiles } from "../lib/runtime-capabilities.mjs";

const defaultActor = Object.freeze({ type: "system", id: "nodekit" });

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

function caseRecord(row) {
  return {
    caseId: row.case_id,
    createdAt: iso(row.created_at),
    currentRunId: row.current_run_id,
    primaryJob: row.primary_job,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.case,
    status: row.status,
    title: row.title,
    updatedAt: iso(row.updated_at),
  };
}

function runRecord(row) {
  return {
    caseId: row.case_id,
    createdAt: iso(row.created_at),
    currentStageId: row.current_stage_id,
    nextAction: row.next_action,
    nextActionOwner: row.next_action_owner,
    runId: row.run_id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.run,
    stages: json(row.stages),
    status: row.status,
    updatedAt: iso(row.updated_at),
  };
}

function proposalRecord(row) {
  return {
    artifactId: row.artifact_id,
    baseVersion: row.base_version,
    createdAt: iso(row.created_at),
    patch: json(row.patch),
    proposalId: row.proposal_id,
    rationale: row.rationale,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.proposal,
    status: row.status,
  };
}

function approvalRecord(row) {
  if (!row) return null;
  return {
    approvalId: row.approval_id,
    comment: row.comment,
    decidedAt: iso(row.decided_at),
    decision: row.decision,
    proposalId: row.proposal_id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.approval,
  };
}

function exceptionRecord(row) {
  return {
    code: row.code,
    exceptionId: row.exception_id,
    message: row.message,
    preservedState: json(row.preserved_state),
    raisedAt: iso(row.raised_at),
    resolution: row.resolution,
    ...(row.resolved_at ? { resolvedAt: iso(row.resolved_at) } : {}),
    runId: row.run_id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.exception,
    status: row.status,
  };
}

function receiptRecord(row) {
  return json(row.body);
}

function eventRecord(row) {
  return {
    actor: json(row.actor),
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at),
    payload: json(row.payload),
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
    sequence: row.sequence,
  };
}

async function withTransaction(pool, operation) {
  if (typeof pool.connect !== "function") {
    throw new Error("PostgreSQL Caseflow requires a pool/client with connect(), query(), and release() transaction support");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function emit(client, { actor = defaultActor, aggregateId, aggregateType, eventType, now, ownerId, payload = {} }) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [aggregateId]);
  const sequenceResult = await client.query(
    "select coalesce(max(sequence), 0)::integer + 1 as sequence from nodekit.events where owner_id = $1 and aggregate_id = $2",
    [ownerId, aggregateId],
  );
  const event = {
    actor: structuredClone(actor),
    aggregateId,
    aggregateType,
    eventId: id("event"),
    eventType,
    occurredAt: now,
    payload: structuredClone(payload),
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
    sequence: sequenceResult.rows[0].sequence,
  };
  await client.query(
    `insert into nodekit.events
      (event_id, owner_id, aggregate_type, aggregate_id, sequence, event_type, actor, payload, occurred_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [event.eventId, ownerId, aggregateType, aggregateId, event.sequence, eventType, JSON.stringify(event.actor), JSON.stringify(event.payload), now],
  );
  return event;
}

async function loadArtifact(client, ownerId, artifactId) {
  const artifactResult = await client.query(
    "select * from nodekit.artifacts where owner_id = $1 and artifact_id = $2",
    [ownerId, artifactId],
  );
  if (artifactResult.rowCount !== 1) throw new Error(`artifact not found: ${artifactId}`);
  const row = artifactResult.rows[0];
  const versions = await client.query(
    "select * from nodekit.artifact_versions where artifact_id = $1 order by version",
    [artifactId],
  );
  return {
    artifactId: row.artifact_id,
    caseId: row.case_id,
    canonicalVersion: row.canonical_version,
    createdAt: iso(row.created_at),
    kind: row.kind,
    runId: row.run_id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.artifact,
    title: row.title,
    updatedAt: iso(row.updated_at),
    versions: versions.rows.map((version) => ({
      content: json(version.content),
      contentHash: version.content_hash,
      createdAt: iso(version.created_at),
      ...(version.proposal_id ? { proposalId: version.proposal_id } : {}),
      version: version.version,
    })),
  };
}

/**
 * Create an owner-scoped PostgreSQL implementation of NodeKit Caseflow.
 * `pool` is compatible with node-postgres Pool: it must expose query() and connect().
 */
export function createPostgresCaseflow({ pool, ownerId, clock = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.query !== "function") throw new Error("PostgreSQL Caseflow requires a query-capable pool");
  if (!String(ownerId ?? "").trim()) throw new Error("PostgreSQL Caseflow requires an ownerId");
  const owner = String(ownerId).trim();

  async function createCase({ title, primaryJob, actor }) {
    if (!String(title ?? "").trim()) throw new Error("case title is required");
    if (!String(primaryJob ?? "").trim()) throw new Error("case primaryJob is required");
    return withTransaction(pool, async (client) => {
      const now = clock();
      const row = (await client.query(
        `insert into nodekit.cases
          (case_id, owner_id, title, primary_job, status, current_run_id, created_at, updated_at)
          values ($1, $2, $3, $4, 'ready', null, $5, $5) returning *`,
        [id("case"), owner, String(title).trim(), String(primaryJob).trim(), now],
      )).rows[0];
      const record = caseRecord(row);
      await emit(client, { actor, aggregateId: record.caseId, aggregateType: "case", eventType: "case.created", now, ownerId: owner, payload: record });
      return record;
    });
  }

  async function startRun({ caseId, stages, actor }) {
    if (!Array.isArray(stages) || stages.length === 0) throw new Error("run stages are required");
    return withTransaction(pool, async (client) => {
      const caseResult = await client.query(
        "select * from nodekit.cases where owner_id = $1 and case_id = $2 for update",
        [owner, caseId],
      );
      if (caseResult.rowCount !== 1) throw new Error(`case not found: ${caseId}`);
      const caseRow = caseResult.rows[0];
      if (caseRow.current_run_id) {
        const current = await client.query(
          "select * from nodekit.runs where owner_id = $1 and run_id = $2",
          [owner, caseRow.current_run_id],
        );
        if (current.rowCount === 1 && !TERMINAL_RUN_STATUSES.includes(current.rows[0].status)) return runRecord(current.rows[0]);
      }
      const normalizedStages = stages.map((stage, index) => ({
        id: String(stage.id ?? `stage-${index + 1}`),
        label: String(stage.label ?? stage.id ?? `Stage ${index + 1}`),
        owner: stage.owner ?? "system",
        status: index === 0 ? "active" : "pending",
      }));
      const now = clock();
      const runId = id("run");
      const row = (await client.query(
        `insert into nodekit.runs
          (run_id, owner_id, case_id, status, current_stage_id, next_action, next_action_owner, stages, created_at, updated_at)
          values ($1, $2, $3, 'active', $4, $5, $6, $7::jsonb, $8, $8) returning *`,
        [runId, owner, caseId, normalizedStages[0].id, normalizedStages[0].label, normalizedStages[0].owner, JSON.stringify(normalizedStages), now],
      )).rows[0];
      await client.query(
        "update nodekit.cases set current_run_id = $1, status = 'in_progress', updated_at = $2 where owner_id = $3 and case_id = $4",
        [runId, now, owner, caseId],
      );
      const record = runRecord(row);
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "run.started", now, ownerId: owner, payload: record });
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "stage.entered", now, ownerId: owner, payload: { stageId: record.currentStageId } });
      return record;
    });
  }

  async function enterStage({ runId, stageId, nextAction, nextActionOwner, actor }) {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
        [owner, runId],
      );
      if (result.rowCount !== 1) throw new Error(`run not found: ${runId}`);
      const current = runRecord(result.rows[0]);
      if (TERMINAL_RUN_STATUSES.includes(current.status)) throw new Error(`run is terminal: ${current.status}`);
      const targetIndex = current.stages.findIndex((stage) => stage.id === stageId);
      if (targetIndex < 0) throw new Error(`stage not found: ${stageId}`);
      const stages = current.stages.map((stage, index) => ({
        ...stage,
        status: index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending",
      }));
      const now = clock();
      const action = nextAction ?? stages[targetIndex].label;
      const actionOwner = nextActionOwner ?? stages[targetIndex].owner;
      const row = (await client.query(
        `update nodekit.runs set current_stage_id = $1, next_action = $2, next_action_owner = $3,
          stages = $4::jsonb, updated_at = $5 where owner_id = $6 and run_id = $7 returning *`,
        [stageId, action, actionOwner, JSON.stringify(stages), now, owner, runId],
      )).rows[0];
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "stage.entered", now, ownerId: owner, payload: { nextAction: action, nextActionOwner: actionOwner, stageId } });
      return runRecord(row);
    });
  }

  async function createArtifact({ caseId, runId, kind = "generic", title = "Artifact", content, actor }) {
    return withTransaction(pool, async (client) => {
      const references = await client.query(
        `select
          exists(select 1 from nodekit.cases where owner_id = $1 and case_id = $2) as has_case,
          exists(select 1 from nodekit.runs where owner_id = $1 and run_id = $3 and case_id = $2) as has_run`,
        [owner, caseId, runId],
      );
      if (!references.rows[0].has_case) throw new Error(`case not found: ${caseId}`);
      if (!references.rows[0].has_run) throw new Error(`run not found: ${runId}`);
      const now = clock();
      const artifactId = id("artifact");
      await client.query(
        `insert into nodekit.artifacts
          (artifact_id, owner_id, case_id, run_id, kind, title, canonical_version, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
        [artifactId, owner, caseId, runId, kind, String(title), now],
      );
      await client.query(
        `insert into nodekit.artifact_versions (artifact_id, version, content, content_hash, created_at)
          values ($1, 1, $2::jsonb, $3, $4)`,
        [artifactId, JSON.stringify(content), contentHash(content), now],
      );
      await emit(client, { actor, aggregateId: artifactId, aggregateType: "artifact", eventType: "artifact.created", now, ownerId: owner, payload: { artifactId, version: 1 } });
      return loadArtifact(client, owner, artifactId);
    });
  }

  async function createProposal({ artifactId, baseVersion, patch, rationale = "", actor }) {
    return withTransaction(pool, async (client) => {
      const artifact = await client.query(
        "select * from nodekit.artifacts where owner_id = $1 and artifact_id = $2 for update",
        [owner, artifactId],
      );
      if (artifact.rowCount !== 1) throw new Error(`artifact not found: ${artifactId}`);
      if (baseVersion !== artifact.rows[0].canonical_version) {
        throw new Error(`proposal base version ${baseVersion} is stale; canonical version is ${artifact.rows[0].canonical_version}`);
      }
      const now = clock();
      const proposalId = id("proposal");
      const row = (await client.query(
        `insert into nodekit.proposals
          (proposal_id, owner_id, artifact_id, base_version, patch, rationale, status, created_at)
          values ($1, $2, $3, $4, $5::jsonb, $6, 'pending', $7) returning *`,
        [proposalId, owner, artifactId, baseVersion, JSON.stringify(patch), String(rationale), now],
      )).rows[0];
      const record = proposalRecord(row);
      await emit(client, { actor, aggregateId: proposalId, aggregateType: "proposal", eventType: "proposal.created", now, ownerId: owner, payload: record });
      return record;
    });
  }

  async function decideProposal({ proposalId, decision, actor, comment = "" }) {
    if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("decision must be accepted or rejected");
    return withTransaction(pool, async (client) => {
      const now = clock();
      const proposalBefore = await client.query(
        "select * from nodekit.proposals where owner_id = $1 and proposal_id = $2",
        [owner, proposalId],
      );
      if (proposalBefore.rowCount !== 1) throw new Error(`proposal not found: ${proposalId}`);
      const result = (await client.query(
        "select * from nodekit.apply_proposal($1, $2, $3, $4, $5, $6, $7)",
        [owner, proposalId, decision, id("approval"), String(comment), contentHash(json(proposalBefore.rows[0].patch)), now],
      )).rows[0];
      const proposal = proposalRecord((await client.query(
        "select * from nodekit.proposals where owner_id = $1 and proposal_id = $2",
        [owner, proposalId],
      )).rows[0]);
      const approval = approvalRecord((await client.query(
        "select * from nodekit.approvals where owner_id = $1 and proposal_id = $2",
        [owner, proposalId],
      )).rows[0]);
      const artifact = await loadArtifact(client, owner, proposal.artifactId);
      if (!result.reused) {
        if (proposal.status === "accepted") {
          await emit(client, { actor, aggregateId: artifact.artifactId, aggregateType: "artifact", eventType: "artifact.version_created", now, ownerId: owner, payload: { proposalId, version: artifact.canonicalVersion } });
        }
        const payload = proposal.status === "conflicted"
          ? { canonicalVersion: artifact.canonicalVersion }
          : { approvalId: approval.approvalId };
        await emit(client, { actor, aggregateId: proposalId, aggregateType: "proposal", eventType: `proposal.${proposal.status}`, now, ownerId: owner, payload });
      }
      return { approval, artifact, proposal, reused: result.reused };
    });
  }

  async function raiseException({ runId, code, message, preservedState = {}, actor }) {
    return withTransaction(pool, async (client) => {
      const run = await client.query(
        "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
        [owner, runId],
      );
      if (run.rowCount !== 1) throw new Error(`run not found: ${runId}`);
      const now = clock();
      const exceptionId = id("exception");
      const row = (await client.query(
        `insert into nodekit.exceptions
          (exception_id, owner_id, run_id, code, message, preserved_state, status, resolution, raised_at)
          values ($1, $2, $3, $4, $5, $6::jsonb, 'open', null, $7) returning *`,
        [exceptionId, owner, runId, String(code ?? "unknown"), String(message ?? "An exception occurred."), JSON.stringify(preservedState), now],
      )).rows[0];
      await client.query(
        "update nodekit.runs set status = 'blocked', next_action = 'Resolve exception', next_action_owner = 'user', updated_at = $1 where owner_id = $2 and run_id = $3",
        [now, owner, runId],
      );
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "exception.raised", now, ownerId: owner, payload: { code: row.code, exceptionId } });
      return exceptionRecord(row);
    });
  }

  async function resolveException({ exceptionId, resolution, nextAction, nextActionOwner, actor }) {
    return withTransaction(pool, async (client) => {
      const existing = await client.query(
        "select * from nodekit.exceptions where owner_id = $1 and exception_id = $2 for update",
        [owner, exceptionId],
      );
      if (existing.rowCount !== 1) throw new Error(`exception not found: ${exceptionId}`);
      if (existing.rows[0].status !== "open") throw new Error("exception is already resolved");
      const now = clock();
      const resolved = (await client.query(
        `update nodekit.exceptions set status = 'resolved', resolution = $1, resolved_at = $2
          where owner_id = $3 and exception_id = $4 returning *`,
        [String(resolution ?? "resolved"), now, owner, exceptionId],
      )).rows[0];
      const runRow = (await client.query(
        `update nodekit.runs set status = 'active', next_action = $1, next_action_owner = $2, updated_at = $3
          where owner_id = $4 and run_id = $5 returning *`,
        [nextAction ?? "Continue run", nextActionOwner ?? "system", now, owner, resolved.run_id],
      )).rows[0];
      await emit(client, { actor, aggregateId: resolved.run_id, aggregateType: "run", eventType: "exception.resolved", now, ownerId: owner, payload: { exceptionId, resolution: resolved.resolution } });
      return { exception: exceptionRecord(resolved), run: runRecord(runRow) };
    });
  }

  async function completeRun({ runId, actor }) {
    return withTransaction(pool, async (client) => {
      const runResult = await client.query(
        "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
        [owner, runId],
      );
      if (runResult.rowCount !== 1) throw new Error(`run not found: ${runId}`);
      const current = runRecord(runResult.rows[0]);
      if (current.status === "completed") {
        const receipt = await client.query(
          "select * from nodekit.receipts where owner_id = $1 and run_id = $2",
          [owner, runId],
        );
        if (receipt.rowCount !== 1) throw new Error("completed run is missing its receipt");
        return { receipt: receiptRecord(receipt.rows[0]), run: current, reused: true };
      }
      if (TERMINAL_RUN_STATUSES.includes(current.status)) throw new Error(`run is terminal: ${current.status}`);
      const open = await client.query(
        "select 1 from nodekit.exceptions where owner_id = $1 and run_id = $2 and status = 'open' limit 1",
        [owner, runId],
      );
      if (open.rowCount > 0) throw new Error("run has unresolved exceptions");
      const now = clock();
      const stages = current.stages.map((stage) => ({ ...stage, status: "completed" }));
      const completedRow = (await client.query(
        `update nodekit.runs set status = 'completed', next_action = 'Review receipt', next_action_owner = 'user',
          stages = $1::jsonb, updated_at = $2 where owner_id = $3 and run_id = $4 returning *`,
        [JSON.stringify(stages), now, owner, runId],
      )).rows[0];
      await client.query(
        "update nodekit.cases set status = 'completed', updated_at = $1 where owner_id = $2 and case_id = $3",
        [now, owner, current.caseId],
      );
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "run.completed", now, ownerId: owner });
      const artifactIds = (await client.query(
        "select artifact_id from nodekit.artifacts where owner_id = $1 and run_id = $2 order by created_at, artifact_id",
        [owner, runId],
      )).rows.map((row) => row.artifact_id);
      const proposalIds = artifactIds.length === 0 ? [] : (await client.query(
        "select proposal_id from nodekit.proposals where owner_id = $1 and artifact_id = any($2::text[]) order by created_at, proposal_id",
        [owner, artifactIds],
      )).rows.map((row) => row.proposal_id);
      const aggregateIds = [runId, ...artifactIds, ...proposalIds];
      const eventIds = (await client.query(
        "select event_id from nodekit.events where owner_id = $1 and aggregate_id = any($2::text[]) order by occurred_at, event_id",
        [owner, aggregateIds],
      )).rows.map((row) => row.event_id);
      const receiptBody = {
        artifactIds,
        caseId: current.caseId,
        eventIds,
        generatedAt: now,
        proposalIds,
        runId,
        schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
        status: "completed",
      };
      const receipt = { ...receiptBody, receiptId: id("receipt"), receiptHash: contentHash(receiptBody) };
      await client.query(
        `insert into nodekit.receipts (receipt_id, owner_id, run_id, receipt_hash, body, generated_at)
          values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [receipt.receiptId, owner, runId, receipt.receiptHash, JSON.stringify(receipt), now],
      );
      await emit(client, { actor, aggregateId: runId, aggregateType: "run", eventType: "receipt.created", now, ownerId: owner, payload: { receiptHash: receipt.receiptHash, receiptId: receipt.receiptId } });
      return { receipt, run: runRecord(completedRow), reused: false };
    });
  }

  async function snapshot() {
    const [cases, runs, artifacts, proposals, approvals, exceptions, receipts, events] = await Promise.all([
      pool.query("select * from nodekit.cases where owner_id = $1 order by created_at, case_id", [owner]),
      pool.query("select * from nodekit.runs where owner_id = $1 order by created_at, run_id", [owner]),
      pool.query("select * from nodekit.artifacts where owner_id = $1 order by created_at, artifact_id", [owner]),
      pool.query("select * from nodekit.proposals where owner_id = $1 order by created_at, proposal_id", [owner]),
      pool.query("select * from nodekit.approvals where owner_id = $1 order by decided_at, approval_id", [owner]),
      pool.query("select * from nodekit.exceptions where owner_id = $1 order by raised_at, exception_id", [owner]),
      pool.query("select * from nodekit.receipts where owner_id = $1 order by generated_at, receipt_id", [owner]),
      pool.query("select * from nodekit.events where owner_id = $1 order by occurred_at, event_id", [owner]),
    ]);
    return {
      approvals: approvals.rows.map(approvalRecord),
      artifacts: await Promise.all(artifacts.rows.map((row) => loadArtifact(pool, owner, row.artifact_id))),
      cases: cases.rows.map(caseRecord),
      events: events.rows.map(eventRecord),
      exceptions: exceptions.rows.map(exceptionRecord),
      proposals: proposals.rows.map(proposalRecord),
      receipts: receipts.rows.map(receiptRecord),
      runs: runs.rows.map(runRecord),
    };
  }

  return {
    capabilities: runtimeProfiles.postgres,
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
