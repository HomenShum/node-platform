import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";
import {
  ingestEvidenceBytes,
  readContainedEvidenceFile,
  readEvidenceSnapshot,
  verifyEvidenceSnapshot,
} from "./evidence-snapshots.mjs";
import { FRONTEND_REQUIRED_GUARDRAILS, FRONTEND_REQUIRED_STATES } from "./frontend-specialist.mjs";

export const ATLAS_EXPERIENCE_ASSET_SCHEMA = "nodekit.experience-asset/v1";
export const ATLAS_INTERACTION_FLOW_SCHEMA = "nodekit.interaction-flow/v1";

const ATLAS_STORE = ".nodeagent/atlas";
const ASSET_SCHEMA_FILE = "nodekit.experience-asset.v1.schema.json";
const FLOW_SCHEMA_FILE = "nodekit.interaction-flow.v1.schema.json";
const MAXIMUM_RECORDS = 2000;
const MAXIMUM_RECORD_BYTES = 1024 * 1024;
const ASSET_FILENAME = /^asset_[a-f0-9]{24}\.json$/;
const FLOW_FILENAME = /^flow_[a-f0-9]{24}\.json$/;

// LOCK 2 of nodekit.experience-asset.v1: the only SPDX identifiers whose bytes Atlas will store.
const VENDORABLE_LICENSES = Object.freeze([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);
// Reuse modes that are structurally incapable of carrying bytes (LOCK 1).
const REFERENCE_REUSE_MODES = Object.freeze(["reference", "benchmark"]);
// Reuse modes that vendor upstream bytes and therefore record source.vendored (LOCK 2).
const VENDORING_REUSE_MODES = Object.freeze(["copy", "wrap", "adapt"]);
// Third-party product captures may never be vendored (LOCK 3).
const CAPTURE_ORIGINS = Object.freeze(["mobbin", "external-web"]);

const OBSERVATION_MEDIA_TYPES = new Map([
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".pdf", "application/pdf"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
]);
// $defs/storableMediaType has exactly four entries; a .css or .tsx file is stored as text/plain.
const STORABLE_MEDIA_TYPES = new Map([
  [".md", "text/markdown"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".json", "application/json"],
]);

const ASSET_DRAFT_FIELDS = new Set([
  "kind",
  "version",
  "title",
  "summary",
  "intent",
  "source",
  "implementation",
  "behavior",
  "integration",
  "knownLimitations",
]);
const ASSET_DRAFT_SOURCE_FIELDS = new Set(["origin", "reuseMode", "upstreamUrl", "observedAt", "sourceVersion", "license"]);
const FLOW_DRAFT_FIELDS = new Set(["version", "title", "user", "nodes", "transitions", "authority", "knownLimitations"]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function sha256Utf8(value) {
  return createHash("sha256").update(Buffer.from(String(value), "utf8")).digest("hex");
}

async function validateOrThrow(schema, value, label) {
  const findings = await validateSchema(schema, value, label);
  if (findings.length > 0) throw new Error(`${label} validation failed:\n${findings.join("\n")}`);
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function containedPath(repoRoot, candidate, label) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, String(candidate));
  if (!isContained(root, absolute)) throw new Error(`${label} must stay inside the repository: ${candidate}`);
  return { root, absolute, relative: normalizePath(path.relative(root, absolute)) };
}

async function existingStat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureSecureDirectory(root, directory, label) {
  if (!isContained(root, directory)) throw new Error(`${label} escapes the repository`);
  const relative = path.relative(root, directory);
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const status = await existingStat(current);
    if (status) {
      if (status.isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link: ${normalizePath(path.relative(root, current))}`);
      if (!status.isDirectory()) throw new Error(`${label} path is not a directory: ${normalizePath(path.relative(root, current))}`);
      continue;
    }
    await mkdir(current);
  }
}

function atlasStore(repoRoot) {
  const store = containedPath(repoRoot, ATLAS_STORE, "atlas store");
  return {
    root: store.root,
    absolute: store.absolute,
    assets: path.join(store.absolute, "assets"),
    flows: path.join(store.absolute, "flows"),
  };
}

/**
 * The snapshot id evidence-snapshots.mjs will mint for these inputs. Atlas derives it BEFORE
 * ingesting so a re-add of unchanged bytes can reuse the existing snapshot: ingestEvidenceBytes
 * throws `duplicate evidence snapshot` rather than no-opping.
 */
function deriveObservationSnapshotId(sourceUri, capturedAt, rawSha256) {
  return `evidence_${hash({ sourceUri, capturedAt, rawSha256 }).slice(0, 24)}`;
}

function canonicalTimestamp(value, label) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) {
    throw new Error(`${label} must be a canonical ISO timestamp such as 2026-07-22T00:00:00.000Z`);
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== text) throw new Error(`${label} is not a real instant: ${text}`);
  return text;
}

function requireFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.sort().join(", ")}`);
}

function mediaTypeFor(relativePath, table, fallback) {
  return table.get(path.extname(relativePath).toLowerCase()) ?? fallback;
}

async function storeSnapshot(repoRoot, sourceFile, sourceUri, capturedAt, mediaTypeTable, fallbackMediaType, label) {
  const { bytes, relativePath } = await readContainedEvidenceFile(repoRoot, sourceFile);
  if (bytes.length === 0) throw new Error(`${label} cannot be empty: ${relativePath}`);
  const rawSha256 = createHash("sha256").update(bytes).digest("hex");
  const mediaType = mediaTypeFor(relativePath, mediaTypeTable, fallbackMediaType);
  const snapshotId = deriveObservationSnapshotId(sourceUri, capturedAt, rawSha256);
  const metadata = path.join(path.resolve(repoRoot), ".nodeagent", "evidence", "snapshots", `${snapshotId}.json`);
  const existing = await existingStat(metadata);
  const snapshot = existing
    ? await readEvidenceSnapshot(repoRoot, snapshotId)
    : await ingestEvidenceBytes(repoRoot, { bytes, sourceUri, mediaType, capturedAt, expectedSha256: rawSha256 });
  if (snapshot.raw.sha256 !== rawSha256) throw new Error(`${label} snapshot does not match the supplied bytes`);
  if (snapshot.snapshotId !== snapshotId) throw new Error(`${label} snapshot id derivation drifted from evidence-snapshots`);
  return { snapshot, relativePath, mediaType, reused: Boolean(existing) };
}

/**
 * LOCK 1 in schema form, expressed as code: this builder has no parameter through which bytes can
 * reach the record. A reference-only asset therefore cannot carry vendored source bytes even if a
 * caller supplies them, because there is no code path from a file to this return value.
 */
function buildReferenceImplementation() {
  return {
    framework: "none",
    language: "none",
    exports: [],
    dependencies: [],
    propSchema: {},
    tokenContract: {},
    files: [],
    backendNeutral: true,
  };
}

function buildVendoredImplementation(draft, files) {
  return {
    framework: draft.framework,
    language: draft.language,
    entryPoint: files[0].path,
    exports: draft.exports ?? [],
    dependencies: draft.dependencies ?? [],
    propSchema: draft.propSchema ?? {},
    tokenContract: draft.tokenContract ?? {},
    files,
    backendNeutral: true,
  };
}

function accessibilityLevel(receipts) {
  return receipts?.accessibility?.level ?? "unknown";
}

/**
 * Maturity is DERIVED from what Atlas itself verified, never declared by the draft. `atlas add`
 * verifies bytes only, so it can reach `extracted` and no further; vetted/proven/certified require
 * receipt bindings this verb cannot mint.
 */
function deriveAssetMaturity(files) {
  return files.length > 0 ? "extracted" : "discovered";
}

export function deriveAssetId(source, kind, version) {
  return `asset_${hash({ origin: source.origin, upstreamUrlSha256: source.upstreamUrlSha256, kind, version }).slice(0, 24)}`;
}

export function deriveAssetCard(asset) {
  const tags = [];
  for (const tag of [...asset.intent.artifactKinds, ...asset.intent.supportedDomains]) {
    if (tags.length >= 8) break;
    if (tag.length >= 2 && tag.length <= 24 && !tags.includes(tag)) tags.push(tag);
  }
  return {
    assetId: asset.assetId,
    version: asset.version,
    kind: asset.kind,
    title: asset.title,
    framework: asset.implementation.framework,
    maturity: asset.quality.maturity,
    a11y: accessibilityLevel(asset.quality.receipts),
    mobile: asset.behavior.mobileStrategy,
    deps: asset.implementation.dependencies.length,
    tags,
  };
}

export function deriveFlowId(flow) {
  return `flow_${hash({
    title: flow.title,
    user: flow.user,
    version: flow.version,
    nodes: flow.nodes.map((node) => node.nodeId),
    transitions: flow.transitions.map((transition) => [transition.from, transition.to, transition.action]),
  }).slice(0, 24)}`;
}

export function deriveFlowCoverage(nodes, transitions) {
  const nodeIds = nodes.map((node) => node.nodeId);
  const inbound = new Map(nodeIds.map((id) => [id, 0]));
  const outbound = new Map(nodeIds.map((id) => [id, 0]));
  for (const transition of transitions) {
    if (inbound.has(transition.to)) inbound.set(transition.to, inbound.get(transition.to) + 1);
    if (outbound.has(transition.from)) outbound.set(transition.from, outbound.get(transition.from) + 1);
  }
  const starts = nodeIds.filter((id) => inbound.get(id) === 0);
  const terminals = nodeIds.filter((id) => outbound.get(id) === 0);
  const covered = FRONTEND_REQUIRED_STATES.filter((state) => nodes.some((node) => node.productStage === state));
  const missing = FRONTEND_REQUIRED_STATES.filter((state) => !covered.includes(state));
  return {
    requiredStates: [...FRONTEND_REQUIRED_STATES],
    coveredStates: covered,
    missingStates: missing,
    startNodeId: starts.length === 1 ? starts[0] : null,
    terminalNodeIds: terminals,
    complete: missing.length === 0,
    starts,
  };
}

export function deriveFlowCard(flow) {
  return {
    flowId: flow.flowId,
    version: flow.version,
    title: flow.title,
    role: flow.user.role,
    nodeCount: flow.nodes.length,
    transitionCount: flow.transitions.length,
    approvalGates: flow.transitions.filter((transition) => transition.approvalRequired === true).length,
    stateCoverage: `${flow.coverage.coveredStates.length}/9`,
    maturity: flow.quality.maturity,
    tags: [],
  };
}

function reachableNodeIds(startNodeId, transitions) {
  const adjacency = new Map();
  for (const transition of transitions) {
    if (!adjacency.has(transition.from)) adjacency.set(transition.from, []);
    adjacency.get(transition.from).push(transition.to);
  }
  const seen = new Set([startNodeId]);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

export function validateExperienceAssetDocument(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["experience asset must be an object"];
  if (value.schemaVersion !== ATLAS_EXPERIENCE_ASSET_SCHEMA) errors.push(`experience asset schemaVersion must be ${ATLAS_EXPERIENCE_ASSET_SCHEMA}`);
  const source = value.source;
  const implementation = value.implementation;
  if (!source || !implementation || !value.intent || !value.behavior || !value.quality) {
    return errors.concat("experience asset is missing required sections");
  }
  if (source.upstreamUrlSha256 !== sha256Utf8(source.upstreamUrl)) errors.push("source.upstreamUrlSha256 is not the SHA-256 of source.upstreamUrl");
  if (source.observationSourceUri !== `https://nodekit.local/atlas/observation/${source.upstreamUrlSha256}`) {
    errors.push("source.observationSourceUri is not bound to source.upstreamUrlSha256");
  }
  const expectedAssetId = deriveAssetId(source, value.kind, value.version);
  if (value.assetId !== expectedAssetId) errors.push(`assetId is not derived from its origin, upstream url, kind, and version: expected ${expectedAssetId}`);
  const body = structuredClone(value);
  delete body.assetHash;
  if (value.assetHash !== hash(body)) errors.push("assetHash does not match the recorded document");
  if (canonical(value.card) !== canonical(deriveAssetCard(value))) errors.push("card is not derived from the asset document");
  const stages = value.intent.productStages ?? [];
  const states = value.behavior.states ?? [];
  const uncovered = stages.filter((stage) => !states.includes(stage));
  if (uncovered.length) errors.push(`behavior.states does not cover intent.productStages: ${uncovered.join(", ")}`);
  const reintroduced = [...(value.intent.artifactKinds ?? []), ...(value.intent.supportedDomains ?? []), ...(value.intent.aliases ?? [])]
    .filter((tag) => FRONTEND_REQUIRED_GUARDRAILS.includes(tag));
  if (reintroduced.length) errors.push(`asset advertises a prohibited anti-pattern: ${reintroduced.join(", ")}`);
  if (REFERENCE_REUSE_MODES.includes(source.reuseMode)) {
    if (source.vendored !== undefined) errors.push("a reference-only asset cannot record vendored bytes");
    if ((implementation.files ?? []).length > 0) errors.push("a reference-only asset cannot record implementation files");
    if (implementation.entryPoint !== undefined) errors.push("a reference-only asset cannot record an entryPoint");
  }
  if (VENDORING_REUSE_MODES.includes(source.reuseMode)) {
    if (!source.vendored) errors.push(`reuseMode ${source.reuseMode} requires source.vendored`);
    if (!VENDORABLE_LICENSES.includes(source.license?.identifier)) errors.push(`reuseMode ${source.reuseMode} requires a redistributable SPDX identifier`);
    if ((implementation.files ?? []).length === 0) errors.push(`reuseMode ${source.reuseMode} requires at least one stored file`);
  }
  if (CAPTURE_ORIGINS.includes(source.origin) && !REFERENCE_REUSE_MODES.includes(source.reuseMode)) {
    errors.push(`origin ${source.origin} may only be referenced or benchmarked against, never vendored`);
  }
  if (source.reuseMode === "reimplement") {
    if (source.origin !== "nodekit-internal") errors.push("a reimplementation must declare origin nodekit-internal");
    if (source.vendored !== undefined) errors.push("a reimplementation ships our bytes and must not vendor theirs");
  }
  if (deriveAssetMaturity(implementation.files ?? []) !== value.quality.maturity && Object.keys(value.quality.receipts ?? {}).length === 0) {
    errors.push("quality.maturity is not derived from the bytes Atlas verified");
  }
  return errors;
}

export function validateInteractionFlowDocument(value, assetIndex = null) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["interaction flow must be an object"];
  if (value.schemaVersion !== ATLAS_INTERACTION_FLOW_SCHEMA) errors.push(`interaction flow schemaVersion must be ${ATLAS_INTERACTION_FLOW_SCHEMA}`);
  const nodes = value.nodes ?? [];
  const transitions = value.transitions ?? [];
  if (nodes.length === 0 || transitions.length === 0) return errors.concat("interaction flow requires nodes and transitions");
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  if (nodeIds.size !== nodes.length) errors.push("interaction flow contains duplicate nodeIds");
  for (const transition of transitions) {
    if (!nodeIds.has(transition.from)) errors.push(`transition names an unknown source node: ${transition.from}`);
    if (!nodeIds.has(transition.to)) errors.push(`transition names an unknown target node: ${transition.to}`);
    if (transition.effect === "approve" && transition.approvalRequired !== true) errors.push(`transition ${transition.action} approves canonical state without an approval gate`);
  }
  const derived = deriveFlowCoverage(nodes, transitions);
  if (derived.startNodeId === null) errors.push(`interaction flow must have exactly one entry node, found ${derived.starts.length}`);
  if (derived.terminalNodeIds.length === 0) errors.push("interaction flow must have at least one terminal node");
  for (const node of nodes) {
    if (!["exception", "conflict", "failed_safe"].includes(node.productStage)) continue;
    if (derived.terminalNodeIds.includes(node.nodeId)) errors.push(`failure state ${node.nodeId} is a dead end with no recovery transition`);
  }
  if (derived.startNodeId !== null) {
    const reachable = reachableNodeIds(derived.startNodeId, transitions);
    const unreachable = [...nodeIds].filter((id) => !reachable.has(id));
    if (unreachable.length) errors.push(`unreachable nodes: ${unreachable.sort().join(", ")}`);
  }
  const expectedCoverage = {
    requiredStates: derived.requiredStates,
    coveredStates: derived.coveredStates,
    missingStates: derived.missingStates,
    startNodeId: derived.startNodeId,
    terminalNodeIds: derived.terminalNodeIds,
    complete: derived.complete,
  };
  if (canonical(value.coverage) !== canonical(expectedCoverage)) errors.push("coverage is not derived from the nodes and transitions");
  const expectedFlowId = deriveFlowId(value);
  if (value.flowId !== expectedFlowId) errors.push(`flowId is not derived from its title, user, nodes, and transitions: expected ${expectedFlowId}`);
  const body = structuredClone(value);
  delete body.flowHash;
  if (value.flowHash !== hash(body)) errors.push("flowHash does not match the recorded document");
  if (canonical(value.card) !== canonical(deriveFlowCard(value))) errors.push("card is not derived from the flow document");
  const surfaceIds = new Set(nodes.flatMap((node) => node.surfaceAssetIds ?? []));
  const boundIds = new Set((value.assetBindings ?? []).map((binding) => binding.assetId));
  for (const surfaceId of surfaceIds) {
    if (!boundIds.has(surfaceId)) errors.push(`surface ${surfaceId} is not present in assetBindings`);
  }
  if (assetIndex === null) {
    if (surfaceIds.size > 0 || boundIds.size > 0) errors.push("interaction flow validation requires an asset index to authenticate its bindings");
    return errors;
  }
  for (const binding of value.assetBindings ?? []) {
    const record = assetIndex.get(binding.assetId);
    if (!record) {
      errors.push(`assetBindings names an asset that is not registered: ${binding.assetId}`);
      continue;
    }
    if (record.assetHash !== binding.assetHash) errors.push(`assetBindings for ${binding.assetId} is bound to bytes that moved`);
    if (record.version !== binding.assetVersion) errors.push(`assetBindings for ${binding.assetId} is bound to version ${binding.assetVersion} but ${record.version} is registered`);
    if (REFERENCE_REUSE_MODES.includes(record.source?.reuseMode) && surfaceIds.has(binding.assetId)) {
      errors.push(`reference-only asset ${binding.assetId} cannot be bound as a rendered surface`);
    }
  }
  return errors;
}

export async function initializeAtlasStore(repoRoot) {
  const store = atlasStore(repoRoot);
  await ensureSecureDirectory(store.root, store.assets, "atlas asset directory");
  await ensureSecureDirectory(store.root, store.flows, "atlas flow directory");
  return {
    atlasRoot: normalizePath(path.relative(store.root, store.absolute)),
    assetDirectory: normalizePath(path.relative(store.root, store.assets)),
    flowDirectory: normalizePath(path.relative(store.root, store.flows)),
  };
}

async function writeAtlasRecord(repoRoot, directory, filename, record, volatileFields, label) {
  const store = atlasStore(repoRoot);
  await ensureSecureDirectory(store.root, directory, `${label} directory`);
  const target = path.join(directory, filename);
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return { duplicate: false, output: normalizePath(path.relative(store.root, target)) };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = JSON.parse(await readFile(target, "utf8"));
  const stripped = (value) => {
    const copy = structuredClone(value);
    for (const field of volatileFields) delete copy[field];
    return canonical(copy);
  };
  if (stripped(existing) !== stripped(record)) {
    throw new Error(`atlas records are immutable; register a new version instead of overwriting ${filename}`);
  }
  return { duplicate: true, output: normalizePath(path.relative(store.root, target)) };
}

export async function addAtlasAsset(repoRoot, input) {
  const root = path.resolve(repoRoot);
  const draftPath = containedPath(root, input.assetFile, "atlas asset draft");
  const draft = await readYaml(draftPath.absolute);
  requireFields(draft, ASSET_DRAFT_FIELDS, "atlas asset draft");
  requireFields(draft.source, ASSET_DRAFT_SOURCE_FIELDS, "atlas asset draft source");
  for (const field of ["kind", "title", "summary", "intent", "source", "implementation", "behavior", "integration"]) {
    if (draft[field] === undefined) throw new Error(`atlas asset draft is missing ${field}`);
  }
  const version = draft.version ?? 1;
  const reuseMode = String(draft.source.reuseMode ?? "");
  const origin = String(draft.source.origin ?? "");
  const observedAt = canonicalTimestamp(draft.source.observedAt, "atlas asset draft source.observedAt");

  if (REFERENCE_REUSE_MODES.includes(reuseMode) && input.vendorFile) {
    throw new Error("reference-only assets cannot vendor upstream bytes");
  }
  if (CAPTURE_ORIGINS.includes(origin) && !REFERENCE_REUSE_MODES.includes(reuseMode)) {
    throw new Error(`origin ${origin} may only be referenced or benchmarked against, never vendored`);
  }
  if (!REFERENCE_REUSE_MODES.includes(reuseMode) && !input.vendorFile) {
    throw new Error(`reuseMode ${reuseMode} requires --vendor <path> naming the bytes to store`);
  }
  if (VENDORING_REUSE_MODES.includes(reuseMode) && !VENDORABLE_LICENSES.includes(draft.source.license?.identifier)) {
    throw new Error(`reuseMode ${reuseMode} requires a redistributable SPDX identifier, not ${draft.source.license?.identifier}`);
  }
  if (reuseMode === "adapt" && !/^[a-f0-9]{64}$/.test(String(input.derivedFromSha256 ?? ""))) {
    throw new Error("reuseMode adapt requires --derived-from <sha256> naming the exact upstream bytes");
  }
  if (draft.source.license?.attributionRequired === true && !input.noticeFile) {
    throw new Error("an attribution-required license must name a committed notice file via --notice <path>");
  }

  const upstreamUrlSha256 = sha256Utf8(draft.source.upstreamUrl);
  const observationSourceUri = `https://nodekit.local/atlas/observation/${upstreamUrlSha256}`;
  const observation = await storeSnapshot(
    root,
    input.observationFile,
    observationSourceUri,
    observedAt,
    OBSERVATION_MEDIA_TYPES,
    "text/plain",
    "atlas observation",
  );

  let noticeRef;
  if (input.noticeFile) {
    const notice = containedPath(root, input.noticeFile, "atlas license notice");
    if (!(await existingStat(notice.absolute))) throw new Error(`atlas license notice does not exist: ${notice.relative}`);
    noticeRef = notice.relative;
  }

  const source = {
    origin,
    reuseMode,
    upstreamUrl: String(draft.source.upstreamUrl),
    upstreamUrlSha256,
    ...(draft.source.sourceVersion ? { sourceVersion: String(draft.source.sourceVersion) } : {}),
    observedAt,
    observationSnapshotId: observation.snapshot.snapshotId,
    observationSourceUri,
    license: {
      identifier: String(draft.source.license.identifier),
      attributionRequired: draft.source.license.attributionRequired === true,
      redistributable: draft.source.license.redistributable === true,
      ...(noticeRef ? { noticeRef } : {}),
    },
  };

  let implementation;
  if (REFERENCE_REUSE_MODES.includes(reuseMode)) {
    // No bytes reach this branch: buildReferenceImplementation takes no byte parameter at all.
    implementation = buildReferenceImplementation();
  } else {
    const vendored = await storeSnapshot(
      root,
      input.vendorFile,
      `${observationSourceUri}/bytes`,
      observedAt,
      STORABLE_MEDIA_TYPES,
      "text/plain",
      "atlas vendored source",
    );
    const files = [{
      path: vendored.relativePath,
      sha256: vendored.snapshot.raw.sha256,
      byteLength: vendored.snapshot.raw.byteLength,
      mediaType: vendored.mediaType,
      snapshotId: vendored.snapshot.snapshotId,
      blobPath: vendored.snapshot.raw.blobPath,
    }];
    implementation = buildVendoredImplementation(draft.implementation, files);
    if (VENDORING_REUSE_MODES.includes(reuseMode)) {
      source.vendored = {
        snapshotId: vendored.snapshot.snapshotId,
        sha256: vendored.snapshot.raw.sha256,
        byteLength: vendored.snapshot.raw.byteLength,
        mediaType: vendored.mediaType,
        repositoryPath: vendored.relativePath,
        ...(reuseMode === "adapt" ? { derivedFromSha256: String(input.derivedFromSha256) } : {}),
      };
    }
  }

  const asset = {
    schemaVersion: ATLAS_EXPERIENCE_ASSET_SCHEMA,
    assetId: deriveAssetId(source, draft.kind, version),
    version,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    intent: {
      userJob: draft.intent.userJob,
      productStages: draft.intent.productStages,
      artifactKinds: draft.intent.artifactKinds,
      supportedDomains: draft.intent.supportedDomains,
      aliases: draft.intent.aliases ?? [],
    },
    source,
    implementation,
    behavior: {
      states: draft.behavior.states,
      actions: draft.behavior.actions ?? [],
      events: draft.behavior.events ?? [],
      keyboardOperations: draft.behavior.keyboardOperations ?? [],
      mobileStrategy: draft.behavior.mobileStrategy,
      visibleUncertainty: draft.behavior.visibleUncertainty === true,
      reintroducesGuardrails: [],
    },
    integration: {
      requiredPorts: draft.integration.requiredPorts ?? [],
      caseflowBindings: draft.integration.caseflowBindings ?? [],
      nodeAgentBindings: draft.integration.nodeAgentBindings ?? [],
    },
    quality: { maturity: deriveAssetMaturity(implementation.files), receipts: {} },
    card: null,
    previewRefs: [],
    knownLimitations: draft.knownLimitations ?? [],
    recordedAt: new Date().toISOString(),
    assetHash: null,
  };
  asset.card = deriveAssetCard(asset);
  delete asset.assetHash;
  asset.assetHash = hash(asset);

  await validateOrThrow(ASSET_SCHEMA_FILE, asset, "experience asset");
  const errors = validateExperienceAssetDocument(asset);
  if (errors.length) throw new Error(`experience asset validation failed:\n${errors.join("\n")}`);

  const store = atlasStore(root);
  const written = await writeAtlasRecord(root, store.assets, `${asset.assetId}.json`, asset, ["recordedAt", "assetHash"], "atlas asset");
  return { asset, duplicate: written.duplicate, observationReused: observation.reused, output: written.output };
}

export async function addAtlasFlow(repoRoot, input) {
  const root = path.resolve(repoRoot);
  const draftPath = containedPath(root, input.flowFile, "atlas flow draft");
  const draft = await readYaml(draftPath.absolute);
  requireFields(draft, FLOW_DRAFT_FIELDS, "atlas flow draft");
  for (const field of ["title", "user", "nodes", "transitions", "authority"]) {
    if (draft[field] === undefined) throw new Error(`atlas flow draft is missing ${field}`);
  }
  const assets = await listAtlasRecords(root);
  const assetIndex = new Map(assets.assets.map((asset) => [asset.assetId, asset]));
  const surfaceIds = [...new Set(draft.nodes.flatMap((node) => node.surfaceAssetIds ?? []))].sort();
  const assetBindings = surfaceIds.map((assetId) => {
    const record = assetIndex.get(assetId);
    if (!record) throw new Error(`atlas flow draft names an asset that is not registered: ${assetId}`);
    return { assetId, assetVersion: record.version, assetHash: record.assetHash };
  });

  const coverage = deriveFlowCoverage(draft.nodes, draft.transitions);
  const flow = {
    schemaVersion: ATLAS_INTERACTION_FLOW_SCHEMA,
    flowId: null,
    version: draft.version ?? 1,
    title: draft.title,
    user: { role: draft.user.role, primaryJob: draft.user.primaryJob },
    nodes: draft.nodes,
    transitions: draft.transitions,
    authority: {
      read: draft.authority.read,
      propose: draft.authority.propose,
      approve: draft.authority.approve,
      prohibited: draft.authority.prohibited,
      proofGateMutable: false,
      completionClaimAllowed: false,
    },
    coverage: {
      requiredStates: coverage.requiredStates,
      coveredStates: coverage.coveredStates,
      missingStates: coverage.missingStates,
      startNodeId: coverage.startNodeId,
      terminalNodeIds: coverage.terminalNodeIds,
      complete: coverage.complete,
    },
    assetBindings,
    quality: { maturity: "discovered", receipts: {} },
    card: null,
    knownLimitations: draft.knownLimitations ?? [],
    recordedAt: new Date().toISOString(),
    flowHash: null,
  };
  if (coverage.startNodeId === null) {
    throw new Error(`atlas flow must have exactly one entry node, found ${coverage.starts.length}`);
  }
  delete flow.flowId;
  flow.flowId = deriveFlowId(flow);
  flow.card = deriveFlowCard(flow);
  delete flow.flowHash;
  flow.flowHash = hash(flow);

  await validateOrThrow(FLOW_SCHEMA_FILE, flow, "interaction flow");
  const errors = validateInteractionFlowDocument(flow, assetIndex);
  if (errors.length) throw new Error(`interaction flow validation failed:\n${errors.join("\n")}`);

  const store = atlasStore(root);
  const written = await writeAtlasRecord(root, store.flows, `${flow.flowId}.json`, flow, ["recordedAt", "flowHash"], "atlas flow");
  return { duplicate: written.duplicate, flow, output: written.output };
}

async function readRecordDirectory(directory, filenamePattern, label) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const selected = names.filter((name) => name.endsWith(".json")).sort();
  if (selected.length > MAXIMUM_RECORDS) throw new Error(`${label} exceeds the ${MAXIMUM_RECORDS} record bound: ${selected.length}`);
  const records = [];
  for (const name of selected) {
    if (!filenamePattern.test(name)) throw new Error(`${label} filename is not a derived record id: ${name}`);
    const target = path.join(directory, name);
    const status = await lstat(target);
    if (status.isSymbolicLink() || !status.isFile()) throw new Error(`${label} is not a regular file: ${name}`);
    if (status.size > MAXIMUM_RECORD_BYTES) throw new Error(`${label} exceeds the per-record byte cap: ${name}`);
    const record = JSON.parse(await readFile(target, "utf8"));
    const id = record.assetId ?? record.flowId;
    if (`${id}.json` !== name) throw new Error(`${label} id does not match its filename: ${name}`);
    records.push(record);
  }
  return records;
}

export async function listAtlasRecords(repoRoot) {
  const store = atlasStore(repoRoot);
  const assets = await readRecordDirectory(store.assets, ASSET_FILENAME, "atlas asset record");
  const flows = await readRecordDirectory(store.flows, FLOW_FILENAME, "atlas flow record");
  return {
    schemaVersion: "nodekit.atlas-listing/v1",
    assets,
    flows,
    assetCards: assets.map((asset) => asset.card),
    flowCards: flows.map((flow) => flow.card),
    counts: { assets: assets.length, flows: flows.length },
    passed: true,
  };
}

export async function readAtlasRecord(repoRoot, id) {
  const store = atlasStore(repoRoot);
  const identifier = String(id ?? "");
  const isAsset = ASSET_FILENAME.test(`${identifier}.json`);
  const isFlow = FLOW_FILENAME.test(`${identifier}.json`);
  if (!isAsset && !isFlow) throw new Error(`atlas record id is invalid: ${identifier}`);
  const target = path.join(isAsset ? store.assets : store.flows, `${identifier}.json`);
  const status = await existingStat(target);
  if (!status) throw new Error(`atlas record is not registered: ${identifier}`);
  if (status.isSymbolicLink() || !status.isFile()) throw new Error(`atlas record is not a regular file: ${identifier}`);
  const record = JSON.parse(await readFile(target, "utf8"));
  if ((record.assetId ?? record.flowId) !== identifier) throw new Error(`atlas record id does not match its filename: ${identifier}`);
  return record;
}

export async function inspectAtlasRecord(repoRoot, id) {
  const root = path.resolve(repoRoot);
  const record = await readAtlasRecord(root, id);
  const issues = [];
  const snapshotChecks = [];
  if (record.schemaVersion === ATLAS_EXPERIENCE_ASSET_SCHEMA) {
    const schemaFindings = await validateSchema(ASSET_SCHEMA_FILE, record, "experience asset");
    issues.push(...schemaFindings, ...validateExperienceAssetDocument(record));
    const snapshotIds = [record.source.observationSnapshotId, ...record.implementation.files.map((file) => file.snapshotId)];
    for (const snapshotId of snapshotIds) {
      let verification;
      try {
        // A MISSING blob throws out of stableReadRegularFile while only a TAMPERED blob returns
        // passed:false, so both branches have to be handled or a crash path is left open.
        verification = await verifyEvidenceSnapshot(root, snapshotId);
      } catch (error) {
        snapshotChecks.push({ snapshotId, passed: false, reason: error.message });
        issues.push(`bound snapshot ${snapshotId} could not be verified: ${error.message}`);
        continue;
      }
      snapshotChecks.push({ snapshotId, passed: verification.passed, reason: verification.passed ? null : "bytes did not match the recorded SHA-256" });
      if (!verification.passed) issues.push(`bound snapshot ${snapshotId} did not verify`);
    }
  } else {
    const schemaFindings = await validateSchema(FLOW_SCHEMA_FILE, record, "interaction flow");
    const listing = await listAtlasRecords(root);
    const assetIndex = new Map(listing.assets.map((asset) => [asset.assetId, asset]));
    issues.push(...schemaFindings, ...validateInteractionFlowDocument(record, assetIndex));
  }
  return {
    schemaVersion: "nodekit.atlas-inspection/v1",
    id: record.assetId ?? record.flowId,
    record,
    snapshotChecks,
    issues,
    passed: issues.length === 0,
  };
}
