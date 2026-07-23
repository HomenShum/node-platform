import {
  CASEFLOW_SCHEMA_VERSIONS,
  TERMINAL_RUN_STATUSES,
  contentHash,
  nodeId,
} from "../lib/caseflow.mjs";
import {
  PORTABLE_VALUE_LIMITS,
  normalizePortableValue,
  normalizeStageDefinitions,
  requireTrimmedText,
  stageDefinitionsMatch,
} from "../lib/portable-value.mjs";
import { normalizeReceiptBindings } from "../lib/receipt-bindings.mjs";
import { runtimeProfiles } from "../lib/runtime-capabilities.mjs";

const defaultActor = Object.freeze({ type: "system", id: "nodekit" });

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function json(value) {
  return normalizePortableValue(typeof value === "string" ? JSON.parse(value) : value);
}

function actorValue(actor) {
  const normalized = normalizePortableValue(actor ?? defaultActor, "actor");
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

/**
 * Explicitly repair one owner's pre-digest proposal rows with NodeKit's real
 * portable canonical hash. The migration deliberately refuses to derive this
 * value from PostgreSQL jsonb::text because those bytes are provider-specific.
 * Run batches until `complete` is true, then rerun the SQL migration so it can
 * validate the pending constraint and promote the column to NOT NULL.
 */
export function rehashLegacyPostgresProposalPatches({ pool, ownerId, batchSize = 100 } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("PostgreSQL legacy proposal rehash requires a query-capable pool");
  }
  const owner = requireTrimmedText(ownerId, "PostgreSQL legacy proposal rehash ownerId");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("PostgreSQL legacy proposal rehash batchSize must be an integer from 1 through 1000");
  }
  return withTransaction(pool, async (client) => {
    const legacy = await client.query(
      `select proposal_id, patch from nodekit.proposals
        where owner_id = $1 and patch_hash is null
        order by proposal_id for update skip locked limit $2`,
      [owner, batchSize],
    );
    const rehashed = [];
    for (const row of legacy.rows) {
      const rawPatch = typeof row.patch === "string" ? JSON.parse(row.patch) : row.patch;
      const portablePatch = normalizePortableValue(rawPatch, "legacy proposal patch", {
        maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
      });
      const patchHash = contentHash(portablePatch);
      const updated = await client.query(
        `update nodekit.proposals set patch_hash = $1
          where owner_id = $2 and proposal_id = $3 and patch_hash is null
          returning proposal_id`,
        [patchHash, owner, row.proposal_id],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`legacy proposal rehash lost its locked row: ${row.proposal_id}`);
      }
      rehashed.push({ patchHash, proposalId: row.proposal_id });
    }
    const remainingResult = await client.query(
      "select count(*)::integer as remaining from nodekit.proposals where owner_id = $1 and patch_hash is null",
      [owner],
    );
    const remaining = Number(remainingResult.rows[0]?.remaining ?? 0);
    return {
      complete: remaining === 0,
      ownerId: owner,
      rehashed,
      remaining,
      schemaVersion: "nodekit.postgres-legacy-patch-rehash/v1",
    };
  });
}

