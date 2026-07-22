import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertExactDistributableCandidate,
  compareIndependentPackResults,
  parsePackageProofArguments,
  runPackageInstallProof,
  verifyPackedDistribution,
} from "../scripts/run-package-install-proof.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";

async function write(root, relative, content) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-package-runner-test-"));
  const packageJson = {
    name: "@homenshum/nodekit",
    version: "9.9.9-test",
    type: "module",
    types: "./src/index.d.mts",
    exports: {
      ".": { types: "./src/index.d.mts", import: "./src/index.mjs" },
      "./caseflow": { types: "./src/caseflow.d.mts", import: "./src/caseflow.mjs" },
      "./submission-attestation": { types: "./src/submission-attestation.d.mts", import: "./src/submission-attestation.mjs" },
      "./adapters/postgres": { types: "./src/adapters/postgres.d.mts", import: "./src/adapters/postgres.mjs" },
      "./adapters/postgres/migration.sql": "./adapters/postgres/001_caseflow.sql",
      "./adapters/supabase/profile.sql": "./adapters/supabase/001_profile.sql",
      "./adapters/supabase/workers.sql": "./adapters/supabase/002_workers.sql",
      "./convex-caseflow": { types: "./dist/client/index.d.ts", import: "./dist/client/index.js" },
      "./convex.config.js": { types: "./dist/component/convex.config.d.ts", import: "./dist/component/convex.config.js" },
      "./_generated/component.js": { types: "./src/component/_generated/component.d.ts" },
      "./test": { types: "./dist/convex-test.d.ts", import: "./dist/convex-test.js" },
      "./package.json": "./package.json",
    },
    bin: {
      nodekit: "src/cli.mjs",
      "nodekit-attestation-sign": "scripts/sign-submission-attestation.mjs",
      "nodekit-attestation-verify": "scripts/verify-submission-attestation.mjs",
    },
    peerDependencies: { convex: "^1.42.3" },
    peerDependenciesMeta: { convex: { optional: true } },
    devDependencies: { convex: "1.42.3", "convex-test": "0.0.54" },
    files: ["src", "dist", "adapters", "templates", "scripts/sign-submission-attestation.mjs", "scripts/verify-submission-attestation.mjs"],
  };
  await write(root, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  await write(root, "src/index.mjs", "export const nodekit = true;\n");
  await write(root, "src/index.d.mts", "export declare const nodekit: true;\n");
  await write(root, "src/caseflow.mjs", `import { createHash } from "node:crypto";
function canonical(value) {
  if (Array.isArray(value)) return \`[\${value.map(canonical).join(",")}]\`;
  if (value && typeof value === "object") return \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`).join(",")}}\`;
  return JSON.stringify(value);
}
export function contentHash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
`);
  await write(root, "src/caseflow.d.mts", "export declare function contentHash(value: unknown): string;\n");
  await write(root, "src/submission-attestation.mjs", `export const SUBMISSION_ATTESTATION_SCHEMA_VERSION = "nodekit.detached-attestation/v1";
export function canonicalizeAttestationPayload(value) { return JSON.stringify(value); }
`);
  await write(root, "src/submission-attestation.d.mts", `export type DetachedAttestation = Readonly<{ schemaVersion: "nodekit.detached-attestation/v1" }>;
export declare const SUBMISSION_ATTESTATION_SCHEMA_VERSION: "nodekit.detached-attestation/v1";
export declare function canonicalizeAttestationPayload(value: unknown): string;
`);
  await write(root, "src/adapters/postgres.mjs", "export const postgres = true;\n");
  await write(root, "src/adapters/postgres.d.mts", "export declare const postgres: true;\n");
  await cp(path.resolve("dist"), path.join(root, "dist"), { recursive: true });
  await write(root, "src/component/_generated/component.d.ts", `import type { FunctionReference } from "convex/server";
type Ref<K extends "mutation" | "query", A extends Record<string, unknown>, R> = FunctionReference<K, "internal", A, R>;
type Receipt = { caseHash: string; runHash: string };
export type ComponentApi = { caseflow: {
  updateCaseInput: Ref<"mutation", { caseId: string; primaryJob?: string; scopeKey: string; title?: string }, unknown>;
  completeRun: Ref<"mutation", { runId: string; scopeKey: string }, { receipt: Receipt; reused: boolean; run: unknown }>;
} };
`);
  await write(root, "adapters/postgres/001_caseflow.sql", "select 1;\n");
  await write(root, "adapters/supabase/001_profile.sql", "select 1;\n");
  await write(root, "adapters/supabase/002_workers.sql", "select 1;\n");
  await write(root, "templates/base/README.md", "# Neutral app\n");
  await write(root, "scripts/sign-submission-attestation.mjs", "#!/usr/bin/env node\nconsole.log('sign fixture');\n");
  await write(root, "scripts/verify-submission-attestation.mjs", "#!/usr/bin/env node\nconsole.log('verify fixture');\n");
  const cli = await write(root, "src/cli.mjs", `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const [, , command, target, ...args] = process.argv;
if (command !== "create" || !target) throw new Error("expected create target");
const option = (name) => args[args.indexOf(name) + 1];
const packageSpecifier = option("--nodekit-specifier");
await mkdir(path.join(target, "scripts"), { recursive: true });
await mkdir(path.join(target, ".nodeagent"), { recursive: true });
await mkdir(path.join(target, "proof"), { recursive: true });
await writeFile(path.join(target, "package.json"), JSON.stringify({
  name: "nodekit-package-proof", private: true, type: "module",
  dependencies: { "@homenshum/nodekit": packageSpecifier },
  scripts: {
    compile: "node scripts/lifecycle.mjs compile",
    check: "node scripts/lifecycle.mjs check",
    demo: "node scripts/lifecycle.mjs demo",
    eval: "node scripts/lifecycle.mjs eval"
  }
}, null, 2) + "\\n");
await writeFile(path.join(target, "scripts", "lifecycle.mjs"), \`import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { contentHash } from "@homenshum/nodekit/caseflow";
const phase = process.argv[2];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir("proof", { recursive: true });
await mkdir(".nodeagent", { recursive: true });
if (phase === "compile") {
  const files = await Promise.all(["package.json", "package-lock.json", "vendor/nodekit.tgz"].map(async (file) => ({ path: file, digest: digest(await readFile(file)) })));
  await writeFile(path.join(".nodeagent", "application-identity.json"), JSON.stringify({ schemaVersion: "nodeagent.application-identity/v1", applicationHash: "a".repeat(64), configHash: "b".repeat(64), identity: { files } }) + "\\\\n");
}
if (phase === "demo") {
  const receiptBody = { artifactBindings: [], caseHash: "c".repeat(64), runHash: "d".repeat(64), schemaVersion: "nodekit.receipt/v2", status: "completed" };
  const receipt = { ...receiptBody, receiptId: "receipt_" + "1".repeat(26), receiptHash: contentHash(receiptBody) };
  await writeFile(path.join("proof", "demo-receipt.json"), JSON.stringify({ schemaVersion: "nodekit.figured-out-demo/v1", passed: true, receipt }) + "\\\\n");
}
if (phase === "eval") await writeFile(path.join("proof", "eval-receipt.json"), JSON.stringify({ schemaVersion: "nodekit.eval-receipt/v1", passed: true }) + "\\\\n");
\`);
await writeFile(path.join(target, ".nodeagent", "application-identity.json"), JSON.stringify({ schemaVersion: "nodeagent.application-identity/v1", applicationHash: "a".repeat(64), configHash: "b".repeat(64) }) + "\\n");
`);
  await chmod(cli, 0o755);
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "candidate"]);
  return root;
}

