export const CONTRACT_VERSIONS = Object.freeze({
  application: "nodeagent.application/v1",
  event: "nodeagent.event/v1",
  pack: "nodeagent.pack/v1",
  repository: "nodekit.repo/v1",
  trace: "nodeagent.trace/v1",
});

export const CONTRACT_SCHEMA_FILES = Object.freeze({
  application: "nodeagent.application.v1.schema.json",
  pack: "nodeagent.pack.v1.schema.json",
  repository: "nodekit.schema.json",
});

export const DEFAULT_RUNTIME_CONTRACTS = Object.freeze({
  event: CONTRACT_VERSIONS.event,
  trace: CONTRACT_VERSIONS.trace,
});

const ALTERNATE_ENVELOPE_FIELDS = ["apiVersion", "kind", "metadata", "spec"];

/**
 * NodeKit v1 deliberately uses a flat `schemaVersion` manifest. Older planning
 * documents used a Kubernetes-style apiVersion/kind/spec envelope. Detect that
 * shape explicitly so callers receive a migration-oriented error instead of a
 * collection of unrelated missing-field messages.
 */
export function alternateDialectErrors(manifest, label, expectedVersion) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const fields = ALTERNATE_ENVELOPE_FIELDS.filter((field) => Object.hasOwn(manifest, field));
  if (fields.length === 0) return [];
  return [
    `${label} uses the unsupported apiVersion/kind/spec manifest dialect (${fields.join(", ")}); ` +
      `use the flat schemaVersion: ${expectedVersion} contract`,
  ];
}

export function resolveRuntimeContracts(manifest) {
  return {
    event: manifest?.contracts?.event ?? DEFAULT_RUNTIME_CONTRACTS.event,
    trace: manifest?.contracts?.trace ?? DEFAULT_RUNTIME_CONTRACTS.trace,
  };
}
