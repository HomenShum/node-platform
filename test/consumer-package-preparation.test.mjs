import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
  ConsumerPackagePreparationError,
  prepareExactConsumerPackage,
} from "../src/lib/consumer-package-preparation.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { parseConsumerPackagePreparationArguments } from "../scripts/prepare-consumer-package.mjs";

const BLOCK = 512;
const NAME = "@homenshum/nodekit";
const VERSION = "0.2.1";
const NODEKIT_PACKAGE_JSON = Object.freeze({
  name: NAME,
  version: VERSION,
  type: "module",
  files: ["src"],
  scripts: {
    prepare: "node -e \"require('node:fs').writeFileSync('PREPARE_SCRIPT_RAN', 'unsafe')\"",
  },
});

function digest(algorithm, value, encoding = "hex") {
  return createHash(algorithm).update(value).digest(encoding);
}

function writeOctal(header, offset, length, value) {
  header.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarEntry(name, body) {
  const data = Buffer.from(body, "utf8");
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, data.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0]).copy(header, 257);
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return Buffer.concat([header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)]);
}

function packageArchive(indexSource = "export const nodekit = true;\n") {
  return gzipSync(Buffer.concat([
    tarEntry("package/package.json", `${JSON.stringify(NODEKIT_PACKAGE_JSON, null, 2)}\n`),
    tarEntry("package/src/index.mjs", indexSource),
    Buffer.alloc(BLOCK * 2),
  ]), { level: 9 });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function write(root, relative, bytes) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function gitRepository(root, files) {
  await mkdir(root, { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  git(root, ["config", "user.email", "nodekit-test@example.invalid"]);
  for (const [relative, bytes] of Object.entries(files)) await write(root, relative, bytes);
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "fixture"]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function fixture({
  archiveIndexSource = "export const nodekit = true;\n",
  consumerDependencies = { [NAME]: "file:vendor/old-nodekit.tgz" },
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-consumer-preparation-"));
  const nodekitRoot = path.join(root, "nodekit");
  const consumerRoot = path.join(root, "consumer");
  const archivePath = path.join(root, "nodekit.tgz");
  const archiveBytes = packageArchive(archiveIndexSource);
  await writeFile(archivePath, archiveBytes);
  const candidateCommit = await gitRepository(nodekitRoot, {
    "package.json": `${JSON.stringify(NODEKIT_PACKAGE_JSON, null, 2)}\n`,
    "src/index.mjs": "export const nodekit = true;\n",
  });
  const consumerCommit = await gitRepository(consumerRoot, {
    "package.json": `${JSON.stringify({ name: "consumer", private: true, version: "1.0.0", dependencies: consumerDependencies }, null, 2)}\n`,
    "src/index.mjs": "export const consumer = true;\n",
  });
  const sourceHash = await computeNodeKitSourceHash(nodekitRoot);
  const options = {
    archivePath,
    candidateCommit,
    consumerRoot,
    expectedConsumerCommit: consumerCommit,
    expectedIntegrity: `sha512-${digest("sha512", archiveBytes, "base64")}`,
    expectedName: NAME,
    expectedTarballSha256: digest("sha256", archiveBytes),
    expectedVersion: VERSION,
    nodekitRoot,
    sourceHash,
  };
  return { archiveBytes, consumerCommit, consumerRoot, nodekitRoot, options, root };
}

async function absent(file) {
  await assert.rejects(access(file), { code: "ENOENT" });
}

test("isolated packing keeps a mutating prepare lifecycle away from authoritative source while dry-run and apply remain exact", async () => {
  const current = await fixture();
  try {
    const packagePath = path.join(current.consumerRoot, "package.json");
    const before = await readFile(packagePath);
    const sourceStatusBefore = git(current.nodekitRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const sourceHashBefore = await computeNodeKitSourceHash(current.nodekitRoot);
    const dry = await prepareExactConsumerPackage({ ...current.options, updateDependency: true });
    assert.equal(dry.applied, false);
    assert.equal(dry.mode, "dry-run");
    assert.deepEqual(dry.plannedWrites, ["vendor/nodekit.tgz", "package.json", "nodekit.consumer-package.json"]);
    assert.deepEqual(await readFile(packagePath), before);
    await absent(path.join(current.consumerRoot, "vendor", "nodekit.tgz"));
    await absent(path.join(current.consumerRoot, "nodekit.consumer-package.json"));

    const repeated = await prepareExactConsumerPackage({ ...current.options, updateDependency: true });
    assert.equal(repeated.manifestSha256, dry.manifestSha256, "the canonical dry-run plan must be deterministic");
    await absent(path.join(current.nodekitRoot, "PREPARE_SCRIPT_RAN"));

    const applied = await prepareExactConsumerPackage({ ...current.options, apply: true, updateDependency: true });
    assert.equal(applied.applied, true);
    assert.deepEqual(await readFile(path.join(current.consumerRoot, "vendor", "nodekit.tgz")), current.archiveBytes);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    assert.equal(packageJson.dependencies[NAME], "file:vendor/nodekit.tgz");
    const provenanceBytes = await readFile(path.join(current.consumerRoot, "nodekit.consumer-package.json"));
    const provenance = JSON.parse(provenanceBytes);
    assert.equal(provenance.schemaVersion, CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION);
    assert.equal(provenance.classification, "package_preparation_only");
    assert.equal(provenance.consumer.baseCommit, current.consumerCommit);
    assert.equal(provenance.nodekit.candidateCommit, current.options.candidateCommit);
    assert.equal(provenance.nodekit.sourceHash, current.options.sourceHash);
    assert.equal(provenance.nodekit.integrity, current.options.expectedIntegrity);
    assert.equal(provenance.claims.authenticatedAdoption, false);
    assert.equal(provenance.claims.convexTestAuthenticatedAdoption, false);
    assert.equal(provenance.claims.deploymentPerformed, false);
    assert.equal(provenance.claims.threeConsumerGateSatisfied, false);
    assert.equal(digest("sha256", provenanceBytes), applied.manifestSha256);
    await absent(path.join(current.nodekitRoot, "PREPARE_SCRIPT_RAN"));
    assert.equal(git(current.nodekitRoot, ["status", "--porcelain=v1", "--untracked-files=all"]), sourceStatusBefore);
    assert.equal(await computeNodeKitSourceHash(current.nodekitRoot), sourceHashBefore);
    assert.equal(git(current.nodekitRoot, ["rev-parse", "HEAD"]), current.options.candidateCommit);
  } finally {
    await rm(current.root, { force: true, recursive: true });
  }
});

test("apply never changes package.json unless --update-dependency was explicit", async () => {
  const current = await fixture();
  try {
    const packagePath = path.join(current.consumerRoot, "package.json");
    const before = await readFile(packagePath);
    const result = await prepareExactConsumerPackage({ ...current.options, apply: true });
    assert.deepEqual(result.plannedWrites, ["vendor/nodekit.tgz", "nodekit.consumer-package.json"]);
    assert.deepEqual(await readFile(packagePath), before);
    assert.equal(result.manifest.dependency.requested, false);
    assert.equal(result.manifest.dependency.changed, false);
  } finally {
    await rm(current.root, { force: true, recursive: true });
  }
});

test("fails closed for every supplied NodeKit identity field before writing", async () => {
  const current = await fixture();
  try {
    const cases = [
      [{ candidateCommit: "0".repeat(40) }, "COMMIT_MISMATCH"],
      [{ sourceHash: "0".repeat(64) }, "SOURCE_HASH_MISMATCH"],
      [{ expectedName: "wrong-package" }, "IDENTITY_MISMATCH"],
      [{ expectedVersion: "9.9.9" }, "IDENTITY_MISMATCH"],
      [{ expectedTarballSha256: "0".repeat(64) }, "IDENTITY_MISMATCH"],
      [{ expectedIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}` }, "INTEGRITY_MISMATCH"],
      [{ expectedConsumerCommit: "0".repeat(40) }, "CONSUMER_COMMIT_MISMATCH"],
    ];
    for (const [change, code] of cases) {
      await assert.rejects(
        prepareExactConsumerPackage({ ...current.options, ...change, apply: true, updateDependency: true }),
        (error) => error?.code === code,
        code,
      );
      await absent(path.join(current.consumerRoot, "vendor", "nodekit.tgz"));
      await absent(path.join(current.consumerRoot, "nodekit.consumer-package.json"));
    }
  } finally {
    await rm(current.root, { force: true, recursive: true });
  }
});

test("rejects a structurally valid same-name/version archive whose package content is not the exact candidate source", async () => {
  const substituted = await fixture({ archiveIndexSource: "export const nodekit = 'substituted';\n" });
  try {
    await assert.rejects(
      prepareExactConsumerPackage({ ...substituted.options, apply: true, updateDependency: true }),
      (error) => error instanceof ConsumerPackagePreparationError && error.code === "SOURCE_ARCHIVE_MISMATCH",
    );
    await absent(path.join(substituted.consumerRoot, "vendor", "nodekit.tgz"));
    await absent(path.join(substituted.consumerRoot, "nodekit.consumer-package.json"));
  } finally {
    await rm(substituted.root, { force: true, recursive: true });
  }
});

test("rechecks consumer HEAD, package bytes, cleanliness, and planned output state immediately before apply", async () => {
  const packageDrift = await fixture();
  try {
    let dryRunHookCalled = false;
    await prepareExactConsumerPackage({
      ...packageDrift.options,
      beforeApply: async () => { dryRunHookCalled = true; },
      updateDependency: true,
    });
    assert.equal(dryRunHookCalled, false, "a dry-run must not invoke a potentially mutating pre-apply hook");

    await assert.rejects(
      prepareExactConsumerPackage({
        ...packageDrift.options,
        apply: true,
        beforeApply: async () => {
          const packagePath = path.join(packageDrift.consumerRoot, "package.json");
          await writeFile(packagePath, `${await readFile(packagePath, "utf8")} `, "utf8");
        },
        updateDependency: true,
      }),
      /consumer before apply requires a clean/u,
    );
    await absent(path.join(packageDrift.consumerRoot, "vendor", "nodekit.tgz"));
    await absent(path.join(packageDrift.consumerRoot, "nodekit.consumer-package.json"));
  } finally {
    await rm(packageDrift.root, { force: true, recursive: true });
  }

  const headDrift = await fixture();
  try {
    await assert.rejects(
      prepareExactConsumerPackage({
        ...headDrift.options,
        apply: true,
        beforeApply: async () => {
          await write(headDrift.consumerRoot, "concurrent.txt", "concurrent commit\n");
          git(headDrift.consumerRoot, ["add", "concurrent.txt"]);
          git(headDrift.consumerRoot, ["commit", "-m", "concurrent change"]);
        },
        updateDependency: true,
      }),
      (error) => error instanceof ConsumerPackagePreparationError && error.code === "CONSUMER_INPUT_DRIFT",
    );
    await absent(path.join(headDrift.consumerRoot, "vendor", "nodekit.tgz"));
    await absent(path.join(headDrift.consumerRoot, "nodekit.consumer-package.json"));
  } finally {
    await rm(headDrift.root, { force: true, recursive: true });
  }

  const ignoredOutputDrift = await fixture();
  try {
    await write(ignoredOutputDrift.consumerRoot, ".git/info/exclude", "vendor/nodekit.tgz\n");
    await assert.rejects(
      prepareExactConsumerPackage({
        ...ignoredOutputDrift.options,
        apply: true,
        beforeApply: async () => {
          await write(ignoredOutputDrift.consumerRoot, "vendor/nodekit.tgz", "concurrent ignored output\n");
        },
        updateDependency: true,
      }),
      (error) => error instanceof ConsumerPackagePreparationError && error.code === "CONCURRENT_OUTPUT_DRIFT",
    );
    assert.equal(await readFile(path.join(ignoredOutputDrift.consumerRoot, "vendor", "nodekit.tgz"), "utf8"), "concurrent ignored output\n");
    await absent(path.join(ignoredOutputDrift.consumerRoot, "nodekit.consumer-package.json"));
  } finally {
    await rm(ignoredOutputDrift.root, { force: true, recursive: true });
  }
});

test("rejects dirty source or consumer worktrees and requires a single existing dependency for updates", async () => {
  const dirtySource = await fixture();
  try {
    await write(dirtySource.nodekitRoot, "src/index.mjs", "export const nodekit = false;\n");
    await assert.rejects(
      prepareExactConsumerPackage({ ...dirtySource.options, updateDependency: true }),
      /clean distributable candidate/u,
    );
  } finally {
    await rm(dirtySource.root, { force: true, recursive: true });
  }

  const ignoredSource = await fixture();
  try {
    await write(ignoredSource.nodekitRoot, ".git/info/exclude", "src/ignored.mjs\n");
    await write(ignoredSource.nodekitRoot, "src/ignored.mjs", "export const ignored = true;\n");
    const ignoredSourceHash = await computeNodeKitSourceHash(ignoredSource.nodekitRoot);
    await assert.rejects(
      prepareExactConsumerPackage({ ...ignoredSource.options, sourceHash: ignoredSourceHash, updateDependency: true }),
      (error) => error instanceof ConsumerPackagePreparationError && error.code === "UNTRACKED_DISTRIBUTION",
    );
  } finally {
    await rm(ignoredSource.root, { force: true, recursive: true });
  }

  const dirtyConsumer = await fixture();
  try {
    await write(dirtyConsumer.consumerRoot, "untracked.txt", "residue\n");
    await assert.rejects(
      prepareExactConsumerPackage({ ...dirtyConsumer.options, updateDependency: true }),
      /consumer preparation requires a clean/u,
    );
  } finally {
    await rm(dirtyConsumer.root, { force: true, recursive: true });
  }

  const missingDependency = await fixture({ consumerDependencies: {} });
  try {
    await assert.rejects(
      prepareExactConsumerPackage({ ...missingDependency.options, updateDependency: true }),
      (error) => error instanceof ConsumerPackagePreparationError && error.code === "DEPENDENCY_DECLARATION_MISMATCH",
    );
  } finally {
    await rm(missingDependency.root, { force: true, recursive: true });
  }
});

test("rejects path escapes, collisions, unknown CLI flags, duplicates, and missing CLI identity", async () => {
  const current = await fixture();
  try {
    for (const change of [
      { vendorPath: "../escape.tgz" },
      { vendorPath: "vendor\\nodekit.tgz" },
      { manifestPath: "vendor/nodekit.tgz" },
      { manifestPath: "PACKAGE.json" },
      { manifestPath: "CON/provenance.json" },
      { manifestPath: "proof./provenance.json" },
      { packageJsonPath: "src/not-package.json" },
    ]) {
      await assert.rejects(prepareExactConsumerPackage({ ...current.options, ...change }), /path|distinct|package\.json/iu);
    }
  } finally {
    await rm(current.root, { force: true, recursive: true });
  }

  assert.throws(() => parseConsumerPackagePreparationArguments(["--deploy"]), /unknown argument/u);
  assert.throws(() => parseConsumerPackagePreparationArguments(["--apply", "--apply"]), /cannot be repeated/u);
  assert.throws(() => parseConsumerPackagePreparationArguments([]), /missing required arguments/u);
  assert.deepEqual(parseConsumerPackagePreparationArguments(["--help"]), { help: true });
});
