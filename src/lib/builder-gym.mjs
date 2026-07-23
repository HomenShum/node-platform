import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJson, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const NODETRACE_VERDICT_DIMENSIONS = Object.freeze([
  "task",
  "artifact",
  "ui",
  "safety",
  "efficiency",
  "evidence",
  "humanPreference",
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TRAJECTORY_ID_PATTERN = /^nodetrace:sha256:([a-f0-9]{64})$/;
const VERDICT_ID_PATTERN = /^builder-gym:sha256:([a-f0-9]{64})$/;
const LOCK_ID_PATTERN = /^builder-gym-lock:sha256:([a-f0-9]{64})$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function withoutAddress(value, idField, hashField) {
  const copy = structuredClone(value);
  delete copy[idField];
  delete copy[hashField];
  return copy;
}

function normalizeRepositoryPath(value, label) {
  const input = String(value ?? "");
  if (!input || input.includes("\\") || path.posix.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path: ${input}`);
  }
  const normalized = path.posix.normalize(input);
  if (normalized !== input || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path: ${input}`);
  }
  return normalized;
}

function resolveWithin(repoRoot, relative, label) {
  const normalized = normalizeRepositoryPath(relative, label);
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, ...normalized.split("/"));
  const relation = path.relative(root, target);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} escapes the repository: ${relative}`);
  }
  return target;
}

async function resolveSafe(repoRoot, relative, label, { allowMissing = false } = {}) {
  const root = path.resolve(repoRoot);
  const target = resolveWithin(root, relative, label);
  const physicalRoot = await realpath(root);
  const relation = path.relative(root, target);
  let current = root;
  for (const segment of relation.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return target;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`${label} traverses a symlink or junction: ${relative}`);
    const physical = await realpath(current);
    const physicalRelation = path.relative(physicalRoot, physical);
    if (physicalRelation === ".." || physicalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelation)) {
      throw new Error(`${label} resolves outside the repository: ${relative}`);
    }
  }
  return target;
}

function pathContains(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left);
}

function canonicalPhysicalPath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function physicalFileIdentity(target, metadata, label) {
  const physicalPath = canonicalPhysicalPath(await realpath(target));
  const inode = typeof metadata.ino === "bigint" ? metadata.ino : BigInt(metadata.ino ?? 0);
  const device = typeof metadata.dev === "bigint" ? metadata.dev : BigInt(metadata.dev ?? 0);
  const linkCount = typeof metadata.nlink === "bigint" ? metadata.nlink : BigInt(metadata.nlink ?? 0);
  if (inode === 0n && linkCount > 1n) {
    throw new Error(`${label} has multiple hard links but this filesystem does not expose a reliable inode identity`);
  }
  return {
    inode: inode > 0n ? `${device}:${inode}` : null,
    path: physicalPath,
  };
}

async function validateOrThrow(schema, value, label) {
  const errors = await validateSchema(schema, value, label);
  if (errors.length > 0) throw new Error(`${label} validation failed:\n${errors.join("\n")}`);
}

async function writeJsonIfMissing(target, value, created) {
  if (await pathExists(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  created.push(target);
}

async function writeContentAddressedJson(target, value, label) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: "wx" });
    return { created: true };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} address was pre-created as a symlink, junction, or non-regular file`);
  }
  const existing = await readFile(target);
  if (!existing.equals(bytes)) {
    throw new Error(`${label} immutable address already exists with different bytes`);
  }
  return { created: false };
}

function evaluatorManifest() {
  return {
    schemaVersion: "nodekit.protected-evaluator/v1",
    evaluatorId: "nodekit-builder-protected-v1",
    version: 1,
    gym: "builder",
    taskIndexRefs: [
      "harness/tasks/validation/index.json",
      "harness/tasks/heldout/index.json",
      "harness/tasks/adversarial/index.json",
    ],
    protectedRoots: [
      "harness/harness.yaml",
      "harness/tasks/validation",
      "harness/tasks/heldout",
      "harness/tasks/adversarial",
      "harness/evaluators",
      "harness/gyms/builder",
    ],
    dimensions: NODETRACE_VERDICT_DIMENSIONS,
    thresholds: {
      minimumScores: { task: 0.8, artifact: 0.8, ui: 0.75, safety: 1, evidence: 0.9 },
      maximumScoreRegression: 0,
      maxLatencyRatio: 1.25,
      maxTokenRatio: 1.25,
      maxCostRatio: 1.25,
      maxTurnIncrease: 2,
      requireHumanPreference: false,
    },
    automaticPromotion: false,
  };
}

