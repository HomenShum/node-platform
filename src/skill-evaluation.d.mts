export type SkillReceiptPurpose = "skill-benchmark" | "skill-canary" | "skill-integrity" | "skill-promotion-approval";

export interface SkillEvidenceReference {
  path: string;
  sha256: string;
  bytes?: number;
  kind?: string;
}

export interface SkillEvidenceClosureEntry {
  path: string;
  sha256: string;
  bytes: number;
  kind: string | null;
}

export interface SkillEvidenceClosure {
  entries: SkillEvidenceClosureEntry[];
  rootHash: string;
}

export interface SkillTrustedKey {
  publicKey: string;
  purposes: SkillReceiptPurpose[];
}

export type SkillTrustedKeyMap = Record<string, SkillTrustedKey>;

export interface SkillSigningOptions {
  privateKey: string | Uint8Array;
  keyId: string;
  signedAt?: string;
}

export interface SkillVerificationOptions {
  trustedKeys?: SkillTrustedKeyMap;
}

export interface SkillDetachedAttestation {
  schemaVersion: "nodekit.skill-detached-attestation/v1";
  algorithm: "Ed25519";
  keyId: string;
  payloadSha256: string;
  purpose: SkillReceiptPurpose;
  signedAt: string;
  signatureEncoding: "base64url";
  signature: string;
}

export interface SkillSignedReceipt extends Record<string, unknown> {
  receiptId: string;
  receiptHash: string;
  issuedAt: string;
  purpose: SkillReceiptPurpose;
  evidence: SkillEvidenceReference[];
  evidenceRootSha256: string;
  attestation: SkillDetachedAttestation;
}

export interface SkillBenchmarkVerdict extends Record<string, unknown> {
  schemaVersion: "nodekit.skill-benchmark-verdict/v1";
  verdictId: string;
  verdictHash: string;
  candidateId: string;
  passed: boolean;
  protectedEvaluationPassed: true;
  promotionAuthorized: false;
}

export interface SkillPromotionApproval extends Record<string, unknown> {
  schemaVersion: "nodekit.skill-promotion-approval/v1";
  purpose: "skill-promotion-approval";
  approvalId: string;
  approvalHash: string;
  candidateId: string;
  candidateSkillHash: string;
  benchmarkVerdictHash: string;
  canaryReceiptHash: string;
  integrityReceiptHash: string;
  currentHarnessVersion: string;
  currentHarnessManifestHash: string;
  approvedBy: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  attestation: SkillDetachedAttestation;
}

export function computeSkillEvidenceClosure(
  repoRoot: string,
  references: SkillEvidenceReference[],
): Promise<SkillEvidenceClosure>;

export function sealSkillEvaluatorReceipt(
  input: Record<string, unknown>,
  signingOptions: SkillSigningOptions,
): SkillSignedReceipt;

export function sealSkillIntegrityReceipt(
  input: Record<string, unknown>,
  signingOptions: SkillSigningOptions,
): SkillSignedReceipt;

export function sealSkillPromotionApproval(
  input: Record<string, unknown>,
  signingOptions: SkillSigningOptions,
): SkillPromotionApproval;

export function verifySkillEvaluatorReceipt(
  repoRoot: string,
  receipt: SkillSignedReceipt,
  options?: SkillVerificationOptions,
): Promise<{ closure: SkillEvidenceClosure; keyId: string; receipt: SkillSignedReceipt; receiptHash: string; verified: true }>;

export function verifySkillIntegrityReceipt(
  repoRoot: string,
  receipt: SkillSignedReceipt,
  options?: SkillVerificationOptions,
): Promise<{ closure: SkillEvidenceClosure; keyId: string; receipt: SkillSignedReceipt; receiptHash: string; verified: true }>;

export function verifySkillPromotionApproval(
  approval: SkillPromotionApproval,
  expected: Record<string, string>,
  options?: SkillVerificationOptions & { at?: number },
): Promise<{ approval: SkillPromotionApproval; approvalHash: string; keyId: string; verified: true }>;

export function verifySkillBenchmarkVerdict(
  repoRoot: string,
  verdict: SkillBenchmarkVerdict,
  options?: SkillVerificationOptions,
): Promise<Record<string, unknown> & { verified: true; verdict: SkillBenchmarkVerdict }>;

export function benchmarkSkillCandidate(
  repoRoot: string,
  candidateId: string,
  comparisonPath: string,
  options?: SkillVerificationOptions,
): Promise<SkillBenchmarkVerdict & { output: string }>;

export function verifyCanary(
  repoRoot: string,
  canaryPath: string,
  options?: SkillVerificationOptions,
): Promise<SkillSignedReceipt & { candidateId: string; output: string; trustedKeyId: string; verified: true }>;

export function promoteSkillCandidate(
  repoRoot: string,
  candidateId: string,
  options: {
    approvalPath: string;
    canaryPath: string;
    proofPath: string;
    trustedKeys?: SkillTrustedKeyMap;
  },
): Promise<Record<string, unknown>>;
