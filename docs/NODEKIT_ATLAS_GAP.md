# NodeKit Atlas — implementation gap and build order

Status date: 2026-07-22

Source of the specification: the `NodeKit` ChatGPT thread, final assistant turn ("NodeKit Atlas",
13 sections), plus its two predecessor turns ("Experience Fabric", "Experience Pattern Distillery").
That specification is **design input only**. Nothing in it is evidence, and no section below is
treated as implemented without a path in this repository.

## Governing constraint

Homen's stated sequencing (2026-07-22): build NodeKit core first, then make Atlas genuinely easy
for a coding agent to operate, and only then build `NK - yC S26` and `NK - Mom's Biz AI`.

Atlas's claimed value is **reduced continuous token and time cost for the coding agent**. That
value is delivered by the agent-facing surface (IR, CLI, MCP, progressive retrieval), not by the
human-facing gallery. The build order below reflects that, not the specification's section order.

## Section-by-section diff

Legend: **BUILT** = code + schema + CLI + ledger entry · **SUBSTRATE** = a general mechanism exists
that Atlas can sit on, but no Atlas-specific type · **SPEC-ONLY** = defined in the thread, absent
here · **ABSENT** = neither.

| # | Atlas section | Status | Evidence in repo | Gap |
|---|---|---|---|---|
| 1 | Build NodeKit Atlas (the registry) | **ABSENT** | `src/lib/registry.mjs` + `repositories.yaml` + `nodekit registry check` are a **repository** registry, not an experience-asset registry | Name collision: `nodekit registry` is taken. Atlas needs its own verb. |
| 2 | Compact Experience IR | **SPEC-ONLY** | Nearest kin: `schemas/nodekit.product-design-contract.v1`, `schemas/nodekit.knowledge-graph.v1` | No `nodekit.experience-asset.v1` or `nodekit.interaction-flow.v1` schema exists |
| 3 | Normalize every source into one contract | **SUBSTRATE** | `src/lib/evidence-snapshots.mjs`, `src/lib/research-collector.mjs`, `schemas/nodekit.evidence-snapshot.v1` already do exact URI/time/raw-byte SHA provenance and content-addressed storage | Missing the asset taxonomy on top: `kind`, `reuseMode`, `license`, `maturity` |
| 4 | Do not expose everything indiscriminately | **SUBSTRATE** | `nodekit graph research` already enforces `--max-searches/--max-results/--max-fetches/--max-bytes-per-fetch/--max-total-bytes/--max-duration-ms` | Bounded *fetching* exists; the four source modes (reference-only / remote registry / vendored permissive / compiled recipe) do not |
| 5 | Progressive retrieval (4 stages) | **SUBSTRATE** | `src/lib/knowledge-context.mjs` + `schemas/nodekit.knowledge-context-pack.v1` + `nodekit graph query` give canonical-only context packs | One-shot retrieval only. The candidates → preview/compare → recipe → delta-repair ladder does not exist. **This is the actual token-cost lever.** |
| 6 | Compile prompts from selected surface | **SUBSTRATE** | `nodekit frontend plan --contract` compiles a plan from a product-design contract | Compiles from a contract, not from a selected asset set |
| 7 | Swappable assets through ports | **PARTIAL** | Backend ports are real: `adapters/postgres`, `adapters/supabase`, `src/adapters/*`, filesystem/Convex runtimes | No UI/experience ports. Grep for `requiredPorts` / `viewModel` across `src/` and `schemas/` returns nothing. |
| 8 | Three application directions (NodeSlide-style) | **BUILT** | `nodekit frontend directions`, `schemas/nodekit.frontend-direction-set.v1`, `schemas/nodekit.tournament.v1`, `evaluateFrontendTournament` in `src/lib/frontend-specialist.mjs`, `docs/FRONTEND_SPECIALIST.md`, ledger `inv-major-frontend-direction-tournament` + `adp-nodekit-frontend-tournament` | None. Three archetypes and six required render states are already mandated. |
| 9 | Human-facing Atlas Studio (`/__nodekit/assets`) | **ABSENT** | `nodekit dashboard` exists but is a proof dashboard | Deliberately deferred — see "Do not build Studio early" below |
| 10 | Agent-facing CLI | **ABSENT** | 18 top-level verbs exist; zero are `assets`, `flows`, `experience`, or `atlas` | `nodekit assets search\|inspect\|add`, `nodekit flows search`, `nodekit flow record\|compile`, `nodekit experience compose\|bootstrap` |
| 11 | Agent-facing MCP | **ABSENT** | Only MCP mention in `src/` is incidental (`src/lib/official-pricing-proof.mjs`) | `nodekit atlas serve --mcp` and its ten tools. **Largest single gap for Claude Code ergonomics.** |
| 12 | Same engine across application classes | **BUILT** | `templates/base/`, `reference-apps/`, domain-blank factory, ledger `inv-domain-blank-create` + `adp-nodekit-domain-blank` | None |
| 13 | Distill later builds back into Atlas | **SUBSTRATE** | Evolution Ledger is fully built: `evolution/{events,evidence,invariants,adoptions,assumptions}`, `nodekit evolution record\|verify\|materiality\|diff`, `schemas/nodekit.evolution-*.v1`; `src/lib/harness-gym.mjs` (1361 lines) runs candidate → benchmark → canary → promote | No `nodekit.experience-build.v1` receipt type. The loop machinery exists; the experience-specific record does not. |

