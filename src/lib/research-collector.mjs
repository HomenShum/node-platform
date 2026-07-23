import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  evidenceSnapshotToGraphNode,
  ingestEvidenceBytes,
  readContainedEvidenceFile,
  verifyEvidenceSnapshot,
} from "./evidence-snapshots.mjs";
import {
  proposeGraphPatch,
  readKnowledgeGraph,
  recordKnowledgeAction,
} from "./knowledge-evolution.mjs";
import { normalizePath } from "./files.mjs";

export const RESEARCH_COLLECTION_SCHEMA = "nodekit.research-collection/v1";
export const RESEARCH_PROVIDER_CONTRACT = "nodekit.research-provider/v1";

export const DEFAULT_RESEARCH_LIMITS = Object.freeze({
  maximumSearches: 1,
  maximumResultsPerSearch: 8,
  maximumFetches: 8,
  maximumBytesPerFetch: 5 * 1024 * 1024,
  maximumTotalBytes: 20 * 1024 * 1024,
  maximumLocatorsPerDocument: 32,
  maximumLocatorBytesPerDocument: 256 * 1024,
  maximumMetadataBytesPerResult: 64 * 1024,
  maximumDurationMs: 15_000,
});

const COLLECTOR_SAFE_PROVIDERS = new WeakMap();
const COLLECTOR_SAFE_NORMALIZERS = new WeakMap();

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

function digest(value) {
  return sha256(Buffer.from(canonical(value), "utf8"));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedInteger(value, fallback, label, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function normalizeResearchLimits(input = {}) {
  const limits = {
    maximumSearches: boundedInteger(input.maximumSearches, DEFAULT_RESEARCH_LIMITS.maximumSearches, "maximumSearches", 10),
    maximumResultsPerSearch: boundedInteger(input.maximumResultsPerSearch, DEFAULT_RESEARCH_LIMITS.maximumResultsPerSearch, "maximumResultsPerSearch", 100),
    maximumFetches: boundedInteger(input.maximumFetches, DEFAULT_RESEARCH_LIMITS.maximumFetches, "maximumFetches", 100),
    maximumBytesPerFetch: boundedInteger(input.maximumBytesPerFetch, DEFAULT_RESEARCH_LIMITS.maximumBytesPerFetch, "maximumBytesPerFetch", 1024 * 1024 * 1024),
    maximumTotalBytes: boundedInteger(input.maximumTotalBytes, DEFAULT_RESEARCH_LIMITS.maximumTotalBytes, "maximumTotalBytes", 2 * 1024 * 1024 * 1024),
    maximumLocatorsPerDocument: boundedInteger(input.maximumLocatorsPerDocument, DEFAULT_RESEARCH_LIMITS.maximumLocatorsPerDocument, "maximumLocatorsPerDocument", 10_000),
    maximumLocatorBytesPerDocument: boundedInteger(input.maximumLocatorBytesPerDocument, DEFAULT_RESEARCH_LIMITS.maximumLocatorBytesPerDocument, "maximumLocatorBytesPerDocument", 16 * 1024 * 1024),
    maximumMetadataBytesPerResult: boundedInteger(input.maximumMetadataBytesPerResult, DEFAULT_RESEARCH_LIMITS.maximumMetadataBytesPerResult, "maximumMetadataBytesPerResult", 4 * 1024 * 1024),
    maximumDurationMs: boundedInteger(input.maximumDurationMs, DEFAULT_RESEARCH_LIMITS.maximumDurationMs, "maximumDurationMs", 120_000),
  };
  if (limits.maximumFetches > limits.maximumSearches * limits.maximumResultsPerSearch) {
    throw new Error("maximumFetches cannot exceed the total bounded search-result capacity");
  }
  if (limits.maximumBytesPerFetch > limits.maximumTotalBytes) {
    throw new Error("maximumBytesPerFetch cannot exceed maximumTotalBytes");
  }
  return limits;
}

function absoluteUri(value, label) {
  const raw = String(value ?? "").trim();
  let uri;
  try { uri = new URL(raw); } catch { throw new Error(`${label} must be an absolute URI`); }
  if (!uri.protocol || uri.username || uri.password || uri.search || uri.hash || /\s/.test(raw)) {
    throw new Error(`${label} must be an absolute URI without credentials, query parameters, or fragments`);
  }
  return uri.href;
}

function boundedStructuredValue(value, label, maximumBytes) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new Error(`${label} must be JSON-serializable`); }
  const bytes = Buffer.byteLength(encoded ?? "null", "utf8");
  if (bytes > maximumBytes) throw new Error(`${label} byte limit exceeded: ${bytes} > ${maximumBytes}`);
  return structuredClone(value);
}

