import { createInterface } from "node:readline";
import {
  atlasPreview,
  atlasRecipe,
  atlasSearch,
  atlasValidateComposition,
} from "./atlas-retrieval.mjs";

/**
 * The Atlas MCP surface. Six read-only ladder tools plus two folded convenience tools, all delegating to
 * the SAME payload builders the CLI --json path uses, so a bug is fixed once. There are ZERO write tools:
 * materialize_asset returns the materialize-ready recipe but performs no filesystem write — vendoring
 * bytes into the user's workspace is a human-approved CLI verb (`nodekit atlas materialize`), never a
 * standing agent capability. plan_installation returns only the install plan the recipe already contains.
 */
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "nodekit-atlas", version: "1.0.0" };
const MAX_LINE_BYTES = 1024 * 1024;

const filterProperties = {
  kind: { type: "array", items: { type: "string" } },
  framework: { type: "string" },
  language: { type: "array", items: { type: "string" } },
  mobile: { type: "string", enum: ["responsive", "adaptive", "separate-surface", "desktop-only"] },
  accessibility: { type: "string", enum: ["A", "AA", "AAA"] },
  maturityFloor: { type: "string", enum: ["discovered", "extracted", "vetted", "proven", "certified"] },
  licenseAllowlist: { type: "array", items: { type: "string" } },
  noNewDeps: { type: "boolean" },
  limit: { type: "integer" },
  maxBytes: { type: "integer" },
  indexHash: { type: "string" },
};

export const ATLAS_MCP_TOOLS = Object.freeze([
  {
    name: "search_assets",
    description: "RUNG 1. Compact ranked asset candidates. Hard-constraint filters run before scoring; rows carry only id, kind, title, why, and score. No code, no previews.",
    inputSchema: { type: "object", required: ["terms"], properties: { terms: { type: "string" }, ...filterProperties }, additionalProperties: false },
  },
  {
    name: "search_flows",
    description: "RUNG 1 for flows. Ranked interaction-flow candidates for a text query.",
    inputSchema: { type: "object", required: ["terms"], properties: { terms: { type: "string" }, limit: { type: "integer" }, maxBytes: { type: "integer" }, indexHash: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "inspect_asset",
    description: "RUNG 2 for a single asset. Preview projection: card, summary, states, ports, dependency names, license, sourceBytes. No file contents.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, indexHash: { type: "string" }, maxBytes: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "inspect_flow",
    description: "RUNG 2 for a single flow. Coverage, node/transition counts, approval gates, and asset bindings.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, indexHash: { type: "string" }, maxBytes: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "compare_assets",
    description: "RUNG 2. Diff-compressed comparison of 2 to 4 assets or flows: identical facets hoisted into shared, only disagreements repeated.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 }, indexHash: { type: "string" }, maxBytes: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "plan_installation",
    description: "RUNG 3 install plan only. Packages, peer requirements, and ordered steps for a selected asset. Folded from a standalone plan tool: an install plan the recipe does not contain means the recipe is not self-sufficient.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, flowId: { type: "string" }, allowUnvetted: { type: "boolean" }, maxBytes: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "materialize_asset",
    description: "RUNG 3 full recipe, ready to materialize: inlined propSchema, tokenContract, and verified file source. Returns the recipe only; it performs no workspace write. Actual file placement is the human CLI verb `nodekit atlas materialize`.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, flowId: { type: "string" }, allowUnvetted: { type: "boolean" }, maxBytes: { type: "integer" }, indexHash: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "validate_composition",
    description: "Recompute every check for a selection from bytes on disk: current hashes, covered states, bound ports, license obligations, no reference-only surfaces. Nothing is trusted from the composition's own assertions.",
    inputSchema: { type: "object", required: ["composition"], properties: { composition: { type: "object" } }, additionalProperties: false },
  },
]);

export async function callAtlasTool(repoRoot, name, args = {}) {
  switch (name) {
    case "search_assets":
      return atlasSearch(repoRoot, { ...args, target: "asset" });
    case "search_flows":
      return atlasSearch(repoRoot, { terms: args.terms, target: "flow", limit: args.limit, maxBytes: args.maxBytes, indexHash: args.indexHash });
    case "inspect_asset":
    case "inspect_flow":
      return atlasPreview(repoRoot, { ids: [args.id], indexHash: args.indexHash, maxBytes: args.maxBytes });
    case "compare_assets":
      return atlasPreview(repoRoot, { ids: args.ids, indexHash: args.indexHash, maxBytes: args.maxBytes });
    case "plan_installation": {
      const recipe = await atlasRecipe(repoRoot, { id: args.id, flowId: args.flowId, allowUnvetted: args.allowUnvetted, maxBytes: args.maxBytes });
      if (recipe.status) return recipe;
      return {
        schemaVersion: "nodekit.atlas-installation-plan/v1",
        recipeId: recipe.recipeId,
        assetId: recipe.assetId,
        reuseMode: recipe.reuseMode,
        install: recipe.install,
        steps: recipe.steps,
        promotionAuthorized: false,
        deploymentAuthorized: false,
      };
    }
    case "materialize_asset":
      return atlasRecipe(repoRoot, { id: args.id, flowId: args.flowId, allowUnvetted: args.allowUnvetted, maxBytes: args.maxBytes, indexHash: args.indexHash });
    case "validate_composition":
      return atlasValidateComposition(repoRoot, { composition: args.composition });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handle one parsed JSON-RPC message. Returns the response object, or null for a notification (no id).
 * HONEST_STATUS: an error returns a JSON-RPC error object, never a success-shaped result carrying a fault.
 */
export async function handleAtlasRpc(repoRoot, message) {
  if (!message || typeof message !== "object") return jsonRpcError(null, -32600, "invalid request");
  const { id = null, method, params } = message;
  const isNotification = id === null || id === undefined;
  if (method === "initialize") {
    return jsonRpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: ATLAS_MCP_TOOLS });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const payload = await callAtlasTool(repoRoot, name, args);
      return jsonRpcResult(id, { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: false });
    } catch (error) {
      if (isNotification) return null;
      return jsonRpcResult(id, { content: [{ type: "text", text: error.message }], isError: true });
    }
  }
  if (isNotification) return null;
  return jsonRpcError(id, -32601, `method not found: ${method}`);
}

/**
 * Newline-delimited JSON-RPC 2.0 over stdio, hand-rolled on node:readline. Zero new dependencies.
 * Bounded: over-length lines are rejected, not buffered; requests are handled sequentially in receive
 * order so responses never interleave.
 */
export async function serveAtlasMcp(repoRoot, options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reader = createInterface({ input, crlfDelay: Infinity });
  const write = (message) => {
    if (message === null) return;
    output.write(`${JSON.stringify(message)}\n`);
  };
  let chain = Promise.resolve();
  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (Buffer.byteLength(trimmed, "utf8") > MAX_LINE_BYTES) {
      write(jsonRpcError(null, -32600, "request line exceeds 1 MiB"));
      continue;
    }
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      write(jsonRpcError(null, -32700, "parse error"));
      continue;
    }
    chain = chain.then(async () => {
      write(await handleAtlasRpc(repoRoot, message));
    });
  }
  await chain;
}
