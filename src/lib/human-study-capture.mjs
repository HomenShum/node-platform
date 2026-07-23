import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const HUMAN_STUDY_INSTRUCTION = "Use this app to complete the job shown on screen.";
export const HUMAN_STUDY_CONSENT_VERSION = "nodekit-human-study-consent/v1";
export const HUMAN_STUDY_EVIDENCE_ROOT = "proof/ease/humans";
export const HUMAN_STUDY_THRESHOLDS = Object.freeze({
  minimumUnassistedCompletions: 4,
  minimumOutcomeComprehensions: 4,
  minimumFinalArtifactsLocated: 4,
  minimumUnresolvedIssuesLocated: 4,
  maximumMedianFirstMeaningfulActionMs: 30_000,
  maximumMedianNeutralJourneyMs: 180_000,
  minimumMedianSingleEaseQuestion: 6,
  maximumP0P1Failures: 0,
});

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PARTICIPANT_ID = /^participant_[a-f0-9]{16}$/;
const SAFE_LABEL = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MONOTONIC = /^\d+$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EVENT_TYPES = new Set([
  "session.started",
  "session.resumed",
  "first-meaningful-action.recorded",
  "first-meaningful-action.not-reached",
  "journey.ended",
  "wrong-turn.recorded",
  "help-request.recorded",
  "p0-p1-failure.recorded",
  "evidence.imported",
  "session.finalized",
]);
const MANUAL_EVENT_TYPES = new Set([
  "session.resumed",
  "first-meaningful-action.recorded",
  "first-meaningful-action.not-reached",
  "journey.ended",
  "wrong-turn.recorded",
  "help-request.recorded",
  "p0-p1-failure.recorded",
]);
const RESULT_FIELDS = [
  "completed",
  "assisted",
  "canExplainOutcome",
  "locatedFinalArtifact",
  "locatedUnresolvedIssues",
];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields changed; expected only ${wanted.join(", ")}`);
  }
}

function prettyBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("screenshot evidence does not have a valid PNG signature and chunk envelope");
  }
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("screenshot PNG contains a truncated chunk");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8);
    const typeName = type.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (!/^[A-Za-z]{4}$/.test(typeName) || crcOffset + 4 > bytes.length) throw new Error("screenshot PNG contains an invalid chunk");
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([type, bytes.subarray(dataStart, dataEnd)]));
    if (actualCrc !== expectedCrc) throw new Error(`screenshot PNG ${typeName} chunk CRC is invalid`);
    if (chunkIndex === 0) {
      if (typeName !== "IHDR" || length !== 13) throw new Error("screenshot PNG must begin with a 13-byte IHDR chunk");
      if (bytes.readUInt32BE(dataStart) < 1 || bytes.readUInt32BE(dataStart + 4) < 1) throw new Error("screenshot PNG dimensions must be positive");
    }
    offset = crcOffset + 4;
    chunkIndex += 1;
    if (typeName === "IEND") {
      if (length !== 0 || offset !== bytes.length) throw new Error("screenshot PNG IEND must be empty and final");
      sawIend = true;
      break;
    }
  }
  if (!sawIend) throw new Error("screenshot PNG is missing IEND");
}

function exactBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be an explicit boolean`);
  return value;
}

function exactInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function assertIdentity(nodekitCommit, nodekitSourceHash) {
  if (!COMMIT.test(nodekitCommit ?? "")) throw new Error("nodekitCommit must be an immutable lowercase 40-character commit");
  if (!SHA256.test(nodekitSourceHash ?? "")) throw new Error("nodekitSourceHash must be a lowercase 64-character SHA-256 digest");
}

function assertParticipantId(participantId) {
  if (!PARTICIPANT_ID.test(participantId ?? "")) throw new Error("participantId must be the anonymous ID generated by this operator");
}

function assertIso(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
}

function assertMonotonic(value, label) {
  if (!MONOTONIC.test(value ?? "")) throw new Error(`${label} must be an unsigned monotonic nanosecond string`);
}

function defaultClock() {
  return {
    nowIso: () => new Date().toISOString(),
    monotonicNs: () => process.hrtime.bigint(),
  };
}

function normalizeClock(clock) {
  const resolved = clock ?? defaultClock();
  if (typeof resolved.nowIso !== "function" || typeof resolved.monotonicNs !== "function") {
    throw new Error("clock must expose nowIso() and monotonicNs()");
  }
  return resolved;
}

