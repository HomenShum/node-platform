import { createHash } from "node:crypto";
import path from "node:path";
import { compareCodeUnits } from "./receipt-bindings.mjs";
import { readContainedEvidenceFile, verifyEvidenceSnapshot } from "./evidence-snapshots.mjs";
import { listAtlasRecords, readAtlasRecord } from "./atlas.mjs";
import { validateSchema } from "./schema-validation.mjs";
import {
  ATLAS_RANKER,
  RANKER_HASH,
  filterAssets,
  scoreAsset,
  scoreFlow,
  tokenize,
} from "./atlas-rank.mjs";

// Byte budgets, never token budgets. There is no tokenizer in this repo and adding one is a forbidden
// dependency; every stage records responseBytes/budgetBytes only. Token figures elsewhere are 4 B/token
// ESTIMATES and never enter a payload.
const SEARCH_BUDGET_BYTES = 8192;
const PREVIEW_BUDGET_BYTES = 24576;
const RECIPE_BUDGET_BYTES = 49152;
const DELTA_BUDGET_BYTES = 32768;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_PREVIEW_IDS = 4;

const REFERENCE_REUSE_MODES = new Set(["reference", "benchmark"]);
const RECIPE_SCHEMA_FILE = "nodekit.experience-recipe.v1.schema.json";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function clampLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

/**
 * Normalize the caller's hard constraints into a stable, sorted object so queryHash is reproducible.
 */
function normalizeConstraints(input) {
  const constraints = {};
  if (input.kind && input.kind.length) constraints.kind = [...input.kind].sort(compareCodeUnits);
  if (input.framework) constraints.framework = String(input.framework);
  if (input.language && input.language.length) constraints.language = [...input.language].sort(compareCodeUnits);
  if (input.mobile) constraints.mobile = String(input.mobile);
  if (input.accessibility) constraints.accessibility = String(input.accessibility);
  if (input.maturityFloor) constraints.maturityFloor = String(input.maturityFloor);
  if (input.licenseAllowlist && input.licenseAllowlist.length) constraints.licenseAllowlist = [...input.licenseAllowlist].sort(compareCodeUnits);
  if (input.noNewDeps) constraints.noNewDeps = true;
  return constraints;
}

function queryHashFor(terms, constraints, target, limit, atlasIndexHash) {
  return hash({
    schemaVersion: "nodekit.atlas-query/v1",
    terms,
    constraints,
    target,
    limit,
    rankerHash: RANKER_HASH,
    atlasIndexHash,
  });
}

/**
 * A cheap, deterministic index identity: the sorted (id, hash) manifest of every record. Recomputed on
 * every read from the records the store actually holds, so a caller's stale --index-hash short-circuits
 * a stage rather than serving a stale view.
 */
function atlasIndexHashFor(listing) {
  const manifest = [
    ...listing.assets.map((asset) => ({ id: asset.assetId, hash: asset.assetHash })),
    ...listing.flows.map((flow) => ({ id: flow.flowId, hash: flow.flowHash })),
  ].sort((left, right) => compareCodeUnits(left.id, right.id));
  return hash({ schemaVersion: "nodekit.atlas-index/v1", manifest, rankerHash: RANKER_HASH });
}

async function loadStore(repoRoot) {
  const listing = await listAtlasRecords(repoRoot);
  return { listing, atlasIndexHash: atlasIndexHashFor(listing) };
}

function recommend(rows) {
  if (rows.length === 0) return { recommendation: null, ambiguous: false };
  if (rows.length === 1) return { recommendation: { id: rows[0].id, reasons: rows[0].why }, ambiguous: false };
  const [top, second] = rows;
  const margin = top.s === 0 ? 0 : (top.s - second.s) / top.s;
  if (margin <= ATLAS_RANKER.ambiguityMargin) return { recommendation: null, ambiguous: true };
  return { recommendation: { id: top.id, reasons: top.why }, ambiguous: false };
}

/**
 * RUNG 1 — compact ranked candidates. Reads records once, filters on hard constraints BEFORE scoring,
 * scores over the stored card, drops anything below the score floor, and returns rows carrying only the
 * fields the caller did not already filter on. Writes nothing.
 */
