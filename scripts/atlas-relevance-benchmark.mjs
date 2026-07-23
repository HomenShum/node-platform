// Atlas relevance benchmark: does the fielded ranker beat a naive substring
// baseline on an agent-phrased query set? Prints NDCG@5 and MRR for both and
// applies the kill gate the Atlas design set for itself: the ranker earns the
// right to replace substring search only if NDCG@5 improves by >= 15%, MRR does
// not regress, and every stage-1 response stays within the 6,144-byte budget.
// Otherwise the honest conclusion is that Atlas search does not yet replace the
// existing path. Deterministic, no network, reads atlas/benchmarks/relevance-v0.json.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import { addAtlasAsset, initializeAtlasStore } from "../src/lib/atlas.mjs";
import { atlasSearch } from "../src/lib/atlas-retrieval.mjs";

const execFileAsync = promisify(execFile);
const OBSERVED_AT = "2026-07-22T00:00:00.000Z";
const GATE_NDCG_IMPROVEMENT = 0.15;
const STAGE1_BUDGET_BYTES = 6144;

function fullDraft(entry) {
  // The benchmark data carries only the fields ranking keys on; fill the rest
  // with a neutral copy-mode react implementation so the record validates and
  // the --framework/--language filters are exercisable. Ranking quality is
  // independent of these.
  return {
    kind: entry.draft.kind,
    title: entry.draft.title,
    summary: entry.draft.summary,
    intent: entry.draft.intent,
    source: {
      origin: "uiverse",
      reuseMode: "copy",
      upstreamUrl: `https://uiverse.io/components/${entry.slug}`,
      observedAt: OBSERVED_AT,
      license: { identifier: "MIT", attributionRequired: false, redistributable: true },
    },
    implementation: {
      framework: "react",
      language: "tsx",
      exports: [{ name: "Component", exportKind: "component" }],
      dependencies: [],
      propSchema: { type: "object" },
      tokenContract: {},
    },
    behavior: {
      ...entry.draft.behavior,
      // The schema requires states to cover productStages; guarantee it here so the
      // benchmark data can list them independently without tripping the invariant.
      states: [...new Set([...(entry.draft.behavior.states ?? []), ...(entry.draft.intent.productStages ?? [])])],
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: [],
  };
}

// Naive baseline: rank assets by the number of query terms that appear as a
// case-insensitive substring anywhere in the asset's searchable text. Same
// tiebreak as the ranker (ascending assetId) so the comparison is fair.
function baselineRank(query, assets) {
  const terms = query.terms.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = assets.map((asset) => {
    const haystack = [
      asset.title, asset.summary, asset.intent.userJob,
      ...(asset.intent.aliases ?? []), ...(asset.intent.artifactKinds ?? []),
      ...(asset.intent.supportedDomains ?? []), ...(asset.behavior.states ?? []),
    ].join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) if (haystack.includes(term)) score += 1;
    return { slug: asset.slug, score, assetId: asset.assetId };
  });
  scored.sort((a, b) => b.score - a.score || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  return scored.filter((row) => row.score > 0).map((row) => row.slug);
}

function gainFor(query, slug) {
  if (query.relevant.includes(slug)) return 2;
  if ((query.acceptable ?? []).includes(slug)) return 1;
  return 0;
}

function ndcgAt5(query, rankedSlugs) {
  let dcg = 0;
  for (let i = 0; i < Math.min(5, rankedSlugs.length); i += 1) {
    const gain = gainFor(query, rankedSlugs[i]);
    dcg += gain / Math.log2(i + 2);
  }
  const idealGains = [...query.relevant.map(() => 2), ...(query.acceptable ?? []).map(() => 1)]
    .sort((a, b) => b - a).slice(0, 5);
  let idcg = 0;
  idealGains.forEach((gain, i) => { idcg += gain / Math.log2(i + 2); });
  return idcg === 0 ? 0 : dcg / idcg;
}

function reciprocalRank(query, rankedSlugs) {
  for (let i = 0; i < rankedSlugs.length; i += 1) {
    if (query.relevant.includes(rankedSlugs[i])) return 1 / (i + 1);
  }
  return 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const benchPath = path.join(repoRoot, "atlas", "benchmarks", "relevance-v0.json");
  const bench = JSON.parse(await readFile(benchPath, "utf8"));

  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-relevance-"));
  try {
    await mkdir(path.join(root, "drafts"), { recursive: true });
    await mkdir(path.join(root, "vendor"), { recursive: true });
    await initializeAtlasStore(root);

    const slugToAsset = new Map();
    for (const entry of bench.corpus) {
      const draftRel = path.posix.join("drafts", `${entry.slug}.yaml`);
      await writeFile(path.join(root, "drafts", `${entry.slug}.yaml`), stringifyYaml(fullDraft(entry)), "utf8");
      const vendorRel = path.posix.join("vendor", `${entry.slug}.tsx`);
      await writeFile(path.join(root, vendorRel), `export function Component() { return null; } // ${entry.slug}\n`, "utf8");
      const obsRel = path.posix.join("vendor", `${entry.slug}.html`);
      await writeFile(path.join(root, obsRel), `<main>${entry.draft.summary}</main>\n`, "utf8");
      const added = await addAtlasAsset(root, { assetFile: draftRel, observationFile: obsRel, vendorFile: vendorRel });
      slugToAsset.set(added.asset.assetId, entry.slug);
      entry.assetId = added.asset.assetId;
    }
    // A projection carrying only what the baseline and scorers need, keyed by slug.
    const assetsForBaseline = bench.corpus.map((entry) => ({
      slug: entry.slug, assetId: entry.assetId, title: entry.draft.title,
      summary: entry.draft.summary, intent: entry.draft.intent, behavior: entry.draft.behavior,
    }));

    const rows = [];
    let worstBudget = 0;
    for (const query of bench.queries) {
      const result = await atlasSearch(root, { terms: query.terms, target: "asset" });
      const rankerSlugs = result.assets.map((a) => slugToAsset.get(a.a)).filter(Boolean);
      const baseSlugs = baselineRank(query, assetsForBaseline);
      worstBudget = Math.max(worstBudget, result.budget.responseBytes);
      rows.push({
        id: query.id,
        top: rankerSlugs[0] ?? "(none)",
        want: query.relevant[0],
        rNdcg: ndcgAt5(query, rankerSlugs), bNdcg: ndcgAt5(query, baseSlugs),
        rMrr: reciprocalRank(query, rankerSlugs), bMrr: reciprocalRank(query, baseSlugs),
        bytes: result.budget.responseBytes,
      });
    }

    const rNdcg = mean(rows.map((r) => r.rNdcg));
    const bNdcg = mean(rows.map((r) => r.bNdcg));
    const rMrr = mean(rows.map((r) => r.rMrr));
    const bMrr = mean(rows.map((r) => r.bMrr));
    const improvement = bNdcg === 0 ? Infinity : (rNdcg - bNdcg) / bNdcg;

    console.log("Atlas relevance benchmark v0");
    console.log(`corpus ${bench.corpus.length} assets, ${bench.queries.length} agent-phrased queries\n`);
    console.log("query  top-1 (ranker)        want                  ndcg@5 R/B    mrr R/B     bytes");
    for (const r of rows) {
      console.log(
        `${r.id}   ${r.top.padEnd(21)} ${r.want.padEnd(21)} ` +
        `${r.rNdcg.toFixed(2)}/${r.bNdcg.toFixed(2)}   ${r.rMrr.toFixed(2)}/${r.bMrr.toFixed(2)}   ${r.bytes}`,
      );
    }
    console.log("");
    console.log(`mean NDCG@5   ranker ${rNdcg.toFixed(3)}   baseline ${bNdcg.toFixed(3)}   improvement ${pct(improvement)}`);
    console.log(`mean MRR      ranker ${rMrr.toFixed(3)}   baseline ${bMrr.toFixed(3)}`);
    console.log(`stage-1 worst response ${worstBudget} bytes (budget ${STAGE1_BUDGET_BYTES})`);

    // Self-diagnosis: if the naive baseline is already strong, a +15% RELATIVE gain
    // may be mathematically unreachable (NDCG caps at 1.0). Report the ceiling so the
    // gate result is not misread as "the ranker is bad" when the corpus is simply too
    // easy to separate a fielded ranker from term-counting.
    const maxAchievable = bNdcg === 0 ? Infinity : (1 - bNdcg) / bNdcg;
    console.log(`corpus discrimination: max achievable improvement over this baseline is ${pct(maxAchievable)} (perfect ranker vs baseline ${bNdcg.toFixed(3)})`);
    if (maxAchievable < GATE_NDCG_IMPROVEMENT) {
      console.log(`  -> the +15% gate is UNREACHABLE on this corpus even by a perfect ranker; the corpus needs confusable assets and ambiguous queries to be discriminating.`);
    }

    const gateNdcg = improvement >= GATE_NDCG_IMPROVEMENT;
    const gateMrr = rMrr >= bMrr;
    const gateBudget = worstBudget <= STAGE1_BUDGET_BYTES;
    const passed = gateNdcg && gateMrr && gateBudget;
    console.log("");
    console.log(`gate NDCG@5 >= +15%   ${gateNdcg ? "PASS" : "FAIL"} (${pct(improvement)})`);
    console.log(`gate MRR no regress   ${gateMrr ? "PASS" : "FAIL"}`);
    console.log(`gate stage-1 <= 6144  ${gateBudget ? "PASS" : "FAIL"}`);
    console.log("");
    console.log(passed
      ? "VERDICT: the ranker earns replacement of substring search on this set."
      : "VERDICT: the ranker does NOT clear the bar on this set; substring search is not yet replaced.");
    process.exitCode = passed ? 0 : 1;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

main().catch((error) => { console.error(error?.stack ?? String(error)); process.exitCode = 2; });
