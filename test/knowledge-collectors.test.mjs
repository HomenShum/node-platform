import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  evidenceSnapshotToGraphNode,
  ingestEvidenceBytes,
  ingestEvidenceFile,
  readContainedEvidenceFile,
  readEvidenceSnapshot,
  validateEvidenceSnapshotDocument,
  verifyEvidenceSnapshot,
} from "../src/lib/evidence-snapshots.mjs";
import {
  collectExternalResearch,
  createFieldMappingResearchNormalizer,
  createIdentityResearchNormalizer,
  createLocalFixtureResearchProvider,
  fetchResearchProvider,
  normalizeResearchResult,
  searchResearchProvider,
} from "../src/lib/research-collector.mjs";
import {
  initializeKnowledgeGraph,
  readKnowledgeGraph,
  validateGraphPatch,
} from "../src/lib/knowledge-evolution.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const execFileAsync = promisify(execFile);
const capturedAt = "2026-07-22T12:00:00.000Z";
const expiresAt = "2027-07-22T12:00:00.000Z";
const actor = {
  agentId: "agent:collector-test",
  modelRoute: "deterministic",
  resolvedModel: "fixture",
  harnessVersion: "h0",
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function rootFor(t, prefix = "nodekit-collector-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test("public package modules expose the typed evidence and collector ports", async () => {
  const evidenceApi = await import("../src/evidence-snapshots.mjs");
  const researchApi = await import("../src/research-collector.mjs");
  const rootApi = await import("../src/index.mjs");
  assert.equal(evidenceApi.EVIDENCE_SNAPSHOT_SCHEMA, "nodekit.evidence-snapshot/v1");
  assert.equal(researchApi.RESEARCH_PROVIDER_CONTRACT, "nodekit.research-provider/v1");
  assert.equal(rootApi.ingestEvidenceBytes, evidenceApi.ingestEvidenceBytes);
  assert.equal(rootApi.collectExternalResearch, researchApi.collectExternalResearch);
});

test("evidence ingest hashes opened bytes, persists an immutable snapshot, and rechecks anchors and freshness", async (t) => {
  const root = await rootFor(t);
  const bytes = Buffer.from("alpha evidence\nbeta evidence\n", "utf8");
  await writeFile(path.join(root, "evidence.txt"), bytes);
  const { snapshot, sourcePath } = await ingestEvidenceFile(root, {
    file: "evidence.txt",
    sourceUri: "https://example.test/evidence.txt",
    mediaType: "text/plain",
    capturedAt,
    expiresAt,
    expectedSha256: hash(bytes),
    locators: [{ kind: "text", source: "user", startByte: 0, endByte: 14 }],
  });
  assert.equal(sourcePath, "evidence.txt");
  assert.equal(snapshot.raw.sha256, hash(bytes));
  assert.equal(snapshot.raw.byteLength, bytes.length);
  assert.equal(snapshot.locators[0].anchorSha256, hash(bytes.subarray(0, 14)));
  assert.deepEqual(await validateSchema("nodekit.evidence-snapshot.v1.schema.json", snapshot, "snapshot"), []);
  assert.equal((await readEvidenceSnapshot(root, snapshot.snapshotId)).contentHash, snapshot.contentHash);
  const verified = await verifyEvidenceSnapshot(root, snapshot.snapshotId, { at: "2026-08-01T00:00:00.000Z" });
  assert.equal(verified.passed, true);
  assert.equal(verified.hashMatches, true);
  assert.equal(verified.locatorChecks[0].passed, true);
  const stale = await verifyEvidenceSnapshot(root, snapshot.snapshotId, { at: "2028-08-01T00:00:00.000Z" });
  assert.equal(stale.passed, false);
  assert.equal(stale.fresh, false);

  const node = evidenceSnapshotToGraphNode(snapshot, { label: "Exact source bytes", properties: { purpose: "test" } });
  assert.equal(node.contentHash, snapshot.raw.sha256);
  assert.equal(node.properties.locators[0].anchorSha256, snapshot.locators[0].anchorSha256);
});