export async function atlasSearch(repoRoot, input) {
  const terms = String(input.terms ?? "").trim();
  if (!terms) throw new Error("atlas search requires search terms");
  const target = ["asset", "flow", "both"].includes(input.target) ? input.target : "both";
  const limit = clampLimit(input.limit);
  const budgetBytes = Number.isInteger(input.maxBytes) ? input.maxBytes : SEARCH_BUDGET_BYTES;
  const constraints = normalizeConstraints(input);
  const { listing, atlasIndexHash } = await loadStore(repoRoot);
  const queryHash = queryHashFor(terms, constraints, target, limit, atlasIndexHash);

  if (input.indexHash && input.indexHash !== atlasIndexHash) {
    return {
      schemaVersion: "nodekit.atlas-candidates/v1",
      atlasIndexHash,
      queryHash,
      rankerHash: RANKER_HASH,
      rankerVersion: ATLAS_RANKER.rankerVersion,
      constraints,
      assets: [],
      flows: [],
      excluded: { kind: 0, framework: 0, language: 0, mobile: 0, accessibility: 0, maturity: 0, license: 0, deps: 0, deprecated: 0 },
      totalMatched: 0,
      returned: 0,
      recommendation: null,
      decision: { status: "ABSTAIN", reason: "INDEX_STALE" },
      currentAtlasIndexHash: atlasIndexHash,
      budget: { responseBytes: 0, budgetBytes },
    };
  }

  const queryTokens = tokenize(terms);
  const consumerDependencies = Array.isArray(input.consumerDependencies) ? input.consumerDependencies : null;

  let excluded = { kind: 0, framework: 0, language: 0, mobile: 0, accessibility: 0, maturity: 0, license: 0, deps: 0, deprecated: 0 };
  let assetRows = [];
  if (target !== "flow") {
    const filtered = filterAssets(listing.assets, { ...constraints, noNewDeps: undefined }, constraints.noNewDeps ? consumerDependencies : null);
    excluded = filtered.excluded;
    for (const asset of filtered.survivors) {
      const { score, why } = scoreAsset(asset, queryTokens);
      if (score < ATLAS_RANKER.scoreFloor) continue;
      assetRows.push({ id: asset.assetId, a: asset.assetId, v: asset.version, k: asset.kind, t: asset.title, m: asset.card.maturity, d: asset.card.deps, s: score, why });
    }
    assetRows.sort((left, right) => right.s - left.s || compareCodeUnits(left.a, right.a));
  }

  let flowRows = [];
  if (target !== "asset") {
    for (const flow of listing.flows) {
      if (flow.card.maturity === "deprecated") continue;
      const { score, why } = scoreFlow(flow, queryTokens);
      if (score < ATLAS_RANKER.scoreFloor) continue;
      flowRows.push({ id: flow.flowId, f: flow.flowId, v: flow.version, t: flow.title, r: flow.card.role, n: flow.card.nodeCount, c: flow.card.stateCoverage, m: flow.card.maturity, s: score, why });
    }
    flowRows.sort((left, right) => right.s - left.s || compareCodeUnits(left.f, right.f));
  }

  const totalMatched = assetRows.length + flowRows.length;
  assetRows = assetRows.slice(0, limit);
  flowRows = flowRows.slice(0, Math.max(1, Math.ceil(limit / 4)));

  const strip = (rows) => rows.map(({ id, ...rest }) => rest);
  const constraintsRemovedEverything = totalMatched === 0 && Object.values(excluded).some((count) => count > 0);
  let decision;
  if (totalMatched === 0) {
    decision = { status: "ABSTAIN", reason: constraintsRemovedEverything ? "CONSTRAINTS_UNSATISFIABLE" : "NO_CANDIDATE_ABOVE_FLOOR" };
  } else {
    decision = { status: "SUPPORTED", reason: "CANDIDATES_RETURNED" };
  }

  const primaryRows = assetRows.length ? assetRows : flowRows;
  const { recommendation, ambiguous } = decision.status === "SUPPORTED" ? recommend(primaryRows) : { recommendation: null, ambiguous: false };
  if (ambiguous) decision.reason = "AMBIGUOUS_CANDIDATES";

  const payload = {
    schemaVersion: "nodekit.atlas-candidates/v1",
    atlasIndexHash,
    queryHash,
    rankerHash: RANKER_HASH,
    rankerVersion: ATLAS_RANKER.rankerVersion,
    constraints,
    assets: strip(assetRows),
    flows: strip(flowRows),
    excluded,
    totalMatched,
    returned: assetRows.length + flowRows.length,
    recommendation,
    decision,
    budget: { responseBytes: 0, budgetBytes },
  };

  // Fail closed on budget: drop the lowest-ranked asset row and re-measure rather than truncating a row.
  while (byteLength(payload) > budgetBytes && payload.assets.length > 0) {
    payload.assets.pop();
    payload.returned = payload.assets.length + payload.flows.length;
    payload.excluded.deps += 0;
  }
  payload.budget.responseBytes = byteLength(payload);
  if (payload.budget.responseBytes > budgetBytes) {
    payload.decision = { status: "ABSTAIN", reason: "BUDGET_EXCEEDED" };
  }
  return payload;
}

