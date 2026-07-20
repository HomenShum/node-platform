import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  alternateDialectErrors,
  CONTRACT_SCHEMA_FILES,
  CONTRACT_VERSIONS,
} from "./contracts.mjs";
import {
  listSourceFiles,
  normalizePath,
  pathExists,
  readJson,
  readYaml,
} from "./files.mjs";
import { repositoryByName, repositoryName, validateRegistry } from "./registry.mjs";
import { validateSchema } from "./schema-validation.mjs";

const REPO_SCHEMA = CONTRACT_VERSIONS.repository;
const LIFECYCLES = new Set(["production", "preview", "experimental", "reference", "archived"]);
const SUPPORT_STATES = new Set(["active", "maintenance", "frozen"]);
const NO_KEY_STATES = new Set(["certified", "partial", "missing", "not-applicable"]);
const ENVIRONMENT_STATES = new Set(["aligned", "legacy", "migration-planned", "not-applicable"]);
const COMMAND_MODES = new Set(["finite", "service"]);
const ACTIVE_OWNER_STATES = new Set(["canonical", "canonical-domain", "canonical-unpackaged"]);
const NON_OWNER_MODES = new Set([
  "adapter",
  "domain-specialization",
  "generated",
  "migration-copy",
  "migration-source",
  "template-copy",
]);

function addCheck(checks, id, passed, detail) {
  checks.push({ detail, id, passed });
}

function declarationKey(concept, signature, declarationPath) {
  return `${concept}\0${signature}\0${normalizePath(declarationPath)}`;
}

function commandExists(command, packageJson) {
  if (typeof command?.run === "string" && command.run.trim()) return true;
  return Boolean(
    typeof command?.script === "string" &&
      packageJson?.scripts &&
      typeof packageJson.scripts[command.script] === "string",
  );
}

function declaredNpmCommandExists(command, packageJson) {
  if (typeof command !== "string") return false;
  const match = command.trim().match(/^npm run ([A-Za-z0-9:_-]+)$/);
  return Boolean(match && typeof packageJson?.scripts?.[match[1]] === "string");
}

async function scanContracts(registry, manifest, files) {
  const findings = [];
  const declarations = new Set(
    (manifest.contractDeclarations ?? []).map((entry) =>
      declarationKey(entry.concept, entry.signature, entry.path),
    ),
  );

  for (const file of files) {
    const text = await readFile(file.absolute, "utf8");
    for (const [conceptId, concept] of Object.entries(registry.ownership.concepts)) {
      for (const signature of concept.signatures ?? []) {
        const regex = new RegExp(signature.regex, "gm");
        for (const match of text.matchAll(regex)) {
          const line = text.slice(0, match.index).split("\n").length;
          const declared = declarations.has(declarationKey(conceptId, signature.id, file.relative));
          findings.push({
            concept: conceptId,
            declared,
            line,
            path: file.relative,
            signature: signature.id,
          });
        }
      }
    }
  }

  return findings;
}

async function scanArchitecture(registry, manifest, files) {
  const findings = [];
  const exceptions = new Set(
    (manifest.architectureExceptions ?? []).map(
      (entry) => `${entry.rule}\0${normalizePath(entry.path)}`,
    ),
  );

  for (const file of files) {
    const searchablePath = `/${file.relative}`;
    const text = await readFile(file.absolute, "utf8");
    for (const rule of registry.architecture.sourceRules ?? []) {
      if (!(rule.pathIncludes ?? []).some((fragment) => searchablePath.includes(fragment))) continue;
      const regex = new RegExp(rule.regex, "gm");
      for (const match of text.matchAll(regex)) {
        const line = text.slice(0, match.index).split("\n").length;
        findings.push({
          excepted: exceptions.has(`${rule.id}\0${file.relative}`),
          line,
          path: file.relative,
          rule: rule.id,
        });
      }
    }
  }

  return findings;
}

