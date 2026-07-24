import { FRONTEND_REQUIRED_GUARDRAILS, FRONTEND_REQUIRED_STATES } from "./frontend-specialist.mjs";

// Decide -> Build compiler. An approved OpportunityContract is the boundary the Build stage must
// respect. This turns it into the two things Build actually consumes: a product-design contract for
// the frontend tournament, and an Atlas query for reuse. The point is the seam: the OpportunityContract's
// decided fields become the product contract's PROTECTED fields, so the coding agent cannot re-decide
// the user, the job, the artifact, the data authority, or the permission boundaries while it codes.
// The interpretive design fields get calm, artifact-first defaults the build agent may refine WITHIN
// this boundary; the protected core it may not.

const STANDARD_DESKTOP_SURFACES = Object.freeze([
  "navigation", "primary_artifact", "agent_review_rail", "current_action", "data_freshness",
]);
const STANDARD_MOBILE_SURFACES = Object.freeze([
  "today", "review", "business", "sources", "sticky_action",
]);
const READ_ONLY_JOURNEY = Object.freeze([
  "orient", "connect_sources", "reconcile", "review_exceptions", "verify", "act", "export",
]);

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 64) || "unnamed";
}

// A read-only wedge (nothing in the approve list, or an explicit read-only authority) must not be
// silently upgraded to a write product. The compiler records the authority as an anti-pattern the
// build cannot violate.
function isReadOnly(authorityLimits) {
  return (authorityLimits.approve?.length ?? 0) === 0 && (authorityLimits.propose?.length ?? 0) >= 0
    && (authorityLimits.prohibited ?? []).some((p) => /write|mutate|charge|pay|transfer|delete/i.test(p));
}

/**
 * @param {object} opportunity  a validated nodekit.opportunity-contract/v1
 * @returns {{ productDesignContract: object, atlasQuery: object }}
 */
export function compileOpportunityToBuild(opportunity) {
  const readOnly = isReadOnly(opportunity.authorityLimits);
  const avoid = [...new Set([
    ...FRONTEND_REQUIRED_GUARDRAILS,
    // Every prohibited authority becomes an anti-pattern the interface must not present.
    ...(opportunity.authorityLimits.prohibited ?? []).map((entry) => `prohibited:${slug(entry)}`),
  ])];

  const productDesignContract = {
    schemaVersion: "nodekit.product-design-contract/v1",
    contractId: `opportunity-${slug(opportunity.wedge).slice(0, 40)}`,
    product: {
      targetUser: opportunity.user,
      primaryJob: opportunity.primaryJob,
      primaryArtifact: opportunity.primaryArtifact,
    },
    journey: [...READ_ONLY_JOURNEY],
    designIntent: {
      emotionalTarget: ["trustworthy", "calm", "operational"],
      dominantSurface: "primary_artifact",
      dominantAction: readOnly ? "resolve_next_uncertainty" : "advance_the_primary_job",
      density: "medium",
    },
    interfaceHypothesis: {
      artifactDominance: "the primary artifact occupies the main stage",
      agentPlacement: "the agent remains adjacent, not the product",
      reviewBoundary: "proposals remain distinct from canonical state until approved",
      mobileTopology: "explicit artifact, review, and sources modes rather than a shrunk desktop",
    },
    requiredDesktopSurfaces: [...STANDARD_DESKTOP_SURFACES],
    requiredMobileSurfaces: [...STANDARD_MOBILE_SURFACES],
    avoid,
    requiredStates: [...FRONTEND_REQUIRED_STATES],
    // The OpportunityContract's decisions are protected: the agent cannot re-decide them while coding.
    protectedDecisions: {
      primaryUser: "nodekit",
      primaryJob: "nodekit",
      canonicalWorkflow: "nodekit",
      dataAuthority: "nodekit",
      permissionBoundaries: "nodekit",
      completionCriteria: "nodeproof",
      finalVerdict: "nodeproof",
    },
  };

  // The Atlas query the Build stage runs to reuse proven surfaces rather than reinventing them.
  const atlasQuery = {
    terms: [opportunity.wedge, opportunity.primaryArtifact, opportunity.primaryJob].join(" "),
    supportedDomains: [],
    readOnly,
    fromWedge: opportunity.wedge,
  };

  return { productDesignContract, atlasQuery };
}