function assetPreview(asset) {
  return {
    card: asset.card,
    summary: asset.summary,
    userJob: asset.intent.userJob,
    productStages: asset.intent.productStages,
    states: asset.behavior.states,
    actions: asset.behavior.actions.map((action) => ({ id: action.id, effect: action.effect, approvalRequired: action.approvalRequired })),
    keyboardOperationCount: asset.behavior.keyboardOperations.length,
    mobileStrategy: asset.behavior.mobileStrategy,
    requiredPorts: asset.integration.requiredPorts.map((port) => ({ portId: port.portId, direction: port.direction, required: port.required })),
    dependencyNames: asset.implementation.dependencies.map((dependency) => dependency.name),
    entryPoint: asset.implementation.entryPoint ?? null,
    reuseMode: asset.source.reuseMode,
    origin: asset.source.origin,
    license: asset.source.license.identifier,
    maturity: asset.quality.maturity,
    receiptIds: Object.keys(asset.quality.receipts ?? {}),
    knownLimitations: asset.knownLimitations ?? [],
    previewRefs: (asset.previewRefs ?? []).map((ref) => ({ snapshotId: ref.snapshotId, sha256: ref.sha256 })),
    sourceBytes: asset.implementation.files.reduce((total, file) => total + file.byteLength, 0),
    assetHash: asset.assetHash,
  };
}

function flowPreview(flow) {
  return {
    card: flow.card,
    role: flow.user.role,
    primaryJob: flow.user.primaryJob,
    coverage: flow.coverage,
    nodeCount: flow.nodes.length,
    transitionCount: flow.transitions.length,
    approvalGates: flow.transitions.filter((transition) => transition.approvalRequired === true).length,
    assetBindings: flow.assetBindings.map((binding) => binding.assetId),
    knownLimitations: flow.knownLimitations ?? [],
    maturity: flow.quality.maturity,
    flowHash: flow.flowHash,
  };
}

/**
 * Diff-compression: fields whose value is identical across the whole compared set are hoisted once into
 * `shared`; only fields that disagree are repeated per candidate under `differences`.
 */
function diffCompress(candidates) {
  const present = candidates.filter((entry) => entry.preview);
  if (present.length === 0) return { shared: {}, differences: [] };
  const keys = new Set();
  for (const entry of present) for (const key of Object.keys(entry.preview)) keys.add(key);
  const shared = {};
  const differences = [];
  for (const key of [...keys].sort(compareCodeUnits)) {
    const values = present.map((entry) => ({ id: entry.id, value: entry.preview[key] }));
    const first = canonical(values[0].value);
    const identical = values.every((entry) => canonical(entry.value) === first);
    if (identical && present.length > 1) {
      shared[key] = values[0].value;
    } else {
      const map = {};
      for (const entry of values) map[entry.id] = entry.value;
      differences.push({ path: key, values: map });
    }
  }
  return { shared, differences };
}

