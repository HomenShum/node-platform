import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  inspectNpmPackageArchiveBytes,
  inspectNpmPackageArchiveFile,
  NPM_PACKAGE_ARCHIVE_SCHEMA_VERSION,
  NpmPackageArchiveError,
} from "../src/lib/npm-package-archive.mjs";

const BLOCK_SIZE = 512;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeTextField(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  assert.ok(bytes.length <= length, `${value} does not fit in a ${length}-byte tar field`);
  bytes.copy(header, offset);
}

function writeOctalField(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  assert.equal(encoded.length, length - 1);
  header.write(encoded, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarHeader({ linkname = "", name, prefix = "", size, type = "0" }) {
  const header = Buffer.alloc(BLOCK_SIZE);
  writeTextField(header, 0, 100, name);
  writeOctalField(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, size);
  writeOctalField(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  writeTextField(header, 157, 100, linkname);
  Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]).copy(header, 257);
  header.write("00", 263, 2, "ascii");
  writeTextField(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function paxRecord(key, value) {
  const body = Buffer.from(`${key}=${value}\n`, "utf8");
  let length = body.length + 2;
  while (Buffer.byteLength(String(length), "ascii") + 1 + body.length !== length) {
    length = Buffer.byteLength(String(length), "ascii") + 1 + body.length;
  }
  return Buffer.concat([Buffer.from(`${length} `, "ascii"), body]);
}

function entryBytes({ body = "", linkname = "", name, pax = undefined, prefix = "", type = "0" }) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const pieces = [];
  if (pax !== undefined) {
    const paxBody = Buffer.concat(Object.entries(pax).map(([key, value]) => paxRecord(key, value)));
    pieces.push(
      tarHeader({ name: "PaxHeader/entry", size: paxBody.length, type: "x" }),
      paxBody,
      Buffer.alloc((BLOCK_SIZE - (paxBody.length % BLOCK_SIZE)) % BLOCK_SIZE),
    );
  }
  pieces.push(
    tarHeader({ linkname, name, prefix, size: data.length, type }),
    data,
    Buffer.alloc((BLOCK_SIZE - (data.length % BLOCK_SIZE)) % BLOCK_SIZE),
  );
  return pieces;
}

function npmArchive(entries, { endBlocks = 2 } = {}) {
  return gzipSync(Buffer.concat([
    ...entries.flatMap(entryBytes),
    Buffer.alloc(BLOCK_SIZE * endBlocks),
  ]), { level: 9 });
}

function validEntries() {
  const longRelativePath = `${"nested/".repeat(15)}proof.json`;
  return {
    entries: [
      { name: "package/README.md", body: "NodeKit package\n" },
      {
        name: "package/package.json",
        body: `${JSON.stringify({ name: "@homenshum/nodekit-fixture", version: "1.2.3", type: "module" }, null, 2)}\n`,
      },
      { name: "package/placeholder", pax: { path: `package/${longRelativePath}` }, body: "{\"passed\":true}\n" },
    ],
    longRelativePath,
  };
}

test("inspects an npm-shaped gzip tar, applies PAX paths, and emits a canonical file manifest", async () => {
  const { entries, longRelativePath } = validEntries();
  const archive = npmArchive(entries);
  const result = inspectNpmPackageArchiveBytes(archive, {
    expectedName: "@homenshum/nodekit-fixture",
    expectedTarballSha256: sha256(archive),
    expectedVersion: "1.2.3",
  });

  assert.equal(result.schemaVersion, NPM_PACKAGE_ARCHIVE_SCHEMA_VERSION);
  assert.equal(result.name, "@homenshum/nodekit-fixture");
  assert.equal(result.version, "1.2.3");
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.fileManifest.map(file => file.path), ["README.md", longRelativePath, "package.json"]);
  assert.equal(result.unpackedSize, entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.body), 0));
  assert.match(result.canonicalManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.tarballSha256, sha256(archive));
  assert.ok(result.fileManifest.every(file => file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256)));

  const root = await mkdtemp(path.join(tmpdir(), "nodekit-npm-archive-"));
  try {
    const archivePath = path.join(root, "fixture.tgz");
    await writeFile(archivePath, archive);
    assert.deepEqual(await inspectNpmPackageArchiveFile(archivePath), result);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("manifest identity is stable across tar ordering while the tarball identity remains byte-exact", () => {
  const { entries } = validEntries();
  const first = inspectNpmPackageArchiveBytes(npmArchive(entries));
  const secondArchive = npmArchive([entries[2], entries[0], entries[1]]);
  const second = inspectNpmPackageArchiveBytes(secondArchive);
  assert.deepEqual(second.fileManifest, first.fileManifest);
  assert.equal(second.canonicalManifestSha256, first.canonicalManifestSha256);
  assert.notEqual(second.tarballSha256, first.tarballSha256);
});

test("rejects traversal, absolute, backslash, dot-segment, and non-package paths", () => {
  const packageJson = { name: "package/package.json", body: '{"name":"safe","version":"1.0.0"}' };
  for (const invalid of ["package/../evil", "/package/evil", "package\\evil", "package/./evil", "other/evil"]) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(npmArchive([packageJson, { name: invalid, body: "bad" }])),
      error => error instanceof NpmPackageArchiveError && ["INVALID_PATH", "INVALID_PREFIX"].includes(error.code),
      invalid,
    );
  }
  assert.throws(
    () => inspectNpmPackageArchiveBytes(npmArchive([packageJson, { name: "package/safe", pax: { path: "package/../pax-escape" }, body: "bad" }])),
    error => error instanceof NpmPackageArchiveError && error.code === "INVALID_PATH",
  );
});