function millisecondsBetween(startNs, endNs) {
  const difference = BigInt(endNs) - BigInt(startNs);
  if (difference < 0n) throw new Error("monotonic clock moved backwards; this session cannot be certified");
  return Number(difference) / 1_000_000;
}

function portablePath(repoRoot, absolute) {
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("evidence path escapes the repository");
  return relative.replaceAll("\\", "/");
}

function assertPortableEvidencePath(value, label) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be one canonical repository-relative POSIX path`);
  }
}

async function exclusiveWrite(file, bytes) {
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
}

async function writeIfMissingOrExact(file, bytes) {
  try {
    await exclusiveWrite(file, bytes);
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(file);
    if (!existing.equals(bytes)) throw new Error(`${file} already exists with different bytes; refusing to overwrite evidence`);
    return "already-present";
  }
}

async function resolveRepo(repoRoot) {
  const root = await realpath(path.resolve(repoRoot ?? process.cwd()));
  const evidenceRoot = path.resolve(root, HUMAN_STUDY_EVIDENCE_ROOT);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const resolvedEvidenceRoot = await realpath(evidenceRoot);
  if (path.relative(root, resolvedEvidenceRoot).startsWith("..")) throw new Error("human evidence root escapes the repository");
  return { repoRoot: root, evidenceRoot: resolvedEvidenceRoot };
}

function sessionPaths(evidenceRoot, participantId) {
  assertParticipantId(participantId);
  const directory = path.join(evidenceRoot, participantId);
  return {
    directory,
    evidenceDirectory: path.join(directory, "evidence"),
    events: path.join(directory, "events.jsonl"),
    lock: path.join(directory, ".operator.lock"),
    meta: path.join(directory, "session-meta.json"),
    participant: path.join(directory, "participant.json"),
    sessionLog: path.join(directory, "session-log.json"),
  };
}

async function withLock(paths, operation) {
  let handle;
  try {
    handle = await open(paths.lock, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another operator command is active, or a prior command stopped unexpectedly; inspect .operator.lock before removing it");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(paths.lock, { force: true });
  }
}

function eventBody({ participantId, sequence, type, occurredAt, monotonicNs, previousEventSha256, payload = {} }) {
  return {
    schemaVersion: "nodekit.human-study-event/v1",
    participantId,
    sequence,
    type,
    occurredAt,
    monotonicNs: String(monotonicNs),
    previousEventSha256,
    payload,
  };
}

function sealEvent(body) {
  return { ...body, eventSha256: sha256(canonicalBytes(body)) };
}

function validateEvent(event, expectedParticipantId, expectedSequence, previousEventSha256) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("session event must be an object");
  assertExactKeys(event, [
    "schemaVersion", "participantId", "sequence", "type", "occurredAt", "monotonicNs",
    "previousEventSha256", "payload", "eventSha256",
  ], "session event");
  if (event.schemaVersion !== "nodekit.human-study-event/v1") throw new Error("session event has an unsupported schemaVersion");
  if (event.participantId !== expectedParticipantId) throw new Error("session event participantId changed");
  if (event.sequence !== expectedSequence) throw new Error("session event sequence is not contiguous");
  if (!EVENT_TYPES.has(event.type)) throw new Error(`unsupported session event type: ${event.type}`);
  assertIso(event.occurredAt, "event occurredAt");
  assertMonotonic(event.monotonicNs, "event monotonicNs");
  if (event.previousEventSha256 !== previousEventSha256) throw new Error("session event hash chain is broken");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("session event payload must be an object");
  if (event.type === "session.started") {
    assertExactKeys(event.payload, ["consentRecorded", "consentVersion", "recordingConsent", "fresh"], "session.started payload");
    if (event.payload.consentRecorded !== true || event.payload.consentVersion !== HUMAN_STUDY_CONSENT_VERSION || typeof event.payload.recordingConsent !== "boolean" || event.payload.fresh !== true) {
      throw new Error("session.started payload does not prove the fixed consent and freshness contract");
    }
  } else if (event.type === "evidence.imported") {
    assertExactKeys(event.payload, ["evidenceKind", "evidencePath", "evidenceSha256", "bytes", "label"], "evidence.imported payload");
    if (!new Set(["screenshot", "recording"]).has(event.payload.evidenceKind)) throw new Error("evidence.imported kind is invalid");
    assertPortableEvidencePath(event.payload.evidencePath, "evidence.imported evidencePath");
    if (!SHA256.test(event.payload.evidenceSha256 ?? "")) throw new Error("evidence.imported SHA-256 is invalid");
    if (!Number.isInteger(event.payload.bytes) || event.payload.bytes < 1) throw new Error("evidence.imported byte count is invalid");
    if (!SAFE_LABEL.test(event.payload.label ?? "")) throw new Error("evidence.imported label is invalid");
    const expectedStem = `${HUMAN_STUDY_EVIDENCE_ROOT}/${expectedParticipantId}/evidence/${event.payload.evidenceKind}-${event.payload.label}-${event.payload.evidenceSha256.slice(0, 16)}`;
    const allowedPaths = event.payload.evidenceKind === "screenshot"
      ? new Set([`${expectedStem}.png`])
      : new Set([`${expectedStem}.mp4`, `${expectedStem}.webm`]);
    if (!allowedPaths.has(event.payload.evidencePath)) throw new Error("evidence.imported path does not match its participant, kind, label, and digest");
  } else if (event.type === "session.finalized") {
    assertExactKeys(event.payload, [...RESULT_FIELDS, "singleEaseQuestion"], "session.finalized payload");
    for (const field of RESULT_FIELDS) exactBoolean(event.payload[field], `session.finalized ${field}`);
    exactInteger(event.payload.singleEaseQuestion, "session.finalized singleEaseQuestion", 1, 7);
  } else {
    assertExactKeys(event.payload, [], `${event.type} payload`);
  }
  const { eventSha256, ...body } = event;
  if (!SHA256.test(eventSha256 ?? "") || sha256(canonicalBytes(body)) !== eventSha256) throw new Error("session event digest is invalid");
}

async function readEvents(paths, participantId) {
  const eventFile = await lstat(paths.events, { bigint: true });
  if (!eventFile.isFile() || eventFile.isSymbolicLink() || eventFile.nlink !== 1n) throw new Error("session event log must be one unaliased regular file");
  const raw = await readFile(paths.events, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("session event log is empty");
  const events = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`session event ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    validateEvent(events[index], participantId, index + 1, previous);
    if (index > 0 && BigInt(events[index].monotonicNs) < BigInt(events[index - 1].monotonicNs)) {
      throw new Error("session monotonic time moved backwards; evidence is not certifiable");
    }
    previous = events[index].eventSha256;
  }
  if (events[0].type !== "session.started") throw new Error("session must begin with session.started");
  if (events.filter((event) => event.type === "session.started").length !== 1) throw new Error("session.started must occur exactly once");
  if (events.filter((event) => event.type === "session.finalized").length > 1) throw new Error("session.finalized may occur at most once");
  if (events.some((event, index) => event.type === "session.finalized" && index !== events.length - 1)) throw new Error("no event may follow session.finalized");
  return events;
}