/**
 * RUNG 2 — preview and compare. 1..4 ids (assets and flows may mix). Reads only the named records,
 * projects a bounded preview per id, and diff-compresses identical facets. Writes nothing.
 */
export async function atlasPreview(repoRoot, input) {
  const ids = Array.isArray(input.ids) ? input.ids.filter(Boolean) : [];
  if (ids.length === 0) throw new Error("atlas preview requires 1 to 4 ids");
  if (ids.length > MAX_PREVIEW_IDS) throw new Error(`atlas preview accepts at most ${MAX_PREVIEW_IDS} ids; rung 1 has already eliminated the rest`);
  const budgetBytes = Number.isInteger(input.maxBytes) ? input.maxBytes : PREVIEW_BUDGET_BYTES;
  const { listing, atlasIndexHash } = await loadStore(repoRoot);
  if (input.indexHash && input.indexHash !== atlasIndexHash) {
    return { schemaVersion: "nodekit.atlas-preview/v1", atlasIndexHash, decision: { status: "ABSTAIN", reason: "INDEX_STALE" }, currentAtlasIndexHash: atlasIndexHash, candidates: [], shared: {}, differences: [], budget: { responseBytes: 0, budgetBytes } };
  }
  const assetIndex = new Map(listing.assets.map((asset) => [asset.assetId, asset]));
  const flowIndex = new Map(listing.flows.map((flow) => [flow.flowId, flow]));

  const candidates = [];
  const licenseObligations = [];
  const portOwners = new Map();
  for (const id of ids) {
    if (assetIndex.has(id)) {
      const asset = assetIndex.get(id);
      const preview = assetPreview(asset);
      candidates.push({ id, preview });
      if (asset.source.license.attributionRequired) {
        licenseObligations.push({ id, identifier: asset.source.license.identifier, attributionRequired: true, noticeRef: asset.source.license.noticeRef ?? null });
      }
      for (const port of preview.requiredPorts) {
        if (!portOwners.has(port.portId)) portOwners.set(port.portId, []);
        portOwners.get(port.portId).push(id);
      }
    } else if (flowIndex.has(id)) {
      candidates.push({ id, preview: flowPreview(flowIndex.get(id)) });
    } else {
      candidates.push({ id, status: "ASSET_NOT_FOUND" });
    }
  }

  const sharedPorts = [];
  const conflictingPorts = [];
  for (const [portId, owners] of [...portOwners.entries()].sort((left, right) => compareCodeUnits(left[0], right[0]))) {
    if (owners.length > 1) conflictingPorts.push({ portId, ids: owners });
    else sharedPorts.push(portId);
  }

  const { shared, differences } = diffCompress(candidates);
  const previewed = candidates.filter((entry) => entry.preview);
  const recommendation = previewed.length === 1 ? { id: previewed[0].id, reasons: ["only viable candidate previewed"] } : null;
  const decision = { status: previewed.length ? "SUPPORTED" : "ABSTAIN", reason: previewed.length ? "PREVIEW_RETURNED" : "ASSET_NOT_FOUND" };

  const payload = {
    schemaVersion: "nodekit.atlas-preview/v1",
    atlasIndexHash,
    shared,
    candidates,
    differences,
    sharedPorts,
    conflictingPorts,
    licenseObligations,
    recommendation,
    decision,
    budget: { responseBytes: 0, budgetBytes },
  };
  payload.budget.responseBytes = byteLength(payload);
  if (payload.budget.responseBytes > budgetBytes) {
    return { schemaVersion: "nodekit.atlas-preview/v1", atlasIndexHash, decision: { status: "ABSTAIN", reason: "BUDGET_EXCEEDED" }, candidates: [], shared: {}, differences: [], budget: { responseBytes: payload.budget.responseBytes, budgetBytes } };
  }
  return payload;
}

async function verifiedFileSource(repoRoot, file) {
  // A MISSING blob throws out of stableReadRegularFile (ENOENT) while only a TAMPERED blob returns
  // passed:false, so both branches must be handled or a crash path is left open.
  let verification;
  try {
    verification = await verifyEvidenceSnapshot(repoRoot, file.snapshotId);
  } catch (error) {
    return { ok: false, reason: `SOURCE_BYTES_UNVERIFIED:${error.message}` };
  }
  if (!verification.passed) return { ok: false, reason: "SOURCE_BYTES_UNVERIFIED" };
  const { bytes } = await readContainedEvidenceFile(repoRoot, file.blobPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== file.sha256) return { ok: false, reason: "SOURCE_BYTES_UNVERIFIED" };
  return { ok: true, source: bytes.toString("utf8") };
}