test("rejects symbolic links, hard links, and link targets hidden on regular entries", () => {
  const packageJson = { name: "package/package.json", body: '{"name":"safe","version":"1.0.0"}' };
  for (const entry of [
    { name: "package/link", body: "", linkname: "../outside", type: "2" },
    { name: "package/hard", body: "", linkname: "package/package.json", type: "1" },
    { name: "package/file", body: "x", linkname: "../outside", type: "0" },
    { name: "package/file", body: "x", pax: { linkpath: "../outside" }, type: "0" },
  ]) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(npmArchive([packageJson, entry])),
      error => error instanceof NpmPackageArchiveError && error.code === "LINK_ENTRY",
    );
  }
});

test("rejects exact, case-insensitive, and file-versus-directory path collisions", () => {
  const packageJson = { name: "package/package.json", body: '{"name":"safe","version":"1.0.0"}' };
  for (const entries of [
    [packageJson, { name: "package/a", body: "1" }, { name: "package/a", body: "2" }],
    [packageJson, { name: "package/Foo", body: "1" }, { name: "package/foo", body: "2" }],
    [packageJson, { name: "package/parent", body: "1" }, { name: "package/parent/child", body: "2" }],
    [packageJson, { name: "package/parent/child", body: "1" }, { name: "package/parent", body: "2" }],
  ]) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(npmArchive(entries)),
      error => error instanceof NpmPackageArchiveError && ["DUPLICATE_PATH", "PATH_COLLISION"].includes(error.code),
    );
  }
});

test("rejects header tampering, non-zero padding, trailing tar payload, and a missing second end block", () => {
  const archive = npmArchive(validEntries().entries);
  const checksumTampered = gunzipSync(archive);
  checksumTampered[0] ^= 1;
  assert.throws(
    () => inspectNpmPackageArchiveBytes(gzipSync(checksumTampered)),
    error => error instanceof NpmPackageArchiveError && error.code === "CHECKSUM_MISMATCH",
  );

  const paddingTampered = gunzipSync(npmArchive([{ name: "package/package.json", body: '{"name":"safe","version":"1.0.0"}' }]));
  const bodyLength = Buffer.byteLength('{"name":"safe","version":"1.0.0"}');
  paddingTampered[BLOCK_SIZE + bodyLength] = 1;
  assert.throws(
    () => inspectNpmPackageArchiveBytes(gzipSync(paddingTampered)),
    error => error instanceof NpmPackageArchiveError && error.code === "INVALID_PADDING",
  );

  const trailing = gunzipSync(npmArchive(validEntries().entries, { endBlocks: 3 }));
  trailing[trailing.length - 1] = 1;
  assert.throws(
    () => inspectNpmPackageArchiveBytes(gzipSync(trailing)),
    error => error instanceof NpmPackageArchiveError && error.code === "TRAILING_DATA",
  );

  assert.throws(
    () => inspectNpmPackageArchiveBytes(npmArchive(validEntries().entries, { endBlocks: 1 })),
    error => error instanceof NpmPackageArchiveError && error.code === "INVALID_TAR",
  );
});

test("rejects malformed package metadata and archives without package.json", () => {
  assert.throws(
    () => inspectNpmPackageArchiveBytes(npmArchive([{ name: "package/index.js", body: "export {};" }])),
    error => error instanceof NpmPackageArchiveError && error.code === "MISSING_PACKAGE_JSON",
  );
  for (const body of ["not json", "[]", '{"name":"safe"}', '{"name":" safe","version":"1.0.0"}']) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(npmArchive([{ name: "package/package.json", body }])),
      error => error instanceof NpmPackageArchiveError && error.code === "INVALID_PACKAGE_JSON",
    );
  }
});

test("fails closed on compressed, decompressed, file-count, entry, PAX, and unpacked-size limits", () => {
  const archive = npmArchive(validEntries().entries);
  const cases = [
    [{ maxArchiveBytes: archive.length - 1 }, "ARCHIVE_LIMIT"],
    [{ maxTarBytes: BLOCK_SIZE }, "INVALID_GZIP"],
    [{ maxFiles: 2 }, "FILE_LIMIT"],
    [{ maxEntryBytes: 20 }, "ENTRY_LIMIT"],
    [{ maxPaxBytes: 10 }, "ENTRY_LIMIT"],
    [{ maxUnpackedBytes: 30 }, "UNPACKED_LIMIT"],
  ];
  for (const [options, expectedCode] of cases) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(archive, options),
      error => error instanceof NpmPackageArchiveError && error.code === expectedCode,
      JSON.stringify(options),
    );
  }
});

test("rejects mismatched caller expectations", () => {
  const archive = npmArchive(validEntries().entries);
  for (const options of [
    { expectedName: "wrong" },
    { expectedVersion: "9.9.9" },
    { expectedTarballSha256: "0".repeat(64) },
  ]) {
    assert.throws(
      () => inspectNpmPackageArchiveBytes(archive, options),
      error => error instanceof NpmPackageArchiveError && error.code === "IDENTITY_MISMATCH",
    );
  }
});
