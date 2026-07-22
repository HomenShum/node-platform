export const CONTRACT_VERSIONS = Object.freeze({
  application: "nodeagent.application/v1",
  canaryReceipt: "nodekit.canary-receipt/v1",
  event: "nodeagent.event/v1",
  harness: "nodekit.harness/v1",
  modelCapabilityCard: "nodekit.model-capability-card/v1",
  modelObservation: "nodekit.model-observation/v1",
  promotionReceipt: "nodekit.promotion-receipt/v1",
  routingPolicy: "nodekit.routing-policy/v1",
  runtimeCapabilities: "nodekit.runtime-capabilities/v1",
  skill: "nodekit.skill/v1",
  skillCandidate: "nodekit.skill-candidate/v1",
  skillComparison: "nodekit.skill-comparison/v1",
  submissionManifest: "nodekit.submission-manifest/v1",
  tournament: "nodekit.tournament/v1",
  pack: "nodeagent.pack/v1",
  repository: "nodekit.repo/v1",
  trace: "nodeagent.trace/v1",
});

export const CONTRACT_SCHEMA_FILES = Object.freeze({
  application: "nodeagent.application.v1.schema.json",
  canaryReceipt: "nodekit.canary-receipt.v1.schema.json",
  harness: "nodekit.harness.v1.schema.json",
  modelCapabilityCard: "nodekit.model-capability-card.v1.schema.json",
  modelObservation: "nodekit.model-observation.v1.schema.json",
  promotionReceipt: "nodekit.promotion-receipt.v1.schema.json",
  routingPolicy: "nodekit.routing-policy.v1.schema.json",
  runtimeCapabilities: "nodekit.runtime-capabilities.v1.schema.json",
  skill: "nodekit.skill.v1.schema.json",
  skillCandidate: "nodekit.skill-candidate.v1.schema.json",
  skillComparison: "nodekit.skill-comparison.v1.schema.json",
  submissionManifest: "nodekit.submission-manifest.v1.schema.json",
  tournament: "nodekit.tournament.v1.schema.json",
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