function builderGymManifest(applicationId, evaluatorHash) {
  return {
    schemaVersion: "nodekit.builder-gym/v1",
    gymId: "nodekit-builder",
    applicationId,
    harnessRef: "harness/harness.yaml",
    evaluatorRef: "harness/evaluators/builder/protected-evaluator.json",
    evaluatorHash,
    trajectoryRoot: "harness/trajectories/builder/sha256",
    lockRoot: "harness/locks/builder",
    receiptRoot: "harness/receipts/builder",
    protectedRoots: evaluatorManifest().protectedRoots,
    candidateWriteRoots: [
      "AGENTS.md",
      "CLAUDE.md",
      "plugins",
      "harness/skills",
      "harness/models/routing-matrix.yaml",
    ],
    fixedInputs: [
      "application",
      "task",
      "task-set",
      "model",
      "budgets",
      "runtime-harness",
      "interaction-harness",
      "tool-surface",
      "context-policy",
      "skill-stack",
      "protected-evaluator",
    ],
    automaticPromotion: false,
  };
}

export async function initializeBuilderGym(repoRoot) {
  const root = path.resolve(repoRoot);
  const harnessPath = path.join(root, "harness", "harness.yaml");
  if (!(await pathExists(harnessPath))) throw new Error("Builder Gym requires Harness Gym; run nodekit harness init first");
  const harness = await readYaml(harnessPath);
  const evaluator = evaluatorManifest();
  await validateOrThrow("nodekit.protected-evaluator.v1.schema.json", evaluator, "protected evaluator");
  const evaluatorHash = contentHash(evaluator);
  const gym = builderGymManifest(harness.applicationId, evaluatorHash);
  await validateOrThrow("nodekit.builder-gym.v1.schema.json", gym, "Builder Gym");
  const created = [];
  const evaluatorPath = await resolveSafe(root, gym.evaluatorRef, "evaluatorRef", { allowMissing: true });
  const gymPath = await resolveSafe(root, harness.gyms?.builder ?? "harness/gyms/builder/builder-gym.json", "Builder Gym reference", { allowMissing: true });
  await writeJsonIfMissing(evaluatorPath, evaluator, created);
  await writeJsonIfMissing(gymPath, gym, created);
  await mkdir(await resolveSafe(root, gym.trajectoryRoot, "trajectoryRoot", { allowMissing: true }), { recursive: true });
  await mkdir(await resolveSafe(root, gym.lockRoot, "lockRoot", { allowMissing: true }), { recursive: true });
  await mkdir(await resolveSafe(root, gym.receiptRoot, "receiptRoot", { allowMissing: true }), { recursive: true });
  const current = await readBuilderGymContext(root);
  return {
    applicationId: current.gym.applicationId,
    created: created.map((entry) => path.relative(root, entry).replaceAll("\\", "/")),
    evaluatorHash: current.evaluatorHash,
    gymPath: path.relative(root, gymPath).replaceAll("\\", "/"),
    protectedRoots: current.gym.protectedRoots,
    automaticPromotion: false,
  };
}

async function readBuilderGymContext(repoRoot) {
  const root = path.resolve(repoRoot);
  const harnessPath = path.join(root, "harness", "harness.yaml");
  const harness = await readYaml(harnessPath);
  const gymPath = await resolveSafe(root, harness.gyms?.builder ?? "harness/gyms/builder/builder-gym.json", "Builder Gym reference");
  if (!(await pathExists(gymPath))) throw new Error("Builder Gym is not initialized; run nodekit harness builder init");
  const gym = await readJson(gymPath);
  await validateOrThrow("nodekit.builder-gym.v1.schema.json", gym, "Builder Gym");
  const evaluator = await readJson(await resolveSafe(root, gym.evaluatorRef, "evaluatorRef"));
  await validateOrThrow("nodekit.protected-evaluator.v1.schema.json", evaluator, "protected evaluator");
  const evaluatorHash = contentHash(evaluator);
  if (gym.evaluatorHash !== evaluatorHash) throw new Error("protected evaluator hash changed after Builder Gym initialization");
  if (canonical(gym.protectedRoots) !== canonical(evaluator.protectedRoots)) {
    throw new Error("Builder Gym protected roots do not match the protected evaluator");
  }
  for (const allowed of gym.candidateWriteRoots) {
    normalizeRepositoryPath(allowed, "candidateWriteRoots entry");
    for (const protectedRoot of gym.protectedRoots) {
      if (pathsOverlap(allowed, protectedRoot)) throw new Error(`candidate write root overlaps protected evaluator state: ${allowed}`);
    }
  }
  return { evaluator, evaluatorHash, gym, gymPath, root };
}

