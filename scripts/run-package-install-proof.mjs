import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveTarCommand } from "../src/lib/npm-cli-invocation.mjs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../src/lib/caseflow.mjs";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "../src/lib/distributable-candidate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_PROOF_DISTRIBUTION_CHECK_IDS = Object.freeze([
  "attestationSignBin",
  "attestationVerifyBin",
  "builderGym",
  "caseflowTypes",
  "consumerPackagePreparation",
  "consumerPrepareBin",
  "convexClient",
  "convexConfig",
  "convexComponentApi",
  "convexComponentRuntime",
  "convexTestExport",
  "postgresAdapter",
  "postgresMigration",
  "evidenceFinalizeBin",
  "packageMetadata",
  "submissionAttestation",
  "submissionEvidenceFinalizer",
  "skillEvaluation",
  "supabaseProfile",
  "supabaseWorkers",
]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileDigest(file) {
  return digest(await readFile(file));
}

function slash(value) {
  return value.replaceAll("\\", "/");
}

function relative(repoRoot, absolute) {
  return slash(path.relative(repoRoot, absolute));
}

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

export async function assertExactDistributableCandidate(repoRoot, expectedCommit, expectedSourceHash) {
  if (!COMMIT.test(expectedCommit ?? "")) throw new Error("--candidate must be a full lowercase 40-character Git commit");
  if (!SHA256.test(expectedSourceHash ?? "")) throw new Error("--source-hash must be a lowercase 64-character SHA-256 digest");
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const actualCommit = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  if (actualCommit !== expectedCommit) {
    throw new Error(`candidate commit mismatch: expected ${expectedCommit}, received ${actualCommit}`);
  }
  const pathspecs = distributablePathspecs(packageJson);
  const dirty = parseGitStatusPorcelainZ(git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspecs]));
  assertCleanDistributablePaths(dirty, "package proof");
  const actualSourceHash = await computeNodeKitSourceHash(repoRoot);
  if (actualSourceHash !== expectedSourceHash) {
    throw new Error(`source hash mismatch: expected ${expectedSourceHash}, received ${actualSourceHash}`);
  }
  return { actualCommit, actualSourceHash, packageJson };
}

function exportTargets(value, targets = []) {
  if (typeof value === "string") {
    if (value.startsWith("./")) targets.push(value.slice(2));
    return targets;
  }
  if (!value || typeof value !== "object") return targets;
  for (const child of Object.values(value)) exportTargets(child, targets);
  return targets;
}

function exportEntry(packageJson, key) {
  return packageJson.exports?.[key];
}

function entryTargets(packageJson, key) {
  return exportTargets(exportEntry(packageJson, key));
}

