import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "./files.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultTemplateRoot = path.join(packageRoot, "templates", "base");
const pluginSkillsRoot = path.join(packageRoot, "plugins", "nodekit", "skills");
const projectedSkillNames = ["nodekit-launch", "nodekit-present", "nodekit-qa"];
const vendoredNodeKitSpecifier = "file:vendor/nodekit";
const nodeKitRuntimeEntries = ["src", "schemas", "LICENSE"];

async function nodeKitPackageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("NodeKit package.json must declare a non-empty version");
  }
  return packageJson.version;
}

function vendoredExportIsAvailable(value) {
  if (typeof value === "string") {
    const target = value.replace(/^\.\//, "");
    return target === "package.json" || nodeKitRuntimeEntries.some((entry) => target === entry || target.startsWith(`${entry}/`));
  }
  return Boolean(value) && typeof value === "object" && Object.values(value).every(vendoredExportIsAvailable);
}

function usesVendoredNodeKitRuntime(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function titleCase(value) {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

export function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

async function isEmpty(directory) {
  if (!(await pathExists(directory))) return true;
  return (await readdir(directory)).length === 0;
}

function normalizedSponsors(options = {}) {
  return [...new Set((options.sponsors ?? []).map(slugify).filter(Boolean))];
}

function substitutions(options) {
  const slug = slugify(options.name || path.basename(options.target));
  const nodekitSpecifier = String(
    usesVendoredNodeKitRuntime(options.nodekitSpecifier)
      ? vendoredNodeKitSpecifier
      : options.nodekitSpecifier,
  ).replaceAll("\\", "/");
  const nodekitRuntimeImport = usesVendoredNodeKitRuntime(options.nodekitSpecifier)
    ? "../vendor/nodekit/src/lib/caseflow.mjs"
    : "@homenshum/nodekit/caseflow";
  const sponsors = normalizedSponsors(options);
  return {
    "__APP_NAME__": slug,
    "__APP_TITLE__": titleCase(slug),
    "__BACKEND__": options.backend ?? "filesystem",
    "__BRIEF_JSON__": JSON.stringify(options.brief ?? "Build a measurable, proof-carrying agent workflow."),
    "__BRIEF_TEXT__": String(options.brief ?? "Build a measurable, proof-carrying agent workflow.").replaceAll(/\s+/g, " ").trim(),
    "__NODEKIT_SPECIFIER_JSON__": JSON.stringify(nodekitSpecifier),
    "__NODEKIT_RUNTIME_IMPORT__": nodekitRuntimeImport,
    "__PI_PACKAGE__": options.piPackage ?? "0.80.10",
    "__PROVIDER_ID__": options.provider ?? "openrouter",
    "__MODEL_ID__": options.model ?? "openai/gpt-4o-mini",
    "__SECRET_REF__": options.secretRef ?? "OPENROUTER_API_KEY",
    "__SPONSORS_YAML__": sponsors.map((sponsor) => `  - id: ${sponsor}\n    intendedUse: ${sponsor === "pi-ai" ? "Provider-neutral live hypothesis generation." : "Sponsor capability selected during launch research."}`).join("\n"),
  };
}

async function vendorNodeKitRuntime(target) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const destination = path.join(target, "vendor", "nodekit");
  await mkdir(destination, { recursive: true });
  // A generated application's vendored runtime is already materialized source,
  // not a NodeKit development checkout. In particular, file: dependencies run
  // npm's `prepare` lifecycle, while the deliberately small runtime bundle does
  // not contain NodeKit's build scripts or component TypeScript sources. Keep
  // package metadata and runtime dependencies, but remove development lifecycle
  // hooks so a fresh generated application can install from an empty directory.
  const { scripts: _scripts, devDependencies: _devDependencies, ...publishMetadata } = packageJson;
  const runtimePackage = {
    ...publishMetadata,
    exports: Object.fromEntries(
      Object.entries(packageJson.exports ?? {}).filter(([, value]) => vendoredExportIsAvailable(value)),
    ),
    files: nodeKitRuntimeEntries,
    nodekitBundle: "generated-runtime-only",
  };
  await writeFile(path.join(destination, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  for (const relative of nodeKitRuntimeEntries) {
    const source = path.join(packageRoot, relative);
    if (!(await pathExists(source))) throw new Error(`NodeKit distributable entry is missing: ${relative}`);
    await cp(source, path.join(destination, relative), { recursive: true });
  }
  await chmod(path.join(destination, "src", "cli.mjs"), 0o755);
}

function replaceTokens(value, values) {
  let output = value;
  for (const [token, replacement] of Object.entries(values)) output = output.replaceAll(token, replacement);
  return output;
}

async function copyTemplate(source, destination, values, { collisions = [], missingOnly = false } = {}) {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationName = entry.name === "gitignore.template" ? ".gitignore" : replaceTokens(entry.name, values);
    const destinationPath = path.join(destination, destinationName);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyTemplate(sourcePath, destinationPath, values, { collisions, missingOnly });
      continue;
    }
    if (missingOnly && await pathExists(destinationPath)) {
      collisions.push(destinationPath);
      continue;
    }
    const text = await readFile(sourcePath, "utf8");
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, replaceTokens(text, values), "utf8");
  }
  return collisions;
}

async function projectCodingAgentSkills(target, values, { collisions = [], missingOnly = false } = {}) {
  for (const agentRoot of [".claude", ".codex"]) {
    for (const skillName of projectedSkillNames) {
      const source = path.join(pluginSkillsRoot, skillName);
      const destination = path.join(target, agentRoot, "skills", skillName);
      await mkdir(destination, { recursive: true });
      await copyTemplate(source, destination, values, { collisions, missingOnly });
    }
  }
  return collisions;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: process.platform === "win32", stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function runGit(args, cwd, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]} exited ${code}`)));
  });
}

async function scaffoldProject(options) {
  const target = path.resolve(options.target);
  if (!(await isEmpty(target))) {
    throw new Error(`target is not empty: ${target}`);
  }
  const startedAt = new Date().toISOString();
  const packageManager = options.packageManager ?? "npm";
  if (!new Set(["npm", "pnpm"]).has(packageManager)) {
    throw new Error(`unsupported package manager ${packageManager}; available: npm, pnpm`);
  }
  const nodekitVersion = await nodeKitPackageVersion();
  const launchStartedAt = options.launchStartedAt && Number.isFinite(Date.parse(options.launchStartedAt)) ? options.launchStartedAt : startedAt;
  const values = substitutions({ ...options, target });
  await mkdir(target, { recursive: true });
  await copyTemplate(defaultTemplateRoot, target, values);
  await projectCodingAgentSkills(target, values);
  if (usesVendoredNodeKitRuntime(options.nodekitSpecifier)) {
    await vendorNodeKitRuntime(target);
  }
  const sponsors = normalizedSponsors(options);
  for (const sponsor of sponsors.filter((entry) => entry !== "pi-ai")) {
    const integrationRoot = path.join(target, "integrations", sponsor);
    await mkdir(integrationRoot, { recursive: true });
    await writeFile(path.join(integrationRoot, "sponsor.yaml"), `schemaVersion: nodekit.sponsor-integration/v1\nid: ${sponsor}\nstatus: research-required\nproofRequired:\n  - live-tool-receipt\n  - visible-product-use\n`);
    await writeFile(path.join(integrationRoot, "RESEARCH.md"), `# ${titleCase(sponsor)} integration\n\nResearch only official sources, pin versions, document authentication and cost, then implement a deterministic fixture and bounded live smoke.\n`);
  }
  const friction = {
    application: values.__APP_NAME__,
    events: [
      { at: launchStartedAt, name: "launch_started" },
      ...(Number.isFinite(options.researchMs) ? [{ at: startedAt, durationMs: options.researchMs, name: "research_completed" }] : []),
      { at: startedAt, name: "scaffold_started" },
      { at: new Date().toISOString(), name: "files_generated" },
      {
        at: new Date().toISOString(),
        detail: { mode: "generated-vertical-slice" },
        durationMs: Date.now() - Date.parse(startedAt),
        name: "implementation_completed",
      },
    ],
    nodekitVersion,
    packageManager,
    foundation: "domain-blank-base",
    repairLoops: 0,
    schemaVersion: "nodekit.build-friction/v1",
  };
  await mkdir(path.join(target, "proof"), { recursive: true });
  await writeFile(path.join(target, "proof", "build-friction.json"), `${JSON.stringify(friction, null, 2)}\n`);
  if (options.install !== false) {
    const installStarted = Date.now();
    try {
      const installArgs = packageManager === "pnpm"
        ? ["install", "--prefer-offline"]
        : ["install", "--prefer-offline", "--no-audit", "--no-fund"];
      await run(packageManager, installArgs, target);
      friction.events.push({ at: new Date().toISOString(), durationMs: Date.now() - installStarted, name: "install_completed" });
    } catch (error) {
      friction.events.push({ at: new Date().toISOString(), durationMs: Date.now() - installStarted, name: "install_failed" });
      await writeFile(path.join(target, "proof", "build-friction.json"), `${JSON.stringify(friction, null, 2)}\n`);
      throw error;
    }
  }
  friction.events.push({ at: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), name: "scaffold_completed" });
  await writeFile(path.join(target, "proof", "build-friction.json"), `${JSON.stringify(friction, null, 2)}\n`);
  let candidateCommit = null;
  if (options.git !== false) {
    if (!(await pathExists(path.join(target, ".git")))) await runGit(["init"], target);
    await runGit(["add", "--all"], target);
    if (usesVendoredNodeKitRuntime(options.nodekitSpecifier)) {
      await runGit(["update-index", "--chmod=+x", "vendor/nodekit/src/cli.mjs"], target);
    }
    await runGit([
      "-c", "user.name=NodeKit",
      "-c", "user.email=nodekit@local",
      "commit", "-m", "chore: initialize NodeKit application",
    ], target);
    candidateCommit = (await runGit(["rev-parse", "HEAD"], target, { capture: true })).trim();
  }
  return { candidateCommit, name: values.__APP_NAME__, packageManager, target };
}

