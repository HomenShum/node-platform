import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { pathExists, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const MODEL_FAILURE_CLASSES = Object.freeze([
  "BRIEF_MISS",
  "GENERIC_FALLBACK",
  "OVERPLANNING",
  "UNDERPLANNING",
  "WRONG_PRIMITIVE",
  "LAYOUT_REPETITION",
  "TEXT_DENSITY",
  "TOOL_AVOIDANCE",
  "TOOL_MISUSE",
  "NO_RESULT_INSPECTION",
  "FALSE_COMPLETION",
  "WEAK_REPAIR",
  "CONTEXT_DRIFT",
  "ORCHESTRATION_FAILURE",
  "UNSUPPORTED_CLAIM",
  "COST_INEFFICIENCY",
  "REPOSITORY_LEGIBILITY_FAILURE",
  "REFERENCE_DISCOVERY_FAILURE",
  "UI_OPERABILITY_FAILURE",
  "AUTHORITY_VIOLATION",
  "STALE_WRITE_FAILURE",
  "EXPORT_FAILURE",
  "RECOVERY_FAILURE",
]);

const HARNESS_DIRECTORIES = [
  "models/cards/ecosystem",
  "models/cards/domain",
  "models/cards/project",
  "models/comparisons",
  "skills/roles",
  "skills/domains",
  "skills/models",
  "skills/guardrails",
  "skills/recovery",
  "tasks/development",
  "tasks/validation",
  "tasks/heldout",
  "tasks/adversarial",
  "tournaments",
  "candidates",
  "versions/h0",
  "receipts/capability-cards",
  "receipts/skill-promotions",
  "receipts/routing-promotions",
  "receipts/canaries",
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function resolveWithin(repoRoot, relative, label) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, String(relative));
  const relation = path.relative(root, target);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} must stay within the repository: ${relative}`);
  }
  return target;
}

async function writeIfMissing(target, content, created) {
  if (await pathExists(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  created.push(target);
}

async function applicationIdFor(repoRoot) {
  const manifest = await readYaml(path.join(repoRoot, "nodeagent.yaml"));
  const applicationId = manifest?.application?.id;
  if (!applicationId) throw new Error("nodeagent.yaml must declare application.id before harness init");
  return applicationId;
}

export async function initializeHarness(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  if (!(await pathExists(path.join(resolvedRoot, "nodekit.yaml")))) {
    throw new Error("harness init requires a NodeKit repository; run nodekit create or nodekit adopt first");
  }
  const applicationId = await applicationIdFor(resolvedRoot);
  const harnessRoot = path.join(resolvedRoot, "harness");
  const created = [];
  for (const relative of HARNESS_DIRECTORIES) await mkdir(path.join(harnessRoot, relative), { recursive: true });
  await mkdir(path.join(resolvedRoot, ".qa", "models", "observations"), { recursive: true });

  const harness = {
    schemaVersion: "nodekit.harness/v1",
    applicationId,
    version: "h0",
    evaluation: {
      protectedTaskRoots: ["harness/tasks/validation", "harness/tasks/heldout", "harness/tasks/adversarial"],
      candidateMayModify: ["harness/skills", "harness/models/routing-matrix.yaml"],
    },
    modelIntelligence: {
      observationRoot: ".qa/models/observations",
      cardRoot: "harness/models/cards",
      findingsLedger: "harness/models/findings.jsonl",
    },
    promotion: { automatic: false, freshAgentCanary: true, proofReceipt: true },
  };

  await writeIfMissing(path.join(harnessRoot, "harness.yaml"), stringifyYaml(harness), created);
  await writeIfMissing(
    path.join(harnessRoot, "HARNESS.md"),
    "# NodeKit Harness Gym\n\nThis directory is application-specific and evidence driven. Record requested and resolved model identities, keep protected tasks outside candidate write scope, and never promote a skill or route without controlled comparison, a fresh-agent canary, and NodeProof receipt.\n\n`nodekit models baseline` validates observations and compiles an evidence registry. It does not call a provider or claim that an unobserved model is capable.\n",
    created,
  );
  await writeIfMissing(path.join(harnessRoot, "models", "findings.jsonl"), "", created);
  await writeIfMissing(
    path.join(harnessRoot, "models", "routing-matrix.yaml"),
    stringifyYaml({ schemaVersion: "nodekit.routing-matrix/v0", status: "provisional-empty", routes: [] }),
    created,
  );
  await writeIfMissing(
    path.join(harnessRoot, "versions", "h0", "manifest.json"),
    `${JSON.stringify({ schemaVersion: "nodekit.harness-version/v1", version: "h0", status: "baseline-unmeasured" }, null, 2)}\n`,
    created,
  );
  await writeIfMissing(
    path.join(harnessRoot, "versions", "current.json"),
    `${JSON.stringify({ schemaVersion: "nodekit.harness-current/v1", version: "h0" }, null, 2)}\n`,
    created,
  );
  await writeIfMissing(
    path.join(resolvedRoot, ".qa", "models", "README.md"),
    "# Model observations\n\nPlace evaluated `nodekit.model-observation/v1` JSON or JSONL records in `observations/`. Raw observations are evidence, not routing policy.\n",
    created,
  );

  return { applicationId, created: created.map((file) => path.relative(resolvedRoot, file).replaceAll("\\", "/")), harnessRoot };
}

async function filesUnder(root, extensions) {
  if (!(await pathExists(root))) return [];
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(target);
    }
  }
  await visit(root);
  return files;
}

async function recordsFrom(file) {
  const content = await readFile(file, "utf8");
  if (path.extname(file).toLowerCase() === ".jsonl") {
    return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });
  }
  if ([".yaml", ".yml"].includes(path.extname(file).toLowerCase())) return [await readYaml(file)];
  return [JSON.parse(content)];
}

async function loadValidatedRecords(root, extensions, schema, label) {
  const records = [];
  const errors = [];
  for (const file of await filesUnder(root, extensions)) {
    for (const [index, value] of (await recordsFrom(file)).entries()) {
      const recordLabel = `${label} ${file}${path.extname(file) === ".jsonl" ? `:${index + 1}` : ""}`;
      const findings = await validateSchema(schema, value, recordLabel);
      if (findings.length > 0) errors.push(...findings);
      else records.push({ file, value });
    }
  }
  return { errors, records };
}

export async function compileModelIntelligence(repoRoot, { write = true } = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const harnessPath = path.join(resolvedRoot, "harness", "harness.yaml");
  if (!(await pathExists(harnessPath))) throw new Error("Harness Gym is not initialized; run nodekit harness init");
  const harness = await readYaml(harnessPath);
  const errors = await validateSchema("nodekit.harness.v1.schema.json", harness, "harness");
  const observations = await loadValidatedRecords(
    resolveWithin(resolvedRoot, harness.modelIntelligence?.observationRoot ?? ".qa/models/observations", "observationRoot"),
    new Set([".json", ".jsonl"]),
    "nodekit.model-observation.v1.schema.json",
    "observation",
  );
  const cards = await loadValidatedRecords(
    resolveWithin(resolvedRoot, harness.modelIntelligence?.cardRoot ?? "harness/models/cards", "cardRoot"),
    new Set([".json", ".yaml", ".yml"]),
    "nodekit.model-capability-card.v1.schema.json",
    "capability card",
  );
  errors.push(...observations.errors, ...cards.errors);
  if (errors.length > 0) throw new Error(`model intelligence validation failed:\n${errors.join("\n")}`);

  const observationValues = observations.records.map((entry) => entry.value);
  const cardValues = cards.records.map((entry) => entry.value);
  for (const card of cardValues.filter((entry) => entry.scope.level === "project")) {
    if (card.scope.applicationId !== harness.applicationId) {
      errors.push(`project capability card applicationId ${card.scope.applicationId} does not match harness applicationId ${harness.applicationId}`);
      continue;
    }
    const matching = observationValues.filter((observation) =>
      observation.applicationId === card.scope.applicationId &&
      observation.model.requestedRoute === card.model.requestedRoute &&
      observation.model.resolvedProvider === card.model.resolvedProvider &&
      observation.model.resolvedModel === card.model.resolvedModel &&
      (!card.model.modelRevision || observation.model.modelRevision === card.model.modelRevision) &&
      card.scope.taskFamilies.includes(observation.taskFamily) &&
      card.evidenceWindow.harnessVersions.includes(observation.harness.version)
    );
    const taskCount = new Set(matching.map((observation) => observation.taskId)).size;
    if (matching.length < card.evidenceWindow.benchmarkRuns) {
      errors.push(`project capability card for ${card.model.resolvedModel} claims ${card.evidenceWindow.benchmarkRuns} runs but only ${matching.length} matching observations exist`);
    }
    if (taskCount < card.evidenceWindow.taskCount) {
      errors.push(`project capability card for ${card.model.resolvedModel} claims ${card.evidenceWindow.taskCount} tasks but only ${taskCount} matching tasks exist`);
    }
    const availableEvidence = new Set(matching.flatMap((observation) => [observation.proofReceiptId, ...observation.evidenceRefs]));
    for (const reference of card.evidenceRefs) {
      if (!availableEvidence.has(reference)) errors.push(`project capability card evidence is not present in matching observations: ${reference}`);
    }
  }
  if (errors.length > 0) throw new Error(`model intelligence evidence validation failed:\n${errors.join("\n")}`);
  const harnessHash = hash(harness);
  const benchmarkHash = hash(observationValues.map((entry) => ({
    applicationId: entry.applicationId,
    taskFamily: entry.taskFamily,
    taskId: entry.taskId,
    proofReceiptId: entry.proofReceiptId,
  })));
  const registry = {
    schemaVersion: "nodekit.model-registry/v1",
    applicationId: harness.applicationId,
    status: observationValues.length === 0 ? "unmeasured" : cardValues.length === 0 ? "observed-unprofiled" : "profiled",
    observations: observationValues.length,
    cards: cardValues,
    models: [...new Set(observationValues.map((entry) => `${entry.model.resolvedProvider}/${entry.model.resolvedModel}`))].sort(),
    requestedRoutes: [...new Set(observationValues.map((entry) => entry.model.requestedRoute))].sort(),
    harnessHash,
    benchmarkHash,
    routingCertified: false,
    automaticPromotion: false,
  };
  const resolved = {
    schemaVersion: "nodekit.resolved-harness/v1",
    ...harness,
    harnessHash,
    benchmarkHash,
    observationCount: observationValues.length,
    capabilityCardCount: cardValues.length,
  };
  if (write) {
    const outputRoot = path.join(resolvedRoot, ".nodekit", "harness");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, "resolved-harness.json"), `${JSON.stringify(resolved, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "model-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "harness-hash.txt"), `${harnessHash}\n`);
    await writeFile(path.join(outputRoot, "benchmark-hash.txt"), `${benchmarkHash}\n`);
  }
  return { cards: cardValues, harness, observations: observationValues, registry, resolved };
}

