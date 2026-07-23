import { createHash } from "node:crypto";
import { compareCodeUnits } from "./receipt-bindings.mjs";

/**
 * The Atlas ranker is a single frozen literal. rankerHash is a pure function of these bytes, so any
 * change to a weight, the tokenizer, or the synonym table changes rankerHash, which changes queryHash,
 * which changes every downstream receipt. This closes the verified hole in the knowledge path where
 * queryHash bound the inputs but nothing bound the scoring function (src/lib/knowledge-runtime.mjs).
 */
export const ATLAS_RANKER = Object.freeze({
  rankerVersion: "atlas-lexical/v1",
  tokenizerVersion: "atlas-tokenizer/v1",
  weights: Object.freeze({ title: 10, userJob: 8, tag: 5, supportedDomain: 4, artifactKind: 3, alias: 3 }),
  maturityBonus: Object.freeze({ certified: 6, proven: 4, vetted: 2, extracted: 0, discovered: 0, deprecated: 0 }),
  dependencyPenalty: 1,
  dependencyPenaltyCap: 5,
  scoreFloor: 3,
  ambiguityMargin: 0.1,
  filterOrder: Object.freeze([
    "kind",
    "framework",
    "language",
    "mobile",
    "accessibility",
    "maturityFloor",
    "license",
    "noNewDeps",
    "deprecated",
  ]),
  tieBreak: "assetId-codeunit",
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export const RANKER_HASH = sha256(ATLAS_RANKER);

/**
 * A frozen bidirectional synonym table. Deliberately small and hand-curated: the recall ceiling of a
 * zero-dependency lexical ranker is authored aliases plus these expansions, not embeddings.
 */
const SYNONYM_TABLE = new Map([
  ["js", ["javascript"]],
  ["javascript", ["js"]],
  ["ts", ["typescript"]],
  ["typescript", ["ts"]],
  ["tsx", ["typescript"]],
  ["jsx", ["javascript"]],
  ["a11y", ["accessibility"]],
  ["accessibility", ["a11y"]],
  ["rn", ["react-native"]],
  ["react-native", ["rn"]],
  ["css", ["stylesheet"]],
  ["stylesheet", ["css"]],
]);

/**
 * Atlas tokenizer (atlas-tokenizer/v1). Deliberately NOT the knowledge tokenizer, which stems and drops
 * length-1 tokens: the existing tokenizer maps js->[] , ts->[] , css->["cs"], silently returning nothing
 * for the three highest-frequency queries a UI asset registry receives. This one lowercases, splits on a
 * character class that keeps +, #, ., /, - inside a token, does NO stemming, keeps 1-char tokens, dedupes,
 * then expands through the frozen synonym table.
 */
export function tokenize(text) {
  const raw = String(text ?? "").toLowerCase().split(/[^a-z0-9+#._/-]+/).filter(Boolean);
  const seen = new Set();
  const tokens = [];
  for (const token of raw) {
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
    for (const synonym of SYNONYM_TABLE.get(token) ?? []) {
      if (!seen.has(synonym)) {
        seen.add(synonym);
        tokens.push(synonym);
      }
    }
  }
  return tokens;
}

const MATURITY_ORDER = Object.freeze(["discovered", "extracted", "vetted", "proven", "certified"]);
const ACCESSIBILITY_ORDER = Object.freeze(["unknown", "A", "AA", "AAA"]);

function ordinal(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? -1 : index;
}

/**
 * Hard-constraint filter, applied BEFORE any scoring so a scored-but-infeasible candidate never reaches
 * the agent. Returns the surviving assets and per-reason exclusion COUNTS (never id lists — those are
 * pure token cost at this rung). Every predicate here is exact, not lexical.
 */
export function filterAssets(assets, constraints, consumerDependencies = null) {
  const excluded = { kind: 0, framework: 0, language: 0, mobile: 0, accessibility: 0, maturity: 0, license: 0, deps: 0, deprecated: 0 };
  const kinds = constraints.kind && constraints.kind.length ? new Set(constraints.kind) : null;
  const languages = constraints.language && constraints.language.length ? new Set(constraints.language) : null;
  const allowlist = constraints.licenseAllowlist && constraints.licenseAllowlist.length ? new Set(constraints.licenseAllowlist) : null;
  const consumerDeps = consumerDependencies ? new Set(consumerDependencies) : null;
  const survivors = [];
  for (const asset of assets) {
    const card = asset.card;
    // deprecated is always excluded; no flag overrides it.
    if (card.maturity === "deprecated") {
      excluded.deprecated += 1;
      continue;
    }
    if (kinds && !kinds.has(card.kind)) {
      excluded.kind += 1;
      continue;
    }
    if (constraints.framework && card.framework !== constraints.framework) {
      excluded.framework += 1;
      continue;
    }
    if (languages && !languages.has(asset.implementation.language)) {
      excluded.language += 1;
      continue;
    }
    if (constraints.mobile && card.mobile !== constraints.mobile) {
      excluded.mobile += 1;
      continue;
    }
    if (constraints.accessibility && ordinal(ACCESSIBILITY_ORDER, card.a11y) < ordinal(ACCESSIBILITY_ORDER, constraints.accessibility)) {
      excluded.accessibility += 1;
      continue;
    }
    if (constraints.maturityFloor && ordinal(MATURITY_ORDER, card.maturity) < ordinal(MATURITY_ORDER, constraints.maturityFloor)) {
      excluded.maturity += 1;
      continue;
    }
    if (allowlist && !allowlist.has(asset.source.license.identifier)) {
      excluded.license += 1;
      continue;
    }
    if (consumerDeps) {
      const names = asset.implementation.dependencies.map((dependency) => dependency.name);
      if (names.some((name) => !consumerDeps.has(name))) {
        excluded.deps += 1;
        continue;
      }
    }
    survivors.push(asset);
  }
  return { survivors, excluded };
}

/**
 * Score an asset over its STORED CARD plus a few intent fields — never the full document. Returns the
 * numeric score and the top three contributing signals for the `why` row.
 */
export function scoreAsset(asset, queryTokens) {
  const card = asset.card;
  const fields = [
    { name: "title", weight: ATLAS_RANKER.weights.title, tokens: tokenize(card.title) },
    { name: "userJob", weight: ATLAS_RANKER.weights.userJob, tokens: tokenize(asset.intent.userJob) },
    { name: "tag", weight: ATLAS_RANKER.weights.tag, tokens: new Set(card.tags.flatMap((tag) => tokenize(tag))) },
    { name: "supportedDomain", weight: ATLAS_RANKER.weights.supportedDomain, tokens: new Set(asset.intent.supportedDomains.flatMap((domain) => tokenize(domain))) },
    { name: "artifactKind", weight: ATLAS_RANKER.weights.artifactKind, tokens: new Set(asset.intent.artifactKinds.flatMap((kind) => tokenize(kind))) },
    { name: "alias", weight: ATLAS_RANKER.weights.alias, tokens: new Set(asset.intent.aliases.flatMap((alias) => tokenize(alias))) },
  ].map((field) => ({ ...field, tokens: field.tokens instanceof Set ? field.tokens : new Set(field.tokens) }));

  const signals = [];
  let lexical = 0;
  for (const token of queryTokens) {
    let best = null;
    for (const field of fields) {
      if (field.tokens.has(token) && (best === null || field.weight > best.weight)) best = field;
    }
    if (best) {
      lexical += best.weight;
      signals.push({ signal: `${best.name}:${token}`, weight: best.weight });
    }
  }
  if (lexical === 0) {
    return { score: 0, why: [] };
  }
  const maturityBonus = ATLAS_RANKER.maturityBonus[card.maturity] ?? 0;
  const dependencyPenalty = Math.min(card.deps * ATLAS_RANKER.dependencyPenalty, ATLAS_RANKER.dependencyPenaltyCap);
  const score = lexical + maturityBonus - dependencyPenalty;
  const why = signals
    .sort((left, right) => right.weight - left.weight || compareCodeUnits(left.signal, right.signal))
    .slice(0, 3)
    .map((entry) => entry.signal);
  if (maturityBonus > 0 && why.length < 3) why.push(`maturity:${card.maturity}`);
  return { score, why };
}

/**
 * Score a flow over its card only. Flows are few and have no dependency penalty.
 */
export function scoreFlow(flow, queryTokens) {
  const card = flow.card;
  const fields = [
    { name: "title", weight: ATLAS_RANKER.weights.title, tokens: new Set(tokenize(card.title)) },
    { name: "role", weight: ATLAS_RANKER.weights.userJob, tokens: new Set(tokenize(card.role)) },
    { name: "userJob", weight: ATLAS_RANKER.weights.tag, tokens: new Set(tokenize(flow.user.primaryJob)) },
  ];
  const signals = [];
  let lexical = 0;
  for (const token of queryTokens) {
    let best = null;
    for (const field of fields) {
      if (field.tokens.has(token) && (best === null || field.weight > best.weight)) best = field;
    }
    if (best) {
      lexical += best.weight;
      signals.push({ signal: `${best.name}:${token}`, weight: best.weight });
    }
  }
  if (lexical === 0) return { score: 0, why: [] };
  const maturityBonus = ATLAS_RANKER.maturityBonus[card.maturity] ?? 0;
  const why = signals
    .sort((left, right) => right.weight - left.weight || compareCodeUnits(left.signal, right.signal))
    .slice(0, 3)
    .map((entry) => entry.signal);
  return { score: lexical + maturityBonus, why };
}

export { canonical as rankerCanonical, sha256 as rankerSha256 };
