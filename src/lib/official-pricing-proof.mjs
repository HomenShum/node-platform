import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import path from "node:path";
import { canonicalizeAttestationPayload } from "./submission-attestation.mjs";

export const OFFICIAL_PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
export const OFFICIAL_PRICING_RETRIEVAL_TOOL = "mcp__openaiDeveloperDocs__fetch_openai_doc";
export const OFFICIAL_PRICING_RETRIEVAL_METHOD = "OpenAI Developer Docs MCP";
export const OFFICIAL_PRICING_TIER = "Standard";
export const OFFICIAL_PRICING_UNIT = "USD per 1M tokens";
export const OFFICIAL_PRICING_COLUMNS = Object.freeze(["model", "input", "cachedInput", "cacheWrite", "output"]);
export const OFFICIAL_PRICING_ROWS = Object.freeze([
  Object.freeze(["gpt-5.6-sol", 5, 0.5, 6.25, 30]),
  Object.freeze(["gpt-5.6-terra", 2.5, 0.25, 3.125, 15]),
  Object.freeze(["gpt-5.6-luna", 1, 0.1, 1.25, 6]),
]);
export const OFFICIAL_PRICING_LOWER_COST_MODEL = "gpt-5.6-luna";
export const OFFICIAL_PRICING_COMPARATOR_MODELS = Object.freeze(["gpt-5.6-sol", "gpt-5.6-terra"]);
export const OFFICIAL_PRICING_RETRIEVAL_PURPOSE = "official-openai-pricing-retrieval";
export const OFFICIAL_PRICING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFICIAL_PRICING_EXTRACTION_SCHEMA_VERSION = "nodekit.official-pricing-extraction/v1";
export const OFFICIAL_PRICING_PAYLOAD_SCHEMA_VERSION = "nodekit.official-pricing-retrieval-attestation-payload/v1";
export const OFFICIAL_PRICING_ATTESTATION_SCHEMA_VERSION = "nodekit.official-pricing-retrieval-attestation/v1";
export const OFFICIAL_PRICING_PROOF_SCHEMA_VERSION = "nodekit.official-pricing-proof/v1";

const SIGNING_DOMAIN = "NODEKIT-OFFICIAL-OPENAI-PRICING-RETRIEVAL-V1\0";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RAW_MAX_BYTES = 256 * 1024;
const EXTRACTOR_MAX_BYTES = 512 * 1024;
const PARSED_MAX_BYTES = 16 * 1024;

function fail(message) {
  throw new TypeError(message);
}

function plainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainRecord(value)) fail(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) fail(`${label} must be a canonical UTC timestamp with milliseconds`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(`${label} is not a valid timestamp`);
  return milliseconds;
}

function referenceTime(value, label) {
  const milliseconds = value instanceof Date ? value.getTime()
    : typeof value === "string" ? Date.parse(value)
      : Number(value);
  if (!Number.isFinite(milliseconds)) fail(`${label} is not a valid time`);
  return milliseconds;
}