test("typed PDF, image, and video locators retain supplied positions and verify exact byte anchors", async (t) => {
  const root = await rootFor(t);
  const fixtures = [
    {
      bytes: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF", "ascii"),
      uri: "https://example.test/report.pdf",
      mediaType: "application/pdf",
      locator: { kind: "pdf-page", source: "parser", pageNumber: 1, startByte: 9, endByte: 37 },
    },
    {
      bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("fixture-pixels")]),
      uri: "https://example.test/image.png",
      mediaType: "image/png",
      locator: { kind: "image-region", source: "user", coordinateSpace: "normalized", x: 0.1, y: 0.2, width: 0.3, height: 0.4, startByte: 0, endByte: 8 },
    },
    {
      bytes: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisomfixture-video")]),
      uri: "https://example.test/video.mp4",
      mediaType: "video/mp4",
      locator: { kind: "video-range", source: "provider", startMs: 1000, endMs: 2500, startByte: 4, endByte: 12 },
    },
  ];
  for (const fixture of fixtures) {
    const snapshot = await ingestEvidenceBytes(root, {
      bytes: fixture.bytes,
      sourceUri: fixture.uri,
      mediaType: fixture.mediaType,
      capturedAt,
      locators: [fixture.locator],
    });
    assert.equal(snapshot.locators[0].source, fixture.locator.source, "the pipeline must retain rather than invent locator provenance");
    assert.equal((await verifyEvidenceSnapshot(root, snapshot.snapshotId)).passed, true);
    assert.deepEqual(await validateSchema("nodekit.evidence-snapshot.v1.schema.json", snapshot, "snapshot"), []);
  }
});

test("evidence ingest rejects caller-hash mismatches, duplicates, escaping paths, symlinks, and byte/locator overruns", async (t) => {
  const root = await rootFor(t);
  const bytes = Buffer.from("bounded source", "utf8");
  await writeFile(path.join(root, "source.txt"), bytes);
  await assert.rejects(() => ingestEvidenceFile(root, {
    file: "source.txt", sourceUri: "https://example.test/hash", mediaType: "text/plain", capturedAt, expectedSha256: "0".repeat(64),
  }), /SHA-256 mismatch/);
  await assert.rejects(() => ingestEvidenceFile(root, {
    file: "../outside.txt", sourceUri: "https://example.test/escape", mediaType: "text/plain", capturedAt,
  }), /must stay inside/);
  await assert.rejects(() => ingestEvidenceFile(root, {
    file: "source.txt", sourceUri: "https://example.test/limit", mediaType: "text/plain", capturedAt,
  }, { limits: { maximumBytes: 2 } }), /byte limit exceeded/);
  await assert.rejects(() => ingestEvidenceBytes(root, {
    bytes, sourceUri: "https://example.test/spoofed-pdf", mediaType: "application/pdf", capturedAt,
  }), /missing the PDF signature/);
  await assert.rejects(() => ingestEvidenceBytes(root, {
    bytes, sourceUri: "https://example.test/locator-limit", mediaType: "text/plain", capturedAt,
    locators: [
      { kind: "text", source: "user", startByte: 0, endByte: 1 },
      { kind: "text", source: "user", startByte: 1, endByte: 2 },
    ],
  }, { limits: { maximumLocators: 1 } }), /locator limit exceeded/);
  await assert.rejects(() => ingestEvidenceBytes(root, {
    bytes, sourceUri: "https://example.test/unattributed-locator", mediaType: "text/plain", capturedAt,
    locators: [{ kind: "text", startByte: 0, endByte: 2 }],
  }), /must identify user, provider, or parser provenance/);
  await assert.rejects(() => ingestEvidenceBytes(root, {
    bytes, sourceUri: "https://example.test/store-escape", mediaType: "text/plain", capturedAt,
  }, { storePath: "../escaped-store" }), /must stay inside/);
  await ingestEvidenceBytes(root, { bytes, sourceUri: "https://example.test/duplicate", mediaType: "text/plain", capturedAt });
  await assert.rejects(() => ingestEvidenceBytes(root, { bytes, sourceUri: "https://example.test/duplicate", mediaType: "text/plain", capturedAt }), /duplicate evidence snapshot/);

  const outside = await rootFor(t, "nodekit-collector-outside-");
  await writeFile(path.join(outside, "linked.txt"), bytes);
  const link = path.join(root, "linked-directory");
  await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => ingestEvidenceFile(root, {
    file: "linked-directory/linked.txt", sourceUri: "https://example.test/symlink", mediaType: "text/plain", capturedAt,
  }), /symbolic link/);

  const unsafeStoreRoot = await rootFor(t, "nodekit-collector-store-link-");
  const outsideStore = await rootFor(t, "nodekit-collector-outside-store-");
  await mkdir(path.join(unsafeStoreRoot, ".nodeagent"));
  await symlink(outsideStore, path.join(unsafeStoreRoot, ".nodeagent", "evidence"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => ingestEvidenceBytes(unsafeStoreRoot, {
    bytes, sourceUri: "https://example.test/store-symlink", mediaType: "text/plain", capturedAt,
  }), /symbolic link/);
});

