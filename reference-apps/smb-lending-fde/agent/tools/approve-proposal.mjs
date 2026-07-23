export const tool = Object.freeze({
  id: "lending.approve-proposal",
  version: "1.0.0",
  async execute({ proposal, session }) {
    if (!proposal || proposal.status !== "pending_approval") {
      throw new Error("proposal is not available for human approval");
    }
    const document = session.documents.find((entry) => entry.id === proposal.documentId);
    if (!document || document.status !== "missing") {
      throw new Error("proposal target is no longer missing");
    }

    proposal.status = "approved";
    proposal.approvedAt = new Date().toISOString();
    document.status = "requested";
    return {
      action: proposal.action,
      documentId: document.id,
      proposalId: proposal.id,
      resultingDocumentStatus: document.status,
      resultingProposalStatus: proposal.status,
    };
  },
});
