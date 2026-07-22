import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { gunzipSync } from "node:zlib";

export const NPM_PACKAGE_ARCHIVE_SCHEMA_VERSION = "nodekit.npm-package-archive/v1";
export const NPM_PACKAGE_FILE_MANIFEST_SCHEMA_VERSION = "nodekit.npm-package-file-manifest/v1";

const BLOCK_SIZE = 512;
const END_BLOCK_BYTES = BLOCK_SIZE * 2;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const SHA256 = /^[a-f0-9]{64}$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ASCII = new TextDecoder("ascii", { fatal: true });
const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
  maxFiles: 100_000,
  maxPaxBytes: 1024 * 1024,
  maxTarBytes: 256 * 1024 * 1024,
  maxUnpackedBytes: 256 * 1024 * 1024,
});

export class NpmPackageArchiveError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "NpmPackageArchiveError";
    this.code = code;
  }
}

function fail(code, message, options = undefined) {
  throw new NpmPackageArchiveError(code, message, options);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_LIMIT", `${label} must be a positive safe integer`);
  }
  return value;
}

function resolveLimits(options) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    limits[name] = positiveSafeInteger(options[name] ?? fallback, name);
  }
  return limits;
}

function exactBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail("INVALID_INPUT", "archiveBytes must be a Buffer or Uint8Array");
}

function decode(bytes, decoder, label) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    fail("INVALID_ENCODING", `${label} is not valid ${decoder === ASCII ? "ASCII" : "UTF-8"}`, { cause: error });
  }
}

function readTarString(header, start, length, label) {
  const field = header.subarray(start, start + length);
  const nul = field.indexOf(0);
  const content = nul < 0 ? field : field.subarray(0, nul);
  if (nul >= 0 && field.subarray(nul).some((byte) => byte !== 0)) {
    fail("INVALID_HEADER", `${label} contains bytes after its NUL terminator`);
  }
  return decode(content, UTF8, label);
}

function readTarNumber(header, start, length, label) {
  const field = header.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) {
    fail("UNSUPPORTED_TAR_NUMBER", `${label} uses an unsupported base-256 tar number`);
  }
  const value = decode(field, ASCII, label).replace(/[\0 ]+$/u, "").replace(/^ +/u, "");
  if (value === "") return 0;
  if (!/^[0-7]+$/u.test(value)) fail("INVALID_HEADER", `${label} is not a canonical octal tar number`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("INVALID_HEADER", `${label} exceeds the safe integer range`);
  return parsed;
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

function validateHeaderChecksum(header, entryIndex) {
  const expected = readTarNumber(header, 148, 8, `tar entry ${entryIndex} checksum`);
  let actual = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    fail("CHECKSUM_MISMATCH", `tar entry ${entryIndex} header checksum mismatch: expected ${expected}, received ${actual}`);
  }
}

function rawHeaderPath(header, entryIndex) {
  const name = readTarString(header, 0, 100, `tar entry ${entryIndex} name`);
  const prefix = readTarString(header, 345, 155, `tar entry ${entryIndex} prefix`);
  if (name === "") fail("INVALID_PATH", `tar entry ${entryIndex} has an empty path`);
  return prefix === "" ? name : `${prefix}/${name}`;
}

function canonicalArchivePath(value, label, { directory = false, requirePackagePrefix = false } = {}) {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_PATH", `${label} must be a non-empty string`);
  if (value !== value.normalize("NFC")) fail("INVALID_PATH", `${label} must use NFC Unicode normalization`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail("INVALID_PATH", `${label} contains a control character`);
  if (value.includes("\\")) fail("INVALID_PATH", `${label} contains a backslash`);
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) fail("INVALID_PATH", `${label} must be relative`);

  let canonical = value;
  if (directory && canonical.endsWith("/")) canonical = canonical.slice(0, -1);
  if (canonical === "" || canonical.endsWith("/")) fail("INVALID_PATH", `${label} is not canonical`);
  const segments = canonical.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("INVALID_PATH", `${label} contains an empty, dot, or parent segment`);
  }
  if (requirePackagePrefix && canonical !== "package" && !canonical.startsWith("package/")) {
    fail("INVALID_PREFIX", `${label} must begin with package/`);
  }
  return canonical;
}

