export type ManagedEvidenceGate = "previewDeployment" | "managedSupabasePortability" | "threeConvexConsumers";
export type ManagedEvidenceOutcome = "succeeded" | "failed" | "cancelled";

export interface ManagedEvidenceLocator {
  repoRoot?: string;
  campaignId: string;
  gate: ManagedEvidenceGate;
  candidateCommit: string;
  clock?: { nowIso(): string; monotonicNs(): bigint | string | number };
}

export interface StartManagedEvidenceCampaignOptions {
  repoRoot?: string;
  gate: ManagedEvidenceGate;
  candidateProof: string;
  requiredEnvironmentVariables: string[];
  environment?: Readonly<Record<string, string | undefined>>;
  consumerId?: "noderoom" | "nodeslide" | "nodevideo";
  consumerRoot?: string;
  consumerCommit?: string;
  clock?: ManagedEvidenceLocator["clock"];
}

export declare const MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION: "nodekit.managed-evidence-campaign/v1";
export declare const MANAGED_EVIDENCE_EVENT_SCHEMA_VERSION: "nodekit.managed-evidence-event/v1";
export declare const MANAGED_EVIDENCE_RECEIPT_SCHEMA_VERSION: "nodekit.managed-evidence-capture-receipt/v1";
export declare const MANAGED_EVIDENCE_CLEANUP_SCHEMA_VERSION: "nodekit.managed-evidence-cleanup-receipt/v1";
export declare const MANAGED_EVIDENCE_ROOT: "proof/managed-evidence";

export declare function verifyManagedEvidenceCandidate(options: { repoRoot?: string; candidateProof: string }): Promise<{
  repoRoot: string;
  candidate: Record<string, unknown>;
}>;
export declare function startManagedEvidenceCampaign(options: StartManagedEvidenceCampaignOptions): Promise<Record<string, unknown>>;
export declare function resumeManagedEvidenceCampaign(options: ManagedEvidenceLocator): Promise<Record<string, unknown>>;
export declare function recordManagedEvidencePhase(options: ManagedEvidenceLocator & { action: "start" | "complete"; phase: string; outcome?: ManagedEvidenceOutcome }): Promise<Record<string, unknown>>;
export declare function recordManagedEvidenceResource(options: ManagedEvidenceLocator & { kind: string; provider: string; resourceId: string; environment: "preview" | "managed-test" | "adoption-test"; isolated: true; url?: string }): Promise<Record<string, unknown>>;
export declare function importManagedEvidence(options: ManagedEvidenceLocator & { kind: string; sourceFile: string; environment?: Readonly<Record<string, string | undefined>> }): Promise<Record<string, unknown>>;
export declare function linkManagedBrowserManifest(options: ManagedEvidenceLocator & { manifestPath: string; applicationCommit: string }): Promise<Record<string, unknown>>;
export declare function recordManagedEvidenceCleanup(options: ManagedEvidenceLocator & { resourceKind: string; providerReceiptFile: string; environment?: Readonly<Record<string, string | undefined>> }): Promise<Record<string, unknown>>;
export declare function getManagedEvidenceCampaign(options: ManagedEvidenceLocator): Promise<Record<string, unknown>>;
export declare function finalizeManagedEvidenceCampaign(options: ManagedEvidenceLocator): Promise<Record<string, unknown>>;
