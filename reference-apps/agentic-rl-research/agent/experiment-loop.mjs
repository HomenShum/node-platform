import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateProposal,
  findTask,
  referenceProposal,
  taskSetSummary,
  unsafeFixtureProposal,
} from "./tools/evaluate-founder-quest.mjs";

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

function refreshDigest(session) {
  session.digest = digest({ ...session, digest: undefined });
  return session;
}

export async function startSession(store, options = {}) {
  const existing = await store.load();
  if (existing && !options.force) {
    if (existing.status === "evaluating") {
      existing.status = "ready";
      existing.events.push(event("session.recovered", { previousStatus: "evaluating" }));
      refreshDigest(existing);
      await store.save(existing);
    }
    return existing;
  }
  const session = {
    best: { reward: 0, runId: null },
    configHash: await readConfigHash(options.repoRoot),
    events: [event("session.started", { mode: "synthetic-replay-only" })],
    intervention: null,
    interventionVersion: 0,
    objective: "maximize protected task correctness while refusing external execution",
    runs: [],
    schemaVersion: "nodekit.founderquest-rl-session/v1",
    sessionId: randomUUID(),
    status: "ready",
    taskSets: await taskSetSummary(options),
  };
  return store.save(refreshDigest(session));
}

export async function intervene(store, instruction) {
  const session = await store.load();
  if (!session) throw new Error("start a session first");
  const text = String(instruction ?? "").trim();
  if (!text) throw new Error("intervention cannot be empty");
  session.interventionVersion += 1;
  session.intervention = { at: new Date().toISOString(), instruction: text, version: session.interventionVersion };
  session.events.push(event("human.intervened", session.intervention));
  return store.save(refreshDigest(session));
}

export async function runExperiment(store, proposal, options = {}) {
  const session = await store.load();
  if (!session) throw new Error("start a session first");
  if (!proposal?.taskId) throw new Error("proposal.taskId is required");
  const { split, task } = await findTask(proposal.taskId, options);
  const startedAt = new Date().toISOString();
  session.status = "evaluating";
  session.events.push(event("run.started", { policy: proposal.policy ?? "unknown", taskId: task.id }));
  await store.save(session);

  const result = evaluateProposal(task, proposal);
  const run = {
    completedAt: new Date().toISOString(),
    decision: result.passed ? "keep" : "revert",
    hypothesis: String(proposal.hypothesis ?? "bounded FounderQuest proposal"),
    id: randomUUID(),
    intervention: session.intervention,
    policy: proposal.policy ?? null,
    result,
    split,
    startedAt,
    taskId: task.id,
  };
  session.runs.push(run);
  if (result.passed && result.reward > session.best.reward) session.best = { reward: result.reward, runId: run.id };
  session.events.push(event(`run.${run.decision}`, {
    reward: result.reward,
    runId: run.id,
    taskId: task.id,
    violation: result.violation,
  }));
  session.status = "ready";
  return { run, session: await store.save(refreshDigest(session)) };
}

export async function deterministicProposal(index = 0, options = {}) {
  const taskIds = ["formation-ein", "banking-identity", "healthcare-intended-use"];
  const taskId = taskIds[index % taskIds.length];
  if (index === 0) return unsafeFixtureProposal(taskId, options);
  return referenceProposal(taskId, options);
}

export async function createReceipt(session) {
  const receipt = {
    best: session.best,
    configHash: session.configHash,
    events: session.events,
    generatedAt: new Date().toISOString(),
    interventionVersion: session.interventionVersion,
    replay: ["npm install", "npm run compile", "npm run demo", "npm run eval", "npm run benchmark"],
    runs: session.runs,
    schemaVersion: "nodekit.founderquest-rl-receipt/v1",
    sessionDigest: session.digest,
    sessionId: session.sessionId,
    taskSets: session.taskSets,
  };
  return { ...receipt, receiptDigest: digest(receipt) };
}
