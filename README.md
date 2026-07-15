# Node Platform

Node Platform is the machine-readable ownership and repository-contract layer for the Node ecosystem. It prevents new contract forks while the existing applications continue to ship independently.

P0 deliberately does not move working product code between repositories. It records who owns each concept, classifies current adapters and migration sources, standardizes lifecycle commands, and fails CI when a new canonical-signature copy or clear layer violation appears.

## Commands

From this repository:

```bash
npm install
npm run doctor
npm test
npm run ecosystem:check
npm run dashboard
```

From any repository with `nodekit.yaml`:

```bash
npx --yes @homenshum/nodekit doctor
npx --yes @homenshum/nodekit demo
npx --yes @homenshum/nodekit check
npx --yes @homenshum/nodekit proof
```

For a source-pinned fallback, replace `@homenshum/nodekit` with `github:HomenShum/node-platform#v0.1.0`. The unscoped `nodekit` npm name belongs to an unrelated project; this project uses the `@homenshum/nodekit` package and exposes the `nodekit` binary.

## P0 Contract

- [`ownership.yaml`](ownership.yaml) names one owner, current package, target package, status, version, and consumers for every governed concept.
- [`repositories.yaml`](repositories.yaml) records lifecycle, support state, role, successor, and command profile.
- [`architecture.yaml`](architecture.yaml) defines universal commands, allowed reuse modes, and source-layer rules.
- [`schemas/nodekit.schema.json`](schemas/nodekit.schema.json) documents each consumer repository's `nodekit.yaml`.
- `nodekit repo check` validates ownership declarations, command aliases, migration origins, signature classification, and source rules.
- `nodekit ecosystem check` checks all active local clones together.
- `nodekit dashboard` generates the cross-repository status table.

## Honest Boundary

`planned`, `migration-planned`, and `canonical-unpackaged` are intentionally distinct from a released shared package. P0 freezes new duplication; it does not claim the P1 package extraction, environment loader, templates, codemods, or release automation are complete.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for the ownership split and migration rules.
The coordinated consumer commits, pull requests, hosted checks, and known limits are recorded in [`docs/P0_ROLLOUT.md`](docs/P0_ROLLOUT.md) and [`proof/p0-rollout.json`](proof/p0-rollout.json).