export async function createProject(options) {
  if (options.preset !== undefined) {
    throw new Error("nodekit create does not accept --preset; create the domain-blank figured-out base and let the coding agent specialize it from the user's real job");
  }
  return scaffoldProject(options);
}

export async function recordSetupEvent(target, name, detail = {}, durationMs) {
  const file = path.join(path.resolve(target), "proof", "build-friction.json");
  const receipt = JSON.parse(await readFile(file, "utf8"));
  receipt.events.push({ at: new Date().toISOString(), detail, ...(durationMs === undefined ? {} : { durationMs }), name });
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function adoptProject(options) {
  const target = path.resolve(options.target);
  if (!(await pathExists(target)) || !(await stat(target)).isDirectory()) {
    throw new Error(`repository does not exist: ${target}`);
  }
  const values = substitutions({ ...options, target });
  const collisions = [];
  // Materialize the vendored runtime the same way create does. Without this the
  // generated package.json points @homenshum/nodekit at file:vendor/nodekit and
  // scripts import ../vendor/nodekit/..., but the directory never exists, so an
  // adopted repo cannot install or run its demo unless the caller passes an
  // explicit --nodekit-specifier. Adopt must produce a runnable harness by default.
  if (usesVendoredNodeKitRuntime(options.nodekitSpecifier)) {
    await vendorNodeKitRuntime(target);
  }
  const adoptRoots = [".gitattributes", "nodekit.yaml", "nodeagent.yaml", "hackathon.yaml", "agent", "packs", "integrations", "backend", "fixtures", "evals", "schemas", "scripts", "adw", "apps"];
  for (const root of adoptRoots) {
    const source = path.join(defaultTemplateRoot, root);
    if (!(await pathExists(source))) continue;
    const destination = path.join(target, root);
    if ((await stat(source)).isDirectory()) {
      await mkdir(destination, { recursive: true });
      await copyTemplate(source, destination, values, { collisions, missingOnly: true });
    } else if (!(await pathExists(destination))) {
      await writeFile(destination, replaceTokens(await readFile(source, "utf8"), values));
    } else {
      collisions.push(destination);
    }
  }
  await projectCodingAgentSkills(target, values, { collisions, missingOnly: true });
  const packagePath = path.join(target, "package.json");
  let packageJson;
  if (await pathExists(packagePath)) packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  else packageJson = { name: values.__APP_NAME__, private: true, type: "module", version: "0.1.0" };
  packageJson.scripts ??= {};
  packageJson.dependencies ??= {};
  packageJson.devDependencies ??= {};
  const scripts = {
    "nodekit:compile": "nodekit compile --repo-root .",
    "nodekit:demo": "node scripts/demo.mjs",
    "nodekit:eval": "node scripts/eval.mjs",
    "nodekit:inspect": "nodekit inspect --repo-root .",
    "nodekit:proof": "node scripts/proof.mjs",
  };
  for (const [name, command] of Object.entries(scripts)) {
    if (packageJson.scripts[name] && packageJson.scripts[name] !== command) collisions.push(`package.json#scripts.${name}`);
    else packageJson.scripts[name] = command;
  }
  if (!packageJson.devDependencies["@homenshum/nodekit"]) packageJson.devDependencies["@homenshum/nodekit"] = JSON.parse(values.__NODEKIT_SPECIFIER_JSON__);
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const receipt = {
    addedRoots: adoptRoots,
    codingAgentSkills: projectedSkillNames,
    collisions: collisions.map((entry) => path.isAbsolute(entry) ? path.relative(target, entry).replaceAll("\\", "/") : entry),
    generatedAt: new Date().toISOString(),
    installRequired: true,
    schemaVersion: "nodekit.adoption-receipt/v1",
  };
  await mkdir(path.join(target, "proof"), { recursive: true });
  await writeFile(path.join(target, "proof", "adoption-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return { collisions: receipt.collisions, name: values.__APP_NAME__, target };
}
