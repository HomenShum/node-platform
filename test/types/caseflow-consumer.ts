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

declare const pool: PostgreSqlPool;
const postgres = createPostgresCaseflow({ pool, ownerId: "owner_123" });
void postgres.snapshot();

declare const artifact: NodeKitArtifact<{ value: number }>;
artifact.versions.at(-1)?.content.value satisfies number | undefined;
