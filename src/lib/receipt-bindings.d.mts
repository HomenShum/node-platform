export interface ReceiptEventOrderKey {
  aggregateId: string;
  aggregateType: string;
  eventId: string;
  sequence: number;
}

export function compareCodeUnits(left: string, right: string): number;
export function compareReceiptEventBindings<T extends ReceiptEventOrderKey>(left: T, right: T): number;
export function normalizeReceiptBindings<
  TArtifact extends { artifactId: string },
  TProposal extends { proposalId: string },
  TApproval extends { approvalId: string },
  TEvent extends ReceiptEventOrderKey,
>(bindings: {
  approvalBindings: readonly TApproval[];
  artifactBindings: readonly TArtifact[];
  eventBindings: readonly TEvent[];
  proposalBindings: readonly TProposal[];
}): {
  approvalBindings: TApproval[];
  artifactBindings: TArtifact[];
  artifactIds: string[];
  eventBindings: TEvent[];
  eventIds: string[];
  proposalBindings: TProposal[];
  proposalIds: string[];
};
