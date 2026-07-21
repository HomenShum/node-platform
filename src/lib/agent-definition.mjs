import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  alternateDialectErrors,
  CONTRACT_SCHEMA_FILES,
  CONTRACT_VERSIONS,
  resolveRuntimeContracts,
} from "./contracts.mjs";
import { normalizePath, pathExists, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";

const APPLICATION_SCHEMA = CONTRACT_VERSIONS.application;
// These directories contain executable behavior, evaluation behavior, or the
// workflow contract that turns an authored agent into a running application.
// Keep this list deliberately small and explicit: recursively hashing the
// whole repository would make generated proof artifacts and editor state part
// of the application identity.
const DISCOVERY_ROOTS = [
  "agent",
  "packs",
  "integrations",
  "backend",
  "workers",
  "evals",
  "fixtures",
  "schemas",
  "src",
  "apps",
  "scripts",
  "adw",
  "test",
  "tests",
  "e2e",
];
// Generated applications vendor the exact NodeKit runtime that created them
// until a versioned package release is available. The runtime affects the
// meaning of compile/check/proof, so it belongs in identity, but not in the
// application's authored capability discovery.
const IDENTITY_ONLY_ROOTS = ["vendor"];

// Root files are not beneath a discovered directory but can materially change
// dependency resolution, deployment, browser behavior, or the workflow that
// is being certified. They must therefore be bound to configHash as well.
const APPLICATION_ROOT_FILES = [
  ".dockerignore",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".vercelignore",
  "nodekit.yaml",
  "hackathon.yaml",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Dockerfile",
  "server.ts",
  "server.js",
  "server.mjs",
  "docker-compose.yml",
  "docker-compose.yaml",
  "render.yaml",
  "railway.json",
  "vercel.json",
  "netlify.toml",
  "fly.toml",
  "Procfile",
  "convex.json",
  "vite.config.js",
  "vite.config.ts",
  "next.config.js",
  "next.config.mjs",
  "playwright.config.js",
  "playwright.config.ts",
  "tsconfig.json",
];
const SECRET_FIELD = /(api.?key|password|secret|token)/i;
const SECRET_LITERAL = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalIdentityBytes(content) {
  if (content.includes(0)) return content;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
  } catch {
    return content;
  }
}