function timestamp(value, label) {
  const raw = String(value ?? "");
  const parsed = Date.parse(raw);
  if (!raw || Number.isNaN(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function byteBuffer(value, label, maximum) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : null;
  if (!bytes) throw new Error(`${label} must return raw bytes`);
  if (bytes.length > maximum) throw new Error(`${label} byte limit exceeded: ${bytes.length} > ${maximum}`);
  return bytes;
}

function validateSearchResults(results, maximum, limits) {
  if (!Array.isArray(results)) throw new Error("research provider search results must be an array");
  if (results.length > maximum) throw new Error(`research result limit exceeded: ${results.length} > ${maximum}`);
  const seen = new Set();
  return results.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`research result ${index} must be an object`);
    const uri = absoluteUri(entry.uri, `research result ${index}.uri`);
    if (seen.has(uri)) throw new Error(`duplicate research result URI: ${uri}`);
    seen.add(uri);
    if (!nonEmpty(entry.title) || entry.title.length > 2048) throw new Error(`research result ${index}.title must contain at most 2048 characters`);
    if (!nonEmpty(entry.mediaType) || entry.mediaType.length > 255) throw new Error(`research result ${index}.mediaType must contain at most 255 characters`);
    return {
      uri,
      title: entry.title.trim(),
      mediaType: entry.mediaType.trim().toLowerCase(),
      ...(Array.isArray(entry.locators) ? { locators: boundedStructuredValue(entry.locators, `research result ${index}.locators`, limits.maximumLocatorBytesPerDocument) } : {}),
      ...(entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? { metadata: boundedStructuredValue(entry.metadata, `research result ${index}.metadata`, limits.maximumMetadataBytesPerResult) } : {}),
    };
  });
}

export function validateResearchProvider(provider) {
  const errors = [];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) return ["research provider must be an object"];
  if (provider.contractVersion !== RESEARCH_PROVIDER_CONTRACT) errors.push(`provider.contractVersion must be ${RESEARCH_PROVIDER_CONTRACT}`);
  if (!nonEmpty(provider.id)) errors.push("provider.id is required");
  if (!nonEmpty(provider.version)) errors.push("provider.version is required");
  if (typeof provider.search !== "function") errors.push("provider.search must be a function");
  if (typeof provider.fetch !== "function") errors.push("provider.fetch must be a function");
  return errors;
}

async function boundedProviderCall(label, maximumDurationMs, operation) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new Error(`${label} timed out`));
          reject(new Error(`${label} timed out after ${maximumDurationMs}ms`));
        }, maximumDurationMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function remainingResearchLimits(limits, startedAt) {
  const remaining = Math.floor(limits.maximumDurationMs - (performance.now() - startedAt));
  if (remaining < 1) throw new Error(`research collection timed out after ${limits.maximumDurationMs}ms`);
  return { ...limits, maximumDurationMs: remaining };
}

export async function searchResearchProvider(provider, query, limitsInput = {}) {
  const errors = validateResearchProvider(provider);
  if (errors.length) throw new Error(`research provider contract failed:\n${errors.join("\n")}`);
  const limits = normalizeResearchLimits(limitsInput);
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) throw new Error("research query is required");
  const response = await boundedProviderCall(`research provider ${provider.id} search`, limits.maximumDurationMs, (signal) => provider.search(normalizedQuery, {
    limit: limits.maximumResultsPerSearch,
    signal,
  }));
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("research provider search response must be an object");
  const rawBytes = byteBuffer(response.rawBytes, "research provider search", limits.maximumTotalBytes);
  const provenance = {
    uri: absoluteUri(response.uri, "research search response URI"),
    capturedAt: timestamp(response.capturedAt, "research search capturedAt"),
    rawByteSha256: sha256(rawBytes),
    byteLength: rawBytes.length,
  };
  return {
    query: normalizedQuery,
    provenance,
    rawBytes,
    results: validateSearchResults(response.results, limits.maximumResultsPerSearch, limits),
  };
}