test("argument parser requires exact-candidate identity inputs", () => {
  assert.throws(() => parsePackageProofArguments([]), /--candidate is required/);
  assert.throws(() => parsePackageProofArguments(["--candidate", "a".repeat(40)]), /--source-hash is required/);
  assert.deepEqual(parsePackageProofArguments(["--candidate", "a".repeat(40), "--source-hash", "b".repeat(64), "--keep-temp"]), {
    candidateCommit: "a".repeat(40),
    canonicalOutput: undefined,
    keepTemp: true,
    repoRoot: path.resolve("."),
    sourceHash: "b".repeat(64),
    timeoutMs: undefined,
  });
});

test("source identity uses locale-independent code-unit path ordering", async () => {
  const source = await readFile(path.resolve("src/lib/source-hash.mjs"), "utf8");
  assert.match(source, /left\.path < right\.path \? -1 : left\.path > right\.path \? 1 : 0/);
  assert.doesNotMatch(source, /localeCompare/);
});

test("distribution verification fails closed when the Convex component API is absent", () => {
  const packageJson = {
    bin: {
      nodekit: "src/cli.mjs",
      "nodekit-attestation-sign": "scripts/sign-submission-attestation.mjs",
      "nodekit-attestation-verify": "scripts/verify-submission-attestation.mjs",
    },
    exports: {
      "./caseflow": { types: "./src/caseflow.d.mts" },
      "./submission-attestation": { types: "./src/submission-attestation.d.mts", import: "./src/submission-attestation.mjs" },
      "./convex-caseflow": { types: "./dist/client/index.d.ts", import: "./dist/client/index.js" },
      "./convex.config.js": { types: "./dist/component/convex.config.d.ts", import: "./dist/component/convex.config.js" },
      "./_generated/component.js": { types: "./dist/component/_generated/component.d.ts" },
      "./test": "./src/convex-test.ts",
      "./adapters/postgres": { types: "./src/adapters/postgres.d.mts", import: "./src/adapters/postgres.mjs" },
      "./adapters/postgres/migration.sql": "./adapters/postgres/001_caseflow.sql",
      "./adapters/supabase/profile.sql": "./adapters/supabase/001_profile.sql",
    },
  };
  const files = [
    "src/cli.mjs", "scripts/sign-submission-attestation.mjs", "scripts/verify-submission-attestation.mjs",
    "src/caseflow.d.mts", "src/submission-attestation.d.mts", "src/submission-attestation.mjs",
    "dist/client/index.d.ts", "dist/client/index.js",
    "dist/component/convex.config.d.ts", "dist/component/convex.config.js", "src/convex-test.ts",
    "src/adapters/postgres.d.mts", "src/adapters/postgres.mjs", "adapters/postgres/001_caseflow.sql",
    "adapters/supabase/001_profile.sql",
  ];
  const verdict = verifyPackedDistribution(packageJson, files);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.convexComponentApi, false);
  assert.equal(verdict.checks.submissionAttestation, true);
  assert.equal(verdict.checks.attestationSignBin, true);
  assert.equal(verdict.checks.attestationVerifyBin, true);
  assert.deepEqual(verdict.missingExportTargets, ["dist/component/_generated/component.d.ts"]);
});