function parsePaxRecords(data, label) {
  const records = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) fail("INVALID_PAX", `${label} has no record-length separator`);
    const lengthText = decode(data.subarray(offset, space), ASCII, `${label} record length`);
    if (!/^[1-9][0-9]*$/u.test(lengthText)) fail("INVALID_PAX", `${label} has an invalid record length`);
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= space - offset + 3) fail("INVALID_PAX", `${label} record length is invalid`);
    const end = offset + length;
    if (end > data.length || data[end - 1] !== 0x0a) fail("INVALID_PAX", `${label} record is truncated or lacks a newline`);
    const record = data.subarray(space + 1, end - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) fail("INVALID_PAX", `${label} record lacks a key/value separator`);
    const key = decode(record.subarray(0, equals), UTF8, `${label} key`);
    const value = decode(record.subarray(equals + 1), UTF8, `${label} value`);
    if (!/^[\x21-\x3c\x3e-\x7e]+$/u.test(key)) fail("INVALID_PAX", `${label} key is not portable ASCII`);
    if (Object.hasOwn(records, key)) fail("INVALID_PAX", `${label} repeats PAX key ${key}`);
    records[key] = value;
    offset = end;
  }
  if (records.hdrcharset !== undefined && records.hdrcharset !== "ISO-IR 10646 2000 UTF-8") {
    fail("INVALID_PAX", `${label} requests unsupported hdrcharset ${records.hdrcharset}`);
  }
  if (Object.keys(records).some((key) => key.startsWith("GNU.sparse."))) {
    fail("UNSUPPORTED_ENTRY", `${label} describes an unsupported sparse file`);
  }
  return records;
}