### Already closed by the ledger

The NodeVideo teardown from that thread is not an open item — it is recorded:

- `evolution/events/harness/evt-nodevideo-topology-contract.json`
- `evolution/evidence/evd-nodevideo-topology-failure.json`

## Scorecard

- **BUILT: 2/13** (§8 direction tournament, §12 domain-blank engine)
- **SUBSTRATE: 5/13** (§3, §4, §5, §6, §13) — real mechanisms, wrong shape for Atlas
- **PARTIAL: 1/13** (§7 — backend ports yes, experience ports no)
- **ABSENT / SPEC-ONLY: 5/13** (§1, §2, §9, §10, §11)

The encouraging read: nothing in Atlas requires new *infrastructure*. Content-addressed evidence,
bounded collection, governed proposal/approval, tournament evaluation, and the ledger all exist.
Atlas is largely a **new typed layer over machinery that already works**, plus two genuinely new
surfaces (CLI verbs and MCP).

## Build order for "easy for Claude Code"

Ordered by unblocking value to the coding agent, not by specification section number.

1. **§2 Experience IR** — `nodekit.experience-asset.v1` and `nodekit.interaction-flow.v1` schemas.
   Nothing else can be typed until these exist. Follow the existing schema conventions in
   `schemas/`; reuse `contentHash` semantics from `nodekit.evidence-snapshot.v1`.
2. **§1 + §3 Atlas store** — a `nodekit atlas` verb (not `registry`, which is taken) writing
   content-addressed assets through the existing evidence-snapshot path. Add `kind`, `reuseMode`,
   `license`, `maturity` on top.
3. **§10 Agent CLI** — `atlas search` / `atlas inspect` / `atlas add`, all `--json` by default.
   Match the flag conventions already used by `nodekit graph query`.
4. **§5 Progressive retrieval** — the four-stage ladder. This is where the token savings are
   actually realized; steps 1–3 only make it expressible.
5. **§11 MCP server** — `nodekit atlas serve --mcp`. Once §5 exists, this is a thin transport over
   it, and it is what lets me work Atlas without shelling out per query.
6. **§7 Experience ports + §6 prompt compilation** — makes assets swappable rather than merely
   findable.
7. **§13 `ExperienceBuildReceipt`** — closes the loop into the existing ledger.
8. **§9 Atlas Studio** — last.

### Do not build Studio early

Section 9 proposes a human-facing gallery. The same thread's earlier turn classified
`proof-dashboard-as-primary-product` as a named failure mode, and this repo already has a
`nodekit dashboard`. Building a second gallery before the agent surface works would repeat the
exact failure that motivated Atlas.

## Blocking dependency

`ExperienceBuildReceipt` (§13) binds to `candidateCommit` and `productContractHash`. That is the
same identity rule enforced by `docs/EASE_SUBMISSION_READINESS.md`. Atlas cannot emit a valid
receipt against a dirty working tree, so §13 sits behind the candidate freeze in
`docs/REMAINING_GAPS.md`. Sections 1–12 do not — they can proceed now.
