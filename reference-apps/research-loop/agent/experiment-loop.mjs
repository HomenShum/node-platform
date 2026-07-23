import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { measureNgram } from "./tools/measure-ngram.mjs";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function event(type, details = {}) {
  return { at: new Date().toISOString(), details, id: randomUUID(), type };
}

export async function readConfigHash(repoRoot = process.cwd()) {
  try {
    return (await readFile(path.join(repoRoot, ".nodeagent", "config-hash.txt"), "utf8")).trim();
  } catch {
    return "uncompiled";
  }
}

export async function startSession(store, options = {}) {
  const existing = await store.load();
  if (existing && !options.force) {
    if (existing.status === "measuring") {
      existing.status = "ready";
      existing.events.push(event("session.recovered", { previousStatus: "measuring" }));
      existing.digest = digest({ ...existing, digest: undefined });
      await store.save(existing);
    }
    return existing;
  }
  const config = options.baseline ?? { alpha: 0.5, order: 1 };
  const measured = await measureNgram(config, options.fixtureRoot);
  const session = {
    baseline: measured,
    best: measured,
    configHash: await readConfigHash(options.repoRoot),
    events: [event("session.started", { baseline: measured })],
    experiments: [],
    intervention: null,
    interventionVersion: 0,
    objective: "minimize held-out character bits per character",
    schemaVersion: "nodekit.experiment-session/v1",
    sessionId: randomUUID(),
    status: "ready",
  };
  session.digest = digest(session);
  return store.save(session);
}

export async function intervene(store, instruction) {
  const session = await store.load();
  if (!session) throw new Error("start a session first");
  const text = String(instruction ?? "").trim();
  if (!text) throw new Error("intervention cannot be empty");
  session.interventionVersion += 1;
  session.intervention = { at: new Date().toISOString(), instruction: text, version: session.interventionVersion };
  session.events.push(event("human.intervened", session.intervention));
  session.digest = digest({ ...session, digest: undefined });
  return store.save(session);
}

export async function runExperiment(store, proposal, options = {}) {
  const session = await store.load();
  if (!session) throw new Error("start a session first");
  const startedAt = new Date().toISOString();
  const candidate = {
    alpha: Math.max(0.001, Math.min(10, Number(proposal.config?.alpha))),
    order: Math.max(1, Math.min(6, Math.round(Number(proposal.config?.order)))),
  };
  if (!Number.isFinite(candidate.alpha) || !Number.isFinite(candidate.order)) throw new Error("proposal contains invalid values");
  session.status = "measuring";
  session.events.push(event("experiment.started", { candidate, hypothesis: proposal.hypothesis }));
  await store.save(session);

  const result = await measureNgram(candidate, options.fixtureRoot);
  const improved = result.heldoutBitsPerCharacter < session.best.heldoutBitsPerCharacter;
  const experiment = {
    candidate,
    completedAt: new Date().toISOString(),
    decision: improved ? "keep" : "revert",
    delta: Number((result.heldoutBitsPerCharacter - session.best.heldoutBitsPerCharacter).toFixed(6)),
    hypothesis: String(proposal.hypothesis ?? "bounded configuration experiment"),
    id: randomUUID(),
    intervention: session.intervention,
    model: proposal.model ?? null,
    result,
    startedAt,
    usage: proposal.usage ?? null,
  };
  session.experiments.push(experiment);
  if (improved) session.best = result;
  session.events.push(event(`experiment.${experiment.decision}`, { delta: experiment.delta, experimentId: experiment.id }));
  session.status = "ready";
  session.digest = digest({ ...session, digest: undefined });
  await store.save(session);
  return { experiment, session };
}

export function deterministicProposal(index = 0) {
  const proposals = [
    { config: { alpha: 10, order: 1 }, hypothesis: "Heavy smoothing should test the revert path." },
    { config: { alpha: 0.12, order: 3 }, hypothesis: "A short character context should lower held-out uncertainty." },
    { config: { alpha: 0.08, order: 4 }, hypothesis: "One more context character may capture recurring local structure." },
  ];
  return { ...proposals[index % proposals.length], model: { mode: "replay", provider: "deterministic" } };
}

export async function createReceipt(session) {
  const receipt = {
    baseline: session.baseline,
    best: session.best,
    configHash: session.configHash,
    events: session.events,
    experiments: session.experiments,
    generatedAt: new Date().toISOString(),
    interventionVersion: session.interventionVersion,
    replay: ["npm install", "npm run compile", "npm run demo", "npm run eval"],
    schemaVersion: "nodekit.experiment-receipt/v1",
    sessionDigest: session.digest,
    sessionId: session.sessionId,
  };
  receipt.receiptDigest = digest(receipt);
  return receipt;
}
