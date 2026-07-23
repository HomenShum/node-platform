// Atlas hard-negative benchmark (relevance v1). v0 showed the fielded ranker at
// parity on an easy corpus where even a perfect ranker could not clear the +15%
// NDCG gate; that gate is retired here. This asks the sharper question the design
// consult specified: for a query, does the ranker place the positive asset ABOVE a
// deliberately confusable SAME-FAMILY negative? The competitor is a STRUCTURED,
// field-weighted baseline (not flat substring), so the fielded ranker must beat a
// fair opponent. Decision rule: the fielded ranker must beat the structured
// baseline by >= 10 percentage points in hard-negative pairwise accuracy, or it
// leaves the production path and only the compaction ladder remains. Deterministic,
// no network. Reads atlas/benchmarks/relevance-v1.json (which extends v0's corpus).

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";
import { addAtlasAsset, initializeAtlasStore } from "../src/lib/atlas.mjs";
import { atlasSearch } from "../src/lib/atlas-retrieval.mjs";

const OBSERVED_AT = "2026-07-22T00:00:00.000Z";
const GATE_DELTA_PP = 10; // percentage points the ranker must beat the structured baseline by

function fullDraft(entry) {
  return {
    kind: entry.draft.kind, title: entry.draft.title, summary: entry.draft.summary,
    intent: entry.draft.intent,
    source: {
      origin: "uiverse", reuseMode: "copy",
      upstreamUrl: `https://uiverse.io/components/${entry.slug}`, observedAt: OBSERVED_AT,
      license: { identifier: "MIT", attributionRequired: false, redistributable: true },
    },
    implementation: {
      framework: "react", language: "tsx",
      exports: [{ name: "Component", exportKind: "component" }],
      dependencies: [], propSchema: { type: "object" }, tokenContract: {},
    },
    behavior: {
      ...entry.draft.behavior,
      states: [...new Set([...(entry.draft.behavior.states ?? []), ...(entry.draft.intent.productStages ?? [])])],
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: [],
  };
}

// Structured, field-weighted baseline. Field-aware (unlike flat substring) but naive
// (no ontology, no proximity, no phrase, no trigram) — a fair competitor to the ranker.
const FIELD_WEIGHTS = { title: 3, userJob: 3, aliases: 2, artifactKinds: 2, summary: 1, states: 1 };
function structuredScore(query, asset) {
  const terms = query.terms.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const fields = {
    title: asset.draft.title,
    userJob: asset.draft.intent.userJob,
    aliases: (asset.draft.intent.aliases ?? []).join(" "),
    artifactKinds: (asset.draft.intent.artifactKinds ?? []).join(" "),
    summary: asset.draft.summary,
    states: (asset.draft.behavior.states ?? []).join(" "),
  };
  let score = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const hay = String(fields[field] ?? "").toLowerCase();
    for (const term of terms) if (hay.includes(term)) score += weight;
  }
  return score;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pctPts = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const benchDir = path.join(repoRoot, "atlas", "benchmarks");
  const v1 = JSON.parse(await readFile(path.join(benchDir, "relevance-v1.json"), "utf8"));
  const v0 = JSON.parse(await readFile(path.join(benchDir, v1.extendsCorpus), "utf8"));
  const corpus = [...v0.corpus, ...v1.additionalCorpus];
  const bySlug = new Map(corpus.map((e) => [e.slug, e]));

  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-hardneg-"));
  try {
    await mkdir(path.join(root, "drafts"), { recursive: true });
    await mkdir(path.join(root, "vendor"), { recursive: true });
    await initializeAtlasStore(root);
    const slugToId = new Map();
    const idToSlug = new Map();
    for (const entry of corpus) {
      const draftRel = path.posix.join("drafts", `${entry.slug}.yaml`);
      await writeFile(path.join(root, "drafts", `${entry.slug}.yaml`), stringifyYaml(fullDraft(entry)), "utf8");
      const vendorRel = path.posix.join("vendor", `${entry.slug}.tsx`);
      await writeFile(path.join(root, vendorRel), `export function Component() { return null; } // ${entry.slug}\n`, "utf8");
      const obsRel = path.posix.join("vendor", `${entry.slug}.html`);
      await writeFile(path.join(root, obsRel), `<main>${entry.draft.summary}</main>\n`, "utf8");
      const added = await addAtlasAsset(root, { assetFile: draftRel, observationFile: obsRel, vendorFile: vendorRel });
      slugToId.set(entry.slug, added.asset.assetId);
      idToSlug.set(added.asset.assetId, entry.slug);
    }

    const familyOf = (slug) => Object.entries(v1.families).find(([, members]) => members.includes(slug));

    // Build hard-negative triplets and score both systems.
    const triplets = [];
    for (const query of v1.queries) {
      const fam = familyOf(query.positive);
      if (!fam) continue;
      const [familyName, members] = fam;
      const negatives = members.filter((s) => s !== query.positive && !(query.acceptable ?? []).includes(s));
      // Ranker scores for this query, unbudgeted so every asset's score is available.
      const result = await atlasSearch(root, { terms: query.terms, target: "asset", limit: 50, maxBytes: 5_000_000 });
      const rankerScore = new Map();
      for (const row of result.assets) rankerScore.set(idToSlug.get(row.a), row.s);
      const rScore = (slug) => rankerScore.get(slug) ?? 0;
      const posAsset = bySlug.get(query.positive);
      for (const negSlug of negatives) {
        const negAsset = bySlug.get(negSlug);
        triplets.push({
          query: query.id, family: familyName, positive: query.positive, negative: negSlug,
          rankerCorrect: rScore(query.positive) > rScore(negSlug),
          baselineCorrect: structuredScore(query, posAsset) > structuredScore(query, negAsset),
        });
      }
    }

    const rankerAcc = mean(triplets.map((t) => (t.rankerCorrect ? 1 : 0)));
    const baseAcc = mean(triplets.map((t) => (t.baselineCorrect ? 1 : 0)));
    const deltaPp = rankerAcc - baseAcc;

    console.log("Atlas hard-negative benchmark v1");
    console.log(`${corpus.length} assets (${v0.corpus.length} base + ${v1.additionalCorpus.length} confusable siblings), ${v1.queries.length} queries, ${triplets.length} hard-negative triplets\n`);
    // Per-family breakdown.
    const families = [...new Set(triplets.map((t) => t.family))];
    console.log("family              triplets  ranker  baseline");
    for (const fam of families) {
      const ts = triplets.filter((t) => t.family === fam);
      const r = mean(ts.map((t) => (t.rankerCorrect ? 1 : 0)));
      const b = mean(ts.map((t) => (t.baselineCorrect ? 1 : 0)));
      console.log(`${fam.padEnd(19)} ${String(ts.length).padStart(5)}    ${pctPts(r).padStart(6)}  ${pctPts(b).padStart(6)}`);
    }
    console.log("");
    console.log(`hard-negative pairwise accuracy   ranker ${pctPts(rankerAcc)}   structured baseline ${pctPts(baseAcc)}`);
    console.log(`delta ${(deltaPp * 100).toFixed(1)} percentage points (gate: ranker must beat baseline by >= ${GATE_DELTA_PP} pp)\n`);

    const passed = deltaPp * 100 >= GATE_DELTA_PP;
    console.log(passed
      ? `VERDICT: INVEST — the fielded ranker beats the structured baseline by ${(deltaPp * 100).toFixed(1)} pp and stays on the production path.`
      : `VERDICT: ABANDON the fielded ranker — it beats the structured baseline by only ${(deltaPp * 100).toFixed(1)} pp (< ${GATE_DELTA_PP} pp). Keep the compaction ladder; drop fielded scoring from the production path or replace it.`);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

main().catch((error) => { console.error(error?.stack ?? String(error)); process.exitCode = 2; });
