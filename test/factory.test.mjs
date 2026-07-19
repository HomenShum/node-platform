import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileAgentDefinition, inspectAgentDefinition } from "../src/lib/agent-definition.mjs";
import { adoptProject, createProject } from "../src/lib/scaffold.mjs";

test("create emits a parseable, reproducible application from multiline input", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-create-"));
  const target = path.join(root, "fresh-app");
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({
    brief: "First line:\nsecond line with # and : characters",
    git: false,
    install: false,
    name: "Fresh App",
    nodekitSpecifier: "file:D:\\work\\node-platform",
    sponsors: ["Convex", "Map Sponsor"],
    target,
  });
  const packageJson = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  assert.equal(packageJson.devDependencies["@homenshum/nodekit"], "file:D:/work/node-platform");
  assert.equal(packageJson.dependencies["@earendil-works/pi-ai"], "0.80.10");
  assert.equal(await readFile(path.join(target, "integrations", "convex", "sponsor.yaml"), "utf8").then(Boolean), true);
  const dockerfile = await readFile(path.join(target, "Dockerfile"), "utf8");
  const renderBlueprint = await readFile(path.join(target, "render.yaml"), "utf8");
  assert.match(dockerfile, /@earendil-works\/pi-ai@0\.80\.10/);
  assert.match(renderBlueprint, /name: fresh-app/);
  assert.match(renderBlueprint, /healthCheckPath: \/api\/health/);
  assert.equal(`${dockerfile}\n${renderBlueprint}`.includes("__"), false);

  const first = await compileAgentDefinition(target);
  const second = await compileAgentDefinition(target, { write: false });
  assert.equal(first.definition.configHash, second.definition.configHash);
  assert.equal(first.manifest.application.purpose.includes("second line"), true);
  assert.equal(inspectAgentDefinition(second).secrets[0].name, "OPENROUTER_API_KEY");
});

test("compiled hash detects fixture drift and literal secrets fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-hash-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "hash-test", target: root });
  const compiled = await compileAgentDefinition(root);
  await writeFile(path.join(root, "fixtures", "corpus", "validation.txt"), "changed heldout input\n");
  await assert.rejects(() => compileAgentDefinition(root, { check: true, write: false }), /compiled definition is stale/);
  const changed = await compileAgentDefinition(root, { write: false });
  assert.notEqual(changed.definition.configHash, compiled.definition.configHash);

  const manifestPath = path.join(root, "nodeagent.yaml");
  await writeFile(manifestPath, `${await readFile(manifestPath, "utf8")}\napiKey: sk-abcdefghijklmnopqrstuv\n`);
  await assert.rejects(() => compileAgentDefinition(root, { write: false }), /literal secret/);
});

test("create refuses nonempty targets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-nonempty-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, "user-file.txt"), "keep me");
  await assert.rejects(() => createProject({ force: true, git: false, install: false, name: "unsafe", target: root }), /target is not empty/);
  assert.equal(await readFile(path.join(root, "user-file.txt"), "utf8"), "keep me");
});

test("adopt is additive, runnable, and reports collisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-adopt-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "agent"), { recursive: true });
  await writeFile(path.join(root, "agent", "instructions.md"), "user-owned instructions\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "host", scripts: { dev: "host-dev" }, type: "module" }));
  const result = await adoptProject({ name: "host", nodekitSpecifier: "file:D:/node-platform", target: root });
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.dev, "host-dev");
  assert.equal(packageJson.scripts["nodekit:demo"], "node scripts/demo.mjs");
  assert.equal(await readFile(path.join(root, "agent", "instructions.md"), "utf8"), "user-owned instructions\n");
  assert.equal(result.collisions.includes("agent/instructions.md"), true);
  assert.equal(await readFile(path.join(root, "backend", "filesystem", "store.mjs"), "utf8").then(Boolean), true);
});
