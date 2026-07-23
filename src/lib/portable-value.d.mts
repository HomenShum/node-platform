export type PortableValue = null | boolean | number | string | PortableValue[] | { [key: string]: PortableValue };

export interface NormalizedStageDefinition {
  id: string;
  label: string;
  owner: string;
  status: "active" | "pending";
}

export const PORTABLE_VALUE_LIMITS: Readonly<{
  maxArrayItems: 8192;
  maxEncodedBytes: number;
  maxEnvelopeBytes: number;
  maxEnvelopeNestingDepth: 15;
  maxNestingDepth: 15;
  maxPayloadNestingDepth: 12;
  maxObjectFields: 1024;
  maxObjectKeyLength: 1024;
}>;
export function normalizePortableValue(value: unknown, label?: string, options?: {
  maxEncodedBytes?: number;
  maxNestingDepth?: number;
}): PortableValue;
export function normalizeStageDefinitions(stages: unknown): NormalizedStageDefinition[];
export function stageDefinitionsMatch(currentStages: unknown, requestedStages: NormalizedStageDefinition[]): boolean;
export function requireTrimmedText(value: unknown, label: string): string;