function containedPath(repoRoot, candidate, label) {
  const absoluteRoot = path.resolve(repoRoot);
  const absolute = path.resolve(absoluteRoot, String(candidate));
  const relative = path.relative(absoluteRoot, absolute);
  if (!relative || relative === ".") return { absolute, relative: "." };
  if (path.isAbsolute(String(candidate)) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository: ${candidate}`);
  }
  return { absolute, relative: normalizePath(relative) };
}

function discoveryRoots(repoRoot, manifest) {
  const roots = new Map();
  for (const root of [...DISCOVERY_ROOTS, ...IDENTITY_ONLY_ROOTS]) {
    const resolved = containedPath(repoRoot, root, `discovery root ${root}`);
    roots.set(resolved.relative, resolved.absolute);
  }
  if (manifest.authoring?.directory) {
    const resolved = containedPath(repoRoot, manifest.authoring.directory, "authoring.directory");
    roots.set(resolved.relative, resolved.absolute);
  }
  for (const pack of manifest.packs ?? []) {
    const resolved = containedPath(repoRoot, path.dirname(String(pack)), `capability pack ${pack}`);
    roots.set(resolved.relative, resolved.absolute);
  }
  return [...roots.entries()].sort(([left], [right]) => left.localeCompare(right));
}

async function discoverFiles(repoRoot, manifest) {
  const files = new Map();

  async function addFile(absolute) {
    const content = canonicalIdentityBytes(await readFile(absolute));
    const relative = normalizePath(path.relative(repoRoot, absolute));
    files.set(relative, {
      bytes: content.byteLength,
      digest: hash(content),
      path: relative,
    });
  }

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if ([".git", ".nodeagent", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`application identity does not permit symlinks: ${normalizePath(path.relative(repoRoot, absolute))}`);
      }
      if (entry.isDirectory()) await visit(absolute);
      else await addFile(absolute);
    }
  }

  for (const [, absolute] of discoveryRoots(repoRoot, manifest)) {
    if (!(await pathExists(absolute))) continue;
    if (!(await stat(absolute)).isDirectory()) {
      throw new Error(`discovery root is not a directory: ${normalizePath(path.relative(repoRoot, absolute))}`);
    }
    await visit(absolute);
  }
  for (const relative of APPLICATION_ROOT_FILES) {
    const absolute = path.join(repoRoot, relative);
    if (await pathExists(absolute)) {
      if ((await lstat(absolute)).isSymbolicLink()) {
        throw new Error(`application identity does not permit symlinks: ${relative}`);
      }
      await addFile(absolute);
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function validateSecrets(value, location = "nodeagent.yaml", errors = []) {
  if (!value || typeof value !== "object") return errors;
  for (const [key, entry] of Object.entries(value)) {
    const current = `${location}.${key}`;
    if (typeof entry === "string") {
      const isReference = /ref$/i.test(key) || key === "env";
      if ((SECRET_FIELD.test(key) && !isReference) || SECRET_LITERAL.test(entry)) {
        errors.push(`${current} appears to contain a literal secret; use an envRef/secretRef`);
      }
    } else validateSecrets(entry, current, errors);
  }
  return errors;
}

export function validateAgentManifest(manifest) {
  const errors = alternateDialectErrors(manifest, "nodeagent.yaml", APPLICATION_SCHEMA);
  if (manifest?.schemaVersion !== APPLICATION_SCHEMA) {
    errors.push(`nodeagent.yaml must use ${APPLICATION_SCHEMA}`);
  }
  if (!manifest?.application?.id) errors.push("application.id is required");
  if (!manifest?.application?.purpose) errors.push("application.purpose is required");
  if (!manifest?.runtime?.engine) errors.push("runtime.engine is required");
  if (!manifest?.provider?.adapter) errors.push("provider.adapter is required");
  if (!manifest?.provider?.model?.provider || !manifest?.provider?.model?.id) {
    errors.push("provider.model.provider and provider.model.id are required");
  }
  if (!manifest?.backend?.adapter) errors.push("backend.adapter is required");
  if (!Array.isArray(manifest?.packs) || manifest.packs.length === 0) {
    errors.push("at least one capability pack is required");
  }
  if (manifest?.authoring?.directory && (
    path.isAbsolute(String(manifest.authoring.directory)) ||
    normalizePath(String(manifest.authoring.directory)).split("/").includes("..")
  )) {
    errors.push("authoring.directory must be repository-relative and may not escape the repository");
  }
  return [...errors, ...validateSecrets(manifest)];
}

function classify(files, manifest) {
  const authoredFiles = files.filter((file) => !file.path.startsWith("vendor/"));
  const matching = (fragment, suffix) => authoredFiles
    .filter((file) => file.path.includes(fragment) && (!suffix || file.path.endsWith(suffix)))
    .map((file) => file.path);
  const authoringRoot = normalizePath(manifest.authoring?.directory ?? "agent").replace(/^\.\//, "");
  const skills = authoredFiles.filter((file) => file.path.endsWith("SKILL.md")).map((file) => file.path);
  const subagentRoot = `${authoringRoot}/subagents/`;
  const subagents = authoredFiles
    .filter((file) => file.path.startsWith(subagentRoot) && /\/agent\.(?:yaml|ts|js)$/.test(file.path))
    .map((file) => file.path);
  return {
    evals: matching("evals/"),
    integrations: matching("integrations/"),
    packs: [...new Set([
      ...matching("packs/", "pack.yaml"),
      ...(manifest.packs ?? []).map((entry) => normalizePath(String(entry)).replace(/^\.\//, "")),
    ])].sort(),
    policies: matching(`${authoringRoot}/policies/`),
    skills,
    subagents,
    tools: matching("/tools/"),
  };
}

export async function compileAgentDefinition(repoRoot, { check = false, write = true } = {}) {
  const manifestPath = path.join(repoRoot, "nodeagent.yaml");
  if (!(await pathExists(manifestPath))) throw new Error("nodeagent.yaml is missing");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = await readYaml(manifestPath);
  const errors = validateAgentManifest(manifest);
  errors.push(...await validateSchema(CONTRACT_SCHEMA_FILES.application, manifest, "nodeagent.yaml"));
  if (manifest.authoring?.directory) {
    try {
      const authored = containedPath(repoRoot, manifest.authoring.directory, "authoring.directory");
      if (!(await pathExists(authored.absolute))) {
        errors.push(`authoring directory does not exist: ${manifest.authoring.directory}`);
      } else if (!(await stat(authored.absolute)).isDirectory()) {
        errors.push(`authoring path is not a directory: ${manifest.authoring.directory}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const pack of manifest.packs ?? []) {
    let packPath;
    try {
      packPath = containedPath(repoRoot, String(pack), `capability pack ${pack}`).absolute;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!(await pathExists(packPath))) errors.push(`capability pack does not exist: ${pack}`);
    else {
      const packManifest = await readYaml(packPath);
      errors.push(
        ...alternateDialectErrors(packManifest, String(pack), CONTRACT_VERSIONS.pack),
        ...await validateSchema(CONTRACT_SCHEMA_FILES.pack, packManifest, String(pack)),
      );
      for (const reference of [packManifest.skill, ...(packManifest.evals ?? [])].filter(Boolean)) {
        const referencedPath = path.resolve(path.dirname(packPath), String(reference));
        const relative = path.relative(repoRoot, referencedPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(`${pack} reference escapes the repository: ${reference}`);
          continue;
        }
        if (!(await pathExists(referencedPath))) errors.push(`${pack} references missing file: ${reference}`);
      }
    }
  }
  const discoveredEvalIds = new Set();
  const evalRoot = path.join(repoRoot, "evals");
  if (await pathExists(evalRoot)) {
    for (const entry of await readdir(evalRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const value = JSON.parse(await readFile(path.join(evalRoot, entry.name), "utf8"));
        if (value.id) discoveredEvalIds.add(value.id);
      } catch {
        errors.push(`evaluation file is invalid JSON: evals/${entry.name}`);
      }
    }
  }
  for (const evalId of manifest.evaluations?.required ?? []) {
    if (evalId === "pi-live-smoke") continue;
    if (!discoveredEvalIds.has(evalId) && !["keep-revert-invariant", "interrupted-run-recovery"].includes(evalId)) {
      errors.push(`required evaluation is not declared by an eval file: ${evalId}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const files = await discoverFiles(repoRoot, manifest);
  const manifestDigest = hash(Buffer.from(manifestText.replace(/\r\n?/g, "\n"), "utf8"));
  const contracts = resolveRuntimeContracts(manifest);
  const resolvedDirectories = discoveryRoots(repoRoot, manifest).map(([relative]) => relative);
  const identity = {
    files,
    roots: {
      directories: DISCOVERY_ROOTS,
      identityOnlyDirectories: IDENTITY_ONLY_ROOTS,
      resolvedDirectories,
      files: APPLICATION_ROOT_FILES,
    },
  };
  const hashInput = JSON.stringify(canonicalize({ identity, manifest: { ...manifest, contracts } }));
  const configHash = hash(hashInput);
  // applicationHash is intentionally distinct as a named contract even though
  // v1 has the same value as configHash. Receipts and external supervisors
  // should bind this explicit application identity rather than infer the
  // meaning of configHash from an implementation detail.
  const applicationHash = configHash;
  const secretRefs = [...new Set([
    manifest.provider?.secretRef,
    ...(manifest.secrets ?? []).map((entry) => entry.envRef),
  ].filter(Boolean))].sort();
  const definition = {
    application: manifest.application,
    applicationHash,
    backend: manifest.backend,
    configHash,
    contracts,
    discovered: classify(files, manifest),
    fileCount: files.length,
    manifestDigest,
    orchestration: manifest.orchestration ?? {},
    policies: manifest.policies ?? {},
    provider: {
      adapter: manifest.provider.adapter,
      model: manifest.provider.model,
      package: manifest.provider.package ?? null,
    },
    runtime: manifest.runtime,
    schemaVersion: "nodeagent.resolved/v1",
    secretRefs,
  };

  const outputRoot = path.join(repoRoot, ".nodeagent");
  const hashPath = path.join(outputRoot, "config-hash.txt");
  if (check) {
    if (!(await pathExists(hashPath))) throw new Error("compiled definition is missing; run nodekit compile");
    const existing = (await readFile(hashPath, "utf8")).trim();
    if (existing !== configHash) throw new Error("compiled definition is stale; run nodekit compile");
  }

  if (write) {
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, "discovery.json"), `${JSON.stringify({ files, schemaVersion: "nodeagent.discovery/v1" }, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "application-identity.json"), `${JSON.stringify({ applicationHash, configHash, identity, manifestDigest, schemaVersion: "nodeagent.application-identity/v1" }, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "application-hash.txt"), `${applicationHash}\n`);
    await writeFile(path.join(outputRoot, "resolved-definition.json"), `${JSON.stringify(definition, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "evaluation-plan.json"), `${JSON.stringify({ required: manifest.evaluations?.required ?? [], schemaVersion: "nodeagent.evaluation-plan/v1" }, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "diagnostics.json"), `${JSON.stringify({ errors: [], schemaVersion: "nodeagent.diagnostics/v1", warnings: [] }, null, 2)}\n`);
    await writeFile(hashPath, `${configHash}\n`);
  }
  return { definition, files, manifest };
}

export function inspectAgentDefinition(compiled) {
  const { definition } = compiled;
  return {
    application: definition.application,
    applicationHash: definition.applicationHash,
    backend: definition.backend,
    configHash: definition.configHash,
    discovered: Object.fromEntries(
      Object.entries(definition.discovered).map(([key, values]) => [key, values.length]),
    ),
    fileCount: definition.fileCount,
    provider: definition.provider,
    runtime: definition.runtime,
    contracts: definition.contracts,
    secrets: definition.secretRefs.map((name) => ({ configured: Boolean(process.env[name]), name })),
  };
}
