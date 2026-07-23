import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "./distributable-candidate.mjs";
import {
  inspectNpmPackageArchiveBytes,
  inspectNpmPackageArchiveFile,
} from "./npm-package-archive.mjs";
import { resolveNpmCliInvocation } from "./npm-cli-invocation.mjs";
import { computeNodeKitSourceHash } from "./source-hash.mjs";

export const CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION = "nodekit.consumer-package-provenance/v1";

const COMMIT = /^[a-f0-9]{40}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SRI_SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const WINDOWS_RESERVED_SEGMENT = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;

export class ConsumerPackagePreparationError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "ConsumerPackagePreparationError";
    this.code = code;
  }
}

function fail(code, message, options = undefined) {
  throw new ConsumerPackagePreparationError(code, message, options);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key])]),
    );
  }
  return value;
}

export function canonicalConsumerProvenanceBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalJsonValue(value), null, 2)}\n`, "utf8");
}

function requiredCanonicalString(value, label, expression) {
  if (typeof value !== "string" || !expression.test(value)) {
    fail("INVALID_ARGUMENT", `${label} is invalid`);
  }
  return value;
}

function canonicalRelativePath(value, label, suffix = undefined) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || path.posix.isAbsolute(value)) {
    fail("INVALID_PATH", `${label} must be a non-empty POSIX relative path`);
  }
  if (value !== value.normalize("NFC") || /[\u0000-\u001f\u007f<>:"|?*]/u.test(value)) {
    fail("INVALID_PATH", `${label} must be a canonical portable path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("INVALID_PATH", `${label} cannot contain empty, dot, or parent segments`);
  }
  if (segments.some((segment) => /[. ]$/u.test(segment) || WINDOWS_RESERVED_SEGMENT.test(segment))) {
    fail("INVALID_PATH", `${label} contains a Windows-ambiguous or reserved path segment`);
  }
  if (suffix && !value.endsWith(suffix)) fail("INVALID_PATH", `${label} must end with ${suffix}`);
  return value;
}

function portablePathKey(value) {
  return value.normalize("NFC").toLowerCase();
}

function git(root, args, { allowFailure = false, encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? result.error?.message ?? "");
    fail("GIT_FAILURE", `git ${args[0]} failed${detail.trim() ? `: ${detail.trim()}` : ""}`, { cause: result.error });
  }
  return result;
}

function slash(value) {
  return value.replaceAll("\\", "/");
}

async function assertRepositoryRoot(root, label) {
  const resolved = await realpath(path.resolve(root));
  const topLevel = git(resolved, ["rev-parse", "--show-toplevel"]).stdout.trim();
  const canonicalTopLevel = await realpath(topLevel);
  if (process.platform === "win32"
    ? canonicalTopLevel.toLowerCase() !== resolved.toLowerCase()
    : canonicalTopLevel !== resolved) {
    fail("REPOSITORY_ROOT_MISMATCH", `${label} must identify the Git worktree root`);
  }
  return resolved;
}

function readHeadCommit(root, label) {
  const commit = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim().toLowerCase();
  if (!COMMIT.test(commit)) fail("INVALID_GIT_COMMIT", `${label} HEAD is not a full commit`);
  return commit;
}

function assertCleanRepository(root, context, pathspecs = undefined) {
  const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (pathspecs) args.push("--", ...pathspecs);
  const dirty = parseGitStatusPorcelainZ(git(root, args, { encoding: null }).stdout);
  assertCleanDistributablePaths(dirty, context);
  return true;
}

async function assertTrackedCommittedFile(root, relativePath, label) {
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", relativePath], { allowFailure: true });
  if (tracked.error || tracked.status !== 0) fail("UNTRACKED_INPUT", `${label} must be tracked by Git`);
  const clean = git(root, ["diff", "--quiet", "HEAD", "--", relativePath], { allowFailure: true });
  if (clean.error || clean.status !== 0) fail("UNCOMMITTED_INPUT", `${label} differs from HEAD`);
  const working = await readFile(path.join(root, ...relativePath.split("/")));
  return working;
}

