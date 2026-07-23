import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import { addAtlasAsset, initializeAtlasStore } from "../src/lib/atlas.mjs";
import {
  atlasDelta,
  atlasPreview,
  atlasRecipe,
  atlasSearch,
  SEARCH_BUDGET_BYTES,
} from "../src/lib/atlas-retrieval.mjs";
import { ATLAS_RANKER, RANKER_HASH, filterAssets, scoreAsset, tokenize } from "../src/lib/atlas-rank.mjs";
import { ATLAS_MCP_TOOLS, callAtlasTool, handleAtlasRpc } from "../src/lib/atlas-mcp.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const execFileAsync = promisify(execFile);
const OBSERVED_AT = "2026-07-22T00:00:00.000Z";

function vendoredDraft(overrides = {}) {
  const base = {
    kind: "surface",
    title: "Finance dashboard overview",
    summary: "A cash-position dashboard that keeps the treasury analyst's primary artifact dominant.",
    intent: {
      userJob: "let a treasury analyst read cash position and drill into a finance dashboard",
      productStages: ["first_arrival", "populated"],
      artifactKinds: ["finance-dashboard"],
      supportedDomains: ["treasury", "finance"],
      aliases: ["cash-dashboard", "treasury overview"],
    },
    source: {
      origin: "uiverse",
      reuseMode: "copy",
      upstreamUrl: "https://uiverse.io/components/finance-dashboard?theme=dark#preview",
      observedAt: OBSERVED_AT,
      license: { identifier: "MIT", attributionRequired: false, redistributable: true },
    },
    implementation: {
      framework: "react",
      language: "tsx",
      exports: [{ name: "FinanceDashboard", exportKind: "component" }],
      dependencies: [],
      propSchema: { type: "object", properties: { accounts: { type: "array" } } },
      tokenContract: { spacing: "compact" },
    },
    behavior: {
      states: ["first_arrival", "populated"],
      actions: [{ id: "drill-account", effect: "read", approvalRequired: false }],
      events: ["account-selected"],
      keyboardOperations: [{ keys: "j / k", operation: "move between accounts" }],
      mobileStrategy: "responsive",
      visibleUncertainty: true,
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: [],
  };
  return { ...base, ...overrides };
}

function referenceDraft(overrides = {}) {
  const base = {
    kind: "reference",
    title: "Finance dashboard benchmark",
    summary: "A shipped finance dashboard kept only to benchmark our density against.",
    intent: {
      userJob: "benchmark our finance dashboard density against a shipped product",
      productStages: ["populated"],
      artifactKinds: ["finance-dashboard"],
      supportedDomains: ["finance"],
      aliases: [],
    },
    source: {
      origin: "external-web",
      reuseMode: "benchmark",
      upstreamUrl: "https://example.com/finance-dashboard-benchmark",
      observedAt: OBSERVED_AT,
      license: { identifier: "GPL-3.0-only", attributionRequired: false, redistributable: false },
    },
    implementation: { framework: "none", language: "none", propSchema: {}, tokenContract: {} },
    behavior: {
      states: ["populated"],
      actions: [],
      events: [],
      keyboardOperations: [],
      mobileStrategy: "desktop-only",
      visibleUncertainty: false,
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: ["captured third-party product; GPL license forbids vendoring"],
  };
  return { ...base, ...overrides };
}

function languageSamplerDraft() {
  return referenceDraft({
    kind: "primitive",
    title: "Language token sampler",
    summary: "A reference asset whose aliases exercise the short technical-term tokenizer path.",
    intent: {
      userJob: "prove the tokenizer matches short language terms it must not stem away",
      productStages: ["populated"],
      artifactKinds: ["token-sampler"],
      supportedDomains: ["tooling"],
      aliases: ["js", "ts", "tsx", "jsx", "css"],
    },
    source: {
      origin: "uiverse",
      reuseMode: "reference",
      upstreamUrl: "https://uiverse.io/components/language-sampler",
      observedAt: OBSERVED_AT,
      license: { identifier: "MIT", attributionRequired: false, redistributable: true },
    },
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-atlas-ladder-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "drafts"), { recursive: true });
  await mkdir(path.join(root, "vendor"), { recursive: true });
  await writeFile(path.join(root, "vendor", "dashboard.tsx"), "export function FinanceDashboard() { return null; }\n", "utf8");
  await writeFile(path.join(root, "vendor", "dashboard.vue"), "<template><section>cash</section></template>\n", "utf8");
  await writeFile(path.join(root, "vendor", "observation.html"), "<main>finance dashboard observation</main>\n", "utf8");
  await writeFile(path.join(root, "vendor", "capture.html"), "<main>third-party finance dashboard capture</main>\n", "utf8");
  const writeDraft = async (name, value) => {
    const relative = path.posix.join("drafts", name);
    await writeFile(path.join(root, "drafts", name), stringifyYaml(value), "utf8");
    return relative;
  };
  await initializeAtlasStore(root);
  return { root, writeDraft };
}

async function seedFinanceCorpus(t) {
  const { root, writeDraft } = await fixture(t);
  const react = await addAtlasAsset(root, {
    assetFile: await writeDraft("react.yaml", vendoredDraft()),
    observationFile: "vendor/observation.html",
    vendorFile: "vendor/dashboard.tsx",
  });
  const vue = await addAtlasAsset(root, {
    assetFile: await writeDraft("vue.yaml", vendoredDraft({
      title: "Finance dashboard for Vue",
      implementation: {
        framework: "vue",
        language: "vue",
        exports: [{ name: "FinanceDashboard", exportKind: "component" }],
        dependencies: [],
        propSchema: { type: "object" },
        tokenContract: {},
      },
      source: {
        origin: "uiverse",
        reuseMode: "copy",
        upstreamUrl: "https://uiverse.io/components/finance-dashboard-vue",
        observedAt: OBSERVED_AT,
        license: { identifier: "MIT", attributionRequired: false, redistributable: true },
      },
    })),
    observationFile: "vendor/observation.html",
    vendorFile: "vendor/dashboard.vue",
  });
  const gpl = await addAtlasAsset(root, {
    assetFile: await writeDraft("gpl.yaml", referenceDraft()),
    observationFile: "vendor/capture.html",
  });
  const sampler = await addAtlasAsset(root, {
    assetFile: await writeDraft("sampler.yaml", languageSamplerDraft()),
    observationFile: "vendor/capture.html",
  });
  return { root, react: react.asset, vue: vue.asset, gpl: gpl.asset, sampler: sampler.asset };
}

test("the ranker filters on hard constraints BEFORE it scores, and every excluded row is counted", async (t) => {
  const { root, react, vue, gpl } = await seedFinanceCorpus(t);
  const listing = (await import("../src/lib/atlas.mjs")).listAtlasRecords;
  const assets = (await listing(root)).assets;

  // A framework filter removes the Vue asset and the reference (framework none) before any score exists.
  const { survivors, excluded } = filterAssets(assets, { framework: "react" });
  const ids = survivors.map((asset) => asset.assetId).sort();
  assert.deepEqual(ids, [react.assetId].sort());
  assert.equal(excluded.framework, 3);

  // Scoring only ever runs over survivors: an infeasible candidate can never carry a score.
  const scored = scoreAsset(react, tokenize("finance dashboard"));
  assert.ok(scored.score >= ATLAS_RANKER.scoreFloor);
  assert.ok(scored.why.length > 0 && scored.why.length <= 3);
  assert.ok(vue.assetId !== react.assetId && gpl.assetId !== react.assetId);
});

test("a finance-dashboard agent runs the full four-stage ladder and every stage stays fail-closed", async (t) => {
  const { root, react, vue } = await seedFinanceCorpus(t);

  // STAGE 1 — compact candidates. The React surface wins; Vue and the reference are filtered out.
  const candidates = await atlasSearch(root, { terms: "finance dashboard", framework: "react" });
  assert.equal(candidates.decision.status, "SUPPORTED");
  assert.equal(candidates.assets.length, 1);
  assert.equal(candidates.assets[0].a, react.assetId);
  assert.equal(candidates.assets[0].k, "surface");
  assert.ok(!("license" in candidates.assets[0]), "rows omit fields the caller filtered on");
  assert.ok(candidates.assets[0].why.length > 0);
  assert.equal(candidates.recommendation.id, react.assetId);
  assert.equal(candidates.excluded.framework, 3);

  // Stage 1 stays under its byte budget and reports the measurement it actually made.
  assert.ok(candidates.budget.responseBytes <= SEARCH_BUDGET_BYTES, `stage 1 ${candidates.budget.responseBytes}B exceeds ${SEARCH_BUDGET_BYTES}B`);
  assert.equal(candidates.budget.budgetBytes, SEARCH_BUDGET_BYTES);

  // STAGE 2 — preview and compare the React and Vue surfaces; identical facets hoist into shared.
  const preview = await atlasPreview(root, { ids: [react.assetId, vue.assetId] });
  assert.equal(preview.decision.status, "SUPPORTED");
  assert.equal(preview.candidates.length, 2);
  assert.ok(preview.candidates.every((entry) => entry.preview));
  assert.ok(preview.differences.some((entry) => entry.path === "card"), "the two frameworks must show up as a difference");
  assert.equal(preview.shared.reuseMode, "copy");

  // STAGE 3 — the selected recipe. An `extracted` asset is below the vetted floor, so the agent must
  // opt in with allowUnvetted; the recipe then flags itself. Bytes are verified and inlined, not truncated.
  const gated = await atlasRecipe(root, { id: react.assetId });
  assert.equal(gated.status, "ABSTAIN");
  assert.equal(gated.reason, "MATURITY_BELOW_FLOOR");
  const recipe = await atlasRecipe(root, { id: react.assetId, allowUnvetted: true });
  assert.equal(recipe.unvetted, true);
  assert.equal(recipe.schemaVersion, "nodekit.experience-recipe/v1");
  assert.match(recipe.recipeId, /^atlas-recipe-[a-f0-9]{12}$/);
  assert.equal(recipe.files.length, 1);
  assert.equal(recipe.files[0].source, "export function FinanceDashboard() { return null; }\n");
  assert.deepEqual(recipe.propSchema, { type: "object", properties: { accounts: { type: "array" } } });
  assert.equal(recipe.promotionAuthorized, false);
  assert.equal(recipe.deploymentAuthorized, false);
  assert.ok(recipe.steps.some((step) => step.action === "copy-bytes"));

  // STAGE 4 — delta repair against the recipe the agent already holds. Nothing moved, so UNCHANGED.
  const delta = await atlasDelta(root, { recipe });
  assert.equal(delta.status, "UNCHANGED");
  assert.equal(delta.recipeHash, recipe.recipeHash);
});

test("ranking is byte-for-byte deterministic across runs and the ranker identity is bound to its weights", async (t) => {
  const { root } = await seedFinanceCorpus(t);
  const first = await atlasSearch(root, { terms: "finance dashboard" });
  const second = await atlasSearch(root, { terms: "finance dashboard" });
  assert.deepEqual(first, second);
  assert.equal(first.rankerHash, RANKER_HASH);

  // Changing any weight changes the ranker identity, which changes queryHash on every subsequent run.
  const mutated = structuredClone(ATLAS_RANKER);
  mutated.weights = { ...mutated.weights, title: 999 };
  const rerank = (await import("../src/lib/atlas-rank.mjs")).rankerSha256;
  assert.notEqual(rerank(mutated), RANKER_HASH);
});

test("a license-incompatible asset is filtered out before it is ever scored", async (t) => {
  const { root, react, vue, gpl } = await seedFinanceCorpus(t);
  const restricted = await atlasSearch(root, { terms: "finance dashboard", licenseAllowlist: ["MIT", "Apache-2.0"] });
  const returnedIds = restricted.assets.map((row) => row.a);
  assert.ok(returnedIds.includes(react.assetId));
  assert.ok(returnedIds.includes(vue.assetId));
  assert.ok(!returnedIds.includes(gpl.assetId), "the GPL reference must be excluded by the license allowlist");
  assert.equal(restricted.excluded.license, 1);
});

test("the ladder abstains with zero rows when nothing matches", async (t) => {
  const { root } = await seedFinanceCorpus(t);
  const empty = await atlasSearch(root, { terms: "quantum hologram zeppelin" });
  assert.equal(empty.decision.status, "ABSTAIN");
  assert.equal(empty.decision.reason, "NO_CANDIDATE_ABOVE_FLOOR");
  assert.deepEqual(empty.assets, []);
  assert.deepEqual(empty.flows, []);
  assert.equal(empty.recommendation, null);
});

test("the tokenizer matches short language terms the knowledge tokenizer would silently drop", async (t) => {
  const { root, sampler } = await seedFinanceCorpus(t);
  for (const term of ["js", "ts", "tsx", "jsx", "css"]) {
    const result = await atlasSearch(root, { terms: term });
    const ids = result.assets.map((row) => row.a);
    assert.ok(ids.includes(sampler.assetId), `search "${term}" must return the language sampler`);
  }
});

test("a stale index hash short-circuits a stage with zero work", async (t) => {
  const { root } = await seedFinanceCorpus(t);
  const stale = await atlasSearch(root, { terms: "finance dashboard", indexHash: "0".repeat(64) });
  assert.equal(stale.decision.status, "ABSTAIN");
  assert.equal(stale.decision.reason, "INDEX_STALE");
  assert.deepEqual(stale.assets, []);
  assert.equal(stale.budget.responseBytes, 0);
});

test("the recipe refuses rather than truncating when a file will not fit the budget", async (t) => {
  const { root, react } = await seedFinanceCorpus(t);
  const refused = await atlasRecipe(root, { id: react.assetId, maxBytes: 8, allowUnvetted: true });
  assert.equal(refused.status, "ABSTAIN");
  assert.equal(refused.reason, "BUDGET_EXCEEDED");
  assert.ok(refused.oversizedFiles.length >= 1);
});

test("the MCP surface exposes the eight tools and returns byte-identical payloads to the ladder functions", async (t) => {
  const { root, react } = await seedFinanceCorpus(t);
  const names = ATLAS_MCP_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "compare_assets",
    "inspect_asset",
    "inspect_flow",
    "materialize_asset",
    "plan_installation",
    "search_assets",
    "search_flows",
    "validate_composition",
  ]);

  // Every tool result is byte-identical to the corresponding ladder function's payload.
  const viaTool = await callAtlasTool(root, "search_assets", { terms: "finance dashboard", framework: "react" });
  const direct = await atlasSearch(root, { terms: "finance dashboard", framework: "react", target: "asset" });
  assert.deepEqual(viaTool, direct);

  const recipeTool = await callAtlasTool(root, "materialize_asset", { id: react.assetId, allowUnvetted: true });
  assert.equal(recipeTool.schemaVersion, "nodekit.experience-recipe/v1");

  // The JSON-RPC handshake: initialize, tools/list, tools/call.
  const initialize = await handleAtlasRpc(root, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(initialize.result.serverInfo.name, "nodekit-atlas");
  const list = await handleAtlasRpc(root, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(list.result.tools.length, 8);
  const call = await handleAtlasRpc(root, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_assets", arguments: { terms: "finance dashboard", framework: "react" } } });
  assert.equal(call.result.isError, false);
  assert.deepEqual(call.result.structuredContent, direct);
  // A notification (no id) produces no response.
  assert.equal(await handleAtlasRpc(root, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("the rung-3 recipe validates against the fat recipe schema, and a thinned entry still validates and ranks", async (t) => {
  const { root, react } = await seedFinanceCorpus(t);

  // The recipe rung-3 emits is now the fat materialization contract: it must validate against
  // nodekit.experience-recipe.v1 (rung 3 itself refuses if it does not, but assert it independently).
  const recipe = await atlasRecipe(root, { id: react.assetId, allowUnvetted: true });
  assert.equal(recipe.schemaVersion, "nodekit.experience-recipe/v1");
  assert.deepEqual(await validateSchema("nodekit.experience-recipe.v1.schema.json", recipe, "experience recipe"), []);

  // Fields that moved to the recipe are carried by it, not lost.
  assert.deepEqual(recipe.propSchema, { type: "object", properties: { accounts: { type: "array" } } });
  assert.deepEqual(recipe.tokenContract, { spacing: "compact" });

  // A THINNED entry — stripped of every field that moved to the recipe — still passes the entry schema,
  // because the entry no longer *requires* materialization-only fields.
  const thinned = structuredClone(react);
  delete thinned.implementation.exports;
  delete thinned.implementation.propSchema;
  delete thinned.implementation.tokenContract;
  delete thinned.implementation.backendNeutral;
  delete thinned.behavior.events;
  delete thinned.behavior.visibleUncertainty;
  delete thinned.behavior.reintroducesGuardrails;
  delete thinned.integration.caseflowBindings;
  delete thinned.integration.nodeAgentBindings;
  assert.deepEqual(
    await validateSchema("nodekit.experience-asset.v1.schema.json", thinned, "experience asset"),
    [],
    "a thinned entry without materialization-only fields must still satisfy the entry schema",
  );

  // The thinned entry still carries everything the ranker reads, so it still filters and scores.
  const { survivors, excluded } = filterAssets([thinned], { framework: "react" });
  assert.equal(survivors.length, 1);
  assert.equal(excluded.framework, 0);
  const scored = scoreAsset(thinned, tokenize("finance dashboard"));
  assert.ok(scored.score >= ATLAS_RANKER.scoreFloor, "the thinned entry must still rank above the score floor");
  assert.ok(scored.why.length > 0);
});

test("nodekit atlas serve --mcp answers a real newline-delimited JSON-RPC handshake over a pipe", async (t) => {
  const { root } = await seedFinanceCorpus(t);
  const cli = path.resolve("src", "cli.mjs");
  const child = spawn(process.execPath, [cli, "atlas", "serve", "--mcp", "--repo-root", root], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());

  const responses = [];
  let buffer = "";
  const done = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) responses.push(JSON.parse(line));
        if (responses.length >= 2) resolve();
      }
    });
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  await done;
  child.stdin.end();

  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.protocolVersion, "2024-11-05");
  assert.equal(responses[1].id, 2);
  assert.equal(responses[1].result.tools.length, 8);
});
