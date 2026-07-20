import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "./files.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRESETS = Object.freeze({
  "agentic-rl-research": "agentic-rl-research",
  "research-loop": "research-loop",
  "smb-lending-fde": "smb-lending-fde",
});
const defaultTemplateRoot = path.join(packageRoot, "templates", PRESETS["research-loop"]);
const pluginSkillsRoot = path.join(packageRoot, "plugins", "nodekit", "skills");
const projectedSkillNames = ["nodekit-launch", "nodekit-present", "nodekit-qa"];

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

function normalizedSponsors(options = {}, presetName = options.preset) {
  const defaults = presetName === "agentic-rl-research" ? [] : ["pi-ai"];
  return [...new Set([...defaults, ...(options.sponsors ?? [])].map(slugify).filter(Boolean))];
}

function substitutions(options) {
  const slug = slugify(options.name || path.basename(options.target));
  const nodekitSpecifier = String(options.nodekitSpecifier ?? "github:HomenShum/node-platform").replaceAll("\\", "/");
  const sponsors = normalizedSponsors(options, options.preset);
  return {
    "__APP_NAME__": slug,
    "__APP_TITLE__": titleCase(slug),
    "__BACKEND__": options.backend ?? "filesystem",
    "__BRIEF_JSON__": JSON.stringify(options.brief ?? "Build a measurable, proof-carrying agent workflow."),
    "__BRIEF_TEXT__": String(options.brief ?? "Build a measurable, proof-carrying agent workflow.").replaceAll(/\s+/g, " ").trim(),
    "__NODEKIT_SPECIFIER_JSON__": JSON.stringify(nodekitSpecifier),
    "__PI_PACKAGE__": options.piPackage ?? "0.80.10",
    "__PROVIDER_ID__": options.provider ?? "openrouter",
    "__MODEL_ID__": options.model ?? "openai/gpt-4o-mini",
    "__SECRET_REF__": options.secretRef ?? "OPENROUTER_API_KEY",
    "__SPONSORS_YAML__": sponsors.map((sponsor) => `  - id: ${sponsor}\n    intendedUse: ${sponsor === "pi-ai" ? "Provider-neutral live hypothesis generation." : "Sponsor capability selected during launch research."}`).join("\n"),
  };
}

function resolvePreset(preset) {
  const normalized = preset ?? "research-loop";
  const templateName = PRESETS[normalized];
  if (!templateName) throw new Error(`unknown preset ${normalized}; available: ${Object.keys(PRESETS).join(", ")}`);
  return { name: normalized, root: path.join(packageRoot, "templates", templateName) };
}

async function applyPresetTemplate(preset, target, values) {
  if (preset.name !== "agentic-rl-research") {
    await copyTemplate(preset.root, target, values);
    return;
  }

  // The reference research loop carries a deliberately live-capable Pi adapter.
  // FounderQuest-RL is a clean-room replay-only lab, so remove those semantics
  // before its authored offline contract overlays the generic starter.
  await copyTemplate(defaultTemplateRoot, target, values);
  for (const relative of [
    "agent/tools/measure-ngram.mjs",
    "agent/skills/autoresearch-live",
    "agent/subagents",
    "fixtures/corpus",
    "integrations/pi-ai",
    "evals/deterministic-smoke.json",
    "schemas/experiment-receipt.schema.json",
    "scripts/live-smoke.mjs",
    "scripts/browser-proof.mjs",
  ]) {
    await rm(path.join(target, relative), { force: true, recursive: true });
  }
  await copyTemplate(preset.root, target, values);
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

export async function createProject(options) {
  const target = path.resolve(options.target);
  if (!(await isEmpty(target))) {
    throw new Error(`target is not empty: ${target}`);
  }
  const preset = resolvePreset(options.preset);
  const startedAt = new Date().toISOString();
  const packageManager = options.packageManager ?? "npm";
  if (!new Set(["npm", "pnpm"]).has(packageManager)) {
    throw new Error(`unsupported package manager ${packageManager}; available: npm, pnpm`);
  }
  const launchStartedAt = options.launchStartedAt && Number.isFinite(Date.parse(options.launchStartedAt)) ? options.launchStartedAt : startedAt;
  const values = substitutions({ ...options, preset: preset.name, target });
  await mkdir(target, { recursive: true });
  await applyPresetTemplate(preset, target, values);
  await projectCodingAgentSkills(target, values);
  const sponsors = normalizedSponsors(options, preset.name);
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
    nodekitVersion: "0.2.0",
    packageManager,
    preset: preset.name,
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
    await runGit([
      "-c", "user.name=NodeKit",
      "-c", "user.email=nodekit@local",
      "commit", "-m", "chore: initialize NodeKit application",
    ], target);
    candidateCommit = (await runGit(["rev-parse", "HEAD"], target, { capture: true })).trim();
  }
  return { candidateCommit, name: values.__APP_NAME__, packageManager, preset: preset.name, target };
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
  const adoptRoots = ["nodekit.yaml", "nodeagent.yaml", "hackathon.yaml", "agent", "packs", "integrations", "backend", "fixtures", "evals", "schemas", "scripts", "adw", "apps"];
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
    "nodekit:smoke:pi": "node scripts/live-smoke.mjs",
  };
  for (const [name, command] of Object.entries(scripts)) {
    if (packageJson.scripts[name] && packageJson.scripts[name] !== command) collisions.push(`package.json#scripts.${name}`);
    else packageJson.scripts[name] = command;
  }
  if (!packageJson.dependencies["@earendil-works/pi-ai"]) packageJson.dependencies["@earendil-works/pi-ai"] = "0.80.10";
  else if (packageJson.dependencies["@earendil-works/pi-ai"] !== "0.80.10") collisions.push("package.json#dependencies.@earendil-works/pi-ai");
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
