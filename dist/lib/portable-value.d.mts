export declare const PORTABLE_VALUE_LIMITS: Readonly<{
    maxArrayItems: 8192;
    maxEncodedBytes: number;
    maxEnvelopeBytes: number;
    maxEnvelopeNestingDepth: 15;
    maxNestingDepth: 15;
    maxPayloadNestingDepth: 12;
    maxObjectFields: 1024;
    maxObjectKeyLength: 1024;
}>;
/**
 * Normalize a value into NodeKit's provider-portable JSON subset.
 *
 * The function deliberately rejects values whose JavaScript, JSON, Convex,
 * and PostgreSQL representations differ. It also returns a fresh plain value
 * so adapters never store a caller-owned mutable object.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @param {{maxEncodedBytes?: number, maxNestingDepth?: number}} [options]
 * @returns {null | boolean | number | string | Array<unknown> | Record<string, unknown>}
 */
export declare function normalizePortableValue(value: unknown, label?: string, options?: {
    maxEncodedBytes?: number;
    maxNestingDepth?: number;
}): null | boolean | number | string | Array<unknown> | Record<string, unknown>;
/**
 * Validate and normalize the user-authored stage definitions shared by every
 * Caseflow adapter.
 *
 * @param {unknown} stages
 */
export declare function normalizeStageDefinitions(stages: unknown): {
    id: string;
    label: string;
    owner: string;
    status: string;
}[];
/**
 * Compare an active run's possibly-progressed stages with a newly requested
 * immutable stage plan. Runtime status is deliberately ignored.
 *
 * @param {unknown} currentStages
 * @param {Array<{id: string, label: string, owner: string}>} requestedStages
 */
export declare function stageDefinitionsMatch(currentStages: unknown, requestedStages: Array<{
    id: string;
    label: string;
    owner: string;
}>): boolean;
/** @param {unknown} value @param {string} label */
export declare function requireTrimmedText(value: unknown, label: string): string;
//# sourceMappingURL=portable-value.d.mts.map