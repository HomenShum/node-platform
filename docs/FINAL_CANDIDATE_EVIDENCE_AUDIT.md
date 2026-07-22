# NodeKit final-candidate evidence audit

> Historical audit snapshot. The commit, source hash, gate counts, and file-state observations below
> describe the repository at the time of this audit; they are not the current readiness ledger. Use
> [`REMAINING_GAPS.md`](REMAINING_GAPS.md) and
> [`EASE_SUBMISSION_READINESS.md`](EASE_SUBMISSION_READINESS.md) for the live fail-closed status.

Audit snapshot: 2026-07-22, branch `codex/nodekit-figured-out-base`.

## Verdict

**Do not submit or publish.** The repository contains useful historical proof, but it does not
contain one complete, internally consistent evidence bundle for the current NodeKit candidate.
The correct final-candidate status is `EASE_NOT_CERTIFIED`.

The audited Git `HEAD` was:

```text
5b9c4d73c286020fe7b7c52d208d7e0cbfeef626
```

The working tree was not a final candidate: it had 409 changed/untracked paths, including 391 under
`proof/`. The distribution source hash observed before this report was added was:

```text
f7954a3402bd68ce6c7a2c6b55b1c91e7508a9d3b58fedc6b638d2f8b85ad603
```

That hash is only an audit snapshot. It must not be used as the final identity because the working
tree is still changing and this report itself may be included in the packaged distribution. Freeze
and commit the complete EvoGraph/Knowledge Evolution implementation and every other source change
before computing the final candidate identity.

## Authoritative evidence inventory

“Authoritative” below means authoritative for the named historical run, not proof of the current
candidate.

| Evidence | Exact identity or status | Audit conclusion |
| --- | --- | --- |
| `proof/ease/developer-timing-runs.json` | `e398398d7f1dd4ff0b65409d2c8da971e83bc488/97989e9914aee93b83d5b120599bf4d9c8f69b3434040a3e06164cb58c84b987` | 60 receipts pass the current read-only evaluator. Historical only. |
| `proof/ease/developer-timing-verdict.json` | SHA-256 `632cab7302d8c8efc3b782702cf4bae285a01d8295b09ec43d51f65706668795` | Passed historically, but the stored verdict has no `nodekitCommit`, `nodekitSourceHash`, or `nodekitIdentity`; it cannot be decisive evidence under the hardened submission gate. Regenerate it from exact-candidate receipts. |
| `proof/ease/fresh-agent-verdict.json` | `e398398d7f1dd4ff0b65409d2c8da971e83bc488/97989e9914aee93b83d5b120599bf4d9c8f69b3434040a3e06164cb58c84b987`; SHA-256 `ca8bd83ca623add4b6834608b647fac6174599a346cba4944f6595eb1105bd02` | All three required tasks passed historically with zero interventions and zero reprompts. Not current-candidate proof. |
| `proof/package-install-verdict.json` | Candidate `e398398d7f1dd4ff0b65409d2c8da971e83bc488`; tarball SHA-256 `e17b7521f39b09a06fdf9b5646d8a0088430914556c0bf3b30c6ae81bd98a7a9` | The referenced tarball still exists and its hash matches. The verdict file begins with a UTF-8 BOM and fails Node `JSON.parse`, so it cannot be decisive evidence. Historical only. |
| `proof/ease/latest/manifest.json` and `proof/factory-acceptance.json` | Byte-identical; SHA-256 `08be58ea09d4d68b84b03d08da91b35ff9bf50bcbc868c2025e83e8292e80cad`; run `ease_baf96caf40fe4254ba25` | Passed core factory/browser work but correctly says `EASE_NOT_CERTIFIED`. The recorded commit/hash pair is not a clean immutable revision: commit `0cc282c...` is paired with source hash `97989e...`, used by the later `e398398...` evidence. Never promote this mutable `latest` directory. |
| `proof/ease/latest/browser/screenshot-manifest.json` | SHA-256 `24e57592ca65aa1978f2474d4a45697344b879d208f711c15172764db49f1f1a`; manifest digest `97eed4335e854f07ab5430b8af4bc8d7654df8b8d30b0033f5183e52e064a085` | Internally intact for the historical run: 180/180 PNG hashes match, 180/180 sidecars match, all 15 states are covered across six viewport profiles and two themes, both trace/video hashes match, and console/network/accessibility failures are zero. It is still stale and uses the mixed identity above. |
| `proof/ease/fresh-users-verdict.json` | `passed: false`, participant count `0` | Honest open external gate. |
| `proof/ease/latest/proofloop-receipt.json` | Tracked file is currently deleted | No final independent Ease integrity receipt exists. |
| `proof/submission-manifest.json` | Missing | There is no final evidence binding. |
| `proof/submission-verdict.json` | Missing | There is no submission-ready verdict. |