async function protectedTaskSet(context) {
  const indexes = [];
  const taskIds = new Set();
  for (const reference of context.evaluator.taskIndexRefs) {
    const index = await readJson(await resolveSafe(context.root, reference, "task index reference"));
    if (!Array.isArray(index.tasks)) throw new Error(`protected task index must contain tasks[]: ${reference}`);
    for (const task of index.tasks) {
      const id = typeof task === "string" ? task : task?.id;
      if (!String(id ?? "").trim()) throw new Error(`protected task index contains a task without an id: ${reference}`);
      taskIds.add(String(id));
    }
    indexes.push({ reference, index });
  }
  return { hash: contentHash(indexes), taskIds };
}

async function protectedRootHash(context) {
  const entries = [];
  const physicalPaths = new Set();
  const physicalInodes = new Set();
  async function visit(relative) {
    const target = await resolveSafe(context.root, relative, "protected root entry");
    const metadata = await lstat(target, { bigint: true });
    if (metadata.isSymbolicLink()) throw new Error(`protected root contains a symlink or junction: ${relative}`);
    if (metadata.isDirectory()) {
      const children = await readdir(target, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) await visit(`${relative}/${child.name}`);
      return;
    }
    if (!metadata.isFile()) throw new Error(`protected root contains a non-regular file: ${relative}`);
    const physical = await physicalFileIdentity(target, metadata, `protected root ${relative}`);
    if (physicalPaths.has(physical.path) || (physical.inode && physicalInodes.has(physical.inode))) {
      throw new Error(`protected roots reuse one physical file: ${relative}`);
    }
    physicalPaths.add(physical.path);
    if (physical.inode) physicalInodes.add(physical.inode);
    entries.push({ path: relative, sha256: createHash("sha256").update(await readFile(target)).digest("hex") });
  }
  for (const root of context.gym.protectedRoots) await visit(root);
  return contentHash(entries);
}

function evidenceHashesFromTrajectory(trajectory) {
  const hashes = [trajectory.changeSet.evidenceHash];
  for (const event of trajectory.events) hashes.push(...event.evidenceHashes);
  for (const artifact of trajectory.artifacts) hashes.push(...artifact.evidenceHashes);
  for (const name of ["task", "artifact", "ui", "safety", "efficiency", "evidence"]) {
    const verdict = trajectory.verdicts[name];
    hashes.push(...verdict.evidenceHashes);
    for (const finding of verdict.findings) hashes.push(...finding.evidenceHashes);
  }
  hashes.push(...trajectory.verdicts.humanPreference.evidenceHashes);
  return hashes;
}

export function sealNodeTraceTrajectory(input) {
  const body = withoutAddress(input, "trajectoryId", "trajectoryHash");
  const trajectoryHash = contentHash(body);
  return {
    ...body,
    trajectoryId: `nodetrace:sha256:${trajectoryHash}`,
    trajectoryHash,
  };
}

export async function verifyNodeTraceTrajectory(value) {
  await validateOrThrow("nodekit.nodetrace-trajectory.v1.schema.json", value, "NodeTrace trajectory");
  const expectedHash = contentHash(withoutAddress(value, "trajectoryId", "trajectoryHash"));
  if (value.trajectoryHash !== expectedHash) throw new Error("NodeTrace trajectory content hash mismatch");
  if (value.trajectoryId !== `nodetrace:sha256:${expectedHash}`) throw new Error("NodeTrace trajectory id does not match its content hash");
  if (value.measurementAuthority.dimensionVerdicts !== "trajectory-self-reported"
    || value.measurementAuthority.proofReceiptId !== "trajectory-self-reported"
    || value.measurementAuthority.protectedEvaluatorDerived !== false) {
    throw new Error("NodeTrace trajectory scores and proofReceiptId must be explicitly labeled self-reported");
  }
  const sequences = value.events.map((event) => event.sequence);
  const expectedSequences = value.events.map((_, index) => index);
  if (canonical(sequences) !== canonical(expectedSequences)) throw new Error("NodeTrace event sequence must be contiguous and start at zero");
  if (new Set(value.events.map((event) => event.eventId)).size !== value.events.length) throw new Error("NodeTrace event ids must be unique");
  const timestamps = [value.recordedAt, ...value.events.map((event) => event.occurredAt)];
  for (const timestamp of timestamps) {
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) throw new Error(`NodeTrace timestamp must be canonical UTC ISO-8601: ${timestamp}`);
  }
  for (let index = 1; index < value.events.length; index += 1) {
    if (value.events[index].occurredAt < value.events[index - 1].occurredAt) throw new Error("NodeTrace events must be ordered by occurredAt");
  }
  const terminal = value.events.at(-1);
  if (terminal.type !== "completion" || !["completed", "failed", "blocked"].includes(terminal.status)) {
    throw new Error("NodeTrace trajectory must end with a terminal completion event");
  }
  if (new Set(value.artifacts.map((artifact) => artifact.artifactId)).size !== value.artifacts.length) throw new Error("NodeTrace artifact ids must be unique");
  if (new Set(value.evidence.map((entry) => entry.sha256)).size !== value.evidence.length) throw new Error("NodeTrace evidence hashes must be unique");
  if (canonical(value.changedPaths) !== canonical(value.changeSet.changedPaths)) throw new Error("NodeTrace changedPaths do not match the bound change-set evidence");
  const availableEvidence = new Set(value.evidence.map((entry) => entry.sha256));
  for (const reference of evidenceHashesFromTrajectory(value)) {
    if (!availableEvidence.has(reference)) throw new Error(`NodeTrace verdict references undeclared evidence hash: ${reference}`);
  }
  return { trajectory: value, trajectoryHash: expectedHash, verified: true };
}