async function withIdempotency(client, { idempotencyKey, ownerId, request }, operation) {
  if (idempotencyKey === undefined) return operation({});
  const key = requireTrimmedText(idempotencyKey, "idempotencyKey");
  const requestHash = contentHash(request);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${key}`]);
  const existing = await client.query(
    "select request_hash, result from nodekit.events where owner_id = $1 and idempotency_key = $2 limit 1",
    [ownerId, key],
  );
  if (existing.rowCount === 1) {
    if (existing.rows[0].request_hash !== requestHash) {
      throw new Error(`idempotencyKey was already used for a different request: ${key}`);
    }
    return json(existing.rows[0].result);
  }
  return operation({ idempotencyKey: key, requestHash });
}

async function emit(client, {
  actor,
  aggregateId,
  aggregateType,
  eventType,
  idempotencyKey = null,
  now,
  ownerId,
  payload = {},
  requestHash = null,
  result,
}) {
  const portableActor = actorValue(actor);
  const portablePayload = normalizePortableValue(payload, "event payload");
  const portableResult = result === undefined ? undefined : normalizePortableValue(result, "event result");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [aggregateId]);
  const sequenceResult = await client.query(
    "select coalesce(max(sequence), 0)::integer + 1 as sequence from nodekit.events where owner_id = $1 and aggregate_id = $2",
    [ownerId, aggregateId],
  );
  const event = {
    actor: portableActor,
    aggregateId,
    aggregateType,
    eventId: nodeId("event"),
    eventType,
    occurredAt: now,
    payload: portablePayload,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
    sequence: sequenceResult.rows[0].sequence,
  };
  await client.query(
    `insert into nodekit.events
      (event_id, owner_id, aggregate_type, aggregate_id, sequence, event_type, actor, payload,
        idempotency_key, request_hash, result, occurred_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb, $12)`,
    [
      event.eventId,
      ownerId,
      aggregateType,
      aggregateId,
      event.sequence,
      eventType,
      JSON.stringify(event.actor),
      JSON.stringify(event.payload),
      idempotencyKey,
      requestHash,
      portableResult === undefined ? null : JSON.stringify(portableResult),
      now,
    ],
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
  const owner = requireTrimmedText(ownerId, "PostgreSQL Caseflow ownerId");

  async function createCase({ title, primaryJob, actor }) {
    const eventActor = actorValue(actor);
    const normalizedTitle = requireTrimmedText(title, "case title");
    const normalizedPrimaryJob = requireTrimmedText(primaryJob, "case primaryJob");
    return withTransaction(pool, async (client) => {
      const now = clock();
      const row = (await client.query(
        `insert into nodekit.cases
          (case_id, owner_id, title, primary_job, status, current_run_id, created_at, updated_at)
          values ($1, $2, $3, $4, 'ready', null, $5, $5) returning *`,
        [nodeId("case"), owner, normalizedTitle, normalizedPrimaryJob, now],
      )).rows[0];
      const record = caseRecord(row);
      await emit(client, { actor: eventActor, aggregateId: record.caseId, aggregateType: "case", eventType: "case.created", now, ownerId: owner, payload: record });
      return record;
    });
  }

  async function updateCaseInput({ caseId, primaryJob, title, actor }) {
    const eventActor = actorValue(actor);
    return withTransaction(pool, async (client) => {
      const existing = await client.query(
        "select * from nodekit.cases where owner_id = $1 and case_id = $2 for update",
        [owner, caseId],
      );
      if (existing.rowCount !== 1) throw new Error(`case not found: ${caseId}`);
      const current = caseRecord(existing.rows[0]);
      if (current.status === "completed") throw new Error("completed case input cannot be changed");
      const nextPrimaryJob = primaryJob === undefined ? current.primaryJob : requireTrimmedText(primaryJob, "case primaryJob");
      const nextTitle = title === undefined ? current.title : requireTrimmedText(title, "case title");
      if (current.primaryJob === nextPrimaryJob && current.title === nextTitle) return current;
      const now = clock();
      const row = (await client.query(
        `update nodekit.cases set primary_job = $1, title = $2, updated_at = $3
          where owner_id = $4 and case_id = $5 returning *`,
        [nextPrimaryJob, nextTitle, now, owner, caseId],
      )).rows[0];
      const record = caseRecord(row);
      await emit(client, { actor: eventActor, aggregateId: caseId, aggregateType: "case", eventType: "case.updated", now, ownerId: owner, payload: { primaryJob: record.primaryJob, title: record.title } });
      return record;
    });
  }

  async function startRun({ caseId, stages, actor }) {
    const eventActor = actorValue(actor);
    const normalizedStages = normalizeStageDefinitions(stages);
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
        if (current.rowCount === 1 && !TERMINAL_RUN_STATUSES.includes(current.rows[0].status)) {
          const record = runRecord(current.rows[0]);
          if (!stageDefinitionsMatch(record.stages, normalizedStages)) {
            throw new Error("active run stages do not match requested stage plan");
          }
          return record;
        }
      }
      const now = clock();
      const runId = nodeId("run");
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
      await emit(client, { actor: eventActor, aggregateId: runId, aggregateType: "run", eventType: "run.started", now, ownerId: owner, payload: record });
      await emit(client, { actor: eventActor, aggregateId: runId, aggregateType: "run", eventType: "stage.entered", now, ownerId: owner, payload: { stageId: record.currentStageId } });
      return record;
    });
  }

  async function enterStage({ runId, stageId, nextAction, nextActionOwner, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const normalizedStageId = requireTrimmedText(stageId, "stageId");
    const normalizedNextAction = nextAction === undefined ? undefined : requireTrimmedText(nextAction, "nextAction");
    const normalizedNextActionOwner = nextActionOwner === undefined ? undefined : requireTrimmedText(nextActionOwner, "nextActionOwner");
    return withTransaction(pool, async (client) => {
      const request = optionalFields(
        { actor: eventActor, operation: "enterStage", runId, stageId: normalizedStageId },
        { nextAction: normalizedNextAction, nextActionOwner: normalizedNextActionOwner },
      );
      return withIdempotency(client, { idempotencyKey, ownerId: owner, request }, async (journal) => {
        const queryResult = await client.query(
          "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
          [owner, runId],
        );
        if (queryResult.rowCount !== 1) throw new Error(`run not found: ${runId}`);
        const current = runRecord(queryResult.rows[0]);
        if (current.status !== "active") {
          if (TERMINAL_RUN_STATUSES.includes(current.status)) throw new Error(`run is terminal: ${current.status}`);
          throw new Error(`run is not active: ${current.status}`);
        }
        const targetIndex = current.stages.findIndex((stage) => stage.id === normalizedStageId);
        if (targetIndex < 0) throw new Error(`stage not found: ${normalizedStageId}`);
        const stages = current.stages.map((stage, index) => ({
          ...stage,
          status: index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending",
        }));
        const now = clock();
        const action = normalizedNextAction ?? stages[targetIndex].label;
        const actionOwner = normalizedNextActionOwner ?? stages[targetIndex].owner;
        const row = (await client.query(
          `update nodekit.runs set current_stage_id = $1, next_action = $2, next_action_owner = $3,
            stages = $4::jsonb, updated_at = $5 where owner_id = $6 and run_id = $7 returning *`,
          [normalizedStageId, action, actionOwner, JSON.stringify(stages), now, owner, runId],
        )).rows[0];
        const record = runRecord(row);
        await emit(client, { ...journal, actor: eventActor, aggregateId: runId, aggregateType: "run", eventType: "stage.entered", now, ownerId: owner, payload: { nextAction: action, nextActionOwner: actionOwner, stageId: normalizedStageId }, result: record });
        return record;
      });
    });
  }

  async function createArtifact({ caseId, runId, kind = "generic", title = "Artifact", content, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const portableContent = normalizePortableValue(content, "content", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    const normalizedKind = requireTrimmedText(kind, "kind");
    const normalizedTitle = requireTrimmedText(title, "title");
    return withTransaction(pool, async (client) => {
      const request = { actor: eventActor, caseId, content: portableContent, kind: normalizedKind, operation: "createArtifact", runId, title: normalizedTitle };
      return withIdempotency(client, { idempotencyKey, ownerId: owner, request }, async (journal) => {
        const caseReference = await client.query(
          "select 1 from nodekit.cases where owner_id = $1 and case_id = $2",
          [owner, caseId],
        );
        if (caseReference.rowCount !== 1) throw new Error(`case not found: ${caseId}`);
        const runReference = await client.query(
          "select status from nodekit.runs where owner_id = $1 and run_id = $2 and case_id = $3 for update",
          [owner, runId, caseId],
        );
        if (runReference.rowCount !== 1) throw new Error(`run not found: ${runId}`);
        if (runReference.rows[0].status !== "active") {
          if (TERMINAL_RUN_STATUSES.includes(runReference.rows[0].status)) throw new Error(`run is terminal: ${runReference.rows[0].status}`);
          throw new Error(`run is not active: ${runReference.rows[0].status}`);
        }
        const now = clock();
        const artifactId = nodeId("artifact");
        await client.query(
          `insert into nodekit.artifacts
            (artifact_id, owner_id, case_id, run_id, kind, title, canonical_version, created_at, updated_at)
            values ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
          [artifactId, owner, caseId, runId, normalizedKind, normalizedTitle, now],
        );
        await client.query(
          `insert into nodekit.artifact_versions (artifact_id, version, content, content_hash, created_at)
            values ($1, 1, $2::jsonb, $3, $4)`,
          [artifactId, JSON.stringify(portableContent), contentHash(portableContent), now],
        );
        const record = await loadArtifact(client, owner, artifactId);
        await emit(client, { ...journal, actor: eventActor, aggregateId: artifactId, aggregateType: "artifact", eventType: "artifact.created", now, ownerId: owner, payload: { artifactId, version: 1 }, result: record });
        return record;
      });
    });
  }

  async function createProposal({ artifactId, baseVersion, patch, rationale = "", actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const portablePatch = normalizePortableValue(patch, "patch", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    if (!Number.isInteger(baseVersion) || baseVersion < 1) throw new Error("baseVersion must be a positive integer");
    if (typeof rationale !== "string") throw new TypeError("rationale must be a string");
    return withTransaction(pool, async (client) => {
      const request = { actor: eventActor, artifactId, baseVersion, operation: "createProposal", patch: portablePatch, rationale };
      return withIdempotency(client, { idempotencyKey, ownerId: owner, request }, async (journal) => {
        const artifact = await client.query(
          "select * from nodekit.artifacts where owner_id = $1 and artifact_id = $2 for update",
          [owner, artifactId],
        );
        if (artifact.rowCount !== 1) throw new Error(`artifact not found: ${artifactId}`);
        const run = await client.query(
          "select status from nodekit.runs where owner_id = $1 and run_id = $2 for update",
          [owner, artifact.rows[0].run_id],
        );
        if (run.rowCount !== 1) throw new Error(`run not found: ${artifact.rows[0].run_id}`);
        if (run.rows[0].status !== "active") {
          if (TERMINAL_RUN_STATUSES.includes(run.rows[0].status)) throw new Error(`run is terminal: ${run.rows[0].status}`);
          throw new Error(`run is not active: ${run.rows[0].status}`);
        }
        if (baseVersion !== artifact.rows[0].canonical_version) {
          throw new Error(`proposal base version ${baseVersion} is stale; canonical version is ${artifact.rows[0].canonical_version}`);
        }
        const now = clock();
        const proposalId = nodeId("proposal");
        const patchHash = contentHash(portablePatch);
        const row = (await client.query(
          `insert into nodekit.proposals
            (proposal_id, owner_id, artifact_id, base_version, patch, patch_hash, rationale, status, created_at)
            values ($1, $2, $3, $4, $5::jsonb, $6, $7, 'pending', $8) returning *`,
          [proposalId, owner, artifactId, baseVersion, JSON.stringify(portablePatch), patchHash, rationale, now],
        )).rows[0];
        const record = proposalRecord(row);
        await emit(client, {
          ...journal,
          actor: eventActor,
          aggregateId: proposalId,
          aggregateType: "proposal",
          eventType: "proposal.created",
          now,
          ownerId: owner,
          payload: { artifactId: record.artifactId, baseVersion: record.baseVersion, proposalId: record.proposalId },
          result: record,
        });
        return record;
      });
    });
  }

  async function decideProposal({ proposalId, decision, actor, comment = "" }) {
    const eventActor = actorValue(actor);
    if (typeof comment !== "string") throw new TypeError("comment must be a string");
    if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("decision must be accepted or rejected");
    return withTransaction(pool, async (client) => {
      const now = clock();
      const result = (await client.query(
        "select * from nodekit.apply_proposal($1, $2, $3, $4, $5, $6)",
        [owner, proposalId, decision, nodeId("approval"), comment, now],
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
      if (result.reused) {
        const decisionEvent = await client.query(
          `select actor from nodekit.events
            where owner_id = $1 and aggregate_type = 'proposal' and aggregate_id = $2 and event_type = $3
            order by sequence desc limit 1`,
          [owner, proposalId, `proposal.${proposal.status}`],
        );
        if (approval.comment !== comment
          || decisionEvent.rowCount !== 1
          || contentHash(json(decisionEvent.rows[0].actor)) !== contentHash(eventActor)) {
          throw new Error(`proposal retry does not match original decision request; proposal is already ${proposal.status}`);
        }
      }
      if (!result.reused) {
        if (proposal.status === "accepted") {
          await emit(client, { actor: eventActor, aggregateId: artifact.artifactId, aggregateType: "artifact", eventType: "artifact.version_created", now, ownerId: owner, payload: { proposalId, version: artifact.canonicalVersion } });
        }
        const payload = proposal.status === "conflicted"
          ? { canonicalVersion: artifact.canonicalVersion }
          : { approvalId: approval.approvalId };
        await emit(client, { actor: eventActor, aggregateId: proposalId, aggregateType: "proposal", eventType: `proposal.${proposal.status}`, now, ownerId: owner, payload });
      }
      return { approval, artifact, proposal, reused: result.reused };
    });
  }

  async function raiseException({ runId, code, message, preservedState = {}, actor, idempotencyKey }) {
    const eventActor = actorValue(actor);
    const normalizedCode = requireTrimmedText(code ?? "unknown", "code");
    const normalizedMessage = requireTrimmedText(message ?? "An exception occurred.", "message");
    const portableState = normalizePortableValue(preservedState, "preservedState", {
      maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
    });
    return withTransaction(pool, async (client) => {
      const request = { actor: eventActor, code: normalizedCode, message: normalizedMessage, operation: "raiseException", preservedState: portableState, runId };
      return withIdempotency(client, { idempotencyKey, ownerId: owner, request }, async (journal) => {
        const run = await client.query(
          "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
          [owner, runId],
        );
        if (run.rowCount !== 1) throw new Error(`run not found: ${runId}`);
        if (TERMINAL_RUN_STATUSES.includes(run.rows[0].status)) throw new Error(`run is terminal: ${run.rows[0].status}`);
        const now = clock();
        const exceptionId = nodeId("exception");
        const row = (await client.query(
          `insert into nodekit.exceptions
            (exception_id, owner_id, run_id, code, message, preserved_state, status, resolution, raised_at)
            values ($1, $2, $3, $4, $5, $6::jsonb, 'open', null, $7) returning *`,
          [exceptionId, owner, runId, normalizedCode, normalizedMessage, JSON.stringify(portableState), now],
        )).rows[0];
        await client.query(
          "update nodekit.runs set status = 'blocked', next_action = 'Resolve exception', next_action_owner = 'user', updated_at = $1 where owner_id = $2 and run_id = $3",
          [now, owner, runId],
        );
        const record = exceptionRecord(row);
        await emit(client, {
          ...journal,
          actor: eventActor,
          aggregateId: runId,
          aggregateType: "run",
          eventType: "exception.raised",
          now,
          ownerId: owner,
          payload: {
            code: row.code,
            exceptionId,
            messageHash: contentHash(normalizedMessage),
            preservedStateHash: contentHash(portableState),
          },
          result: record,
        });
        return record;
      });
    });
  }

  async function resolveException({ exceptionId, resolution, nextAction, nextActionOwner, actor }) {
    const eventActor = actorValue(actor);
    const normalizedResolution = requireTrimmedText(resolution ?? "resolved", "resolution");
    const normalizedNextAction = nextAction === undefined ? undefined : requireTrimmedText(nextAction, "nextAction");
    const normalizedNextActionOwner = nextActionOwner === undefined ? undefined : requireTrimmedText(nextActionOwner, "nextActionOwner");
    return withTransaction(pool, async (client) => {
      const existing = await client.query(
        "select * from nodekit.exceptions where owner_id = $1 and exception_id = $2 for update",
        [owner, exceptionId],
      );
      if (existing.rowCount !== 1) throw new Error(`exception not found: ${exceptionId}`);
      if (existing.rows[0].status !== "open") throw new Error("exception is already resolved");
      const lockedRun = await client.query(
        "select status from nodekit.runs where owner_id = $1 and run_id = $2 for update",
        [owner, existing.rows[0].run_id],
      );
      if (lockedRun.rowCount !== 1) throw new Error(`run not found: ${existing.rows[0].run_id}`);
      if (TERMINAL_RUN_STATUSES.includes(lockedRun.rows[0].status)) throw new Error(`run is terminal: ${lockedRun.rows[0].status}`);
      const now = clock();
      const resolved = (await client.query(
        `update nodekit.exceptions set status = 'resolved', resolution = $1, resolved_at = $2
          where owner_id = $3 and exception_id = $4 returning *`,
        [normalizedResolution, now, owner, exceptionId],
      )).rows[0];
      const remaining = await client.query(
        "select 1 from nodekit.exceptions where owner_id = $1 and run_id = $2 and status = 'open' limit 1",
        [owner, resolved.run_id],
      );
      const runState = remaining.rowCount > 0
        ? { status: "blocked", nextAction: "Resolve remaining exception", nextActionOwner: "user" }
        : { status: "active", nextAction: normalizedNextAction ?? "Continue run", nextActionOwner: normalizedNextActionOwner ?? "system" };
      const runRow = (await client.query(
        `update nodekit.runs set status = $1, next_action = $2, next_action_owner = $3, updated_at = $4
          where owner_id = $5 and run_id = $6 returning *`,
        [runState.status, runState.nextAction, runState.nextActionOwner, now, owner, resolved.run_id],
      )).rows[0];
      await emit(client, { actor: eventActor, aggregateId: resolved.run_id, aggregateType: "run", eventType: "exception.resolved", now, ownerId: owner, payload: { exceptionId, resolution: resolved.resolution } });
      return { exception: exceptionRecord(resolved), run: runRecord(runRow) };
    });
  }

  async function terminalizeRun({ runId, status, reason, actor }) {
    const terminalActor = actorValue(actor);
    const eventType = `run.${status}`;
    const terminalPayload = status === "completed" ? {} : { reason };
    return withTransaction(pool, async (client) => {
      const runResult = await client.query(
        "select * from nodekit.runs where owner_id = $1 and run_id = $2 for update",
        [owner, runId],
      );
      if (runResult.rowCount !== 1) throw new Error(`run not found: ${runId}`);
      const current = runRecord(runResult.rows[0]);
      if (current.status === status) {
        const receipt = await client.query(
          "select * from nodekit.receipts where owner_id = $1 and run_id = $2",
          [owner, runId],
        );
        if (receipt.rowCount !== 1) throw new Error(`${status} run is missing its receipt`);
        const terminalEvent = await client.query(
          `select actor, payload from nodekit.events
            where owner_id = $1 and aggregate_id = $2 and event_type = $3
            order by sequence asc limit 1`,
          [owner, runId, eventType],
        );
        if (terminalEvent.rowCount !== 1
          || contentHash(json(terminalEvent.rows[0].actor)) !== contentHash(terminalActor)
          || contentHash(json(terminalEvent.rows[0].payload)) !== contentHash(terminalPayload)) {
          throw new Error("terminal retry does not match the original request");
        }
        return { receipt: receiptRecord(receipt.rows[0]), run: current, reused: true };
      }
      if (TERMINAL_RUN_STATUSES.includes(current.status)) throw new Error(`run is terminal: ${current.status}`);
      if (status === "completed" && current.status !== "active") throw new Error(`run is not active: ${current.status}`);
      const artifactRows = (await client.query(
        "select * from nodekit.artifacts where owner_id = $1 and run_id = $2 order by artifact_id",
        [owner, runId],
      )).rows;
      if (status === "completed") {
        if (artifactRows.length === 0) throw new Error("run must have at least one canonical artifact");
        const open = await client.query(
          "select 1 from nodekit.exceptions where owner_id = $1 and run_id = $2 and status = 'open' limit 1",
          [owner, runId],
        );
        if (open.rowCount > 0) throw new Error("run has unresolved exceptions");
        const pending = await client.query(
          `select 1 from nodekit.proposals p
            join nodekit.artifacts a on a.artifact_id = p.artifact_id
            where p.owner_id = $1 and a.owner_id = $1 and a.run_id = $2 and p.status = 'pending' limit 1`,
          [owner, runId],
        );
        if (pending.rowCount > 0) throw new Error("run has pending proposals");
      }
      const now = clock();
      const stages = status === "completed"
        ? current.stages.map((stage) => ({ ...stage, status: "completed" }))
        : current.stages;
      const completedRow = (await client.query(
        `update nodekit.runs set status = $1, next_action = $2, next_action_owner = 'user',
          stages = $3::jsonb, updated_at = $4 where owner_id = $5 and run_id = $6 returning *`,
        [status, status === "completed" ? "Review receipt" : "Start a new run", JSON.stringify(stages), now, owner, runId],
      )).rows[0];
      await client.query(
        "update nodekit.cases set status = $1, updated_at = $2 where owner_id = $3 and case_id = $4",
        [status === "completed" ? "completed" : "ready", now, owner, current.caseId],
      );
      await emit(client, { actor: terminalActor, aggregateId: runId, aggregateType: "run", eventType, now, ownerId: owner, payload: terminalPayload });
      const rawArtifactBindings = (await client.query(
        `select a.artifact_id, a.canonical_version, v.content_hash
          from nodekit.artifacts a join nodekit.artifact_versions v
            on v.artifact_id = a.artifact_id and v.version = a.canonical_version
          where a.owner_id = $1 and a.run_id = $2`,
        [owner, runId],
      )).rows.map((row) => ({ artifactId: row.artifact_id, canonicalVersion: row.canonical_version, contentHash: row.content_hash }));
      const rawArtifactIds = rawArtifactBindings.map((entry) => entry.artifactId);
      const proposalRows = rawArtifactIds.length === 0 ? [] : (await client.query(
        "select * from nodekit.proposals where owner_id = $1 and artifact_id = any($2::text[])",
        [owner, rawArtifactIds],
      )).rows;
      const rawProposalBindings = proposalRows.map((row) => ({
        artifactId: row.artifact_id,
        baseVersion: row.base_version,
        patchHash: row.patch_hash,
        proposalId: row.proposal_id,
        status: row.status,
      }));
      const rawProposalIds = rawProposalBindings.map((entry) => entry.proposalId);
      const approvalRows = rawProposalIds.length === 0 ? [] : (await client.query(
        "select * from nodekit.approvals where owner_id = $1 and proposal_id = any($2::text[])",
        [owner, rawProposalIds],
      )).rows;
      const rawApprovalBindings = approvalRows.map((row) => ({
        approvalId: row.approval_id,
        commentHash: contentHash(row.comment),
        decision: row.decision,
        proposalId: row.proposal_id,
      }));
      const aggregateIds = [runId, ...rawArtifactIds, ...rawProposalIds];
      const eventRows = (await client.query(
        "select * from nodekit.events where owner_id = $1 and aggregate_id = any($2::text[])",
        [owner, aggregateIds],
      )).rows;
      const rawEventBindings = eventRows.map((row) => ({
        actorHash: contentHash(json(row.actor)),
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        eventId: row.event_id,
        eventType: row.event_type,
        payloadHash: contentHash(json(row.payload)),
        sequence: row.sequence,
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
      const completedCase = caseRecord((await client.query(
        "select * from nodekit.cases where owner_id = $1 and case_id = $2",
        [owner, current.caseId],
      )).rows[0]);
      const completedRun = runRecord(completedRow);
      const receiptBody = {
        approvalBindings,
        artifactBindings,
        artifactIds,
        caseHash: contentHash(completedCase),
        caseId: current.caseId,
        eventBindings,
        eventIds,
        generatedAt: now,
        proposalBindings,
        proposalIds,
        runHash: contentHash(completedRun),
        runId,
        schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
        status,
      };
      const receipt = { ...receiptBody, receiptId: nodeId("receipt"), receiptHash: contentHash(receiptBody) };
      await client.query(
        `insert into nodekit.receipts (receipt_id, owner_id, run_id, receipt_hash, body, generated_at)
          values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [receipt.receiptId, owner, runId, receipt.receiptHash, JSON.stringify(receipt), now],
      );
      await emit(client, { actor: terminalActor, aggregateId: runId, aggregateType: "run", eventType: "receipt.created", now, ownerId: owner, payload: { receiptHash: receipt.receiptHash, receiptId: receipt.receiptId } });
      return { receipt, run: completedRun, reused: false };
    });
  }

  async function completeRun({ runId, actor }) {
    return terminalizeRun({ actor, runId, status: "completed" });
  }

  async function cancelRun({ runId, reason, actor }) {
    return terminalizeRun({
      actor,
      reason: requireTrimmedText(reason ?? "Cancelled by request.", "reason"),
      runId,
      status: "cancelled",
    });
  }

  async function failRunSafely({ runId, reason, actor }) {
    return terminalizeRun({
      actor,
      reason: requireTrimmedText(reason ?? "Run failed safely.", "reason"),
      runId,
      status: "failed_safely",
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
    ownerId: owner,
    provider: "postgres",
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
