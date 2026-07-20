import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
const DISCOVERY_ROOTS = ["agent", "packs", "integrations", "backend", "workers", "evals", "fixtures", "schemas"];
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

async function discoverFiles(repoRoot) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if ([".git", ".nodeagent", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else {
        const content = await readFile(absolute);
        files.push({
          bytes: content.byteLength,
          digest: hash(content),
          path: normalizePath(path.relative(repoRoot, absolute)),
        });
      }
    }
  }

  for (const root of DISCOVERY_ROOTS) {
    const absolute = path.join(repoRoot, root);
    if (await pathExists(absolute)) await visit(absolute);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
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
  return [...errors, ...validateSecrets(manifest)];
}

function classify(files) {
  const matching = (fragment, suffix) => files
    .filter((file) => file.path.includes(fragment) && (!suffix || file.path.endsWith(suffix)))
    .map((file) => file.path);
  const skills = files
    .filter((file) => file.path.endsWith("SKILL.md") && (
      file.path.includes("/skills/") || file.path.startsWith("packs/")
    ))
    .map((file) => file.path);
  return {
    evals: matching("evals/"),
    integrations: matching("integrations/"),
    packs: matching("packs/", "pack.yaml"),
    policies: matching("agent/policies/"),
    skills,
    subagents: matching("agent/subagents/", "agent.yaml"),
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
  for (const pack of manifest.packs ?? []) {
    const packPath = path.resolve(repoRoot, String(pack));
    if (!(await pathExists(packPath))) errors.push(`capability pack does not exist: ${pack}`);
    else {
      const packManifest = await readYaml(packPath);
      errors.push(
        ...alternateDialectErrors(packManifest, String(pack), CONTRACT_VERSIONS.pack),
        ...await validateSchema(CONTRACT_SCHEMA_FILES.pack, packManifest, String(pack)),
      );
      for (const reference of [packManifest.skill, ...(packManifest.evals ?? [])].filter(Boolean)) {
        const referencedPath = path.resolve(path.dirname(packPath), String(reference));
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

  const files = await discoverFiles(repoRoot);
  const manifestDigest = hash(manifestText);
  const contracts = resolveRuntimeContracts(manifest);
  const hashInput = JSON.stringify(canonicalize({ files, manifest: { ...manifest, contracts } }));
  const configHash = hash(hashInput);
  const secretRefs = [...new Set([
    manifest.provider?.secretRef,
    ...(manifest.secrets ?? []).map((entry) => entry.envRef),
  ].filter(Boolean))].sort();
  const definition = {
    application: manifest.application,
    backend: manifest.backend,
    configHash,
    contracts,
    discovered: classify(files),
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
