import { readFile } from "node:fs/promises";
import path from "node:path";

function parseJsonObject(raw) {
  const text = String(raw ?? "").trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of [...new Set(candidates)]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Try only the bounded representations above.
    }
  }
  throw new Error("Pi response did not contain a JSON object");
}

async function loadDefinition(repoRoot = process.cwd()) {
  const definition = JSON.parse(await readFile(path.join(repoRoot, ".nodeagent", "resolved-definition.json"), "utf8"));
  if (definition.provider.adapter !== "pi-ai") throw new Error("compiled provider adapter is not pi-ai");
  if (definition.provider.model.provider !== "openrouter") {
    throw new Error(`this starter currently certifies the Pi OpenRouter provider, not ${definition.provider.model.provider}`);
  }
  return definition;
}

async function createClient(definition) {
  const [{ createModels }, { openrouterProvider }] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-ai/providers/openrouter"),
  ]);
  const models = createModels();
  models.setProvider(openrouterProvider());
  const model = models.getModel("openrouter", definition.provider.model.id);
  if (!model) throw new Error(`Pi catalog does not contain ${definition.provider.model.id}`);
  const secretName = definition.secretRefs[0];
  const apiKey = process.env[secretName]?.trim();
  if (!apiKey) throw new Error(`${secretName} is required for live mode`);
  return { apiKey, model, models, secretName };
}

function responseText(response) {
  return response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}

function sanitizedUsage(response, model) {
  return {
    cacheReadTokens: response.usage?.cacheRead ?? 0,
    costUsd: response.usage?.cost?.total ?? 0,
    inputTokens: response.usage?.input ?? 0,
    outputTokens: response.usage?.output ?? 0,
    requestedModel: model.id,
    responseModel: response.responseModel ?? response.model ?? model.id,
    totalTokens: response.usage?.totalTokens ?? ((response.usage?.input ?? 0) + (response.usage?.output ?? 0)),
  };
}

export async function proposeWithPi(session, { repoRoot = process.cwd(), signal } = {}) {
  const definition = await loadDefinition(repoRoot);
  const { apiKey, model, models } = await createClient(definition);
  const response = await models.complete(model, {
    systemPrompt: "Propose one bounded character n-gram experiment. Return only JSON: {hypothesis:string, config:{order:integer 1..6, alpha:number 0.001..10}}. Honor the human intervention. Never change the corpus or metric.",
    messages: [{
      role: "user",
      content: JSON.stringify({ best: session.best, experiments: session.experiments.slice(-5), intervention: session.intervention }),
      timestamp: Date.now(),
    }],
  }, { apiKey, maxTokens: 320, signal, temperature: 0 });
  if (response.stopReason !== "stop") throw new Error(`Pi completion ended with ${response.stopReason}: ${response.errorMessage ?? "no provider detail"}`);
  const parsed = parseJsonObject(responseText(response));
  if (typeof parsed.hypothesis !== "string" || !parsed.config || !Number.isFinite(Number(parsed.config.order)) || !Number.isFinite(Number(parsed.config.alpha))) {
    throw new Error("Pi proposal failed the experiment proposal schema");
  }
  return { config: parsed.config, hypothesis: parsed.hypothesis, model: { id: model.id, mode: "live", provider: "openrouter" }, usage: sanitizedUsage(response, model) };
}

export async function runPiSmoke({ repoRoot = process.cwd(), signal } = {}) {
  const definition = await loadDefinition(repoRoot);
  const { apiKey, model, models } = await createClient(definition);
  const response = await models.complete(model, {
    systemPrompt: "Follow the user instruction exactly. Return no explanation.",
    messages: [{ role: "user", content: "Reply exactly NODEKIT_PI_LIVE_OK", timestamp: Date.now() }],
  }, { apiKey, maxTokens: 32, signal, temperature: 0 });
  const text = responseText(response);
  if (response.stopReason !== "stop" || text !== "NODEKIT_PI_LIVE_OK") {
    throw new Error(`strict Pi smoke failed (${response.stopReason}): ${text.slice(0, 120)}`);
  }
  return { model: model.id, provider: "openrouter", schemaVersion: "nodekit.pi-smoke/v1", status: "pass", stopReason: response.stopReason, usage: sanitizedUsage(response, model) };
}