test("snapshot verification detects tampered content-addressed bytes", async (t) => {
  const root = await rootFor(t);
  const snapshot = await ingestEvidenceBytes(root, {
    bytes: Buffer.from("immutable bytes", "utf8"), sourceUri: "https://example.test/tamper", mediaType: "text/plain", capturedAt,
  });
  await writeFile(path.join(root, snapshot.raw.blobPath), Buffer.from("corrupted bytes", "utf8"));
  const verification = await verifyEvidenceSnapshot(root, snapshot.snapshotId);
  assert.equal(verification.passed, false);
  assert.equal(verification.hashMatches, false);
});

test("snapshot identity binds metadata filename, source tuple, blob path, and present bytes", async (t) => {
  const root = await rootFor(t);
  const first = await ingestEvidenceBytes(root, {
    bytes: Buffer.from("first identity bytes", "utf8"), sourceUri: "https://example.test/identity-first", mediaType: "text/plain", capturedAt,
  });
  const second = await ingestEvidenceBytes(root, {
    bytes: Buffer.from("second identity bytes", "utf8"), sourceUri: "https://example.test/identity-second", mediaType: "text/plain", capturedAt,
  });
  const firstMetadata = path.join(root, ".nodeagent", "evidence", "snapshots", `${first.snapshotId}.json`);
  await writeFile(firstMetadata, `${JSON.stringify(second, null, 2)}\n`);
  await assert.rejects(() => readEvidenceSnapshot(root, first.snapshotId), /does not match requested metadata filename/);

  const wrongBlob = structuredClone(second);
  wrongBlob.raw.blobPath = `.nodeagent/evidence/blobs/sha256/00/${"0".repeat(64)}.bin`;
  assert.ok(validateEvidenceSnapshotDocument(wrongBlob).some((error) => error.includes("blobPath does not match raw.sha256")));
  const wrongId = structuredClone(second);
  wrongId.snapshotId = `evidence_${"0".repeat(24)}`;
  assert.ok(validateEvidenceSnapshotDocument(wrongId).some((error) => error.includes("snapshotId does not match")));

  await rm(path.join(root, second.raw.blobPath));
  await assert.rejects(() => verifyEvidenceSnapshot(root, second.snapshotId), /ENOENT|no such file/i);
});