The immutable, identity-suffixed files such as
`proof/ease/developer-timing-runs-e398398.json` and
`proof/ease/fresh-agent-verdict-e398398.json` are the safest historical records. Mutable aliases such
as `latest`, `developer-timing-verdict.json`, and `fresh-agent-verdict.json` are convenience paths,
not final evidence identities.

## Exact screenshot and browser audit

The historical browser packet is structurally strong but not current-candidate proof.

- Required states: 15; covered states: 15; missing states: 0.
- Viewports: `1440x900`, `1920x1080`, `1024x768`, `768x1024`, `390x844`, and
  `844x390`.
- Themes: light and dark.
- Expected screenshots: `15 x 6 x 2 = 180`; present: 180.
- PNG bytes matching each sidecar/manifest `pngSha256`: 180/180.
- Sidecar payloads matching the manifest entries: 180/180.
- Sidecars matching the run, NodeKit commit/hash, and generated candidate identity: 180/180.
- Playwright trace and browser video hashes: 2/2 matched.
- Manifest self-digest: matched.
- Journey assertions: all true.
- Console errors, failed requests, and accessibility violations: zero.

This proves that exact screenshot accounting works. It does not prove the post-`e398398` product or
the eventual EvoGraph-inclusive final candidate.

## Stale or mismatched identities

1. Current source is newer than every passing timing, fresh-agent, package, and browser packet.
2. `proof/ease/latest/manifest.json` records commit `0cc282c...` with source hash `97989e...`, while
   the passing `0cc282c` timing matrix is bound to source hash `bbe21d...` and the passing
   `e398398` matrix is bound to `97989e...`. That `latest` commit/hash pair must be treated as a
   dirty-tree historical run, not an immutable revision.
3. The stored timing verdict predates the new identity fields even though its raw receipts contain
   one valid identity. Re-evaluate after the final candidate is frozen.
4. The package-install verdict is bound to `e398398`, is not bound to a source hash, and is not
   standard UTF-8 JSON consumable by Node because of the BOM.
5. The selected fresh-agent trials are legitimate historical experiments, but their output cannot
   be rebased onto a later commit. Their receipt hashes are self-digests in their trial manifests,
   not separate stored receipt files.
6. The current `proof/ease/latest/` tree is heavily dirty. Preserve it as user-owned evidence; do
   not clean, overwrite, or silently rename it as final proof.

## Submission-gate status

The current working tree contains uncommitted hardening that is directionally correct:

- timing and fresh-user verdicts gain exact commit/source-hash identity;
- fresh-agent verdicts gain explicit commit/source-hash fields;
- the submission evaluator rejects stale source revisions, cross-gate evidence reuse, evidence
  bound to another commit, malformed decisive JSON, and decisive verdicts that do not satisfy the
  gate-specific contract.

The targeted tests passed (11/11):

```powershell
node --test test/ease-evidence.test.mjs test/ease-proof.test.mjs test/submission-gate.test.mjs
```

However, those protections are modified working-tree code, not a committed final-candidate
guarantee. They must be reviewed, committed, and included before the candidate is frozen. The
current template evaluates fail-closed, and the real manifest is absent.

Read-only evaluation used:

```powershell
node --input-type=module -e "import {evaluateSubmissionManifest} from './src/lib/submission-gate.mjs'; console.log(await evaluateSubmissionManifest(process.cwd(),'proof/submission-manifest.template.json'))"
```

It correctly reports the placeholder candidate, stale/malformed evidence, missing Convex,
preview, ProofLoop, and approval verdicts, and no exact-candidate decisive evidence.

## Missing final gates

