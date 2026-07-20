import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compileAgentDefinition, inspectAgentDefinition } from "../src/lib/agent-definition.mjs";
import { adoptProject, createProject } from "../src/lib/scaffold.mjs";

const execFileAsync = promisify(execFile);

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
    packageManager: "pnpm",
    sponsors: ["Convex", "Map Sponsor"],
    target,
  });
  const packageJson = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  assert.equal(packageJson.devDependencies["@homenshum/nodekit"], "file:D:/work/node-platform");
  assert.equal(packageJson.dependencies["@earendil-works/pi-ai"], "0.80.10");
  assert.equal(
    JSON.parse(await readFile(path.join(target, "proof", "build-friction.json"), "utf8")).packageManager,
    "pnpm",
  );
  assert.equal(await readFile(path.join(target, "integrations", "convex", "sponsor.yaml"), "utf8").then(Boolean), true);
  assert.match(
    await readFile(path.join(target, ".claude", "skills", "nodekit-present", "SKILL.md"), "utf8"),
    /evidence-backed presentation/,
  );
  assert.match(
    await readFile(path.join(target, ".codex", "skills", "nodekit-launch", "SKILL.md"), "utf8"),
    /smallest undeniable vertical slice/,
  );
  assert.match(
    await readFile(path.join(target, ".claude", "skills", "nodekit-qa", "SKILL.md"), "utf8"),
    /rendered user surface/,
  );
  assert.match(
    await readFile(path.join(target, ".codex", "skills", "nodekit-qa", "references", "qa-contract.md"), "utf8"),
    /must describe the same run/,
  );
  const dockerfile = await readFile(path.join(target, "Dockerfile"), "utf8");
  const renderBlueprint = await readFile(path.join(target, "render.yaml"), "utf8");
  assert.match(dockerfile, /@earendil-works\/pi-ai@0\.80\.10/);
  assert.match(renderBlueprint, /name: fresh-app/);
  assert.match(renderBlueprint, /healthCheckPath: \/api\/health/);
  assert.equal(`${dockerfile}\n${renderBlueprint}`.includes("__"), false);

  const first = await compileAgentDefinition(target);
  const second = await compileAgentDefinition(target, { write: false });
  assert.equal(first.definition.configHash, second.definition.configHash);
  assert.equal(first.definition.applicationHash, first.definition.configHash);
  assert.equal(
    JSON.parse(await readFile(path.join(target, ".nodeagent", "application-identity.json"), "utf8")).applicationHash,
    first.definition.applicationHash,
  );
  assert.equal(
    (await readFile(path.join(target, ".nodeagent", "application-hash.txt"), "utf8")).trim(),
    first.definition.applicationHash,
  );
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

test("compiled hash binds the shipped app, workflow, dependency, and deployment surface", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-shipped-identity-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "identity-test", target: root });

  const assertDrift = async (relative, replacement) => {
    await compileAgentDefinition(root);
    const file = path.join(root, ...relative.split("/"));
    await writeFile(file, replacement);
    await assert.rejects(
      () => compileAgentDefinition(root, { check: true, write: false }),
      /compiled definition is stale/,
      `${relative} must be bound to configHash`,
    );
  };

  await assertDrift("apps/web/server.mjs", "export const serverIdentity = 'changed';\n");
  await assertDrift("scripts/demo.mjs", "console.log('changed demo');\n");
  await assertDrift("adw/workflows/launch.yaml", "schemaVersion: nodekit.workflow/v1\nname: changed\n");
  await assertDrift("hackathon.yaml", "schemaVersion: nodekit.hackathon/v1\nname: changed\n");
  await assertDrift("package.json", JSON.stringify({ name: "changed", type: "module" }, null, 2));
  await assertDrift("Dockerfile", "FROM node:22\nCMD [\"node\", \"changed.mjs\"]\n");
});

test("authoring.directory outside the conventional root is discovered and hash-bound", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authoring-directory-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "eve-map", target: root });
  const authoredRoot = path.join(root, "apps", "eve-agent", "agent");
  await mkdir(path.join(authoredRoot, "tools"), { recursive: true });
  await mkdir(path.join(authoredRoot, "subagents", "reviewer"), { recursive: true });
  await writeFile(path.join(authoredRoot, "instructions.md"), "Run through the existing Eve adapter.\n");
  await writeFile(path.join(authoredRoot, "tools", "measure.ts"), "export const measure = true;\n");
  await writeFile(
    path.join(authoredRoot, "subagents", "reviewer", "agent.ts"),
    "export const reviewer = { runtime: 'eve' };\n",
  );
  const manifestPath = path.join(root, "nodeagent.yaml");
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, original.replace("directory: ./agent", "directory: ./apps/eve-agent/agent"));

  const first = await compileAgentDefinition(root);
  assert.equal(
    first.files.some((file) => file.path === "apps/eve-agent/agent/tools/measure.ts"),
    true,
  );
  assert.equal(
    first.definition.discovered.tools.includes("apps/eve-agent/agent/tools/measure.ts"),
    true,
  );
  assert.deepEqual(
    first.definition.discovered.subagents,
    ["apps/eve-agent/agent/subagents/reviewer/agent.ts"],
  );
  await writeFile(path.join(authoredRoot, "tools", "measure.ts"), "export const measure = false;\n");
  const changed = await compileAgentDefinition(root, { write: false });
  assert.notEqual(changed.definition.configHash, first.definition.configHash);
});

