import type { DetachedAttestation, ReleaseIdentity } from "./submission-attestation.mjs";

export type FinalizableExternalGate =
  | "developerTimingMatrix"
  | "freshAgentHeldout"
  | "freshHumanUsability"
  | "threeConvexConsumers"
  | "previewDeployment"
  | "managedSupabasePortability"
  | "knowledgeEvolutionAdoption"
  | "modelIntelligenceHarness";
export type FinalizableSubmissionGate = FinalizableExternalGate
  | "proofloopEaseVerification"
  | "publicationApproval";

export type SigningKeyPolicy = Readonly<{
  schemaVersion: "nodekit.attestation-signing-key-policy/v1";
  keyId: string;
  publicKey: string;
  purposes: readonly [FinalizableSubmissionGate];
}>;

export const FINALIZABLE_EXTERNAL_GATES: readonly FinalizableExternalGate[];
export const FINALIZABLE_SUBMISSION_GATES: readonly FinalizableSubmissionGate[];
export const SIGNING_KEY_POLICY_SCHEMA_VERSION: "nodekit.attestation-signing-key-policy/v1";

export function finalizeSubmissionEvidence(options: Readonly<{
  gate: FinalizableSubmissionGate;
  rawVerdict: Record<string, unknown>;
  releaseIdentity: ReleaseIdentity & Readonly<{ packageName: "@homenshum/nodekit"; packageVersion: string }>;
  repoRoot: string;
  privateKey: unknown;
  signingKeyPolicy: SigningKeyPolicy;
  signedAt?: string;
  schemasRoot?: string;
}>): Promise<Readonly<{
  verdict: Readonly<Record<string, unknown>>;
  attestationPayload: Readonly<Record<string, unknown>>;
  attestation: DetachedAttestation;
  evidenceCount: number;
  reopenedEvidence: readonly Readonly<{ path: string; sha256: string; bytes?: number }>[];
  localCryptographicVerification: Readonly<{
    verified: true;
    algorithm: "Ed25519";
    keyId: string;
    payloadSha256: string;
    payloadType: string;
    signedAt: string;
  }>;
  submissionTrustEvaluated: false;
}>>;