export async function fetchResearchProvider(provider, result, limitsInput = {}) {
  const errors = validateResearchProvider(provider);
  if (errors.length) throw new Error(`research provider contract failed:\n${errors.join("\n")}`);
  const limits = normalizeResearchLimits(limitsInput);
  const requestedUri = absoluteUri(result?.uri, "research fetch URI");
  const response = await boundedProviderCall(`research provider ${provider.id} fetch`, limits.maximumDurationMs, (signal) => provider.fetch(requestedUri, {
    maximumBytes: limits.maximumBytesPerFetch,
    signal,
  }));
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("research provider fetch response must be an object");
  const uri = absoluteUri(response.uri, "research fetch response URI");
  if (uri !== requestedUri) throw new Error(`research fetch URI mismatch: requested ${requestedUri}, received ${uri}`);
  const rawBytes = byteBuffer(response.rawBytes, "research provider fetch", limits.maximumBytesPerFetch);
  const mediaType = String(response.mediaType ?? result.mediaType ?? "").trim().toLowerCase();
  if (!mediaType) throw new Error("research fetch mediaType is required");
  const locators = response.locators ?? result.locators ?? [];
  if (!Array.isArray(locators)) throw new Error("research fetch locators must be an array");
  if (locators.length > limits.maximumLocatorsPerDocument) throw new Error(`research locator limit exceeded: ${locators.length} > ${limits.maximumLocatorsPerDocument}`);
  const boundedLocators = boundedStructuredValue(locators, "research fetch locators", limits.maximumLocatorBytesPerDocument);
  return {
    provenance: {
      uri,
      capturedAt: timestamp(response.capturedAt, "research fetch capturedAt"),
      rawByteSha256: sha256(rawBytes),
      byteLength: rawBytes.length,
    },
    mediaType,
    locators: boundedLocators,
    rawBytes,
    ...(response.expiresAt === undefined ? {} : { expiresAt: timestamp(response.expiresAt, "research fetch expiresAt") }),
  };
}

export function createIdentityResearchNormalizer() {
  const normalizer = {
    id: "nodekit.identity",
    version: "1",
    normalize(result) {
      return {
        label: result.title,
        confidence: 1,
        properties: structuredClone(result.metadata ?? {}),
      };
    },
  };
  COLLECTOR_SAFE_NORMALIZERS.set(normalizer, { mode: "nodekit-declarative", userCode: false });
  return normalizer;
}