test("distribution verification requires the attestation subpath and both named attestation bins", () => {
  const packageJson = {
    bin: {
      nodekit: "src/cli.mjs",
      "nodekit-attestation-sign": "scripts/sign-submission-attestation.mjs",
      "nodekit-attestation-verify": "scripts/verify-submission-attestation.mjs",
    },
    exports: {
      "./caseflow": { types: "./src/caseflow.d.mts" },
      "./submission-attestation": { types: "./src/submission-attestation.d.mts", import: "./src/submission-attestation.mjs" },
    },
  };
  const files = [
    "src/cli.mjs",
    "src/caseflow.d.mts",
    "src/submission-attestation.d.mts",
    "src/submission-attestation.mjs",
    "scripts/sign-submission-attestation.mjs",
    "scripts/verify-submission-attestation.mjs",
  ];

  const complete = verifyPackedDistribution(packageJson, files);
  assert.equal(complete.checks.submissionAttestation, true);
  assert.equal(complete.checks.attestationSignBin, true);
  assert.equal(complete.checks.attestationVerifyBin, true);

  const missingExport = structuredClone(packageJson);
  delete missingExport.exports["./submission-attestation"];
  assert.equal(verifyPackedDistribution(missingExport, files).checks.submissionAttestation, false);

  const missingSign = structuredClone(packageJson);
  delete missingSign.bin["nodekit-attestation-sign"];
  assert.equal(verifyPackedDistribution(missingSign, files).checks.attestationSignBin, false);

  const missingVerify = structuredClone(packageJson);
  delete missingVerify.bin["nodekit-attestation-verify"];
  assert.equal(verifyPackedDistribution(missingVerify, files).checks.attestationVerifyBin, false);
});