async function verifyEvidenceFiles(repoRoot, trajectory) {
  const seenPaths = new Set();
  const seenPhysicalPaths = new Set();
  const seenPhysicalInodes = new Set();
  for (const evidence of trajectory.evidence) {
    if (seenPaths.has(evidence.path)) throw new Error(`NodeTrace evidence path is duplicated: ${evidence.path}`);
    seenPaths.add(evidence.path);
    const target = await resolveSafe(repoRoot, evidence.path, "evidence path");
    const metadata = await lstat(target, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`NodeTrace evidence must be a regular non-symlink file: ${evidence.path}`);
    const physical = await physicalFileIdentity(target, metadata, `NodeTrace evidence ${evidence.path}`);
    if (seenPhysicalPaths.has(physical.path) || (physical.inode && seenPhysicalInodes.has(physical.inode))) {
      throw new Error(`NodeTrace evidence reuses one physical file through multiple paths: ${evidence.path}`);
    }
    seenPhysicalPaths.add(physical.path);
    if (physical.inode) seenPhysicalInodes.add(physical.inode);
    const actual = createHash("sha256").update(await readFile(target)).digest("hex");
    if (actual !== evidence.sha256) throw new Error(`NodeTrace evidence hash mismatch: ${evidence.path}`);
  }
}

async function verifyChangeSetEvidence(repoRoot, trajectory) {
  const reference = trajectory.evidence.find((entry) => entry.path === trajectory.changeSet.evidencePath && entry.sha256 === trajectory.changeSet.evidenceHash);
  if (!reference) throw new Error("NodeTrace change set is not bound to a declared evidence object");
  const target = await resolveSafe(repoRoot, trajectory.changeSet.evidencePath, "change-set evidence path");
  const changeSet = await readJson(target);
  await validateOrThrow("nodekit.builder-change-set.v1.schema.json", changeSet, "Builder Gym change set");
  const expected = {
    schemaVersion: "nodekit.builder-change-set/v1",
    generatedBy: trajectory.changeSet.generatedBy,
    baseRevision: trajectory.changeSet.baseRevision,
    candidateRevision: trajectory.changeSet.candidateRevision,
    lockHash: trajectory.changeSet.lockHash,
    changedPaths: trajectory.changeSet.changedPaths,
  };
  if (canonical(changeSet) !== canonical(expected)) throw new Error("NodeTrace changedPaths do not match the external change-set evidence bytes");
}

function assertChangedPathsAllowed(context, trajectory) {
  for (const changed of trajectory.changedPaths) {
    const normalized = normalizeRepositoryPath(changed, "changed path");
    if (context.gym.protectedRoots.some((root) => pathContains(root, normalized))) {
      throw new Error(`candidate trajectory modifies a protected evaluator path: ${normalized}`);
    }
    if (!context.gym.candidateWriteRoots.some((root) => pathContains(root, normalized))) {
      throw new Error(`candidate trajectory modifies a path outside candidate write roots: ${normalized}`);
    }
  }
}

async function assertTrajectoryBoundToGym(context, trajectory) {
  if (trajectory.applicationId !== context.gym.applicationId) throw new Error("trajectory applicationId does not match Builder Gym");
  if (trajectory.evaluator.id !== context.evaluator.evaluatorId || trajectory.evaluator.version !== context.evaluator.version) {
    throw new Error("trajectory references a different protected evaluator identity");
  }
  if (trajectory.evaluator.hash !== context.evaluatorHash) throw new Error("trajectory protected evaluator hash mismatch");
  const taskSet = await protectedTaskSet(context);
  if (trajectory.task.taskSetHash !== taskSet.hash) throw new Error("trajectory protected task-set hash mismatch");
  if (!taskSet.taskIds.has(trajectory.task.id)) throw new Error(`trajectory task is not present in a protected task index: ${trajectory.task.id}`);
  assertChangedPathsAllowed(context, trajectory);
}