export async function checkRepository(repoRoot, registry) {
  const checks = [];
  const errors = [...validateRegistry(registry)];
  const manifestPath = path.join(repoRoot, "nodekit.yaml");

  if (!(await pathExists(manifestPath))) {
    return {
      checks,
      contractFindings: [],
      errors: [...errors, "nodekit.yaml is missing"],
      manifest: null,
      passed: false,
      repoRoot,
      sourceFindings: [],
    };
  }

  const manifest = await readYaml(manifestPath);
  errors.push(
    ...alternateDialectErrors(manifest, "nodekit.yaml", REPO_SCHEMA),
    ...await validateSchema(CONTRACT_SCHEMA_FILES.repository, manifest, "nodekit.yaml"),
  );
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = (await pathExists(packagePath)) ? await readJson(packagePath) : null;
  const name = manifest?.repository ? repositoryName(manifest) : path.basename(repoRoot);
  const catalogEntry = repositoryByName(registry, name);
  const external = manifest?.registryMode === "external";

  addCheck(checks, "manifest-schema", manifest?.schemaVersion === REPO_SCHEMA, REPO_SCHEMA);
  addCheck(checks, "catalog-entry", external || Boolean(catalogEntry), external ? "external repository" : name);
  addCheck(checks, "lifecycle", LIFECYCLES.has(manifest?.lifecycle), manifest?.lifecycle ?? "missing");
  addCheck(checks, "support", SUPPORT_STATES.has(manifest?.support), manifest?.support ?? "missing");

  if (manifest?.schemaVersion !== REPO_SCHEMA) {
    errors.push(`nodekit.yaml must use ${REPO_SCHEMA}`);
  }
  if (!external && !catalogEntry) errors.push(`${name} is missing from repositories.yaml`);
  if (manifest?.registryMode && !["ecosystem", "external"].includes(manifest.registryMode)) {
    errors.push(`invalid registryMode ${manifest.registryMode}`);
  }
  if (!LIFECYCLES.has(manifest?.lifecycle)) errors.push(`invalid lifecycle ${manifest?.lifecycle ?? "missing"}`);
  if (!SUPPORT_STATES.has(manifest?.support)) errors.push(`invalid support ${manifest?.support ?? "missing"}`);
  if (!Array.isArray(manifest?.canonicalFor)) errors.push("canonicalFor must be an array");
  if (!Array.isArray(manifest?.consumes)) errors.push("consumes must be an array");
  if (!manifest?.commands || typeof manifest.commands !== "object") errors.push("commands must be an object");
  if (!Array.isArray(manifest?.contractDeclarations)) errors.push("contractDeclarations must be an array");
  if (!Array.isArray(manifest?.architectureExceptions)) errors.push("architectureExceptions must be an array");
  if (!NO_KEY_STATES.has(manifest?.noKey?.status)) {
    errors.push(`invalid noKey.status ${manifest?.noKey?.status ?? "missing"}`);
  }
  if (!Number.isInteger(manifest?.noKey?.externalAccountsRequired) || manifest.noKey.externalAccountsRequired < 0) {
    errors.push("noKey.externalAccountsRequired must be a non-negative integer");
  }
  if (typeof manifest?.noKey?.disclosure !== "string" || !manifest.noKey.disclosure.trim()) {
    errors.push("noKey.disclosure is required");
  }
  if (["certified", "not-applicable"].includes(manifest?.noKey?.status) && manifest?.noKey?.externalAccountsRequired !== 0) {
    errors.push(`${manifest.noKey.status} no-key status cannot require an external account`);
  }
  if (manifest?.noKey?.status === "certified" &&
      (typeof manifest.noKey.command !== "string" || !manifest.noKey.command.trim())) {
    errors.push("certified no-key status requires a command");
  } else if (["certified", "partial"].includes(manifest?.noKey?.status) &&
      !declaredNpmCommandExists(manifest.noKey.command, packageJson)) {
    errors.push("noKey.command must reference an existing npm script");
  }
  if (manifest?.noKey?.status === "not-applicable" && manifest.noKey.command !== null) {
    errors.push("not-applicable no-key status must use a null command");
  }
  if (manifest?.environment?.contractVersion !== "nodeplatform.env/v1") {
    errors.push("environment.contractVersion must be nodeplatform.env/v1");
  }
  if (!ENVIRONMENT_STATES.has(manifest?.environment?.status)) {
    errors.push(`invalid environment.status ${manifest?.environment?.status ?? "missing"}`);
  }
  if (!manifest?.proof || !("command" in manifest.proof) || !("receiptSchema" in manifest.proof)) {
    errors.push("proof must declare command and receiptSchema, using null for unavailable values");
  } else {
    if (manifest.proof.command !== null && typeof manifest.proof.command !== "string") {
      errors.push("proof.command must be a string or null");
    }
    if (manifest.proof.receiptSchema !== null && typeof manifest.proof.receiptSchema !== "string") {
      errors.push("proof.receiptSchema must be a string or null");
    }
    if (manifest.proof.receiptSchema && !manifest.proof.command) {
      errors.push("proof.command is required when receiptSchema is declared");
    }
    if (manifest.proof.command && !declaredNpmCommandExists(manifest.proof.command, packageJson)) {
      errors.push("proof.command must reference an existing npm script");
    }
  }

  if (!manifest?.repository || !manifest.repository.includes("/")) {
    errors.push("repository must be an owner/name GitHub slug");
  }
  if (catalogEntry) {
    for (const field of ["lifecycle", "support", "role", "commandProfile"]) {
      if (manifest[field] !== catalogEntry[field]) {
        errors.push(`${field} must match repositories.yaml (${catalogEntry[field]})`);
      }
    }
    if (manifest.repository !== catalogEntry.github) {
      errors.push(`repository must match repositories.yaml (${catalogEntry.github})`);
    }
  }

  const concepts = registry.ownership.concepts ?? {};
  const ownedConcepts = Object.entries(concepts)
    .filter(([, concept]) => concept.owner === name && ACTIVE_OWNER_STATES.has(concept.status))
    .map(([conceptId]) => conceptId);
  const consumedConcepts = Object.entries(concepts)
    .filter(([, concept]) => (concept.consumers ?? []).includes(name))
    .map(([conceptId]) => conceptId);
  const declaredOwnedConcepts = new Set(manifest.canonicalFor ?? []);
  const declaredConsumedConcepts = new Set(manifest.consumes ?? []);
  for (const conceptId of ownedConcepts) {
    if (!declaredOwnedConcepts.has(conceptId)) errors.push(`canonicalFor omits owned concept ${conceptId}`);
  }
  for (const conceptId of consumedConcepts) {
    if (!declaredConsumedConcepts.has(conceptId)) errors.push(`consumes omits registered concept ${conceptId}`);
  }
  for (const conceptId of declaredOwnedConcepts) {
    if (!ownedConcepts.includes(conceptId) && concepts[conceptId]?.owner === name) {
      errors.push(`canonicalFor cannot promote ${conceptId} while its status is ${concepts[conceptId].status}`);
    }
  }
  for (const conceptId of declaredConsumedConcepts) {
    if (!external && !consumedConcepts.includes(conceptId)) {
      errors.push(`consumes lists ${conceptId} but the ownership registry does not register ${name}`);
    }
  }
  if (declaredOwnedConcepts.size !== (manifest.canonicalFor ?? []).length) {
    errors.push("canonicalFor contains duplicate concepts");
  }
  if (declaredConsumedConcepts.size !== (manifest.consumes ?? []).length) {
    errors.push("consumes contains duplicate concepts");
  }
  for (const conceptId of manifest.canonicalFor ?? []) {
    if (!concepts[conceptId]) {
      errors.push(`canonicalFor references unknown concept ${conceptId}`);
    } else if (concepts[conceptId].owner !== name) {
      errors.push(`${name} cannot own ${conceptId}; owner is ${concepts[conceptId].owner}`);
    }
  }
  for (const conceptId of manifest.consumes ?? []) {
    const concept = concepts[conceptId];
    if (!concept) {
      errors.push(`consumes references unknown concept ${conceptId}`);
    } else if (!external && concept.owner !== name && !(concept.consumers ?? []).includes(name)) {
      errors.push(`${conceptId} does not declare ${name} as a consumer`);
    }
  }

  const requiredCommands = registry.architecture.requiredCommands?.[manifest.commandProfile] ?? [];
  for (const [commandName, command] of Object.entries(manifest.commands ?? {})) {
    const hasScript = typeof command?.script === "string" && Boolean(command.script.trim());
    const hasRun = typeof command?.run === "string" && Boolean(command.run.trim());
    if (hasScript === hasRun) errors.push(`command ${commandName} must declare exactly one of script or run`);
    if (!COMMAND_MODES.has(command?.mode)) errors.push(`command ${commandName} has invalid mode ${command?.mode ?? "missing"}`);
  }
  for (const commandName of requiredCommands) {
    const command = manifest.commands?.[commandName];
    const exists = commandExists(command, packageJson);
    addCheck(checks, `command:${commandName}`, exists, command?.script ?? command?.run ?? "missing");
    if (!exists) errors.push(`required command ${commandName} is not runnable`);
  }

  const reuseModes = new Set(registry.architecture.reuseModes ?? []);
  const declarationKeys = new Set();
  for (const declaration of manifest.contractDeclarations ?? []) {
    const concept = concepts[declaration.concept];
    const declarationPath = path.join(repoRoot, declaration.path ?? "");
    if (!concept) {
      errors.push(`contract declaration references unknown concept ${declaration.concept}`);
      continue;
    }
    if (!(concept.signatures ?? []).some((signature) => signature.id === declaration.signature)) {
      errors.push(`${declaration.path} references unknown signature ${declaration.signature} for ${declaration.concept}`);
    }
    const key = declarationKey(declaration.concept, declaration.signature, declaration.path ?? "");
    if (declarationKeys.has(key)) errors.push(`duplicate contract declaration ${declaration.path}/${declaration.signature}`);
    declarationKeys.add(key);
    if (!reuseModes.has(declaration.mode) && declaration.mode !== "canonical") {
      errors.push(`${declaration.path} has unsupported reuse mode ${declaration.mode}`);
    }
    if (declaration.mode === "canonical" && concept.owner !== name) {
      errors.push(`${declaration.path} claims canonical ${declaration.concept}, owned by ${concept.owner}`);
    }
    if (declaration.mode !== "canonical" && !NON_OWNER_MODES.has(declaration.mode)) {
      errors.push(`${declaration.path} has invalid non-owner mode ${declaration.mode}`);
    }
    if (declaration.mode !== "canonical" && !declaration.origin) {
      errors.push(`${declaration.path} must declare origin for ${declaration.mode}`);
    } else if (declaration.mode !== "canonical" && !concepts[declaration.origin]) {
      errors.push(`${declaration.path} references unknown origin ${declaration.origin}`);
    }
    if (!(await pathExists(declarationPath))) {
      errors.push(`declared contract path does not exist: ${declaration.path}`);
    }
  }

  // Source discovery can dominate ecosystem checks for mature repositories.
  // Discover executable source once, then reuse it for contract and
  // architecture scans. JSON manifests/catalogs are schema-validated through
  // their dedicated paths and are intentionally not treated as source code.
  const sourceFiles = await listSourceFiles(repoRoot);
  const contractFindings = await scanContracts(registry, manifest, sourceFiles);
  const findingKeys = new Set(
    contractFindings.map((finding) => declarationKey(finding.concept, finding.signature, finding.path)),
  );
  for (const declaration of manifest.contractDeclarations ?? []) {
    const key = declarationKey(declaration.concept, declaration.signature, declaration.path ?? "");
    if (!findingKeys.has(key)) {
      errors.push(`stale contract declaration ${declaration.path}/${declaration.signature}`);
    }
  }
  for (const finding of contractFindings.filter((entry) => !entry.declared)) {
    errors.push(
      `undeclared contract signature ${finding.signature} (${finding.concept}) at ${finding.path}:${finding.line}`,
    );
  }

  const ruleIds = new Set((registry.architecture.sourceRules ?? []).map((rule) => rule.id));
  const exceptionKeys = new Set();
  for (const exception of manifest.architectureExceptions ?? []) {
    const key = `${exception.rule}\0${normalizePath(exception.path ?? "")}`;
    if (exceptionKeys.has(key)) errors.push(`duplicate architecture exception ${exception.path}/${exception.rule}`);
    exceptionKeys.add(key);
    if (!ruleIds.has(exception.rule)) errors.push(`architecture exception references unknown rule ${exception.rule}`);
    if (typeof exception.reason !== "string" || !exception.reason.trim()) {
      errors.push(`architecture exception ${exception.path}/${exception.rule} requires a reason`);
    }
    if (!(await pathExists(path.join(repoRoot, exception.path ?? "")))) {
      errors.push(`architecture exception path does not exist: ${exception.path}`);
    }
  }

  const sourceFindings = await scanArchitecture(registry, manifest, sourceFiles);
  const sourceFindingKeys = new Set(
    sourceFindings.map((finding) => `${finding.rule}\0${normalizePath(finding.path)}`),
  );
  for (const key of exceptionKeys) {
    if (!sourceFindingKeys.has(key)) errors.push(`stale architecture exception ${key.replace("\0", "/")}`);
  }
  for (const finding of sourceFindings.filter((entry) => !entry.excepted)) {
    errors.push(`architecture rule ${finding.rule} failed at ${finding.path}:${finding.line}`);
  }

  addCheck(
    checks,
    "contract-declarations",
    contractFindings.every((entry) => entry.declared),
    `${contractFindings.filter((entry) => entry.declared).length}/${contractFindings.length} classified`,
  );
  addCheck(
    checks,
    "source-rules",
    sourceFindings.every((entry) => entry.excepted),
    `${sourceFindings.filter((entry) => entry.excepted).length}/${sourceFindings.length} excepted`,
  );

  return {
    checks,
    contractFindings,
    errors: [...new Set(errors)],
    manifest,
    packageJson,
    passed: errors.length === 0,
    repoRoot,
    sourceFindings,
  };
}

export function commandFor(manifest, name) {
  const command = manifest.commands?.[name];
  if (!command) return null;
  if (command.run) return command.run;
  if (command.script) return `npm run ${command.script}`;
  return null;
}