export function diagnoseModelFailures(observations) {
  const clusters = new Map();
  for (const observation of observations) {
    for (const failure of observation.failures) {
      const key = `${failure.failureClass}|${failure.probableCause}|${observation.model.resolvedProvider}/${observation.model.resolvedModel}`;
      const cluster = clusters.get(key) ?? {
        failureClass: failure.failureClass,
        probableCause: failure.probableCause,
        model: `${observation.model.resolvedProvider}/${observation.model.resolvedModel}`,
        count: 0,
        taskIds: new Set(),
        taskFamilies: new Set(),
        severities: new Set(),
        evidenceRefs: new Set(),
      };
      cluster.count += 1;
      cluster.taskIds.add(observation.taskId);
      cluster.taskFamilies.add(observation.taskFamily);
      cluster.severities.add(failure.severity);
      for (const reference of failure.evidenceRefs) cluster.evidenceRefs.add(reference);
      clusters.set(key, cluster);
    }
  }
  return [...clusters.values()].map((cluster) => ({
    ...cluster,
    taskIds: [...cluster.taskIds].sort(),
    taskFamilies: [...cluster.taskFamilies].sort(),
    severities: [...cluster.severities].sort(),
    evidenceRefs: [...cluster.evidenceRefs].sort(),
    skillCandidateEligible: cluster.count >= 3 && cluster.taskIds.size >= 2,
  })).sort((left, right) => right.count - left.count || left.failureClass.localeCompare(right.failureClass));
}

export async function writeModelBaseline(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot);
  const receipt = {
    schemaVersion: "nodekit.model-baseline-receipt/v1",
    applicationId: compiled.harness.applicationId,
    harnessVersion: compiled.harness.version,
    harnessHash: compiled.resolved.harnessHash,
    benchmarkHash: compiled.resolved.benchmarkHash,
    observationCount: compiled.observations.length,
    capabilityCardCount: compiled.cards.length,
    status: compiled.registry.status,
    providerCallsMade: 0,
    capabilityClaimsCertified: false,
    routingCertified: false,
  };
  const output = path.join(repoRoot, "harness", "receipts", "capability-cards", "baseline.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return { compiled, output, receipt };
}
