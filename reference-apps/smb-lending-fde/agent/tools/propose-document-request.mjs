function boundedText(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function boundedModel(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    ...(boundedText(input.id) ? { id: boundedText(input.id) } : {}),
    mode: input.mode === "live" ? "live" : "replay",
    provider: boundedText(input.provider, "deterministic") || "deterministic",
  };
}

function boundedConsent(value) {
  if (!value || typeof value !== "object") return null;
  const grantedAt = boundedText(value.grantedAt);
  return grantedAt
    ? {
      grantedAt,
      scope: boundedText(value.scope),
      type: boundedText(value.type),
    }
    : null;
}

function boundedUsage(value) {
  if (!value || typeof value !== "object") return null;
  const keys = ["cacheReadTokens", "costUsd", "inputTokens", "outputTokens", "totalTokens"];
  const usage = Object.fromEntries(keys
    .filter((key) => Number.isFinite(value[key]))
    .map((key) => [key, Number(value[key])]));
  const requestedModel = boundedText(value.requestedModel);
  const responseModel = boundedText(value.responseModel);
  if (requestedModel) usage.requestedModel = requestedModel;
  if (responseModel) usage.responseModel = responseModel;
  return Object.keys(usage).length > 0 ? usage : null;
}

export const tool = Object.freeze({
  id: "lending.propose-document-request",
  version: "1.0.0",
  async execute({ proposal }) {
    if (!proposal || typeof proposal !== "object") throw new Error("a structured proposal is required");
    return {
      action: String(proposal.action ?? "").trim(),
      consent: boundedConsent(proposal.consent),
      documentId: proposal.documentId == null ? null : String(proposal.documentId),
      model: boundedModel(proposal.model),
      rationale: boundedText(proposal.rationale),
      usage: boundedUsage(proposal.usage),
    };
  },
});
