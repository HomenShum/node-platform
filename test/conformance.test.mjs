import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkRepository } from "../src/lib/repo-check.mjs";
import { loadRegistry, validateRegistry } from "../src/lib/registry.mjs";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeFixture(root, { declaration = false, providerInUi = false } = {}) {
  await mkdir(path.join(root, "src", "components"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: {
        check: "node --check src/runtime.ts",
        demo: "node src/runtime.ts",
        dev: "node src/runtime.ts",
        doctor: "node --check src/runtime.ts",
        proof: "node src/runtime.ts",
      },
    }),
  );
  await writeFile(
    path.join(root, "nodekit.yaml"),
    `schemaVersion: nodekit.repo/v1
repository: HomenShum/NodeProof
lifecycle: production
support: active
role: certification-harness
commandProfile: application
canonicalFor:
  - proofloop.certification
consumes:
  - nodeplatform.repo-contract
  - nodeagent.agent-run
  - nodeagent.trace-workpaper
commands:
  dev: { script: dev, mode: service }
  demo: { script: demo, mode: finite }
  doctor: { script: doctor, mode: finite }
  check: { script: check, mode: finite }
  proof: { script: proof, mode: finite }
noKey:
  status: certified
  command: npm run demo
  externalAccountsRequired: 0
  disclosure: Deterministic fixture only.
environment:
  contractVersion: nodeplatform.env/v1
  status: not-applicable
proof:
  command: npm run proof
  receiptSchema: proofloop.receipt/v1
contractDeclarations:${declaration ? `
  - concept: nodeagent.agent-run
    signature: agent-run-result
    path: src/runtime.ts
    mode: adapter
    origin: nodeagent.agent-run` : " []"}
architectureExceptions: []
`,
  );
  await writeFile(path.join(root, "src", "runtime.ts"), "export type AgentRunResult = { ok: boolean };\n");
  if (providerInUi) {
    await writeFile(
      path.join(root, "src", "components", "Panel.tsx"),
      'import OpenAI from "openai";\nexport const Panel = OpenAI;\n',
    );
  }
}

test("central registry and platform manifest are internally consistent", async () => {
  const registry = await loadRegistry(platformRoot);
  const manifestSchema = JSON.parse(
    await readFile(path.join(platformRoot, "schemas", "nodekit.schema.json"), "utf8"),
  );
  assert.equal(manifestSchema.$id.includes("nodekit.schema.json"), true);
  assert.deepEqual(validateRegistry(registry), []);
  const result = await checkRepository(platformRoot, registry);
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("an undeclared canonical signature fails closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-undeclared-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /undeclared contract signature agent-run-result/);
});

test("a classified adapter signature is accepted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-adapter-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("provider SDK imports in UI fail architecture conformance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ui-provider-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true, providerInUi: true });
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /architecture rule no-provider-sdk-in-ui/);
});

test("malformed lifecycle and no-key fields cannot pass on source conformance alone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-malformed-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8"))
    .replace("lifecycle: production", "lifecycle: imaginary")
    .replace("status: certified", "status: maybe");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /invalid lifecycle imaginary/);
  assert.match(result.errors.join("\n"), /invalid noKey.status maybe/);
});

test("registry consumers cannot be omitted from a repository manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-consumer-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("  - nodeagent.trace-workpaper\n", "");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /consumes omits registered concept nodeagent.trace-workpaper/);
});

test("stale contract declarations fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-stale-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  await writeFile(path.join(root, "src", "runtime.ts"), "export type Unrelated = { ok: boolean };\n");
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /stale contract declaration/);
});

test("certified no-key paths cannot require external accounts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-no-key-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("externalAccountsRequired: 0", "externalAccountsRequired: 1");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /certified no-key status cannot require an external account/);
});

test("no-key commands must resolve to repository scripts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-command-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("command: npm run demo", "command: npm run imaginary");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /noKey.command must reference an existing npm script/);
});
