# Node Platform P0 Rollout

The canonical registry is live at [HomenShum/node-platform](https://github.com/HomenShum/node-platform). All nine consumer pull requests are merged. Each merge commit passed Node Platform conformance plus available repository CI, and the [hosted ecosystem run](https://github.com/HomenShum/node-platform/actions/runs/29401841672) passed against fresh checkouts of every current `main` branch.

| Repository | Commit | Pull request | Status |
|---|---|---|---|
| NodeAgent | `3aec0e8` | [#1](https://github.com/HomenShum/NodeAgent/pull/1) | Adopted |
| NodeRoom | `ca25e34` | [#198](https://github.com/HomenShum/NodeRoom/pull/198), repair [#199](https://github.com/HomenShum/NodeRoom/pull/199) | Adopted |
| NodeSlide | `dd67e4c` | [#2](https://github.com/HomenShum/NodeSlide/pull/2) | Adopted |
| NodeVideo | `bb79bc3` | [#3](https://github.com/HomenShum/NodeVideo/pull/3) | Adopted |
| NodeVoice | `9a27b69` | [#3](https://github.com/HomenShum/NodeVoice/pull/3) | Adopted |
| NodeTrace | `5dd5c1c` | [#1](https://github.com/HomenShum/NodeTrace/pull/1) | Adopted |
| NodeMem | `71da5c8` | [#1](https://github.com/HomenShum/NodeMem/pull/1) | Adopted |
| NodeProof | `53e084e` | [#21](https://github.com/HomenShum/NodeProof/pull/21) | Adopted |
| agentic-ui-qa | `bb31f8d` | [#3](https://github.com/HomenShum/agentic-ui-qa/pull/3) | Adopted |

The machine-readable evidence is [`proof/p0-rollout.json`](../proof/p0-rollout.json). "Adopted" means the pull request is merged and the recorded merge commit passed the reported main-branch checks. NodeRoom's first post-merge production run exposed nondeterministic PPTX ZIP directory timestamps; repair PR #199 fixed the issue and the repaired merge commit passed local and hosted production gates.

## P0 Boundary

This release establishes ownership, lifecycle, universal command aliases, no-key disclosures, duplicate-contract classification, architecture checks, CI enforcement, an ecosystem dashboard, and the scoped P0 CLI package. Shared environment loading, protocol package extraction, templates, codemods, migrations, automated release orchestration, and portfolio archival remain later phases.