export function createFieldMappingResearchNormalizer({
  id,
  version = "1",
  labelField = "title",
  labelTransform = "identity",
  confidence = 1,
  metadataFields = [],
} = {}) {
  if (!nonEmpty(id) || !nonEmpty(version)) throw new Error("field-mapping normalizer requires id and version");
  if (labelField !== "title" || !new Set(["identity", "uppercase", "lowercase"]).has(labelTransform)) {
    throw new Error("field-mapping normalizer label mapping is unsupported");
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("field-mapping normalizer confidence must be between 0 and 1");
  if (!Array.isArray(metadataFields) || metadataFields.some((field) => !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(String(field)))) {
    throw new Error("field-mapping normalizer metadataFields are invalid");
  }
  const fields = [...new Set(metadataFields.map(String))].sort();
  const transform = (value) => labelTransform === "uppercase" ? value.toUpperCase() : labelTransform === "lowercase" ? value.toLowerCase() : value;
  const normalizer = {
    id: id.trim(),
    version: version.trim(),
    normalize(result) {
      return {
        label: transform(String(result.title ?? "")),
        confidence,
        properties: Object.fromEntries(fields.filter((field) => Object.hasOwn(result.metadata ?? {}, field)).map((field) => [field, structuredClone(result.metadata[field])])),
      };
    },
  };
  COLLECTOR_SAFE_NORMALIZERS.set(normalizer, {
    confidence,
    labelField,
    labelTransform,
    metadataFields: fields,
    mode: "nodekit-declarative",
    userCode: false,
  });
  return normalizer;
}

export function normalizeResearchResult(result, normalizer = createIdentityResearchNormalizer(), limitsInput = {}) {
  if (!normalizer || !nonEmpty(normalizer.id) || !nonEmpty(normalizer.version) || typeof normalizer.normalize !== "function") {
    throw new Error("research normalizer requires id, version, and normalize(result)");
  }
  const normalized = normalizer.normalize(structuredClone(result));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new Error("research normalizer must return an object");
  if (!nonEmpty(normalized.label)) throw new Error("research normalization requires a label");
  const confidence = Number(normalized.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("research normalization confidence must be between 0 and 1");
  if (normalized.properties !== undefined && (!normalized.properties || typeof normalized.properties !== "object" || Array.isArray(normalized.properties))) {
    throw new Error("research normalization properties must be an object");
  }
  return {
    normalizer: { id: normalizer.id, version: normalizer.version },
    label: normalized.label.trim(),
    confidence,
    properties: boundedStructuredValue(
      normalized.properties ?? {},
      "research normalization properties",
      normalizeResearchLimits(limitsInput).maximumMetadataBytesPerResult,
    ),
  };
}

export function createLocalFixtureResearchProvider(repoRoot, fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("research fixture must be an object");
  const id = String(fixture.providerId ?? "local-fixture").trim();
  const version = String(fixture.providerVersion ?? "1").trim();
  if (!id || !version) throw new Error("research fixture requires providerId and providerVersion");
  if (!Array.isArray(fixture.documents) || fixture.documents.length === 0 || fixture.documents.length > 100) {
    throw new Error("research fixture documents must contain between 1 and 100 entries");
  }
  const capturedAt = timestamp(fixture.capturedAt ?? new Date().toISOString(), "research fixture capturedAt");
  const searchDelayMs = Math.max(0, Math.min(Number(fixture.searchDelayMs) || 0, 120_000));
  const fetchDelayMs = Math.max(0, Math.min(Number(fixture.fetchDelayMs) || 0, 120_000));
  const documents = fixture.documents.map((document, index) => {
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error(`fixture documents[${index}] must be an object`);
    return {
      uri: absoluteUri(document.uri, `fixture documents[${index}].uri`),
      title: String(document.title ?? "").trim(),
      mediaType: String(document.mediaType ?? "").trim().toLowerCase(),
      file: String(document.file ?? ""),
      capturedAt: timestamp(document.capturedAt ?? capturedAt, `fixture documents[${index}].capturedAt`),
      expiresAt: document.expiresAt === undefined ? undefined : timestamp(document.expiresAt, `fixture documents[${index}].expiresAt`),
      locators: structuredClone(document.locators ?? []),
      metadata: structuredClone(document.metadata ?? {}),
      terms: String(document.terms ?? "").toLowerCase(),
    };
  });
  if (documents.some((entry) => !entry.title || !entry.mediaType || !entry.file)) throw new Error("each research fixture document requires title, mediaType, and file");
  if (new Set(documents.map((entry) => entry.uri)).size !== documents.length) throw new Error("research fixture contains duplicate document URIs");
  const provider = {
    contractVersion: RESEARCH_PROVIDER_CONTRACT,
    id,
    version,
    async search(query, { limit, signal }) {
      if (signal?.aborted) throw signal.reason;
      if (searchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, searchDelayMs));
      if (signal?.aborted) throw signal.reason;
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const matches = documents.filter((document) => {
        const haystack = `${document.title} ${document.uri} ${document.terms} ${canonical(document.metadata)}`.toLowerCase();
        return terms.length === 0 || terms.some((term) => haystack.includes(term));
      }).slice(0, limit).map(({ file, capturedAt: ignoredCapturedAt, expiresAt, ...document }) => document);
      const rawBytes = Buffer.from(`${JSON.stringify({ providerId: id, providerVersion: version, query, results: matches }, null, 2)}\n`, "utf8");
      return {
        uri: `nodekit-fixture-search://${encodeURIComponent(id)}/${sha256(Buffer.from(query, "utf8"))}`,
        capturedAt,
        rawBytes,
        results: matches,
      };
    },
    async fetch(uri, { maximumBytes, signal }) {
      if (signal?.aborted) throw signal.reason;
      if (fetchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
      if (signal?.aborted) throw signal.reason;
      const document = documents.find((entry) => entry.uri === uri);
      if (!document) throw new Error(`fixture document not found: ${uri}`);
      const { bytes } = await readContainedEvidenceFile(repoRoot, document.file, { maximumBytes });
      if (signal?.aborted) throw signal.reason;
      return {
        uri: document.uri,
        capturedAt: document.capturedAt,
        mediaType: document.mediaType,
        locators: document.locators,
        rawBytes: bytes,
        ...(document.expiresAt ? { expiresAt: document.expiresAt } : {}),
      };
    },
  };
  COLLECTOR_SAFE_PROVIDERS.set(provider, { mode: "trusted-local-fixture", networkEgress: false });
  return provider;
}

function evidenceNode(snapshot, normalized, provider, role) {
  return evidenceSnapshotToGraphNode(snapshot, {
    label: normalized.label,
    confidence: normalized.confidence,
    properties: {
      role,
      collector: { providerId: provider.id, providerVersion: provider.version },
      normalization: { ...normalized.normalizer, values: structuredClone(normalized.properties) },
    },
  });
}

function collectionHash(collection) {
  const copy = structuredClone(collection);
  delete copy.contentHash;
  return digest(copy);
}

export function validateResearchCollectionDocument(collection) {
  const errors = [];
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return ["research collection must be an object"];
  if (collection.schemaVersion !== RESEARCH_COLLECTION_SCHEMA) errors.push(`schemaVersion must be ${RESEARCH_COLLECTION_SCHEMA}`);
  if (!/^research_[a-f0-9]{24}$/.test(String(collection.collectionId ?? ""))) errors.push("collectionId is invalid");
  if (!collection.provider || !nonEmpty(collection.provider.id) || !nonEmpty(collection.provider.version)
    || collection.provider.isolation?.mode !== "trusted-local-fixture" || collection.provider.isolation?.networkEgress !== false) {
    errors.push("provider identity and enforced isolation are required");
  }
  if (!collection.normalizer || !nonEmpty(collection.normalizer.id) || !nonEmpty(collection.normalizer.version)
    || collection.normalizer.isolation?.mode !== "nodekit-declarative" || collection.normalizer.isolation?.userCode !== false) {
    errors.push("normalizer identity and declarative isolation are required");
  }
  if (!Array.isArray(collection.queries) || collection.queries.length === 0) errors.push("queries must be non-empty");
  if (!Array.isArray(collection.searches) || !Array.isArray(collection.fetches)) errors.push("searches and fetches must be arrays");
  if (collection.proposalOnly !== true
    || collection.canonicalGraphVersionBefore !== collection.canonicalGraphVersionAfter
    || !/^[a-f0-9]{64}$/u.test(collection.canonicalGraphStateHashBefore ?? "")
    || collection.canonicalGraphStateHashBefore !== collection.canonicalGraphStateHashAfter) {
    errors.push("research collection must remain proposal-only with byte-bound canonical state");
  }
  if (!nonEmpty(collection.patchId) || !nonEmpty(collection.actionReceiptId)) errors.push("patch and action receipt identities are required");
  if (!/^[a-f0-9]{64}$/.test(String(collection.contentHash ?? ""))) errors.push("contentHash is invalid");
  if (errors.length === 0 && collectionHash(collection) !== collection.contentHash) errors.push("contentHash does not match collection content");
  return errors;
}

async function persistResearchCollection(repoRoot, collection) {
  const root = path.resolve(repoRoot);
  const directory = path.join(root, ".nodeagent", "knowledge", "research");
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("research collection directory escapes repository");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`research collection path is unsafe: ${normalizePath(path.relative(root, current))}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  const target = path.join(directory, `${collection.collectionId}.json`);
  await writeFile(target, `${JSON.stringify(collection, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return normalizePath(path.relative(root, target));
}

export async function collectExternalResearch(repoRoot, input) {
  const provider = input?.provider;
  const providerErrors = validateResearchProvider(provider);
  if (providerErrors.length) throw new Error(`research provider contract failed:\n${providerErrors.join("\n")}`);
  const providerIsolation = COLLECTOR_SAFE_PROVIDERS.get(provider);
  if (!providerIsolation) {
    throw new Error("research collection requires a NodeKit-constructed isolated provider; arbitrary in-process provider code is not accepted");
  }
  const limits = normalizeResearchLimits(input.limits);
  const collectionStartedAt = performance.now();
  const queries = [...new Set((Array.isArray(input.queries) ? input.queries : [input.query]).map((entry) => String(entry ?? "").trim()).filter(Boolean))];
  if (queries.length === 0) throw new Error("external research requires at least one query");
  if (queries.length > limits.maximumSearches) throw new Error(`research search limit exceeded: ${queries.length} > ${limits.maximumSearches}`);
  const normalizer = input.normalizer ?? createIdentityResearchNormalizer();
  if (!normalizer || !nonEmpty(normalizer.id) || !nonEmpty(normalizer.version) || typeof normalizer.normalize !== "function") {
    throw new Error("research normalizer requires id, version, and normalize(result)");
  }
  const normalizerIsolation = COLLECTOR_SAFE_NORMALIZERS.get(normalizer);
  if (!normalizerIsolation) {
    throw new Error("research collection requires a NodeKit-constructed declarative normalizer; arbitrary in-process normalizer code is not accepted");
  }
  const before = await readKnowledgeGraph(repoRoot, { graphPath: input.graphPath });
  const canonicalGraphStateHashBefore = digest({
    authority: before.authority,
    createdAt: before.createdAt,
    evolutionReceipts: before.evolutionReceipts,
    genesis: before.genesis,
    graphId: before.graphId,
    hyperedges: before.hyperedges,
    layers: before.layers,
    nodes: before.nodes,
    version: before.version,
  });
  const searches = [];
  const candidateResults = [];
  const operations = [];
  let totalBytes = 0;

  for (const query of queries) {
    const search = await searchResearchProvider(provider, query, remainingResearchLimits(limits, collectionStartedAt));
    totalBytes += search.rawBytes.length;
    if (totalBytes > limits.maximumTotalBytes) throw new Error(`research total byte limit exceeded: ${totalBytes} > ${limits.maximumTotalBytes}`);
    const searchSnapshot = await ingestEvidenceBytes(repoRoot, {
      bytes: search.rawBytes,
      sourceUri: search.provenance.uri,
      capturedAt: search.provenance.capturedAt,
      mediaType: "application/vnd.nodekit.search-results+json",
      expectedSha256: search.provenance.rawByteSha256,
      locators: [],
    }, { limits: { maximumBytes: limits.maximumTotalBytes, maximumLocators: limits.maximumLocatorsPerDocument } });
    const searchVerification = await verifyEvidenceSnapshot(repoRoot, searchSnapshot.snapshotId);
    if (!searchVerification.passed) throw new Error(`search evidence snapshot failed verification: ${searchSnapshot.snapshotId}`);
    remainingResearchLimits(limits, collectionStartedAt);
    const normalized = { normalizer: { id: normalizer.id, version: normalizer.version }, label: `Search response for ${query}`, confidence: 1, properties: { query, resultCount: search.results.length } };
    operations.push({ type: "INSERT", node: evidenceNode(searchSnapshot, normalized, provider, "search-response") });
    searches.push({ query, provenance: search.provenance, snapshotId: searchSnapshot.snapshotId, resultCount: search.results.length });
    candidateResults.push(...search.results);
  }

  const uniqueResults = [];
  const seenUris = new Set();
  for (const result of candidateResults) {
    if (seenUris.has(result.uri)) throw new Error(`duplicate research result across searches: ${result.uri}`);
    seenUris.add(result.uri);
    uniqueResults.push(result);
  }
  const selected = uniqueResults.slice(0, limits.maximumFetches);
  const fetches = [];
  for (const result of selected) {
    const fetched = await fetchResearchProvider(provider, result, remainingResearchLimits(limits, collectionStartedAt));
    totalBytes += fetched.rawBytes.length;
    if (totalBytes > limits.maximumTotalBytes) throw new Error(`research total byte limit exceeded: ${totalBytes} > ${limits.maximumTotalBytes}`);
    const normalized = normalizeResearchResult(result, normalizer, limits);
    const snapshot = await ingestEvidenceBytes(repoRoot, {
      bytes: fetched.rawBytes,
      sourceUri: fetched.provenance.uri,
      capturedAt: fetched.provenance.capturedAt,
      mediaType: fetched.mediaType,
      expectedSha256: fetched.provenance.rawByteSha256,
      locators: fetched.locators,
      expiresAt: fetched.expiresAt,
    }, { limits: { maximumBytes: limits.maximumBytesPerFetch, maximumLocators: limits.maximumLocatorsPerDocument } });
    const verification = await verifyEvidenceSnapshot(repoRoot, snapshot.snapshotId);
    if (!verification.passed) throw new Error(`fetched evidence snapshot failed verification: ${snapshot.snapshotId}`);
    remainingResearchLimits(limits, collectionStartedAt);
    operations.push({ type: "INSERT", node: evidenceNode(snapshot, normalized, provider, "fetched-document") });
    fetches.push({ resultUri: result.uri, provenance: fetched.provenance, snapshotId: snapshot.snapshotId, normalization: normalized.normalizer });
  }
  if (fetches.length === 0) throw new Error("external research returned no fetchable evidence");
  remainingResearchLimits(limits, collectionStartedAt);

  const patch = await proposeGraphPatch(repoRoot, {
    operations,
    evidenceRefs: [],
    contradictionRefs: input.contradictionRefs ?? [],
    proposedBy: input.proposedBy,
    confidence: input.confidence ?? 1,
  }, { graphPath: input.graphPath });
  const action = await recordKnowledgeAction(repoRoot, {
    type: "EXTERNAL_RESEARCH",
    runId: input.runId,
    caseId: input.caseId,
    actorId: input.actorId ?? provider.id,
    input: { queries, gapIds: input.gapIds ?? [], provider: { id: provider.id, version: provider.version } },
    outputRefs: [patch.patchId, ...fetches.map((entry) => entry.snapshotId)],
    evidenceRefs: operations.map((entry) => entry.node.id),
    budget: limits,
    status: "completed",
  }, { graphPath: input.graphPath });
  const after = await readKnowledgeGraph(repoRoot, { graphPath: input.graphPath });
  const canonicalGraphStateHashAfter = digest({
    authority: after.authority,
    createdAt: after.createdAt,
    evolutionReceipts: after.evolutionReceipts,
    genesis: after.genesis,
    graphId: after.graphId,
    hyperedges: after.hyperedges,
    layers: after.layers,
    nodes: after.nodes,
    version: after.version,
  });
  if (canonicalGraphStateHashAfter !== canonicalGraphStateHashBefore) {
    throw new Error("external research attempted to change canonical graph state");
  }
  const completedAt = new Date().toISOString();
  const collection = {
    schemaVersion: RESEARCH_COLLECTION_SCHEMA,
    collectionId: `research_${digest({ provider: provider.id, queries, searches, fetches, patchId: patch.patchId }).slice(0, 24)}`,
    provider: { id: provider.id, version: provider.version, contractVersion: provider.contractVersion, isolation: providerIsolation },
    normalizer: { id: normalizer.id, version: normalizer.version, isolation: normalizerIsolation },
    queries,
    limits,
    searches,
    fetches,
    totalRawBytes: totalBytes,
    patchId: patch.patchId,
    actionReceiptId: action.receiptId,
    proposalOnly: true,
    canonicalGraphVersionBefore: before.version,
    canonicalGraphVersionAfter: after.version,
    canonicalGraphStateHashBefore,
    canonicalGraphStateHashAfter,
    completedAt,
  };
  collection.contentHash = collectionHash(collection);
  const validationErrors = validateResearchCollectionDocument(collection);
  if (validationErrors.length) throw new Error(`research collection validation failed:\n${validationErrors.join("\n")}`);
  const collectionPath = await persistResearchCollection(repoRoot, collection);
  return { collection, collectionPath, patch, action, proposalOnly: true };
}

export async function readLocalResearchFixture(repoRoot, candidate) {
  const { bytes } = await readContainedEvidenceFile(repoRoot, candidate, { maximumBytes: 1024 * 1024 });
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`research provider fixture is invalid JSON: ${error.message}`);
  }
}
