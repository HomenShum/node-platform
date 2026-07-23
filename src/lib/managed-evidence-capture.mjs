import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { inspectNpmPackageArchiveFile } from "./npm-package-archive.mjs";
import { computeNodeKitSourceHash } from "./source-hash.mjs";
import {
  evidenceContractPasses,
  resolveSubmissionEvidenceClosure,
} from "./submission-gate.mjs";

export const MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION = "nodekit.managed-evidence-campaign/v1";
export const MANAGED_EVIDENCE_EVENT_SCHEMA_VERSION = "nodekit.managed-evidence-event/v1";
export const MANAGED_EVIDENCE_RECEIPT_SCHEMA_VERSION = "nodekit.managed-evidence-capture-receipt/v1";
export const MANAGED_EVIDENCE_CLEANUP_SCHEMA_VERSION = "nodekit.managed-evidence-cleanup-receipt/v1";
export const MANAGED_EVIDENCE_ROOT = "proof/managed-evidence";

const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAMPAIGN_ID = /^campaign_[a-f0-9]{24}$/u;
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{1,127}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SAFE_PHASE = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PORTABLE_PATH = /^(?!\/)(?!\.\/)(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)\.\.?(?:\/|$))(?![A-Za-z]:)(?!.*\u0000)[^\\]+$/u;
const SECRET_KEY_TERMS = Object.freeze([
  "accesstoken",
  "accesskey",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "deploykey",
  "password",
  "privatekey",
  "servicerolekey",
  "secret",
  "token",
]);
const JSON_EXTENSIONS = new Set([".json", ".jsonl"]);
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".log", ".md", ".txt", ".yaml", ".yml"]);

const GATE_PROFILES = Object.freeze({
  previewDeployment: Object.freeze({
    directory: "preview",
    requiredEvidence: Object.freeze([
      "browser-proof",
      "screenshot-manifest",
      "exported-artifact",
      "reopen-score",
      "cleanup-receipt",
      "deployment-receipt",
    ]),
    requiredPhases: Object.freeze(["deploy", "health", "browser", "export-reopen", "cleanup"]),
    requiredResources: Object.freeze(["frontend-preview", "backend-preview"]),
    allowedResources: Object.freeze({
      "frontend-preview": "preview",
      "backend-preview": "preview",
    }),
    browserResource: "frontend-preview",
  }),
  managedSupabasePortability: Object.freeze({
    directory: "managed-supabase",
    requiredEvidence: Object.freeze([
      "postgres-conformance",
      "auth-rls-report",
      "storage-roundtrip",
      "realtime-delivery",
      "queue-report",
      "cron-report",
      "export-import-report",
      "managed-service-receipt",
      "cleanup-receipt",
    ]),
    requiredPhases: Object.freeze([
      "provision",
      "migrate",
      "auth-rls",
      "storage",
      "realtime",
      "queue",
      "cron",
      "export-import",
      "cleanup",
    ]),
    requiredResources: Object.freeze(["managed-supabase-project"]),
    allowedResources: Object.freeze({ "managed-supabase-project": "managed-test" }),
    browserResource: null,
  }),
  threeConvexConsumers: Object.freeze({
    directory: "convex-consumer",
    requiredEvidence: Object.freeze([
      "component-tarball",
      "consumer-verdict",
      "screenshot-manifest",
      "cleanup-receipt",
    ]),
    requiredPhases: Object.freeze(["install", "conformance", "deploy", "browser", "cleanup"]),
    requiredResources: Object.freeze(["consumer-frontend-preview", "convex-preview-deployment"]),
    allowedResources: Object.freeze({
      "consumer-frontend-preview": "adoption-test",
      "convex-preview-deployment": "adoption-test",
    }),
    browserResource: "consumer-frontend-preview",
  }),
});

const CONSUMER_IDS = new Set(["noderoom", "nodeslide", "nodevideo"]);
const OUTCOMES = new Set(["succeeded", "failed", "cancelled"]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
}

function prettyBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function now(clock) {
  const value = (clock?.nowIso ?? (() => new Date().toISOString()))();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("clock must return a canonical UTC ISO timestamp with millisecond precision");
  }
  return value;
}

function monotonic(clock) {
  const value = String((clock?.monotonicNs ?? (() => process.hrtime.bigint()))());
  if (!/^\d+$/u.test(value)) throw new Error("clock returned an invalid monotonic timestamp");
  return value;
}

function requireProfile(gate) {
  const profile = GATE_PROFILES[gate];
  if (!profile) throw new Error(`unsupported managed evidence gate: ${gate ?? "missing"}`);
  return profile;
}

function requireCanonicalPath(value, label) {
  if (typeof value !== "string" || !PORTABLE_PATH.test(value)) throw new Error(`${label} must be a canonical repository-relative POSIX path`);
  return value;
}

function requireSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function portablePath(root, absolute, label) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  requireCanonicalPath(relative, label);
  return relative;
}

function containedPath(root, relative, label) {
  requireCanonicalPath(relative, label);
  const absolute = path.resolve(root, ...relative.split("/"));
  if (path.relative(root, absolute).startsWith("..") || path.isAbsolute(path.relative(root, absolute))) {
    throw new Error(`${label} escapes the repository`);
  }
  return absolute;
}

