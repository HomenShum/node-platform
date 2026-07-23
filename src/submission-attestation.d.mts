export type EvidenceReference = Readonly<{ kind?: string; path: string; sha256: string; bytes?: number }>;
export type ReleaseIdentity = Readonly<{
  candidateCommit: string;
  nodekitSourceHash: string;
  nodekitTarballSha256: string;
}>;
export type DetachedAttestation = Readonly<{
  schemaVersion: "nodekit.detached-attestation/v1";
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  payloadType: string;
  payloadSha256: string;
  signatureEncoding: "base64url";
  signature: string;
}>;
export type TrustedAttestationKey = Readonly<{
  publicKey: unknown;
  purposes: readonly string[];
}>;

export const SUBMISSION_ATTESTATION_SCHEMA_VERSION: "nodekit.detached-attestation/v1";
export const EXTERNAL_GATE_PAYLOAD_SCHEMA_VERSION: "nodekit.external-gate-verification-attestation-payload/v1";
export const PROOFLOOP_EASE_PAYLOAD_SCHEMA_VERSION: "nodekit.proofloop-ease-verification-attestation-payload/v1";
export const PUBLICATION_APPROVAL_PAYLOAD_SCHEMA_VERSION: "nodekit.publication-approval-attestation-payload/v1";
export const SUBMISSION_ATTESTATION_ALGORITHM: "Ed25519";
export const SUBMISSION_ATTESTATION_SIGNATURE_ENCODING: "base64url";
export const EXTERNALLY_OBSERVED_GATE_TYPES: readonly [
  "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
  "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
];
export const SUBMISSION_ATTESTATION_PURPOSES: readonly string[];

export function canonicalizeAttestationPayload(payload: unknown): string;
export function hashAttestationPayload(payload: unknown): string;
export function externalGateEvidenceRootSha256(references: readonly EvidenceReference[]): string;
export function externalGateVerdictBodySha256(verdict: Record<string, unknown>): string;
export function proofLoopEvidenceRootSha256(references: readonly EvidenceReference[]): string;
export function createExternalGateVerificationPayload(options: ReleaseIdentity & {
  type: typeof EXTERNALLY_OBSERVED_GATE_TYPES[number];
  evidence: readonly EvidenceReference[];
  verdict: Record<string, unknown>;
}): Readonly<Record<string, unknown>>;
export function createDeveloperTimingMatrixPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createFreshAgentHeldoutPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createFreshHumanUsabilityPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createThreeConvexConsumersPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createPreviewDeploymentPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createManagedSupabasePortabilityPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createKnowledgeEvolutionAdoptionPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createModelIntelligenceHarnessPayload(options: Omit<Parameters<typeof createExternalGateVerificationPayload>[0], "type">): Readonly<Record<string, unknown>>;
export function createProofLoopEaseVerificationPayload(options: ReleaseIdentity & {
  decisiveEvidence: readonly EvidenceReference[];
  verification: EvidenceReference;
}): Readonly<Record<string, unknown>>;
export function createPublicationApprovalPayload(options: ReleaseIdentity & {
  submissionManifest: EvidenceReference;
  scopes: readonly string[];
}): Readonly<Record<string, unknown>>;
export function validateSubmissionAttestationPayload(payload: unknown): unknown;
export function signDetachedAttestation(options: {
  payload: Record<string, unknown>;
  privateKey: unknown;
  keyId: string;
  signedAt?: string;
}): DetachedAttestation;
export function verifyDetachedAttestation(options: {
  payload: Record<string, unknown>;
  attestation: DetachedAttestation;
  trustedKeys: Map<string, TrustedAttestationKey> | Record<string, TrustedAttestationKey>;
  expectedPayloadType?: string;
  now?: number | string | Date;
  maxFutureSkewMs?: number;
}): Readonly<{ verified: true; algorithm: "Ed25519"; keyId: string; payloadSha256: string; payloadType: string; signedAt: string }>;
export function parseTrustedAttestationKeysJson(encoded?: string): Readonly<Record<string, Readonly<{ publicKey: string; purposes: readonly string[] }>>>;