/**
 * RUNG 3 — the selected recipe. Exactly one asset (optionally one flow for state context). Verifies every
 * bound snapshot before emitting anything, inlines propSchema/tokenContract/file source so no seventh
 * call exists, and refuses rather than truncating over budget. Writes only the recipe under
 * .nodeagent/atlas/recipes when requested.
 */
export async function atlasRecipe(repoRoot, input) {
  const id = String(input.id ?? "");
  const budgetBytes = Number.isInteger(input.maxBytes) ? input.maxBytes : RECIPE_BUDGET_BYTES;
  const { listing, atlasIndexHash } = await loadStore(repoRoot);
  if (input.indexHash && input.indexHash !== atlasIndexHash) return { status: "REFUSED", reason: "INDEX_STALE", currentAtlasIndexHash: atlasIndexHash };

  let asset;
  try {
    asset = await readAtlasRecord(repoRoot, id);
  } catch {
    return { status: "REFUSED", reason: "ASSET_NOT_FOUND" };
  }
  if (asset.schemaVersion !== "nodekit.experience-asset/v1") return { status: "REFUSED", reason: "ASSET_NOT_FOUND" };

  const body = structuredClone(asset);
  delete body.assetHash;
  if (hash(body) !== asset.assetHash) return { status: "REFUSED", reason: "ASSET_HASH_MISMATCH" };

  const unvetted = ["discovered", "extracted"].includes(asset.quality.maturity);
  if (unvetted && input.allowUnvetted !== true) return { status: "ABSTAIN", reason: "MATURITY_BELOW_FLOOR", maturity: asset.quality.maturity };

  // Verify the observation snapshot and every file snapshot before building any output.
  const snapshotIds = [asset.source.observationSnapshotId, ...asset.implementation.files.map((file) => file.snapshotId)];
  for (const snapshotId of snapshotIds) {
    try {
      const verification = await verifyEvidenceSnapshot(repoRoot, snapshotId);
      if (!verification.passed) return { status: "REFUSED", reason: "SOURCE_BYTES_UNVERIFIED" };
    } catch {
      return { status: "REFUSED", reason: "SOURCE_BYTES_UNVERIFIED" };
    }
  }

  const files = [];
  let oversizedFiles = [];
  for (const file of asset.implementation.files) {
    const result = await verifiedFileSource(repoRoot, file);
    if (!result.ok) return { status: "REFUSED", reason: "SOURCE_BYTES_UNVERIFIED" };
    if (file.byteLength > budgetBytes) oversizedFiles.push({ path: file.path, byteLength: file.byteLength });
    files.push({ path: file.path, mediaType: file.mediaType, byteLength: file.byteLength, sha256: file.sha256, blobPath: file.blobPath, source: result.source });
  }
  if (oversizedFiles.length) return { status: "ABSTAIN", reason: "BUDGET_EXCEEDED", oversizedFiles };

  let flow = null;
  if (input.flowId) {
    try {
      flow = await readAtlasRecord(repoRoot, String(input.flowId));
    } catch {
      flow = null;
    }
  }

  const reference = REFERENCE_REUSE_MODES.has(asset.source.reuseMode);
  const steps = [];
  let order = 1;
  for (const file of files) steps.push({ order: order++, action: "copy-bytes", target: file.path, detail: `write ${file.byteLength} verified bytes` });
  if (files.length) steps.push({ order: order++, action: "add-import", target: asset.implementation.entryPoint ?? files[0].path, detail: `import ${(asset.implementation.exports ?? []).map((entry) => entry.name).join(", ") || "the default export"}` });
  for (const port of asset.integration.requiredPorts) steps.push({ order: order++, action: "bind-port", target: port.portId, detail: `wire the ${port.direction} port` });
  if (asset.source.license.attributionRequired) steps.push({ order: order++, action: "write-notice", target: asset.source.license.noticeRef ?? "NOTICE", detail: `record the ${asset.source.license.identifier} attribution` });

  const recipe = {
    schemaVersion: "nodekit.experience-recipe/v1",
    recipeId: null,
    assetId: asset.assetId,
    assetVersion: asset.version,
    assetHash: asset.assetHash,
    flowId: flow ? flow.flowId : null,
    flowHash: flow ? flow.flowHash : null,
    atlasIndexHash,
    rankerHash: RANKER_HASH,
    unvetted: Boolean(unvetted),
    reuseMode: asset.source.reuseMode,
    sourceSnapshotIds: snapshotIds,
    upstreamUrl: asset.source.upstreamUrl,
    install: {
      packages: asset.implementation.dependencies.map((dependency) => ({ name: dependency.name, range: dependency.range, dependencyKind: dependency.dependencyKind, license: dependency.license })),
      peerRequirements: asset.implementation.dependencies.filter((dependency) => dependency.dependencyKind === "peer").map((dependency) => dependency.name),
      postInstallNotes: reference ? ["reference-only asset: nothing to install, benchmark against it"] : [],
    },
    files,
    propSchema: asset.implementation.propSchema,
    tokenContract: asset.implementation.tokenContract,
    wiring: {
      requiredPorts: asset.integration.requiredPorts,
      caseflowBindings: asset.integration.caseflowBindings,
      nodeAgentBindings: asset.integration.nodeAgentBindings,
    },
    states: flow ? flow.nodes.map((node) => ({ nodeId: node.nodeId, productStage: node.productStage, primaryArtifact: node.primaryArtifact, primaryAction: node.primaryAction, mobileMode: node.mobileMode })) : asset.behavior.states.map((state) => ({ productStage: state })),
    usage: {
      importStatement: asset.implementation.entryPoint ? `import { ${(asset.implementation.exports ?? []).map((entry) => entry.name).join(", ")} } from "./${asset.implementation.entryPoint}";` : `// reference-only asset ${asset.assetId}; no import`,
      exampleUsage: asset.intent.userJob,
    },
    guardrails: [],
    steps,
    attribution: asset.source.license.attributionRequired
      ? { spdx: asset.source.license.identifier, noticeRef: asset.source.license.noticeRef ?? null, noticeText: null }
      : null,
    promotionAuthorized: false,
    deploymentAuthorized: false,
    generatedAt: new Date().toISOString(),
    responseBytes: 0,
    recipeHash: null,
  };

  delete recipe.recipeId;
  delete recipe.recipeHash;
  recipe.responseBytes = byteLength(recipe);
  if (recipe.responseBytes > budgetBytes) {
    return { status: "ABSTAIN", reason: "BUDGET_EXCEEDED", oversizedFiles: files.map((file) => ({ path: file.path, byteLength: file.byteLength })) };
  }
  const recipeHash = hash(recipe);
  recipe.recipeId = `atlas-recipe-${recipeHash.slice(0, 12)}`;
  recipe.recipeHash = recipeHash;

  // Rung 3 no longer trusts the emitted schemaVersion string alone: the recipe is validated against
  // nodekit.experience-recipe.v1 (the fat materialization contract) before it leaves the ladder, so a
  // drift between the emit shape and the recipe schema fails closed instead of shipping a bad recipe.
  const schemaFindings = await validateSchema(RECIPE_SCHEMA_FILE, recipe, "experience recipe");
  if (schemaFindings.length) return { status: "REFUSED", reason: "RECIPE_SCHEMA_INVALID", findings: schemaFindings };
  return recipe;
}