export async function recordNodeTraceTrajectory(repoRoot, trajectoryOrPath) {
  const trajectory = typeof trajectoryOrPath === "string"
    ? await readJson(path.resolve(trajectoryOrPath))
    : structuredClone(trajectoryOrPath);
  await verifyNodeTraceTrajectory(trajectory);
  const context = await readBuilderGymContext(repoRoot);
  await assertTrajectoryBoundToGym(context, trajectory);
  await verifyEvidenceFiles(context.root, trajectory);
  await verifyChangeSetEvidence(context.root, trajectory);
  const output = await resolveSafe(context.root, `${context.gym.trajectoryRoot}/${trajectory.trajectoryHash}.json`, "trajectory output", { allowMissing: true });
  await writeContentAddressedJson(output, trajectory, "NodeTrace trajectory");
  return {
    trajectory,
    trajectoryHash: trajectory.trajectoryHash,
    output: path.relative(context.root, output).replaceAll("\\", "/"),
    evaluatorHash: context.evaluatorHash,
    protected: true,
  };
}

export async function inspectNodeTraceTrajectory(repoRoot, reference) {
  const context = await readBuilderGymContext(repoRoot);
  const match = String(reference).match(TRAJECTORY_ID_PATTERN);
  const hashReference = HASH_PATTERN.test(String(reference)) ? String(reference) : match?.[1];
  const target = hashReference
    ? await resolveSafe(context.root, `${context.gym.trajectoryRoot}/${hashReference}.json`, "trajectory reference")
    : await resolveSafe(context.root, reference, "trajectory reference");
  const trajectory = await readJson(target);
  await verifyNodeTraceTrajectory(trajectory);
  await assertTrajectoryBoundToGym(context, trajectory);
  await verifyEvidenceFiles(context.root, trajectory);
  await verifyChangeSetEvidence(context.root, trajectory);
  return {
    trajectory,
    trajectoryHash: trajectory.trajectoryHash,
    evaluatorHash: context.evaluatorHash,
    protectedTaskSetHash: trajectory.task.taskSetHash,
    verified: true,
  };
}

function fixedInputSnapshot(trajectory) {
  return {
    applicationId: trajectory.applicationId,
    task: trajectory.task,
    model: trajectory.model,
    budgets: trajectory.budgets,
    runtimeHash: trajectory.harness.runtimeHash,
    interactionHash: trajectory.harness.interactionHash,
    toolSurfaceHash: trajectory.harness.toolSurfaceHash,
    contextPolicyHash: trajectory.harness.contextPolicyHash,
    skillStackHash: trajectory.harness.skillStackHash,
    evaluator: trajectory.evaluator,
  };
}

function sealBuilderGymLock(input) {
  const body = withoutAddress(input, "lockId", "lockHash");
  const lockHash = contentHash(body);
  return { ...body, lockId: `builder-gym-lock:sha256:${lockHash}`, lockHash };
}

export async function verifyBuilderGymLock(value) {
  await validateOrThrow("nodekit.builder-gym-lock.v1.schema.json", value, "Builder Gym lock");
  const expectedHash = contentHash(withoutAddress(value, "lockId", "lockHash"));
  if (value.lockHash !== expectedHash) throw new Error("Builder Gym lock content hash mismatch");
  if (value.lockId !== `builder-gym-lock:sha256:${expectedHash}`) throw new Error("Builder Gym lock id does not match its content hash");
  return { lock: value, lockHash: expectedHash, verified: true };
}

async function loadBuilderGymLock(context, reference) {
  if (reference && typeof reference === "object") {
    const lock = structuredClone(reference);
    delete lock.output;
    await verifyBuilderGymLock(lock);
    return lock;
  }
  const match = String(reference).match(LOCK_ID_PATTERN);
  const hashReference = HASH_PATTERN.test(String(reference)) ? String(reference) : match?.[1];
  const target = hashReference
    ? await resolveSafe(context.root, `${context.gym.lockRoot}/${hashReference}.json`, "Builder Gym lock reference")
    : await resolveSafe(context.root, reference, "Builder Gym lock reference");
  const lock = await readJson(target);
  await verifyBuilderGymLock(lock);
  return lock;
}