async function distributableFiles(root, pathspecs) {
  const files = [];
  async function visit(absolute) {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) fail("SYMLINK_INPUT", `distributable input cannot be a symbolic link: ${slash(path.relative(root, absolute))}`);
    if (metadata.isDirectory()) {
      const children = await readdir(absolute);
      children.sort();
      for (const child of children) await visit(path.join(absolute, child));
      return;
    }
    if (!metadata.isFile()) fail("INVALID_INPUT", `distributable input must be a regular file: ${slash(path.relative(root, absolute))}`);
    files.push(slash(path.relative(root, absolute)));
  }
  for (const pathspec of pathspecs) await visit(path.join(root, ...slash(pathspec).split("/")));
  return [...new Set(files)].sort();
}

async function assertDistributableFilesTracked(root, pathspecs) {
  const actual = await distributableFiles(root, pathspecs);
  const tracked = git(root, ["ls-files", "-z", "--", ...pathspecs], { encoding: null }).stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(slash)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(tracked)) {
    const trackedSet = new Set(tracked);
    const actualSet = new Set(actual);
    const untracked = actual.filter((entry) => !trackedSet.has(entry));
    const missing = tracked.filter((entry) => !actualSet.has(entry));
    fail(
      "UNTRACKED_DISTRIBUTION",
      `NodeKit distributable files must exactly match Git HEAD; untracked: ${untracked.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}`,
    );
  }
  return true;
}

function parseNpmPackOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout).replace(/^\uFEFF/u, "").trim());
  } catch (error) {
    fail("SOURCE_PACK_FAILURE", "npm pack did not emit valid JSON", { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== "string") {
    fail("SOURCE_PACK_FAILURE", "npm pack must emit exactly one archive record");
  }
  if (path.basename(parsed[0].filename) !== parsed[0].filename || !parsed[0].filename.endsWith(".tgz")) {
    fail("SOURCE_PACK_FAILURE", "npm pack emitted an unsafe archive filename");
  }
  return parsed[0];
}

async function independentlyPackNodeKitSource(root, { candidateCommit, sourceHash }) {
  const isolationRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-consumer-source-pack-"));
  const isolatedSourceRoot = path.join(isolationRoot, "source");
  const destination = path.join(isolationRoot, "packed");
  try {
    if (readHeadCommit(root, "NodeKit before isolated source copy") !== candidateCommit) {
      fail("SOURCE_ISOLATION_MISMATCH", "NodeKit HEAD changed before the isolated source copy was created");
    }
    const sourcePackageJson = parsePackageJson(await readFile(path.join(root, "package.json")), "NodeKit package.json");
    const sourceFiles = await distributableFiles(root, distributablePathspecs(sourcePackageJson));
    for (const relativePath of sourceFiles) {
      const source = path.join(root, ...relativePath.split("/"));
      const target = path.join(isolatedSourceRoot, ...relativePath.split("/"));
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        fail("SOURCE_ISOLATION_FAILURE", `isolated source input is not a regular file: ${relativePath}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      await chmod(target, metadata.mode & 0o777);
    }
    const isolatedSourceHash = await computeNodeKitSourceHash(isolatedSourceRoot);
    if (isolatedSourceHash !== sourceHash) {
      fail(
        "SOURCE_ISOLATION_MISMATCH",
        `isolated source does not match candidate ${candidateCommit}/${sourceHash}; received source hash ${isolatedSourceHash}`,
      );
    }
    if (readHeadCommit(root, "NodeKit after isolated source copy") !== candidateCommit
      || await computeNodeKitSourceHash(root) !== sourceHash) {
      fail("SOURCE_CHANGED_DURING_COPY", "NodeKit commit or source bytes changed while the isolated source copy was created");
    }
    // npm receives only disposable, validated distribution bytes. No Git
    // metadata or filesystem link points back to the authoritative checkout.
    await mkdir(destination, { recursive: false });
    const invocation = resolveNpmCliInvocation([
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      destination,
    ]);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: isolatedSourceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_ignore_scripts: "true",
      },
      maxBuffer: 32 * 1024 * 1024,
      shell: invocation.shell,
      timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.stdout || result.error?.message || "").trim();
      fail("SOURCE_PACK_FAILURE", `independent npm pack failed${detail ? `: ${detail.slice(-2_000)}` : ""}`, { cause: result.error });
    }
    const record = parseNpmPackOutput(result.stdout);
    return await inspectNpmPackageArchiveFile(path.join(destination, record.filename));
  } finally {
    await rm(isolationRoot, { force: true, recursive: true });
  }
}

async function assertSafeOutputPath(root, relativePath, label) {
  const absolute = path.join(root, ...relativePath.split("/"));
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escapes the consumer root`);
  let cursor = root;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) fail("SYMLINK_OUTPUT", `${label} traverses a symbolic link: ${slash(path.relative(root, cursor))}`);
      if (cursor !== absolute && !metadata.isDirectory()) fail("INVALID_OUTPUT", `${label} has a non-directory ancestor`);
      if (cursor === absolute && !metadata.isFile()) fail("INVALID_OUTPUT", `${label} exists but is not a regular file`);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return absolute;
}

async function assertExistingOutputCommitted(root, relativePath, label) {
  try {
    await lstat(path.join(root, ...relativePath.split("/")));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await assertTrackedCommittedFile(root, relativePath, label);
}

function parsePackageJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    fail("INVALID_PACKAGE_JSON", `${label} is not valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_PACKAGE_JSON", `${label} must contain an object`);
  return value;
}

function dependencyDeclaration(packageJson, name) {
  const declarations = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section];
    if (dependencies !== undefined && (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))) {
      fail("INVALID_PACKAGE_JSON", `consumer package.json ${section} must be an object when present`);
    }
    if (Object.hasOwn(dependencies ?? {}, name)) {
      if (typeof dependencies[name] !== "string" || dependencies[name].length === 0) {
        fail("INVALID_PACKAGE_JSON", `consumer package.json ${section}.${name} must be a non-empty string`);
      }
      declarations.push({ previousSpecifier: dependencies[name], section });
    }
  }
  return declarations;
}

function packageJsonFormatting(source) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const indentation = source.match(/\n([ \t]+)"/u)?.[1] ?? "  ";
  return { indentation, newline };
}

function updatedPackageJsonBytes(sourceBytes, packageJson, section, name, specifier) {
  const source = sourceBytes.toString("utf8").replace(/^\uFEFF/u, "");
  const { indentation, newline } = packageJsonFormatting(source);
  packageJson[section][name] = specifier;
  return Buffer.from(`${JSON.stringify(packageJson, null, indentation).replaceAll("\n", newline)}${newline}`, "utf8");
}

async function atomicWrite(file, bytes, mode = 0o644) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rm(file, { force: true });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function fileState(file, label = file) {
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail("INVALID_OUTPUT", `${label} must be absent or a regular non-symbolic-link file`);
    return { bytes: await readFile(file), exists: true, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error?.code === "ENOENT") return { bytes: null, exists: false, mode: null };
    throw error;
  }
}

function sameFileState(left, right) {
  return left.exists === right.exists
    && left.mode === right.mode
    && (left.bytes === null ? right.bytes === null : Buffer.isBuffer(right.bytes) && left.bytes.equals(right.bytes));
}

async function applyTransaction(mutations) {
  const previous = new Map(mutations.map((mutation) => [mutation.path, mutation.expectedBefore]));
  for (const mutation of mutations) {
    const current = await fileState(mutation.path, mutation.label);
    if (!sameFileState(current, mutation.expectedBefore)) {
      fail("CONCURRENT_OUTPUT_DRIFT", `${mutation.label} changed after the preparation plan was computed`);
    }
  }
  const completed = [];
  try {
    for (const mutation of mutations) {
      const current = await fileState(mutation.path, mutation.label);
      if (!sameFileState(current, mutation.expectedBefore)) {
        fail("CONCURRENT_OUTPUT_DRIFT", `${mutation.label} changed immediately before its write`);
      }
      completed.push(mutation);
      await atomicWrite(mutation.path, mutation.bytes, mutation.expectedBefore.mode ?? 0o644);
    }
    for (const mutation of mutations) {
      const written = await readFile(mutation.path);
      if (!written.equals(mutation.bytes)) fail("WRITE_VERIFICATION_FAILED", `written bytes differ for ${mutation.label}`);
    }
  } catch (error) {
    for (const mutation of completed.reverse()) {
      const before = previous.get(mutation.path);
      if (!before.exists) await rm(mutation.path, { force: true });
      else await atomicWrite(mutation.path, before.bytes, before.mode);
    }
    throw error;
  }
}

function exactDependencySpecifier(packageJsonPath, vendorPath) {
  const relative = path.posix.relative(path.posix.dirname(packageJsonPath), vendorPath);
  if (relative === "" || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    fail("INVALID_PATH", "vendor path must be reachable from the consumer package.json without escaping its directory");
  }
  return `file:${relative}`;
}

/**
 * Verify and optionally vendor one exact NodeKit package into a clean consumer
 * worktree. This function never deploys, commits, signs, or claims authenticated
 * consumer adoption. Dry-run is the default and performs no writes.
 */
export async function prepareExactConsumerPackage(options) {
  const candidateCommit = requiredCanonicalString(options.candidateCommit, "candidateCommit", COMMIT);
  const sourceHash = requiredCanonicalString(options.sourceHash, "sourceHash", SHA256);
  const expectedName = requiredCanonicalString(options.expectedName, "expectedName", PACKAGE_NAME);
  const expectedVersion = requiredCanonicalString(options.expectedVersion, "expectedVersion", /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u);
  const expectedTarballSha256 = requiredCanonicalString(options.expectedTarballSha256, "expectedTarballSha256", SHA256);
  const expectedIntegrity = requiredCanonicalString(options.expectedIntegrity, "expectedIntegrity", SRI_SHA512);
  const packageJsonPath = canonicalRelativePath(options.packageJsonPath ?? "package.json", "packageJsonPath", "package.json");
  const vendorPath = canonicalRelativePath(options.vendorPath ?? "vendor/nodekit.tgz", "vendorPath", ".tgz");
  const manifestPath = canonicalRelativePath(options.manifestPath ?? "nodekit.consumer-package.json", "manifestPath", ".json");
  if (new Set([packageJsonPath, vendorPath, manifestPath].map(portablePathKey)).size !== 3) {
    fail("PATH_COLLISION", "package, vendor, and manifest paths must be distinct on portable case-insensitive filesystems");
  }
  const apply = options.apply === true;
  const updateDependency = options.updateDependency === true;

  const [nodekitRoot, consumerRoot] = await Promise.all([
    assertRepositoryRoot(options.nodekitRoot, "nodekitRoot"),
    assertRepositoryRoot(options.consumerRoot, "consumerRoot"),
  ]);
  if (process.platform === "win32"
    ? nodekitRoot.toLowerCase() === consumerRoot.toLowerCase()
    : nodekitRoot === consumerRoot) {
    fail("REPOSITORY_COLLISION", "NodeKit and consumer roots must be different worktrees");
  }
  const nodekitCommit = readHeadCommit(nodekitRoot, "NodeKit");
  if (nodekitCommit !== candidateCommit) {
    fail("COMMIT_MISMATCH", `NodeKit HEAD ${nodekitCommit} does not match candidate ${candidateCommit}`);
  }
  const nodekitPackageBytes = await assertTrackedCommittedFile(nodekitRoot, "package.json", "NodeKit package.json");
  const nodekitPackageJson = parsePackageJson(nodekitPackageBytes, "NodeKit package.json");
  const nodekitPathspecs = distributablePathspecs(nodekitPackageJson);
  assertCleanRepository(nodekitRoot, "NodeKit distributable candidate", nodekitPathspecs);
  await assertDistributableFilesTracked(nodekitRoot, nodekitPathspecs);
  const actualSourceHash = await computeNodeKitSourceHash(nodekitRoot);
  if (actualSourceHash !== sourceHash) fail("SOURCE_HASH_MISMATCH", `NodeKit source hash ${actualSourceHash} does not match ${sourceHash}`);

  const consumerCommit = readHeadCommit(consumerRoot, "consumer");
  if (options.expectedConsumerCommit !== undefined) {
    const expectedConsumerCommit = requiredCanonicalString(options.expectedConsumerCommit, "expectedConsumerCommit", COMMIT);
    if (consumerCommit !== expectedConsumerCommit) fail("CONSUMER_COMMIT_MISMATCH", `consumer HEAD ${consumerCommit} does not match ${expectedConsumerCommit}`);
  }
  assertCleanRepository(consumerRoot, "consumer preparation");
  const consumerPackageBytes = await assertTrackedCommittedFile(consumerRoot, packageJsonPath, "consumer package.json");
  const consumerPackageJson = parsePackageJson(consumerPackageBytes, "consumer package.json");

  const archivePath = path.resolve(options.archivePath);
  const archiveMetadata = await lstat(archivePath);
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink()) fail("INVALID_ARCHIVE", "archivePath must be a regular non-symbolic-link file");
  const archiveBytes = await readFile(archivePath);
  const actualIntegrity = sha512Integrity(archiveBytes);
  if (actualIntegrity !== expectedIntegrity) fail("INTEGRITY_MISMATCH", `tarball SRI mismatch: expected ${expectedIntegrity}, received ${actualIntegrity}`);
  // Inspect the exact immutable byte snapshot that will be written. Reopening
  // archivePath here would allow an A-to-B replacement to bind B's metadata to
  // A's vendored bytes.
  const archive = inspectNpmPackageArchiveBytes(archiveBytes, {
    expectedName,
    expectedTarballSha256,
    expectedVersion,
  });
  if (nodekitPackageJson.name !== archive.name || nodekitPackageJson.version !== archive.version) {
    fail("SOURCE_PACKAGE_MISMATCH", "NodeKit source package name/version does not match the archive");
  }
  const sourceArchive = await independentlyPackNodeKitSource(nodekitRoot, {
    candidateCommit,
    sourceHash,
  });
  const sourceArchiveChecks = {
    canonicalManifestSha256: sourceArchive.canonicalManifestSha256 === archive.canonicalManifestSha256,
    fileCount: sourceArchive.fileCount === archive.fileCount,
    name: sourceArchive.name === archive.name,
    unpackedSize: sourceArchive.unpackedSize === archive.unpackedSize,
    version: sourceArchive.version === archive.version,
  };
  if (!Object.values(sourceArchiveChecks).every(Boolean)) {
    const failed = Object.entries(sourceArchiveChecks).filter(([, passed]) => !passed).map(([name]) => name);
    fail("SOURCE_ARCHIVE_MISMATCH", `supplied archive does not match an independent script-disabled pack of the exact NodeKit source: ${failed.join(", ")}`);
  }
  if (readHeadCommit(nodekitRoot, "NodeKit after independent pack") !== candidateCommit
    || await computeNodeKitSourceHash(nodekitRoot) !== sourceHash) {
    fail("SOURCE_CHANGED_DURING_PACK", "NodeKit commit or source bytes changed during independent packing");
  }
  assertCleanRepository(nodekitRoot, "NodeKit after independent pack", nodekitPathspecs);
  await assertDistributableFilesTracked(nodekitRoot, nodekitPathspecs);

  const [vendorAbsolute, manifestAbsolute, packageJsonAbsolute] = await Promise.all([
    assertSafeOutputPath(consumerRoot, vendorPath, "vendorPath"),
    assertSafeOutputPath(consumerRoot, manifestPath, "manifestPath"),
    assertSafeOutputPath(consumerRoot, packageJsonPath, "packageJsonPath"),
  ]);
  const sameArchiveTarget = portablePathKey(path.resolve(archivePath))
    === portablePathKey(path.resolve(vendorAbsolute));
  if (sameArchiveTarget) fail("PATH_COLLISION", "archivePath and vendorPath must be different files");
  await Promise.all([
    assertExistingOutputCommitted(consumerRoot, vendorPath, "existing vendored archive"),
    assertExistingOutputCommitted(consumerRoot, manifestPath, "existing provenance manifest"),
  ]);
  const [vendorBefore, manifestBefore, packageJsonBefore] = await Promise.all([
    fileState(vendorAbsolute, vendorPath),
    fileState(manifestAbsolute, manifestPath),
    fileState(packageJsonAbsolute, packageJsonPath),
  ]);
  if (!packageJsonBefore.exists || !packageJsonBefore.bytes.equals(consumerPackageBytes)) {
    fail("CONSUMER_INPUT_DRIFT", "consumer package.json changed while the preparation plan was being computed");
  }

  const dependencySpecifier = exactDependencySpecifier(packageJsonPath, vendorPath);
  const declarations = dependencyDeclaration(consumerPackageJson, archive.name);
  let dependency = {
    name: archive.name,
    previousSpecifier: declarations.length === 1 ? declarations[0].previousSpecifier : null,
    requested: updateDependency,
    section: declarations.length === 1 ? declarations[0].section : null,
    specifier: dependencySpecifier,
  };
  let nextPackageBytes = consumerPackageBytes;
  if (updateDependency) {
    if (declarations.length !== 1) {
      fail("DEPENDENCY_DECLARATION_MISMATCH", `explicit dependency update requires exactly one existing ${archive.name} declaration; found ${declarations.length}`);
    }
    nextPackageBytes = updatedPackageJsonBytes(
      consumerPackageBytes,
      consumerPackageJson,
      declarations[0].section,
      archive.name,
      dependencySpecifier,
    );
    dependency = { ...dependency, changed: !nextPackageBytes.equals(consumerPackageBytes) };
  } else {
    dependency = { ...dependency, changed: false };
  }

  const provenance = {
    schemaVersion: CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
    classification: "package_preparation_only",
    checks: {
      archiveStructureValidated: true,
      consumerPackageJsonCommitted: true,
      consumerPackageJsonTracked: true,
      consumerWorktreeCleanBeforePreparation: true,
      nodekitCommitExact: true,
      nodekitDistributableClean: true,
      nodekitDistributableTracked: true,
      nodekitSourceHashExact: true,
      packageIdentityExact: true,
      sourceArchiveManifestExact: true,
      sriExact: true,
      tarballSha256Exact: true,
    },
    claims: {
      authenticatedAdoption: false,
      convexTestAuthenticatedAdoption: false,
      deploymentPerformed: false,
      threeConsumerGateSatisfied: false,
    },
    consumer: {
      baseCommit: consumerCommit,
      packageJsonAfterSha256: sha256(nextPackageBytes),
      packageJsonBeforeSha256: sha256(consumerPackageBytes),
      packageJsonPath,
    },
    dependency,
    nodekit: {
      candidateCommit,
      canonicalManifestSha256: archive.canonicalManifestSha256,
      fileCount: archive.fileCount,
      integrity: actualIntegrity,
      name: archive.name,
      sourceHash,
      sourcePack: {
        canonicalManifestSha256: sourceArchive.canonicalManifestSha256,
        fileCount: sourceArchive.fileCount,
        unpackedSize: sourceArchive.unpackedSize,
      },
      tarballBytes: archive.tarballBytes,
      tarballSha256: archive.tarballSha256,
      unpackedSize: archive.unpackedSize,
      version: archive.version,
    },
    vendor: {
      manifestPath,
      path: vendorPath,
    },
  };
  const manifestBytes = canonicalConsumerProvenanceBytes(provenance);
  const mutations = [
    { bytes: archiveBytes, expectedBefore: vendorBefore, label: vendorPath, path: vendorAbsolute },
    ...(updateDependency && !nextPackageBytes.equals(consumerPackageBytes)
      ? [{ bytes: nextPackageBytes, expectedBefore: packageJsonBefore, label: packageJsonPath, path: packageJsonAbsolute }]
      : []),
    { bytes: manifestBytes, expectedBefore: manifestBefore, label: manifestPath, path: manifestAbsolute },
  ];
  if (apply) {
    if (options.beforeApply !== undefined) {
      if (typeof options.beforeApply !== "function") fail("INVALID_ARGUMENT", "beforeApply must be a function when provided");
      await options.beforeApply();
    }
    if (readHeadCommit(consumerRoot, "consumer before apply") !== consumerCommit) {
      fail("CONSUMER_INPUT_DRIFT", "consumer HEAD changed after the preparation plan was computed");
    }
    assertCleanRepository(consumerRoot, "consumer before apply");
    const currentPackageBytes = await assertTrackedCommittedFile(consumerRoot, packageJsonPath, "consumer package.json before apply");
    if (!currentPackageBytes.equals(consumerPackageBytes)) {
      fail("CONSUMER_INPUT_DRIFT", "consumer package.json bytes changed after the preparation plan was computed");
    }
    for (const [absolute, relativePath, before] of [
      [vendorAbsolute, vendorPath, vendorBefore],
      [manifestAbsolute, manifestPath, manifestBefore],
      [packageJsonAbsolute, packageJsonPath, packageJsonBefore],
    ]) {
      if (!sameFileState(await fileState(absolute, relativePath), before)) {
        fail("CONCURRENT_OUTPUT_DRIFT", `${relativePath} changed after the preparation plan was computed`);
      }
    }
    await applyTransaction(mutations);
  }

  return {
    schemaVersion: "nodekit.consumer-package-preparation-result/v1",
    applied: apply,
    authenticatedAdoption: false,
    deploymentPerformed: false,
    manifest: provenance,
    manifestSha256: sha256(manifestBytes),
    mode: apply ? "apply" : "dry-run",
    plannedWrites: mutations.map((entry) => slash(path.relative(consumerRoot, entry.path))),
  };
}
