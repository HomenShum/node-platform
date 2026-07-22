import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  assert.equal(packageJson.dependencies["@homenshum/nodekit"], "file:D:/work/node-platform");
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-ai"], undefined);
  assert.equal(await readFile(path.join(target, "docs", "FIGURED_OUT.md"), "utf8").then((value) => value.includes("Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt")), true);
  assert.equal(await readFile(path.join(target, "product", "SERVICE_BLUEPRINT.md"), "utf8").then(Boolean), true);
  assert.match(
    await readFile(path.join(target, "integrations", "convex", "capability-plan.yaml"), "utf8"),
    /status: available-after-workflow-research/,
  );
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
  assert.match(await readFile(path.join(target, ".gitattributes"), "utf8"), /\* text=auto eol=lf/);
  const dockerfile = await readFile(path.join(target, "Dockerfile"), "utf8");
  const renderBlueprint = await readFile(path.join(target, "render.yaml"), "utf8");
  assert.match(dockerfile, /node:22-alpine/);
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
  assert.equal(inspectAgentDefinition(second).secrets[0].name, "NODEKIT_OPTIONAL_MODEL_KEY");
});

test("primary create rejects every domain preset without suggesting a narrow alternative", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-no-presets-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await assert.rejects(
    () => createProject({ git: false, install: false, name: "not-a-preset", preset: "research-loop", target: path.join(root, "bad") }),
    /does not accept --preset/,
  );
});

test("the published package and CLI expose only the blank figured-out factory", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(packageJson.files.includes("reference-apps"), false);

  const { stdout } = await execFileAsync(process.execPath, [path.join(process.cwd(), "src", "cli.mjs"), "help"]);
  assert.doesNotMatch(stdout, /reference create|--preset/i);
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

test("compiled identity is stable across LF and CRLF checkouts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-eol-"));
  const lfRoot = path.join(root, "lf");
  const crlfRoot = path.join(root, "crlf");
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "eol-test", target: lfRoot });
  await cp(lfRoot, crlfRoot, { recursive: true });
  const textFile = path.join(crlfRoot, "agent", "instructions.md");
  const text = await readFile(textFile, "utf8");
  await writeFile(textFile, text.replace(/\r?\n/g, "\r\n"));
  const lf = await compileAgentDefinition(lfRoot, { write: false });
  const crlf = await compileAgentDefinition(crlfRoot, { write: false });
  assert.equal(crlf.definition.applicationHash, lf.definition.applicationHash);
  assert.equal(crlf.definition.configHash, lf.definition.configHash);
});

test("compiled hash binds the shipped app, workflow, dependency, and deployment surface", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-shipped-identity-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "identity-test", target: root });
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "api"), { recursive: true });
  await writeFile(path.join(root, "src", "domain.mjs"), "export const domainIdentity = 'original';\n");
  await writeFile(path.join(root, "api", "index.mjs"), "export const apiIdentity = 'original';\n");
  await writeFile(path.join(root, "server.ts"), "import './apps/web/server.mjs';\n");
  await writeFile(path.join(root, ".dockerignore"), ".env*\n");
  await writeFile(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");

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
  await assertDrift("api/index.mjs", "export const apiIdentity = 'changed';\n");
  await assertDrift("src/domain.mjs", "export const domainIdentity = 'changed';\n");
  await assertDrift("server.ts", "import './apps/web/changed-server.mjs';\n");
  await assertDrift(".dockerignore", ".env*\nproof/\n");
  await assertDrift(".gitattributes", "* text=auto eol=crlf\n");
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

test("default projects vendor the exact NodeKit runtime without polluting capability discovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-vendored-runtime-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({
    git: false,
    install: false,
    name: "portable-runtime",
    target: root,
  });

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const vendoredPackage = JSON.parse(await readFile(path.join(root, "vendor", "nodekit", "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@homenshum/nodekit"], "file:vendor/nodekit");
  assert.equal(vendoredPackage.name, "@homenshum/nodekit");
  assert.equal(vendoredPackage.version, "0.2.1");
  assert.equal(vendoredPackage.scripts, undefined, "the materialized file: runtime must not run NodeKit development lifecycle scripts");
  assert.equal(vendoredPackage.devDependencies, undefined);
  assert.equal(vendoredPackage.exports["./convex-caseflow"], undefined);
  assert.equal(vendoredPackage.exports["./caseflow"].import, "./src/caseflow.mjs");

  const compiled = await compileAgentDefinition(root);
  assert.equal(compiled.files.some((file) => file.path === "vendor/nodekit/src/cli.mjs"), true);
  assert.equal(
    Object.values(compiled.definition.discovered).flat().some((entry) => entry.startsWith("vendor/")),
    false,
  );
  await writeFile(path.join(root, "vendor", "nodekit", "src", "cli.mjs"), "throw new Error('tampered runtime');\n");
  const changed = await compileAgentDefinition(root, { write: false });
  assert.notEqual(changed.definition.applicationHash, compiled.definition.applicationHash);

  const blankSpecifierTarget = path.join(await mkdtemp(path.join(os.tmpdir(), "nodekit-blank-specifier-")), "app");
  t.after(() => rm(path.dirname(blankSpecifierTarget), { force: true, recursive: true }));
  await createProject({
    git: false,
    install: false,
    name: "blank-specifier-runtime",
    nodekitSpecifier: "   ",
    target: blankSpecifierTarget,
  });
  const blankSpecifierPackage = JSON.parse(await readFile(path.join(blankSpecifierTarget, "package.json"), "utf8"));
  assert.equal(blankSpecifierPackage.dependencies["@homenshum/nodekit"], "file:vendor/nodekit");
});

test("a default vendored runtime installs cold without NodeKit build-only files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-vendored-install-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "cold-vendored-install", target: root });

  await execFileAsync("npm", ["install", "--ignore-scripts=false", "--no-audit", "--no-fund"], {
    cwd: root,
    shell: process.platform === "win32",
    timeout: 120_000,
  });
  const installed = JSON.parse(await readFile(path.join(root, "node_modules", "@homenshum", "nodekit", "package.json"), "utf8"));
  assert.equal(installed.nodekitBundle, "generated-runtime-only");
  assert.equal(installed.scripts, undefined);
  const installedRoot = path.join(root, "node_modules", "@homenshum", "nodekit");
  const exportTargets = [];
  const collectTargets = (value) => {
    if (typeof value === "string") exportTargets.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collectTargets);
  };
  collectTargets(installed.exports);
  for (const target of exportTargets) {
    await readFile(path.join(installedRoot, target.replace(/^\.\//, "")));
  }
  await execFileAsync(process.execPath, [path.join(root, "node_modules", "@homenshum", "nodekit", "src", "cli.mjs"), "compile", "--repo-root", "."], {
    cwd: root,
    timeout: 30_000,
  });
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
  assert.equal(await readFile(path.join(root, "agent", "workflow.mjs"), "utf8").then(Boolean), true);
});

test("a fresh no-key Git candidate reaches an honest local-ready proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-local-proof-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const created = await createProject({ git: true, install: false, name: "local-proof", target: root });
  assert.match(created.candidateCommit, /^[a-f0-9]{40}$/);
  const { stdout: vendoredCliMode } = await execFileAsync("git", ["ls-files", "-s", "vendor/nodekit/src/cli.mjs"], { cwd: root });
  assert.match(vendoredCliMode, /^100755 /);
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
  assert.deepEqual(receipt.missingReleaseGates, [
    "browserCertification",
    "deployment",
    "freshAgentHeldout",
    "freshHumanUsability",
    "threeConvexConsumers",
  ]);
});
