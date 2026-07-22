import type { CaseflowRuntime } from "../caseflow.mjs";

export interface PostgreSqlQueryResult<Row = Record<string, unknown>> {
  rowCount: number | null;
  rows: Row[];
}

export interface PostgreSqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PostgreSqlQueryResult<Row>>;
  release(): void;
}

export interface PostgreSqlPool {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PostgreSqlQueryResult<Row>>;
  connect(): Promise<PostgreSqlClient>;
}

export function createPostgresCaseflow(options: {
  pool: PostgreSqlPool;
  ownerId: string;
  clock?: () => string;
}): CaseflowRuntime;
