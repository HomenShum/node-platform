import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAgentDefinition } from "./lib/agent-definition.mjs";
import { createProject } from "./lib/scaffold.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presets = ["agentic-rl-research", "smb-lending-fde"];

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalBytes(content) {
  if (content.includes(0)) return content;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
  } catch {
    return content;
  }
}

async function nodeKitSourceHash() {
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const entries = ["package.json", ...(packageJson.files ?? [])];
  const files = [];
  const visit = async (absolute) => {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`NodeKit distribution cannot contain symlinks: ${absolute}`);
    if (metadata.isDirectory()) {
      const children = await readdir(absolute);
      children.sort();
      for (const child of children) await visit(path.join(absolute, child));
      return;
    }
    const content = canonicalBytes(await readFile(absolute));
    files.push({
      digest: createHash("sha256").update(content).digest("hex"),
      path: path.relative(repoRoot, absolute).replaceAll("\\", "/"),
    });
  };
  for (const relative of entries) await visit(path.join(repoRoot, relative));
  return digest(files.sort((left, right) => left.path.localeCompare(right.path)));
}

function runNpm(cwd, script) {
  const result = spawnSync("npm", ["run", script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    shell: process.platform === "win32",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed in ${cwd}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function acceptPreset(root, preset) {
  const target = path.join(root, preset);
  const created = await createProject({
    brief: `Factory acceptance for ${preset}`,
    git: true,
    install: true,
    name: `factory-${preset}`,
    packageManager: "npm",
    preset,
    target,
  });
  const compiled = await compileAgentDefinition(target);
  for (const script of ["compile", "check", "demo", "eval", "benchmark", "proof"]) {
    runNpm(target, script);
  }

  const [packageJson, packageLock, proof, currentIdentity, resolvedDefinition] = await Promise.all([
    readJson(path.join(target, "package.json")),
    readJson(path.join(target, "package-lock.json")),
    readJson(path.join(target, "proof", "release-proof.json")),
    readJson(path.join(target, ".nodeagent", "application-identity.json")),
    readJson(path.join(target, ".nodeagent", "resolved-definition.json")),
  ]);
  const dependency = packageJson.devDependencies?.["@homenshum/nodekit"];
  const installedNodeKitLink = packageLock.packages?.["node_modules/@homenshum/nodekit"];
  const installedNodeKit = packageLock.packages?.["vendor/nodekit"];
  const checks = {
    candidateCommitted: /^[a-f0-9]{40}$/.test(created.candidateCommit ?? ""),
    compileReproducible: currentIdentity.applicationHash === compiled.definition.applicationHash,
    exactRuntimeInstalled: installedNodeKit?.version === "0.2.0",
    proofIdentityBound: proof.applicationHash === currentIdentity.applicationHash
      && proof.configHash === currentIdentity.configHash,
    proofPassed: proof.passed === true && proof.releaseReady === false,
    runtimeHashBound: currentIdentity.identity?.files?.some((file) => file.path === "vendor/nodekit/src/cli.mjs"),
    runtimeNotMisclassified: Object.values(resolvedDefinition.discovered ?? {}).flat()
      .every((entry) => !String(entry).startsWith("vendor/")),
    runtimeSpecifierPortable: dependency === "file:vendor/nodekit"
      && installedNodeKitLink?.link === true
      && installedNodeKitLink?.resolved === "vendor/nodekit"
      && !path.isAbsolute(String(installedNodeKitLink?.resolved ?? "")),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`${preset} factory acceptance failed: ${JSON.stringify(checks)}`);
  }
  return {
    applicationHash: currentIdentity.applicationHash,
    candidateCommit: created.candidateCommit,
    checks,
    configHash: currentIdentity.configHash,
    dependency,
    proofDigest: digest(proof),
  };
}

const started = Date.now();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-factory-acceptance-"));
let receipt;
try {
  const results = {};
  for (const preset of presets) {
    console.log(`FACTORY ACCEPTANCE ${preset}`);
    results[preset] = await acceptPreset(temporaryRoot, preset);
  }
  receipt = {
    durationMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    nodekitSourceHash: await nodeKitSourceHash(),
    passed: true,
    presets: results,
    schemaVersion: "nodekit.factory-acceptance/v1",
  };
  receipt.receiptDigest = digest(receipt);
  await mkdir(path.join(repoRoot, "proof"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "proof", "factory-acceptance.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (process.env.NODEKIT_KEEP_ACCEPTANCE !== "1") {
    await rm(temporaryRoot, { force: true, recursive: true });
  } else {
    console.log(`FACTORY ACCEPTANCE WORKSPACES ${temporaryRoot}`);
  }
}
