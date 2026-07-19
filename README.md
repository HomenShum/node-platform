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
- [`schemas/nodekit.schema.json`](schemas/nodekit.schema.json) documents each consumer repository's `nodekit.yaml`.
- [`schemas/nodeagent.application.v1.schema.json`](schemas/nodeagent.application.v1.schema.json) and [`schemas/nodeagent.pack.v1.schema.json`](schemas/nodeagent.pack.v1.schema.json) are enforced during compilation.
- `nodekit compile` discovers authored files, validates pack references, rejects literal secrets, and hashes the runtime, backend, fixtures, schemas, integrations, and evals into `.nodeagent/`.
- `nodekit create` refuses non-empty targets. `nodekit adopt` writes missing files only, preserves host scripts, and emits a collision receipt.
- `nodekit repo check` validates ownership declarations, command aliases, migration origins, signature classification, and source rules.
- `nodekit ecosystem check` checks all active local clones together.
- `nodekit dashboard` generates the cross-repository status table.

## Honest boundary

`planned`, `migration-planned`, and `canonical-unpackaged` remain intentionally distinct from released shared packages. NodeKit now has one end-to-end reference preset; it does not claim that every runtime adapter, backend, template, codemod, or production deployment target is complete. In particular, NodeRoom still contains the deepest live runtime and its extraction into a published NodeAgent package remains separate work.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for the ownership split and migration rules.
The coordinated consumer commits, pull requests, hosted checks, and known limits are recorded in [`docs/P0_ROLLOUT.md`](docs/P0_ROLLOUT.md) and [`proof/p0-rollout.json`](proof/p0-rollout.json).
