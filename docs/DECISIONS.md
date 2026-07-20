# Platform Decisions

## Repository Boundary

Keep the products and independently useful packages in separate repositories. Put the ownership registry, conformance CLI, shared workflow, schemas, and future templates in `node-platform`.

Current standalone owners:

- NodeAgent: runtime and policy contracts.
- NodeTrace: portable trace UI and local trace store.
- NodeMem: passive memory behavior and storage ports.
- NodeProof: certification loop and proof receipts.
- agentic-ui-qa: UI QA protocol and flight-recorder workflow.
- NodeRoom, NodeSlide, NodeVideo, NodeVoice: domain contracts and applications.

## Trace Split

NodeTrace owns the portable trace UI/store, not every runtime event emitted by NodeAgent. The richer `nodeagent.trace/v1` workpaper currently lives in NodeRoom and is recorded as a migration source. Its target owner is NodeAgent. This avoids pretending a package exists before the protocol is extracted and compatibility-tested.

NodeAgent owns the portable `nodeagent.event/v1` envelope. Its minimum fields are `eventId`, `runId`, monotonic `sequence`, namespaced `type`, ISO `occurredAt`, optional actor and references, and a payload. NodeKit owns the JSON Schema and NodeAgent owns the typed runtime implementation. Product-specific stream rows are projections, not alternate event protocols.

## Manifest Dialect

`nodekit.repo/v1`, `nodeagent.application/v1`, and `nodeagent.pack/v1` use a flat `schemaVersion` manifest. The earlier `apiVersion` / `kind` / `metadata` / `spec` proposal is rejected rather than silently reinterpreted. This prevents benchmark, generator, and production paths from compiling different definitions from visually similar YAML.

The `contracts` block in `nodeagent.application/v1` is optional for compatibility with manifests authored before the freeze. The compiler always resolves it to `nodeagent.event/v1` and `nodeagent.trace/v1`; new templates write those values explicitly.

## Proposal Split

`nodeslide.deck-patch/v1` remains a NodeSlide domain protocol. The planned generic `nodeagent.proposal/v1` may later carry review decisions, candidate receipts, and authority boundaries, but it must not erase deck-specific operations or make NodeSlide import another application's internals.

## Reuse Modes

Only these modes are accepted:

- `package-import`: stable runtime dependency.
- `generated`: generator-owned output with origin metadata.
- `template-copy`: scaffold intended to diverge.
- `migration-copy`: existing duplicate frozen until package extraction.
- `migration-source`: current authoritative source assigned for extraction to a different owning repository.
- `adapter`: framework/provider translation without business authority.
- `domain-specialization`: domain contract that narrows a platform concept.

Every detected canonical signature must be listed in `nodekit.yaml`. A new undeclared match fails closed. Existing migration copies are visible debt, not invisible permission to copy again.

## Command Vocabulary

Application-profile repositories expose `dev`, `demo`, `doctor`, `check`, and `proof`. `nodekit doctor` always performs read-only setup/conformance checks. Lifecycle commands run the repository's declared npm script so domain gates remain authoritative.

## No-key Meaning

`certified` means the command requires no API key and no cloud account, uses deterministic fixtures through real contracts, and discloses simulation. `partial` means keys are optional but an external account or service is still needed. The dashboard never rounds `partial` up to `certified`.
