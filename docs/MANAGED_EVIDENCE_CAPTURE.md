# Managed external-evidence capture

`nodekit-evidence-capture` is the single operator ledger for the three remaining managed-service gates:

- `previewDeployment`;
- `managedSupabasePortability`;
- one `threeConvexConsumers` campaign for each of `noderoom`, `nodeslide`, and `nodevideo`.

It fills the gap between the existing exact-package preparation/conformance tools and the existing independent evidence finalizer. It does not create infrastructure, deploy, delete, sign, publish, submit, or claim that a gate passed.

The command is resumable. Every mutation appends a hash-chained event and regenerates `campaign.json`; `campaign-receipt.json` is written once, only after all required evidence and cleanup records exist. Both files always say:

```json
{
  "externalAttestationRequired": true,
  "submissionGateSatisfied": false
}
```

## What is verified before the timer starts

`start` reopens the complete `nodekit.package-install-proof/v1` evidence closure. It requires:

- repository `HEAD` to equal the candidate commit;
- the current distributable source hash to equal the candidate source hash;
- the package proof, package identity, tarball path, byte count, and SHA-256 to agree;
- the npm archive to be a regular, non-symlink, non-hard-linked file with the expected package name and version;
- every package-proof supporting file to still match its recorded digest;
- every named credential to be present in the process environment.

Only credential environment-variable names are recorded. Values, hashes, prefixes, lengths, or inferred provider identities are never written or printed. Imported textual evidence is rejected when it contains a required credential value or a non-redacted secret-like JSON field.

## Freeze one candidate first

Use the exact current-revision package proof, not `proof/ease/latest/manifest.json` from an earlier run:

```powershell
npm run candidate:prove
npm run proof:package-install
```

The decisive campaign should start only after the source tree is frozen. If the distributable source changes, `start` fails and a new package proof is required.

## Preview deployment campaign

The following commands record work performed by the authorized operator. They do not perform the work themselves.

```powershell
$env:VERCEL_TOKEN = "<process-only>"
$env:CONVEX_DEPLOY_KEY = "<process-only>"

npm run evidence:capture -- start `
  --gate previewDeployment `
  --candidate-proof proof/package-install-verdict.json `
  --require-env VERCEL_TOKEN `
  --require-env CONVEX_DEPLOY_KEY
```

Copy the returned `campaignPath` into the commands below:

```powershell
$campaign = "proof/managed-evidence/preview/<candidate>/<campaign>/campaign.json"

npm run evidence:capture -- phase --campaign $campaign --action start --phase deploy
# Authorized operator creates isolated frontend and backend previews here.
npm run evidence:capture -- resource --campaign $campaign `
  --kind frontend-preview --provider vercel --resource-id <vercel-deployment-id> `
  --environment preview --isolated yes --url https://<preview-host>
npm run evidence:capture -- resource --campaign $campaign `
  --kind backend-preview --provider convex --resource-id <convex-preview-id> `
  --environment preview --isolated yes
npm run evidence:capture -- phase --campaign $campaign --action complete --phase deploy --outcome succeeded
```

Record the remaining phases in the same way:

```text
health
browser
export-reopen
cleanup
```

Import the provider/browser/domain results without editing them:

```powershell
npm run evidence:capture -- evidence --campaign $campaign --kind browser-proof --file <browser-proof.json>
npm run evidence:capture -- evidence --campaign $campaign --kind exported-artifact --file <exported-artifact>
npm run evidence:capture -- evidence --campaign $campaign --kind reopen-score --file <reopen-score.json>
npm run evidence:capture -- evidence --campaign $campaign --kind deployment-receipt --file <deployment-receipt.json>

npm run evidence:capture -- browser --campaign $campaign `
  --manifest proof/preview/browser/screenshot-manifest.json `
  --application-commit <deployed-application-commit>
```

The browser command reuses the submission verifier. It requires all 180 exact state/viewport/theme PNGs, all 180 sidecars, trace, video, portable proof, console and network records; reopens every byte; and rejects localhost or a screenshot origin that differs from the recorded isolated HTTPS frontend.

After the authorized operator removes both previews, record the provider receipts:

```powershell
npm run evidence:capture -- cleanup --campaign $campaign `
  --resource-kind frontend-preview --provider-receipt <vercel-cleanup-receipt.json>
npm run evidence:capture -- cleanup --campaign $campaign `
  --resource-kind backend-preview --provider-receipt <convex-cleanup-receipt.json>
```