function hasPackedTarget(files, target) {
  return files.has(target.replace(/^\.\//, ""));
}

function entryIncludes(packageJson, files, key, matcher) {
  const targets = entryTargets(packageJson, key);
  return targets.some((target) => matcher(target) && hasPackedTarget(files, target));
}

function binIncludes(packageJson, files, key, matcher) {
  const target = packageJson.bin?.[key];
  return typeof target === "string"
    && matcher(target.replace(/^\.\//, ""))
    && hasPackedTarget(files, target);
}

function packageMetadataComplete(packageJson) {
  const requiredKeywords = [
    "ai-agents",
    "agent-applications",
    "convex",
    "evaluation",
    "proof",
    "scaffolding",
  ];
  return packageJson.repository?.type === "git"
    && packageJson.repository?.url === "git+https://github.com/HomenShum/node-platform.git"
    && packageJson.homepage === "https://github.com/HomenShum/node-platform#readme"
    && packageJson.bugs?.url === "https://github.com/HomenShum/node-platform/issues"
    && packageJson.author === "Homen Shum"
    && Array.isArray(packageJson.keywords)
    && requiredKeywords.every((keyword) => packageJson.keywords.includes(keyword));
}

export function verifyPackedDistribution(packageJson, packedFiles) {
  const files = new Set(packedFiles.map((entry) => typeof entry === "string" ? entry : entry.path));
  const exportedTargets = exportTargets(packageJson.exports);
  const missingExportTargets = [...new Set(exportedTargets)].filter((target) => !hasPackedTarget(files, target));
  const binTargets = Object.values(packageJson.bin ?? {}).map((target) => String(target).replace(/^\.\//, ""));
  const missingBinTargets = binTargets.filter((target) => !hasPackedTarget(files, target));
  const checks = {
    attestationSignBin: binIncludes(packageJson, files, "nodekit-attestation-sign", (target) => target === "scripts/sign-submission-attestation.mjs"),
    attestationVerifyBin: binIncludes(packageJson, files, "nodekit-attestation-verify", (target) => target === "scripts/verify-submission-attestation.mjs"),
    builderGym: entryIncludes(packageJson, files, "./builder-gym", (target) => /builder-gym\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./builder-gym", (target) => /builder-gym\.d\.mts$/.test(target)),
    consumerPackagePreparation: entryIncludes(packageJson, files, "./consumer-package-preparation", (target) => /consumer-package-preparation\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./consumer-package-preparation", (target) => /consumer-package-preparation\.d\.mts$/.test(target)),
    consumerPrepareBin: binIncludes(packageJson, files, "nodekit-consumer-prepare", (target) => target === "scripts/prepare-consumer-package.mjs"),
    evidenceFinalizeBin: binIncludes(packageJson, files, "nodekit-evidence-finalize", (target) => target === "scripts/finalize-submission-evidence.mjs"),
    caseflowTypes: entryIncludes(packageJson, files, "./caseflow", (target) => /caseflow\.d\.(?:mts|ts)$/.test(target)),
    convexClient: entryIncludes(packageJson, files, "./convex-caseflow", (target) => /dist\/client\/index\.js$/.test(target))
      && entryIncludes(packageJson, files, "./convex-caseflow", (target) => /dist\/client\/index\.d\.ts$/.test(target)),
    convexConfig: entryIncludes(packageJson, files, "./convex.config.js", (target) => /dist\/component\/convex\.config\.js$/.test(target))
      && entryIncludes(packageJson, files, "./convex.config.js", (target) => /dist\/component\/convex\.config\.d\.ts$/.test(target)),
    convexComponentApi: entryIncludes(packageJson, files, "./_generated/component.js", (target) => /(?:dist|src)\/component\/_generated\/component\.d\.ts$/.test(target)),
    convexComponentRuntime: files.has("dist/component/schema.js")
      && [...files].some((file) => /^dist\/component\/(?!convex\.config|_generated\/).+\.js$/.test(file)),
    convexTestExport: entryTargets(packageJson, "./test").some((target) => hasPackedTarget(files, target)),
    postgresAdapter: entryIncludes(packageJson, files, "./adapters/postgres", (target) => /postgres\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./adapters/postgres", (target) => /postgres\.d\.mts$/.test(target)),
    postgresMigration: entryIncludes(packageJson, files, "./adapters/postgres/migration.sql", (target) => /adapters\/postgres\/001_caseflow\.sql$/.test(target)),
    packageMetadata: packageMetadataComplete(packageJson),
    submissionAttestation: entryIncludes(packageJson, files, "./submission-attestation", (target) => /submission-attestation\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./submission-attestation", (target) => /submission-attestation\.d\.mts$/.test(target)),
    submissionEvidenceFinalizer: entryIncludes(packageJson, files, "./submission-evidence-finalizer", (target) => /submission-evidence-finalizer\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./submission-evidence-finalizer", (target) => /submission-evidence-finalizer\.d\.mts$/.test(target)),
    skillEvaluation: entryIncludes(packageJson, files, "./skill-evaluation", (target) => /skill-evaluation\.mjs$/.test(target))
      && entryIncludes(packageJson, files, "./skill-evaluation", (target) => /skill-evaluation\.d\.mts$/.test(target)),
    supabaseProfile: entryIncludes(packageJson, files, "./adapters/supabase/profile.sql", (target) => /adapters\/supabase\/001_profile\.sql$/.test(target)),
    supabaseWorkers: entryIncludes(packageJson, files, "./adapters/supabase/workers.sql", (target) => /adapters\/supabase\/002_workers\.sql$/.test(target)),
  };
  return {
    checks,
    missingBinTargets,
    missingExportTargets,
    passed: missingExportTargets.length === 0
      && missingBinTargets.length === 0
      && binTargets.length > 0
      && Object.values(checks).every(Boolean),
  };
}

function packageProofDistributionChecks(checks) {
  return Object.fromEntries(PACKAGE_PROOF_DISTRIBUTION_CHECK_IDS.map((id) => [id, checks[id] === true]));
}

function sanitizeText(value, replacements) {
  let output = String(value ?? "");
  for (const [needle, replacement] of replacements) {
    if (needle) output = output.replaceAll(needle, replacement);
  }
  return output;
}

function execute(ledger, { command, args, cwd, label, displayArgs = args, replacements = [], timeoutMs = 300_000 }) {
  const isNpm = /(?:^|[\\/])npm(?:\.cmd)?$/i.test(command);
  const invocation = isNpm
    ? resolveNpmCliInvocation(args)
    : { args, command, displayArgs, displayCommand: path.basename(command).replace(/\.cmd$/i, ""), shell: false };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", npm_config_audit: "false", npm_config_fund: "false" },
    maxBuffer: 50 * 1024 * 1024,
    shell: invocation.shell,
    timeout: timeoutMs,
  });
  const stdout = sanitizeText(result.stdout ?? "", replacements);
  const stderr = sanitizeText(result.stderr ?? "", replacements);
  const record = {
    args: displayArgs ?? invocation.displayArgs,
    command: isNpm ? invocation.displayCommand : path.basename(command).replace(/\.cmd$/i, ""),
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    label,
    signal: result.signal ?? null,
    startedAt,
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: digest(stderr),
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: digest(stdout),
    timedOut: result.error?.code === "ETIMEDOUT",
  };
  ledger.push(record);
  return { error: result.error, record, status: result.status, stderr, stdout };
}

function requirePass(result) {
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`${result.record.label} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail.slice(-2_000)}` : ""}`);
  }
  return result;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function tarCommand() {
  return resolveTarCommand();
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function directoryManifest(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexical(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`archive manifest cannot contain a symlink: ${absolute}`);
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) {
        files.push({
          path: slash(path.relative(root, absolute)),
          sha256: await fileDigest(absolute),
          size: metadata.size,
        });
      } else throw new Error(`archive manifest contains an unsupported entry: ${absolute}`);
    }
  }
  await visit(root);
  return files.sort((left, right) => lexical(left.path, right.path));
}

function packFileManifest(pack) {
  return (pack.files ?? [])
    .map((entry) => ({ mode: entry.mode ?? null, path: slash(entry.path), size: entry.size }))
    .sort((left, right) => lexical(left.path, right.path));
}

function parsePackRecord(stdout) {
  const parsed = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("npm pack did not return exactly one package record");
  return parsed[0];
}

function validateArchiveEntries(stdout) {
  const entries = stdout.split(/\r?\n/).filter(Boolean).map(slash);
  if (entries.length === 0) throw new Error("packed archive is empty");
  for (const entry of entries) {
    if (!entry.startsWith("package/")
      || entry.startsWith("/")
      || /^[A-Za-z]:/.test(entry)
      || entry.split("/").includes("..")) {
      throw new Error(`packed archive contains an unsafe entry: ${entry}`);
    }
  }
  return entries;
}

async function inspectPackedArchive({ archive, extractRoot, ledger, replacements, timeoutMs }) {
  await mkdir(extractRoot, { recursive: true });
  const listed = requirePass(execute(ledger, {
    args: ["-tzf", archive],
    command: tarCommand(),
    cwd: extractRoot,
    displayArgs: ["-tzf", "<tarball>"],
    label: "inspect packed archive",
    replacements,
    timeoutMs,
  }));
  validateArchiveEntries(listed.stdout);
  requirePass(execute(ledger, {
    args: ["-xzf", archive, "-C", extractRoot],
    command: tarCommand(),
    cwd: extractRoot,
    displayArgs: ["-xzf", "<tarball>", "-C", "<extract-root>"],
    label: "reopen packed archive",
    replacements,
    timeoutMs,
  }));
  const packageRoot = path.join(extractRoot, "package");
  const manifest = await directoryManifest(packageRoot);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  return { manifest, manifestSha256: digest(JSON.stringify(manifest)), packageJson };
}

export function compareIndependentPackResults(first, second) {
  const errors = [];
  if (first.tarballSha256 !== second.tarballSha256) errors.push("independent tarball SHA-256 digests differ");
  if (JSON.stringify(first.packFiles) !== JSON.stringify(second.packFiles)) errors.push("independent npm pack file manifests differ");
  if (JSON.stringify(first.archiveFiles) !== JSON.stringify(second.archiveFiles)) errors.push("independently reopened archive manifests differ");
  if (first.archiveManifestSha256 !== second.archiveManifestSha256) errors.push("independent archive manifest digests differ");
  return { errors, passed: errors.length === 0 };
}

function verifyPackManifestMatchesArchive(packFiles, archiveFiles) {
  const normalizedPack = packFiles.map(({ path: filePath, size }) => ({ path: filePath, size }));
  const normalizedArchive = archiveFiles.map(({ path: filePath, size }) => ({ path: filePath, size }));
  return JSON.stringify(normalizedPack) === JSON.stringify(normalizedArchive);
}

function publicTypecheckSource() {
  return `import * as nodekit from "@homenshum/nodekit";
import * as caseflow from "@homenshum/nodekit/caseflow";
import * as postgres from "@homenshum/nodekit/adapters/postgres";
import {
  SUBMISSION_ATTESTATION_SCHEMA_VERSION,
  canonicalizeAttestationPayload,
  type DetachedAttestation,
} from "@homenshum/nodekit/submission-attestation";
import {
  FINALIZABLE_SUBMISSION_GATES,
  SIGNING_KEY_POLICY_SCHEMA_VERSION,
  finalizeSubmissionEvidence,
} from "@homenshum/nodekit/submission-evidence-finalizer";
import {
  CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
  prepareExactConsumerPackage,
  type ConsumerPackagePreparationOptions,
} from "@homenshum/nodekit/consumer-package-preparation";
import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymStatus,
} from "@homenshum/nodekit/builder-gym";
import {
  computeSkillEvidenceClosure,
  type SkillTrustedKeyMap,
} from "@homenshum/nodekit/skill-evaluation";
import * as convexClient from "@homenshum/nodekit/convex-caseflow";
import convexConfig from "@homenshum/nodekit/convex.config.js";
import type { ComponentApi } from "@homenshum/nodekit/_generated/component.js";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import * as convexTest from "@homenshum/nodekit/test";
void [nodekit, caseflow, postgres, convexClient, convexConfig, convexTest];
const attestationSchema: "nodekit.detached-attestation/v1" = SUBMISSION_ATTESTATION_SCHEMA_VERSION;
const canonicalPayload: string = canonicalizeAttestationPayload({ gate: "package-consumer" });
const consumerProvenanceSchema: "nodekit.consumer-package-provenance/v1" = CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION;
declare const consumerPreparationOptions: ConsumerPackagePreparationOptions;
void prepareExactConsumerPackage;
void consumerPreparationOptions;
void builderGymStatus;
void computeSkillEvidenceClosure;
declare const skillTrustedKeys: SkillTrustedKeyMap;
void skillTrustedKeys;
const builderDimension = NODETRACE_VERDICT_DIMENSIONS[0];
declare const detachedAttestation: DetachedAttestation;
type UpdateCaseInputArgs = FunctionArgs<ComponentApi["caseflow"]["updateCaseInput"]>;
const updateCaseInputWithoutPrimaryJob = { caseId: "case", scopeKey: "scope", title: "Updated" } satisfies UpdateCaseInputArgs;
type Completion = FunctionReturnType<ComponentApi["caseflow"]["completeRun"]>;
function assertReceiptV2(value: Completion) {
  const hashes: [string, string] = [value.receipt.caseHash, value.receipt.runHash];
  return hashes;
}
void [attestationSchema, canonicalPayload, consumerProvenanceSchema, builderDimension, detachedAttestation, FINALIZABLE_SUBMISSION_GATES, SIGNING_KEY_POLICY_SCHEMA_VERSION, finalizeSubmissionEvidence, updateCaseInputWithoutPrimaryJob, assertReceiptV2];
`;
}

function publicTypecheckConfig() {
  return {
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2022",
    },
    include: ["public-api.ts"],
  };
}

function builderGymRuntimeProofSource() {
  return `import assert from "node:assert/strict";
import * as nodekit from "@homenshum/nodekit";
import * as builderGym from "@homenshum/nodekit/builder-gym";

const dimensions = ["task", "artifact", "ui", "safety", "efficiency", "evidence", "humanPreference"];
const functions = [
  "builderGymContext",
  "builderGymStatus",
  "createBuilderGymLock",
  "evaluateBuilderGym",
  "initializeBuilderGym",
  "inspectBuilderGymVerdict",
  "inspectNodeTraceTrajectory",
  "recordNodeTraceTrajectory",
  "sealNodeTraceTrajectory",
  "verifyBuilderGymLock",
  "verifyBuilderGymVerdict",
  "verifyNodeTraceTrajectory",
];

assert.deepEqual(builderGym.NODETRACE_VERDICT_DIMENSIONS, dimensions);
assert.deepEqual(nodekit.NODETRACE_VERDICT_DIMENSIONS, dimensions);
for (const name of functions) {
  assert.equal(typeof builderGym[name], "function", \`builder-gym subpath must export \${name}\`);
  assert.equal(nodekit[name], builderGym[name], \`package root and builder-gym subpath must share \${name}\`);
}

console.log(JSON.stringify({
  checks: {
    dimensionsExact: true,
    functionsCallable: true,
    rootAndSubpathMatch: true,
  },
  dimensions,
  functions,
  passed: true,
  schemaVersion: "nodekit.installed-builder-gym-runtime-proof/v1",
}));
`;
}

function convexRuntimeProofSource() {
  return `import assert from "node:assert/strict";
import { componentsGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { contentHash } from "@homenshum/nodekit/caseflow";
import { modules, register } from "@homenshum/nodekit/test";

const t = convexTest(undefined, modules);
register(t, "nodekitCaseflow");
const component = componentsGeneric().nodekitCaseflow;
const scopeKey = "package_consumer_owner";
const otherScope = "package_consumer_other_owner";
const actor = { id: "package_consumer", type: "human" };

const work = await t.mutation(component.caseflow.createCase, {
  actor,
  primaryJob: "Prove the installed component runtime",
  scopeKey,
  title: "Installed package proof",
});
assert.match(work.caseId, /^case_[a-f0-9]{26}$/);
assert.equal(await t.query(component.caseflow.getCase, { caseId: work.caseId, scopeKey: otherScope }), null);
let crossScopeDenied = false;
try {
  await t.mutation(component.caseflow.updateCaseInput, { caseId: work.caseId, scopeKey: otherScope, title: "Forbidden" });
} catch (error) {
  crossScopeDenied = /case not found/.test(String(error));
}
assert.equal(crossScopeDenied, true);

const run = await t.mutation(component.caseflow.startRun, {
  actor,
  caseId: work.caseId,
  scopeKey,
  stages: [
    { id: "work", label: "Prepare artifact", owner: "agent" },
    { id: "review", label: "Review proposal", owner: "user" },
    { id: "complete", label: "Verify completion", owner: "system" },
  ],
});
assert.match(run.runId, /^run_[a-f0-9]{26}$/);
const blocked = await t.mutation(component.caseflow.raiseException, {
  actor,
  code: "package_probe",
  idempotencyKey: "exception-retry",
  preservedState: { stage: "work" },
  preservedStateHash: contentHash({ stage: "work" }),
  runId: run.runId,
  scopeKey,
});
const blockedRetry = await t.mutation(component.caseflow.raiseException, {
  actor,
  code: "package_probe",
  idempotencyKey: "exception-retry",
  preservedState: { stage: "work" },
  preservedStateHash: contentHash({ stage: "work" }),
  runId: run.runId,
  scopeKey,
});
assert.deepEqual(blockedRetry, blocked);
const recovered = await t.mutation(component.caseflow.resolveException, {
  actor,
  exceptionId: blocked.exceptionId,
  nextAction: "Prepare artifact",
  nextActionOwner: "agent",
  resolution: "Package probe recovered",
  scopeKey,
});
assert.equal(recovered.run.status, "active");

const artifact = await t.mutation(component.caseflow.createArtifact, {
  actor,
  caseId: work.caseId,
  content: { status: "baseline" },
  contentHash: contentHash({ status: "baseline" }),
  idempotencyKey: "artifact-retry",
  kind: "neutral",
  runId: run.runId,
  scopeKey,
  title: "Verified artifact",
});
const artifactRetry = await t.mutation(component.caseflow.createArtifact, {
  actor,
  caseId: work.caseId,
  content: { status: "baseline" },
  contentHash: contentHash({ status: "baseline" }),
  idempotencyKey: "artifact-retry",
  kind: "neutral",
  runId: run.runId,
  scopeKey,
  title: "Verified artifact",
});
assert.deepEqual(artifactRetry, artifact);
assert.match(artifact.artifactId, /^artifact_[a-f0-9]{26}$/);

const acceptedCandidate = await t.mutation(component.caseflow.createProposal, {
  actor,
  artifactId: artifact.artifactId,
  baseVersion: 1,
  patch: { status: "accepted" },
  patchHash: contentHash({ status: "accepted" }),
  rationale: "Exact installed-package lifecycle",
  scopeKey,
});
const staleCandidate = await t.mutation(component.caseflow.createProposal, {
  actor,
  artifactId: artifact.artifactId,
  baseVersion: 1,
  patch: { status: "stale" },
  patchHash: contentHash({ status: "stale" }),
  rationale: "Exercise stale conflict protection",
  scopeKey,
});
const accepted = await t.mutation(component.caseflow.decideProposal, {
  actor,
  decision: "accepted",
  proposalId: acceptedCandidate.proposalId,
  scopeKey,
});
assert.equal(accepted.artifact.canonicalVersion, 2);
const conflicted = await t.mutation(component.caseflow.decideProposal, {
  actor,
  decision: "accepted",
  proposalId: staleCandidate.proposalId,
  scopeKey,
});
assert.equal(conflicted.proposal.status, "conflicted");

await t.mutation(component.caseflow.enterStage, { actor, runId: run.runId, scopeKey, stageId: "complete" });
const completion = await t.mutation(component.caseflow.completeRun, { actor, runId: run.runId, scopeKey });
const { receiptHash, receiptId, ...receiptBody } = completion.receipt;
assert.match(receiptId, /^receipt_[a-f0-9]{26}$/);
assert.equal(receiptHash, contentHash(receiptBody));
assert.equal(completion.receipt.artifactBindings[0].contentHash, contentHash({ status: "accepted" }));

console.log(JSON.stringify({
  checks: {
    componentRegistered: true,
    crossScopeDenied,
    exceptionRecovery: recovered.run.status === "active",
    idempotentRetries: artifactRetry.artifactId === artifact.artifactId && blockedRetry.exceptionId === blocked.exceptionId,
    receiptVerified: receiptHash === contentHash(receiptBody),
    scopedLifecycleCompleted: completion.run.status === "completed",
    staleConflictProtected: conflicted.proposal.status === "conflicted" && conflicted.artifact.canonicalVersion === 2,
  },
  receiptHash,
  schemaVersion: "nodekit.installed-convex-runtime-proof/v1",
}));
`;
}

async function supportingEvidence(repoRoot, files) {
  return Promise.all(files.map(async (file) => ({ path: relative(repoRoot, file), sha256: await fileDigest(file) })));
}

export async function runPackageInstallProof({
  candidateCommit,
  canonicalOutput,
  keepTemp = false,
  repoRoot = defaultRepoRoot,
  sourceHash,
  timeoutMs = 300_000,
} = {}) {
  repoRoot = path.resolve(repoRoot);
  const initial = await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
  const { packageJson } = initial;
  if (packageJson.name !== "@homenshum/nodekit") throw new Error(`unexpected package name ${packageJson.name ?? "<missing>"}`);
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) throw new Error("package version is required");

  const candidateProofRoot = path.join(repoRoot, "proof", "ease", "candidates", candidateCommit, sourceHash, "package");
  const canonicalVerdictPath = path.join(repoRoot, "proof", "package-install-verdict.json");
  const additionalVerdictPath = canonicalOutput ? path.resolve(canonicalOutput) : null;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-package-proof-"));
  const packRoots = [path.join(tempRoot, "pack-a"), path.join(tempRoot, "pack-b")];
  const consumerRoot = path.join(tempRoot, "consumer");
  const generatedRoot = path.join(tempRoot, "generated-app");
  const ledger = [];
  const checks = {
    builderGymRuntime: false,
    candidateIdentityStable: false,
    check: false,
    compile: false,
    consumerPrepareBinRuntime: false,
    convexComponentRuntime: false,
    demo: false,
    distributionComplete: false,
    evidenceFinalizeBinRuntime: false,
    eval: false,
    freshConsumerInstall: false,
    generatedAppInstall: false,
    packagedCliCreate: false,
    receiptsValid: false,
    tarballHashStable: false,
    typecheckPublic: false,
  };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let failure = null;
  let pack = null;
  let tarballPath = null;
  let reproducedPack = null;
  let distribution = { checks: {}, missingBinTargets: [], missingExportTargets: [], passed: false };
  const replacements = [[repoRoot, "<repo>"], [tempRoot, "<temp>"], [candidateProofRoot, "<proof>"]];

  await rm(candidateProofRoot, { force: true, recursive: true });
  await mkdir(candidateProofRoot, { recursive: true });
  await Promise.all(packRoots.map((directory) => mkdir(directory, { recursive: true })));
  await mkdir(consumerRoot, { recursive: true });
  try {
    const independentPacks = [];
    for (let index = 0; index < packRoots.length; index += 1) {
      const packRoot = packRoots[index];
      const packResult = requirePass(execute(ledger, {
        args: ["pack", "--json", "--pack-destination", packRoot],
        command: npmCommand(),
        cwd: repoRoot,
        displayArgs: ["pack", "--json", "--pack-destination", `<pack-${index + 1}>`],
        label: `npm pack ${index + 1}`,
        replacements,
        timeoutMs,
      }));
      const record = parsePackRecord(packResult.stdout);
      if (record.name !== packageJson.name || record.version !== packageJson.version) throw new Error("npm pack identity does not match package.json");
      const archive = path.join(packRoot, record.filename);
      const archiveInfo = await stat(archive);
      const archiveSha256 = await fileDigest(archive);
      if (archiveInfo.size <= 0 || !SHA256.test(archiveSha256)) throw new Error("packed tarball is empty or unhashable");
      const inspected = await inspectPackedArchive({
        archive,
        extractRoot: path.join(tempRoot, `extract-${index + 1}`),
        ledger,
        replacements,
        timeoutMs,
      });
      if (inspected.packageJson.name !== packageJson.name || inspected.packageJson.version !== packageJson.version) {
        throw new Error("reopened archive package identity does not match the candidate");
      }
      const packFiles = packFileManifest(record);
      if (!verifyPackManifestMatchesArchive(packFiles, inspected.manifest)) {
        throw new Error("npm pack file manifest does not match the independently reopened archive");
      }
      independentPacks.push({
        archive,
        archiveBytes: archiveInfo.size,
        archiveFiles: inspected.manifest,
        archiveManifestSha256: inspected.manifestSha256,
        packFiles,
        packFilesSha256: digest(JSON.stringify(packFiles)),
        packageJson: inspected.packageJson,
        record,
        tarballSha256: archiveSha256,
      });
      await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
    }
    const reproducibility = compareIndependentPackResults(independentPacks[0], independentPacks[1]);
    if (!reproducibility.passed) throw new Error(`independent package reproduction failed: ${reproducibility.errors.join("; ")}`);
    [pack, reproducedPack] = independentPacks;
    tarballPath = path.join(candidateProofRoot, pack.record.filename);
    await copyFile(pack.archive, tarballPath);
    const tarballInfo = await stat(tarballPath);
    const tarballSha256 = await fileDigest(tarballPath);
    if (tarballSha256 !== pack.tarballSha256) throw new Error("canonical proof tarball differs from the independently verified archive");

    distribution = verifyPackedDistribution(pack.packageJson, pack.archiveFiles);
    checks.distributionComplete = distribution.passed;
    if (!distribution.passed) {
      throw new Error(`packed distribution is incomplete: missing exports ${distribution.missingExportTargets.join(", ") || "none"}; missing bins ${distribution.missingBinTargets.join(", ") || "none"}; failed checks ${Object.entries(distribution.checks).filter(([, passed]) => !passed).map(([name]) => name).join(", ") || "none"}`);
    }

    await writeJson(path.join(consumerRoot, "package.json"), {
      name: "nodekit-exact-package-consumer",
      private: true,
      type: "module",
      version: "0.0.0",
    });
    const convexPeer = packageJson.peerDependencies?.convex
      ? `convex@${packageJson.devDependencies?.convex ?? packageJson.peerDependencies.convex}`
      : null;
    const convexTestDependency = `convex-test@${packageJson.devDependencies?.["convex-test"] ?? "0.0.54"}`;
    requirePass(execute(ledger, {
      args: ["install", tarballPath, ...(convexPeer ? [convexPeer] : []), convexTestDependency, "--ignore-scripts", "--no-audit", "--no-fund"],
      command: npmCommand(),
      cwd: consumerRoot,
      displayArgs: ["install", "<tarball>", ...(convexPeer ? ["<convex-peer>"] : []), "<convex-test>", "--ignore-scripts", "--no-audit", "--no-fund"],
      label: "fresh consumer install",
      replacements,
      timeoutMs,
    }));
    checks.freshConsumerInstall = true;

    const installedRuntimeRoot = path.join(consumerRoot, "node_modules", "@homenshum", "nodekit");
    const installedRuntimePackage = JSON.parse(await readFile(path.join(installedRuntimeRoot, "package.json"), "utf8"));
    const installedRuntimeFiles = await directoryManifest(installedRuntimeRoot);
    if (installedRuntimePackage.name !== packageJson.name
      || installedRuntimePackage.version !== packageJson.version
      || JSON.stringify(installedRuntimeFiles) !== JSON.stringify(pack.archiveFiles)) {
      throw new Error("fresh consumer did not install the exact reopened package archive");
    }

    const installedHelpProof = {
      checks: {},
      schemaVersion: "nodekit.installed-cli-help-proof/v1",
    };
    for (const [binName, checkName, usageMarker, decisiveCheckName] of [
      ["nodekit-consumer-prepare", "consumerPrepareBinRuntime", "nodekit-consumer-prepare", "consumerPrepareBinRuntime"],
      ["nodekit-evidence-capture", "managedEvidenceCaptureBinRuntime", "nodekit-evidence-capture", null],
      ["nodekit-evidence-finalize", "evidenceFinalizeBinRuntime", "nodekit-evidence-finalize", "evidenceFinalizeBinRuntime"],
    ]) {
      const binTarget = installedRuntimePackage.bin?.[binName];
      if (typeof binTarget !== "string") throw new Error(`installed package is missing ${binName}`);
      const helpResult = requirePass(execute(ledger, {
        args: [path.join(installedRuntimeRoot, binTarget), "--help"],
        command: process.execPath,
        cwd: consumerRoot,
        displayArgs: [`<installed-${binName}>`, "--help"],
        label: `installed ${binName} help`,
        replacements,
        timeoutMs,
      }));
      const passed = helpResult.stdout.includes("Usage:") && helpResult.stdout.includes(usageMarker);
      if (decisiveCheckName) checks[decisiveCheckName] = passed;
      installedHelpProof.checks[checkName] = passed;
      installedHelpProof[`${checkName}StdoutSha256`] = digest(helpResult.stdout);
      if (!passed) throw new Error(`installed ${binName} help did not expose its public usage contract`);
    }
    installedHelpProof.passed = Object.values(installedHelpProof.checks).every(Boolean);

    const builderGymRuntimePath = path.join(consumerRoot, "builder-gym-runtime-proof.mjs");
    await writeFile(builderGymRuntimePath, builderGymRuntimeProofSource(), "utf8");
    const builderGymRuntimeResult = requirePass(execute(ledger, {
      args: [builderGymRuntimePath],
      command: process.execPath,
      cwd: consumerRoot,
      displayArgs: ["<builder-gym-runtime-proof>"],
      label: "installed Builder Gym runtime proof",
      replacements,
      timeoutMs,
    }));
    const builderGymRuntimeProof = JSON.parse(builderGymRuntimeResult.stdout.trim());
    checks.builderGymRuntime = builderGymRuntimeProof.schemaVersion === "nodekit.installed-builder-gym-runtime-proof/v1"
      && builderGymRuntimeProof.passed === true
      && Object.values(builderGymRuntimeProof.checks ?? {}).every(Boolean);
    if (!checks.builderGymRuntime) throw new Error("installed Builder Gym runtime proof failed");

    const componentRuntimePath = path.join(consumerRoot, "convex-runtime-proof.mjs");
    await writeFile(componentRuntimePath, convexRuntimeProofSource(), "utf8");
    const componentRuntimeResult = requirePass(execute(ledger, {
      args: [componentRuntimePath],
      command: process.execPath,
      cwd: consumerRoot,
      displayArgs: ["<convex-runtime-proof>"],
      label: "installed Convex component runtime proof",
      replacements,
      timeoutMs,
    }));
    const componentRuntimeProof = JSON.parse(componentRuntimeResult.stdout.trim());
    checks.convexComponentRuntime = componentRuntimeProof.schemaVersion === "nodekit.installed-convex-runtime-proof/v1"
      && Object.values(componentRuntimeProof.checks ?? {}).every(Boolean)
      && SHA256.test(componentRuntimeProof.receiptHash ?? "");
    if (!checks.convexComponentRuntime) throw new Error("installed Convex component runtime proof failed");

    const installedCli = path.join(installedRuntimeRoot, String(installedRuntimePackage.bin.nodekit));
    requirePass(execute(ledger, {
      args: [
        installedCli,
        "create",
        generatedRoot,
        "--name", "nodekit-package-proof",
        "--brief", "Carry one neutral case from intention to a verified artifact.",
        "--nodekit-specifier", "file:vendor/nodekit.tgz",
        "--package-manager", "npm",
        "--no-install",
        "--no-git",
      ],
      command: process.execPath,
      cwd: consumerRoot,
      displayArgs: ["<installed-nodekit-cli>", "create", "<generated-app>", "--name", "nodekit-package-proof", "--brief", "<neutral-brief>", "--nodekit-specifier", "file:vendor/nodekit.tgz", "--package-manager", "npm", "--no-install", "--no-git"],
      label: "packaged CLI create",
      replacements,
      timeoutMs,
    }));
    checks.packagedCliCreate = true;

    await mkdir(path.join(generatedRoot, "vendor"), { recursive: true });
    await copyFile(tarballPath, path.join(generatedRoot, "vendor", "nodekit.tgz"));

    requirePass(execute(ledger, {
      args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      command: npmCommand(),
      cwd: generatedRoot,
      label: "generated application install",
      replacements,
      timeoutMs,
    }));
    checks.generatedAppInstall = true;

    const generatedPackageJson = JSON.parse(await readFile(path.join(generatedRoot, "package.json"), "utf8"));
    const generatedLock = JSON.parse(await readFile(path.join(generatedRoot, "package-lock.json"), "utf8"));
    const generatedRuntimeLock = generatedLock.packages?.["node_modules/@homenshum/nodekit"];
    if (generatedPackageJson.dependencies?.[packageJson.name] !== "file:vendor/nodekit.tgz"
      || generatedLock.packages?.[""]?.dependencies?.[packageJson.name] !== "file:vendor/nodekit.tgz"
      || generatedRuntimeLock?.version !== packageJson.version
      || !String(generatedRuntimeLock?.resolved ?? "").endsWith("vendor/nodekit.tgz")) {
      throw new Error("generated application lockfile is not bound to its exact local NodeKit tarball");
    }

    const npmLsResult = requirePass(execute(ledger, {
      args: ["ls", "--all", "--json"],
      command: npmCommand(),
      cwd: generatedRoot,
      label: "generated application npm ls",
      replacements,
      timeoutMs,
    }));
    const npmLs = JSON.parse(npmLsResult.stdout);
    if (npmLs.dependencies?.[packageJson.name]?.version !== packageJson.version) {
      throw new Error("generated application dependency tree does not contain the exact NodeKit version");
    }

    for (const script of ["compile", "check", "demo", "eval"]) {
      requirePass(execute(ledger, {
        args: ["run", script],
        command: npmCommand(),
        cwd: generatedRoot,
        label: `generated application ${script}`,
        replacements,
        timeoutMs,
      }));
      checks[script] = true;
    }

    await writeFile(path.join(consumerRoot, "public-api.ts"), publicTypecheckSource(), "utf8");
    await writeJson(path.join(consumerRoot, "tsconfig.json"), publicTypecheckConfig());
    const typescriptCli = path.join(defaultRepoRoot, "node_modules", "typescript", "bin", "tsc");
    requirePass(execute(ledger, {
      args: [typescriptCli, "--project", path.join(consumerRoot, "tsconfig.json")],
      command: process.execPath,
      cwd: consumerRoot,
      displayArgs: ["<typescript-cli>", "--project", "<consumer-tsconfig>"],
      label: "fresh consumer public typecheck",
      replacements,
      timeoutMs,
    }));
    checks.typecheckPublic = true;

    const ending = await assertExactDistributableCandidate(repoRoot, candidateCommit, sourceHash);
    checks.candidateIdentityStable = ending.actualCommit === candidateCommit && ending.actualSourceHash === sourceHash;
    checks.tarballHashStable = tarballSha256 === pack.tarballSha256
      && tarballSha256 === reproducedPack.tarballSha256
      && reproducibility.passed;
    if (!checks.tarballHashStable) throw new Error("independent package archives are not byte-for-byte reproducible");

    const generatedIdentityPath = path.join(generatedRoot, ".nodeagent", "application-identity.json");
    const demoReceiptPath = path.join(generatedRoot, "proof", "demo-receipt.json");
    const evalReceiptPath = path.join(generatedRoot, "proof", "eval-receipt.json");
    const [generatedIdentityBytes, demoReceiptBytes, evalReceiptBytes] = await Promise.all([
      readFile(generatedIdentityPath), readFile(demoReceiptPath), readFile(evalReceiptPath),
    ]);
    const generatedIdentity = JSON.parse(generatedIdentityBytes.toString("utf8"));
    const demoReceipt = JSON.parse(demoReceiptBytes.toString("utf8"));
    const evalReceipt = JSON.parse(evalReceiptBytes.toString("utf8"));
    const identityFiles = new Map((generatedIdentity.identity?.files ?? []).map((entry) => [entry.path, entry]));
    const { receiptHash: demoReceiptHash, receiptId: demoReceiptId, ...demoReceiptBody } = demoReceipt.receipt ?? {};
    const generatedReceiptBindings = {
      applicationHash: generatedIdentity.applicationHash,
      applicationIdentity: { path: ".nodeagent/application-identity.json", sha256: digest(generatedIdentityBytes) },
      configHash: generatedIdentity.configHash,
      dependency: "file:vendor/nodekit.tgz",
      nodekitPackage: packageJson.name,
      nodekitTarballSha256: tarballSha256,
      nodekitVersion: packageJson.version,
      receipts: {
        demo: { path: "proof/demo-receipt.json", sha256: digest(demoReceiptBytes) },
        evaluation: { path: "proof/eval-receipt.json", sha256: digest(evalReceiptBytes) },
      },
      schemaVersion: "nodekit.generated-receipt-bindings/v1",
    };
    const receiptChecks = {
      applicationHash: SHA256.test(generatedIdentity.applicationHash ?? ""),
      applicationIdentityDigest: generatedReceiptBindings.applicationIdentity.sha256 === await fileDigest(generatedIdentityPath),
      applicationIdentitySchema: generatedIdentity.schemaVersion === "nodeagent.application-identity/v1",
      configHash: SHA256.test(generatedIdentity.configHash ?? ""),
      demoPassed: demoReceipt.passed === true,
      demoReceiptDigest: generatedReceiptBindings.receipts.demo.sha256 === await fileDigest(demoReceiptPath),
      demoReceiptHash: SHA256.test(demoReceiptHash ?? "") && contentHash(demoReceiptBody) === demoReceiptHash,
      demoReceiptId: /^receipt_[a-f0-9]{26}$/.test(demoReceiptId ?? ""),
      demoSchema: demoReceipt.schemaVersion === "nodekit.figured-out-demo/v1",
      evaluationPassed: evalReceipt.passed === true,
      evaluationReceiptDigest: generatedReceiptBindings.receipts.evaluation.sha256 === await fileDigest(evalReceiptPath),
      evaluationSchema: evalReceipt.schemaVersion === "nodekit.eval-receipt/v1",
      packageDigest: SHA256.test(identityFiles.get("package.json")?.digest ?? ""),
      packageLockDigest: SHA256.test(identityFiles.get("package-lock.json")?.digest ?? ""),
      tarballDigest: identityFiles.get("vendor/nodekit.tgz")?.digest === tarballSha256,
    };
    checks.receiptsValid = Object.values(receiptChecks).every(Boolean);
    if (!checks.receiptsValid) {
      const failedReceiptChecks = Object.entries(receiptChecks).filter(([, passed]) => !passed).map(([name]) => name);
      throw new Error(`generated application identity, demo receipt, or evaluation receipt is invalid: ${failedReceiptChecks.join(", ")}`);
    }

    const generatedPackagePath = path.join(candidateProofRoot, "generated-package.json");
    const generatedLockPath = path.join(candidateProofRoot, "generated-package-lock.json");
    const generatedNpmLsPath = path.join(candidateProofRoot, "generated-npm-ls.json");
    const installedRuntimeIdentityPath = path.join(candidateProofRoot, "installed-runtime-identity.json");
    const receiptBindingsPath = path.join(candidateProofRoot, "generated-receipt-bindings.json");
    await writeJson(generatedPackagePath, generatedPackageJson);
    await writeJson(generatedLockPath, generatedLock);
    await writeJson(generatedNpmLsPath, npmLs);
    await writeJson(installedRuntimeIdentityPath, {
      archiveManifestSha256: pack.archiveManifestSha256,
      files: installedRuntimeFiles,
      filesSha256: digest(JSON.stringify(installedRuntimeFiles)),
      name: installedRuntimePackage.name,
      schemaVersion: "nodekit.installed-runtime-identity/v1",
      tarballSha256,
      version: installedRuntimePackage.version,
    });
    await writeJson(receiptBindingsPath, generatedReceiptBindings);

    await rm(path.join(generatedRoot, "node_modules"), { force: true, recursive: true });
    requirePass(execute(ledger, {
      args: ["init"], command: "git", cwd: generatedRoot, label: "initialize generated candidate", replacements, timeoutMs,
    }));
    requirePass(execute(ledger, {
      args: ["config", "user.name", "NodeKit"], command: "git", cwd: generatedRoot, label: "configure generated candidate author", replacements, timeoutMs,
    }));
    requirePass(execute(ledger, {
      args: ["config", "user.email", "nodekit@local"], command: "git", cwd: generatedRoot, label: "configure generated candidate email", replacements, timeoutMs,
    }));
    requirePass(execute(ledger, {
      args: ["add", "--all"], command: "git", cwd: generatedRoot, label: "stage generated candidate", replacements, timeoutMs,
    }));
    requirePass(execute(ledger, {
      args: ["add", "--force", ".nodeagent", "proof"], command: "git", cwd: generatedRoot, label: "stage generated proof identity", replacements, timeoutMs,
    }));
    requirePass(execute(ledger, {
      args: ["commit", "-m", "chore: preserve exact package proof candidate"], command: "git", cwd: generatedRoot, label: "commit generated candidate", replacements, timeoutMs,
    }));
    const generatedCandidateCommit = requirePass(execute(ledger, {
      args: ["rev-parse", "HEAD"], command: "git", cwd: generatedRoot, label: "read generated candidate commit", replacements, timeoutMs,
    })).stdout.trim();
    const generatedCandidateTree = requirePass(execute(ledger, {
      args: ["rev-parse", "HEAD^{tree}"], command: "git", cwd: generatedRoot, label: "read generated candidate tree", replacements, timeoutMs,
    })).stdout.trim();
    const generatedArchivePath = path.join(candidateProofRoot, "generated-app.tar.gz");
    requirePass(execute(ledger, {
      args: ["archive", "--format=tar.gz", `--output=${generatedArchivePath}`, "HEAD"],
      command: "git",
      cwd: generatedRoot,
      displayArgs: ["archive", "--format=tar.gz", "--output=<proof>/generated-app.tar.gz", "HEAD"],
      label: "archive generated candidate",
      replacements,
      timeoutMs,
    }));
    const generatedArchiveInfo = await stat(generatedArchivePath);
    const generatedArchiveSha256 = await fileDigest(generatedArchivePath);
    const generatedCandidatePath = path.join(candidateProofRoot, "generated-candidate.json");
    await writeJson(generatedCandidatePath, {
      applicationHash: generatedIdentity.applicationHash,
      archiveBytes: generatedArchiveInfo.size,
      archivePath: relative(repoRoot, generatedArchivePath),
      archiveSha256: generatedArchiveSha256,
      commit: generatedCandidateCommit,
      configHash: generatedIdentity.configHash,
      nodekitTarballSha256: tarballSha256,
      schemaVersion: "nodekit.generated-candidate/v1",
      tree: generatedCandidateTree,
    });

    const evidenceFiles = [];
    for (const [source, name] of [
      [generatedIdentityPath, "application-identity.json"],
      [demoReceiptPath, "demo-receipt.json"],
      [evalReceiptPath, "eval-receipt.json"],
      [componentRuntimePath, "convex-runtime-proof.mjs"],
    ]) {
      const target = path.join(candidateProofRoot, name);
      await copyFile(source, target);
      evidenceFiles.push(target);
    }
    const commandLedgerPath = path.join(candidateProofRoot, "command-ledger.json");
    const packageFilesPath = path.join(candidateProofRoot, "package-files.json");
    const publicTypecheckPath = path.join(candidateProofRoot, "public-api.ts");
    await writeJson(commandLedgerPath, { commands: ledger, schemaVersion: "nodekit.package-command-ledger/v1" });
    await writeJson(packageFilesPath, {
      distribution,
      independentPacks: [pack, reproducedPack].map((entry, index) => ({
        archiveBytes: entry.archiveBytes,
        archiveManifestSha256: entry.archiveManifestSha256,
        packFilesSha256: entry.packFilesSha256,
        tarballSha256: entry.tarballSha256,
        trial: index + 1,
      })),
      archiveFiles: pack.archiveFiles,
      files: pack.archiveFiles,
      packFiles: pack.packFiles,
      name: pack.record.name,
      reproducible: reproducibility.passed,
      schemaVersion: "nodekit.packed-files/v1",
      version: pack.record.version,
    });
    await copyFile(path.join(consumerRoot, "public-api.ts"), publicTypecheckPath);
    const componentRuntimeReceiptPath = path.join(candidateProofRoot, "convex-runtime-proof.json");
    await writeJson(componentRuntimeReceiptPath, componentRuntimeProof);
    const builderGymRuntimeReceiptPath = path.join(candidateProofRoot, "builder-gym-runtime-proof.json");
    await writeJson(builderGymRuntimeReceiptPath, builderGymRuntimeProof);
    const installedCliHelpReceiptPath = path.join(candidateProofRoot, "installed-cli-help-proof.json");
    await writeJson(installedCliHelpReceiptPath, installedHelpProof);
    evidenceFiles.push(
      commandLedgerPath,
      packageFilesPath,
      publicTypecheckPath,
      componentRuntimeReceiptPath,
      builderGymRuntimeReceiptPath,
      installedCliHelpReceiptPath,
      generatedPackagePath,
      generatedLockPath,
      generatedNpmLsPath,
      installedRuntimeIdentityPath,
      receiptBindingsPath,
      generatedArchivePath,
      generatedCandidatePath,
    );

    const verdict = {
      schemaVersion: "nodekit.package-install-proof/v1",
      candidateCommit,
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitIdentity: `${candidateCommit}/${sourceHash}`,
      releaseCandidate: {
        nodekitCommit: candidateCommit,
        nodekitSourceHash: sourceHash,
        nodekitTarballSha256: tarballSha256,
        packageName: packageJson.name,
        packageVersion: packageJson.version,
      },
      package: packageJson.name,
      version: packageJson.version,
      tarball: relative(repoRoot, tarballPath),
      tarballSha256,
      tarballBytes: tarballInfo.size,
      unpackedSize: pack.record.unpackedSize,
      fileCount: pack.archiveFiles.length,
      applicationHash: generatedIdentity.applicationHash,
      configHash: generatedIdentity.configHash,
      generatedCandidateArchive: relative(repoRoot, generatedArchivePath),
      generatedCandidateArchiveSha256: generatedArchiveSha256,
      generatedCandidateCommit,
      generatedCandidateTree,
      checks,
      distributionChecks: packageProofDistributionChecks(distribution.checks),
      supportingEvidence: await supportingEvidence(repoRoot, evidenceFiles),
      commandLedger: relative(repoRoot, commandLedgerPath),
      publicationPerformed: false,
      deployPerformed: false,
      passed: Object.values(checks).every(Boolean) && Object.values(distribution.checks).every(Boolean),
      startedAt,
      durationMs: Math.round(performance.now() - started),
      generatedAt: new Date().toISOString(),
    };
    if (!verdict.passed) throw new Error("package proof checks did not all pass");
    await writeJson(path.join(candidateProofRoot, "package-install-verdict.json"), verdict);
    await writeJson(canonicalVerdictPath, verdict);
    if (additionalVerdictPath && additionalVerdictPath !== canonicalVerdictPath) await writeJson(additionalVerdictPath, verdict);
    return verdict;
  } catch (error) {
    failure = error;
    const failurePath = path.join(candidateProofRoot, "package-install-failure.json");
    await writeJson(failurePath, {
      candidateCommit,
      checks,
      commands: ledger,
      distribution,
      error: sanitizeText(error?.message ?? error, replacements),
      generatedAt: new Date().toISOString(),
      nodekitSourceHash: sourceHash,
      publicationPerformed: false,
      deployPerformed: false,
      schemaVersion: "nodekit.package-install-failure/v1",
    });
    throw error;
  } finally {
    if (!keepTemp) await rm(tempRoot, { force: true, recursive: true });
    if (keepTemp && failure) console.error(`Package proof temp workspace retained at ${tempRoot}`);
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parsePackageProofArguments(argv) {
  const candidateCommit = option(argv, "--candidate");
  const sourceHash = option(argv, "--source-hash");
  if (!candidateCommit) throw new Error("--candidate is required");
  if (!sourceHash) throw new Error("--source-hash is required");
  const timeout = option(argv, "--timeout-ms");
  const timeoutMs = timeout === null ? undefined : Number(timeout);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("--timeout-ms must be a positive number");
  return {
    candidateCommit,
    canonicalOutput: option(argv, "--output") ?? undefined,
    keepTemp: argv.includes("--keep-temp"),
    repoRoot: option(argv, "--repo-root") ?? defaultRepoRoot,
    sourceHash,
    timeoutMs,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    const verdict = await runPackageInstallProof(parsePackageProofArguments(process.argv.slice(2)));
    console.log(`PACKAGE PROOF PASS ${verdict.nodekitIdentity}`);
    console.log(`TARBALL ${verdict.tarball} ${verdict.tarballSha256}`);
  } catch (error) {
    console.error(`PACKAGE PROOF FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