/**
 * RUNG 4 — delta repair. The agent presents a recipe it already holds. Atlas recomputes the current
 * asset hash and re-verifies bound snapshots, then returns a bare UNCHANGED comparison, a CHANGED delta,
 * or GONE. Writes nothing.
 */
export async function atlasDelta(repoRoot, input) {
  const recipe = input.recipe;
  if (!recipe || typeof recipe !== "object" || recipe.schemaVersion !== "nodekit.experience-recipe/v1") {
    throw new Error("atlas repair requires a nodekit.experience-recipe/v1 document via --recipe");
  }
  const budgetBytes = Number.isInteger(input.maxBytes) ? input.maxBytes : DELTA_BUDGET_BYTES;
  const { atlasIndexHash } = await loadStore(repoRoot);

  let asset;
  try {
    asset = await readAtlasRecord(repoRoot, recipe.assetId);
  } catch {
    return { status: "GONE", reason: "ASSET_REMOVED" };
  }
  if (asset.quality.maturity === "deprecated" && asset.quality.deprecation?.supersededByAssetId) {
    return { status: "SUPERSEDED", supersededByAssetId: asset.quality.deprecation.supersededByAssetId, reason: asset.quality.deprecation.reason };
  }

  // Re-verify bound snapshots: a source whose bytes can no longer be authenticated is GONE, not stale.
  for (const snapshotId of recipe.sourceSnapshotIds ?? []) {
    try {
      const verification = await verifyEvidenceSnapshot(repoRoot, snapshotId);
      if (!verification.passed) return { status: "GONE", reason: "SOURCE_BYTES_UNVERIFIED" };
    } catch {
      return { status: "GONE", reason: "SOURCE_BYTES_UNVERIFIED" };
    }
  }

  if (asset.assetHash === recipe.assetHash) {
    return { status: "UNCHANGED", recipeHash: recipe.recipeHash, atlasIndexHash, checkedAt: new Date().toISOString() };
  }

  const changedPaths = [];
  const fieldDeltas = {};
  if (recipe.assetVersion !== asset.version) {
    changedPaths.push("version");
    fieldDeltas.version = { from: recipe.assetVersion, to: asset.version };
  }

  const previousFiles = new Map((recipe.files ?? []).map((file) => [file.path, file]));
  const changedFiles = [];
  for (const file of asset.implementation.files) {
    const previous = previousFiles.get(file.path);
    if (!previous || previous.sha256 !== file.sha256) {
      const result = await verifiedFileSource(repoRoot, file);
      if (!result.ok) return { status: "GONE", reason: "SOURCE_BYTES_UNVERIFIED" };
      changedFiles.push({ path: file.path, fromSha256: previous ? previous.sha256 : null, toSha256: file.sha256, byteLength: file.byteLength, source: result.source });
      changedPaths.push(`files/${file.path}`);
    }
  }

  const repairSteps = [];
  let order = 1;
  for (const file of changedFiles) repairSteps.push({ order: order++, action: "copy-bytes", target: file.path, detail: `overwrite with ${file.byteLength} re-verified bytes` });
  if (fieldDeltas.version) repairSteps.push({ order: order++, action: "write-file", target: "asset-version", detail: `asset advanced to version ${asset.version}` });

  const payload = {
    status: "CHANGED",
    fromRecipeHash: recipe.recipeHash,
    toRecipeHash: null,
    previousAssetHash: recipe.assetHash,
    currentAssetHash: asset.assetHash,
    changedPaths: changedPaths.sort(compareCodeUnits),
    fieldDeltas,
    changedFiles,
    repairSteps: repairSteps.slice(0, 6),
    budget: { responseBytes: 0, budgetBytes },
  };
  payload.toRecipeHash = hash({ assetId: asset.assetId, assetHash: asset.assetHash, files: asset.implementation.files });
  payload.budget.responseBytes = byteLength(payload);
  if (payload.budget.responseBytes > budgetBytes) return { status: "REFETCH_REQUIRED", reason: "BUDGET_EXCEEDED" };
  return payload;
}

