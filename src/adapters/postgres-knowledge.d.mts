import type { KnowledgeRuntime } from "../knowledge-runtime.mjs";
import type { PostgreSqlPool } from "./postgres.mjs";

export function createPostgresKnowledgeRuntime(options: {
  pool: PostgreSqlPool;
  ownerId: string;
  clock?: () => string;
}): KnowledgeRuntime;
