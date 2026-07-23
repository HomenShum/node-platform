#!/usr/bin/env node
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { finalizeSubmissionEvidence } from "../src/lib/submission-evidence-finalizer.mjs";

const allowedArguments = new Set([
  "gate", "input", "output", "payload-output", "attestation-output", "repo-root",
  "candidate-commit", "source-hash", "tarball-sha256", "package-name", "package-version",
  "key-policy", "signed-at",
]);

function finalizationHelp() {
  return `Usage:
  nodekit-evidence-finalize \\
    --gate <gate-id> \\
    --input <raw-verdict.json> \\
    --output <decisive-verdict.json> \\
    --repo-root <evidence-repository> \\
    --candidate-commit <40-character-commit> \\
    --source-hash <sha256> \\
    --tarball-sha256 <sha256> \\
    --package-name @homenshum/nodekit \\
    --package-version <exact-version> \\
    --key-policy <one-purpose-public-key-policy.json> [options]

Options:
  --payload-output <path>      Also write the canonical signed payload.
  --attestation-output <path>  Also write the detached Ed25519 envelope.
  --signed-at <ISO-8601>       Use an externally recorded signing time.
  --help, -h                   Show this help.

Required environment:
  NODEKIT_ATTESTATION_PRIVATE_KEY_FILE must name an external Ed25519 private-key PEM.

This command finalizes already-measured evidence. It never runs a study, grants
submission trust, approves publication, publishes a package, or deploys.`;
}

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid argument near ${flag ?? "end of command"}; all options require one value`);
    }
    const name = flag.slice(2);
    if (!allowedArguments.has(name)) throw new Error(`unknown option: --${name}`);
    if (Object.hasOwn(parsed, name)) throw new Error(`duplicate option: --${name}`);
    parsed[name] = value;
  }
  return parsed;
}

function required(options, name) {
  if (typeof options[name] !== "string" || options[name].length === 0) throw new Error(`--${name} is required`);
  return options[name];
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${label} ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function outputIdentity(filePath) {
  try {
    return await realpath(filePath);
  } catch {
    const parent = await realpath(path.dirname(filePath));
    return path.join(parent, path.basename(filePath));
  }
}

function platformIdentity(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(finalizationHelp());
  process.exit(0);
}
const repoRoot = await realpath(path.resolve(options["repo-root"] ?? "."));
const inputPath = path.resolve(required(options, "input"));
const outputPath = path.resolve(required(options, "output"));
const keyPolicyPath = path.resolve(required(options, "key-policy"));
const privateKeyPath = process.env.NODEKIT_ATTESTATION_PRIVATE_KEY_FILE;
if (!privateKeyPath) throw new Error("NODEKIT_ATTESTATION_PRIVATE_KEY_FILE must name an external Ed25519 private-key PEM file");
const resolvedPrivateKeyPath = await realpath(path.resolve(privateKeyPath));
const privateKeyRelative = path.relative(repoRoot, resolvedPrivateKeyPath);
if (privateKeyRelative === "" || (!privateKeyRelative.startsWith("..") && !path.isAbsolute(privateKeyRelative))) {
  throw new Error("NODEKIT_ATTESTATION_PRIVATE_KEY_FILE must remain outside the evidence repository");
}

const rawVerdict = await readJson(inputPath, "raw verdict");
const signingKeyPolicy = await readJson(keyPolicyPath, "purpose-scoped signing key policy");
const privateKey = await readFile(resolvedPrivateKeyPath, "utf8");
const result = await finalizeSubmissionEvidence({
  gate: required(options, "gate"),
  rawVerdict,
  releaseIdentity: {
    candidateCommit: required(options, "candidate-commit"),
    nodekitSourceHash: required(options, "source-hash"),
    nodekitTarballSha256: required(options, "tarball-sha256"),
    packageName: required(options, "package-name"),
    packageVersion: required(options, "package-version"),
  },
  repoRoot,
  privateKey,
  signingKeyPolicy,
  ...(options["signed-at"] ? { signedAt: options["signed-at"] } : {}),
});

const requestedOutputs = [
  outputPath,
  ...(options["payload-output"] ? [path.resolve(options["payload-output"])] : []),
  ...(options["attestation-output"] ? [path.resolve(options["attestation-output"])] : []),
];
const requestedOutputIdentities = [];
const requestedOutputMetadata = [];
for (const requestedOutput of requestedOutputs) {
  await mkdir(path.dirname(requestedOutput), { recursive: true });
  const metadata = await lstat(requestedOutput).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (metadata?.isSymbolicLink()) throw new Error(`refusing symbolic-link output while finalizing: ${requestedOutput}`);
  requestedOutputMetadata.push(metadata);
  requestedOutputIdentities.push(platformIdentity(await outputIdentity(requestedOutput)));
}
if (new Set(requestedOutputIdentities).size !== requestedOutputIdentities.length) {
  throw new Error("output, payload-output, and attestation-output must be distinct paths");
}
const evidencePaths = new Set(await Promise.all(result.reopenedEvidence.map(async (entry) =>
  platformIdentity(await realpath(path.join(repoRoot, entry.path))))));
const protectedInputs = new Set(await Promise.all([
  realpath(inputPath),
  realpath(keyPolicyPath),
  Promise.resolve(resolvedPrivateKeyPath),
].map(async (entry) => platformIdentity(await entry))));
for (let index = 0; index < requestedOutputs.length; index += 1) {
  const requestedOutput = requestedOutputs[index];
  const identity = requestedOutputIdentities[index];
  if (evidencePaths.has(identity)) {
    throw new Error(`refusing to overwrite evidence while finalizing: ${requestedOutput}`);
  }
  if (protectedInputs.has(identity)) {
    throw new Error(`refusing to overwrite a finalization input or private key: ${requestedOutput}`);
  }
  if (requestedOutputMetadata[index] !== null) {
    throw new Error(`refusing to overwrite an existing finalization output: ${requestedOutput}`);
  }
}

const writes = [
  [outputPath, result.verdict],
  ...(options["payload-output"] ? [[path.resolve(options["payload-output"]), result.attestationPayload]] : []),
  ...(options["attestation-output"] ? [[path.resolve(options["attestation-output"]), result.attestation]] : []),
];
const created = [];
try {
  for (const [filePath, value] of writes) {
    await writeJson(filePath, value);
    created.push(filePath);
  }
  // Re-run the complete closure after the outputs exist. This narrows the
  // validation-to-write window and removes every output if any referenced
  // evidence drifted during the commit. Submission preparation still performs
  // its own independent reopen before trusting the result.
  const postWrite = await finalizeSubmissionEvidence({
    gate: required(options, "gate"),
    rawVerdict,
    releaseIdentity: {
      candidateCommit: required(options, "candidate-commit"),
      nodekitSourceHash: required(options, "source-hash"),
      nodekitTarballSha256: required(options, "tarball-sha256"),
      packageName: required(options, "package-name"),
      packageVersion: required(options, "package-version"),
    },
    repoRoot,
    privateKey,
    signingKeyPolicy,
    signedAt: result.attestation.signedAt,
  });
  if (JSON.stringify(postWrite.verdict) !== JSON.stringify(result.verdict)) {
    throw new Error("finalized verdict changed during the post-write evidence reopen");
  }
} catch (error) {
  await Promise.all(created.map((filePath) => rm(filePath, { force: true })));
  throw error;
}

console.log(JSON.stringify({
  attestationOutput: options["attestation-output"] ? path.resolve(options["attestation-output"]) : null,
  evidenceCount: result.evidenceCount,
  gate: result.attestation.payloadType,
  keyId: result.attestation.keyId,
  output: outputPath,
  payloadOutput: options["payload-output"] ? path.resolve(options["payload-output"]) : null,
  payloadSha256: result.attestation.payloadSha256,
  submissionTrustEvaluated: false,
  trustNotice: "This command verifies key possession and purpose only. Submission trust must come from the caller-owned external trust registry.",
}, null, 2));