test("stable evidence reads reject source, metadata, and blob mutations after open", async (t) => {
  const sourceRoot = await rootFor(t);
  const sourcePath = path.join(sourceRoot, "source.txt");
  await writeFile(sourcePath, "stable source bytes");
  await assert.rejects(() => readContainedEvidenceFile(sourceRoot, "source.txt", {
    beforeStableRead: async ({ target }) => writeFile(target, "changed source bytes"),
  }), /identity or size changed while reading/);

  const metadataRoot = await rootFor(t);
  const metadataSnapshot = await ingestEvidenceBytes(metadataRoot, {
    bytes: Buffer.from("stable metadata bytes", "utf8"), sourceUri: "https://example.test/stable-metadata", mediaType: "text/plain", capturedAt,
  });
  await assert.rejects(() => readEvidenceSnapshot(metadataRoot, metadataSnapshot.snapshotId, {
    beforeMetadataRead: async ({ target }) => writeFile(target, await readFile(target)),
  }), /identity or size changed while reading/);

  const blobRoot = await rootFor(t);
  const blobSnapshot = await ingestEvidenceBytes(blobRoot, {
    bytes: Buffer.from("stable blob bytes", "utf8"), sourceUri: "https://example.test/stable-blob", mediaType: "text/plain", capturedAt,
  });
  await assert.rejects(() => verifyEvidenceSnapshot(blobRoot, blobSnapshot.snapshotId, {
    beforeBlobRead: async ({ target }) => writeFile(target, await readFile(target)),
  }), /identity or size changed while reading/);
});

test("provider-neutral collector separates normalization, preserves raw search/fetch provenance, and only proposes graph changes", async (t) => {
  const root = await rootFor(t);
  await initializeKnowledgeGraph(root, { graphId: "knowledge:research" });
  const body = Buffer.from("A domain-blank source about governed evidence.", "utf8");
  await writeFile(path.join(root, "source.txt"), body);
  const fixture = {
    providerId: "fixture-local",
    providerVersion: "2026.07",
    capturedAt,
    documents: [{
      uri: "https://example.test/governed-evidence",
      title: "Governed evidence source",
      terms: "governed evidence",
      file: "source.txt",
      mediaType: "text/plain",
      capturedAt,
      expiresAt,
      locators: [{ kind: "text", source: "provider", startByte: 2, endByte: 14 }],
      metadata: { publisher: "Fixture Publisher" },
    }],
  };
  const provider = createLocalFixtureResearchProvider(root, fixture);
  const customNormalizer = createFieldMappingResearchNormalizer({
    id: "test.metadata-normalizer",
    version: "1",
    labelTransform: "uppercase",
    confidence: 0.9,
    metadataFields: ["publisher"],
  });
  const normalized = normalizeResearchResult({ title: "Title", metadata: { publisher: "P" } }, customNormalizer);
  assert.equal(normalized.label, "TITLE");

  const result = await collectExternalResearch(root, {
    provider,
    query: "governed evidence",
    normalizer: customNormalizer,
    runId: "run:research",
    caseId: "case:research",
    actorId: "agent:research",
    proposedBy: actor,
    limits: { maximumSearches: 1, maximumResultsPerSearch: 2, maximumFetches: 1 },
  });
  assert.equal(result.proposalOnly, true);
  assert.equal(result.collection.proposalOnly, true);
  assert.equal(result.collection.canonicalGraphVersionBefore, 0);
  assert.equal(result.collection.canonicalGraphVersionAfter, 0);
  assert.equal(result.collection.searches.length, 1);
  assert.equal(result.collection.fetches.length, 1);
  assert.equal(result.collection.fetches[0].provenance.rawByteSha256, hash(body));
  assert.match(result.collection.searches[0].provenance.rawByteSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await validateSchema("nodekit.research-collection.v1.schema.json", result.collection, "collection"), []);
  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.version, 0);
  assert.equal(graph.nodes.length, 0, "collection cannot directly mutate canonical graph nodes");
  assert.equal(graph.proposals.length, 1);
  assert.equal(graph.proposals[0].operations.length, 2, "search response and fetched document are both byte-backed evidence proposals");
  assert.equal((await validateGraphPatch(root, result.patch.patchId)).validation.sourceGrounded, true);
  for (const entry of [...result.collection.searches, ...result.collection.fetches]) {
    assert.equal((await verifyEvidenceSnapshot(root, entry.snapshotId)).passed, true);
  }
  const persisted = JSON.parse(await readFile(path.join(root, result.collectionPath), "utf8"));
  assert.equal(persisted.contentHash, result.collection.contentHash);
});