async function regularContainedFile(root, relative, label) {
  const absolute = containedPath(root, relative, label);
  const metadata = await lstat(absolute, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (metadata.nlink !== 1n) throw new Error(`${label} must not be a hard-linked alias`);
  const resolved = await realpath(absolute);
  if (path.relative(root, resolved).startsWith("..") || path.isAbsolute(path.relative(root, resolved))) throw new Error(`${label} resolves outside the repository`);
  return { absolute, bytes: await readFile(resolved), resolved };
}

function git(root, args, label) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${label}: ${String(result.stderr ?? result.error?.message ?? "git failed").trim()}`);
  return result.stdout.trim();
}

async function resolveRepository(repoRoot) {
  const root = await realpath(path.resolve(repoRoot ?? process.cwd()));
  const top = await realpath(git(root, ["rev-parse", "--show-toplevel"], "repository discovery failed"));
  if ((process.platform === "win32" ? top.toLowerCase() : top) !== (process.platform === "win32" ? root.toLowerCase() : root)) {
    throw new Error("repoRoot must identify the Git worktree root");
  }
  return root;
}

function assertReleaseIdentity(proof) {
  const release = proof?.releaseCandidate;
  if (proof?.schemaVersion !== "nodekit.package-install-proof/v1" || proof?.passed !== true) throw new Error("candidate proof must be a passing nodekit.package-install-proof/v1 record");
  if (!COMMIT.test(proof.candidateCommit ?? "") || proof.candidateCommit !== proof.nodekitCommit || proof.nodekitCommit !== release?.nodekitCommit) throw new Error("candidate proof commit identity is inconsistent");
  if (!SHA256.test(proof.nodekitSourceHash ?? "") || proof.nodekitSourceHash !== release?.nodekitSourceHash) throw new Error("candidate proof source identity is inconsistent");
  if (proof.nodekitIdentity !== `${proof.nodekitCommit}/${proof.nodekitSourceHash}`) throw new Error("candidate proof nodekitIdentity is inconsistent");
  if (release?.packageName !== "@homenshum/nodekit" || typeof release?.packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(release.packageVersion)) throw new Error("candidate proof package identity is invalid");
  if (!SHA256.test(release.nodekitTarballSha256 ?? "") || release.nodekitTarballSha256 !== proof.tarballSha256) throw new Error("candidate proof tarball identity is inconsistent");
  if (!Number.isSafeInteger(proof.tarballBytes) || proof.tarballBytes <= 0) throw new Error("candidate proof tarballBytes is invalid");
  requireCanonicalPath(proof.tarball, "candidate tarball path");
  return release;
}

export async function verifyManagedEvidenceCandidate({ repoRoot = process.cwd(), candidateProof } = {}) {
  const root = await resolveRepository(repoRoot);
  const proofPath = requireCanonicalPath(candidateProof, "candidateProof");
  const proofRecord = await regularContainedFile(root, proofPath, "candidate proof");
  let proof;
  try {
    proof = JSON.parse(proofRecord.bytes.toString("utf8"));
  } catch {
    throw new Error("candidate proof is not valid JSON");
  }
  const release = assertReleaseIdentity(proof);
  if (!evidenceContractPasses("packageInstallProof", proof)) throw new Error("candidate proof does not satisfy the exact package-install contract");
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"], "candidate HEAD lookup failed").toLowerCase();
  if (head !== release.nodekitCommit) throw new Error(`candidate proof is stale: repository HEAD is ${head}`);
  const sourceHash = await computeNodeKitSourceHash(root);
  if (sourceHash !== release.nodekitSourceHash) throw new Error("candidate proof is stale: current distributable source hash differs");
  const archiveRecord = await regularContainedFile(root, proof.tarball, "candidate tarball");
  if (archiveRecord.bytes.length !== proof.tarballBytes || sha256(archiveRecord.bytes) !== release.nodekitTarballSha256) throw new Error("candidate tarball bytes differ from the package proof");
  const archive = await inspectNpmPackageArchiveFile(archiveRecord.resolved, {
    expectedName: release.packageName,
    expectedVersion: release.packageVersion,
    expectedTarballSha256: release.nodekitTarballSha256,
  });
  await resolveSubmissionEvidenceClosure(root, "packageInstallProof", proof);
  return {
    repoRoot: root,
    candidate: {
      nodekitCommit: release.nodekitCommit,
      nodekitSourceHash: release.nodekitSourceHash,
      nodekitIdentity: `${release.nodekitCommit}/${release.nodekitSourceHash}`,
      packageName: release.packageName,
      packageVersion: release.packageVersion,
      candidateProof: { path: proofPath, sha256: sha256(proofRecord.bytes), bytes: proofRecord.bytes.length },
      tarball: {
        path: proof.tarball,
        sha256: archive.tarballSha256,
        bytes: archive.tarballBytes,
        canonicalManifestSha256: archive.canonicalManifestSha256,
      },
    },
  };
}

function validateCredentialNames(requiredEnvironmentVariables, environment) {
  if (!Array.isArray(requiredEnvironmentVariables) || requiredEnvironmentVariables.length === 0) throw new Error("at least one required credential environment-variable name is required");
  const names = [...new Set(requiredEnvironmentVariables)];
  if (names.length !== requiredEnvironmentVariables.length || !names.every((name) => ENVIRONMENT_VARIABLE.test(name))) throw new Error("credential names must be unique uppercase environment-variable names");
  const missing = names.filter((name) => typeof environment[name] !== "string" || environment[name].trim().length === 0);
  if (missing.length > 0) throw new Error(`credential preflight failed; missing environment variables: ${missing.join(", ")}`);
  return names.sort();
}

function isSecretLikeKey(value) {
  const normalized = String(value).replace(/[^a-z0-9]/giu, "").toLowerCase();
  return SECRET_KEY_TERMS.some((term) => normalized.includes(term));
}

async function assertConsumerRepository({ consumerRoot, consumerCommit, consumerId }) {
  if (!CONSUMER_IDS.has(consumerId)) throw new Error("consumerId must be noderoom, nodeslide, or nodevideo");
  if (typeof consumerRoot !== "string" || consumerRoot.length === 0) throw new Error("consumerRoot is required for a consumer campaign");
  const root = await realpath(path.resolve(consumerRoot));
  const top = await realpath(git(root, ["rev-parse", "--show-toplevel"], "consumer repository discovery failed"));
  if ((process.platform === "win32" ? top.toLowerCase() : top) !== (process.platform === "win32" ? root.toLowerCase() : root)) throw new Error("consumerRoot must identify the Git worktree root");
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"], "consumer HEAD lookup failed").toLowerCase();
  if (!COMMIT.test(consumerCommit ?? "") || head !== consumerCommit) throw new Error("consumerCommit must equal the clean consumer worktree HEAD");
  const dirty = git(root, ["status", "--porcelain=v1", "--untracked-files=all"], "consumer cleanliness check failed");
  if (dirty !== "") throw new Error("consumer worktree must be clean before a decisive adoption campaign starts");
  return { id: consumerId, commit: consumerCommit };
}

function campaignPaths(repoRoot, gate, candidateCommit, campaignId) {
  if (!CAMPAIGN_ID.test(campaignId ?? "")) throw new Error("campaignId is invalid");
  const profile = requireProfile(gate);
  const directory = path.join(repoRoot, ...MANAGED_EVIDENCE_ROOT.split("/"), profile.directory, candidateCommit, campaignId);
  return {
    directory,
    meta: path.join(directory, "campaign-meta.json"),
    events: path.join(directory, "events.jsonl"),
    checkpoint: path.join(directory, "campaign.json"),
    receipt: path.join(directory, "campaign-receipt.json"),
    evidence: path.join(directory, "evidence"),
    cleanup: path.join(directory, "cleanup"),
    lock: path.join(directory, ".operator.lock"),
  };
}

async function exclusiveWrite(file, bytes) {
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
}

async function writeIfMissingOrExact(file, bytes) {
  try {
    await exclusiveWrite(file, bytes);
    return false;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (!(await readFile(file)).equals(bytes)) throw new Error(`${file} already exists with different bytes; refusing to overwrite evidence`);
    return true;
  }
}

async function atomicCheckpoint(file, bytes) {
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withLock(paths, operation) {
  let handle;
  try {
    handle = await open(paths.lock, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another capture command is active, or a previous command stopped unexpectedly; inspect .operator.lock before removing it");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(paths.lock, { force: true });
  }
}

function eventBody({ meta, sequence, type, occurredAt, monotonicNs, previousEventSha256, payload }) {
  return {
    schemaVersion: MANAGED_EVIDENCE_EVENT_SCHEMA_VERSION,
    campaignId: meta.campaignId,
    gate: meta.gate,
    sequence,
    type,
    occurredAt,
    monotonicNs,
    previousEventSha256,
    payload,
  };
}

function sealEvent(body) {
  return { ...body, eventSha256: sha256(canonicalBytes(body)) };
}

function validateEvent(event, meta, sequence, previous) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("managed evidence event must be an object");
  if (event.schemaVersion !== MANAGED_EVIDENCE_EVENT_SCHEMA_VERSION || event.campaignId !== meta.campaignId || event.gate !== meta.gate) throw new Error("managed evidence event identity changed");
  if (event.sequence !== sequence || event.previousEventSha256 !== previous) throw new Error("managed evidence event chain is not contiguous");
  if (typeof event.type !== "string" || !/^[a-z][a-z0-9.-]{0,95}$/u.test(event.type)) throw new Error("managed evidence event type is invalid");
  if (!Number.isFinite(Date.parse(event.occurredAt)) || !/^\d+$/u.test(event.monotonicNs ?? "")) throw new Error("managed evidence event time is invalid");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("managed evidence event payload must be an object");
  const { eventSha256, ...body } = event;
  if (!SHA256.test(eventSha256 ?? "") || eventSha256 !== sha256(canonicalBytes(body))) throw new Error("managed evidence event digest is invalid");
}

async function readMeta(paths) {
  const meta = JSON.parse(await readFile(paths.meta, "utf8"));
  if (meta.schemaVersion !== "nodekit.managed-evidence-campaign-meta/v1" || !CAMPAIGN_ID.test(meta.campaignId ?? "")) throw new Error("managed evidence campaign metadata is invalid");
  requireProfile(meta.gate);
  if (!COMMIT.test(meta.candidate?.nodekitCommit ?? "") || !SHA256.test(meta.candidate?.nodekitSourceHash ?? "") || !SHA256.test(meta.candidate?.tarball?.sha256 ?? "")) throw new Error("managed evidence campaign candidate identity is invalid");
  if (meta.credentialPreflight?.allPresent !== true || !Array.isArray(meta.credentialPreflight.requiredEnvironmentVariables) || meta.credentialPreflight.requiredEnvironmentVariables.length === 0) throw new Error("managed evidence campaign credential preflight is invalid");
  return meta;
}

async function readEvents(paths, meta) {
  const bytes = await readFile(paths.events);
  const lines = bytes.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) throw new Error("managed evidence event log is empty");
  const events = lines.map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`managed evidence event ${index + 1} is not JSON`); }
  });
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    validateEvent(events[index], meta, index + 1, previous);
    if (index > 0 && Date.parse(events[index].occurredAt) < Date.parse(events[index - 1].occurredAt)) throw new Error("managed evidence wall clock moved backwards");
    previous = events[index].eventSha256;
  }
  if (events[0].type !== "campaign.started" || events.filter((event) => event.type === "campaign.started").length !== 1) throw new Error("managed evidence campaign must start exactly once");
  if (events.filter((event) => event.type === "campaign.ready").length > 1 || events.some((event, index) => event.type === "campaign.ready" && index !== events.length - 1)) throw new Error("campaign.ready must be the final event and appear at most once");
  return { bytes, events };
}

async function appendEvent(paths, meta, events, type, payload, clock) {
  if (events.at(-1)?.type === "campaign.ready") throw new Error("campaign is ready for independent review and cannot be changed");
  const occurredAt = now(clock);
  const monotonicNs = monotonic(clock);
  const previous = events.at(-1);
  if (previous && Date.parse(occurredAt) < Date.parse(previous.occurredAt)) throw new Error("wall clock moved backwards; refusing to append evidence");
  const event = sealEvent(eventBody({
    meta,
    sequence: events.length + 1,
    type,
    occurredAt,
    monotonicNs,
    previousEventSha256: previous?.eventSha256 ?? null,
    payload,
  }));
  await appendFile(paths.events, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  return event;
}

function elapsedMs(start, end) {
  const elapsed = Date.parse(end) - Date.parse(start);
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) throw new Error("campaign elapsed time is invalid");
  return elapsed;
}

function derive(events, meta) {
  const resources = new Map();
  const evidence = new Map();
  const phaseAttempts = [];
  let activePhase = null;
  let screenshotManifest = null;
  for (const event of events) {
    if (event.type === "resource.recorded") {
      if (resources.has(event.payload.kind)) throw new Error(`resource kind was recorded twice: ${event.payload.kind}`);
      resources.set(event.payload.kind, { ...event.payload, cleanup: null });
    } else if (event.type === "resource.cleaned") {
      const resource = resources.get(event.payload.kind);
      if (!resource || resource.cleanup) throw new Error(`cleanup does not match one active resource: ${event.payload.kind}`);
      resource.cleanup = event.payload.receipt;
    } else if (event.type === "evidence.imported") {
      if (evidence.has(event.payload.kind)) throw new Error(`evidence kind was recorded twice: ${event.payload.kind}`);
      evidence.set(event.payload.kind, event.payload.reference);
    } else if (event.type === "browser-manifest.linked") {
      if (screenshotManifest) throw new Error("browser screenshot manifest was linked more than once");
      screenshotManifest = event.payload;
      evidence.set("screenshot-manifest", event.payload.reference);
    } else if (event.type === "phase.started") {
      if (activePhase) throw new Error(`phase ${activePhase.name} was not completed before ${event.payload.name} started`);
      activePhase = { name: event.payload.name, startedAt: event.occurredAt, monotonicStartedNs: event.monotonicNs, attempt: phaseAttempts.filter((entry) => entry.name === event.payload.name).length + 1 };
    } else if (event.type === "phase.completed") {
      if (!activePhase || activePhase.name !== event.payload.name) throw new Error(`phase completion does not match the active phase: ${event.payload.name}`);
      phaseAttempts.push({
        ...activePhase,
        completedAt: event.occurredAt,
        monotonicCompletedNs: event.monotonicNs,
        durationMs: event.payload.durationMs,
        timerSource: event.payload.timerSource,
        outcome: event.payload.outcome,
      });
      activePhase = null;
    }
  }
  return { resources, evidence, phaseAttempts, activePhase, screenshotManifest };
}

function campaignReady(meta, state) {
  const profile = requireProfile(meta.gate);
  const errors = [];
  if (state.activePhase) errors.push(`phase ${state.activePhase.name} is still active`);
  for (const phase of profile.requiredPhases) {
    if (!state.phaseAttempts.some((attempt) => attempt.name === phase && attempt.outcome === "succeeded")) errors.push(`required phase has not succeeded: ${phase}`);
  }
  for (const resourceKind of profile.requiredResources) {
    const resource = state.resources.get(resourceKind);
    if (!resource) errors.push(`required isolated resource is missing: ${resourceKind}`);
    else if (!resource.cleanup) errors.push(`required isolated resource has no cleanup receipt: ${resourceKind}`);
  }
  for (const kind of profile.requiredEvidence) {
    if (kind === "component-tarball" && meta.gate === "threeConvexConsumers") continue;
    if (!state.evidence.has(kind)) errors.push(`required evidence is missing: ${kind}`);
  }
  if (profile.browserResource && !state.screenshotManifest) errors.push("real browser screenshot manifest is not linked");
  return errors;
}

async function verifyReference(repoRoot, reference) {
  const record = await regularContainedFile(repoRoot, reference.path, `evidence ${reference.kind ?? reference.path}`);
  if (record.bytes.length !== reference.bytes || sha256(record.bytes) !== reference.sha256) throw new Error(`evidence bytes changed: ${reference.path}`);
}

async function verifyStateEvidence(repoRoot, meta, state) {
  const verifiedCandidate = await verifyManagedEvidenceCandidate({
    repoRoot,
    candidateProof: meta.candidate.candidateProof.path,
  });
  for (const field of ["nodekitCommit", "nodekitSourceHash", "nodekitIdentity", "packageName", "packageVersion"]) {
    if (verifiedCandidate.candidate[field] !== meta.candidate[field]) throw new Error(`candidate ${field} changed after campaign start`);
  }
  for (const field of ["sha256", "bytes", "canonicalManifestSha256"]) {
    if (verifiedCandidate.candidate.tarball[field] !== meta.candidate.tarball[field]) throw new Error(`candidate tarball ${field} changed after campaign start`);
  }
  for (const reference of state.evidence.values()) await verifyReference(repoRoot, reference);
  for (const resource of state.resources.values()) if (resource.cleanup) await verifyReference(repoRoot, resource.cleanup);
  if (state.screenshotManifest) {
    const manifestRecord = await regularContainedFile(repoRoot, state.screenshotManifest.reference.path, "browser screenshot manifest");
    const manifest = JSON.parse(manifestRecord.bytes.toString("utf8"));
    const closure = await resolveSubmissionEvidenceClosure(
      repoRoot,
      meta.gate,
      browserBindingValue(meta, state.screenshotManifest.reference, manifest, state.screenshotManifest.applicationCommit),
    );
    if (closure.length !== state.screenshotManifest.closureCount || sha256(canonicalBytes(closure)) !== state.screenshotManifest.closureSha256) {
      throw new Error("browser screenshot evidence closure changed after it was linked");
    }
  }
}

function publicResource(resource) {
  return {
    kind: resource.kind,
    provider: resource.provider,
    resourceId: resource.resourceId,
    environment: resource.environment,
    isolated: true,
    ...(resource.url ? { url: resource.url } : {}),
    cleanup: resource.cleanup,
  };
}

async function writeCheckpoint(repoRoot, paths, meta, eventRecord) {
  const { bytes, events } = eventRecord ?? await readEvents(paths, meta);
  const state = derive(events, meta);
  const errors = campaignReady(meta, state);
  const checkpoint = {
    schemaVersion: MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION,
    campaignId: meta.campaignId,
    gate: meta.gate,
    ...(meta.consumer ? { consumer: meta.consumer } : {}),
    candidate: meta.candidate,
    credentialPreflight: meta.credentialPreflight,
    status: events.at(-1).type === "campaign.ready" ? "ready-for-independent-review" : "active",
    startedAt: events[0].occurredAt,
    updatedAt: events.at(-1).occurredAt,
    elapsedMs: elapsedMs(events[0].occurredAt, events.at(-1).occurredAt),
    activePhase: state.activePhase?.name ?? null,
    phaseAttempts: state.phaseAttempts,
    resources: [...state.resources.values()].map(publicResource).sort((left, right) => left.kind.localeCompare(right.kind)),
    evidence: [
      ...(meta.gate === "threeConvexConsumers" ? [{ kind: "component-tarball", ...meta.candidate.tarball }] : []),
      ...state.evidence.values(),
    ].sort((left, right) => left.kind.localeCompare(right.kind)),
    screenshotManifest: state.screenshotManifest,
    readiness: { ready: errors.length === 0, errors },
    eventLog: {
      path: portablePath(repoRoot, paths.events, "event log path"),
      sha256: sha256(bytes),
      eventCount: events.length,
      lastEventSha256: events.at(-1).eventSha256,
    },
    externalAttestationRequired: true,
    submissionGateSatisfied: false,
  };
  await atomicCheckpoint(paths.checkpoint, prettyBytes(checkpoint));
  return { checkpoint, state };
}

async function loadCampaign({ repoRoot = process.cwd(), campaignId, gate, candidateCommit }) {
  const root = await resolveRepository(repoRoot);
  if (!COMMIT.test(candidateCommit ?? "")) throw new Error("candidateCommit must be a lowercase 40-character commit");
  const paths = campaignPaths(root, gate, candidateCommit, campaignId);
  const meta = await readMeta(paths);
  if (meta.candidate.nodekitCommit !== candidateCommit || meta.gate !== gate || meta.campaignId !== campaignId) throw new Error("campaign locator does not match its immutable metadata");
  const eventRecord = await readEvents(paths, meta);
  return { root, paths, meta, eventRecord };
}

export async function startManagedEvidenceCampaign({
  repoRoot = process.cwd(),
  gate,
  candidateProof,
  requiredEnvironmentVariables,
  environment = process.env,
  consumerId,
  consumerRoot,
  consumerCommit,
  clock,
} = {}) {
  requireProfile(gate);
  const verified = await verifyManagedEvidenceCandidate({ repoRoot, candidateProof });
  const credentialNames = validateCredentialNames(requiredEnvironmentVariables, environment);
  const consumer = gate === "threeConvexConsumers"
    ? await assertConsumerRepository({ consumerRoot, consumerCommit, consumerId })
    : null;
  if (gate !== "threeConvexConsumers" && (consumerId || consumerRoot || consumerCommit)) throw new Error("consumer arguments are only valid for threeConvexConsumers");
  const campaignId = `campaign_${randomBytes(12).toString("hex")}`;
  const paths = campaignPaths(verified.repoRoot, gate, verified.candidate.nodekitCommit, campaignId);
  await mkdir(paths.evidence, { recursive: true, mode: 0o700 });
  await mkdir(paths.cleanup, { recursive: true, mode: 0o700 });
  const startedAt = now(clock);
  const monotonicNs = monotonic(clock);
  const meta = {
    schemaVersion: "nodekit.managed-evidence-campaign-meta/v1",
    campaignId,
    gate,
    ...(consumer ? { consumer } : {}),
    candidate: verified.candidate,
    credentialPreflight: {
      requiredEnvironmentVariables: credentialNames,
      checkedAt: startedAt,
      allPresent: true,
      secretValuesRecorded: false,
    },
  };
  const first = sealEvent(eventBody({ meta, sequence: 1, type: "campaign.started", occurredAt: startedAt, monotonicNs, previousEventSha256: null, payload: { credentialNames, secretValuesRecorded: false } }));
  try {
    await exclusiveWrite(paths.meta, prettyBytes(meta));
    await exclusiveWrite(paths.events, Buffer.from(`${JSON.stringify(first)}\n`, "utf8"));
    const result = await writeCheckpoint(verified.repoRoot, paths, meta);
    return {
      campaignId,
      gate,
      candidateCommit: verified.candidate.nodekitCommit,
      candidateSourceHash: verified.candidate.nodekitSourceHash,
      candidateTarballSha256: verified.candidate.tarball.sha256,
      campaignPath: portablePath(verified.repoRoot, paths.checkpoint, "campaign path"),
      status: result.checkpoint.status,
      credentialNames,
      secretValuesRecorded: false,
    };
  } catch (error) {
    await rm(paths.directory, { recursive: true, force: true });
    throw error;
  }
}

async function mutateCampaign(locator, operation) {
  const loaded = await loadCampaign(locator);
  return withLock(loaded.paths, async () => {
    const freshEvents = await readEvents(loaded.paths, loaded.meta);
    const result = await operation({ ...loaded, eventRecord: freshEvents, events: freshEvents.events, state: derive(freshEvents.events, loaded.meta) });
    const checkpoint = await writeCheckpoint(loaded.root, loaded.paths, loaded.meta);
    return { ...result, campaign: checkpoint.checkpoint };
  });
}

export async function resumeManagedEvidenceCampaign(locator = {}) {
  return mutateCampaign(locator, async ({ paths, meta, events }) => {
    const event = await appendEvent(paths, meta, events, "campaign.resumed", {}, locator.clock);
    return { campaignId: meta.campaignId, sequence: event.sequence, resumedAt: event.occurredAt };
  });
}

export async function recordManagedEvidencePhase({ action, phase, outcome, ...locator } = {}) {
  if (!SAFE_PHASE.test(phase ?? "")) throw new Error("phase must be a lowercase hyphenated name");
  const profile = requireProfile(locator.gate);
  if (!profile.requiredPhases.includes(phase)) throw new Error(`phase is not part of ${locator.gate}: ${phase}`);
  if (!new Set(["start", "complete"]).has(action)) throw new Error("phase action must be start or complete");
  if (action === "complete" && !OUTCOMES.has(outcome)) throw new Error("phase completion outcome must be succeeded, failed, or cancelled");
  return mutateCampaign(locator, async ({ paths, meta, events, state }) => {
    if (action === "start") {
      if (state.activePhase) throw new Error(`phase ${state.activePhase.name} is already active`);
      const event = await appendEvent(paths, meta, events, "phase.started", { name: phase }, locator.clock);
      return { phase, action, attempt: state.phaseAttempts.filter((entry) => entry.name === phase).length + 1, sequence: event.sequence };
    }
    if (!state.activePhase || state.activePhase.name !== phase) throw new Error(`phase ${phase} is not active`);
    const completedAt = now(locator.clock);
    const monotonicCompletedNs = monotonic(locator.clock);
    if (Date.parse(completedAt) < Date.parse(events.at(-1).occurredAt)) {
      throw new Error("wall clock moved backwards; refusing to append phase timing evidence");
    }
    let durationMs;
    let timerSource;
    if (BigInt(monotonicCompletedNs) >= BigInt(state.activePhase.monotonicStartedNs)) {
      durationMs = Number(BigInt(monotonicCompletedNs) - BigInt(state.activePhase.monotonicStartedNs)) / 1_000_000;
      timerSource = "monotonic";
    } else {
      durationMs = elapsedMs(state.activePhase.startedAt, completedAt);
      timerSource = "wall-clock-after-host-restart";
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("phase timer is invalid");
    const event = sealEvent(eventBody({
      meta,
      sequence: events.length + 1,
      type: "phase.completed",
      occurredAt: completedAt,
      monotonicNs: monotonicCompletedNs,
      previousEventSha256: events.at(-1).eventSha256,
      payload: { name: phase, outcome, durationMs, timerSource },
    }));
    await appendFile(paths.events, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    return { phase, action, outcome, durationMs, timerSource, sequence: event.sequence };
  });
}

function normalizeHttpsUrl(value, label) {
  if (value === undefined) return undefined;
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label} must be a credential-free HTTPS origin or path without query or fragment`);
  return parsed.toString().replace(/\/$/u, "");
}

