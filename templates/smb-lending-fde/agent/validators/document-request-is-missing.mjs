export const validator = Object.freeze({
  id: "document-request-is-missing",
  version: "1.0.0",
  async validate({ proposal, session }) {
    if (proposal?.action !== "request_document") {
      return {
        details: { action: proposal?.action ?? null, skipped: true },
        message: "Document-target validation is not applicable because this is not a document request.",
        passed: true,
      };
    }
    const document = session?.documents?.find((entry) => entry.id === proposal.documentId);
    const passed = Boolean(document && document.status === "missing");
    return {
      details: {
        documentId: proposal.documentId ?? null,
        observedStatus: document?.status ?? null,
      },
      message: passed
        ? "The proposal targets a currently missing required document."
        : "The proposal does not target a currently missing required document.",
      passed,
    };
  },
});