test("research ports reject provider URI/duplicate/limit violations before graph proposal", async (t) => {
  const root = await rootFor(t);
  await initializeKnowledgeGraph(root, { graphId: "knowledge:bad-provider" });
  const searchBytes = Buffer.from("{}", "utf8");
  const badDuplicateProvider = {
    contractVersion: "nodekit.research-provider/v1",
    id: "bad-duplicate",
    version: "1",
    async search() {
      return {
        uri: "https://example.test/search",
        capturedAt,
        rawBytes: searchBytes,
        results: [
          { uri: "https://example.test/same", title: "One", mediaType: "text/plain" },
          { uri: "https://example.test/same", title: "Two", mediaType: "text/plain" },
        ],
      };
    },
    async fetch(uri) { return { uri, capturedAt, mediaType: "text/plain", rawBytes: Buffer.from("x") }; },
  };
  await assert.rejects(() => searchResearchProvider(badDuplicateProvider, "q", {
    maximumSearches: 1, maximumResultsPerSearch: 2, maximumFetches: 1,
  }), /duplicate research result URI/);
  await assert.rejects(() => searchResearchProvider({ ...badDuplicateProvider, async search() {
    return { uri: "https://example.test/search", capturedAt, rawBytes: searchBytes, results: Array.from({ length: 3 }, (_, index) => ({ uri: `https://example.test/${index}`, title: `${index}`, mediaType: "text/plain" })) };
  } }, "q", { maximumSearches: 1, maximumResultsPerSearch: 2, maximumFetches: 1 }), /result limit exceeded/);
  const mismatchProvider = {
    ...badDuplicateProvider,
    id: "bad-fetch-uri",
    async fetch() { return { uri: "https://example.test/different", capturedAt, mediaType: "text/plain", rawBytes: Buffer.from("x") }; },
  };
  await assert.rejects(() => fetchResearchProvider(mismatchProvider, { uri: "https://example.test/requested", mediaType: "text/plain" }, {
    maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1,
  }), /fetch URI mismatch/);
  const slowProvider = {
    ...badDuplicateProvider,
    id: "slow-provider",
    async search() { return new Promise(() => {}); },
  };
  await assert.rejects(() => searchResearchProvider(slowProvider, "q", {
    maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1, maximumDurationMs: 10,
  }), /timed out/);
  await assert.rejects(() => searchResearchProvider({ ...badDuplicateProvider, async search() {
    return { uri: "https://example.test/search?token=secret", capturedAt, rawBytes: searchBytes, results: [] };
  } }, "q", { maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1 }), /without credentials, query parameters, or fragments/);
  await assert.rejects(() => searchResearchProvider({ ...badDuplicateProvider, async search() {
    return {
      uri: "https://example.test/search", capturedAt, rawBytes: searchBytes,
      results: [{ uri: "https://example.test/large-metadata", title: "Large", mediaType: "text/plain", metadata: { value: "x".repeat(100) } }],
    };
  } }, "q", {
    maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1, maximumMetadataBytesPerResult: 32,
  }), /metadata byte limit exceeded/);
  await assert.rejects(() => collectExternalResearch(root, {
    provider: badDuplicateProvider,
    query: "q",
    runId: "run:unisolated",
    caseId: "case:unisolated",
    proposedBy: actor,
    limits: { maximumSearches: 1, maximumResultsPerSearch: 2, maximumFetches: 1 },
  }), /NodeKit-constructed isolated provider/);
  await writeFile(path.join(root, "normalizer.txt"), "normalizer result");
  const safeProviderForNormalizer = createLocalFixtureResearchProvider(root, {
    providerId: "normalizer-provider", providerVersion: "1", capturedAt,
    documents: [{ uri: "https://example.test/normalizer", title: "Normalizer", mediaType: "text/plain", file: "normalizer.txt", terms: "normalizer" }],
  });
  await assert.rejects(() => collectExternalResearch(root, {
    provider: safeProviderForNormalizer,
    normalizer: { id: "arbitrary", version: "1", normalize: () => ({ label: "unsafe" }) },
    query: "normalizer",
    runId: "run:unsafe-normalizer",
    caseId: "case:unsafe-normalizer",
    proposedBy: actor,
    limits: { maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1 },
  }), /NodeKit-constructed declarative normalizer/);

  await writeFile(path.join(root, "cumulative.txt"), "result");
  const cumulativeSlowProvider = createLocalFixtureResearchProvider(root, {
    providerId: "cumulative-slow-provider", providerVersion: "1", capturedAt, searchDelayMs: 7, fetchDelayMs: 7,
    documents: [{ uri: "https://example.test/cumulative-result", title: "Result", mediaType: "text/plain", file: "cumulative.txt", terms: "q" }],
  });
  await assert.rejects(() => collectExternalResearch(root, {
    provider: cumulativeSlowProvider,
    query: "q",
    runId: "run:cumulative-time-limit",
    caseId: "case:cumulative-time-limit",
    proposedBy: actor,
    limits: { maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1, maximumDurationMs: 10 },
  }), /research collection timed out|timed out after/);

  await writeFile(path.join(root, "large.txt"), Buffer.alloc(499, "a"));
  const totalLimitProvider = createLocalFixtureResearchProvider(root, {
    providerId: "total-limit", providerVersion: "1", capturedAt,
    documents: [{ uri: "https://example.test/large", title: "Large", mediaType: "text/plain", file: "large.txt", terms: "q" }],
  });
  await assert.rejects(() => collectExternalResearch(root, {
    provider: totalLimitProvider,
    query: "q",
    runId: "run:limit",
    caseId: "case:limit",
    proposedBy: actor,
    limits: { maximumSearches: 1, maximumResultsPerSearch: 1, maximumFetches: 1, maximumBytesPerFetch: 500, maximumTotalBytes: 500 },
  }), /total byte limit exceeded/);
  assert.equal((await readKnowledgeGraph(root)).proposals.length, 0);
});

