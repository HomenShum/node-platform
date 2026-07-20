# NodeKit / Node Platform

NodeKit is the portable setup and conformance layer for proof-carrying agent applications. It turns an empty directory or an existing repository into a filesystem-authored agent harness with a compiled definition, capability packs, deterministic fixtures, live-provider gates, browser proof, and phase-by-phase receipts.

Node Platform remains its ownership layer: it records which repository owns each shared contract and fails CI when a new fork or clear layer violation appears.

## From a brief to a running app

Clone this repository, open it in Codex or Claude Code, and describe the pain point, user, outcome, sponsor tools, and deadline. Root `AGENTS.md` and `CLAUDE.md` route that brief into the bundled NodeKit launch skill.

Or use the CLI directly:

```bash
node src/cli.mjs create ../my-agent-app \
  --name my-agent-app \
  --brief "A persistent research agent that users can steer mid-run" \
  --sponsors pi-ai,convex \
  --nodekit-specifier file:$(pwd)

cd ../my-agent-app
npm run demo
npm run eval
npm run dev
```

The first certified preset is `research-loop`: a small reference runtime with an objective held-out metric, deterministic keep/revert decisions, versioned human intervention, interrupted-run recovery, a strict Pi smoke, and sanitized reproduction receipts. It is a reference adapter to the NodeAgent application contract; it is not presented as the still-unfinished extraction of NodeRoom's deeper production runtime.

`npm run proof` works before credentials exist: it emits a passing `local-ready` receipt after the deterministic demo and evaluation. If live Pi, browser, or deployment receipts are present, every attempted gate must pass; the receipt becomes `release-ready` only when all three are present and green.

## Commands

From this repository:

```bash
npm install
npm run doctor
npm test
npm run ecosystem:check
npm run dashboard
```

Factory commands:

```bash
nodekit create <empty-directory> --name <slug> --brief <text>
nodekit adopt <existing-directory> --name <slug> --brief <text>
nodekit compile --repo-root <directory>
nodekit inspect --repo-root <directory>
```

From any repository with `nodekit.yaml`:

```bash
npx --yes @homenshum/nodekit doctor
npx --yes @homenshum/nodekit demo
npx --yes @homenshum/nodekit check
npx --yes @homenshum/nodekit proof
```

`@homenshum/nodekit` 0.2.0 is not yet published. Until it is tagged and released, use a normalized local `file:` spec while dogfooding. The unscoped `nodekit` npm name belongs to an unrelated project.

## Contracts

- [`ownership.yaml`](ownership.yaml) names one owner, current package, target package, status, version, and consumers for every governed concept.
- [`repositories.yaml`](repositories.yaml) records lifecycle, support state, role, successor, and command profile.
- [`architecture.yaml`](architecture.yaml) defines universal commands, allowed reuse modes, and source-layer rules.
- [`schemas/nodekit.schema.json`](schemas/nodekit.schema.json) enforces `nodekit.repo/v1` for each consumer repository's `nodekit.yaml`.
- [`schemas/nodeagent.application.v1.schema.json`](schemas/nodeagent.application.v1.schema.json) and [`schemas/nodeagent.pack.v1.schema.json`](schemas/nodeagent.pack.v1.schema.json) enforce the application and capability-pack contracts during compilation.
- [`schemas/nodeagent.event.v1.schema.json`](schemas/nodeagent.event.v1.schema.json) defines the canonical portable event envelope. Applications resolve `nodeagent.event/v1` and `nodeagent.trace/v1` contract references even when an older v1 manifest omits the optional `contracts` block.
- `nodekit compile` discovers authored files, validates pack references, rejects literal secrets, and hashes the runtime, backend, fixtures, schemas, integrations, and evals into `.nodeagent/`.
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

`planned`, `migration-planned`, and `canonical-unpackaged` remain intentionally distinct from released shared packages. NodeKit now has one end-to-end reference preset; it does not claim that every runtime adapter, backend, template, codemod, or production deployment target is complete. In particular, NodeRoom still contains the deepest live runtime and its extraction into a published NodeAgent package remains separate work.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for the ownership split and migration rules.
The coordinated consumer commits, pull requests, hosted checks, and known limits are recorded in [`docs/P0_ROLLOUT.md`](docs/P0_ROLLOUT.md) and [`proof/p0-rollout.json`](proof/p0-rollout.json).
