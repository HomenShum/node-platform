import path from "node:path";
import { readYaml } from "./files.mjs";

const OWNERSHIP_SCHEMA = "nodeplatform.ownership/v1";
const REPOSITORIES_SCHEMA = "nodeplatform.repositories/v1";
const ARCHITECTURE_SCHEMA = "nodeplatform.architecture/v1";

const LIFECYCLES = new Set(["production", "preview", "experimental", "reference", "archived"]);
const SUPPORT_STATES = new Set(["active", "maintenance", "frozen"]);
const COMMAND_PROFILES = new Set(["application", "platform", "protocol", "untracked"]);
const CONCEPT_STATES = new Set([
  "canonical",
  "canonical-domain",
  "canonical-unpackaged",
  "migration-planned",
  "planned",
]);

export async function loadRegistry(root) {
  const [ownership, repositoryCatalog, architecture] = await Promise.all([
    readYaml(path.join(root, "ownership.yaml")),
    readYaml(path.join(root, "repositories.yaml")),
    readYaml(path.join(root, "architecture.yaml")),
  ]);

  return { architecture, ownership, repositoryCatalog, root };
}

export function validateRegistry(registry) {
  const errors = [];
  const { architecture, ownership, repositoryCatalog } = registry;

  if (ownership?.schemaVersion !== OWNERSHIP_SCHEMA) {
    errors.push(`ownership.yaml must use ${OWNERSHIP_SCHEMA}`);
  }
  if (repositoryCatalog?.schemaVersion !== REPOSITORIES_SCHEMA) {
    errors.push(`repositories.yaml must use ${REPOSITORIES_SCHEMA}`);
  }
  if (architecture?.schemaVersion !== ARCHITECTURE_SCHEMA) {
    errors.push(`architecture.yaml must use ${ARCHITECTURE_SCHEMA}`);
  }

  const repositories = new Map();
  const githubSlugs = new Set();
  for (const repository of repositoryCatalog?.repositories ?? []) {
    if (!repository?.name) {
      errors.push("repositories.yaml contains a repository without a name");
      continue;
    }
    if (repositories.has(repository.name)) {
      errors.push(`repositories.yaml repeats ${repository.name}`);
    }
    if (typeof repository.github !== "string" || !repository.github.includes("/")) {
      errors.push(`${repository.name} has an invalid GitHub slug`);
    } else if (githubSlugs.has(repository.github)) {
      errors.push(`repositories.yaml repeats ${repository.github}`);
    }
    githubSlugs.add(repository.github);
    if (!LIFECYCLES.has(repository.lifecycle)) {
      errors.push(`${repository.name} has invalid lifecycle ${repository.lifecycle ?? "missing"}`);
    }
    if (!SUPPORT_STATES.has(repository.support)) {
      errors.push(`${repository.name} has invalid support ${repository.support ?? "missing"}`);
    }
    if (!COMMAND_PROFILES.has(repository.commandProfile)) {
      errors.push(`${repository.name} has invalid commandProfile ${repository.commandProfile ?? "missing"}`);
    }
    if (typeof repository.role !== "string" || !repository.role.trim()) {
      errors.push(`${repository.name} is missing role`);
    }
    repositories.set(repository.name, repository);
  }
  for (const repository of repositories.values()) {
    if (repository.replacedBy && !repositories.has(repository.replacedBy)) {
      errors.push(`${repository.name} has unknown replacement ${repository.replacedBy}`);
    }
  }

  const signatureIds = new Set();
  for (const [conceptId, concept] of Object.entries(ownership?.concepts ?? {})) {
    if (!repositories.has(concept.owner)) {
      errors.push(`${conceptId} has unknown owner ${concept.owner}`);
    }
    if (!concept.contractVersion) {
      errors.push(`${conceptId} is missing contractVersion`);
    }
    if (!CONCEPT_STATES.has(concept.status)) {
      errors.push(`${conceptId} has invalid status ${concept.status ?? "missing"}`);
    }
    if (!Array.isArray(concept.consumers)) {
      errors.push(`${conceptId} consumers must be an array`);
    }
    const consumers = new Set();
    for (const consumer of concept.consumers ?? []) {
      if (!repositories.has(consumer)) {
        errors.push(`${conceptId} has unknown consumer ${consumer}`);
      }
      if (consumers.has(consumer)) errors.push(`${conceptId} repeats consumer ${consumer}`);
      if (consumer === concept.owner) errors.push(`${conceptId} cannot list its owner as a consumer`);
      consumers.add(consumer);
    }
    if (concept.currentSource) {
      if (!repositories.has(concept.currentSource.repository)) {
        errors.push(`${conceptId} has unknown current source ${concept.currentSource.repository}`);
      }
      if (typeof concept.currentSource.path !== "string" || !concept.currentSource.path.trim()) {
        errors.push(`${conceptId} current source is missing a path`);
      }
    }
    for (const signature of concept.signatures ?? []) {
      if (!signature.id || !signature.regex) {
        errors.push(`${conceptId} has an incomplete signature`);
        continue;
      }
      if (signatureIds.has(signature.id)) {
        errors.push(`signature id ${signature.id} is not unique`);
      }
      signatureIds.add(signature.id);
      try {
        new RegExp(signature.regex, "m");
      } catch (error) {
        errors.push(`${conceptId}/${signature.id} has invalid regex: ${error.message}`);
      }
    }
  }

  const ruleIds = new Set();
  for (const rule of architecture?.sourceRules ?? []) {
    if (!rule.id || !rule.regex) {
      errors.push("architecture.yaml contains an incomplete source rule");
      continue;
    }
    if (ruleIds.has(rule.id)) errors.push(`source rule id ${rule.id} is not unique`);
    ruleIds.add(rule.id);
    try {
      new RegExp(rule.regex, "m");
    } catch (error) {
      errors.push(`${rule.id} has invalid regex: ${error.message}`);
    }
  }

  const reuseModes = architecture?.reuseModes ?? [];
  if (!Array.isArray(reuseModes) || new Set(reuseModes).size !== reuseModes.length) {
    errors.push("architecture.yaml reuseModes must be a unique array");
  }
  for (const [profile, commands] of Object.entries(architecture?.requiredCommands ?? {})) {
    if (!COMMAND_PROFILES.has(profile)) errors.push(`unknown command profile ${profile}`);
    if (!Array.isArray(commands) || new Set(commands).size !== commands.length) {
      errors.push(`${profile} requiredCommands must be a unique array`);
    } else if (commands.some((command) => typeof command !== "string" || !command.trim())) {
      errors.push(`${profile} requiredCommands must contain non-empty command names`);
    }
  }

  return errors;
}

export function repositoryByName(registry, name) {
  return registry.repositoryCatalog.repositories.find((entry) => entry.name === name);
}

export function repositoryName(manifest) {
  return manifest.repository.split("/").at(-1);
}
