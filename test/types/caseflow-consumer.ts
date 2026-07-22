import {
  CASEFLOW_SCHEMA_VERSIONS,
  createMemoryCaseflow,
  runCaseflowConformance,
  type NodeKitArtifact,
} from "@homenshum/nodekit/caseflow";
import {
  createPostgresCaseflow,
  type PostgreSqlPool,
} from "@homenshum/nodekit/adapters/postgres";

const memory = createMemoryCaseflow();
const created = memory.createCase({ title: "Typed case", primaryJob: "Prove the public API" });
void created;
void CASEFLOW_SCHEMA_VERSIONS.case;
void runCaseflowConformance(() => memory);

declare const pool: PostgreSqlPool;
const postgres = createPostgresCaseflow({ pool, ownerId: "owner_123" });
void postgres.snapshot();

declare const artifact: NodeKitArtifact<{ value: number }>;
artifact.versions.at(-1)?.content.value satisfies number | undefined;