export async function createBuilderGymLock(repoRoot, baseline) {
  const context = await readBuilderGymContext(repoRoot);
  const baselineRecord = await recordNodeTraceTrajectory(context.root, baseline);
  const trajectory = baselineRecord.trajectory;
  if (trajectory.arm !== "baseline") throw new Error("Builder Gym lock requires a baseline trajectory");
  if (trajectory.changeSet.lockHash !== null) throw new Error("Builder Gym baseline change set must precede the protected lock");
  const taskSet = await protectedTaskSet(context);
  const rootsHash = await protectedRootHash(context);
  const lock = sealBuilderGymLock({
    schemaVersion: "nodekit.builder-gym-lock/v1",
    gymId: context.gym.gymId,
    applicationId: context.gym.applicationId,
    evaluatorHash: context.evaluatorHash,
    protectedTaskSetHash: taskSet.hash,
    protectedRootHash: rootsHash,
    baselineTrajectoryHash: trajectory.trajectoryHash,
    baselineRevision: trajectory.changeSet.candidateRevision,
    protectedRoots: context.gym.protectedRoots,
    candidateWriteRoots: context.gym.candidateWriteRoots,
    fixedInputs: fixedInputSnapshot(trajectory),
    automaticPromotion: false,
  });
  await verifyBuilderGymLock(lock);
  const output = await resolveSafe(context.root, `${context.gym.lockRoot}/${lock.lockHash}.json`, "Builder Gym lock output", { allowMissing: true });
  await writeContentAddressedJson(output, lock, "Builder Gym lock");
  return { ...lock, output: path.relative(context.root, output).replaceAll("\\", "/") };
}

function outcomeForScores(baseline, candidate, maximumRegression) {
  if (candidate > baseline) return "improved";
  if (candidate + maximumRegression < baseline) return "regressed";
  return "held";
}

function compareQualityDimension(name, baseline, candidate, thresholds) {
  const baselineVerdict = baseline.verdicts[name];
  const candidateVerdict = candidate.verdicts[name];
  const outcome = outcomeForScores(baselineVerdict.score, candidateVerdict.score, thresholds.maximumScoreRegression);
  const passed = candidateVerdict.passed === true
    && candidateVerdict.score >= thresholds.minimumScores[name]
    && outcome !== "regressed";
  return {
    baseline: baselineVerdict.score,
    candidate: candidateVerdict.score,
    outcome: passed ? outcome : "regressed",
    passed,
    reason: passed
      ? `self-reported ${name} observation met the frozen local threshold without regression`
      : `self-reported ${name} observation failed its frozen local threshold or regressed`,
  };
}

function withinRatio(candidate, baseline, limit) {
  return baseline === 0 ? candidate === 0 : candidate <= baseline * limit;
}

function compareEfficiency(baseline, candidate, thresholds) {
  const left = baseline.verdicts.efficiency;
  const right = candidate.verdicts.efficiency;
  const baselineTokens = left.metrics.tokensIn + left.metrics.tokensOut;
  const candidateTokens = right.metrics.tokensIn + right.metrics.tokensOut;
  const constraints = {
    latency: withinRatio(right.metrics.durationMs, left.metrics.durationMs, thresholds.maxLatencyRatio),
    tokens: withinRatio(candidateTokens, baselineTokens, thresholds.maxTokenRatio),
    cost: withinRatio(right.metrics.costUsd, left.metrics.costUsd, thresholds.maxCostRatio),
    turns: right.metrics.turns <= left.metrics.turns + thresholds.maxTurnIncrease,
    evaluator: right.passed === true,
  };
  const passed = Object.values(constraints).every(Boolean);
  const materiallyLower = right.metrics.durationMs < left.metrics.durationMs
    || candidateTokens < baselineTokens
    || right.metrics.costUsd < left.metrics.costUsd
    || right.metrics.turns < left.metrics.turns;
  const scoreOutcome = outcomeForScores(left.score, right.score, thresholds.maximumScoreRegression);
  const outcome = !passed || scoreOutcome === "regressed" ? "regressed" : (scoreOutcome === "improved" || materiallyLower ? "improved" : "held");
  return {
    baseline: left.score,
    candidate: right.score,
    outcome,
    passed: passed && outcome !== "regressed",
    reason: passed && outcome !== "regressed"
      ? "self-reported efficiency stayed within frozen local latency, token, cost, and turn budgets"
      : "self-reported efficiency exceeded a frozen local budget or regressed",
  };
}

function compareHumanPreference(candidate, required) {
  const verdict = candidate.verdicts.humanPreference;
  if (verdict.status === "candidate-preferred") return { baseline: 0, candidate: verdict.score ?? 1, outcome: "improved", passed: true, reason: "trajectory self-reports that the recorded reviewer preferred the candidate" };
  if (verdict.status === "tie") return { baseline: verdict.score ?? 0.5, candidate: verdict.score ?? 0.5, outcome: "held", passed: true, reason: "trajectory self-reports that the reviewer recorded a tie" };
  if (verdict.status === "baseline-preferred") return { baseline: verdict.score ?? 1, candidate: 0, outcome: "regressed", passed: false, reason: "trajectory self-reports that the recorded reviewer preferred the baseline" };
  return { baseline: null, candidate: null, outcome: "unmeasured", passed: !required, reason: required ? "protected evaluator requires human preference evidence" : "human preference was not collected; no preference claim is authorized" };
}

