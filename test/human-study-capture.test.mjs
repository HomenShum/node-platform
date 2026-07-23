import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  HUMAN_STUDY_CONSENT_VERSION,
  assembleFreshUserStudy,
  finalizeHumanStudySession,
  getHumanStudySession,
  importHumanStudyEvidence,
  recordHumanStudyEvent,
  startHumanStudySession,
} from "../src/lib/human-study-capture.mjs";
import { evaluateFreshUserStudy } from "../src/lib/ease-evidence.mjs";
import { createSchemaAjv } from "../src/lib/schema-validation.mjs";

const COMMIT = "a".repeat(40);
const SOURCE_HASH = "b".repeat(64);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function onePixelPng(index = 0) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixel = Buffer.from([0, index & 0xff, (index * 17) & 0xff, (index * 31) & 0xff, 255]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixel)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function controlledClock(startMs = Date.UTC(2026, 6, 22, 12, 0, 0)) {
  let elapsedNs = 0n;
  return {
    nowIso: () => new Date(startMs + Number(elapsedNs / 1_000_000n)).toISOString(),
    monotonicNs: () => elapsedNs,
    advance(ms) {
      elapsedNs += BigInt(ms) * 1_000_000n;
    },
  };
}

async function tempRepo(prefix = "nodekit-human-study-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, "proof", "ease"), { recursive: true });
  return root;
}

async function completeParticipant(root, index, overrides = {}) {
  const clock = controlledClock(Date.UTC(2026, 6, 22, 12, index, 0));
  const started = await startHumanStudySession({
    repoRoot: root,
    nodekitCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    consent: true,
    consentVersion: HUMAN_STUDY_CONSENT_VERSION,
    recordingConsent: false,
    fresh: true,
    clock,
  });
  clock.advance(1_000 + index);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "first-meaningful-action.recorded", clock });
  if (overrides.wrongTurn) {
    clock.advance(100);
    await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "wrong-turn.recorded", clock });
  }
  clock.advance(89_000);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "journey.ended", clock });
  const screenshotPath = path.join(root, `completion-${index}.png`);
  await writeFile(screenshotPath, onePixelPng(index + 1));
  await importHumanStudyEvidence({ repoRoot: root, participantId: started.participantId, kind: "screenshot", label: "completion", sourceFile: screenshotPath, clock });
  clock.advance(1_000);
  await finalizeHumanStudySession({
    repoRoot: root,
    participantId: started.participantId,
    completed: overrides.completed ?? true,
    assisted: overrides.assisted ?? false,
    canExplainOutcome: overrides.canExplainOutcome ?? true,
    locatedFinalArtifact: overrides.locatedFinalArtifact ?? true,
    locatedUnresolvedIssues: overrides.locatedUnresolvedIssues ?? true,
    singleEaseQuestion: overrides.singleEaseQuestion ?? 7,
    clock,
  });
  return { ...started, clock };
}

async function schemaValidators() {
  const schemaNames = [
    "nodekit.human-study-event.v1.schema.json",
    "nodekit.human-study-session-meta.v1.schema.json",
    "nodekit.human-study-session-log.v1.schema.json",
    "nodekit.fresh-user-study.v1.schema.json",
  ];
  const schemas = await Promise.all(schemaNames.map(async (name) => JSON.parse(await readFile(path.resolve("schemas", name), "utf8"))));
  const ajv = createSchemaAjv({ strict: true });
  for (const schema of schemas) ajv.addSchema(schema);
  return Object.fromEntries(schemas.map((schema) => [schema.$id, ajv.getSchema(schema.$id)]));
}

test("human study session refuses absent consent or non-fresh participants", async () => {
  const root = await tempRepo();
  await assert.rejects(
    () => startHumanStudySession({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH, consent: false, recordingConsent: false, fresh: true }),
    /explicit participant consent/,
  );
  await assert.rejects(
    () => startHumanStudySession({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH, consent: true, recordingConsent: false, fresh: false }),
    /genuinely fresh participant/,
  );
});

