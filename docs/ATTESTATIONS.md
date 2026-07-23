# Trusted submission attestations

NodeKit uses detached Ed25519 attestations for every release decision that
cannot be established from candidate bytes alone:

- `developerTimingMatrix`
- `freshAgentHeldout`
- `freshHumanUsability`
- `threeConvexConsumers`
- `previewDeployment`
- `managedSupabasePortability`
- `knowledgeEvolutionAdoption`
- `modelIntelligenceHarness`
- `proofloopEaseVerification` signs the exact ProofLoop verification artifact.
- `publicationApproval` signs the deterministic eleven-gate
  `proof/submission-candidate.json` and approved scopes. The final submission
  manifest then adds only the detached publication-approval gate, avoiding a
  circular signature while still allowing the evaluator to reconstruct and
  byte-compare the signed candidate from the final manifest.

Every externally observed gate payload binds the candidate commit, NodeKit
source hash, packed tarball hash, canonical transitive-evidence root, and the
canonical hash of the complete verdict body with only `attestationPayload` and
`attestation` removed. A valid signature therefore cannot be replayed after a
candidate rewrites timing metrics, agent runs, human outcomes, consumer checks,
hosted deployment identity, managed Supabase results, protected knowledge
comparison, or model-intelligence observation. ProofLoop additionally binds the
ordered root of its eleven decisive evidence references. The detached envelope binds its payload
hash, payload type, key ID, algorithm, signature encoding, and signing timestamp.

Verification is intentionally trust-store driven:

```js
verifyDetachedAttestation({
  payload,
  attestation,
  trustedKeys: new Map([["release-owner-2026", {
    publicKey: configuredPublicKey,
    purposes: ["publicationApproval"],
  }]]),
  expectedPayloadType: "publicationApproval",
});
```

The trusted key map must come from verifier configuration outside the candidate
proof bundle. Every key has an explicit non-empty purpose allowlist. A signature
made by a real trusted key still fails if that key is not authorized for the
payload's gate. There is no globally trusted key. The verifier rejects unknown
envelope fields, so a candidate cannot smuggle an alternate public key into an
attestation and make it trusted.

Payloads and signing statements use deterministic JSON with code-unit-sorted
object keys. Lossy JSON values, cycles, sparse arrays, non-finite numbers,
non-plain objects, and unpaired Unicode surrogates are rejected. Evidence paths
must be canonical repository-relative paths.

The module does not make a key trustworthy, distribute public keys, or decide
who may approve publication. Those are operator responsibilities. Submission
gates should receive an explicit trusted key map and remain fail-closed when it
is absent.

## Public API

Attestation helpers are exported from both `@homenshum/nodekit` and
`@homenshum/nodekit/submission-attestation`. The generic
`createExternalGateVerificationPayload` factory and the eight purpose-specific
factories compute the evidence and verdict-body roots. Callers should not hand
assemble those hashes.

## Trust-store environment encoding

`NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON` is a JSON object whose keys are stable
key IDs. Every value must contain exactly an Ed25519 SPKI `publicKey` in PEM form
and a non-empty `purposes` array. Bare PEM values are deliberately rejected.
Private keys must never be placed in this variable, proof bundles, or source
control.

PowerShell example:

```powershell
openssl genpkey -algorithm ED25519 -out C:\secure\nodekit-reviewer.pem
openssl pkey -in C:\secure\nodekit-reviewer.pem -pubout -out C:\secure\nodekit-reviewer.pub.pem
$trusted = @{
  "independent-reviewer-2026" = @{
    publicKey = Get-Content C:\secure\nodekit-reviewer.pub.pem -Raw
    purposes = @("previewDeployment")
  }
} | ConvertTo-Json -Depth 4 -Compress
$env:NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON = $trusted
```

The parser validates every public key and every purpose. Malformed JSON,
non-PEM values, unsupported or missing purposes, unknown key IDs at verification
time, absent trust configuration, purpose mismatch, and embedded candidate keys
all fail closed.

## Offline signing and verification

### Fail-closed evidence finalization

The preferred handoff is `nodekit-evidence-finalize` (or
`npm run submission:finalize-evidence`). It accepts an already-measured,
passing raw evaluator verdict. It never runs a study, fills missing fields,
changes a threshold, chooses favorable attempts, or infers an observation.
Before it writes a decisive verdict it:

1. requires the caller to repeat the exact commit, source hash, package name,
   package version, and tarball hash;
2. compares those values with the raw verdict and its `releaseCandidate`;
3. reopens and hashes every transitive evidence reference inside the repository;
4. requires a one-purpose signing-key policy and proves that the external
   private key matches that policy's public key;
