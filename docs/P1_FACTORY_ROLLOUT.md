# Node Platform P1 Factory Rollout

Portfolio classification and consolidation decisions are recorded in
[`GITHUB_ECOSYSTEM_AUDIT.md`](GITHUB_ECOSYSTEM_AUDIT.md).

P1 turns the P0 ownership map into executable seams. The work is intentionally
split into dependency-ordered pull requests. NodeSlide core, its controlled
React surface, and the NodeRoom consumer proof have merged; the remaining rows
are review branches unless explicitly labeled otherwise. Nothing here implies
npm publication or production deployment.

## Current pull-request set

| Capability | Repository / pull request | Proven in this branch | Still open |
|---|---|---|---|
| Brief-to-app factory and frozen manifests | [node-platform #4](https://github.com/HomenShum/node-platform/pull/4) | Empty-directory create, additive adopt, canonical compiler, arbitrary brownfield authoring roots bound into the config hash, Pi seam, deterministic eval/proof, Launch/QA/Present skills for Codex and Claude, evidence-bound presentation lane | Repeatable under-30 setup, live sponsor research, browser/deploy certification, npm release |
| Portable runtime event and Pi adapter | [NodeAgent #2](https://github.com/HomenShum/NodeAgent/pull/2) | `nodeagent.event/v1`, provider-neutral adapter, real Pi streaming/tool/usage translation, package tarball proof | npm release and production consumer promotion |
| Injectable presentation core | [NodeSlide #5](https://github.com/HomenShum/NodeSlide/pull/5) (merged) | Host-neutral deck/repository contracts, proposal-before-apply, CAS, versions, receipts, memory adapter, conformance testkit | Production adapters and export/reopen certification |
| Controlled presentation UI | [NodeSlide #7](https://github.com/HomenShum/NodeSlide/pull/7) (merged) | Backend-neutral React package, accessible read-only deck viewer, deterministic proposal comparison, fail-closed review callbacks, scoped styling, tarball SSR proof | Editable canvas, presenter, host-mounted browser proof, media-egress authority |
| External presentation agents | [NodeSlide #10](https://github.com/HomenShum/NodeSlide/pull/10) | Safe CLI and MCP inspect/validate/propose/apply, deterministic candidates, exact approval, path confinement, no-clobber writes, packed consumer proof | Publication, hosted transport promotion, and PPTX export/reopen certification |
| General proof envelope | [NodeProof #22](https://github.com/HomenShum/NodeProof/pull/22) | `proofloop.receipt/v1`, content hashes, authority classification, CLI verification | Consumer migration and signature policy |
| Trace consumer registration | [NodeTrace #3](https://github.com/HomenShum/NodeTrace/pull/3) | Truthful L1/L2 NodeKit adoption and deterministic trace path, restacked after P0 merged | Canonical event ingestion adapter |
| Memory consumer registration | [NodeMem #3](https://github.com/HomenShum/NodeMem/pull/3) | Truthful L1/L2 adoption, repaired dev command, broader deterministic proof, restacked after P0 merged | Canonical event ingestion and runtime memory adapter |
| NodeSlide second-consumer proof | [NodeRoom #218](https://github.com/HomenShum/NodeRoom/pull/218) (merged) | Package/tarball consumption, review, accept, stale CAS, versions, receipts, NodeRoom-auth normalization | Mounted UI, production repository adapter, ActorProof server binding, PPTX browser proof |
| NodeRoom contract reconciliation | [NodeRoom #219](https://github.com/HomenShum/NodeRoom/pull/219) | Existing Pi adapter and merged NodeSlide deck/patch consumption are explicitly classified with zero architecture exceptions | Merge after NodeKit ownership registry lands; no runtime behavior changes |
| Brownfield application alignment | [NodeBenchAI #592](https://github.com/HomenShum/NodeBenchAI/pull/592) | Canonical manifests, logical Entity Intelligence pack, existing eval bindings, compiled definition, policy-context consumption, Convex preflight derived from `convex.json` | No-key profile, native runtime shadow parity, Pi promotion, canonical receipts |
| Existing voice harness map | [NodeVoice #4](https://github.com/HomenShum/NodeVoice/pull/4) | Existing `src/nodeagents` runtime, logical voice-room pack, deterministic eval, and honest missing-receipt boundary are content-bound | Canonical durable receipt and production runtime parity |
| Existing Eve harness map | [NodeVideo #30](https://github.com/HomenShum/NodeVideo/pull/30) | Existing Eve directory, three adapter-authored subagents, song-conditioned pack, and eval bindings are content-bound | Default 5-second test gate, credentialed live eval, and shared-path parity |
| Task-corpus registration | [NodeTasks #1](https://github.com/HomenShum/NodeTasks/pull/1) | 9,155-task corpus, source index, score-claim boundary, provenance, and content hashes validate deterministically | Consumer evaluation composition; no official benchmark score is claimed |
| PR handoff to Present | [BetterPRHandoff #4](https://github.com/HomenShum/BetterPRHandoff/pull/4) | Real handoff payload compiles into Change Story, claims, Evidence Index, architecture diff, limitations, and a hashed receipt | Direct NodeSlide deck compilation and release presentation proof |
| Verified media to Present | [FeatureClipStudio #4](https://github.com/HomenShum/FeatureClipStudio/pull/4) | Tracked clips and screenshots project into a content-addressed Evidence Index with strict containment, provenance, media-signature, and drift checks | Independent browser/judge receipts, clean dependency install, dependency audit repair, and release certification |

NodeSlide core #5, React surface #7, and NodeRoom consumer proof #218 are merged. The obsolete stacked React #6
and external-agent #8 were closed rather than force-pushed; external-agent #10 is
restacked directly on current `main` with hosted checks green. NodeRoom #218 superseded #217 with
the exact consumer-proof tree and a correctly classified commit.
NodeBench #592 similarly supersedes #591 without force-pushing its review history.

## Dependency order

```text
NodeKit contracts + NodeAgent event/Pi seam
                 |
                 +--> NodeBench brownfield mapping -> shadow parity later
                 +--> NodeTrace / NodeMem consumer adapters later

NodeSlide core (merged)
     +--> controlled React surfaces (merged)
     +--> external CLI/MCP (#10)
     +--> NodeRoom consumer proof (merged #218) -> mounted production integration later

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

The assembled 13-repository conformance workspace also passed with zero
architecture exceptions. Its observed runtime varied from 14.59 seconds on one
optimized run to 69.8 seconds on the final cold rerun, so that audit path is not
presented as an under-30 guarantee either.

## Review-complete gate

P1 is ready for coordinated merge review only when:

1. every open pull request remains mergeable against its documented base;
2. superseded branches remain closed and replacement PRs target the merged base;
3. local validation evidence and available hosted checks are green;
4. the central registry still passes with no undeclared protocol copy;
5. no branch claims npm publication, production deployment, or browser proof
   that did not occur;
6. the NodeKit factory retains `local-ready` versus `release-ready` separation;
7. a failed production or package-consumer gate blocks promotion rather than
   being relabeled advisory.

## P1 boundary

This rollout creates the reusable factory, runtime/provider seam, proof
envelope, merged presentation core/React surface, external-agent transport,
brownfield bridge, task corpus, handoff compiler, and first real consumer proof.
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
| NodeVideo | Existing Eve harness mapped in #30 | Run the credentialed live eval and prove local/eval/production path parity without replacing Eve first |
| NodeVoice | Existing runtime and voice-room pack mapped in #4 | Add a canonical durable receipt supported by real execution |
| NodeTasks | Corpus registered and validated in #1 | Compose selected corpus lanes into application evaluation plans; retain the no-official-score boundary |
| agentic-ui-qa | Installed by NodeKit as the default `nodekit-qa` skill | Promote only after cross-host browser proof; no product-agent manifest |
| BetterPRHandoff | Real handoff payload compiles into NodeKit Present inputs in #4 | Feed the compiled evidence directly into NodeSlide and verify presentation export |
| FeatureClipStudio | Presentation-evidence bridge proposed in #4 | Add independent browser/judge receipts and feed verified clips into NodeSlide without upgrading observed artifacts into workflow proof |
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