test("append-only session records exact monotonic timing, evidence, resume, and immutable finalization", async () => {
  const root = await tempRepo();
  const clock = controlledClock();
  const started = await startHumanStudySession({
    repoRoot: root,
    nodekitCommit: COMMIT,
    nodekitSourceHash: SOURCE_HASH,
    consent: true,
    consentVersion: HUMAN_STUDY_CONSENT_VERSION,
    recordingConsent: false,
    fresh: true,
    clock,
  });
  assert.match(started.participantId, /^participant_[a-f0-9]{16}$/);
  assert.equal((await getHumanStudySession({ repoRoot: root, participantId: started.participantId })).status, "active");

  clock.advance(1_250);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "first-meaningful-action.recorded", clock });
  await assert.rejects(
    () => recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "first-meaningful-action.not-reached", clock }),
    /already been recorded/,
  );
  clock.advance(250);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "session.resumed", clock });
  clock.advance(250);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "help-request.recorded", clock });
  clock.advance(88_250);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "journey.ended", clock });

  const screenshot = path.join(root, "observed-completion.png");
  await writeFile(screenshot, onePixelPng(9));
  const imported = await importHumanStudyEvidence({ repoRoot: root, participantId: started.participantId, kind: "screenshot", label: "completion", sourceFile: screenshot, clock });
  assert.equal(imported.alreadyImported, false);
  assert.equal((await importHumanStudyEvidence({ repoRoot: root, participantId: started.participantId, kind: "screenshot", label: "completion", sourceFile: screenshot, clock })).alreadyImported, true);

  clock.advance(1_000);
  const finalized = await finalizeHumanStudySession({
    repoRoot: root,
    participantId: started.participantId,
    completed: true,
    assisted: true,
    canExplainOutcome: true,
    locatedFinalArtifact: true,
    locatedUnresolvedIssues: true,
    singleEaseQuestion: 6,
    clock,
  });
  assert.equal(finalized.firstMeaningfulActionMs, 1_250);
  assert.equal(finalized.neutralJourneyMs, 90_000);
  assert.equal(finalized.alreadyFinalized, false);
  const again = await finalizeHumanStudySession({
    repoRoot: root,
    participantId: started.participantId,
    completed: true,
    assisted: true,
    canExplainOutcome: true,
    locatedFinalArtifact: true,
    locatedUnresolvedIssues: true,
    singleEaseQuestion: 6,
    clock,
  });
  assert.equal(again.alreadyFinalized, true);
  await assert.rejects(
    () => finalizeHumanStudySession({ repoRoot: root, participantId: started.participantId, completed: false, assisted: true, canExplainOutcome: true, locatedFinalArtifact: true, locatedUnresolvedIssues: true, singleEaseQuestion: 6, clock }),
    /different answers/,
  );
  await assert.rejects(
    () => recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "wrong-turn.recorded", clock }),
    /finalized/,
  );

  const directory = path.join(root, "proof", "ease", "humans", started.participantId);
  const meta = JSON.parse(await readFile(path.join(directory, "session-meta.json"), "utf8"));
  const sessionLog = JSON.parse(await readFile(path.join(directory, "session-log.json"), "utf8"));
  const { ["https://nodekit.dev/schemas/nodekit.human-study-session-meta.v1.schema.json"]: validateMeta,
    ["https://nodekit.dev/schemas/nodekit.human-study-session-log.v1.schema.json"]: validateSession,
    ["https://nodekit.dev/schemas/nodekit.human-study-event.v1.schema.json"]: validateEvent } = await schemaValidators();
  assert.equal(validateMeta(meta), true, JSON.stringify(validateMeta.errors));
  assert.equal(validateSession(sessionLog), true, JSON.stringify(validateSession.errors));
  assert.equal(sessionLog.events.every((event) => validateEvent(event)), true, JSON.stringify(validateEvent.errors));
  assert.equal(meta.participantName, undefined);
  assert.equal(sessionLog.helpRequests, 1);
});

test("evidence import rejects fake PNG bytes and finalization refuses missing completion evidence", async () => {
  const root = await tempRepo();
  const clock = controlledClock();
  const started = await startHumanStudySession({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH, consent: true, recordingConsent: false, fresh: true, clock });
  clock.advance(1_000);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "first-meaningful-action.not-reached", clock });
  clock.advance(10_000);
  await recordHumanStudyEvent({ repoRoot: root, participantId: started.participantId, type: "journey.ended", clock });
  const fake = path.join(root, "fake.png");
  await writeFile(fake, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not-a-screenshot")]));
  await assert.rejects(
    () => importHumanStudyEvidence({ repoRoot: root, participantId: started.participantId, kind: "screenshot", label: "completion", sourceFile: fake, clock }),
    /valid PNG/,
  );
  const recording = path.join(root, "session.webm");
  await writeFile(recording, "real bytes would come from the consented screen recorder");
  await assert.rejects(
    () => importHumanStudyEvidence({ repoRoot: root, participantId: started.participantId, kind: "recording", label: "full-session", sourceFile: recording, clock }),
    /did not explicitly consent to session recording/,
  );
  await assert.rejects(
    () => finalizeHumanStudySession({ repoRoot: root, participantId: started.participantId, completed: false, assisted: false, canExplainOutcome: false, locatedFinalArtifact: false, locatedUnresolvedIssues: false, singleEaseQuestion: 1, clock }),
    /completion/,
  );
});