export async function recordManagedEvidenceResource({ kind, provider, resourceId, environment, isolated, url, ...locator } = {}) {
  const profile = requireProfile(locator.gate);
  if (!Object.hasOwn(profile.allowedResources, kind)) throw new Error(`resource kind is not allowed for ${locator.gate}: ${kind ?? "missing"}`);
  if (environment !== profile.allowedResources[kind]) throw new Error(`${kind} must use the isolated ${profile.allowedResources[kind]} environment`);
  if (isolated !== true) throw new Error("resource must be explicitly recorded as isolated=true");
  if (!SAFE_PROVIDER.test(provider ?? "")) throw new Error("provider is invalid");
  requireSafeId(resourceId, "resourceId");
  const normalizedUrl = normalizeHttpsUrl(url, "resource URL");
  if (kind === profile.browserResource && !normalizedUrl) throw new Error(`${kind} requires its public HTTPS URL for screenshot origin binding`);
  return mutateCampaign(locator, async ({ paths, meta, events, state }) => {
    if (state.resources.has(kind)) throw new Error(`resource kind was already recorded: ${kind}`);
    if ([...state.resources.values()].some((entry) => entry.provider === provider && entry.resourceId === resourceId)) throw new Error("the same managed resource ID cannot satisfy multiple resource roles");
    const payload = { kind, provider, resourceId, environment, isolated: true, ...(normalizedUrl ? { url: normalizedUrl } : {}) };
    const event = await appendEvent(paths, meta, events, "resource.recorded", payload, locator.clock);
    return { ...payload, sequence: event.sequence };
  });
}

