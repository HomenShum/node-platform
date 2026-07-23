import {
  CASEFLOW_SCHEMA_VERSIONS,
  normalizePortableValue,
  PORTABLE_VALUE_LIMITS,
  createMemoryCaseflow,
  runCaseflowConformance,
  type NodeKitArtifact,
} from "@homenshum/nodekit/caseflow";
import {
  normalizePortableValue as normalizePortableValueFromRoot,
  PORTABLE_VALUE_LIMITS as PORTABLE_VALUE_LIMITS_FROM_ROOT,
} from "@homenshum/nodekit";
import {
  createPostgresCaseflow,
  type PostgreSqlPool,
} from "@homenshum/nodekit/adapters/postgres";
import {
  SUBMISSION_ATTESTATION_SCHEMA_VERSION,
  canonicalizeAttestationPayload,
  type DetachedAttestation,
} from "@homenshum/nodekit/submission-attestation";
import {
  FINALIZABLE_EXTERNAL_GATES,
  SIGNING_KEY_POLICY_SCHEMA_VERSION,
  finalizeSubmissionEvidence,
  type FinalizableExternalGate,
  type SigningKeyPolicy,
} from "@homenshum/nodekit/submission-evidence-finalizer";
import {
  CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
  prepareExactConsumerPackage,
  type ConsumerPackagePreparationOptions,
} from "@homenshum/nodekit/consumer-package-preparation";
import {
  MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION,
  startManagedEvidenceCampaign,
  type StartManagedEvidenceCampaignOptions,
} from "@homenshum/nodekit/managed-evidence-capture";
import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymStatus,
} from "@homenshum/nodekit/builder-gym";
import {
  computeSkillEvidenceClosure,
  promoteSkillCandidate,
  sealSkillPromotionApproval,
  verifySkillPromotionApproval,
  type SkillPromotionApproval,
  type SkillTrustedKeyMap,
} from "@homenshum/nodekit/skill-evaluation";

declare const skillPromotionApproval: SkillPromotionApproval;
void sealSkillPromotionApproval;
void verifySkillPromotionApproval(skillPromotionApproval, { candidateId: "candidate" });
void promoteSkillCandidate(".", "skill-candidate-example", {
  approvalPath: "proof/approval.json",
  canaryPath: "proof/canary.json",
  proofPath: "proof/integrity.json",
});

const memory = createMemoryCaseflow();
const created = await memory.createCase({ title: "Typed case", primaryJob: "Prove the public API" });
void memory.updateCaseInput({ caseId: created.caseId, primaryJob: "Prove the public API end to end" });
const terminalRun = await memory.startRun({ caseId: created.caseId, stages: [{ id: "work", label: "Work", owner: "agent" }] });
void memory.cancelRun({ runId: terminalRun.runId, reason: "Typed cancellation" });
void created;
void CASEFLOW_SCHEMA_VERSIONS.case;
void normalizePortableValue({ value: 1 });
PORTABLE_VALUE_LIMITS.maxArrayItems satisfies 8192;
void normalizePortableValueFromRoot({ value: 1 });
PORTABLE_VALUE_LIMITS_FROM_ROOT.maxArrayItems satisfies 8192;
void runCaseflowConformance(() => memory);
SUBMISSION_ATTESTATION_SCHEMA_VERSION satisfies "nodekit.detached-attestation/v1";
canonicalizeAttestationPayload({ candidate: "typed" }) satisfies string;
declare const detachedAttestation: DetachedAttestation;
detachedAttestation.algorithm satisfies "Ed25519";
FINALIZABLE_EXTERNAL_GATES satisfies readonly FinalizableExternalGate[];
SIGNING_KEY_POLICY_SCHEMA_VERSION satisfies "nodekit.attestation-signing-key-policy/v1";
declare const signingKeyPolicy: SigningKeyPolicy;
void signingKeyPolicy;
void finalizeSubmissionEvidence;
CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION satisfies "nodekit.consumer-package-provenance/v1";
declare const consumerPackageOptions: ConsumerPackagePreparationOptions;
void consumerPackageOptions;
void prepareExactConsumerPackage;
MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION satisfies "nodekit.managed-evidence-campaign/v1";
declare const managedEvidenceOptions: StartManagedEvidenceCampaignOptions;
void managedEvidenceOptions;
void startManagedEvidenceCampaign;
NODETRACE_VERDICT_DIMENSIONS[0] satisfies "task" | "artifact" | "ui" | "safety" | "efficiency" | "evidence" | "humanPreference";
void builderGymStatus;
void computeSkillEvidenceClosure;
declare const skillTrustedKeys: SkillTrustedKeyMap;
void skillTrustedKeys;

declare const pool: PostgreSqlPool;
const postgres = createPostgresCaseflow({ pool, ownerId: "owner_123" });
void postgres.snapshot();

declare const artifact: NodeKitArtifact<{ value: number }>;
artifact.versions.at(-1)?.content.value satisfies number | undefined;
