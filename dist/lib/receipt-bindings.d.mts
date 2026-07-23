/**
 * Compare strings using JavaScript's stable UTF-16 code-unit ordering.
 *
 * Do not replace this with localeCompare: receipt hashes must not vary with the
 * host locale, ICU version, database collation, or provider query order.
 *
 * @param {string} left
 * @param {string} right
 */
export declare function compareCodeUnits(left: string, right: string): -1 | 0 | 1;
/**
 * @template {{ aggregateId: string, aggregateType: string, eventId: string, sequence: number }} TEvent
 * @param {TEvent} left
 * @param {TEvent} right
 */
export declare function compareReceiptEventBindings<TEvent extends {
    aggregateId: string;
    aggregateType: string;
    eventId: string;
    sequence: number;
}>(left: TEvent, right: TEvent): number;
/**
 * Normalize every receipt binding before hashing it. The returned ID arrays
 * are intentionally derived from the normalized bindings so they cannot drift.
 *
 * @template {{ artifactId: string }} TArtifact
 * @template {{ proposalId: string }} TProposal
 * @template {{ approvalId: string }} TApproval
 * @template {{ aggregateId: string, aggregateType: string, eventId: string, sequence: number }} TEvent
 * @param {{
 *   approvalBindings: readonly TApproval[],
 *   artifactBindings: readonly TArtifact[],
 *   eventBindings: readonly TEvent[],
 *   proposalBindings: readonly TProposal[],
 * }} bindings
 */
export declare function normalizeReceiptBindings<TArtifact extends {
    artifactId: string;
}, TProposal extends {
    proposalId: string;
}, TApproval extends {
    approvalId: string;
}, TEvent extends {
    aggregateId: string;
    aggregateType: string;
    eventId: string;
    sequence: number;
}>(bindings: {
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
//# sourceMappingURL=receipt-bindings.d.mts.map