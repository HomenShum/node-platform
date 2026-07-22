/**
 * Compare strings using JavaScript's stable UTF-16 code-unit ordering.
 *
 * Do not replace this with localeCompare: receipt hashes must not vary with the
 * host locale, ICU version, database collation, or provider query order.
 *
 * @param {string} left
 * @param {string} right
 */
export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * @template {{ aggregateId: string, aggregateType: string, eventId: string, sequence: number }} TEvent
 * @param {TEvent} left
 * @param {TEvent} right
 */
export function compareReceiptEventBindings(left, right) {
  return compareCodeUnits(left.aggregateType, right.aggregateType)
    || compareCodeUnits(left.aggregateId, right.aggregateId)
    || left.sequence - right.sequence
    || compareCodeUnits(left.eventId, right.eventId);
}

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
export function normalizeReceiptBindings(bindings) {
  const artifactBindings = [...bindings.artifactBindings]
    .sort((left, right) => compareCodeUnits(left.artifactId, right.artifactId));
  const proposalBindings = [...bindings.proposalBindings]
    .sort((left, right) => compareCodeUnits(left.proposalId, right.proposalId));
  const approvalBindings = [...bindings.approvalBindings]
    .sort((left, right) => compareCodeUnits(left.approvalId, right.approvalId));
  const eventBindings = [...bindings.eventBindings].sort(compareReceiptEventBindings);

  return {
    approvalBindings,
    artifactBindings,
    artifactIds: artifactBindings.map((entry) => entry.artifactId),
    eventBindings,
    eventIds: eventBindings.map((entry) => entry.eventId),
    proposalBindings,
    proposalIds: proposalBindings.map((entry) => entry.proposalId),
  };
}
