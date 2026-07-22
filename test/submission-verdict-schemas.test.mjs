import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { exactSubmissionVerdicts } from "./submission-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateCommit = "a".repeat(40);

const verdictSchemas = Object.freeze({
  developerTimingMatrix: "nodekit.developer-timing-verdict.v1.schema.json",
  freshAgentHeldout: "nodekit.fresh-agent-verdict.v2.schema.json",
  freshHumanUsability: "nodekit.fresh-user-verdict.v1.schema.json",
  threeConvexConsumers: "nodekit.convex-consumers-verdict.v1.schema.json",
  previewDeployment: "nodekit.preview-verdict.v1.schema.json",
  managedSupabasePortability: "nodekit.managed-supabase-portability-verdict.v1.schema.json",
  knowledgeEvolutionAdoption: "nodekit.knowledge-evolution-adoption-verdict.v1.schema.json",
  modelIntelligenceHarness: "nodekit.model-intelligence-harness-verdict.v1.schema.json",
  engineeringHealth: "nodekit.engineering-health-verdict.v1.schema.json",
  packageInstallProof: "nodekit.package-install-proof.v1.schema.json",
  proofloopEaseVerification: "nodekit.proofloop-ease-verification.v1.schema.json",
  publicationApproval: "nodekit.publication-approval.v1.schema.json",
});

async function validators() {
  return Object.fromEntries(await Promise.all(Object.entries(verdictSchemas).map(async ([gateId, schemaFile]) => {
    const schema = JSON.parse(await readFile(path.join(root, "schemas", schemaFile), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return [gateId, ajv.compile(schema)];
  })));
}

function validationMessage(validate) {
  return JSON.stringify(validate.errors ?? [], null, 2);
}

test("all decisive submission verdict schemas accept the exact fixture contracts", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  for (const [gateId, validate] of Object.entries(compiled)) {
    assert.equal(validate(verdicts[gateId]), true, `${gateId}: ${validationMessage(validate)}`);
  }
});

test("decisive verdict schemas reject unknown top-level and release-candidate fields", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  for (const [gateId, validate] of Object.entries(compiled)) {
    const unknownTopLevel = structuredClone(verdicts[gateId]);
    unknownTopLevel.unverifiedClaim = true;
    assert.equal(validate(unknownTopLevel), false, `${gateId} accepted an unknown top-level claim`);

    const unknownCandidateField = structuredClone(verdicts[gateId]);
    unknownCandidateField.releaseCandidate.unboundArchive = "candidate.tgz";
    assert.equal(validate(unknownCandidateField), false, `${gateId} accepted an unbound release-candidate field`);
  }
});

test("decisive verdict schemas require their complete evidence-bearing structures", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  const requiredFieldByGate = {
    developerTimingMatrix: "selectedRuns",
    freshAgentHeldout: "selectedRuns",
    freshHumanUsability: "metrics",
    threeConvexConsumers: "consumers",
    previewDeployment: "evidence",
    managedSupabasePortability: "evidence",
    knowledgeEvolutionAdoption: "comparison",
    modelIntelligenceHarness: "evaluation",
    engineeringHealth: "commands",
    packageInstallProof: "supportingEvidence",
    proofloopEaseVerification: "extensions",
    publicationApproval: "attestation",
  };
  for (const [gateId, field] of Object.entries(requiredFieldByGate)) {
    const missing = structuredClone(verdicts[gateId]);
    delete missing[field];
    const validate = compiled[gateId];
    assert.equal(validate(missing), false, `${gateId} accepted a verdict missing ${field}`);
  }
});

test("all evidence-bearing verdict schemas reject non-canonical repository paths", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  const aliases = {
    developerTimingMatrix: (value) => { value.supportingEvidence[0].path = "proof/ease/./developer-timing-runs.json"; },
    freshAgentHeldout: (value) => { value.selectedRuns[0].evidence[0].path = "proof/ease//agents/prompt.json"; },
    freshHumanUsability: (value) => { value.selectedParticipants[0].evidenceRefs[0].path = "proof/ease//humans/completion.png"; },
    threeConvexConsumers: (value) => { value.consumers[0].evidence[0].path = "../nodekit-component.tgz"; },
    previewDeployment: (value) => { value.evidence[0].path = "C:/proof/browser-proof.json"; },
    managedSupabasePortability: (value) => { value.evidence[0].path = "../proof/supabase.json"; },
    knowledgeEvolutionAdoption: (value) => { value.evidence[0].path = "proof/evolution//comparison.json"; },
    modelIntelligenceHarness: (value) => { value.evidence[0].path = "./proof/model.json"; },
    engineeringHealth: (value) => { value.commands[0].path = "proof/engineering/../check.json"; },
    packageInstallProof: (value) => { value.supportingEvidence[0].path = "proof\\package\\application-identity.json"; },
    proofloopEaseVerification: (value) => { value.extensions.decisiveEvidence[0].path = "./proof/package-install-verdict.json"; },
    publicationApproval: (value) => { value.attestationPayload.submissionManifest.path = "proof/submission/../submission-candidate.json"; },
  };
  for (const [gateId, mutate] of Object.entries(aliases)) {
    const aliased = structuredClone(verdicts[gateId]);
    mutate(aliased);
    const validate = compiled[gateId];
    assert.equal(validate(aliased), false, `${gateId} accepted a non-canonical evidence path`);
  }
});

test("decisive schemas reject downgraded outcomes and incomplete exact evidence sets", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  const downgraded = {
    developerTimingMatrix: (value) => { value.passed = false; },
    freshAgentHeldout: (value) => { value.observedTrials = 14; },
    freshHumanUsability: (value) => { value.checks.unassistedCompletion = false; },
    threeConvexConsumers: (value) => { value.consumers[0].checks.crossOwnerDenied = false; },
    previewDeployment: (value) => { value.screenshotCount = 179; },
    managedSupabasePortability: (value) => { value.checks.realtimeDelivery = false; },
    knowledgeEvolutionAdoption: (value) => { value.consumerAdoption.adopted = false; },
    modelIntelligenceHarness: (value) => { value.promotionStatus = "promoted"; },
    engineeringHealth: (value) => { value.unresolved.p1 = 1; },
    packageInstallProof: (value) => { value.supportingEvidence.pop(); },
    proofloopEaseVerification: (value) => { value.verdict.status = "failed"; },
    publicationApproval: (value) => { value.approved = false; },
  };
  for (const [gateId, mutate] of Object.entries(downgraded)) {
    const invalid = structuredClone(verdicts[gateId]);
    mutate(invalid);
    const validate = compiled[gateId];
    assert.equal(validate(invalid), false, `${gateId} accepted a downgraded or incomplete verdict`);
  }
});

test("externally observed verdict schemas require strict attestations and hosted preview identity", async () => {
  const compiled = await validators();
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  for (const gateId of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    const unsigned = structuredClone(verdicts[gateId]);
    delete unsigned.attestation;
    assert.equal(compiled[gateId](unsigned), false, `${gateId} accepted an unsigned verdict`);
    const wrongPurpose = structuredClone(verdicts[gateId]);
    wrongPurpose.attestation.payloadType = "publicationApproval";
    assert.equal(compiled[gateId](wrongPurpose), false, `${gateId} accepted an attestation for another purpose`);
  }
  for (const field of ["deploymentUrl", "deploymentProvider", "deploymentEnvironment", "deploymentIdentity", "deploymentReceipt"]) {
    const incomplete = structuredClone(verdicts.previewDeployment);
    delete incomplete[field];
    assert.equal(compiled.previewDeployment(incomplete), false, `previewDeployment accepted missing ${field}`);
  }
});