function canonicalPath(value, label) {
  if (typeof value !== "string" || value.length === 0
    || value.includes("\\") || value.startsWith("/") || value.startsWith("./")
    || /^[A-Za-z]:/.test(value) || path.posix.normalize(value) !== value
    || value === "." || value.endsWith("/")) {
    fail(`${label} must be a canonical repository-relative path`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) fail(`${label} does not match the exact official contract`);
}

function evidenceReference(value, label, maxBytes) {
  exactKeys(value, ["bytes", "path", "sha256"], label);
  canonicalPath(value.path, `${label}.path`);
  if (!SHA256.test(value.sha256 ?? "")) fail(`${label}.sha256 must be a lowercase SHA-256 digest`);
  if (!Number.isInteger(value.bytes) || value.bytes <= 0 || value.bytes > maxBytes) fail(`${label}.bytes exceeds its fail-closed limit`);
  return value;
}

function exactCandidate(value) {
  exactKeys(value, ["authorityId", "candidateCommit", "nodekitSourceHash", "nodekitTarballSha256"], "pricing candidate");
  if (!ID.test(value.authorityId ?? "")) fail("pricing candidate authorityId is invalid");
  if (!COMMIT.test(value.candidateCommit ?? "")) fail("pricing candidate commit is invalid");
  if (!SHA256.test(value.nodekitSourceHash ?? "") || !SHA256.test(value.nodekitTarballSha256 ?? "")) {
    fail("pricing candidate hashes are invalid");
  }
  return value;
}

function exactRows(rows, label = "pricing rows") {
  if (!Array.isArray(rows) || rows.length !== OFFICIAL_PRICING_ROWS.length) fail(`${label} must contain the exact three official model rows`);
  for (let rowIndex = 0; rowIndex < OFFICIAL_PRICING_ROWS.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const expected = OFFICIAL_PRICING_ROWS[rowIndex];
    if (!Array.isArray(row) || row.length !== OFFICIAL_PRICING_COLUMNS.length) fail(`${label}[${rowIndex}] must contain five columns`);
    if (row.some((entry, columnIndex) => entry !== expected[columnIndex])) fail(`${label}[${rowIndex}] differs from the official Standard-tier row`);
    if (row.slice(1).some((entry) => !Number.isFinite(entry) || entry < 0)) fail(`${label}[${rowIndex}] has an incomplete numeric dimension`);
  }
  const lower = rows.find((row) => row[0] === OFFICIAL_PRICING_LOWER_COST_MODEL);
  for (const comparatorModel of OFFICIAL_PRICING_COMPARATOR_MODELS) {
    const comparator = rows.find((row) => row[0] === comparatorModel);
    for (let index = 1; index < OFFICIAL_PRICING_COLUMNS.length; index += 1) {
      if (!(lower[index] < comparator[index])) fail(`${OFFICIAL_PRICING_LOWER_COST_MODEL} is not strictly cheaper than ${comparatorModel} for ${OFFICIAL_PRICING_COLUMNS[index]}`);
    }
  }
}

function utf8Text(bytes, label, maxBytes) {
  if (!Buffer.isBuffer(bytes)) fail(`${label} must be exact Buffer bytes`);
  if (bytes.length === 0 || bytes.length > maxBytes) fail(`${label} exceeds its fail-closed byte limit`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not canonical UTF-8`);
  }
  if (!Buffer.from(text, "utf8").equals(bytes) || text.charCodeAt(0) === 0xfeff) fail(`${label} is not canonical UTF-8`);
  return text;
}

function exactlyOnce(haystack, needle, label) {
  const first = haystack.indexOf(needle);
  if (first < 0 || haystack.indexOf(needle, first + needle.length) >= 0) fail(`${label} must appear exactly once in the captured official excerpt`);
  return first;
}

/**
 * Deterministically extract the first Flagship-model Standard pane from exact
 * OpenAI Developer Docs MCP bytes. The source component's five row values map
 * to model, input, cached input, cache write, and output in that order.
 */
export function extractOfficialOpenAiStandardPricing(rawBytes, { extractorSha256 } = {}) {
  if (!SHA256.test(extractorSha256 ?? "")) fail("extractorSha256 must bind the exact extractor implementation");
  const text = utf8Text(rawBytes, "official pricing raw capture", RAW_MAX_BYTES);
  exactlyOnce(text, '<div id="latest-models" className="pricing-switcher-layout">', "latest-models section");
  const sectionStart = text.indexOf('<div id="latest-models" className="pricing-switcher-layout">');
  const standardMarker = '<div data-content-switcher-pane data-value="standard">';
  const batchMarker = '<div data-content-switcher-pane data-value="batch" hidden>';
  const standardStart = text.indexOf(standardMarker, sectionStart);
  const standardEnd = text.indexOf(batchMarker, standardStart + standardMarker.length);
  if (standardStart < 0 || standardEnd < 0 || standardEnd <= standardStart) fail("official pricing capture omits the complete Flagship Standard pane boundary");
  const prefix = text.slice(sectionStart, standardStart);
  const pane = text.slice(standardStart, standardEnd);
  if (!prefix.includes("Flagship models") || !prefix.includes("Our latest models") || !prefix.includes("Prices per 1M tokens.")) {
    fail("official pricing capture omits the Flagship price header and per-1M-token unit");
  }
  exactlyOnce(pane, '<div class="hidden">Standard</div>', "Standard tier label");
  exactlyOnce(pane, 'tier="standard"', "Standard tier parameter");

  const target = new Set(OFFICIAL_PRICING_ROWS.map((row) => row[0]));
  const rows = [];
  const rowPattern = /^\s*\["(gpt-5\.6-(?:sol|terra|luna))",\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?)\],\s*$/gm;
  for (const match of pane.matchAll(rowPattern)) {
    if (!target.has(match[1])) continue;
    rows.push([match[1], ...match.slice(2).map(Number)]);
  }
  exactRows(rows, "extracted pricing rows");
  const extraction = {
    schemaVersion: OFFICIAL_PRICING_EXTRACTION_SCHEMA_VERSION,
    sourceUrl: OFFICIAL_PRICING_SOURCE_URL,
    sourceHeader: "Prices per 1M tokens.",
    tier: OFFICIAL_PRICING_TIER,
    unit: OFFICIAL_PRICING_UNIT,
    columns: [...OFFICIAL_PRICING_COLUMNS],
    rows,
    rawSha256: sha256(rawBytes),
    extractorSha256,
  };
  validateOfficialPricingExtraction(extraction);
  return Object.freeze(extraction);
}

export function validateOfficialPricingExtraction(value) {
  exactKeys(value, ["columns", "extractorSha256", "rawSha256", "rows", "schemaVersion", "sourceHeader", "sourceUrl", "tier", "unit"], "official pricing extraction");
  if (value.schemaVersion !== OFFICIAL_PRICING_EXTRACTION_SCHEMA_VERSION
    || value.sourceUrl !== OFFICIAL_PRICING_SOURCE_URL
    || value.sourceHeader !== "Prices per 1M tokens."
    || value.tier !== OFFICIAL_PRICING_TIER
    || value.unit !== OFFICIAL_PRICING_UNIT) fail("official pricing extraction source contract is invalid");
  exactArray(value.columns, OFFICIAL_PRICING_COLUMNS, "official pricing columns");
  if (!SHA256.test(value.rawSha256 ?? "") || !SHA256.test(value.extractorSha256 ?? "")) fail("official pricing extraction hashes are invalid");
  exactRows(value.rows);
  return value;
}

export function officialPricingExtractionBytes(value) {
  validateOfficialPricingExtraction(value);
  return Buffer.from(`${canonicalizeAttestationPayload(value)}\n`, "utf8");
}

export function createOfficialPricingRetrievalPayload({ candidate, retrieval, evidence, extraction }) {
  exactCandidate(candidate);
  exactKeys(retrieval, ["method", "request", "retrievedAt", "sourceUrl", "tool"], "pricing retrieval");
  exactKeys(retrieval.request, ["url"], "pricing retrieval request");
  if (retrieval.method !== OFFICIAL_PRICING_RETRIEVAL_METHOD
    || retrieval.tool !== OFFICIAL_PRICING_RETRIEVAL_TOOL
    || retrieval.sourceUrl !== OFFICIAL_PRICING_SOURCE_URL
    || retrieval.request.url !== OFFICIAL_PRICING_SOURCE_URL) fail("pricing retrieval must use the exact official Developer Docs MCP request");
  canonicalTimestamp(retrieval.retrievedAt, "pricing retrieval retrievedAt");
  exactKeys(evidence, ["extractor", "parsed", "raw"], "pricing evidence");
  evidenceReference(evidence.raw, "pricing raw evidence", RAW_MAX_BYTES);
  evidenceReference(evidence.extractor, "pricing extractor evidence", EXTRACTOR_MAX_BYTES);
  evidenceReference(evidence.parsed, "pricing parsed evidence", PARSED_MAX_BYTES);
  if (new Set([evidence.raw.path, evidence.extractor.path, evidence.parsed.path]).size !== 3) fail("pricing evidence paths must be unique");
  validateOfficialPricingExtraction(extraction);
  if (extraction.rawSha256 !== evidence.raw.sha256 || extraction.extractorSha256 !== evidence.extractor.sha256) {
    fail("pricing extraction does not bind its raw capture and extractor implementation");
  }
  const parsedSha256 = sha256(officialPricingExtractionBytes(extraction));
  if (parsedSha256 !== evidence.parsed.sha256) fail("pricing parsed evidence hash does not match deterministic extraction bytes");
  return Object.freeze({
    schemaVersion: OFFICIAL_PRICING_PAYLOAD_SCHEMA_VERSION,
    type: "officialOpenAiPricingRetrieval",
    purpose: OFFICIAL_PRICING_RETRIEVAL_PURPOSE,
    candidate: { ...candidate },
    retrieval: {
      ...retrieval,
      request: { ...retrieval.request },
    },
    pricing: {
      sourceUrl: OFFICIAL_PRICING_SOURCE_URL,
      tier: OFFICIAL_PRICING_TIER,
      unit: OFFICIAL_PRICING_UNIT,
      columns: [...OFFICIAL_PRICING_COLUMNS],
      rows: OFFICIAL_PRICING_ROWS.map((row) => [...row]),
      lowerCostModel: OFFICIAL_PRICING_LOWER_COST_MODEL,
      comparatorModels: [...OFFICIAL_PRICING_COMPARATOR_MODELS],
    },
    evidence: {
      raw: { ...evidence.raw },
      extractor: { ...evidence.extractor },
      parsed: { ...evidence.parsed },
    },
  });
}

function attestationStatement(value) {
  return {
    algorithm: value.algorithm,
    keyId: value.keyId,
    payloadSha256: value.payloadSha256,
    payloadType: value.payloadType,
    purpose: value.purpose,
    schemaVersion: value.schemaVersion,
    signatureEncoding: value.signatureEncoding,
    signedAt: value.signedAt,
  };
}

function signingBytes(value) {
  return Buffer.from(`${SIGNING_DOMAIN}${canonicalizeAttestationPayload(attestationStatement(value))}`, "utf8");
}

export function signOfficialPricingRetrievalAttestation({ payload, privateKey, keyId, signedAt }) {
  validateOfficialPricingRetrievalPayload(payload);
  if (!ID.test(keyId ?? "")) fail("pricing retrieval keyId is invalid");
  canonicalTimestamp(signedAt, "pricing retrieval signedAt");
  if (keyId === payload.candidate.authorityId) fail("pricing retrieval authority must be distinct from the candidate authority");
  let key;
  try {
    key = privateKey instanceof KeyObject ? privateKey : createPrivateKey(privateKey);
  } catch (error) {
    fail(`pricing retrieval private key is invalid: ${error.message}`);
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") fail("pricing retrieval private key must be Ed25519");
  const envelope = {
    schemaVersion: OFFICIAL_PRICING_ATTESTATION_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId,
    signedAt,
    payloadType: "officialOpenAiPricingRetrieval",
    purpose: OFFICIAL_PRICING_RETRIEVAL_PURPOSE,
    payloadSha256: sha256(Buffer.from(canonicalizeAttestationPayload(payload), "utf8")),
    signatureEncoding: "base64url",
  };
  return Object.freeze({ ...envelope, signature: sign(null, signingBytes(envelope), key).toString("base64url") });
}

export function validateOfficialPricingRetrievalPayload(value) {
  exactKeys(value, ["candidate", "evidence", "pricing", "purpose", "retrieval", "schemaVersion", "type"], "pricing retrieval payload");
  if (value.schemaVersion !== OFFICIAL_PRICING_PAYLOAD_SCHEMA_VERSION
    || value.type !== "officialOpenAiPricingRetrieval"
    || value.purpose !== OFFICIAL_PRICING_RETRIEVAL_PURPOSE) fail("pricing retrieval payload identity is invalid");
  exactCandidate(value.candidate);
  exactKeys(value.retrieval, ["method", "request", "retrievedAt", "sourceUrl", "tool"], "pricing retrieval");
  exactKeys(value.retrieval.request, ["url"], "pricing retrieval request");
  if (value.retrieval.method !== OFFICIAL_PRICING_RETRIEVAL_METHOD
    || value.retrieval.tool !== OFFICIAL_PRICING_RETRIEVAL_TOOL
    || value.retrieval.sourceUrl !== OFFICIAL_PRICING_SOURCE_URL
    || value.retrieval.request.url !== OFFICIAL_PRICING_SOURCE_URL) fail("pricing retrieval tool/request/source is invalid");
  canonicalTimestamp(value.retrieval.retrievedAt, "pricing retrieval retrievedAt");
  exactKeys(value.pricing, ["columns", "comparatorModels", "lowerCostModel", "rows", "sourceUrl", "tier", "unit"], "pricing claim");
  if (value.pricing.sourceUrl !== OFFICIAL_PRICING_SOURCE_URL || value.pricing.tier !== OFFICIAL_PRICING_TIER
    || value.pricing.unit !== OFFICIAL_PRICING_UNIT || value.pricing.lowerCostModel !== OFFICIAL_PRICING_LOWER_COST_MODEL) {
    fail("pricing claim source/tier/unit/model is invalid");
  }
  exactArray(value.pricing.columns, OFFICIAL_PRICING_COLUMNS, "pricing claim columns");
  exactArray(value.pricing.comparatorModels, OFFICIAL_PRICING_COMPARATOR_MODELS, "pricing comparator models");
  exactRows(value.pricing.rows, "pricing claim rows");
  exactKeys(value.evidence, ["extractor", "parsed", "raw"], "pricing evidence");
  evidenceReference(value.evidence.raw, "pricing raw evidence", RAW_MAX_BYTES);
  evidenceReference(value.evidence.extractor, "pricing extractor evidence", EXTRACTOR_MAX_BYTES);
  evidenceReference(value.evidence.parsed, "pricing parsed evidence", PARSED_MAX_BYTES);
  if (new Set([value.evidence.raw.path, value.evidence.extractor.path, value.evidence.parsed.path]).size !== 3) fail("pricing evidence paths must be unique");
  canonicalizeAttestationPayload(value);
  return value;
}

function trustedPricingKey(trustedKeys, keyId) {
  const entry = trustedKeys?.[keyId];
  exactKeys(entry, ["publicKey", "purposes"], `trusted pricing key ${keyId}`);
  if (!Array.isArray(entry.purposes) || entry.purposes.length !== 1 || entry.purposes[0] !== OFFICIAL_PRICING_RETRIEVAL_PURPOSE) {
    fail(`trusted pricing key ${keyId} must authorize only ${OFFICIAL_PRICING_RETRIEVAL_PURPOSE}`);
  }
  let key;
  try {
    key = createPublicKey(entry.publicKey);
  } catch (error) {
    fail(`trusted pricing key ${keyId} is invalid: ${error.message}`);
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") fail(`trusted pricing key ${keyId} must be Ed25519`);
  return key;
}

export function verifyOfficialPricingRetrievalAttestation({ payload, attestation, trustedKeys }) {
  validateOfficialPricingRetrievalPayload(payload);
  exactKeys(attestation, ["algorithm", "keyId", "payloadSha256", "payloadType", "purpose", "schemaVersion", "signature", "signatureEncoding", "signedAt"], "pricing retrieval attestation");
  if (attestation.schemaVersion !== OFFICIAL_PRICING_ATTESTATION_SCHEMA_VERSION
    || attestation.algorithm !== "Ed25519"
    || attestation.payloadType !== "officialOpenAiPricingRetrieval"
    || attestation.purpose !== OFFICIAL_PRICING_RETRIEVAL_PURPOSE
    || attestation.signatureEncoding !== "base64url") fail("pricing retrieval attestation envelope is invalid");
  if (!ID.test(attestation.keyId ?? "") || attestation.keyId === payload.candidate.authorityId) {
    fail("pricing retrieval authority must be trusted and distinct from the candidate authority");
  }
  canonicalTimestamp(attestation.signedAt, "pricing retrieval signedAt");
  const expectedPayloadSha256 = sha256(Buffer.from(canonicalizeAttestationPayload(payload), "utf8"));
  if (attestation.payloadSha256 !== expectedPayloadSha256) fail("pricing retrieval attestation does not bind the exact payload");
  const publicKey = trustedPricingKey(trustedKeys, attestation.keyId);
  const signature = Buffer.from(attestation.signature ?? "", "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== attestation.signature
    || !verify(null, signingBytes(attestation), publicKey, signature)) fail("pricing retrieval attestation signature verification failed");
  return attestation;
}

function exactExpectedCandidate(observed, expected) {
  exactCandidate(observed);
  exactCandidate(expected);
  for (const key of ["authorityId", "candidateCommit", "nodekitSourceHash", "nodekitTarballSha256"]) {
    if (observed[key] !== expected[key]) fail(`pricing proof candidate ${key} does not match the campaign candidate`);
  }
}

export function validateOfficialPricingProof(value, {
  rawBytes,
  extractorBytes,
  parsedBytes,
  expectedCandidate,
  trustedKeys,
  referenceTime: reference = Date.now(),
  campaignStartedAt,
  maxAgeMs = OFFICIAL_PRICING_MAX_AGE_MS,
} = {}) {
  exactKeys(value, ["agentDriver", "attestation", "attestationPayload", "model", "passed", "schemaVersion"], "official pricing proof");
  if (value.schemaVersion !== OFFICIAL_PRICING_PROOF_SCHEMA_VERSION || value.passed !== true
    || value.agentDriver !== "codex" || value.model !== OFFICIAL_PRICING_LOWER_COST_MODEL) {
    fail("official pricing proof must bind the codex lower-cost lane to gpt-5.6-luna");
  }
  const payload = validateOfficialPricingRetrievalPayload(value.attestationPayload);
  exactExpectedCandidate(payload.candidate, expectedCandidate);
  const attestation = verifyOfficialPricingRetrievalAttestation({ payload, attestation: value.attestation, trustedKeys });

  const rawText = utf8Text(rawBytes, "official pricing raw capture", RAW_MAX_BYTES);
  void rawText;
  utf8Text(extractorBytes, "official pricing extractor", EXTRACTOR_MAX_BYTES);
  utf8Text(parsedBytes, "official pricing parsed output", PARSED_MAX_BYTES);
  const evidence = payload.evidence;
  if (rawBytes.length !== evidence.raw.bytes || sha256(rawBytes) !== evidence.raw.sha256
    || extractorBytes.length !== evidence.extractor.bytes || sha256(extractorBytes) !== evidence.extractor.sha256
    || parsedBytes.length !== evidence.parsed.bytes || sha256(parsedBytes) !== evidence.parsed.sha256) {
    fail("official pricing proof evidence bytes do not match the attested hashes and sizes");
  }
  const first = extractOfficialOpenAiStandardPricing(rawBytes, { extractorSha256: evidence.extractor.sha256 });
  const second = extractOfficialOpenAiStandardPricing(Buffer.from(rawBytes), { extractorSha256: evidence.extractor.sha256 });
  const firstBytes = officialPricingExtractionBytes(first);
  const secondBytes = officialPricingExtractionBytes(second);
  if (!firstBytes.equals(secondBytes)) fail("official pricing extractor is nondeterministic");
  if (!firstBytes.equals(parsedBytes)) fail("official pricing parsed output is not the deterministic extractor output");
  if (canonicalizeAttestationPayload(payload.pricing) !== canonicalizeAttestationPayload({
    sourceUrl: first.sourceUrl,
    tier: first.tier,
    unit: first.unit,
    columns: first.columns,
    rows: first.rows,
    lowerCostModel: OFFICIAL_PRICING_LOWER_COST_MODEL,
    comparatorModels: [...OFFICIAL_PRICING_COMPARATOR_MODELS],
  })) fail("attested pricing claim does not match the deterministic extractor output");

  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > OFFICIAL_PRICING_MAX_AGE_MS) fail("pricing proof maxAgeMs is invalid");
  const retrievedAtMs = canonicalTimestamp(payload.retrieval.retrievedAt, "pricing retrieval retrievedAt");
  const signedAtMs = canonicalTimestamp(attestation.signedAt, "pricing retrieval signedAt");
  const campaignStartedAtMs = canonicalTimestamp(campaignStartedAt, "pricing campaignStartedAt");
  const referenceMs = referenceTime(reference, "pricing proof referenceTime");
  if (signedAtMs < retrievedAtMs) fail("pricing retrieval was signed before it was captured");
  if (retrievedAtMs > campaignStartedAtMs || signedAtMs > campaignStartedAtMs) fail("pricing retrieval or signature was captured after the campaign started");
  if (retrievedAtMs > referenceMs || signedAtMs > referenceMs) fail("pricing retrieval or signature is future-dated");
  const campaignAgeMs = campaignStartedAtMs - retrievedAtMs;
  const ageMs = referenceMs - retrievedAtMs;
  if (campaignAgeMs > maxAgeMs) fail("pricing retrieval was stale when the campaign started");
  if (ageMs > maxAgeMs) fail("pricing retrieval is stale at validation time");

  return Object.freeze({
    schemaVersion: "nodekit.official-pricing-validation/v1",
    source: OFFICIAL_PRICING_SOURCE_URL,
    tier: OFFICIAL_PRICING_TIER,
    unit: OFFICIAL_PRICING_UNIT,
    columns: [...OFFICIAL_PRICING_COLUMNS],
    verifiedModels: OFFICIAL_PRICING_ROWS.map((row) => row[0]),
    verifiedDimensions: OFFICIAL_PRICING_COLUMNS.slice(1),
    rawSha256: evidence.raw.sha256,
    extractorSha256: evidence.extractor.sha256,
    parsedSha256: evidence.parsed.sha256,
    payloadSha256: attestation.payloadSha256,
    attestationKeyId: attestation.keyId,
    retrievedAt: payload.retrieval.retrievedAt,
    signedAt: attestation.signedAt,
    campaignStartedAt,
    ageMs,
    campaignAgeMs,
  });
}

export function officialPricingSha256(bytes) {
  return sha256(bytes);
}