test("authoring.directory cannot escape the repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authoring-escape-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "unsafe-map", target: root });
  const manifestPath = path.join(root, "nodeagent.yaml");
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, original.replace("directory: ./agent", "directory: ../outside"));
  await assert.rejects(
    () => compileAgentDefinition(root, { write: false }),
    /authoring\.directory must be repository-relative/,
  );
});

test("create refuses nonempty targets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-nonempty-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, "user-file.txt"), "keep me");
  await assert.rejects(() => createProject({ force: true, git: false, install: false, name: "unsafe", target: root }), /target is not empty/);
  assert.equal(await readFile(path.join(root, "user-file.txt"), "utf8"), "keep me");
});

test("create rejects an unsupported package manager before writing files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-package-manager-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await assert.rejects(
    () => createProject({ git: false, install: false, name: "unsafe", packageManager: "yarn", target: root }),
    /unsupported package manager yarn/,
  );
  assert.deepEqual(await readdir(root), []);
});

test("create --local-proof emits the deterministic receipt in one CLI workflow", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-cli-proof-"));
  const target = path.join(root, "app");
  t.after(() => rm(root, { force: true, recursive: true }));
  await execFileAsync(process.execPath, [
    path.resolve("src", "cli.mjs"),
    "create",
    target,
    "--name",
    "cli-proof",
    "--no-install",
    "--local-proof",
  ]);
  const receipt = JSON.parse(await readFile(path.join(target, "proof", "release-proof.json"), "utf8"));
  assert.equal(receipt.level, "local-ready");
  assert.equal(receipt.passed, true);
  assert.equal(receipt.releaseReady, false);
});

test("agentic RL preset creates an offline FounderQuest lab with protected heldout evaluation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agentic-rl-"));
  const target = path.join(root, "lab");
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({
    git: false,
    install: false,
    name: "FounderQuest RL",
    nodekitSpecifier: "file:D:/node-platform",
    preset: "agentic-rl-research",
    target,
  });

  const packageJson = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-ai"], undefined);
  assert.doesNotMatch(await readFile(path.join(target, ".env.example"), "utf8"), /OPENROUTER|API_KEY/);
  await assert.rejects(readFile(path.join(target, "integrations", "pi-ai", "provider.mjs"), "utf8"), /ENOENT/);
  assert.equal(await readFile(path.join(target, "fixtures", "tasks", "train.json"), "utf8").then(Boolean), true);
  assert.equal(await readFile(path.join(target, "fixtures", "tasks", "validation.json"), "utf8").then(Boolean), true);
  assert.equal(await readFile(path.join(target, "fixtures", "tasks", "heldout.json"), "utf8").then(Boolean), true);

  const compiled = await compileAgentDefinition(target);
  assert.equal(compiled.manifest.provider.adapter, "deterministic-fixture");
  assert.equal(compiled.manifest.runtime.profile, "replay-only");
  assert.equal(compiled.definition.discovered.integrations.length, 0);

  for (const script of ["demo.mjs", "eval.mjs", "benchmark.mjs", "proof.mjs"]) {
    await execFileAsync(process.execPath, [path.join(target, "scripts", script)], { cwd: target });
  }
  const benchmark = JSON.parse(await readFile(path.join(target, "proof", "agentic-rl-benchmark.json"), "utf8"));
  const proof = JSON.parse(await readFile(path.join(target, "proof", "release-proof.json"), "utf8"));
  assert.equal(benchmark.assertions.heldoutProtected, true);
  assert.equal(benchmark.assertions.unsafeActionRejected, true);
  assert.equal(proof.passed, true);
  assert.equal(proof.releaseReady, false);
});

test("adopt is additive, runnable, and reports collisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-adopt-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "agent"), { recursive: true });
  await mkdir(path.join(root, ".claude", "skills", "nodekit-present"), { recursive: true });
  await writeFile(path.join(root, "agent", "instructions.md"), "user-owned instructions\n");
  await writeFile(path.join(root, ".claude", "skills", "nodekit-present", "SKILL.md"), "user-owned presentation skill\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "host", scripts: { dev: "host-dev" }, type: "module" }));
  const result = await adoptProject({ name: "host", nodekitSpecifier: "file:D:/node-platform", target: root });
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.dev, "host-dev");
  assert.equal(packageJson.scripts["nodekit:demo"], "node scripts/demo.mjs");
  assert.equal(await readFile(path.join(root, "agent", "instructions.md"), "utf8"), "user-owned instructions\n");
  assert.equal(
    await readFile(path.join(root, ".claude", "skills", "nodekit-present", "SKILL.md"), "utf8"),
    "user-owned presentation skill\n",
  );
  assert.equal(
    await readFile(path.join(root, ".codex", "skills", "nodekit-present", "SKILL.md"), "utf8").then(Boolean),
    true,
  );
  assert.equal(result.collisions.includes("agent/instructions.md"), true);
  assert.equal(result.collisions.includes(".claude/skills/nodekit-present/SKILL.md"), true);
  assert.equal(await readFile(path.join(root, "backend", "filesystem", "store.mjs"), "utf8").then(Boolean), true);
});

