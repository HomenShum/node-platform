import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileAgentDefinition } from "../src/lib/agent-definition.mjs";
import { CONTRACT_SCHEMA_FILES, CONTRACT_VERSIONS } from "../src/lib/contracts.mjs";
import { checkRepository } from "../src/lib/repo-check.mjs";
import { loadRegistry } from "../src/lib/registry.mjs";
import { createProject } from "../src/lib/scaffold.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freshProject(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "contract-fixture", target: root });
  return root;
}

test("generated manifests use the canonical flat contracts and resolve event/trace versions", async (t) => {
  const root = await freshProject(t, "nodekit-contract-");
  const compiled = await compileAgentDefinition(root, { write: false });
  assert.equal(compiled.manifest.schemaVersion, CONTRACT_VERSIONS.application);
  assert.deepEqual(compiled.manifest.contracts, {
    event: CONTRACT_VERSIONS.event,
    trace: CONTRACT_VERSIONS.trace,
  });
  assert.deepEqual(compiled.definition.contracts, compiled.manifest.contracts);
});

test("applications authored before contracts references were added remain v1 compatible", async (t) => {
  const root = await freshProject(t, "nodekit-compatible-");
  const explicit = await compileAgentDefinition(root, { write: false });
  const manifestPath = path.join(root, "nodeagent.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace(
    /contracts:\r?\n  event: nodeagent\.event\/v1\r?\n  trace: nodeagent\.trace\/v1\r?\n/,
    "",
  );
  await writeFile(manifestPath, manifest);
  const compiled = await compileAgentDefinition(root, { write: false });
  assert.deepEqual(compiled.definition.contracts, {
    event: CONTRACT_VERSIONS.event,
    trace: CONTRACT_VERSIONS.trace,
  });
  assert.equal(compiled.definition.configHash, explicit.definition.configHash);
});

test("pack-root SKILL.md files appear in compiled discovery", async (t) => {
  const root = await freshProject(t, "nodekit-pack-skill-");
  const packPath = path.join(root, "packs", "primary", "pack.yaml");
  const pack = (await readFile(packPath, "utf8")).replace(
    "skill: ../../agent/skills/autoresearch-live/SKILL.md",
    "skill: SKILL.md",
  );
  await writeFile(packPath, pack);
  await writeFile(path.join(root, "packs", "primary", "SKILL.md"), "# Pack skill\n");

  const compiled = await compileAgentDefinition(root, { write: false });
  assert.equal(compiled.definition.discovered.skills.includes("packs/primary/SKILL.md"), true);
});

test("nodeagent application apiVersion/kind/spec envelopes fail closed", async (t) => {
  const root = await freshProject(t, "nodekit-app-dialect-");
  await writeFile(
    path.join(root, "nodeagent.yaml"),
    "apiVersion: nodeagent.dev/v1\nkind: AgentApplication\nmetadata:\n  name: legacy\nspec: {}\n",
  );
  await assert.rejects(
    () => compileAgentDefinition(root, { write: false }),
    /unsupported apiVersion\/kind\/spec manifest dialect.*nodeagent\.application\/v1/s,
  );
});

test("nodeagent pack apiVersion/kind/spec envelopes fail closed", async (t) => {
  const root = await freshProject(t, "nodekit-pack-dialect-");
  await writeFile(
    path.join(root, "packs", "primary", "pack.yaml"),
    "apiVersion: nodeagent.dev/v1\nkind: CapabilityPack\nmetadata:\n  name: legacy\nspec: {}\n",
  );
  await assert.rejects(
    () => compileAgentDefinition(root, { write: false }),
    /unsupported apiVersion\/kind\/spec manifest dialect.*nodeagent\.pack\/v1/s,
  );
});

test("nodekit repository apiVersion/kind/spec envelopes fail closed", async (t) => {
  const root = await freshProject(t, "nodekit-repo-dialect-");
  await writeFile(
    path.join(root, "nodekit.yaml"),
    "apiVersion: nodekit.dev/v1\nkind: Repository\nmetadata:\n  name: legacy\nspec: {}\n",
  );
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(
    result.errors.join("\n"),
    /unsupported apiVersion\/kind\/spec manifest dialect.*nodekit\.repo\/v1/s,
  );
});

test("canonical event envelopes are strict and traceable", async () => {
  const valid = {
    schemaVersion: CONTRACT_VERSIONS.event,
    eventId: "evt-1",
    runId: "run-1",
    sequence: 0,
    type: "run.started",
    occurredAt: "2026-07-19T12:00:00.000Z",
    actor: { type: "agent", id: "orchestrator" },
    refs: [{ kind: "trace", id: "trace-1" }],
    payload: { objective: "prove the contract" },
  };
  assert.deepEqual(await validateSchema("nodeagent.event.v1.schema.json", valid, "event"), []);
  assert.match(
    (await validateSchema("nodeagent.event.v1.schema.json", { ...valid, kind: "Run" }, "event")).join("\n"),
    /must NOT have additional properties/,
  );
  assert.match(
    (await validateSchema(
      "nodeagent.event.v1.schema.json",
      { ...valid, occurredAt: "2026-07-19T05:00:00-07:00" },
      "event",
    )).join("\n"),
    /must match pattern/,
  );
  assert.deepEqual(CONTRACT_SCHEMA_FILES.repository, "nodekit.schema.json");
  assert.deepEqual(
    {
      skillBenchmarkInput: CONTRACT_SCHEMA_FILES.skillBenchmarkInput,
      skillBenchmarkVerdict: CONTRACT_SCHEMA_FILES.skillBenchmarkVerdict,
      skillEvaluatorReceipt: CONTRACT_SCHEMA_FILES.skillEvaluatorReceipt,
      skillIntegrityReceipt: CONTRACT_SCHEMA_FILES.skillIntegrityReceipt,
    },
    {
      skillBenchmarkInput: "nodekit.skill-benchmark-input.v1.schema.json",
      skillBenchmarkVerdict: "nodekit.skill-benchmark-verdict.v1.schema.json",
      skillEvaluatorReceipt: "nodekit.skill-evaluator-receipt.v1.schema.json",
      skillIntegrityReceipt: "nodekit.skill-integrity-receipt.v1.schema.json",
    },
  );
  assert.equal(Object.hasOwn(CONTRACT_SCHEMA_FILES, "skillComparison"), false);
});

test("NodeBenchAI is tracked honestly as an active production application", async () => {
  const registry = await loadRegistry(platformRoot);
  const entry = registry.repositoryCatalog.repositories.find((repository) => repository.name === "NodeBenchAI");
  assert.deepEqual(
    {
      commandProfile: entry?.commandProfile,
      lifecycle: entry?.lifecycle,
      replacedBy: entry?.replacedBy,
      role: entry?.role,
      support: entry?.support,
    },
    {
      commandProfile: "untracked",
      lifecycle: "production",
      replacedBy: undefined,
      role: "domain-application",
      support: "active",
    },
  );
});
