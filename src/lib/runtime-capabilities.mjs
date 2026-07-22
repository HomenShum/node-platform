export const RUNTIME_CAPABILITY_VERSION = "nodekit.runtime-capabilities/v1";

export const runtimeProfiles = Object.freeze({
  memory: Object.freeze({
    schemaVersion: RUNTIME_CAPABILITY_VERSION,
    provider: "memory",
    durableState: false,
    transactions: true,
    optimisticConcurrency: true,
    subscriptions: "snapshot",
    durableJobs: "in-process",
    fileStorage: false,
    presence: false,
    scheduledJobs: false,
    localDevelopment: true,
  }),
  convex: Object.freeze({
    schemaVersion: RUNTIME_CAPABILITY_VERSION,
    provider: "convex",
    durableState: true,
    transactions: true,
    optimisticConcurrency: true,
    subscriptions: "native",
    durableJobs: "native",
    fileStorage: true,
    presence: true,
    scheduledJobs: true,
    localDevelopment: true,
  }),
  postgres: Object.freeze({
    schemaVersion: RUNTIME_CAPABILITY_VERSION,
    provider: "postgres",
    durableState: true,
    transactions: true,
    optimisticConcurrency: true,
    subscriptions: "polling",
    durableJobs: "external",
    fileStorage: false,
    presence: false,
    scheduledJobs: false,
    localDevelopment: true,
  }),
  supabase: Object.freeze({
    schemaVersion: RUNTIME_CAPABILITY_VERSION,
    provider: "supabase",
    durableState: true,
    transactions: true,
    optimisticConcurrency: true,
    subscriptions: "event-driven",
    durableJobs: "queue-backed",
    fileStorage: true,
    presence: true,
    scheduledJobs: true,
    localDevelopment: true,
  }),
});

export const coreCaseflowRequirements = Object.freeze({
  durableState: true,
  optimisticConcurrency: true,
  transactions: true,
});

export function negotiateRuntimeCapabilities(offered, required = coreCaseflowRequirements) {
  const missing = [];
  for (const [name, expectation] of Object.entries(required)) {
    const actual = offered?.[name];
    if (Array.isArray(expectation)) {
      if (!expectation.includes(actual)) missing.push({ actual, expected: expectation, name });
    } else if (actual !== expectation) missing.push({ actual, expected: expectation, name });
  }
  return {
    missing,
    passed: missing.length === 0,
    provider: offered?.provider ?? "unknown",
    schemaVersion: "nodekit.runtime-capability-negotiation/v1",
  };
}

export function requireRuntimeCapabilities(offered, required = coreCaseflowRequirements) {
  const result = negotiateRuntimeCapabilities(offered, required);
  if (!result.passed) {
    throw new Error(`runtime ${result.provider} is missing required capabilities: ${result.missing.map((entry) => `${entry.name}=${JSON.stringify(entry.expected)}`).join(", ")}`);
  }
  return result;
}
