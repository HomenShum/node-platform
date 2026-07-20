export function inspectSyntheticLendingFile(session) {
  if (!session || session.schemaVersion !== "nodekit.smb-lending-session/v1") {
    throw new Error("a synthetic lending-file session is required");
  }
  return {
    applicant: session.applicant,
    caseId: session.caseId,
    documents: session.documents.map(({ id, label, source, status }) => ({ id, label, source, status })),
    humanAuthority: "A human underwriter or credit authority makes all lending decisions.",
    missingDocumentIds: session.readiness.missingDocumentIds,
    objective: session.objective,
  };
}