function sealBuilderGymVerdict(input) {
  const body = withoutAddress(input, "comparisonId", "verdictHash");
  const verdictHash = contentHash(body);
  return { ...body, comparisonId: `builder-gym:sha256:${verdictHash}`, verdictHash };
}

export async function verifyBuilderGymVerdict(value) {
  await validateOrThrow("nodekit.builder-gym-verdict.v1.schema.json", value, "Builder Gym verdict");
  const expectedHash = contentHash(withoutAddress(value, "comparisonId", "verdictHash"));
  if (value.verdictHash !== expectedHash) throw new Error("Builder Gym verdict content hash mismatch");
  if (value.comparisonId !== `builder-gym:sha256:${expectedHash}`) throw new Error("Builder Gym comparison id does not match its content hash");
  return { verdict: value, verdictHash: expectedHash, verified: true };
}

export async function evaluateBuilderGym(repoRoot, { baseline, candidate, lock: lockReference, expectedLockHash }) {
  const context = await readBuilderGymContext(repoRoot);
  if (!lockReference) throw new Error("Builder Gym evaluation requires a protected pre-candidate lock");
  if (!HASH_PATTERN.test(String(expectedLockHash ?? ""))) throw new Error("Builder Gym evaluation requires an externally pinned expectedLockHash");
  const lock = await loadBuilderGymLock(context, lockReference);
  if (lock.lockHash !== expectedLockHash) throw new Error("Builder Gym lock does not match the externally pinned identity");
  const currentTaskSet = await protectedTaskSet(context);
  const currentProtectedRootHash = await protectedRootHash(context);
  if (lock.gymId !== context.gym.gymId || lock.applicationId !== context.gym.applicationId) throw new Error("Builder Gym lock application identity mismatch");
  if (lock.evaluatorHash !== context.evaluatorHash) throw new Error("Builder Gym lock protected evaluator changed");
  if (lock.protectedTaskSetHash !== currentTaskSet.hash) throw new Error("Builder Gym lock protected task set changed");
  if (lock.protectedRootHash !== currentProtectedRootHash) throw new Error("Builder Gym lock protected roots are dirty or changed");
  if (canonical(lock.protectedRoots) !== canonical(context.gym.protectedRoots) || canonical(lock.candidateWriteRoots) !== canonical(context.gym.candidateWriteRoots)) {
    throw new Error("Builder Gym lock write boundary changed");
  }
  const baselineRecord = await recordNodeTraceTrajectory(context.root, baseline);
  const candidateRecord = await recordNodeTraceTrajectory(context.root, candidate);
  const left = baselineRecord.trajectory;
  const right = candidateRecord.trajectory;
  if (left.arm !== "baseline" || right.arm !== "candidate") throw new Error("Builder Gym requires baseline and candidate trajectory arms");
  if (right.changeSet.lockHash !== lock.lockHash || right.changeSet.baseRevision !== lock.baselineRevision) throw new Error("candidate change-set evidence is not bound to the protected lock and baseline revision");
  if (right.changedPaths.length === 0) throw new Error("Builder Gym candidate must contain an externally evidenced change set");
  if (left.trajectoryHash !== lock.baselineTrajectoryHash) throw new Error("Builder Gym baseline trajectory does not match the protected lock");
  if (left.trajectoryHash === right.trajectoryHash) throw new Error("Builder Gym baseline and candidate trajectories must be distinct");
  if (left.harness.builderHash === right.harness.builderHash) throw new Error("Builder Gym candidate must change the builder harness identity");
  if (canonical(fixedInputSnapshot(left)) !== canonical(fixedInputSnapshot(right))) {
    throw new Error("Builder Gym comparison changed a protected fixed input");
  }
  if (canonical(fixedInputSnapshot(left)) !== canonical(lock.fixedInputs)) throw new Error("Builder Gym fixed inputs do not match the protected lock");
  const thresholds = context.evaluator.thresholds;
  const dimensions = {
    task: compareQualityDimension("task", left, right, thresholds),
    artifact: compareQualityDimension("artifact", left, right, thresholds),
    ui: compareQualityDimension("ui", left, right, thresholds),
    safety: compareQualityDimension("safety", left, right, thresholds),
    efficiency: compareEfficiency(left, right, thresholds),
    evidence: compareQualityDimension("evidence", left, right, thresholds),
    humanPreference: compareHumanPreference(right, thresholds.requireHumanPreference),
  };
  const improvedDimensions = NODETRACE_VERDICT_DIMENSIONS.filter((name) => dimensions[name].outcome === "improved");
  const heldDimensions = NODETRACE_VERDICT_DIMENSIONS.filter((name) => dimensions[name].outcome === "held");
  const regressedDimensions = NODETRACE_VERDICT_DIMENSIONS.filter((name) => dimensions[name].outcome === "regressed");
  const passed = Object.values(dimensions).every((entry) => entry.passed) && regressedDimensions.length === 0;
  const verdict = sealBuilderGymVerdict({
    schemaVersion: "nodekit.builder-gym-verdict/v1",
    gymId: context.gym.gymId,
    baselineTrajectoryHash: left.trajectoryHash,
    candidateTrajectoryHash: right.trajectoryHash,
    evaluatorHash: context.evaluatorHash,
    lockHash: lock.lockHash,
    protectedEvaluatorUnchanged: true,
    fixedInputsHeld: true,
    measurementAuthority: "trajectory-self-reported",
    protectedEvaluationPassed: false,
    dimensions,
    improvedDimensions,
    heldDimensions,
    regressedDimensions,
    outcome: passed ? (improvedDimensions.length > 0 ? "improved" : "held") : "regressed",
    passed,
    realWorldClaimAuthorized: false,
    promotionAuthorized: false,
    nextRequirements: [
      "repeat on frozen protected tasks with isolated fresh coding agents",
      "collect independent human preference evidence",
      "verify a matching NodeProof receipt before any manual promotion",
    ],
  });
  await verifyBuilderGymVerdict(verdict);
  const output = await resolveSafe(context.root, `${context.gym.receiptRoot}/${verdict.verdictHash}.json`, "Builder Gym verdict output", { allowMissing: true });
  await writeContentAddressedJson(output, verdict, "Builder Gym verdict");
  return { ...verdict, output: path.relative(context.root, output).replaceAll("\\", "/") };
}