test("a fresh no-key Git candidate reaches an honest local-ready proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-local-proof-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const created = await createProject({ git: true, install: false, name: "local-proof", target: root });
  assert.match(created.candidateCommit, /^[a-f0-9]{40}$/);
  const compiled = await compileAgentDefinition(root);

  for (const script of ["demo.mjs", "eval.mjs", "proof.mjs"]) {
    await execFileAsync(process.execPath, [path.join(root, "scripts", script)], { cwd: root });
  }

  const receipt = JSON.parse(await readFile(path.join(root, "proof", "release-proof.json"), "utf8"));
  assert.equal(receipt.schemaVersion, "nodekit.proof-receipt/v1");
  assert.equal(receipt.level, "local-ready");
  assert.equal(receipt.passed, true);
  assert.equal(receipt.releaseReady, false);
  assert.equal(receipt.applicationHash, compiled.definition.applicationHash);
  assert.equal(receipt.configHash, compiled.definition.configHash);
  assert.deepEqual(receipt.missingReleaseGates, ["livePi", "browserQa", "deployment"]);
});

test("agentic RL preset creates an offline FounderQuest lab with protected heldout evaluation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-agentic-rl-"));
  const target = path.join(root, "lab");
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({
    git: true,
    install: false,
    name: "FounderQuest RL",
    nodekitSpecifier: "file:D:/node-platform",
    preset: "agentic-rl-research",
    target,
  });

  const packageJson = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-ai"], undefined);
  assert.doesNotMatch(await readFile(path.join(target, ".env.example"), "utf8"), /OPENROUTER|API_KEY/);
  await assert.rejects(readFile(path.join(target, "integrations", "pi-ai", "provider.mjs"), "utf8"), /ENOENT/);
  for (const split of ["train", "validation", "heldout"]) {
    assert.equal(await readFile(path.join(target, "fixtures", "tasks", `${split}.json`), "utf8").then(Boolean), true);
  }

  const compiled = await compileAgentDefinition(target);
  assert.equal(compiled.manifest.provider.adapter, "deterministic-fixture");
  assert.equal(compiled.manifest.runtime.profile, "replay-only");
  assert.equal(compiled.definition.discovered.integrations.length, 0);
  for (const script of ["demo.mjs", "eval.mjs", "benchmark.mjs", "proof.mjs"]) {
    await execFileAsync(process.execPath, [path.join(target, "scripts", script)], { cwd: target });
  }
  const benchmark = JSON.parse(await readFile(path.join(target, "proof", "agentic-rl-benchmark.json"), "utf8"));
  const proof = JSON.parse(await readFile(path.join(target, "proof", "release-proof.json"), "utf8"));
  assert.equal(benchmark.assertions.heldoutProtected, true);
  assert.equal(benchmark.assertions.unsafeActionRejected, true);
  assert.equal(proof.passed, true);
  assert.equal(proof.releaseReady, false);
});

test("the SMB lending FDE preset produces a clean-room human-authority proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-smb-lending-fde-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({
    brief: "Map a synthetic SMB lending file without making a credit decision.",
    git: true,
    install: false,
    name: "casca-fde-deployment-lab",
    preset: "smb-lending-fde",
    target: root,
  });
  const compiled = await compileAgentDefinition(root);
  for (const script of ["demo.mjs", "eval.mjs", "benchmark.mjs", "proof.mjs"]) {
    await execFileAsync(process.execPath, [path.join(root, "scripts", script)], { cwd: root });
  }
  const demo = JSON.parse(await readFile(path.join(root, "proof", "demo-receipt.json"), "utf8"));
  const evaluation = JSON.parse(await readFile(path.join(root, "proof", "eval-receipt.json"), "utf8"));
  const proof = JSON.parse(await readFile(path.join(root, "proof", "release-proof.json"), "utf8"));
  const instructions = await readFile(path.join(root, "agent", "instructions.md"), "utf8");

  assert.equal(demo.schemaVersion, "nodekit.smb-lending-receipt/v1");
  assert.equal(demo.documents.find((document) => document.id === "operating-bank-statements-q2").status, "requested");
  assert.equal(evaluation.passed, true);
  assert.equal(proof.passed, true);
  assert.equal(proof.applicationHash, compiled.definition.applicationHash);
  assert.match(proof.receiptVerification.candidateCommit, /^[a-f0-9]{40}$/);
  assert.match(instructions, /Never make, recommend, approve, decline, or simulate a credit decision/);
});
