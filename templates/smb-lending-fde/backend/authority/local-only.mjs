function normalizedHost(host) {
  return String(host ?? "").trim().toLowerCase();
}

export function isLoopbackHost(host) {
  return new Set(["127.0.0.1", "::1", "localhost"]).has(normalizedHost(host));
}

export function assertLocalMutationHost(host) {
  if (isLoopbackHost(host)) return;
  throw new Error("This unauthenticated synthetic lab accepts mutations only on a loopback host. Add an authenticated workspace adapter before network deployment.");
}

export function assertLocalExternalModel(host, enabled) {
  assertLocalMutationHost(host);
  if (enabled === "true") return;
  throw new Error("Local live Pi is disabled. Set NODEKIT_ENABLE_LOCAL_LIVE_PI=true only for an explicitly authorized local synthetic test.");
}
