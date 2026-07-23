#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HUMAN_STUDY_CONSENT_VERSION,
  HUMAN_STUDY_INSTRUCTION,
  assembleFreshUserStudy,
  finalizeHumanStudySession,
  getHumanStudySession,
  importHumanStudyEvidence,
  recordHumanStudyEvent,
  startHumanStudySession,
} from "../src/lib/human-study-capture.mjs";

function parseArgs(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals >= 0) {
      const key = token.slice(2, equals);
      const value = token.slice(equals + 1);
      if (!key || !value) throw new Error(`invalid option: ${token}`);
      options.set(key, value);
      continue;
    }
    const key = token.slice(2);
    if (key === "help") {
      options.set(key, "yes");
      continue;
    }
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    options.set(key, value);
    index += 1;
  }
  return { positionals, options };
}

function assertOnlyOptions(options, allowed) {
  for (const key of options.keys()) {
    if (!allowed.has(key)) throw new Error(`--${key} is not accepted for this command; participant names, emails, and other PII must not be recorded`);
  }
}

function required(options, key) {
  const value = options.get(key);
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${key} is required`);
  return value;
}

function strictBoolean(options, key) {
  const value = required(options, key);
  if (value === "yes") return true;
  if (value === "no") return false;
  throw new Error(`--${key} must be yes or no`);
}

function exactInteger(options, key, minimum, maximum) {
  const value = required(options, key);
  if (!/^\d+$/.test(value)) throw new Error(`--${key} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`--${key} must be from ${minimum} to ${maximum}`);
  return number;
}

