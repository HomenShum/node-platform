import type { EvidenceLocatorInput } from "./evidence-snapshots.mjs";

export type ResearchLimits = {
  maximumSearches?: number;
  maximumResultsPerSearch?: number;
  maximumFetches?: number;
  maximumBytesPerFetch?: number;
  maximumTotalBytes?: number;
  maximumLocatorsPerDocument?: number;
  maximumLocatorBytesPerDocument?: number;
  maximumMetadataBytesPerResult?: number;
  maximumDurationMs?: number;
};
export type NormalizedResearchLimits = Required<ResearchLimits>;
export type ResearchResult = {
  uri: string;
  title: string;
  mediaType: string;
  locators?: EvidenceLocatorInput[];
  metadata?: Record<string, unknown>;
};
export interface ResearchProvider {
  contractVersion: "nodekit.research-provider/v1";
  id: string;
  version: string;
  search(query: string, options: { limit: number; signal: AbortSignal }): Promise<{
    uri: string;
    capturedAt: string;
    rawBytes: Uint8Array;
    results: ResearchResult[];
  }>;
  fetch(uri: string, options: { maximumBytes: number; signal: AbortSignal }): Promise<{
    uri: string;
    capturedAt: string;
    mediaType: string;
    rawBytes: Uint8Array;
    locators?: EvidenceLocatorInput[];
    expiresAt?: string;
  }>;
}
export interface ResearchNormalizer {
  id: string;
  version: string;
  normalize(result: ResearchResult): { label: string; confidence?: number; properties?: Record<string, unknown> };
}
export type ResearchProvenance = { uri: string; capturedAt: string; rawByteSha256: string; byteLength: number };

export const RESEARCH_COLLECTION_SCHEMA: "nodekit.research-collection/v1";
export const RESEARCH_PROVIDER_CONTRACT: "nodekit.research-provider/v1";
export const DEFAULT_RESEARCH_LIMITS: Readonly<NormalizedResearchLimits>;
export function normalizeResearchLimits(input?: ResearchLimits): NormalizedResearchLimits;
export function validateResearchProvider(provider: unknown): string[];
export function searchResearchProvider(provider: ResearchProvider, query: string, limits?: ResearchLimits): Promise<{ query: string; provenance: ResearchProvenance; rawBytes: Uint8Array; results: ResearchResult[] }>;
export function fetchResearchProvider(provider: ResearchProvider, result: ResearchResult, limits?: ResearchLimits): Promise<{ provenance: ResearchProvenance; mediaType: string; locators: EvidenceLocatorInput[]; rawBytes: Uint8Array; expiresAt?: string }>;
export function createIdentityResearchNormalizer(): ResearchNormalizer;
export function createFieldMappingResearchNormalizer(input: { id: string; version?: string; labelField?: "title"; labelTransform?: "identity" | "uppercase" | "lowercase"; confidence?: number; metadataFields?: string[] }): ResearchNormalizer;
export function normalizeResearchResult(result: ResearchResult, normalizer?: ResearchNormalizer): { normalizer: { id: string; version: string }; label: string; confidence: number; properties: Record<string, unknown> };
export function createLocalFixtureResearchProvider(repoRoot: string, fixture: unknown): ResearchProvider;
export function validateResearchCollectionDocument(collection: unknown): string[];
export function collectExternalResearch(repoRoot: string, input: {
  provider: ResearchProvider;
  query?: string;
  queries?: string[];
  normalizer?: ResearchNormalizer;
  graphPath?: string;
  runId: string;
  caseId: string;
  actorId?: string;
  gapIds?: string[];
  contradictionRefs?: string[];
  proposedBy: { agentId: string; modelRoute: string; resolvedModel: string; harnessVersion: string };
  confidence?: number;
  limits?: ResearchLimits;
}): Promise<{ collection: Record<string, unknown> & { collectionId: string; contentHash: string; proposalOnly: true }; collectionPath: string; patch: Record<string, unknown>; action: Record<string, unknown>; proposalOnly: true }>;
export function readLocalResearchFixture(repoRoot: string, candidate: string): Promise<unknown>;
