# Node Platform P0 Rollout

The canonical registry is live at [HomenShum/node-platform](https://github.com/HomenShum/node-platform). All nine consumer pull requests are merge-clean and passed their Node Platform conformance checks plus available repository CI.

| Repository | Commit | Pull request | Status |
|---|---|---|---|
| NodeAgent | `7265bc2` | [#1](https://github.com/HomenShum/NodeAgent/pull/1) | Ready |
| NodeRoom | `13c2cd1` | [#198](https://github.com/HomenShum/NodeRoom/pull/198) | Ready |
| NodeSlide | `6be3524` | [#2](https://github.com/HomenShum/NodeSlide/pull/2) | Ready |
| NodeVideo | `1f55faa` | [#3](https://github.com/HomenShum/NodeVideo/pull/3) | Ready |
| NodeVoice | `37e646b` | [#3](https://github.com/HomenShum/NodeVoice/pull/3) | Ready |
| NodeTrace | `fa44832` | [#1](https://github.com/HomenShum/NodeTrace/pull/1) | Ready |
| NodeMem | `d75757d` | [#1](https://github.com/HomenShum/NodeMem/pull/1) | Ready |
| NodeProof | `bac57a0` | [#21](https://github.com/HomenShum/NodeProof/pull/21) | Ready |
| agentic-ui-qa | `52a1b01` | [#3](https://github.com/HomenShum/agentic-ui-qa/pull/3) | Ready |

The machine-readable evidence is [`proof/p0-rollout.json`](../proof/p0-rollout.json). "Ready" means the pinned PR commit and all reported checks passed; it does not mean the pull request has been merged.

## P0 Boundary

This release establishes ownership, lifecycle, universal command aliases, no-key disclosures, duplicate-contract classification, architecture checks, CI enforcement, and an ecosystem dashboard. Shared environment loading, package extraction, templates, codemods, migrations, npm publication, release automation, and portfolio archival remain later phases.
