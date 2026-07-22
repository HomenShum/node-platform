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
