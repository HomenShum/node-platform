import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "./files.mjs";

export const EVIDENCE_SNAPSHOT_SCHEMA = "nodekit.evidence-snapshot/v1";
export const EVIDENCE_VERIFICATION_SCHEMA = "nodekit.evidence-verification/v1";

const DEFAULT_STORE = ".nodeagent/evidence";
const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 25 * 1024 * 1024,
  maximumLocators: 64,
  maximumSnapshotRecords: 10_000,
});
const MEDIA_CLASSES = new Map([
  ["text/plain", "text"],
  ["text/markdown", "text"],
  ["text/html", "text"],
  ["application/json", "text"],
  ["application/pdf", "pdf"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/webp", "image"],
  ["image/gif", "image"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/quicktime", "video"],
  ["application/octet-stream", "binary"],
  ["application/vnd.nodekit.search-results+json", "text"],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return sha256(Buffer.from(canonical(value), "utf8"));
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

async function assertNoSymlinkPath(root, target, label, { includeLeaf = true } = {}) {
  if (!isContained(root, target)) throw new Error(`${label} escapes the repository`);
  const relative = path.relative(root, target);
  const segments = relative ? relative.split(path.sep) : [];
  let current = root;
  const end = includeLeaf ? segments.length : Math.max(0, segments.length - 1);
  for (let index = 0; index < end; index += 1) {
    current = path.join(current, segments[index]);
    const status = await existingStat(current);
    if (!status) continue;
    if (status.isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link: ${normalizePath(path.relative(root, current))}`);
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

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function stableReadRegularFile(root, target, label, { maximumBytes = Number.MAX_SAFE_INTEGER, beforeRead } = {}) {
  await assertNoSymlinkPath(root, target, label);
  const beforePath = await lstat(target, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) throw new Error(`${label} must be a regular non-symbolic file`);
  if (beforePath.nlink !== 1n) throw new Error(`${label} cannot use a hard-linked file`);
  if (beforePath.size > BigInt(maximumBytes)) throw new Error(`${label} byte limit exceeded: ${beforePath.size} > ${maximumBytes}`);
  const physicalBefore = await realpath(target);
  if (!isContained(root, physicalBefore)) throw new Error(`${label} resolves outside the repository`);
  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    try {
      handle = await open(target, fsConstants.O_RDONLY | noFollow);
    } catch (error) {
      if (!noFollow || !["EINVAL", "ENOTSUP", "UNKNOWN"].includes(error?.code)) throw error;
      handle = await open(target, "r");
    }
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n || !sameFileIdentity(beforePath, openedBefore)) {
      throw new Error(`${label} identity changed before reading`);
    }
    if (beforeRead) await beforeRead({ target });
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const afterPath = await lstat(target, { bigint: true });
    const physicalAfter = await realpath(target);
    if (!sameFileIdentity(openedBefore, openedAfter)
      || !sameFileIdentity(openedAfter, afterPath)
      || physicalAfter !== physicalBefore
      || !isContained(root, physicalAfter)
      || bytes.length !== Number(openedAfter.size)) {
      throw new Error(`${label} identity or size changed while reading`);
    }
    return { bytes, identity: openedAfter, physicalPath: physicalAfter };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeImmutableFile(root, target, bytes, label) {
  await assertNoSymlinkPath(root, target, label, { includeLeaf: false });
  const parentBefore = await lstat(path.dirname(target), { bigint: true });
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error(`${label} parent is unsafe`);
  const temporary = `${target}.tmp-${process.pid}-${createHash("sha256").update(bytes).update(String(Math.random())).digest("hex").slice(0, 16)}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertNoSymlinkPath(root, target, label, { includeLeaf: false });
    const parentAfter = await lstat(path.dirname(target), { bigint: true });
    if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) throw new Error(`${label} parent identity changed before commit`);
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await stableReadRegularFile(root, target, label, { maximumBytes: bytes.length });
      if (!existing.bytes.equals(bytes)) throw new Error(`${label} immutable address already contains different bytes`);
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function positiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function normalizeLimits(input = {}) {
  return {
    maximumBytes: positiveInteger(input.maximumBytes, DEFAULT_LIMITS.maximumBytes, "maximumBytes", 1024 * 1024 * 1024),
    maximumLocators: positiveInteger(input.maximumLocators, DEFAULT_LIMITS.maximumLocators, "maximumLocators", 10_000),
    maximumSnapshotRecords: positiveInteger(input.maximumSnapshotRecords, DEFAULT_LIMITS.maximumSnapshotRecords, "maximumSnapshotRecords", 1_000_000),
  };
}

function normalizeTimestamp(value, label) {
  const timestamp = String(value ?? "");
  const parsed = Date.parse(timestamp);
  if (!timestamp || Number.isNaN(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function normalizeSourceUri(value) {
  const sourceUri = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(sourceUri);
  } catch {
    throw new Error("sourceUri must be an absolute URI");
  }
  if (!parsed.protocol || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("sourceUri must be an absolute URI without credentials, query parameters, or fragments");
  }
  if (/\s/.test(sourceUri)) throw new Error("sourceUri cannot contain whitespace");
  return parsed.href;
}

function mediaClassFor(mediaType) {
  const normalized = String(mediaType ?? "").split(";", 1)[0].trim().toLowerCase();
  const mediaClass = MEDIA_CLASSES.get(normalized);
  if (!mediaClass) throw new Error(`unsupported evidence media type: ${mediaType}`);
  return { mediaType: normalized, mediaClass };
}

function validateMediaBytes(bytes, mediaType, mediaClass) {
  if (bytes.length === 0) throw new Error("evidence bytes cannot be empty");
  if (mediaClass === "text") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error(`${mediaType} evidence must be valid UTF-8 bytes`); }
    if (mediaType === "application/json" || mediaType === "application/vnd.nodekit.search-results+json") {
      try { JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${mediaType} evidence must contain valid JSON bytes`); }
    }
    return;
  }
  if (mediaType === "application/pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF evidence bytes are missing the PDF signature");
  if (mediaType === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("PNG evidence bytes are missing the PNG signature");
  if (mediaType === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9)) throw new Error("JPEG evidence bytes are missing JPEG boundary markers");
  if (mediaType === "image/gif" && !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) throw new Error("GIF evidence bytes are missing the GIF signature");
  if (mediaType === "image/webp" && !(bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")) throw new Error("WebP evidence bytes are missing the RIFF/WEBP signature");
  if (["video/mp4", "video/quicktime"].includes(mediaType) && bytes.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error(`${mediaType} evidence bytes are missing an ftyp box`);
  if (mediaType === "video/webm" && !bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) throw new Error("WebM evidence bytes are missing the EBML signature");
}

function finiteNumber(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} is outside the supported range`);
  return number;
}

function verifyLocatorInput(locator, index, mediaClass, bytes) {
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) throw new Error(`locators[${index}] must be an object`);
  const source = String(locator.source ?? "");
  if (!new Set(["user", "provider", "parser"]).has(source)) {
    throw new Error(`locators[${index}].source must identify user, provider, or parser provenance`);
  }
  const kind = String(locator.kind ?? "");
  const expectedKinds = { text: "text", pdf: "pdf-page", image: "image-region", video: "video-range", binary: "byte-range" };
  if (kind !== expectedKinds[mediaClass]) throw new Error(`locators[${index}].kind ${kind || "<missing>"} is invalid for ${mediaClass} evidence`);
  const startByte = finiteNumber(locator.startByte, `locators[${index}].startByte`, { maximum: bytes.length });
  const endByte = finiteNumber(locator.endByte, `locators[${index}].endByte`, { maximum: bytes.length });
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) || endByte <= startByte) {
    throw new Error(`locators[${index}] requires an ordered, non-empty byte range`);
  }
  const normalized = { kind, source, startByte, endByte, anchorSha256: sha256(bytes.subarray(startByte, endByte)) };
  if (kind === "pdf-page") {
    normalized.pageNumber = positiveInteger(locator.pageNumber, undefined, `locators[${index}].pageNumber`, 1_000_000);
  } else if (kind === "image-region") {
    normalized.coordinateSpace = String(locator.coordinateSpace ?? "");
    if (!new Set(["pixels", "normalized"]).has(normalized.coordinateSpace)) throw new Error(`locators[${index}].coordinateSpace is invalid`);
    const maximum = normalized.coordinateSpace === "normalized" ? 1 : Number.MAX_SAFE_INTEGER;
    for (const field of ["x", "y", "width", "height"]) normalized[field] = finiteNumber(locator[field], `locators[${index}].${field}`, { maximum });
    if (normalized.width <= 0 || normalized.height <= 0) throw new Error(`locators[${index}] requires a non-empty image region`);
    if (normalized.coordinateSpace === "normalized" && (normalized.x + normalized.width > 1 || normalized.y + normalized.height > 1)) {
      throw new Error(`locators[${index}] normalized image region is out of bounds`);
    }
  } else if (kind === "video-range") {
    normalized.startMs = finiteNumber(locator.startMs, `locators[${index}].startMs`);
    normalized.endMs = finiteNumber(locator.endMs, `locators[${index}].endMs`);
    if (normalized.endMs <= normalized.startMs) throw new Error(`locators[${index}] requires an ordered, non-empty time range`);
  }
  return normalized;
}

function normalizeLocators(locators, mediaClass, bytes, maximumLocators) {
  if (!Array.isArray(locators ?? [])) throw new Error("locators must be an array");
  if ((locators ?? []).length > maximumLocators) throw new Error(`locator limit exceeded: ${(locators ?? []).length} > ${maximumLocators}`);
  return (locators ?? []).map((locator, index) => verifyLocatorInput(locator, index, mediaClass, bytes));
}

async function readSnapshotDocuments(root, snapshotDirectory, maximumSnapshotRecords) {
  const status = await existingStat(snapshotDirectory);
  if (!status) return [];
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error("evidence snapshot directory is not a safe directory");
  const names = (await readdir(snapshotDirectory)).filter((name) => name.endsWith(".json")).sort();
  if (names.length > maximumSnapshotRecords) throw new Error(`snapshot record limit exceeded: ${names.length} > ${maximumSnapshotRecords}`);
  const documents = [];
  for (const name of names) {
    if (!/^evidence_[a-f0-9]{24}\.json$/.test(name)) throw new Error(`unexpected evidence snapshot filename: ${name}`);
    const target = path.join(snapshotDirectory, name);
    try {
      const { bytes } = await stableReadRegularFile(root, target, `evidence snapshot record ${name}`, { maximumBytes: 4 * 1024 * 1024 });
      const snapshot = JSON.parse(bytes.toString("utf8"));
      if (`${snapshot.snapshotId}.json` !== name) throw new Error("snapshotId does not match its metadata filename");
      documents.push(snapshot);
    } catch (error) {
      throw new Error(`evidence snapshot record is invalid JSON: ${name}: ${error.message}`);
    }
  }
  return documents;
}

export async function readContainedEvidenceFile(repoRoot, candidate, { maximumBytes, beforeStableRead } = {}) {
  const limits = normalizeLimits({ maximumBytes });
  const resolved = containedPath(repoRoot, candidate, "evidence source file");
  const { bytes } = await stableReadRegularFile(resolved.root, resolved.absolute, "evidence source", { maximumBytes: limits.maximumBytes, beforeRead: beforeStableRead });
  return { bytes, relativePath: resolved.relative };
}

export function validateEvidenceSnapshotDocument(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return ["evidence snapshot must be an object"];
  if (snapshot.schemaVersion !== EVIDENCE_SNAPSHOT_SCHEMA) errors.push(`schemaVersion must be ${EVIDENCE_SNAPSHOT_SCHEMA}`);
  if (!/^evidence_[a-f0-9]{24}$/.test(String(snapshot.snapshotId ?? ""))) errors.push("snapshotId is invalid");
  let normalizedUri;
  let normalizedCapturedAt;
  try {
    normalizedUri = normalizeSourceUri(snapshot.source?.uri);
    if (normalizedUri !== snapshot.source?.uri) errors.push("source.uri is not canonical");
  } catch (error) { errors.push(error.message); }
  try {
    normalizedCapturedAt = normalizeTimestamp(snapshot.source?.capturedAt, "source.capturedAt");
    if (normalizedCapturedAt !== snapshot.source?.capturedAt) errors.push("source.capturedAt is not canonical");
  } catch (error) { errors.push(error.message); }
  try { mediaClassFor(snapshot.source?.mediaType); } catch (error) { errors.push(error.message); }
  if (!Number.isInteger(snapshot.raw?.byteLength) || snapshot.raw.byteLength < 0) errors.push("raw.byteLength is invalid");
  if (!/^[a-f0-9]{64}$/.test(String(snapshot.raw?.sha256 ?? ""))) errors.push("raw.sha256 is invalid");
  if (!/^\.nodeagent\/evidence\/blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/.test(String(snapshot.raw?.blobPath ?? ""))) errors.push("raw.blobPath is invalid");
  if (/^[a-f0-9]{64}$/.test(String(snapshot.raw?.sha256 ?? ""))) {
    const expectedBlobPath = `.nodeagent/evidence/blobs/sha256/${snapshot.raw.sha256.slice(0, 2)}/${snapshot.raw.sha256}.bin`;
    if (snapshot.raw.blobPath !== expectedBlobPath) errors.push("raw.blobPath does not match raw.sha256");
  }
  if (!Array.isArray(snapshot.locators)) errors.push("locators must be an array");
  if (!snapshot.freshness || typeof snapshot.freshness !== "object") errors.push("freshness is required");
  if (!/^[a-f0-9]{64}$/.test(String(snapshot.contentHash ?? ""))) errors.push("contentHash is invalid");
  if (normalizedUri && normalizedCapturedAt && /^[a-f0-9]{64}$/.test(String(snapshot.raw?.sha256 ?? ""))) {
    const expectedSnapshotId = `evidence_${contentHash({ sourceUri: normalizedUri, capturedAt: normalizedCapturedAt, rawSha256: snapshot.raw.sha256 }).slice(0, 24)}`;
    if (snapshot.snapshotId !== expectedSnapshotId) errors.push("snapshotId does not match source identity and raw bytes");
  }
  if (errors.length === 0) {
    const copy = structuredClone(snapshot);
    delete copy.contentHash;
    if (contentHash(copy) !== snapshot.contentHash) errors.push("contentHash does not match snapshot content");
  }
  return errors;
}

export function evidenceSnapshotToGraphNode(snapshot, input = {}) {
  const errors = validateEvidenceSnapshotDocument(snapshot);
  if (errors.length) throw new Error(`evidence snapshot validation failed:\n${errors.join("\n")}`);
  const confidence = Number(input.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("evidence graph-node confidence must be between 0 and 1");
  const label = String(input.label ?? "").trim();
  if (!label) throw new Error("evidence graph-node label is required");
  return {
    id: snapshot.snapshotId,
    kind: "evidence",
    label,
    layer: "source",
    confidence,
    evidenceRefs: [],
    contentHash: snapshot.raw.sha256,
    sourceUri: snapshot.source.uri,
    capturedAt: snapshot.source.capturedAt,
    freshness: structuredClone(snapshot.freshness),
    properties: {
      snapshotId: snapshot.snapshotId,
      snapshotContentHash: snapshot.contentHash,
      mediaType: snapshot.source.mediaType,
      byteLength: snapshot.raw.byteLength,
      locators: structuredClone(snapshot.locators),
      ...(input.properties && typeof input.properties === "object" && !Array.isArray(input.properties) ? structuredClone(input.properties) : {}),
    },
  };
}

export async function ingestEvidenceBytes(repoRoot, input, options = {}) {
  const limits = normalizeLimits(options.limits);
  const bytes = Buffer.isBuffer(input?.bytes) ? Buffer.from(input.bytes) : input?.bytes instanceof Uint8Array ? Buffer.from(input.bytes) : null;
  if (!bytes) throw new Error("evidence ingest requires real bytes");
  if (bytes.length > limits.maximumBytes) throw new Error(`evidence byte limit exceeded: ${bytes.length} > ${limits.maximumBytes}`);
  const sourceUri = normalizeSourceUri(input.sourceUri);
  const capturedAt = normalizeTimestamp(input.capturedAt ?? new Date().toISOString(), "capturedAt");
  const { mediaType, mediaClass } = mediaClassFor(input.mediaType ?? "application/octet-stream");
  validateMediaBytes(bytes, mediaType, mediaClass);
  const rawSha256 = sha256(bytes);
  if (input.expectedSha256 !== undefined && String(input.expectedSha256).toLowerCase() !== rawSha256) {
    throw new Error(`evidence SHA-256 mismatch: computed ${rawSha256}`);
  }
  const locators = normalizeLocators(input.locators, mediaClass, bytes, limits.maximumLocators);
  const checkedAt = normalizeTimestamp(input.checkedAt ?? capturedAt, "checkedAt");
  const expiresAt = input.expiresAt === undefined ? undefined : normalizeTimestamp(input.expiresAt, "expiresAt");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(checkedAt)) throw new Error("expiresAt must be after checkedAt");

  const store = containedPath(repoRoot, options.storePath ?? DEFAULT_STORE, "evidence store");
  await assertNoSymlinkPath(store.root, store.absolute, "evidence store", { includeLeaf: true });
  const snapshotsDirectory = path.join(store.absolute, "snapshots");
  const blobDirectory = path.join(store.absolute, "blobs", "sha256", rawSha256.slice(0, 2));
  await ensureSecureDirectory(store.root, snapshotsDirectory, "evidence snapshot directory");
  await ensureSecureDirectory(store.root, blobDirectory, "evidence blob directory");

  const existing = await readSnapshotDocuments(store.root, snapshotsDirectory, limits.maximumSnapshotRecords);
  if (existing.some((entry) => entry.source?.uri === sourceUri && entry.raw?.sha256 === rawSha256)) {
    throw new Error(`duplicate evidence snapshot for ${sourceUri} and SHA-256 ${rawSha256}`);
  }
  const snapshotId = `evidence_${contentHash({ sourceUri, capturedAt, rawSha256 }).slice(0, 24)}`;
  if (existing.some((entry) => entry.snapshotId === snapshotId)) throw new Error(`duplicate evidence snapshot id: ${snapshotId}`);
  const blobPath = normalizePath(path.relative(store.root, path.join(blobDirectory, `${rawSha256}.bin`)));
  const blobAbsolute = path.join(store.root, blobPath);
  const blobStatus = await existingStat(blobAbsolute);
  if (blobStatus) {
    const { bytes: existingBytes } = await stableReadRegularFile(store.root, blobAbsolute, "evidence blob", { maximumBytes: limits.maximumBytes });
    if (existingBytes.length !== bytes.length || sha256(existingBytes) !== rawSha256 || !existingBytes.equals(bytes)) {
      throw new Error("content-addressed evidence blob does not match its SHA-256 path");
    }
  } else {
    await writeImmutableFile(store.root, blobAbsolute, bytes, "evidence blob");
  }

  const snapshot = {
    schemaVersion: EVIDENCE_SNAPSHOT_SCHEMA,
    snapshotId,
    source: { uri: sourceUri, capturedAt, mediaType },
    raw: { byteLength: bytes.length, sha256: rawSha256, blobPath },
    locators,
    freshness: { checkedAt, ...(expiresAt ? { expiresAt } : {}) },
    storedAt: new Date().toISOString(),
  };
  snapshot.contentHash = contentHash(snapshot);
  const errors = validateEvidenceSnapshotDocument(snapshot);
  if (errors.length) throw new Error(`evidence snapshot validation failed:\n${errors.join("\n")}`);
  const metadataPath = path.join(snapshotsDirectory, `${snapshotId}.json`);
  await writeImmutableFile(store.root, metadataPath, Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8"), "evidence snapshot metadata");
  return structuredClone(snapshot);
}

export async function ingestEvidenceFile(repoRoot, input, options = {}) {
  const { bytes, relativePath } = await readContainedEvidenceFile(repoRoot, input.file, {
    maximumBytes: options.limits?.maximumBytes,
  });
  const snapshot = await ingestEvidenceBytes(repoRoot, { ...input, bytes }, options);
  return { snapshot, sourcePath: relativePath };
}

export async function readEvidenceSnapshot(repoRoot, snapshotId, options = {}) {
  if (!/^evidence_[a-f0-9]{24}$/.test(String(snapshotId ?? ""))) throw new Error("evidence snapshot id is invalid");
  const store = containedPath(repoRoot, options.storePath ?? DEFAULT_STORE, "evidence store");
  const target = path.join(store.absolute, "snapshots", `${snapshotId}.json`);
  let snapshot;
  try {
    const { bytes } = await stableReadRegularFile(store.root, target, "evidence snapshot", { maximumBytes: 4 * 1024 * 1024, beforeRead: options.beforeMetadataRead });
    snapshot = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`evidence snapshot is invalid JSON: ${error.message}`);
  }
  const errors = validateEvidenceSnapshotDocument(snapshot);
  if (errors.length) throw new Error(`evidence snapshot validation failed:\n${errors.join("\n")}`);
  if (snapshot.snapshotId !== snapshotId) throw new Error("evidence snapshot id does not match requested metadata filename");
  return snapshot;
}

export async function verifyEvidenceSnapshot(repoRoot, snapshotId, options = {}) {
  const snapshot = await readEvidenceSnapshot(repoRoot, snapshotId, options);
  const root = path.resolve(repoRoot);
  const blob = containedPath(root, snapshot.raw.blobPath, "evidence blob");
  const expectedBlobPath = `.nodeagent/evidence/blobs/sha256/${snapshot.raw.sha256.slice(0, 2)}/${snapshot.raw.sha256}.bin`;
  if (snapshot.raw.blobPath !== expectedBlobPath) throw new Error("evidence blob path is not bound to raw.sha256");
  const { bytes } = await stableReadRegularFile(blob.root, blob.absolute, "evidence blob", { maximumBytes: Math.max(1, snapshot.raw.byteLength), beforeRead: options.beforeBlobRead });
  const actualSha256 = sha256(bytes);
  const hashMatches = actualSha256 === snapshot.raw.sha256;
  const lengthMatches = bytes.length === snapshot.raw.byteLength;
  let mediaBytesValid = true;
  const { mediaClass } = mediaClassFor(snapshot.source.mediaType);
  try { validateMediaBytes(bytes, snapshot.source.mediaType, mediaClass); } catch { mediaBytesValid = false; }
  const locatorChecks = snapshot.locators.map((locator, index) => {
    let normalized;
    try { normalized = verifyLocatorInput(locator, index, mediaClass, bytes); } catch { normalized = null; }
    const actualAnchorSha256 = normalized?.anchorSha256 ?? null;
    return { index, passed: normalized !== null && canonical(normalized) === canonical(locator), actualAnchorSha256 };
  });
  const verifiedAt = new Date(options.at ?? Date.now()).toISOString();
  const fresh = !snapshot.freshness.expiresAt || Date.parse(snapshot.freshness.expiresAt) > Date.parse(verifiedAt);
  return {
    schemaVersion: EVIDENCE_VERIFICATION_SCHEMA,
    snapshotId: snapshot.snapshotId,
    expectedSha256: snapshot.raw.sha256,
    actualSha256,
    hashMatches,
    lengthMatches,
    mediaBytesValid,
    fresh,
    locatorChecks,
    verifiedAt,
    passed: hashMatches && lengthMatches && mediaBytesValid && fresh && locatorChecks.every((entry) => entry.passed),
  };
}

export async function verifyEvidenceGraphNode(repoRoot, node, options = {}) {
  if (node?.kind !== "evidence" || node?.layer !== "source") throw new Error("source evidence node kind/layer is invalid");
  const snapshotId = String(node.properties?.snapshotId ?? "");
  const snapshotContentHash = String(node.properties?.snapshotContentHash ?? "");
  if (!/^evidence_[a-f0-9]{24}$/u.test(snapshotId) || !/^[a-f0-9]{64}$/u.test(snapshotContentHash)) {
    throw new Error("source evidence node must bind properties.snapshotId and properties.snapshotContentHash");
  }
  const snapshot = await readEvidenceSnapshot(repoRoot, snapshotId, options);
  const verification = await verifyEvidenceSnapshot(repoRoot, snapshotId, options);
  const mismatches = [];
  if (!verification.passed) mismatches.push("snapshot bytes did not verify");
  if (snapshot.contentHash !== snapshotContentHash) mismatches.push("snapshotContentHash mismatch");
  if (node.id !== snapshot.snapshotId) mismatches.push("node id mismatch");
  if (node.contentHash !== snapshot.raw.sha256) mismatches.push("raw contentHash mismatch");
  if (node.sourceUri !== snapshot.source.uri) mismatches.push("sourceUri mismatch");
  if (node.capturedAt !== snapshot.source.capturedAt) mismatches.push("capturedAt mismatch");
  if (canonical(node.freshness ?? {}) !== canonical(snapshot.freshness)) mismatches.push("freshness mismatch");
  if (node.properties?.mediaType !== snapshot.source.mediaType) mismatches.push("mediaType mismatch");
  if (node.properties?.byteLength !== snapshot.raw.byteLength) mismatches.push("byteLength mismatch");
  if (canonical(node.properties?.locators ?? []) !== canonical(snapshot.locators)) mismatches.push("locator mismatch");
  if (mismatches.length) throw new Error(`source evidence node authentication failed: ${mismatches.join(", ")}`);
  return { snapshot, verification };
}