5. creates the canonical external-gate payload and detached Ed25519 envelope;
6. validates the completed gate-specific JSON schema and submission contract;
7. self-verifies the signature and reopens the evidence a second time.

The workflow supports all eight externally observed gates. The developer
timing, fresh-agent, and fresh-human evaluators can be passed directly as raw
inputs; consumers, preview, managed Supabase, Knowledge Evolution, and Model
Intelligence use the same command after an independent reviewer has produced
the complete gate-specific draft verdict. No collector is hidden in the
finalizer.

It also has two explicit authority modes:

- `proofloopEaseVerification` accepts only a complete independent draft that
  already says `passed`, identifies the independent verifier, contains exactly
  the 11 preregistered decisive evidence references, and contains the
  independent verification reference in its reviewed `attestationPayload`.
  The finalizer reopens all 12 files, recomputes the canonical payload, and
  refuses missing, extra, aliased, or drifted evidence. It does not declare the
  verification independent.
- `publicationApproval` accepts only a complete owner-authored approval draft.
  The draft must already contain approver identity, approval timestamp, exactly
  `npm-publish` and `convex-directory-submit`, and a reviewed canonical payload
  pointing to `proof/submission-candidate.json`. The finalizer reopens that
  prepared candidate and signs the existing decision. It never approves a
  release or invents an approver.

The public signing policy contains no private material and must authorize
exactly the gate being finalized. The machine-readable contract is
`schemas/nodekit.attestation-signing-key-policy.v1.schema.json`; the finalizer
also validates the PEM as an Ed25519 public key and compares it with the
external private key before signing. The CLI refuses a private-key path inside
the evidence repository. A policy looks like:

```json
{
  "schemaVersion": "nodekit.attestation-signing-key-policy/v1",
  "keyId": "human-reviewer-2026",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "purposes": ["freshHumanUsability"]
}
```

Example:

```powershell
$env:NODEKIT_ATTESTATION_PRIVATE_KEY_FILE = "C:\secure\human-reviewer.pem"
npm run submission:finalize-evidence -- `
  --gate freshHumanUsability `
  --input proof/ease/fresh-users-raw.json `
  --output proof/ease/fresh-users-verdict.json `
  --payload-output proof/ease/fresh-users-attestation-payload.json `
  --attestation-output proof/ease/fresh-users-attestation.json `
  --repo-root . `
  --candidate-commit <40-char-commit> `
  --source-hash <64-char-source-hash> `
  --tarball-sha256 <64-char-tarball-hash> `
  --package-name @homenshum/nodekit `
  --package-version <exact-version> `
  --key-policy C:\secure\human-reviewer-policy.json
```

Use distinct raw and decisive paths so the measured body remains available for
audit. Optional payload and attestation outputs are byte-readable copies of the
objects embedded in the decisive verdict.

Crucially, successful finalization proves possession of the policy's private
key, not that the key is trusted. The command prints
`submissionTrustEvaluated: false` and never edits
`NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON`. A locally generated key and policy still
fail submission until an external verifier independently places that public
key in its caller-owned trust registry for the exact purpose.

### Manual payload signing

First create a payload with the public API after the decisive verdict body and
its evidence references are final. For example:

```js
import { createPreviewDeploymentPayload } from "@homenshum/nodekit/submission-attestation";

const payload = createPreviewDeploymentPayload({
  candidateCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  evidence: previewVerdict.evidence,
  verdict: previewVerdict,
});
```

Write that payload to `proof/preview-attestation-payload.json`, then sign using
an external private-key file. The command prints only key ID, purpose, and hash:

```powershell
$env:NODEKIT_ATTESTATION_PRIVATE_KEY_FILE = "C:\secure\nodekit-reviewer.pem"
npm run attestation:sign -- --payload proof/preview-attestation-payload.json --output proof/preview-attestation.json --key-id independent-reviewer-2026
npm run attestation:verify -- --payload proof/preview-attestation-payload.json --attestation proof/preview-attestation.json
```

The packed command equivalents are `nodekit-attestation-sign` and
`nodekit-attestation-verify` with the same flags.

After verification, store the exact payload as `attestationPayload` and the
exact detached envelope as `attestation` on the decisive verdict. Never edit
the verdict body or its evidence references afterward; create and sign a new
payload if either changes.

Final preparation and evaluation use the same caller-owned trust store:

```powershell
npm run submission:prepare -- --candidate HEAD
npm run submission:evaluate -- --manifest proof/submission-manifest.json
```

The full timing, screenshot, held-out-user, portability, protected-comparison,
engineering-health, and submission-closure protocol is documented in
[EaseProof](./EASE_PROOF.md).