| Gate | Current evidence | Can close locally? | What is actually required |
| --- | --- | --- | --- |
| Developer timing matrix | Historical pass only | Partly | Freeze candidate, then run 5 cold + 5 warm trials for Windows/npm, Windows/pnpm, Ubuntu/npm, Ubuntu/pnpm, macOS/npm, and macOS/pnpm. The 60-run cross-OS matrix normally requires CI runners. |
| Fresh-agent held-out | Historical three-task pass only | With authenticated coding-agent runtime | Repeat research map, volunteer onboarding, and launch presentation from clean isolated directories on the exact candidate with zero reprompts and substantive source changes. |
| Fresh-human usability | 0 participants, failed | No | Five consented fresh people, exact timestamps and screenshots/recordings, at least four unassisted completions, median first action <=30s, median journey <=180s, median SEQ >=6/7, no P0/P1 failures. |
| Three Convex consumers | `proof/convex-consumers-verdict.json` missing | No | Three authenticated, owner-scoped real consumers exercising stale proposals, retries, exception recovery, receipts, and component/app boundaries. Do not deploy from this audit. |
| Preview deployment | `proof/preview-verdict.json` missing | No | Authorized isolated frontend/backend preview of the exact commit, fresh identity, real fixture bytes, export/reopen score, screenshots, health, and cleanup. |
| Managed Supabase portability | `proof/managed-supabase-portability-verdict.json` missing | No | Externally attested managed-project auth/RLS, Storage, Realtime, queue, Cron, and Convex-to-Supabase artifact/receipt hash parity on the exact candidate. |
| Knowledge Evolution adoption | `proof/knowledge-evolution-adoption-verdict.json` missing | No | Externally attested protected flat/static/evolving comparison that improves or holds both baselines, plus a real consumer adoption and reviewed ledger event. |
| Model Intelligence harness | `proof/model-intelligence-harness-verdict.json` missing | No | Externally attested exact-model observation, protected application gym, independent evaluator, and passing fresh-agent canary; outcome remains provisional. |
| Engineering health | `proof/engineering-health-verdict.json` missing | Yes, after source freeze | Ten exact-candidate machine command receipts plus an independently recountable issue inventory proving zero open P0/P1 issues. |
| ProofLoop Ease verification | `proof/proofloop-final.json` and latest receipt missing | No; independent last step | Verify the final archive and every referenced hash only after all prior exact-candidate evidence is complete. |
| Package-install proof | Historical tarball pass; malformed verdict JSON | Yes | Pack the exact candidate, install in a fresh consumer, create/compile/check/demo/eval, retain tarball, write BOM-free identity-bound JSON. |
| Publication approval | `proof/publication-approval.json` missing | No | Explicit owner approval naming both `npm-publish` and `convex-directory-submit`. |

These are now first-class IDs in the twelve-gate submission schema. They cannot be replaced with
README claims, local-only emulation, a candidate-authored signature, or an unscoped trusted key.

## Safe reconciliation plan

1. Finish and review all source work, including the EvoGraph-R1-inspired Knowledge Evolution/model
   intelligence path. Do not collect final evidence while source is still moving.
2. Commit one immutable candidate. Confirm a clean distribution surface, then record both:

   ```powershell
   git rev-parse HEAD
   node --input-type=module -e "import {computeNodeKitSourceHash} from './src/lib/source-hash.mjs'; console.log(await computeNodeKitSourceHash(process.cwd()))"
   ```

3. Create an identity-scoped evidence root such as
   `proof/ease/candidates/<full-commit>/<source-hash>/`. Never reuse `latest` as the authoritative
   source.
4. Re-run factory acceptance and the exact browser journey first. Verify every PNG, sidecar,
   trace, video, generated-candidate commit, export, and reload receipt before continuing.
5. Run the 60 timing trials and aggregate only receipts with the exact same commit and source hash.
6. Run the current fresh-agent v2 matrix on that same identity: three held-out tasks, each through
   three fresh Codex sessions, one fresh Claude Code session, and one fresh lower-cost-agent
   session (15 total). Pass the expected identity to the aggregator and isolate its input directory
   so older passing trials cannot be selected.
7. Pack and install from that exact commit. Emit standard UTF-8 JSON without a BOM, include both
   candidate commit and source hash, and keep the tarball at a durable evidence path.
8. Complete the five-person, three-consumer, live preview, portability, and live model/knowledge
   evolution evidence without modifying candidate source.
9. Run independent ProofLoop verification last and retain `proof/proofloop-final.json`.
10. Create `proof/submission-manifest.json` only after every decisive verdict is exact-candidate,
    BOM-free parseable JSON with the correct SHA-256. Then run:

    ```powershell
    npm run submission:evaluate
    ```

11. Publish or submit only when the emitted verdict has both `passed: true` and
    `submissionReady: true`, and the explicit publication approval is present.

## Locally rerunnable checks

These can be run without deployment or publication, although some produce new proof and should be
directed to a new identity-scoped directory rather than the dirty historical tree:

```powershell
npm test
npm run check
npm run acceptance:factory
npm run ease:evaluate-developer -- <exact-candidate-raw-receipts.json>
npm run ease:evaluate-agents -- --root=<exact-candidate-agent-directory> --output=<identity-scoped-verdict.json> --candidate=<40-char-commit> --source-hash=<64-char-source-hash> --nodekit-tarball=<exact-candidate.tgz> --nodekit-tarball-sha256=<64-char-tarball-hash>
npm run submission:evaluate
```

The package-install, browser, and fresh-agent commands require their normal package manager,
Playwright/browser, Docker or coding-agent credentials, and sufficient time. The cross-platform
timing matrix requires Windows, Ubuntu, and macOS execution. None of these local or CI checks can
substitute for fresh humans, authenticated real Convex consumers, an authorized deployment,
independent ProofLoop review, or owner publication approval.
