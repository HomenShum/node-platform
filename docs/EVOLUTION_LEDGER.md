# NodeKit Evolution Ledger

The Evolution Ledger records why material NodeKit guarantees exist. It is an institutional reasoning system, not a feature changelog.

```text
Observed limitation
-> evidence
-> assumption disproven or scope-limited
-> architectural response
-> invariant
-> verifier
-> adoption
-> later validation, drift, supersession, or invalidation
```

## Canonical records

- `nodekit.evolution-event/v1`
- `nodekit.assumption/v1`
- `nodekit.invariant-claim/v1`
- `nodekit.evolution-evidence/v1`
- `nodekit.evolution-adoption/v1`

Canonical JSON lives under `evolution/`. Markdown timelines and adoption maps are generated projections. Events are separated into product, architecture, and harness tracks while sharing evidence and causal links.

## Authority and verification

Agents may draft an interpretation. Canonical events require a named human reviewer. Records are immutable; later changes supersede rather than overwrite them.

`nodekit evolution verify` fails closed on missing commits, missing or hash-drifted evidence, unverified invariants, unsupported adoption claims, circular supersession, incomplete model identity, incomplete screenshot or benchmark identity, and possible secrets.

`nodekit evolution sync-graph` converts verified records into a Knowledge Evolution patch. It never mutates the canonical graph directly; normal validation and approval remain mandatory.

## Commands

```bash
nodekit evolution init
nodekit evolution draft --id <id> --track architecture --category runtime --challenge <text> --resolution <text> --reviewed-by <id>
nodekit evolution record --file evolution/drafts/<event>.json
nodekit evolution verify
nodekit evolution query --invariant <id>
nodekit evolution diff --from <commit> --to <commit>
nodekit evolution build-docs
nodekit evolution sync-graph
```

Material changes include user workflow, public contracts, architectural ownership, security or authority, proof requirements, model routing, harness behavior, benchmark conclusions, and downstream guarantees. Routine formatting and dependency churn remain ordinary changelog entries.
