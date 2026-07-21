---
name: nodekit-launch
description: Turn a business pain point, product purpose, hackathon idea, judging rubric, or required sponsor stack into a researched, scaffolded, evaluated, live-tested, browser-proven agent application. Use for empty-directory builds or safely adopting NodeKit into an existing project.
---

# NodeKit Launch

Build the smallest undeniable vertical slice. Keep an honest launch clock from intake through proof, aiming for 30 minutes and preserving remaining 2-hour and 4-hour hackathon runway.

Read [the launch contract](references/launch-contract.md) before acting.

## Workflow

1. Start the launch timer. Capture the raw brief, deadline, judging rubric, sponsor requirements, and current directory state.
2. Research current official sources for the user problem and every sponsor. Record links, package versions, authentication, pricing/limits, and one visible contribution to the demo.
3. Select one workflow shaped as `input -> agent decision -> tool-backed action -> measurable artifact -> visible proof`. Prefer a real metric and a reversible experiment.
4. Compile the prose into `hackathon.yaml`. Ask only questions whose answers materially change the product, security model, or irreversible action.
5. For an empty target, run `nodekit create --local-proof`; add `--package-manager pnpm` when pnpm is available and appropriate. For an existing target, run `nodekit adopt` and inspect its collision receipt before accepting changes.
6. Run `nodekit compile` and `nodekit inspect`. Confirm the filesystem-discovered tools, skills, integrations, fixtures, evals, provider, secret references, and config hash.
7. Implement one end-to-end surface. Preserve one execution path for the no-key demo, live provider, browser, and evals.
8. Read and run the sibling `nodekit-qa` skill. Establish the deterministic floor, strict live-provider smoke, and the critical browser journey; test missing secrets, malformed input, reload/resume, repeated actions, narrow/mobile layout, and export/reopen.
9. Deploy only the exact tested revision and only with user authorization. Record URL, revision, environment identity, health, and a fresh-user journey.
10. Emit the release proof and launch timeline. Do not call the run production-proven if live, browser, deployment, or receipt evidence is absent.
11. Read and run the sibling `nodekit-present` skill. Bind the problem, product workflow, sponsor use, architecture, screenshots, and proof to one Change Story; produce the presentation tier required by the audience without upgrading unsupported claims.

## Sponsor rule

A dependency in `package.json` is not sponsor usage. Each sponsor needs an official-source research note, deterministic fixture, bounded live smoke, visible role in the main workflow, and sanitized receipt.

## Time policy

- Measure research, scaffold, install, compile, implementation, deterministic gates, live model, browser QA, deployment, and final proof independently.
- Treat 30 minutes as a target gate, not a reason to falsify evidence or skip safety.
- At 15 minutes, freeze the core workflow and defer side quests.
- At 22 minutes, stop aesthetic expansion and run the full proof ladder.
- If the run exceeds 30 minutes, preserve the actual duration and top friction causes; never rewrite timestamps.

## Secret and approval policy

Read credentials from environment references only. Never print values. Remove temporary process variables after the bounded call. Pause for paid activation, destructive changes, production migrations, public posting, or deployment unless explicitly authorized.