test("assembler includes every exact-candidate attempt, validates evidence bytes, and emits evaluator-compatible input", async () => {
  const root = await tempRepo();
  for (let index = 0; index < 5; index += 1) await completeParticipant(root, index);
  const assembled = await assembleFreshUserStudy({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH });
  assert.equal(assembled.participantCount, 5);
  const study = JSON.parse(await readFile(path.join(root, "proof", "ease", "fresh-users.json"), "utf8"));
  const validators = await schemaValidators();
  const validateStudy = validators["https://nodekit.dev/schemas/nodekit.fresh-user-study.v1.schema.json"];
  assert.equal(validateStudy(study), true, JSON.stringify(validateStudy.errors));
  const verdict = evaluateFreshUserStudy(study, { evidenceFilesVerified: true, evidenceFileErrors: [] });
  assert.equal(verdict.passed, true, verdict.errors.join("\n"));

  await assert.rejects(
    () => assembleFreshUserStudy({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH }),
    /EEXIST|already exists/,
  );

  const evaluator = path.resolve("scripts", "evaluate-ease-evidence.mjs");
  const evaluated = spawnSync(process.execPath, [evaluator, "humans", "proof/ease/fresh-users.json", "proof/ease/fresh-users-verdict.json"], { cwd: root, encoding: "utf8" });
  assert.equal(evaluated.status, 0, `${evaluated.stdout}\n${evaluated.stderr}`);

  const screenshot = study.participants[0].evidenceRefs.find((entry) => entry.kind === "screenshot");
  await link(path.join(root, screenshot.path), path.join(root, "aliased-screenshot.png"));
  await assert.rejects(
    () => assembleFreshUserStudy({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH, output: "proof/ease/fresh-users-second.json" }),
    /unalias.*regular file|unaliased regular file/,
  );
  const aliasedEvaluation = spawnSync(process.execPath, [evaluator, "humans", "proof/ease/fresh-users.json", "proof/ease/hardlink-verdict.json"], { cwd: root, encoding: "utf8" });
  assert.equal(aliasedEvaluation.status, 1);
  assert.match(aliasedEvaluation.stdout, /unaliased regular file/);

});

test("assembler refuses fewer than five attempts and detects tampered byte-addressed evidence", async () => {
  const root = await tempRepo();
  const sessions = [];
  for (let index = 0; index < 4; index += 1) sessions.push(await completeParticipant(root, index));
  await assert.rejects(
    () => assembleFreshUserStudy({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH }),
    /exactly five attempts.*found 4/,
  );
  sessions.push(await completeParticipant(root, 4));
  const participant = JSON.parse(await readFile(path.join(root, "proof", "ease", "humans", sessions[0].participantId, "participant.json"), "utf8"));
  const screenshot = participant.evidenceRefs.find((entry) => entry.kind === "screenshot");
  await writeFile(path.join(root, screenshot.path), onePixelPng(99));
  await assert.rejects(
    () => assembleFreshUserStudy({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH }),
    /evidence hash mismatch/,
  );
});

test("operator CLI requires explicit consent and rejects PII-shaped options", async () => {
  const root = await tempRepo();
  const cli = path.resolve("scripts", "capture-human-study.mjs");
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /never invents a participant/);
  assert.match(help.stdout, /STEP 1 - Start only after real, explicit consent/);
  assert.match(help.stdout, /Five real sessions are still required/);
  const missingConsent = spawnSync(process.execPath, [cli, "start", "--repo-root", root, "--nodekit-commit", COMMIT, "--nodekit-source-hash", SOURCE_HASH, "--fresh", "yes", "--recording-consent", "no", "--consent-version", HUMAN_STUDY_CONSENT_VERSION], { encoding: "utf8" });
  assert.equal(missingConsent.status, 1);
  assert.match(missingConsent.stderr, /--consent is required/);
  const pii = spawnSync(process.execPath, [cli, "start", "--repo-root", root, "--nodekit-commit", COMMIT, "--nodekit-source-hash", SOURCE_HASH, "--fresh", "yes", "--consent", "yes", "--recording-consent", "no", "--consent-version", HUMAN_STUDY_CONSENT_VERSION, "--participant-name", "Alice"], { encoding: "utf8" });
  assert.equal(pii.status, 1);
  assert.match(pii.stderr, /PII must not be recorded/);
});

test("manually added PII or event fields make the session non-certifiable", async () => {
  const root = await tempRepo();
  const clock = controlledClock();
  const started = await startHumanStudySession({ repoRoot: root, nodekitCommit: COMMIT, nodekitSourceHash: SOURCE_HASH, consent: true, recordingConsent: false, fresh: true, clock });
  const directory = path.join(root, "proof", "ease", "humans", started.participantId);
  const metaPath = path.join(directory, "session-meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.participantName = "must-not-be-stored";
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  await assert.rejects(
    () => getHumanStudySession({ repoRoot: root, participantId: started.participantId }),
    /metadata fields changed/,
  );
});
