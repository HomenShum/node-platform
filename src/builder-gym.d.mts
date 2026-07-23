export type NodeTraceHash = string;
export type NodeTraceVerdictDimension = "task" | "artifact" | "ui" | "safety" | "efficiency" | "evidence" | "humanPreference";

export interface NodeTraceEvidence {
  kind: "task" | "artifact" | "screenshot" | "trace" | "test" | "receipt" | "human-preference" | "other";
  path: string;
  sha256: NodeTraceHash;
}

export interface NodeTraceFinding {
  code: string;
  severity: "P0" | "P1" | "P2" | "P3";
  message: string;
  evidenceHashes: NodeTraceHash[];
}

export interface NodeTraceDimensionVerdict {
  passed: boolean;
  score: number;
  findings: NodeTraceFinding[];
  evidenceHashes: NodeTraceHash[];
}

export interface NodeTraceEfficiencyVerdict extends NodeTraceDimensionVerdict {
  metrics: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    turns: number;
    toolCalls: number;
    retries: number;
    repairRounds: number;
  };
}

export interface NodeTraceHumanPreferenceVerdict {
  status: "not-collected" | "baseline-preferred" | "candidate-preferred" | "tie";
  score: number | null;
  reviewerClass: "none" | "operator" | "domain-expert" | "independent-reviewer";
  evidenceHashes: NodeTraceHash[];
}

export interface NodeTraceTrajectory {
  schemaVersion: "nodekit.nodetrace-trajectory/v1";
  trajectoryId: string;
  trajectoryHash: NodeTraceHash;
  recordedAt: string;
  applicationId: string;
  runId: string;
  candidateId: string;
  arm: "baseline" | "candidate";
  task: { id: string; family: string; taskSetHash: NodeTraceHash; briefHash: NodeTraceHash };
  model: { requestedRoute: string; resolvedProvider: string; resolvedModel: string; modelRevision?: string };
  harness: {
    version: string;
    builderHash: NodeTraceHash;
    runtimeHash: NodeTraceHash;
    interactionHash: NodeTraceHash;
    toolSurfaceHash: NodeTraceHash;
    contextPolicyHash: NodeTraceHash;
    skillStackHash: NodeTraceHash;
  };
  evaluator: { id: string; version: number; hash: NodeTraceHash };
  budgets: { maximumTokens: number; maximumCostUsd: number; maximumDurationMs: number };
  changedPaths: string[];
  changeSet: {
    generatedBy: "trusted-vcs" | "external-orchestrator";
    baseRevision: string;
    candidateRevision: string;
    lockHash: NodeTraceHash | null;
    changedPaths: string[];
    evidencePath: string;
    evidenceHash: NodeTraceHash;
  };
  events: Array<{
    sequence: number;
    eventId: string;
    name: string;
    summary: string;
    type: "task" | "decision" | "tool" | "artifact" | "ui" | "safety" | "verification" | "human-preference" | "completion";
    actor: "user" | "builder-agent" | "runtime" | "tool" | "critic" | "evaluator" | "reviewer";
    occurredAt: string;
    status: "started" | "completed" | "failed" | "blocked" | "skipped";
    inputHashes: NodeTraceHash[];
    outputHashes: NodeTraceHash[];
    evidenceHashes: NodeTraceHash[];
  }>;
  artifacts: Array<{ artifactId: string; kind: string; version: string; contentHash: NodeTraceHash; evidenceHashes: NodeTraceHash[] }>;
  verdicts: {
    task: NodeTraceDimensionVerdict;
    artifact: NodeTraceDimensionVerdict;
    ui: NodeTraceDimensionVerdict;
    safety: NodeTraceDimensionVerdict;
    efficiency: NodeTraceEfficiencyVerdict;
    evidence: NodeTraceDimensionVerdict;
    humanPreference: NodeTraceHumanPreferenceVerdict;
  };
  evidence: NodeTraceEvidence[];
  proofReceiptId: string;
  measurementAuthority: {
    dimensionVerdicts: "trajectory-self-reported";
    proofReceiptId: "trajectory-self-reported";
    protectedEvaluatorDerived: false;
  };
}

export type NodeTraceTrajectoryInput = Omit<NodeTraceTrajectory, "trajectoryId" | "trajectoryHash"> & {
  trajectoryId?: string;
  trajectoryHash?: NodeTraceHash;
};

export interface BuilderGymDimensionComparison {
  baseline: number | null;
  candidate: number | null;
  outcome: "improved" | "held" | "regressed" | "unmeasured";
  passed: boolean;
  reason: string;
}

