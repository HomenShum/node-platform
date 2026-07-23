import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymContext,
  evaluateBuilderGym,
  sealNodeTraceTrajectory,
  type BuilderGymLock,
  type BuilderGymVerdict,
  type NodeTraceTrajectoryInput,
  type NodeTraceVerdictDimension,
} from "@homenshum/nodekit";

NODETRACE_VERDICT_DIMENSIONS satisfies readonly NodeTraceVerdictDimension[];
declare const input: NodeTraceTrajectoryInput;
const trajectory = sealNodeTraceTrajectory(input);
trajectory.verdicts.safety.score satisfies number;
void builderGymContext(".");
declare const lock: BuilderGymLock;
void evaluateBuilderGym(".", { baseline: trajectory, candidate: trajectory, lock, expectedLockHash: lock.lockHash });
declare const verdict: BuilderGymVerdict;
verdict.realWorldClaimAuthorized satisfies false;
verdict.promotionAuthorized satisfies false;
