# NodeKit / Node Platform

NodeKit is the figured-out product foundation and conformance layer for proof-carrying agent applications. It turns an empty directory or existing repository into a domain-blank application with one guided lifecycle, a compiled definition, deterministic fixtures, browser proof, and receipts.

> Blank in domain. Figured out in behavior. Convex-first, not Convex-locked.

## Current status

- **Closed locally:** domain-blank factory; portable Caseflow; PostgreSQL adapter; Convex component
  and installed-package runtime; Supabase local managed profile; browser proof-bundle
  download/reopen verification; recursive evidence verification; and the EvoGraph-R1-inspired
  Knowledge Evolution and Evolution Ledger mechanics.
- **Open locally:** complete integration review, run the full repository suite, freeze one immutable
  candidate, and regenerate its package/browser receipts. This README does not claim the current
  mutable working tree is fully green.
- **Open externally:** exactly 60 candidate-bound timing runs, 15 real fresh-agent v2 runs, five
  consented humans, three authenticated Convex consumers, an isolated preview, live Supabase proof,
  real Knowledge Evolution adoption, final independent ProofLoop, and publication approval.

Current certification verdict: **`EASE_NOT_CERTIFIED` - DO NOT SUBMIT**.

The detached-signature trust model, verifier ownership rules, and signing handoff are documented in
[`docs/ATTESTATIONS.md`](https://github.com/HomenShum/node-platform/blob/main/docs/ATTESTATIONS.md). A local maintainer-generated signature is not an
independent external gate attestation.

Node Platform remains its ownership layer: it records which repository owns each shared contract and fails CI when a new fork or clear layer violation appears.

## From a brief to a running app

Clone this repository, open it in Codex or Claude Code, and describe the pain point, user, outcome, sponsor tools, and deadline. Root `AGENTS.md` and `CLAUDE.md` route that brief into the bundled NodeKit launch skill.

Or use the CLI directly:

```bash
node src/cli.mjs create ../my-agent-app \
  --name my-agent-app \
  --brief "Carry one user intention to a reviewed and verified artifact" \
  --package-manager pnpm \
  --local-proof

cd ../my-agent-app
pnpm demo
pnpm eval
pnpm dev
```

The primary creation path has no preset and no silent domain default. It generates the stable product grammar:

```text
Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
```

The generated app includes `docs/FIGURED_OUT.md`, a product brief, audience placeholder, user journey, service blueprint, experience contract, design direction, taste contract, a responsive artifact-first UI, and a deterministic in-memory conformance demo.

There is no domain chooser, public preset catalog, or silent fallback. Narrow examples in this source repository are regression fixtures and historical demonstrations only: they are not shipped in the npm package and cannot be selected by the creation CLI. The coding agent starts from the same blank foundation every time, researches the user's actual workflow, and adds only the domain behavior that job requires.

`pnpm proof` works before credentials exist in the pnpm quickstart: it emits a passing `local-ready`
receipt after the deterministic demo and evaluation. If live Pi, browser, or deployment receipts
are present, every attempted gate must pass; the receipt becomes `release-ready` only when all three
are present and green. That generated-application status is not NodeKit Ease certification or Convex
submission authorization. Use the equivalent script command for the package manager selected at creation.

Every created or adopted repository receives the same three coding-agent skills
under both `.claude/skills/` and `.codex/skills/`:

- `nodekit-launch` turns the brief into the smallest proof-carrying vertical slice;
- `nodekit-qa` verifies the rendered journey, runtime, durable artifact, and receipt;
- `nodekit-present` turns the same revision-bound evidence into an editable change,
  judge, or release presentation through an available NodeSlide transport.

Adoption never overwrites a user-owned skill with the same path; the collision is
preserved in `proof/adoption-receipt.json` for explicit review.

## Commands

From this repository:

```bash
npm install
npm run doctor
npm test
npm run ecosystem:check
npm run dashboard
```

By default, `nodekit create` vendors the exact compile/check runtime that generated
the project under `vendor/nodekit` and records `file:vendor/nodekit` in
`package.json`. This keeps a fresh clone installable and prevents a later
GitHub branch change from silently changing compile or proof semantics. Pass
`--nodekit-specifier <exact-specifier>` only when an externally versioned
package or immutable Git commit should replace the vendored runtime. The
bundle is deliberately runtime-only; use the source repository or a future
published package to scaffold additional projects.

The domain-blank base has an executable empty-directory gate:

```bash
npm run acceptance:factory
```

It creates a clean temporary base application, installs dependencies, compiles it, runs tests, the deterministic guided journey, stale-proposal evaluation, the structural live HTTP/DOM contract, and a real Playwright journey. Phase-level timers and candidate-bound screenshot sidecars are written under `proof/ease/latest/`; the fail-closed summary remains `proof/factory-acceptance.json`. A passing core browser journey is not Ease certification while required states, fresh-agent trials, human usability, deployment, and real consumers remain open.

After freezing a clean candidate, the local engineering gate is one explicit preflight followed by
one exact proof command:

```bash
npm run candidate:check
npm run candidate:prove -- --candidate <40-character-commit> --source-hash <64-character-sha256>
```

`candidate:prove` records repository and component tests, both public type checks, the component
build, production dependency audit, registry/ecosystem checks, Evolution Ledger verification, exact
package/archive installation, and the generated app's structural live HTTP browser contract. It
writes ten candidate-bound check receipts, a zero-P0/P1 issue inventory, and
`proof/engineering-health-verdict.json`. This is a local engineering verdict only. It does not run
the rendered screenshot matrix, hosted timing or agent/human studies, deploy, publish, authorize a
Convex submission, or claim external certification.

The consolidated strategy, evidence-backed status, Harness Gym roadmap, and ordered checklist are in
[`docs/NODEKIT_MASTER_PLAN.md`](https://github.com/HomenShum/node-platform/blob/main/docs/NODEKIT_MASTER_PLAN.md). The complete submission lock,
cross-platform workflow, fresh-agent protocol, and uncoached human-study thresholds are documented
in [`docs/EASE_PROOF.md`](https://github.com/HomenShum/node-platform/blob/main/docs/EASE_PROOF.md). The cross-platform workflow is manual so a reviewer
can deliberately label a run cold or warm; one matrix run is evidence, not a percentile claim.
The five-person study now has a privacy-safe append-only operator (`npm run ease:human-study --
help`) and exact runbook in [`docs/FRESH_HUMAN_USABILITY_STUDY.md`](https://github.com/HomenShum/node-platform/blob/main/docs/FRESH_HUMAN_USABILITY_STUDY.md).
That collector does not create participants or close the still-external 0/5 human gate.

The adopted evidence-driven model profiling, executable skill, and capability-routing architecture
is in [`docs/MODEL_INTELLIGENCE.md`](https://github.com/HomenShum/node-platform/blob/main/docs/MODEL_INTELLIGENCE.md). Its implemented P0 commands do not
make provider calls or certify routing from an empty evidence set.

Factory commands (a `--local-proof` run creates an initial local Git commit so
receipts have an immutable candidate to bind to):

```bash
nodekit create <empty-directory> --name <slug> --brief <text>
nodekit adopt <existing-directory> --name <slug> --brief <text>
nodekit compile --repo-root <directory>
nodekit inspect --repo-root <directory>
nodekit graph import --repo-root <directory> --commit <sha>
nodekit graph init --repo-root <directory>
nodekit graph query <terms> --repo-root <directory>
nodekit graph gaps --repo-root <directory>
nodekit graph harness-sync --repo-root <directory>
nodekit harness init --repo-root <directory>
nodekit models baseline --repo-root <directory>
nodekit models profile --repo-root <directory>
nodekit models inspect --repo-root <directory>
nodekit models diagnose --repo-root <directory>
```

Runtime consumers use `@homenshum/nodekit/knowledge-runtime` for accepted-canonical traversal,
Caseflow-bound context packs, durable retrieval receipts, and safe abstention. PostgreSQL-backed
applications use `@homenshum/nodekit/adapters/postgres/knowledge` with the exported
`knowledge-migration.sql`. See
[`docs/KNOWLEDGE_EVOLUTION.md`](https://github.com/HomenShum/node-platform/blob/main/docs/KNOWLEDGE_EVOLUTION.md)
for the authority boundary and protected comparison contract.

From a generated or adopted repository carrying the vendored runtime:

```bash
pnpm doctor
pnpm demo
pnpm check
pnpm proof
```

Use the package manager selected at creation time; the commands above match the pnpm quickstart.

`@homenshum/nodekit` 0.2.1 is not yet published. Generated projects remain
portable because they carry the exact runtime under `vendor/nodekit`. External
consumers that do not use `nodekit create` should use an immutable Git or
packed-tarball reference until the package is released. The unscoped `nodekit`
npm name belongs to an unrelated project.

The packed package also exposes exact-consumer preparation, resumable managed-evidence capture,
external evidence finalization, and Builder Gym directly:

```bash
nodekit-consumer-prepare --help
nodekit-evidence-capture --help
nodekit-evidence-finalize --help
nodekit harness builder status --repo-root <directory> --json
```

```js
import { NODETRACE_VERDICT_DIMENSIONS, builderGymStatus } from "@homenshum/nodekit/builder-gym";
import { prepareExactConsumerPackage } from "@homenshum/nodekit/consumer-package-preparation";
import { startManagedEvidenceCampaign } from "@homenshum/nodekit/managed-evidence-capture";
import { finalizeSubmissionEvidence } from "@homenshum/nodekit/submission-evidence-finalizer";
```

Consumer preparation is read-only unless `--apply` is supplied. Managed capture binds exact
candidate identity, provider resources, elapsed phases, browser evidence, and cleanup receipts,
but never creates or deletes those resources. Evidence finalization only signs already-measured
evidence with a purpose-scoped external key. None of these commands deploys, publishes, submits,
or certifies adoption. Follow the [managed capture runbook](https://github.com/HomenShum/node-platform/blob/main/docs/MANAGED_EVIDENCE_CAPTURE.md)
for the external operator steps.

## PostgreSQL adapter

NodeKit ships a driver-neutral, owner-scoped PostgreSQL Caseflow adapter. Apply the exported
`@homenshum/nodekit/adapters/postgres/migration.sql` once, then provide a pool compatible with
`pg.Pool`:

```js
import { Pool } from "pg";
import { createPostgresCaseflow } from "@homenshum/nodekit/adapters/postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const caseflow = createPostgresCaseflow({
  pool,
  ownerId: authenticatedPrincipal.id,
});
```

The adapter uses transactions, row locks, advisory sequence locks, owner-scoped queries,
idempotent active-run/decision/completion retries, and conditional artifact-version application.
Run the shared suite against a disposable database with:

```bash
NODEKIT_POSTGRES_URL=postgresql://... npm run conformance:postgres -- --candidate-tarball=proof/ease/latest/nodekit-candidate.tgz --output=proof/postgres-conformance.json
```

The Supabase mapping ships as a core SQL export at
`@homenshum/nodekit/adapters/supabase/profile.sql` plus an opt-in worker module at
`@homenshum/nodekit/adapters/supabase/workers.sql`. The core profile adds authenticated-only
owner reads, a principal-derived proposal RPC, explicit Realtime publication, and owner-folder
Storage policies. The worker module enables a server-only PGMQ queue and pg_cron without exposing
either to browser roles. Checked-in SQL is not a claim that live Supabase Auth, Storage, Realtime,
Queue, or Cron conformance has passed; see [`adapters/supabase/README.md`](adapters/supabase/README.md).

## Contracts

- [`ownership.yaml`](ownership.yaml) names one owner, current package, target package, status, version, and consumers for every governed concept.
- [`repositories.yaml`](repositories.yaml) records lifecycle, support state, role, successor, and command profile.
- [`architecture.yaml`](architecture.yaml) defines universal commands, allowed reuse modes, and source-layer rules.
- [`schemas/nodekit.schema.json`](schemas/nodekit.schema.json) enforces `nodekit.repo/v1` for each consumer repository's `nodekit.yaml`.
- [`schemas/nodeagent.application.v1.schema.json`](schemas/nodeagent.application.v1.schema.json) and [`schemas/nodeagent.pack.v1.schema.json`](schemas/nodeagent.pack.v1.schema.json) enforce the application and capability-pack contracts during compilation.
- [`schemas/nodeagent.event.v1.schema.json`](schemas/nodeagent.event.v1.schema.json) defines the canonical portable event envelope. Applications resolve `nodeagent.event/v1` and `nodeagent.trace/v1` contract references even when an older v1 manifest omits the optional `contracts` block.
- `nodekit compile` discovers authored files, validates pack references, rejects literal secrets, and emits a full application identity in `.nodeagent/`. The identity binds the agent, packs, integrations, backend, UI/app surface, scripts, workflow definitions, evaluations, fixtures, dependency locks, and recognized deployment configuration.
- `nodekit graph import` imports a pinned Understand Anything `knowledge-graph.json` as a namespaced, commit-bound code graph snapshot. `nodekit graph query --code` retrieves from that snapshot; it never turns the code graph into a write authority.
- [`docs/UNDERSTAND_ANYTHING_CODE_GRAPH.md`](https://github.com/HomenShum/node-platform/blob/main/docs/UNDERSTAND_ANYTHING_CODE_GRAPH.md) defines the graph authority, privacy, freshness, and NodeGraph/NodeRoom projection boundary.
- [`docs/KNOWLEDGE_EVOLUTION.md`](https://github.com/HomenShum/node-platform/blob/main/docs/KNOWLEDGE_EVOLUTION.md) defines the EvoGraph-R1-inspired, backend-neutral Knowledge Evolution Plane: immutable multimodal evidence, n-ary hyperedges, typed gaps, proposal-only graph mutations, explicit approval, stale-version conflicts, replay, receipts, Harness Gym projection, and evaluation boundaries.
- [`docs/FRONTEND_SPECIALIST.md`](https://github.com/HomenShum/node-platform/blob/main/docs/FRONTEND_SPECIALIST.md) defines the evidence-ranked frontend route, protected product packet, mandatory three-direction tournament, bounded repair, and fresh-user canary.
- [`docs/EVOLUTION_LEDGER.md`](https://github.com/HomenShum/node-platform/blob/main/docs/EVOLUTION_LEDGER.md) defines the permanent reasoning ledger from limitation and failed assumption through invariant, immutable evidence, verifier, and verified downstream adoption.
- `nodekit create` refuses non-empty targets. `nodekit adopt` writes missing files only, preserves host scripts, and emits a collision receipt.
- `nodekit repo check` validates ownership declarations, command aliases, migration origins, signature classification, and source rules.
- `nodekit ecosystem check` checks all active local clones together.
- `nodekit dashboard` generates the cross-repository status table.

## Frozen v1 manifest dialect

The three public v1 manifests use one flat, fail-closed shape:

```yaml
schemaVersion: nodekit.repo/v1 # or nodeagent.application/v1 / nodeagent.pack/v1
```

The earlier planning-only `apiVersion` / `kind` / `metadata` / `spec` envelope is not another accepted v1 dialect. Repository checks and application compilation reject that shape with a migration-oriented error. Existing `nodeagent.application/v1` manifests that predate the optional `contracts` block remain compatible; the compiler resolves their event and trace references to the canonical v1 values.

## Honest boundary

`planned`, `implemented`, `previously proven`, `current-candidate proven`, and `published` are
intentionally different claims. NodeKit has a domain-blank base, portable memory semantics, an
implemented PostgreSQL adapter with an earlier-revision PostgreSQL 17.10 live receipt, and a locally
tested installable Convex Caseflow component. It also has the Supabase local profile and proof
mechanics for exact browser export/reopen and recursive evidence verification.

None of those facts proves the mutable working tree is the final candidate. Three real authenticated
Convex consumers, final-candidate timing and agent matrices, five real humans, live Supabase, an
isolated deployed preview, real Knowledge Evolution adoption, and independent final verification
remain separate evidence gates. See [`docs/REMAINING_GAPS.md`](https://github.com/HomenShum/node-platform/blob/main/docs/REMAINING_GAPS.md).

See [`docs/DECISIONS.md`](https://github.com/HomenShum/node-platform/blob/main/docs/DECISIONS.md) for the ownership split and migration rules.
The coordinated consumer commits, pull requests, hosted checks, and known limits are recorded in [`docs/P0_ROLLOUT.md`](https://github.com/HomenShum/node-platform/blob/main/docs/P0_ROLLOUT.md) and [`proof/p0-rollout.json`](https://github.com/HomenShum/node-platform/blob/main/proof/p0-rollout.json).
The overnight Casca/Agentic-RL delivery and morning adversarial-review sequence is in [`docs/NODEKIT_ULTRA_V1_HANDOFF.md`](https://github.com/HomenShum/node-platform/blob/main/docs/NODEKIT_ULTRA_V1_HANDOFF.md).