export interface BuilderGymVerdict {
  schemaVersion: "nodekit.builder-gym-verdict/v1";
  comparisonId: string;
  verdictHash: NodeTraceHash;
  gymId: "nodekit-builder";
  baselineTrajectoryHash: NodeTraceHash;
  candidateTrajectoryHash: NodeTraceHash;
  evaluatorHash: NodeTraceHash;
  lockHash: NodeTraceHash;
  protectedEvaluatorUnchanged: true;
  fixedInputsHeld: true;
  measurementAuthority: "trajectory-self-reported";
  protectedEvaluationPassed: false;
  dimensions: Record<NodeTraceVerdictDimension, BuilderGymDimensionComparison>;
  improvedDimensions: NodeTraceVerdictDimension[];
  heldDimensions: NodeTraceVerdictDimension[];
  regressedDimensions: NodeTraceVerdictDimension[];
  outcome: "improved" | "held" | "regressed";
  passed: boolean;
  realWorldClaimAuthorized: false;
  promotionAuthorized: false;
  nextRequirements: string[];
  output: string;
}

export const NODETRACE_VERDICT_DIMENSIONS: readonly NodeTraceVerdictDimension[];
export function sealNodeTraceTrajectory(input: NodeTraceTrajectoryInput): NodeTraceTrajectory;
export function verifyNodeTraceTrajectory(value: NodeTraceTrajectory): Promise<{ trajectory: NodeTraceTrajectory; trajectoryHash: NodeTraceHash; verified: true }>;
export function verifyBuilderGymLock(value: BuilderGymLock): Promise<{ lock: BuilderGymLock; lockHash: NodeTraceHash; verified: true }>;
export function verifyBuilderGymVerdict(value: Omit<BuilderGymVerdict, "output">): Promise<{ verdict: Omit<BuilderGymVerdict, "output">; verdictHash: NodeTraceHash; verified: true }>;
export function initializeBuilderGym(repoRoot: string): Promise<{ applicationId: string; created: string[]; evaluatorHash: NodeTraceHash; gymPath: string; protectedRoots: string[]; automaticPromotion: false }>;
export function recordNodeTraceTrajectory(repoRoot: string, trajectoryOrPath: string | NodeTraceTrajectory): Promise<{ trajectory: NodeTraceTrajectory; trajectoryHash: NodeTraceHash; output: string; evaluatorHash: NodeTraceHash; protected: true }>;
export function inspectNodeTraceTrajectory(repoRoot: string, reference: string): Promise<{ trajectory: NodeTraceTrajectory; trajectoryHash: NodeTraceHash; evaluatorHash: NodeTraceHash; protectedTaskSetHash: NodeTraceHash; verified: true }>;
export function inspectBuilderGymVerdict(repoRoot: string, reference: string): Promise<{ verdict: Omit<BuilderGymVerdict, "output">; verdictHash: NodeTraceHash; evaluatorHash: NodeTraceHash; verified: true }>;
export interface BuilderGymLock {
  schemaVersion: "nodekit.builder-gym-lock/v1";
  lockId: string;
  lockHash: NodeTraceHash;
  gymId: "nodekit-builder";
  applicationId: string;
  evaluatorHash: NodeTraceHash;
  protectedTaskSetHash: NodeTraceHash;
  protectedRootHash: NodeTraceHash;
  baselineTrajectoryHash: NodeTraceHash;
  baselineRevision: string;
  protectedRoots: string[];
  candidateWriteRoots: string[];
  fixedInputs: Record<string, unknown>;
  automaticPromotion: false;
}
export function createBuilderGymLock(repoRoot: string, baseline: string | NodeTraceTrajectory): Promise<BuilderGymLock & { output: string }>;
export function evaluateBuilderGym(repoRoot: string, options: { baseline: string | NodeTraceTrajectory; candidate: string | NodeTraceTrajectory; lock: string | BuilderGymLock; expectedLockHash: NodeTraceHash }): Promise<BuilderGymVerdict>;
export function builderGymStatus(repoRoot: string): Promise<{ schemaVersion: "nodekit.builder-gym-status/v1"; gymId: "nodekit-builder"; applicationId: string; evaluatorId: string; evaluatorHash: NodeTraceHash; protectedTaskSetHash: NodeTraceHash; protectedTaskCount: number; trajectoryCount: number; lockCount: number; verdictCount: number; dimensions: NodeTraceVerdictDimension[]; protectedRoots: string[]; candidateWriteRoots: string[]; mechanicsReady: true; realWorldEvidence: false; promotionAuthorized: false; automaticPromotion: false }>;
export function builderGymContext(repoRoot: string): Promise<{ applicationId: string; evaluator: { id: string; version: number; hash: NodeTraceHash }; protectedTaskSetHash: NodeTraceHash; protectedTaskIds: string[]; candidateWriteRoots: string[]; protectedRoots: string[] }>;