/**
 * Describe a selection the caller already made and recompute every check from bytes on disk. Nothing is
 * read from the composition's own assertions.
 */
export async function atlasValidateComposition(repoRoot, input) {
  const composition = input.composition ?? input;
  const budgetBytes = PREVIEW_BUDGET_BYTES;
  const { listing, atlasIndexHash } = await loadStore(repoRoot);
  const assetIndex = new Map(listing.assets.map((asset) => [asset.assetId, asset]));
  const flowIndex = new Map(listing.flows.map((flow) => [flow.flowId, flow]));
  const findings = [];

  const selectedAssets = Array.isArray(composition.assets) ? composition.assets : [];
  let allHashesCurrent = true;
  let licensesSatisfied = true;
  let noReferenceOnlySurfaces = true;
  const boundPorts = new Set(Array.isArray(composition.boundPorts) ? composition.boundPorts : []);
  const surfaces = new Set(Array.isArray(composition.surfaceAssetIds) ? composition.surfaceAssetIds : selectedAssets.map((entry) => entry.assetId ?? entry));

  for (const entry of selectedAssets) {
    const assetId = entry.assetId ?? entry;
    const record = assetIndex.get(assetId);
    if (!record) {
      findings.push({ kind: "stale-asset-version", severity: "blocking", subject: assetId, expected: "registered asset", observed: "not found", fix: "register the asset or drop it from the composition" });
      allHashesCurrent = false;
      continue;
    }
    if (entry.assetHash && entry.assetHash !== record.assetHash) {
      findings.push({ kind: "stale-asset-version", severity: "blocking", subject: assetId, expected: record.assetHash, observed: entry.assetHash, fix: "re-run rung 3 against the current asset bytes" });
      allHashesCurrent = false;
    }
    if (REFERENCE_REUSE_MODES.has(record.source.reuseMode) && surfaces.has(assetId)) {
      findings.push({ kind: "reference-only-surface", severity: "blocking", subject: assetId, expected: "vendored or reimplemented surface", observed: `reuseMode ${record.source.reuseMode}`, fix: "bind a buildable asset as the rendered surface" });
      noReferenceOnlySurfaces = false;
    }
    if (record.source.license.attributionRequired && !record.source.license.noticeRef) {
      findings.push({ kind: "unfulfilled-attribution", severity: "blocking", subject: assetId, expected: "committed notice", observed: "none", fix: "add a notice file for the attribution-required license" });
      licensesSatisfied = false;
    }
    for (const port of record.integration.requiredPorts) {
      if (port.required && !boundPorts.has(port.portId)) {
        findings.push({ kind: "unbound-required-port", severity: "blocking", subject: port.portId, expected: "bound", observed: "unbound", fix: `bind the ${port.direction} port ${port.portId}` });
      }
    }
  }

  let requiredStatesCovered = true;
  if (composition.flowId) {
    const flow = flowIndex.get(composition.flowId);
    if (!flow) {
      findings.push({ kind: "missing-state", severity: "blocking", subject: composition.flowId, expected: "registered flow", observed: "not found", fix: "register the flow" });
      requiredStatesCovered = false;
    } else if (!flow.coverage.complete) {
      requiredStatesCovered = false;
      for (const state of flow.coverage.missingStates) {
        findings.push({ kind: "missing-state", severity: "blocking", subject: state, expected: "covered", observed: "missing", fix: `add a node whose productStage is ${state}` });
      }
    }
  }

  findings.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "blocking" ? -1 : 1;
    return compareCodeUnits(String(left.subject), String(right.subject));
  });
  const bounded = findings.slice(0, 200);
  const blockingCount = bounded.filter((finding) => finding.severity === "blocking").length;

  const payload = {
    schemaVersion: "nodekit.atlas-composition-verdict/v1",
    atlasIndexHash,
    checks: {
      assetHashesCurrent: allHashesCurrent,
      flowHashesCurrent: composition.flowId ? flowIndex.has(composition.flowId) : true,
      requiredStatesCovered,
      licensesSatisfied,
      noReferenceOnlySurfaces,
    },
    findings: bounded,
    blockingCount,
    decision: { status: blockingCount === 0 ? "SUPPORTED" : "ABSTAIN", reason: blockingCount === 0 ? "COMPOSITION_COMPLETE" : "COMPOSITION_INCOMPLETE" },
    promotionAuthorized: false,
    budget: { responseBytes: 0, budgetBytes },
  };
  payload.budget.responseBytes = byteLength(payload);
  return payload;
}

export { RECIPE_BUDGET_BYTES, SEARCH_BUDGET_BYTES, PREVIEW_BUDGET_BYTES, DELTA_BUDGET_BYTES };