function rejectSensitiveJson(value, breadcrumb = "$") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSensitiveJson(entry, `${breadcrumb}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const redactedOrNonSecretValue = entry === null
      || entry === ""
      || typeof entry === "boolean"
      || entry === "[REDACTED]"
      || entry === "<redacted>";
    if (isSecretLikeKey(key) && !redactedOrNonSecretValue) throw new Error(`evidence contains a non-redacted secret-like field at ${breadcrumb}.${key}`);
    rejectSensitiveJson(entry, `${breadcrumb}.${key}`);
  }
}

function inspectEvidenceForSecrets(bytes, extension, meta, environment) {
  if (TEXT_EXTENSIONS.has(extension)) {
    const text = bytes.toString("utf8");
    for (const name of meta.credentialPreflight.requiredEnvironmentVariables) {
      if (!isSecretLikeKey(name)) continue;
      const secret = environment[name];
      if (typeof secret === "string" && secret.length > 0 && text.includes(secret)) throw new Error(`evidence contains the value of credential ${name}`);
    }
    if (JSON_EXTENSIONS.has(extension)) {
      try {
        if (extension === ".jsonl") text.split(/\r?\n/u).filter(Boolean).forEach((line) => rejectSensitiveJson(JSON.parse(line)));
        else rejectSensitiveJson(JSON.parse(text));
      } catch (error) {
        if (String(error?.message ?? "").includes("secret-like")) throw error;
        throw new Error("JSON evidence is not valid JSON");
      }
    }
  }
}

function evidenceExtension(sourceFile) {
  const extension = path.extname(sourceFile).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/u.test(extension)) return ".bin";
  return extension;
}

async function importEvidenceFile({ root, paths, meta, events, state, kind, sourceFile, environment, clock, destinationDirectory = paths.evidence }) {
  if (typeof kind !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(kind)) throw new Error("evidence kind is invalid");
  if (state.evidence.has(kind)) throw new Error(`evidence kind was already imported: ${kind}`);
  validateCredentialNames(meta.credentialPreflight.requiredEnvironmentVariables, environment);
  const source = await realpath(path.resolve(sourceFile));
  const metadata = await stat(source);
  if (!metadata.isFile()) throw new Error("evidence source must be a regular file");
  const bytes = await readFile(source);
  if (bytes.length === 0) throw new Error("evidence source is empty");
  const extension = evidenceExtension(source);
  inspectEvidenceForSecrets(bytes, extension, meta, environment);
  const digest = sha256(bytes);
  const destination = path.join(destinationDirectory, `${kind}-${digest.slice(0, 16)}${extension}`);
  await writeIfMissingOrExact(destination, bytes);
  const reference = { kind, path: portablePath(root, destination, "evidence path"), sha256: digest, bytes: bytes.length };
  const event = await appendEvent(paths, meta, events, "evidence.imported", { kind, reference }, clock);
  return { reference, event };
}

async function verifyMatchingExternalEvidence({ sourceFile, expected, meta, environment }) {
  validateCredentialNames(meta.credentialPreflight.requiredEnvironmentVariables, environment);
  const source = await realpath(path.resolve(sourceFile));
  const metadata = await stat(source);
  if (!metadata.isFile()) throw new Error("evidence source must be a regular file");
  const bytes = await readFile(source);
  if (bytes.length === 0) throw new Error("evidence source is empty");
  inspectEvidenceForSecrets(bytes, evidenceExtension(source), meta, environment);
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error("cleanup retry does not match the previously recorded provider receipt");
  }
}

export async function importManagedEvidence({ kind, sourceFile, environment = process.env, ...locator } = {}) {
  const profile = requireProfile(locator.gate);
  if (!profile.requiredEvidence.includes(kind) || new Set(["component-tarball", "screenshot-manifest", "cleanup-receipt"]).has(kind)) throw new Error(`evidence kind must be imported by its dedicated command or is not required for ${locator.gate}: ${kind ?? "missing"}`);
  return mutateCampaign(locator, async ({ root, paths, meta, events, state }) => {
    const imported = await importEvidenceFile({ root, paths, meta, events, state, kind, sourceFile, environment, clock: locator.clock });
    return { ...imported.reference, sequence: imported.event.sequence };
  });
}

function browserBindingValue(meta, reference, manifest, applicationCommit) {
  const base = {
    nodekitCommit: meta.candidate.nodekitCommit,
    nodekitSourceHash: meta.candidate.nodekitSourceHash,
    nodekitIdentity: meta.candidate.nodekitIdentity,
    releaseCandidate: {
      nodekitCommit: meta.candidate.nodekitCommit,
      nodekitSourceHash: meta.candidate.nodekitSourceHash,
      nodekitTarballSha256: meta.candidate.tarball.sha256,
      packageName: meta.candidate.packageName,
      packageVersion: meta.candidate.packageVersion,
    },
    evidence: [reference],
  };
  if (meta.gate === "previewDeployment") return { ...base, deploymentCommit: applicationCommit, applicationHash: manifest.applicationHash, configHash: manifest.configHash };
  return {
    ...base,
    consumers: [{
      id: meta.consumer.id,
      consumerCommit: applicationCommit,
      evidence: [reference],
    }],
  };
}

export async function linkManagedBrowserManifest({ manifestPath, applicationCommit, ...locator } = {}) {
  if (!COMMIT.test(applicationCommit ?? "")) throw new Error("applicationCommit must be a lowercase 40-character commit");
  return mutateCampaign(locator, async ({ root, paths, meta, events, state }) => {
    const profile = requireProfile(meta.gate);
    if (!profile.browserResource) throw new Error(`${meta.gate} does not require browser screenshot evidence`);
    if (state.screenshotManifest) throw new Error("browser screenshot manifest is already linked");
    if (meta.consumer && applicationCommit !== meta.consumer.commit) throw new Error("consumer browser applicationCommit must equal the reviewed consumer commit");
    const resource = state.resources.get(profile.browserResource);
    if (!resource?.url) throw new Error(`record ${profile.browserResource} with its HTTPS URL before linking browser evidence`);
    const relative = requireCanonicalPath(manifestPath, "manifestPath");
    const record = await regularContainedFile(root, relative, "browser screenshot manifest");
    let manifest;
    try { manifest = JSON.parse(record.bytes.toString("utf8")); } catch { throw new Error("browser screenshot manifest is not JSON"); }
    if (manifest.generatedCandidateCommit !== applicationCommit) throw new Error("browser screenshot manifest application commit differs");
    const deploymentBase = new URL(resource.url);
    const expectedOrigin = deploymentBase.origin;
    const expectedBasePath = deploymentBase.pathname.replace(/\/$/u, "");
    if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0 || !manifest.screenshots.every((entry) => {
      try {
        const url = new URL(entry.pageUrl);
        const pathMatches = expectedBasePath === ""
          || url.pathname === expectedBasePath
          || url.pathname.startsWith(`${expectedBasePath}/`);
        return url.protocol === "https:" && url.origin === expectedOrigin && pathMatches;
      } catch { return false; }
    })) throw new Error("every browser screenshot must come from the recorded isolated HTTPS frontend origin and base path");
    const reference = { kind: "screenshot-manifest", path: relative, sha256: sha256(record.bytes), bytes: record.bytes.length };
    const closure = await resolveSubmissionEvidenceClosure(root, meta.gate, browserBindingValue(meta, reference, manifest, applicationCommit));
    const payload = {
      reference,
      applicationCommit,
      applicationHash: manifest.applicationHash,
      configHash: manifest.configHash,
      screenshotCount: manifest.screenshots.length,
      closureCount: closure.length,
      closureSha256: sha256(canonicalBytes(closure)),
      deploymentOrigin: expectedOrigin,
    };
    const event = await appendEvent(paths, meta, events, "browser-manifest.linked", payload, locator.clock);
    return { ...payload, sequence: event.sequence };
  });
}

export async function recordManagedEvidenceCleanup({ resourceKind, providerReceiptFile, environment = process.env, ...locator } = {}) {
  return mutateCampaign(locator, async ({ root, paths, meta, events, state }) => {
    const resource = state.resources.get(resourceKind);
    if (!resource) throw new Error(`resource has not been recorded: ${resourceKind ?? "missing"}`);
    const cleanupKind = `provider-cleanup-${resourceKind}`;
    let providerReceipt = state.evidence.get(cleanupKind);
    let sequence = events.at(-1).sequence;
    if (providerReceipt) {
      await verifyMatchingExternalEvidence({ sourceFile: providerReceiptFile, expected: providerReceipt, meta, environment });
    } else {
      const cleanupState = { ...state, evidence: new Map(state.evidence) };
      const imported = await importEvidenceFile({
        root,
        paths,
        meta,
        events,
        state: cleanupState,
        kind: cleanupKind,
        sourceFile: providerReceiptFile,
        environment,
        clock: locator.clock,
        destinationDirectory: paths.cleanup,
      });
      providerReceipt = imported.reference;
      sequence = imported.event.sequence;
    }
    if (!resource.cleanup) {
      const refreshed = await readEvents(paths, meta);
      const event = await appendEvent(paths, meta, refreshed.events, "resource.cleaned", { kind: resourceKind, receipt: providerReceipt }, locator.clock);
      sequence = event.sequence;
    } else if (resource.cleanup.sha256 !== providerReceipt.sha256 || resource.cleanup.path !== providerReceipt.path || resource.cleanup.bytes !== providerReceipt.bytes) {
      throw new Error("resource cleanup does not match its imported provider receipt");
    }
    const nextRecord = await readEvents(paths, meta);
    const nextState = derive(nextRecord.events, meta);
    const allCleaned = [...nextState.resources.values()].length > 0 && [...nextState.resources.values()].every((entry) => entry.cleanup);
    let aggregate = null;
    if (allCleaned && !nextState.evidence.has("cleanup-receipt")) {
      const completedAt = nextRecord.events.at(-1).occurredAt;
      const cleanupReceipt = {
        schemaVersion: MANAGED_EVIDENCE_CLEANUP_SCHEMA_VERSION,
        campaignId: meta.campaignId,
        gate: meta.gate,
        candidate: {
          nodekitCommit: meta.candidate.nodekitCommit,
          nodekitSourceHash: meta.candidate.nodekitSourceHash,
          nodekitTarballSha256: meta.candidate.tarball.sha256,
        },
        completedAt,
        resources: [...nextState.resources.values()].map((entry) => ({
          kind: entry.kind,
          provider: entry.provider,
          resourceId: entry.resourceId,
          environment: entry.environment,
          providerReceipt: entry.cleanup,
          cleanupRecorded: true,
        })).sort((left, right) => left.kind.localeCompare(right.kind)),
        cleanupRecorded: true,
        externalVerificationRequired: true,
        submissionGateSatisfied: false,
      };
      const bytes = prettyBytes(cleanupReceipt);
      const destination = path.join(paths.evidence, "cleanup-receipt.json");
      await writeIfMissingOrExact(destination, bytes);
      const reference = { kind: "cleanup-receipt", path: portablePath(root, destination, "cleanup receipt path"), sha256: sha256(bytes), bytes: bytes.length };
      const withResourceCleanup = await readEvents(paths, meta);
      await appendEvent(paths, meta, withResourceCleanup.events, "evidence.imported", { kind: "cleanup-receipt", reference }, locator.clock);
      aggregate = reference;
    }
    return { resourceKind, providerReceipt, aggregateCleanupReceipt: aggregate ?? nextState.evidence.get("cleanup-receipt") ?? null, allResourcesCleaned: allCleaned, sequence };
  });
}

export async function getManagedEvidenceCampaign(locator = {}) {
  const loaded = await loadCampaign(locator);
  const state = derive(loaded.eventRecord.events, loaded.meta);
  await verifyStateEvidence(loaded.root, loaded.meta, state);
  const result = await writeCheckpoint(loaded.root, loaded.paths, loaded.meta, loaded.eventRecord);
  return result.checkpoint;
}

export async function finalizeManagedEvidenceCampaign(locator = {}) {
  return mutateCampaign(locator, async ({ root, paths, meta, events, state }) => {
    const errors = campaignReady(meta, state);
    if (errors.length > 0) throw new Error(`campaign is not ready:\n- ${errors.join("\n- ")}`);
    await verifyStateEvidence(root, meta, state);
    const readyEvent = events.at(-1)?.type === "campaign.ready"
      ? events.at(-1)
      : await appendEvent(paths, meta, events, "campaign.ready", { externalAttestationRequired: true, submissionGateSatisfied: false }, locator.clock);
    const finalRecord = await readEvents(paths, meta);
    const finalState = derive(finalRecord.events, meta);
    const receipt = {
      schemaVersion: MANAGED_EVIDENCE_RECEIPT_SCHEMA_VERSION,
      campaignId: meta.campaignId,
      gate: meta.gate,
      ...(meta.consumer ? { consumer: meta.consumer } : {}),
      candidate: meta.candidate,
      credentialPreflight: meta.credentialPreflight,
      startedAt: finalRecord.events[0].occurredAt,
      completedAt: readyEvent.occurredAt,
      durationMs: elapsedMs(finalRecord.events[0].occurredAt, readyEvent.occurredAt),
      phaseAttempts: finalState.phaseAttempts,
      resources: [...finalState.resources.values()].map(publicResource).sort((left, right) => left.kind.localeCompare(right.kind)),
      evidence: [
        ...(meta.gate === "threeConvexConsumers" ? [{ kind: "component-tarball", ...meta.candidate.tarball }] : []),
        ...finalState.evidence.values(),
      ].sort((left, right) => left.kind.localeCompare(right.kind)),
      screenshotManifest: finalState.screenshotManifest,
      eventLog: {
        path: portablePath(root, paths.events, "event log path"),
        sha256: sha256(finalRecord.bytes),
        eventCount: finalRecord.events.length,
        lastEventSha256: readyEvent.eventSha256,
      },
      status: "ready-for-independent-review",
      externalAttestationRequired: true,
      submissionGateSatisfied: false,
      publicationPerformed: false,
      deploymentPerformedByCaptureTool: false,
    };
    const receiptBytes = prettyBytes(receipt);
    await writeIfMissingOrExact(paths.receipt, receiptBytes);
    return {
      campaignId: meta.campaignId,
      status: receipt.status,
      receiptPath: portablePath(root, paths.receipt, "campaign receipt path"),
      receiptSha256: sha256(receiptBytes),
      externalAttestationRequired: true,
      submissionGateSatisfied: false,
    };
  });
}