function paxSize(value, label) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value ?? "")) fail("INVALID_PAX", `${label} must be a canonical decimal integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail("INVALID_PAX", `${label} exceeds the safe integer range`);
  return parsed;
}

function registerPath(nodes, foldedPaths, archivePath, kind) {
  const folded = archivePath.toLowerCase();
  const foldedExisting = foldedPaths.get(folded);
  if (foldedExisting !== undefined && foldedExisting !== archivePath) {
    fail("PATH_COLLISION", `${archivePath} collides with ${foldedExisting} under case-insensitive extraction`);
  }

  const segments = archivePath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    const ancestorFolded = ancestor.toLowerCase();
    const caseAncestor = foldedPaths.get(ancestorFolded);
    if (caseAncestor !== undefined && caseAncestor !== ancestor) {
      fail("PATH_COLLISION", `${ancestor} collides with ${caseAncestor} under case-insensitive extraction`);
    }
    const existing = nodes.get(ancestor);
    if (existing?.kind === "file") fail("PATH_COLLISION", `${archivePath} is nested beneath file ${ancestor}`);
    if (existing === undefined) {
      nodes.set(ancestor, { explicit: false, kind: "directory" });
      foldedPaths.set(ancestorFolded, ancestor);
    }
  }

  const existing = nodes.get(archivePath);
  if (existing !== undefined) {
    if (kind === "directory" && existing.kind === "directory" && existing.explicit === false) {
      existing.explicit = true;
      foldedPaths.set(folded, archivePath);
      return;
    }
    fail("DUPLICATE_PATH", `archive contains duplicate or colliding path ${archivePath}`);
  }
  nodes.set(archivePath, { explicit: true, kind });
  foldedPaths.set(folded, archivePath);
}

function packageMetadata(packageJson) {
  if (packageJson === null || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    fail("INVALID_PACKAGE_JSON", "package/package.json must contain a JSON object");
  }
  for (const field of ["name", "version"]) {
    const value = packageJson[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
      fail("INVALID_PACKAGE_JSON", `package/package.json ${field} must be a non-empty canonical string`);
    }
  }
  return { name: packageJson.name, version: packageJson.version };
}

function assertExpected(result, options) {
  if (options.expectedName !== undefined && result.name !== options.expectedName) {
    fail("IDENTITY_MISMATCH", `package name mismatch: expected ${options.expectedName}, received ${result.name}`);
  }
  if (options.expectedVersion !== undefined && result.version !== options.expectedVersion) {
    fail("IDENTITY_MISMATCH", `package version mismatch: expected ${options.expectedVersion}, received ${result.version}`);
  }
  if (options.expectedTarballSha256 !== undefined) {
    if (!SHA256.test(options.expectedTarballSha256)) fail("INVALID_EXPECTATION", "expectedTarballSha256 must be a lowercase SHA-256 digest");
    if (result.tarballSha256 !== options.expectedTarballSha256) {
      fail("IDENTITY_MISMATCH", `tarball SHA-256 mismatch: expected ${options.expectedTarballSha256}, received ${result.tarballSha256}`);
    }
  }
}

/**
 * Inspect an npm-compatible .tgz without extracting it. Only regular files,
 * directories, and POSIX PAX metadata entries are accepted. Returned paths are
 * relative to the archive's mandatory package/ root.
 */
export function inspectNpmPackageArchiveBytes(archiveBytes, options = {}) {
  const archive = exactBuffer(archiveBytes);
  const limits = resolveLimits(options);
  if (archive.length === 0 || archive.length > limits.maxArchiveBytes) {
    fail("ARCHIVE_LIMIT", `compressed archive size must be between 1 and ${limits.maxArchiveBytes} bytes`);
  }
  if (archive.length < 2 || !archive.subarray(0, 2).equals(GZIP_MAGIC)) {
    fail("INVALID_GZIP", "package archive must use gzip framing");
  }

  let tar;
  try {
    tar = gunzipSync(archive, { maxOutputLength: limits.maxTarBytes });
  } catch (error) {
    fail("INVALID_GZIP", `package archive could not be decompressed within ${limits.maxTarBytes} bytes`, { cause: error });
  }
  if (tar.length < END_BLOCK_BYTES || tar.length % BLOCK_SIZE !== 0) {
    fail("INVALID_TAR", "decompressed tar must be block-aligned and include two end blocks");
  }

  const files = [];
  const nodes = new Map();
  const foldedPaths = new Map();
  let globalPax = Object.create(null);
  let nextPax = null;
  let packageJson = null;
  let offset = 0;
  let entryIndex = 0;
  let unpackedSize = 0;
  let sawEnd = false;

  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) {
      if (nextPax !== null) fail("INVALID_PAX", "archive ends before pending PAX metadata is applied");
      if (tar.length - offset < END_BLOCK_BYTES || !isZeroBlock(tar.subarray(offset + BLOCK_SIZE, offset + END_BLOCK_BYTES))) {
        fail("INVALID_TAR", "tar archive must terminate with two zero blocks");
      }
      if (!tar.subarray(offset).every((byte) => byte === 0)) fail("TRAILING_DATA", "tar archive contains data after its end marker");
      sawEnd = true;
      break;
    }

    entryIndex += 1;
    validateHeaderChecksum(header, entryIndex);
    const magic = header.subarray(257, 263);
    const version = header.subarray(263, 265);
    if (!magic.equals(Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00])) || !version.equals(Buffer.from("00", "ascii"))) {
      fail("INVALID_HEADER", `tar entry ${entryIndex} is not a POSIX ustar entry`);
    }

    const typeByte = header[156];
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const headerPath = canonicalArchivePath(rawHeaderPath(header, entryIndex), `tar entry ${entryIndex} header path`, {
      directory: type === "5",
    });
    const rawSize = readTarNumber(header, 124, 12, `tar entry ${entryIndex} size`);
    const linkName = readTarString(header, 157, 100, `tar entry ${entryIndex} link name`);

    if (type === "1" || type === "2") fail("LINK_ENTRY", `tar entry ${entryIndex} (${headerPath}) is a prohibited link`);
    if (!new Set(["0", "5", "x", "g"]).has(type)) {
      fail("UNSUPPORTED_ENTRY", `tar entry ${entryIndex} (${headerPath}) has unsupported type ${JSON.stringify(type)}`);
    }
    if (linkName !== "") fail("LINK_ENTRY", `tar entry ${entryIndex} (${headerPath}) carries a prohibited link target`);

    const metadataEntry = type === "x" || type === "g";
    const effectivePax = metadataEntry ? null : { ...globalPax, ...(nextPax ?? {}) };
    const size = effectivePax?.size === undefined ? rawSize : paxSize(effectivePax.size, `tar entry ${entryIndex} PAX size`);
    const entryLimit = metadataEntry ? limits.maxPaxBytes : limits.maxEntryBytes;
    if (size > entryLimit) fail("ENTRY_LIMIT", `tar entry ${entryIndex} (${headerPath}) exceeds its ${entryLimit}-byte limit`);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    if (!Number.isSafeInteger(dataEnd) || paddedEnd > tar.length) fail("TRUNCATED_ENTRY", `tar entry ${entryIndex} (${headerPath}) is truncated`);
    if (!tar.subarray(dataEnd, paddedEnd).every((byte) => byte === 0)) {
      fail("INVALID_PADDING", `tar entry ${entryIndex} (${headerPath}) has non-zero padding`);
    }
    const data = tar.subarray(dataStart, dataEnd);

    if (metadataEntry) {
      if (nextPax !== null) fail("INVALID_PAX", `tar entry ${entryIndex} appears before pending PAX metadata is applied`);
      const records = parsePaxRecords(data, `tar entry ${entryIndex} PAX metadata`);
      if (type === "g") {
        for (const forbidden of ["path", "linkpath", "size"]) {
          if (records[forbidden] !== undefined) fail("INVALID_PAX", `global PAX metadata must not define ${forbidden}`);
        }
        globalPax = { ...globalPax, ...records };
      } else {
        nextPax = records;
      }
      offset = paddedEnd;
      continue;
    }

    const pax = effectivePax;
    nextPax = null;
    if (pax.linkpath !== undefined && pax.linkpath !== "") {
      fail("LINK_ENTRY", `tar entry ${entryIndex} (${headerPath}) carries a prohibited PAX link target`);
    }
    const archivePath = canonicalArchivePath(pax.path ?? headerPath, `tar entry ${entryIndex} effective path`, {
      directory: type === "5",
      requirePackagePrefix: true,
    });

    if (type === "5") {
      if (size !== 0) fail("INVALID_DIRECTORY", `directory ${archivePath} must have zero size`);
      registerPath(nodes, foldedPaths, archivePath, "directory");
    } else {
      if (archivePath === "package") fail("INVALID_PREFIX", "regular files must be nested beneath package/");
      if (files.length >= limits.maxFiles) fail("FILE_LIMIT", `archive exceeds its ${limits.maxFiles}-file limit`);
      unpackedSize += size;
      if (!Number.isSafeInteger(unpackedSize) || unpackedSize > limits.maxUnpackedBytes) {
        fail("UNPACKED_LIMIT", `regular files exceed the ${limits.maxUnpackedBytes}-byte unpacked limit`);
      }
      registerPath(nodes, foldedPaths, archivePath, "file");
      const relativePath = archivePath.slice("package/".length);
      const file = Object.freeze({ path: relativePath, sha256: sha256(data), size });
      files.push(file);
      if (relativePath === "package.json") {
        if (packageJson !== null) fail("DUPLICATE_PATH", "archive contains more than one package/package.json");
        let source;
        try {
          source = decode(data, UTF8, "package/package.json");
          packageJson = JSON.parse(source);
        } catch (error) {
          if (error instanceof NpmPackageArchiveError) throw error;
          fail("INVALID_PACKAGE_JSON", `package/package.json is not valid JSON: ${error.message}`, { cause: error });
        }
      }
    }
    offset = paddedEnd;
  }

  if (!sawEnd) fail("INVALID_TAR", "tar archive has no valid end marker");
  if (packageJson === null) fail("MISSING_PACKAGE_JSON", "archive must contain package/package.json as a regular file");
  const { name, version } = packageMetadata(packageJson);
  const fileManifest = Object.freeze([...files].sort((left, right) => codeUnitCompare(left.path, right.path)));
  const canonicalManifest = JSON.stringify({
    files: fileManifest,
    schemaVersion: NPM_PACKAGE_FILE_MANIFEST_SCHEMA_VERSION,
  });
  const result = Object.freeze({
    schemaVersion: NPM_PACKAGE_ARCHIVE_SCHEMA_VERSION,
    name,
    version,
    packageJson: Object.freeze(packageJson),
    fileManifest,
    fileCount: fileManifest.length,
    unpackedSize,
    canonicalManifestSha256: sha256(Buffer.from(canonicalManifest, "utf8")),
    tarballBytes: archive.length,
    tarballSha256: sha256(archive),
  });
  assertExpected(result, options);
  return result;
}

export async function inspectNpmPackageArchiveFile(archivePath, options = {}) {
  if (typeof archivePath !== "string" || archivePath.length === 0) {
    fail("INVALID_INPUT", "archivePath must be a non-empty string");
  }
  return inspectNpmPackageArchiveBytes(await readFile(archivePath), options);
}

export const verifyNpmPackageArchiveBytes = inspectNpmPackageArchiveBytes;
export const verifyNpmPackageArchiveFile = inspectNpmPackageArchiveFile;
