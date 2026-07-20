# Node Platform P1 Factory Rollout

P1 turns the P0 ownership map into executable seams. The work is intentionally
split into reviewable draft pull requests; nothing in this ledger implies that
the branches are merged, published to npm, or deployed to production.

## Current pull-request set

| Capability | Repository / pull request | Proven in this branch | Still open |
|---|---|---|---|
| Brief-to-app factory and frozen manifests | [node-platform #4](https://github.com/HomenShum/node-platform/pull/4) | Empty-directory create, additive adopt, canonical compiler, arbitrary brownfield authoring roots bound into the config hash, Pi seam, deterministic eval/proof, Launch/QA/Present skills for Codex and Claude, evidence-bound presentation lane | Repeatable under-30 setup, live sponsor research, browser/deploy certification, npm release |
| Portable runtime event and Pi adapter | [NodeAgent #2](https://github.com/HomenShum/NodeAgent/pull/2) | `nodeagent.event/v1`, provider-neutral adapter, real Pi streaming/tool/usage translation, package tarball proof | npm release and production consumer promotion |
| Injectable presentation core | [NodeSlide #5](https://github.com/HomenShum/NodeSlide/pull/5) | Host-neutral deck/repository contracts, proposal-before-apply, CAS, versions, receipts, memory adapter, conformance testkit | Production adapters and export/reopen certification |
| Controlled presentation UI | [NodeSlide #6](https://github.com/HomenShum/NodeSlide/pull/6) | Backend-neutral React package, accessible read-only deck viewer, deterministic proposal comparison, fail-closed review callbacks, scoped styling, tarball SSR proof | Editable canvas, presenter, host-mounted browser proof, media-egress authority |
| General proof envelope | [NodeProof #22](https://github.com/HomenShum/NodeProof/pull/22) | `proofloop.receipt/v1`, content hashes, authority classification, CLI verification | Consumer migration and signature policy |
| Trace consumer registration | [NodeTrace #2](https://github.com/HomenShum/NodeTrace/pull/2) | Truthful L1/L2 NodeKit adoption and deterministic trace path | Canonical event ingestion adapter |
| Memory consumer registration | [NodeMem #2](https://github.com/HomenShum/NodeMem/pull/2) | Truthful L1/L2 adoption, repaired demo command, deterministic proof | Canonical event ingestion and runtime memory adapter |
| NodeSlide second-consumer proof | [NodeRoom #217](https://github.com/HomenShum/NodeRoom/pull/217) | Package/tarball consumption, review, accept, stale CAS, versions, receipts, NodeRoom-auth normalization | Mounted UI, production repository adapter, ActorProof server binding, PPTX browser proof |
| Brownfield application alignment | [NodeBenchAI #591](https://github.com/HomenShum/NodeBenchAI/pull/591) | Canonical manifests, logical Entity Intelligence pack, existing eval bindings, compiled definition | No-key profile, native runtime shadow parity, Pi promotion, canonical receipts |

NodeSlide #6 and the external-agent interface are stacked on NodeSlide #5 so the
core package boundary can be reviewed independently. They must not be retargeted
to `main` until their base dependency lands.

## Dependency order

```text
NodeKit contracts + NodeAgent event/Pi seam
                 |
                 +--> NodeBench brownfield mapping -> shadow parity later
                 +--> NodeTrace / NodeMem consumer adapters later

NodeSlide core
     +--> external CLI/MCP
     +--> controlled React/headless UI
     +--> NodeRoom consumer proof -> mounted production integration later

ProofLoop receipt envelope
     +--> application receipt migration and release certification later
```

## Timing evidence

The fastest observed empty-directory deterministic local-ready run was 17.72
seconds. Repeated Windows runs ranged up to 36.37 seconds. A pnpm
`create --local-proof` run completed in 31.86 seconds, with 29.5 seconds spent
installing dependencies. The deterministic demo/evaluation work itself took
milliseconds.

Therefore P1 records the under-30 target as **not yet repeatably certified**.
Dependency extraction and process startup are the current bottleneck; the
factory must preserve every observed timing rather than publishing only the
fastest run.

## Review-complete gate

P1 is ready for coordinated merge review only when:

1. every listed pull request remains mergeable against its documented base;
2. stacked NodeSlide changes name NodeSlide #5 as their base dependency;
3. local validation evidence and available hosted checks are green;
4. the central registry still passes with no undeclared protocol copy;
5. no branch claims npm publication, production deployment, or browser proof
   that did not occur;
6. the NodeKit factory retains `local-ready` versus `release-ready` separation;
7. a failed production or package-consumer gate blocks promotion rather than
   being relabeled advisory.

## P1 boundary

This rollout creates the reusable factory, runtime/provider seam, proof
envelope, presentation core, brownfield bridge, and first real consumer proof.
It does not yet finish production installation of NodeSlide inside NodeRoom,
replace NodeBench's mature runtime, migrate every repository to canonical
events/receipts, publish packages, or certify a fully live hackathon app from a
vague brief in under 30 minutes.

Those remaining items are explicit P1 follow-ups or P2 work, not hidden inside
the word "done."

## Remaining ecosystem map

The GitHub-wide audit classifies repositories by the smallest honest adoption
step. A product-agent manifest is not required for every repository: protocols,
corpora, QA packs, and deterministic tools should not invent a runtime merely to
look uniform.

### P1: close the factory loop

| Repository | Current truth | P1 action |
|---|---|---|
| NodeVideo | Flat NodeKit registration; production-shaped Eve agent under `apps/eve-agent/agent`; no root application manifest | Map the existing Eve directory, packs, and evals through one root `nodeagent.yaml`; do not move the live harness first |
| NodeVoice | Flat NodeKit registration; runtime under `src/nodeagents`; proof receipt is not yet canonical | Brownfield-map the current runtime, logically extract one voice-room pack, and define only receipts supported by actual execution |
| NodeTasks | Unregistered 9,155-task corpus with useful fixtures plus vendored upstream snapshots | Register as a task corpus, emit a corpus validation receipt, and replace vendored runtime ownership with provenance references; no product-agent manifest |
| agentic-ui-qa | Valid NodeKit protocol with a self-check receipt | Install it from NodeKit as the default QA skill/pack; no product-agent manifest |
| BetterPRHandoff | Focused handoff protocol | Feed its structured handoff into NodeKit Present and the Change Story contract |
| FeatureClipStudio | Reproducible demo-video transport | Add a presentation evidence adapter for verified clips and screenshots |
| parity-studio | UI-kit staging surface that still embeds NodeSlide domain code | Keep it as a staging product, but freeze new embedded NodeSlide capability after standalone package parity |

NodeBenchAI remains registered as `untracked` until it has an honest finite
no-key/demo profile. A canonical manifest alone is not evidence that the runtime
can satisfy the registry's executable lifecycle contract.

### P2: reusable capability expansion

- Register NodeGraph and expose its existing bridge as a capability pack.
- Register NodeSEO as a deterministic tool/protocol and expose an SEO proof pack.
- Package AgentRedteam and the agent-era maturity rubric as evaluation inputs.
- Distribute FreeAgentResources as NodeKit's research catalog, not a runtime.
- Extract NodeRL's unique reward, repair, and export contracts; freeze its copied
  NodeTrace, NodeMem, and NodeEval implementations.
- Keep NodeSheet as a finance/spreadsheet pack until a second independent host
  justifies a standalone repository. No NodeSheet GitHub repository was found.

### Consolidate after unique material is preserved

- Redirect NodeBenchBoilerplate to `nodekit create` or generate it as a fixture.
- Move authoritative NodeAgentSpec material into NodeAgent/NodeKit documentation.
- Extract unique skills from solo-founder-agent-builder and
  agent-workspace-template, then archive or redirect them.
- Archive private NodeBenchClean after the public NodeBenchAI surface reaches
  equivalent cleanliness.
- Fold VisualJudge's generic judging behavior into agentic-ui-qa or
  FeatureClipStudio and retain only a narrow adapter if needed.
- Remove parity-studio's embedded NodeSlide domain only after standalone
  NodeSlide reaches functional parity.
