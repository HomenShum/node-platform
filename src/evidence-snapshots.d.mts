export type EvidenceLocatorSource = "user" | "provider" | "parser";
export type EvidenceByteAnchor = {
  source: EvidenceLocatorSource;
  startByte: number;
  endByte: number;
  anchorSha256: string;
};
export type EvidenceLocator =
  | (EvidenceByteAnchor & { kind: "text" })
  | (EvidenceByteAnchor & { kind: "pdf-page"; pageNumber: number })
  | (EvidenceByteAnchor & { kind: "image-region"; coordinateSpace: "pixels" | "normalized"; x: number; y: number; width: number; height: number })
  | (EvidenceByteAnchor & { kind: "video-range"; startMs: number; endMs: number })
  | (EvidenceByteAnchor & { kind: "byte-range" });

type WithoutAnchor<T> = T extends unknown ? Omit<T, "anchorSha256"> : never;
export type EvidenceLocatorInput = WithoutAnchor<EvidenceLocator>;
export type EvidenceSnapshot = {
  schemaVersion: "nodekit.evidence-snapshot/v1";
  snapshotId: string;
  source: { uri: string; capturedAt: string; mediaType: string };
  raw: { byteLength: number; sha256: string; blobPath: string };
  locators: EvidenceLocator[];
  freshness: { checkedAt: string; expiresAt?: string };
  storedAt: string;
  contentHash: string;
};
export type EvidenceIngestInput = {
  bytes: Uint8Array;
  sourceUri: string;
  mediaType: string;
  capturedAt?: string;
  checkedAt?: string;
  expiresAt?: string;
  expectedSha256?: string;
  locators?: EvidenceLocatorInput[];
};
export type EvidenceIngestLimits = {
  maximumBytes?: number;
  maximumLocators?: number;
  maximumSnapshotRecords?: number;
};
export type EvidenceVerification = {
  schemaVersion: "nodekit.evidence-verification/v1";
  snapshotId: string;
  expectedSha256: string;
  actualSha256: string;
  hashMatches: boolean;
  lengthMatches: boolean;
  mediaBytesValid: boolean;
  fresh: boolean;
  locatorChecks: Array<{ index: number; passed: boolean; actualAnchorSha256: string | null }>;
  verifiedAt: string;
  passed: boolean;
};

export const EVIDENCE_SNAPSHOT_SCHEMA: "nodekit.evidence-snapshot/v1";
export const EVIDENCE_VERIFICATION_SCHEMA: "nodekit.evidence-verification/v1";
export function validateEvidenceSnapshotDocument(snapshot: unknown): string[];
export function evidenceSnapshotToGraphNode(snapshot: EvidenceSnapshot, input: { label: string; confidence?: number; properties?: Record<string, unknown> }): Record<string, unknown> & { id: string; kind: "evidence"; layer: "source" };
export function readContainedEvidenceFile(repoRoot: string, candidate: string, options?: { maximumBytes?: number }): Promise<{ bytes: Uint8Array; relativePath: string }>;
export function ingestEvidenceBytes(repoRoot: string, input: EvidenceIngestInput, options?: { limits?: EvidenceIngestLimits; storePath?: string }): Promise<EvidenceSnapshot>;
export function ingestEvidenceFile(repoRoot: string, input: Omit<EvidenceIngestInput, "bytes"> & { file: string }, options?: { limits?: EvidenceIngestLimits; storePath?: string }): Promise<{ snapshot: EvidenceSnapshot; sourcePath: string }>;
export function readEvidenceSnapshot(repoRoot: string, snapshotId: string, options?: { storePath?: string }): Promise<EvidenceSnapshot>;
export function verifyEvidenceSnapshot(repoRoot: string, snapshotId: string, options?: { storePath?: string; at?: number | string }): Promise<EvidenceVerification>;
export function verifyEvidenceGraphNode(repoRoot: string, node: Record<string, unknown>, options?: { storePath?: string; at?: number | string }): Promise<{ snapshot: EvidenceSnapshot; verification: EvidenceVerification }>;