async function readMeta(paths) {
  const metaFile = await lstat(paths.meta, { bigint: true });
  if (!metaFile.isFile() || metaFile.isSymbolicLink() || metaFile.nlink !== 1n) throw new Error("session metadata must be one unaliased regular file");
  const meta = JSON.parse(await readFile(paths.meta, "utf8"));
  assertExactKeys(meta, [
    "schemaVersion", "participantId", "nodekitCommit", "nodekitSourceHash", "instruction",
    "consentRecorded", "consentVersion", "recordingConsent", "fresh", "createdAt",
  ], "human session metadata");
  if (meta.schemaVersion !== "nodekit.human-study-session-meta/v1") throw new Error("unsupported human session metadata");
  assertParticipantId(meta.participantId);
  assertIdentity(meta.nodekitCommit, meta.nodekitSourceHash);
  if (meta.instruction !== HUMAN_STUDY_INSTRUCTION) throw new Error("human-study instruction changed");
  if (meta.consentRecorded !== true || meta.consentVersion !== HUMAN_STUDY_CONSENT_VERSION) throw new Error("valid explicit consent is not recorded");
  if (typeof meta.recordingConsent !== "boolean") throw new Error("recording consent choice is not recorded");
  if (meta.fresh !== true) throw new Error("session is not marked fresh");
  assertIso(meta.createdAt, "session createdAt");
  return meta;
}