NodeKit generates one aggregate `cleanup-receipt.json` that binds both provider receipt byte hashes. It does not treat that aggregate as independent proof.

## Managed Supabase campaign

Start with the credential names required by the chosen managed test project. Values remain process-only:

```powershell
npm run evidence:capture -- start `
  --gate managedSupabasePortability `
  --candidate-proof proof/package-install-verdict.json `
  --require-env SUPABASE_URL `
  --require-env SUPABASE_SERVICE_ROLE_KEY
```

Record one isolated resource:

```powershell
npm run evidence:capture -- resource --campaign $campaign `
  --kind managed-supabase-project --provider supabase --resource-id <project-ref> `
  --environment managed-test --isolated yes
```

Time these phases and import the matching exact result files:

| Phase | Required evidence kind |
|---|---|
| `provision` | `managed-service-receipt` |
| `migrate` | `postgres-conformance` |
| `auth-rls` | `auth-rls-report` |
| `storage` | `storage-roundtrip` |
| `realtime` | `realtime-delivery` |
| `queue` | `queue-report` |
| `cron` | `cron-report` |
| `export-import` | `export-import-report` |
| `cleanup` | generated aggregate after the provider cleanup receipt is recorded |

The PostgreSQL report must be created by the exact-package runner first:

```powershell
$env:NODEKIT_POSTGRES_URL = "<managed-postgres-connection>"
npm run conformance:postgres -- `
  --candidate-tarball=<exact-tarball-path-from-package-proof> `
  --output=proof/postgres-conformance.json
```

`nodekit-evidence-capture` does not replace that runner or the managed Supabase test implementation.

## Consumer adoption campaigns

Run one campaign per clean consumer revision. The command verifies the supplied consumer commit equals its clean worktree `HEAD` and never records the local path.

```powershell
npm run evidence:capture -- start `
  --gate threeConvexConsumers `
  --candidate-proof proof/package-install-verdict.json `
  --consumer-id noderoom `
  --consumer-root D:\src\noderoom `
  --consumer-commit <reviewed-consumer-commit> `
  --require-env CONVEX_DEPLOY_KEY
```

Each campaign requires:

- phases `install`, `conformance`, `deploy`, `browser`, and `cleanup`;
- isolated `consumer-frontend-preview` and `convex-preview-deployment` resource IDs;
- the exact NodeKit component tarball already bound at campaign start;
- an independently produced `consumer-verdict` report;
- an exact 180-screenshot browser manifest whose application commit equals the reviewed consumer commit;
- provider cleanup receipts for both isolated resources.

The three completed capture receipts are inputs to the independent reviewer that authors the aggregate `nodekit.convex-consumers-verdict/v1`; the capture tool does not assemble or sign that verdict.

## Resume, inspect, and finalize capture

```powershell
npm run evidence:capture -- resume --campaign $campaign
npm run evidence:capture -- status --campaign $campaign
npm run evidence:capture -- finalize --campaign $campaign
```

Failed or cancelled phase attempts remain in the ledger. A later attempt can succeed without deleting the earlier evidence. If the host restarted and its monotonic epoch changed, the phase receipt labels the fallback as `wall-clock-after-host-restart`; it never silently rewrites the measurement.

`finalize` reopens the package proof, tarball, every imported file, every cleanup provider receipt, and the complete screenshot closure. It then writes an immutable capture receipt with `ready-for-independent-review` status.

## What remains external

Even after capture finalizes, all of the following remain outside this tool and must be real:

1. explicit authority to create and remove hosted resources;
2. provider-authenticated preview, Convex, and Supabase operations;
3. fresh signed-in browser identities and actual fixture uploads;
4. export/reopen scoring by the domain evaluator;
5. authenticated owner and cross-owner consumer checks;
6. managed Supabase Auth, RLS, Storage, Realtime, Queue, and Cron observations;
7. independent review and gate-specific Ed25519 attestation;
8. ProofLoop verification;
9. owner publication approval.

Only after those external results are finalized should the existing commands be used:

```powershell
npm run submission:finalize-evidence -- <gate-specific arguments>
npm run submission:prepare -- --candidate HEAD
npm run submission:evaluate -- --manifest proof/submission-manifest.json
```

Until the final evaluator returns `submissionReady: true`, the status remains `EASE_NOT_CERTIFIED` and Convex submission remains prohibited.
