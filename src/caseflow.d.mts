export type NodeKitActor = {
  id: string;
  type: "agent" | "human" | "policy" | "system" | string;
};

export type NodeKitStageOwner = "agent" | "external" | "reviewer" | "system" | "user" | string;
export type NodeKitRunStatus = "active" | "blocked" | "cancelled" | "completed" | "failed_safely";
export type NodeKitProposalStatus = "accepted" | "conflicted" | "pending" | "rejected";

export interface NodeKitStage {
  id: string;
  label: string;
  owner: NodeKitStageOwner;
  status: "active" | "completed" | "pending";
}

export interface NodeKitCase {
  caseId: string;
  createdAt: string;
  currentRunId: string | null;
  primaryJob: string;
  schemaVersion: "nodekit.case/v1";
  status: "completed" | "in_progress" | "ready";
  title: string;
  updatedAt: string;
}

export interface NodeKitRun {
  caseId: string;
  createdAt: string;
  currentStageId: string;
  nextAction: string;
  nextActionOwner: NodeKitStageOwner;
  runId: string;
  schemaVersion: "nodekit.run/v1";
  stages: NodeKitStage[];
  status: NodeKitRunStatus;
  updatedAt: string;
}

export interface NodeKitArtifactVersion<T = unknown> {
  content: T;
  contentHash: string;
  createdAt: string;
  proposalId?: string;
  version: number;
}

export interface NodeKitArtifact<T = unknown> {
  artifactId: string;
  caseId: string;
  canonicalVersion: number;
  createdAt: string;
  kind: string;
  runId: string;
  schemaVersion: "nodekit.artifact/v1";
  title: string;
  updatedAt: string;
  versions: NodeKitArtifactVersion<T>[];
}

export interface NodeKitProposal<T = unknown> {
  artifactId: string;
  baseVersion: number;
  createdAt: string;
  patch: T;
  proposalId: string;
  rationale: string;
  schemaVersion: "nodekit.proposal/v1";
  status: NodeKitProposalStatus;
}

export interface NodeKitApproval {
  approvalId: string;
  comment: string;
  decidedAt: string;
  decision: "accepted" | "rejected";
  proposalId: string;
  schemaVersion: "nodekit.approval/v1";
}

export interface NodeKitException<T = unknown> {
  code: string;
  exceptionId: string;
  message: string;
  preservedState: T;
  raisedAt: string;
  resolution: string | null;
  resolvedAt?: string;
  runId: string;
  schemaVersion: "nodekit.exception/v1";
  status: "open" | "resolved";
}

export interface NodeKitReceipt {
  artifactIds: string[];
  caseId: string;
  eventIds: string[];
  generatedAt: string;
  proposalIds: string[];
  receiptHash: string;
  receiptId: string;
  runId: string;
  schemaVersion: "nodekit.receipt/v1";
  status: "completed";
}

export interface NodeKitEvent<T = unknown> {
  actor: NodeKitActor;
  aggregateId: string;
  aggregateType: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: T;
  schemaVersion: "nodekit.caseflow-event/v1";
  sequence: number;
}

export interface NodeKitCaseflowSnapshot {
  approvals: NodeKitApproval[];
  artifacts: NodeKitArtifact[];
  cases: NodeKitCase[];
  events: NodeKitEvent[];
  exceptions: NodeKitException[];
  proposals: NodeKitProposal[];
  receipts: NodeKitReceipt[];
  runs: NodeKitRun[];
}

export interface RuntimeCapabilities {
  schemaVersion: "nodekit.runtime-capabilities/v1";
  provider: string;
  durableState: boolean;
  transactions: boolean;
  optimisticConcurrency: boolean;
  subscriptions: "event-driven" | "native" | "polling" | "snapshot";
  durableJobs: "external" | "in-process" | "native" | "queue-backed";
  fileStorage: boolean;
  presence: boolean;
  scheduledJobs: boolean;
  localDevelopment: boolean;
}

export type MaybePromise<T> = Promise<T> | T;

export interface CaseflowRuntime {
  capabilities: RuntimeCapabilities;
  createCase(input: { title: string; primaryJob: string; actor?: NodeKitActor }): MaybePromise<NodeKitCase>;
  startRun(input: { caseId: string; stages: Array<Pick<NodeKitStage, "id" | "label" | "owner">>; actor?: NodeKitActor }): MaybePromise<NodeKitRun>;
  enterStage(input: { runId: string; stageId: string; nextAction?: string; nextActionOwner?: NodeKitStageOwner; actor?: NodeKitActor }): MaybePromise<NodeKitRun>;
  createArtifact<T = unknown>(input: { caseId: string; runId: string; kind?: string; title?: string; content: T; actor?: NodeKitActor }): MaybePromise<NodeKitArtifact<T>>;
  createProposal<T = unknown>(input: { artifactId: string; baseVersion: number; patch: T; rationale?: string; actor?: NodeKitActor }): MaybePromise<NodeKitProposal<T>>;
  decideProposal(input: { proposalId: string; decision: "accepted" | "rejected"; comment?: string; actor?: NodeKitActor }): MaybePromise<{
    approval: NodeKitApproval;
    artifact: NodeKitArtifact;
    proposal: NodeKitProposal;
    reused: boolean;
  }>;
  raiseException<T = unknown>(input: { runId: string; code?: string; message?: string; preservedState?: T; actor?: NodeKitActor }): MaybePromise<NodeKitException<T>>;
  resolveException(input: { exceptionId: string; resolution?: string; nextAction?: string; nextActionOwner?: NodeKitStageOwner; actor?: NodeKitActor }): MaybePromise<{
    exception: NodeKitException;
    run: NodeKitRun;
  }>;
  completeRun(input: { runId: string; actor?: NodeKitActor }): MaybePromise<{
    receipt: NodeKitReceipt;
    run: NodeKitRun;
    reused: boolean;
  }>;
  snapshot(): MaybePromise<NodeKitCaseflowSnapshot>;
}

export interface CaseflowConformanceVerdict {
  assertions: Record<string, boolean>;
  capabilities: RuntimeCapabilities;
  capabilityNegotiation: {
    missing: Array<{ actual: unknown; expected: unknown; name: string }>;
    passed: boolean;
    provider: string;
    schemaVersion: "nodekit.runtime-capability-negotiation/v1";
  };
  passed: boolean;
  schemaVersion: "nodekit.adapter-conformance/v1";
}

export const CASEFLOW_SCHEMA_VERSIONS: Readonly<{
  approval: "nodekit.approval/v1";
  artifact: "nodekit.artifact/v1";
  case: "nodekit.case/v1";
  event: "nodekit.caseflow-event/v1";
  exception: "nodekit.exception/v1";
  proposal: "nodekit.proposal/v1";
  receipt: "nodekit.receipt/v1";
  run: "nodekit.run/v1";
  stage: "nodekit.stage/v1";
}>;

export const TERMINAL_RUN_STATUSES: readonly NodeKitRunStatus[];
export function contentHash(value: unknown): string;
export function createMemoryCaseflow(options?: { clock?: () => string }): CaseflowRuntime;
export function runCaseflowConformance(
  createRuntime: () => MaybePromise<CaseflowRuntime>,
  options?: { requiredCapabilities?: Partial<RuntimeCapabilities> },
): Promise<CaseflowConformanceVerdict>;
export function negotiateRuntimeCapabilities(
  offered: RuntimeCapabilities,
  required?: Partial<RuntimeCapabilities>,
): CaseflowConformanceVerdict["capabilityNegotiation"];
export const runtimeProfiles: Readonly<Record<"convex" | "memory" | "postgres" | "supabase", RuntimeCapabilities>>;