async function appendSealedEvent(paths, participantId, events, type, payload, clock) {
  const occurredAt = clock.nowIso();
  const monotonicNs = String(clock.monotonicNs());
  assertIso(occurredAt, "event occurredAt");
  assertMonotonic(monotonicNs, "event monotonicNs");
  const last = events.at(-1);
  if (last && BigInt(monotonicNs) < BigInt(last.monotonicNs)) throw new Error("monotonic clock moved backwards; refusing to append evidence");
  const event = sealEvent(eventBody({
    participantId,
    sequence: events.length + 1,
    type,
    occurredAt,
    monotonicNs,
    previousEventSha256: last?.eventSha256 ?? null,
    payload,
  }));
  await appendFile(paths.events, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  return event;
}

async function allocateParticipantDirectory(evidenceRoot) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const participantId = `participant_${randomBytes(8).toString("hex")}`;
    const paths = sessionPaths(evidenceRoot, participantId);
    try {
      await mkdir(paths.directory, { mode: 0o700 });
      await mkdir(paths.evidenceDirectory, { mode: 0o700 });
      return { participantId, paths };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("unable to allocate a unique anonymous participant ID");
}

export async function startHumanStudySession({
  repoRoot = process.cwd(),
  nodekitCommit,
  nodekitSourceHash,
  consent,
  consentVersion = HUMAN_STUDY_CONSENT_VERSION,
  recordingConsent,
  fresh,
  clock,
} = {}) {
  assertIdentity(nodekitCommit, nodekitSourceHash);
  if (consent !== true) throw new Error("start refused: obtain explicit participant consent and pass consent=true");
  if (consentVersion !== HUMAN_STUDY_CONSENT_VERSION) throw new Error(`consentVersion must be ${HUMAN_STUDY_CONSENT_VERSION}`);
  exactBoolean(recordingConsent, "recordingConsent");
  if (fresh !== true) throw new Error("start refused: only a genuinely fresh participant can enter the decisive study");
  const resolvedClock = normalizeClock(clock);
  const roots = await resolveRepo(repoRoot);
  const { participantId, paths } = await allocateParticipantDirectory(roots.evidenceRoot);
  const createdAt = resolvedClock.nowIso();
  const monotonicNs = String(resolvedClock.monotonicNs());
  assertIso(createdAt, "session createdAt");
  assertMonotonic(monotonicNs, "session monotonicNs");
  const meta = {
    schemaVersion: "nodekit.human-study-session-meta/v1",
    participantId,
    nodekitCommit,
    nodekitSourceHash,
    instruction: HUMAN_STUDY_INSTRUCTION,
    consentRecorded: true,
    consentVersion,
    recordingConsent,
    fresh: true,
    createdAt,
  };
  const started = sealEvent(eventBody({
    participantId,
    sequence: 1,
    type: "session.started",
    occurredAt: createdAt,
    monotonicNs,
    previousEventSha256: null,
    payload: { consentRecorded: true, consentVersion, recordingConsent, fresh: true },
  }));
  try {
    await exclusiveWrite(paths.meta, prettyBytes(meta));
    await exclusiveWrite(paths.events, Buffer.from(`${JSON.stringify(started)}\n`, "utf8"));
  } catch (error) {
    await rm(paths.directory, { recursive: true, force: true });
    throw error;
  }
  return {
    participantId,
    directory: portablePath(roots.repoRoot, paths.directory),
    instruction: HUMAN_STUDY_INSTRUCTION,
    nodekitCommit,
    nodekitSourceHash,
    status: "active",
  };
}

export async function recordHumanStudyEvent({ repoRoot = process.cwd(), participantId, type, clock } = {}) {
  assertParticipantId(participantId);
  if (!MANUAL_EVENT_TYPES.has(type)) throw new Error(`unsupported operator event: ${type}`);
  const resolvedClock = normalizeClock(clock);
  const roots = await resolveRepo(repoRoot);
  const paths = sessionPaths(roots.evidenceRoot, participantId);
  return withLock(paths, async () => {
    await readMeta(paths);
    const events = await readEvents(paths, participantId);
    if (events.at(-1)?.type === "session.finalized") throw new Error("session is finalized; no additional events are permitted");
    const firstActionEvents = events.filter((event) => event.type.startsWith("first-meaningful-action."));
    if (type.startsWith("first-meaningful-action.") && firstActionEvents.length > 0) throw new Error("first meaningful action has already been recorded");
    if (type === "journey.ended" && events.some((event) => event.type === "journey.ended")) throw new Error("journey end has already been recorded");
    if (type === "session.resumed" && events.at(-1)?.type === "session.resumed") throw new Error("session is already marked resumed");
    const event = await appendSealedEvent(paths, participantId, events, type, {}, resolvedClock);
    return { participantId, type, sequence: event.sequence, occurredAt: event.occurredAt, monotonicNs: event.monotonicNs };
  });
}

function validateEvidenceBytes(kind, sourceFile, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("evidence file is empty");
  const extension = path.extname(sourceFile).toLowerCase();
  if (kind === "screenshot") {
    if (extension !== ".png") throw new Error("screenshot evidence must be a PNG file");
    validatePng(bytes);
  } else if (kind === "recording") {
    if (![".mp4", ".webm"].includes(extension)) throw new Error("recording evidence must be .mp4 or .webm");
  } else {
    throw new Error("evidence kind must be screenshot or recording");
  }
  return extension;
}

export async function importHumanStudyEvidence({
  repoRoot = process.cwd(),
  participantId,
  kind,
  sourceFile,
  label,
  clock,
} = {}) {
  assertParticipantId(participantId);
  if (!SAFE_LABEL.test(label ?? "")) throw new Error("evidence label must use 1-48 lowercase letters, numbers, or hyphens");
  if (typeof sourceFile !== "string" || sourceFile.length === 0) throw new Error("sourceFile is required");
  const bytes = await readFile(path.resolve(sourceFile));
  const extension = validateEvidenceBytes(kind, sourceFile, bytes);
  const evidenceSha256 = sha256(bytes);
  const resolvedClock = normalizeClock(clock);
  const roots = await resolveRepo(repoRoot);
  const paths = sessionPaths(roots.evidenceRoot, participantId);
  return withLock(paths, async () => {
    const meta = await readMeta(paths);
    if (kind === "recording" && meta.recordingConsent !== true) throw new Error("recording import refused: the participant did not explicitly consent to session recording");
    const events = await readEvents(paths, participantId);
    if (events.at(-1)?.type === "session.finalized") throw new Error("session is finalized; evidence cannot be added");
    const priorByHash = events.find((event) => event.type === "evidence.imported" && event.payload.evidenceSha256 === evidenceSha256);
    if (priorByHash) {
      if (priorByHash.payload.evidenceKind !== kind || priorByHash.payload.label !== label) {
        throw new Error("these exact evidence bytes were already imported under another kind or label");
      }
      const existing = await readFile(path.resolve(roots.repoRoot, priorByHash.payload.evidencePath));
      if (sha256(existing) !== evidenceSha256) throw new Error("previously imported evidence no longer matches its digest");
      return { participantId, alreadyImported: true, kind, label, path: priorByHash.payload.evidencePath, sha256: evidenceSha256, bytes: bytes.length };
    }
    const destination = path.join(paths.evidenceDirectory, `${kind}-${label}-${evidenceSha256.slice(0, 16)}${extension}`);
    const evidencePath = portablePath(roots.repoRoot, destination);
    await writeIfMissingOrExact(destination, bytes);
    const event = await appendSealedEvent(paths, participantId, events, "evidence.imported", {
      evidenceKind: kind,
      evidencePath,
      evidenceSha256,
      bytes: bytes.length,
      label,
    }, resolvedClock);
    return { participantId, alreadyImported: false, kind, label, path: evidencePath, sha256: evidenceSha256, bytes: bytes.length, sequence: event.sequence };
  });
}

function eventCount(events, type) {
  return events.filter((event) => event.type === type).length;
}

function deriveFinalizedArtifacts(meta, events, repoRoot, paths) {
  const started = events[0];
  const finalized = events.at(-1);
  if (finalized?.type !== "session.finalized") throw new Error("session is not finalized");
  const firstActionEvents = events.filter((event) => event.type.startsWith("first-meaningful-action."));
  const journeyEvents = events.filter((event) => event.type === "journey.ended");
  if (firstActionEvents.length !== 1) throw new Error("exactly one first-action result is required");
  if (journeyEvents.length !== 1) throw new Error("exactly one journey end is required");
  const importedEvidence = events
    .filter((event) => event.type === "evidence.imported")
    .map((event) => ({
      kind: event.payload.evidenceKind,
      path: event.payload.evidencePath,
      sha256: event.payload.evidenceSha256,
      bytes: event.payload.bytes,
      label: event.payload.label,
    }));
  if (!importedEvidence.some((entry) => entry.kind === "screenshot" && entry.label === "completion")) {
    throw new Error("a PNG screenshot labeled completion is required before finalization");
  }
  const result = finalized.payload;
  const firstMeaningfulActionMs = millisecondsBetween(started.monotonicNs, firstActionEvents[0].monotonicNs);
  const neutralJourneyMs = millisecondsBetween(started.monotonicNs, journeyEvents[0].monotonicNs);
  const sessionLog = {
    schemaVersion: "nodekit.human-study-session-log/v1",
    participantId: meta.participantId,
    nodekitCommit: meta.nodekitCommit,
    nodekitSourceHash: meta.nodekitSourceHash,
    instruction: meta.instruction,
    consentRecorded: meta.consentRecorded,
    consentVersion: meta.consentVersion,
    recordingConsent: meta.recordingConsent,
    fresh: meta.fresh,
    sessionStartedAt: started.occurredAt,
    sessionCompletedAt: finalized.occurredAt,
    monotonicStartedNs: started.monotonicNs,
    monotonicCompletedNs: finalized.monotonicNs,
    firstMeaningfulActionMs,
    neutralJourneyMs,
    firstMeaningfulActionReached: firstActionEvents[0].type === "first-meaningful-action.recorded",
    wrongTurns: eventCount(events, "wrong-turn.recorded"),
    helpRequests: eventCount(events, "help-request.recorded"),
    p0P1Failures: eventCount(events, "p0-p1-failure.recorded"),
    result: Object.fromEntries(RESULT_FIELDS.map((field) => [field, result[field]])),
    singleEaseQuestion: result.singleEaseQuestion,
    evidence: importedEvidence,
    events,
    eventLogSha256: sha256(Buffer.from(events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8")),
  };
  const sessionLogBytes = prettyBytes(sessionLog);
  const sessionLogRef = {
    kind: "session-log",
    path: portablePath(repoRoot, paths.sessionLog),
    sha256: sha256(sessionLogBytes),
  };
  const participant = {
    participantId: meta.participantId,
    fresh: true,
    consentRecorded: true,
    sessionStartedAt: sessionLog.sessionStartedAt,
    sessionCompletedAt: sessionLog.sessionCompletedAt,
    evidenceRefs: [
      ...importedEvidence.map(({ kind, path: evidencePath, sha256: evidenceHash }) => ({ kind, path: evidencePath, sha256: evidenceHash })),
      sessionLogRef,
    ],
    firstMeaningfulActionMs,
    neutralJourneyMs,
    wrongTurns: sessionLog.wrongTurns,
    helpRequests: sessionLog.helpRequests,
    singleEaseQuestion: sessionLog.singleEaseQuestion,
    p0P1Failures: sessionLog.p0P1Failures,
    completed: result.completed,
    assisted: result.assisted,
    canExplainOutcome: result.canExplainOutcome,
    locatedFinalArtifact: result.locatedFinalArtifact,
    locatedUnresolvedIssues: result.locatedUnresolvedIssues,
  };
  return { importedEvidence, participant, participantBytes: prettyBytes(participant), sessionLog, sessionLogBytes };
}

async function verifyEvidenceBytes(repoRoot, entries) {
  const seenPaths = new Set();
  const seenHashes = new Set();
  for (const entry of entries) {
    if (seenPaths.has(entry.path)) throw new Error(`evidence path is duplicated: ${entry.path}`);
    if (seenHashes.has(entry.sha256)) throw new Error(`evidence digest is duplicated: ${entry.sha256}`);
    seenPaths.add(entry.path);
    seenHashes.add(entry.sha256);
    const absolute = path.resolve(repoRoot, entry.path);
    if (path.relative(repoRoot, absolute).startsWith("..")) throw new Error(`evidence escapes the repository: ${entry.path}`);
    const linkStat = await lstat(absolute, { bigint: true });
    if (!linkStat.isFile() || linkStat.isSymbolicLink() || linkStat.nlink !== 1n) throw new Error(`evidence must be one unaliased regular file: ${entry.path}`);
    const resolved = await realpath(absolute);
    if (path.relative(repoRoot, resolved).startsWith("..")) throw new Error(`evidence symlink escapes the repository: ${entry.path}`);
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error(`evidence is not a regular file: ${entry.path}`);
    const bytes = await readFile(resolved);
    if (sha256(bytes) !== entry.sha256) throw new Error(`evidence hash mismatch: ${entry.path}`);
  }
}

async function materializeFinalizedSession(meta, events, repoRoot, paths) {
  const derived = deriveFinalizedArtifacts(meta, events, repoRoot, paths);
  await writeIfMissingOrExact(paths.sessionLog, derived.sessionLogBytes);
  await writeIfMissingOrExact(paths.participant, derived.participantBytes);
  await verifyEvidenceBytes(repoRoot, derived.participant.evidenceRefs);
  return derived;
}

export async function finalizeHumanStudySession({
  repoRoot = process.cwd(),
  participantId,
  completed,
  assisted,
  canExplainOutcome,
  locatedFinalArtifact,
  locatedUnresolvedIssues,
  singleEaseQuestion,
  clock,
} = {}) {
  assertParticipantId(participantId);
  const result = {
    completed: exactBoolean(completed, "completed"),
    assisted: exactBoolean(assisted, "assisted"),
    canExplainOutcome: exactBoolean(canExplainOutcome, "canExplainOutcome"),
    locatedFinalArtifact: exactBoolean(locatedFinalArtifact, "locatedFinalArtifact"),
    locatedUnresolvedIssues: exactBoolean(locatedUnresolvedIssues, "locatedUnresolvedIssues"),
    singleEaseQuestion: exactInteger(singleEaseQuestion, "singleEaseQuestion", 1, 7),
  };
  const resolvedClock = normalizeClock(clock);
  const roots = await resolveRepo(repoRoot);
  const paths = sessionPaths(roots.evidenceRoot, participantId);
  return withLock(paths, async () => {
    const meta = await readMeta(paths);
    let events = await readEvents(paths, participantId);
    const finalEvent = events.at(-1);
    let alreadyFinalized = false;
    if (finalEvent?.type === "session.finalized") {
      alreadyFinalized = true;
      if (JSON.stringify(finalEvent.payload) !== JSON.stringify(result)) {
        throw new Error("session was already finalized with different answers; evidence is immutable");
      }
    } else {
      if (events.filter((event) => event.type.startsWith("first-meaningful-action.")).length !== 1) {
        throw new Error("record exactly one first-action result before finalization");
      }
      if (eventCount(events, "journey.ended") !== 1) throw new Error("record journey.ended before finalization");
      if (!events.some((event) => event.type === "evidence.imported" && event.payload.evidenceKind === "screenshot" && event.payload.label === "completion")) {
        throw new Error("import a PNG screenshot with label=completion before finalization");
      }
      await appendSealedEvent(paths, participantId, events, "session.finalized", result, resolvedClock);
      events = await readEvents(paths, participantId);
    }
    const derived = await materializeFinalizedSession(meta, events, roots.repoRoot, paths);
    return {
      participantId,
      alreadyFinalized,
      status: "finalized",
      participantPath: portablePath(roots.repoRoot, paths.participant),
      sessionLogPath: portablePath(roots.repoRoot, paths.sessionLog),
      sessionLogSha256: sha256(derived.sessionLogBytes),
      firstMeaningfulActionMs: derived.participant.firstMeaningfulActionMs,
      neutralJourneyMs: derived.participant.neutralJourneyMs,
    };
  });
}

async function readFinalizedParticipant(repoRoot, evidenceRoot, participantId) {
  const paths = sessionPaths(evidenceRoot, participantId);
  const meta = await readMeta(paths);
  const events = await readEvents(paths, participantId);
  if (events.at(-1)?.type !== "session.finalized") throw new Error(`${participantId} is not finalized`);
  const derived = deriveFinalizedArtifacts(meta, events, repoRoot, paths);
  const storedSessionLog = await readFile(paths.sessionLog);
  const storedParticipant = await readFile(paths.participant);
  if (!storedSessionLog.equals(derived.sessionLogBytes)) throw new Error(`${participantId}: session-log.json does not match the append-only event log`);
  if (!storedParticipant.equals(derived.participantBytes)) throw new Error(`${participantId}: participant.json does not match the append-only event log`);
  await verifyEvidenceBytes(repoRoot, derived.participant.evidenceRefs);
  return { meta, participant: derived.participant };
}

export async function getHumanStudySession({ repoRoot = process.cwd(), participantId } = {}) {
  assertParticipantId(participantId);
  const roots = await resolveRepo(repoRoot);
  const paths = sessionPaths(roots.evidenceRoot, participantId);
  const meta = await readMeta(paths);
  const events = await readEvents(paths, participantId);
  const finalized = events.at(-1)?.type === "session.finalized";
  return {
    participantId,
    nodekitCommit: meta.nodekitCommit,
    nodekitSourceHash: meta.nodekitSourceHash,
    status: finalized ? "finalized" : "active",
    eventCount: events.length,
    lastEvent: events.at(-1).type,
    sessionStartedAt: events[0].occurredAt,
    evidenceCount: eventCount(events, "evidence.imported"),
    firstActionRecorded: events.some((event) => event.type.startsWith("first-meaningful-action.")),
    journeyEnded: events.some((event) => event.type === "journey.ended"),
  };
}

export async function assembleFreshUserStudy({
  repoRoot = process.cwd(),
  nodekitCommit,
  nodekitSourceHash,
  output = "proof/ease/fresh-users.json",
} = {}) {
  assertIdentity(nodekitCommit, nodekitSourceHash);
  const roots = await resolveRepo(repoRoot);
  const directoryEntries = await readdir(roots.evidenceRoot, { withFileTypes: true });
  const matching = [];
  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !PARTICIPANT_ID.test(entry.name)) continue;
    const paths = sessionPaths(roots.evidenceRoot, entry.name);
    const meta = await readMeta(paths);
    if (meta.nodekitCommit === nodekitCommit && meta.nodekitSourceHash === nodekitSourceHash) matching.push(entry.name);
  }
  if (matching.length !== 5) {
    throw new Error(`exactly five attempts must exist for ${nodekitCommit}/${nodekitSourceHash}; found ${matching.length}. No attempt may be cherry-picked or fabricated.`);
  }
  const finalized = [];
  for (const participantId of matching) finalized.push(await readFinalizedParticipant(roots.repoRoot, roots.evidenceRoot, participantId));
  const participants = finalized.map((entry) => entry.participant).sort((left, right) => left.participantId.localeCompare(right.participantId));
  const allEvidence = participants.flatMap((participant) => participant.evidenceRefs);
  const paths = new Set(allEvidence.map((entry) => entry.path));
  const hashes = new Set(allEvidence.map((entry) => entry.sha256));
  if (paths.size !== allEvidence.length) throw new Error("human-study evidence paths must be unique across all five participants");
  if (hashes.size !== allEvidence.length) throw new Error("human-study evidence bytes must be unique across all five participants");
  const study = {
    schemaVersion: "nodekit.fresh-user-study/v1",
    nodekitCommit,
    nodekitSourceHash,
    instruction: HUMAN_STUDY_INSTRUCTION,
    evidenceRequirements: {
      pathFormat: "repository-relative POSIX path",
      requiredKindsPerParticipant: ["screenshot", "session-log"],
      optionalKinds: ["recording"],
      hashAlgorithm: "sha256",
    },
    participants,
    thresholds: { ...HUMAN_STUDY_THRESHOLDS },
    status: "completed",
  };
  const outputAbsolute = path.resolve(roots.repoRoot, output);
  if (path.relative(roots.repoRoot, outputAbsolute).startsWith("..")) throw new Error("study output must remain inside the repository");
  await mkdir(path.dirname(outputAbsolute), { recursive: true });
  await exclusiveWrite(outputAbsolute, prettyBytes(study));
  return {
    schemaVersion: study.schemaVersion,
    nodekitCommit,
    nodekitSourceHash,
    participantCount: participants.length,
    output: portablePath(roots.repoRoot, outputAbsolute),
    sha256: sha256(prettyBytes(study)),
    status: "ready-for-independent-evaluation",
  };
}