async function candidateIdentity(options, repoRoot) {
  const candidateManifest = options.get("candidate-manifest");
  const explicitCommit = options.get("nodekit-commit");
  const explicitSourceHash = options.get("nodekit-source-hash");
  if (candidateManifest && (explicitCommit || explicitSourceHash)) {
    throw new Error("use either --candidate-manifest or both explicit identity flags, not both");
  }
  if (candidateManifest) {
    const manifestPath = path.resolve(repoRoot, candidateManifest);
    const relative = path.relative(repoRoot, manifestPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--candidate-manifest must remain inside --repo-root");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return {
      nodekitCommit: manifest.nodekitCommit,
      nodekitSourceHash: manifest.nodekitSourceHash,
      candidateManifest: path.relative(repoRoot, manifestPath).replaceAll("\\", "/"),
    };
  }
  return {
    nodekitCommit: required(options, "nodekit-commit"),
    nodekitSourceHash: required(options, "nodekit-source-hash"),
    candidateManifest: null,
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `NodeKit fresh-human study operator
Usage: nodekit-human-study <start|mark|resume|evidence|finalize|status|assemble> [options]

Purpose: record one real person's observed session. This command never invents a participant,
result, timer, screenshot, or consent. Read docs/FRESH_HUMAN_USABILITY_STUDY.md first.

Safety:
  - Freeze one candidate before recruiting anyone.
  - Do not enter a name, email, demographic detail, or free-form note.
  - Ask for study consent and recording consent separately.
  - Record each milestone when it happens; never reconstruct times afterward.
  - first-action and first-action-not-reached are mutually exclusive.
  - Five real sessions are still required; this tool does not close that external gate.

STEP 1 - Start only after real, explicit consent (copy the returned anonymous ID):
  npm run ease:human-study -- start --candidate-manifest proof/ease/latest/manifest.json --consent yes --recording-consent no --fresh yes --consent-version ${HUMAN_STUDY_CONSENT_VERSION}

STEP 2 - Record observed milestones as they occur:
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event first-action
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event first-action-not-reached
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event wrong-turn
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event help-request
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event p0-p1-failure
  npm run ease:human-study -- mark --participant-id <anonymous-id> --event journey-ended
  npm run ease:human-study -- resume --participant-id <anonymous-id>

STEP 3 - Import exact evidence bytes (the completion PNG is mandatory):
  npm run ease:human-study -- evidence --participant-id <anonymous-id> --kind screenshot --label completion --file C:\\path\\completion.png
  npm run ease:human-study -- evidence --participant-id <anonymous-id> --kind recording --label full-session --file C:\\path\\session.webm

STEP 4 - After asking the 1-7 Single Ease Question, finalize exact observed outcomes:
  npm run ease:human-study -- finalize --participant-id <anonymous-id> --completed yes --assisted no --can-explain-outcome yes --located-final-artifact yes --located-unresolved-issues yes --seq 7

STEP 5 - Inspect one session, then assemble only after all five are finalized:
  npm run ease:human-study -- status --participant-id <anonymous-id>
  npm run ease:human-study -- assemble --candidate-manifest proof/ease/latest/manifest.json --output proof/ease/fresh-users.json

Every participant receives only this instruction:
  ${HUMAN_STUDY_INSTRUCTION}
`;
}

const EVENT_ALIASES = Object.freeze({
  "first-action": "first-meaningful-action.recorded",
  "first-action-not-reached": "first-meaningful-action.not-reached",
  "journey-ended": "journey.ended",
  "wrong-turn": "wrong-turn.recorded",
  "help-request": "help-request.recorded",
  "p0-p1-failure": "p0-p1-failure.recorded",
});

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command || command === "help" || options.has("help")) {
    process.stdout.write(usage());
    return;
  }
  if (positionals.length !== 1) throw new Error("provide exactly one command; see `ease:human-study -- help`");
  const repoRoot = path.resolve(options.get("repo-root") ?? process.cwd());
  if (command === "start") {
    assertOnlyOptions(options, new Set(["repo-root", "candidate-manifest", "nodekit-commit", "nodekit-source-hash", "consent", "consent-version", "recording-consent", "fresh"]));
    const identity = await candidateIdentity(options, repoRoot);
    const result = await startHumanStudySession({
      repoRoot,
      ...identity,
      consent: strictBoolean(options, "consent"),
      consentVersion: required(options, "consent-version"),
      recordingConsent: strictBoolean(options, "recording-consent"),
      fresh: strictBoolean(options, "fresh"),
    });
    print({ ...result, candidateManifest: identity.candidateManifest, next: `Show only: ${HUMAN_STUDY_INSTRUCTION}` });
    return;
  }
  if (command === "mark") {
    assertOnlyOptions(options, new Set(["repo-root", "participant-id", "event"]));
    const event = required(options, "event");
    const type = EVENT_ALIASES[event];
    if (!type) throw new Error(`unsupported --event ${event}`);
    print(await recordHumanStudyEvent({ repoRoot, participantId: required(options, "participant-id"), type }));
    return;
  }
  if (command === "resume") {
    assertOnlyOptions(options, new Set(["repo-root", "participant-id"]));
    print(await recordHumanStudyEvent({ repoRoot, participantId: required(options, "participant-id"), type: "session.resumed" }));
    return;
  }
  if (command === "evidence") {
    assertOnlyOptions(options, new Set(["repo-root", "participant-id", "kind", "label", "file"]));
    print(await importHumanStudyEvidence({
      repoRoot,
      participantId: required(options, "participant-id"),
      kind: required(options, "kind"),
      label: required(options, "label"),
      sourceFile: required(options, "file"),
    }));
    return;
  }
  if (command === "finalize") {
    assertOnlyOptions(options, new Set([
      "repo-root", "participant-id", "completed", "assisted", "can-explain-outcome",
      "located-final-artifact", "located-unresolved-issues", "seq",
    ]));
    print(await finalizeHumanStudySession({
      repoRoot,
      participantId: required(options, "participant-id"),
      completed: strictBoolean(options, "completed"),
      assisted: strictBoolean(options, "assisted"),
      canExplainOutcome: strictBoolean(options, "can-explain-outcome"),
      locatedFinalArtifact: strictBoolean(options, "located-final-artifact"),
      locatedUnresolvedIssues: strictBoolean(options, "located-unresolved-issues"),
      singleEaseQuestion: exactInteger(options, "seq", 1, 7),
    }));
    return;
  }
  if (command === "status") {
    assertOnlyOptions(options, new Set(["repo-root", "participant-id"]));
    print(await getHumanStudySession({ repoRoot, participantId: required(options, "participant-id") }));
    return;
  }
  if (command === "assemble") {
    assertOnlyOptions(options, new Set(["repo-root", "candidate-manifest", "nodekit-commit", "nodekit-source-hash", "output"]));
    const identity = await candidateIdentity(options, repoRoot);
    print(await assembleFreshUserStudy({
      repoRoot,
      ...identity,
      output: options.get("output") ?? "proof/ease/fresh-users.json",
    }));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`HUMAN_STUDY_CAPTURE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