test("independent package comparison fails closed on changed bytes or file manifests", () => {
  const base = {
    archiveFiles: [{ path: "package.json", sha256: "a".repeat(64), size: 10 }],
    archiveManifestSha256: "b".repeat(64),
    packFiles: [{ mode: 420, path: "package.json", size: 10 }],
    tarballSha256: "c".repeat(64),
  };
  assert.equal(compareIndependentPackResults(base, structuredClone(base)).passed, true);
  const changedBytes = structuredClone(base);
  changedBytes.tarballSha256 = "d".repeat(64);
  assert.match(compareIndependentPackResults(base, changedBytes).errors.join("\n"), /tarball SHA-256/);
  const changedManifest = structuredClone(base);
  changedManifest.archiveFiles[0].size = 11;
  assert.match(compareIndependentPackResults(base, changedManifest).errors.join("\n"), /archive manifests differ/);
});

test("candidate check rejects dirty files inside the distributable tree", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { force: true, recursive: true }));
  const candidate = git(root, ["rev-parse", "HEAD"]);
  const sourceHash = await computeNodeKitSourceHash(root);
  await write(root, "src/dirty.mjs", "export const dirty = true;\n");
  await assert.rejects(
    () => assertExactDistributableCandidate(root, candidate, sourceHash),
    /clean distributable candidate; dirty paths: src\/dirty\.mjs/,
  );
});

test("candidate check preserves porcelain status columns for modified tracked files", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { force: true, recursive: true }));
  const candidate = git(root, ["rev-parse", "HEAD"]);
  const sourceHash = await computeNodeKitSourceHash(root);
  await write(root, "src/index.mjs", "export const nodekit = false;\n");
  await assert.rejects(
    () => assertExactDistributableCandidate(root, candidate, sourceHash),
    /clean distributable candidate; dirty paths: src\/index\.mjs/,
  );
});

test("candidate check parses NUL-delimited rename records without losing either path", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { force: true, recursive: true }));
  const candidate = git(root, ["rev-parse", "HEAD"]);
  const sourceHash = await computeNodeKitSourceHash(root);
  git(root, ["mv", "src/index.mjs", "src/renamed index.mjs"]);
  await assert.rejects(
    () => assertExactDistributableCandidate(root, candidate, sourceHash),
    /clean distributable candidate; dirty paths: src\/renamed index\.mjs, src\/index\.mjs/,
  );
});