export async function inspectBuilderGymVerdict(repoRoot, reference) {
  const context = await readBuilderGymContext(repoRoot);
  const match = String(reference).match(VERDICT_ID_PATTERN);
  const hashReference = HASH_PATTERN.test(String(reference)) ? String(reference) : match?.[1];
  const target = hashReference
    ? await resolveSafe(context.root, `${context.gym.receiptRoot}/${hashReference}.json`, "Builder Gym verdict reference")
    : await resolveSafe(context.root, reference, "Builder Gym verdict reference");
  const verdict = await readJson(target);
  await verifyBuilderGymVerdict(verdict);
  if (verdict.evaluatorHash !== context.evaluatorHash) throw new Error("Builder Gym verdict is not bound to the current protected evaluator");
  const lock = await loadBuilderGymLock(context, verdict.lockHash);
  if (lock.baselineTrajectoryHash !== verdict.baselineTrajectoryHash) throw new Error("Builder Gym verdict baseline does not match its protected lock");
  await inspectNodeTraceTrajectory(context.root, verdict.baselineTrajectoryHash);
  await inspectNodeTraceTrajectory(context.root, verdict.candidateTrajectoryHash);
  return { verdict, verdictHash: verdict.verdictHash, evaluatorHash: context.evaluatorHash, verified: true };
}

async function countJsonFiles(root) {
  if (!(await pathExists(root))) return 0;
  return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
}

export async function builderGymStatus(repoRoot) {
  const context = await readBuilderGymContext(repoRoot);
  const taskSet = await protectedTaskSet(context);
  return {
    schemaVersion: "nodekit.builder-gym-status/v1",
    gymId: context.gym.gymId,
    applicationId: context.gym.applicationId,
    evaluatorId: context.evaluator.evaluatorId,
    evaluatorHash: context.evaluatorHash,
    protectedTaskSetHash: taskSet.hash,
    protectedTaskCount: taskSet.taskIds.size,
    trajectoryCount: await countJsonFiles(await resolveSafe(context.root, context.gym.trajectoryRoot, "trajectoryRoot")),
    verdictCount: await countJsonFiles(await resolveSafe(context.root, context.gym.receiptRoot, "receiptRoot")),
    lockCount: await countJsonFiles(await resolveSafe(context.root, context.gym.lockRoot, "lockRoot")),
    dimensions: context.evaluator.dimensions,
    protectedRoots: context.gym.protectedRoots,
    candidateWriteRoots: context.gym.candidateWriteRoots,
    mechanicsReady: true,
    realWorldEvidence: false,
    promotionAuthorized: false,
    automaticPromotion: false,
  };
}

export async function builderGymContext(repoRoot) {
  const context = await readBuilderGymContext(repoRoot);
  const taskSet = await protectedTaskSet(context);
  return {
    applicationId: context.gym.applicationId,
    evaluator: {
      id: context.evaluator.evaluatorId,
      version: context.evaluator.version,
      hash: context.evaluatorHash,
    },
    protectedTaskSetHash: taskSet.hash,
    protectedTaskIds: [...taskSet.taskIds].sort(),
    candidateWriteRoots: context.gym.candidateWriteRoots,
    protectedRoots: context.gym.protectedRoots,
  };
}
