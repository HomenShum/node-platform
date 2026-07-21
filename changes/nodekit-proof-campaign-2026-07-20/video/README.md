# Founder Quest campaign walkthrough

This lane turns one exact production Founder Quest journey into two evidence-bound
videos. It deliberately does not deploy, publish, reply, message anyone, or mutate
Founder Quest state.

The implementation adapts Feature Proof Studio at commit
`7aafb3e0a48f3c1e74e69a51d9df506186ea4340`:

1. NodeKit validates the campaign story, exact deployment identity, fresh-user
   browser receipt, and screenshot hashes.
2. It stages that exact Feature Proof Studio commit in an isolated temporary
   directory.
3. It injects the campaign walkthrough into Feature Proof Studio's existing React
   SPA capture slot and changes only the displayed browser host label.
4. Feature Proof Studio's existing Playwright capturer records the states.
5. Its Remotion walkthrough is rendered through a small NodeKit composition wrapper
   as a 9:16 social cut and a 16:9 technical cut.
6. NodeKit probes both outputs and writes a content-addressed receipt.

The production URL is never checked into the specification. It is read from the
exact deployment receipt and must match the browser and screenshot proof identities.

## Inputs that must exist before capture

Paths are relative to `changes/nodekit-proof-campaign-2026-07-20/`.

### `proof/founder-quest/deployment-proof.json`

```json
{
  "status": "deployed",
  "production": true,
  "appId": "founder-quest-graph",
  "deploymentId": "provider-issued-deployment-id",
  "url": "an exact public HTTPS production URL",
  "commit": "full 40-character application commit",
  "configHash": "64-character sha256",
  "appHash": "64-character sha256",
  "deployedAt": "ISO-8601 timestamp"
}
```

### `proof/founder-quest/browser-proof.json`

It must contain the same `appId`, `deploymentId`, `url`, `commit`, `configHash`,
and `appHash`, plus:

```json
{
  "status": "pass",
  "journeyId": "founder-quest-critical-path-v1",
  "freshUser": true,
  "readOnlySynthetic": true,
  "consoleErrors": 0,
  "networkErrors": 0,
  "verifiedAt": "ISO-8601 timestamp"
}
```

### `proof/founder-quest/screenshots.json`

This repeats the deployment identity and contains a `status: "pass"` screenshot
manifest. Every item is `{ "id", "path", "sha256" }`; paths must remain inside the
campaign directory and hashes must match the bytes. Required IDs are:

- `quest-shell`
- `blocked-quest`
- `graph-path`
- `source-backed-answer`
- `source-detail`
- `proof-surface`
- `limitations`

The `C5_FOUNDER_QUEST_PRODUCT` claim must also be `verified` or `measured`, cite
existing evidence-index entries, and bind the same commit, deployment ID, config
hash, and app hash in its `scope`.

## Commands

Static validation is safe before deployment:

```powershell
node changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs lint
```

The next command is expected to return exit code `2` and `status: blocked` until all
production proof exists:

```powershell
node changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs preflight
```

After the exact production evidence and claim ledger are ready:

```powershell
$env:FEATURE_PROOF_STUDIO_ROOT='D:\path\to\feature-proof-studio'
node changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs capture
node changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs render
node changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs finalize
```

`all` runs those three gated phases in sequence. `--skip-install` is only for an
already provisioned isolated stage; it never relaxes evidence gates.

## Output contract

- `video/output/nodekit-founder-quest-vertical.mp4`: 1080x1920, 60-90 seconds.
- `video/output/nodekit-founder-quest-technical.mp4`: 1920x1080, 120-180 seconds.
- `video/proof/founder-quest-capture-manifest.json`: source frames, hashes, commits,
  configuration, and prerequisite proof hashes.
- `video/proof/founder-quest-video-receipt.json`: probed dimensions and durations,
  output hashes, exact deployment identity, and limitations.

The final receipt marks the recursive-launch claim only as `partial`: publication
still requires separately approved public posts, verified URLs, and distribution
receipts.