test("domain-blank CLI snapshots local bytes, verifies them, and runs fixture research as a pending proposal", async (t) => {
  const root = await rootFor(t, "nodekit-collector-cli-");
  const cli = path.resolve("src", "cli.mjs");
  const run = async (...args) => JSON.parse((await execFileAsync(process.execPath, [cli, ...args, "--repo-root", root, "--json"])).stdout);
  await run("graph", "init", "--graph-id", "knowledge:collector-cli");
  await writeFile(path.join(root, "manual.txt"), "manual immutable bytes\n");
  const manual = await run(
    "graph", "evidence-ingest", "--file", "manual.txt", "--source-uri", "https://example.test/manual",
    "--media-type", "text/plain", "--captured-at", capturedAt, "--label", "Manual source",
  );
  assert.equal(manual.proposalOnly, true);
  assert.equal((await run("graph", "evidence-verify", "--snapshot", manual.snapshot.snapshotId)).passed, true);

  await writeFile(path.join(root, "research.txt"), "fixture research bytes\n");
  await writeFile(path.join(root, "provider.json"), `${JSON.stringify({
    providerId: "cli-fixture",
    providerVersion: "1",
    capturedAt,
    documents: [{
      uri: "https://example.test/cli-research", title: "CLI research", terms: "collector",
      file: "research.txt", mediaType: "text/plain", capturedAt,
    }],
  }, null, 2)}\n`);
  const research = await run("graph", "research", "collector", "--provider-fixture", "provider.json", "--run-id", "run:cli-research");
  assert.equal(research.proposalOnly, true);
  assert.equal(research.collection.fetches.length, 1);
  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.proposals.length, 2);
});
