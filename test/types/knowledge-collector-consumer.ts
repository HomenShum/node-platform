import {
  collectExternalResearch,
  createIdentityResearchNormalizer,
  ingestEvidenceBytes,
  type EvidenceLocatorInput,
  type ResearchProvider,
} from "@homenshum/nodekit";
import { verifyEvidenceSnapshot } from "@homenshum/nodekit/evidence-snapshots";
import { searchResearchProvider } from "@homenshum/nodekit/research-collector";

const pdfLocator: EvidenceLocatorInput = {
  kind: "pdf-page",
  source: "parser",
  pageNumber: 2,
  startByte: 0,
  endByte: 10,
};
void pdfLocator.pageNumber;

declare const provider: ResearchProvider;
const search = searchResearchProvider(provider, "typed source", { maximumResultsPerSearch: 4 });
void search;
void createIdentityResearchNormalizer();
void ingestEvidenceBytes(".", {
  bytes: new Uint8Array([1]),
  sourceUri: "https://example.test/source",
  mediaType: "application/octet-stream",
  locators: [{ kind: "byte-range", source: "user", startByte: 0, endByte: 1 }],
});
void verifyEvidenceSnapshot(".", "evidence_0123456789abcdef01234567");
void collectExternalResearch(".", {
  provider,
  query: "typed source",
  runId: "run:typed",
  caseId: "case:typed",
  proposedBy: { agentId: "agent:typed", modelRoute: "deterministic", resolvedModel: "fixture", harnessVersion: "h0" },
});