test("runner proves the exact packed artifact in fresh consumers without publishing or deploying", { timeout: 120_000 }, async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { force: true, recursive: true }));
  const candidateCommit = git(root, ["rev-parse", "HEAD"]);
  const sourceHash = await computeNodeKitSourceHash(root);
  const verdict = await runPackageInstallProof({
    candidateCommit,
    canonicalOutput: path.join(root, "proof", "package-install-verdict.json"),
    repoRoot: root,
    sourceHash,
    timeoutMs: 60_000,
  });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.nodekitIdentity, `${candidateCommit}/${sourceHash}`);
  assert.equal(verdict.publicationPerformed, false);
  assert.equal(verdict.deployPerformed, false);
  assert.equal(verdict.checks.packagedCliCreate, true);
  assert.equal(verdict.checks.convexComponentRuntime, true);
  assert.equal(verdict.checks.receiptsValid, true);
  assert.equal(verdict.checks.tarballHashStable, true);
  assert.equal(verdict.checks.typecheckPublic, true);
  assert.equal(Object.values(verdict.distributionChecks).every(Boolean), true);
  assert.match(verdict.tarball, new RegExp(`proof/ease/candidates/${candidateCommit}/${sourceHash}/package/.+\\.tgz$`));
  assert.equal((await readFile(path.join(root, "proof", "package-install-verdict.json"), "utf8")).includes('"passed": true'), true);
  assert.equal(verdict.supportingEvidence.length, 15);
  assert.deepEqual(verdict.releaseCandidate, {
    nodekitCommit: candidateCommit,
    nodekitSourceHash: sourceHash,
    nodekitTarballSha256: verdict.tarballSha256,
    packageName: "@homenshum/nodekit",
    packageVersion: "9.9.9-test",
  });
  assert.equal(verdict.applicationHash, "a".repeat(64));
  assert.equal(verdict.configHash, "b".repeat(64));
  assert.match(verdict.generatedCandidateCommit, /^[a-f0-9]{40}$/);
  assert.match(verdict.generatedCandidateTree, /^[a-f0-9]{40}$/);
  assert.match(verdict.generatedCandidateArchiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(verdict.supportingEvidence.map((entry) => path.basename(entry.path))).has("generated-app.tar.gz"), true);
  assert.equal(new Set(verdict.supportingEvidence.map((entry) => path.basename(entry.path))).has("generated-receipt-bindings.json"), true);
  assert.equal(new Set(verdict.supportingEvidence.map((entry) => path.basename(entry.path))).has("installed-runtime-identity.json"), true);
  for (const evidence of verdict.supportingEvidence) assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  const archiveEntries = execFileSync("tar", ["-tzf", path.join(root, verdict.generatedCandidateArchive)], { encoding: "utf8" });
  for (const required of ["package.json", "package-lock.json", "vendor/nodekit.tgz", ".nodeagent/application-identity.json", "proof/demo-receipt.json", "proof/eval-receipt.json"]) {
    assert.match(archiveEntries, new RegExp(`(?:^|\\n)${required.replaceAll(".", "\\.")}(?:\\r?\\n|$)`));
  }
  const bindingPath = verdict.supportingEvidence.find((entry) => path.basename(entry.path) === "generated-receipt-bindings.json").path;
  const bindings = JSON.parse(await readFile(path.join(root, bindingPath), "utf8"));
  assert.equal(bindings.nodekitTarballSha256, verdict.tarballSha256);
  assert.equal(bindings.applicationHash, verdict.applicationHash);
  const packageFilesPath = verdict.supportingEvidence.find((entry) => path.basename(entry.path) === "package-files.json").path;
  const packageFiles = JSON.parse(await readFile(path.join(root, packageFilesPath), "utf8"));
  assert.equal(packageFiles.reproducible, true);
  assert.equal(packageFiles.distribution.checks.submissionAttestation, true);
  assert.equal(packageFiles.distribution.checks.attestationSignBin, true);
  assert.equal(packageFiles.distribution.checks.attestationVerifyBin, true);
  assert.equal(packageFiles.independentPacks.length, 2);
  assert.equal(new Set(packageFiles.independentPacks.map((entry) => entry.tarballSha256)).size, 1);
  assert.equal(packageFiles.archiveFiles.some((entry) => entry.path === "package.json"), true);
  assert.equal(packageFiles.packFiles.some((entry) => entry.path === "package.json"), true);
});
