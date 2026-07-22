import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringify as stringifyYaml } from "yaml";
import {
  FRONTEND_REQUIRED_STATES,
  FRONTEND_REQUIRED_VIEWS,
  compileFrontendPlan,
  createFrontendDirections,
  createFrontendRepairPlan,
  evaluateFrontendTournament,
  initializeFrontendHarness,
  verifyFrontendCanary,
} from "../src/lib/frontend-specialist.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-frontend-"));
  await mkdir(path.join(root, "harness"), { recursive: true });
  const initialized = await initializeFrontendHarness(root);
  const contract = {
    schemaVersion: "nodekit.product-design-contract/v1",
    contractId: "contract-verified-business",
    product: { targetUser: "salon_owner", primaryJob: "understand_verified_profit", primaryArtifact: "verified_business_brief" },
    journey: ["orient", "connect_sources", "reconcile", "review_exceptions", "verify", "act", "export"],
    designIntent: { emotionalTarget: ["trustworthy", "calm", "operational"], dominantSurface: "verified_brief", dominantAction: "resolve_next_exception", density: "medium" },
    interfaceHypothesis: { artifactDominance: "brief occupies the primary stage", agentPlacement: "agent remains adjacent", reviewBoundary: "proposals remain distinct from canonical state", mobileTopology: "explicit artifact, review, and agent modes" },
    requiredDesktopSurfaces: ["navigation", "primary_artifact", "agent_review_rail", "current_action", "data_freshness"],
    requiredMobileSurfaces: ["today", "review", "business", "sources", "sticky_action"],
    avoid: ["generic_kpi_dashboard", "accounting_schema_as_interface", "decorative_chat", "all_workflow_states_expanded", "hidden_data_freshness"],
    requiredStates: [...FRONTEND_REQUIRED_STATES],
    protectedDecisions: { primaryUser: "nodekit", primaryJob: "nodekit", canonicalWorkflow: "nodekit", dataAuthority: "nodekit", permissionBoundaries: "nodekit", completionCriteria: "nodeproof", finalVerdict: "nodeproof" },
  };
  const contractPath = path.join(root, "harness", "frontend", "product-packets", "verified-business.yaml");
  await writeFile(contractPath, stringifyYaml(contract));
  return { contract, contractPath, initialized, root };
}

test("frontend planning protects product decisions and refuses reputation-only routing", async () => {
  const { contractPath, initialized, root } = await fixture();
  const output = await compileFrontendPlan(root, path.relative(root, contractPath));
  assert.equal(output.plan.finalVerdictAuthority, "nodeproof");
  assert.equal(output.plan.directionCount, 3);
  assert.equal(output.plan.requestedRoute, null);

  const route = await readFile(initialized.routePath, "utf8");
  await writeFile(initialized.routePath, route.replace("status: unprofiled", "status: evidence-ranked").replace("preferredRoute: null", "preferredRoute: moonshotai/kimi-k3"));
  await assert.rejects(() => compileFrontendPlan(root, path.relative(root, contractPath)), /requires evidenceRefs/);
});

test("Frontend Gym requires three materially distinct rendered directions and blind independent selection", async () => {
  const { contractPath, root } = await fixture();
  const { plan, output: planOutput } = await compileFrontendPlan(root, path.relative(root, contractPath));
  const { directionSet, output: directionOutput } = await createFrontendDirections(root, path.relative(root, planOutput));
  assert.deepEqual(directionSet.candidates.map((candidate) => candidate.archetype), ["collaborative-workspace", "artifact-studio", "domain-native"]);
  for (const candidate of directionSet.candidates) {
    candidate.status = "rendered";
    candidate.viewEvidence = Object.fromEntries(FRONTEND_REQUIRED_VIEWS.map((view) => [view, `proof/${candidate.candidateId}/${view}.png`]));
  }
  await writeFile(directionOutput, `${JSON.stringify(directionSet, null, 2)}\n`);
  const score = (offset) => Object.fromEntries(["primaryJobClarity", "artifactDominance", "workflowHierarchy", "agentLegibility", "reviewSafety", "mobileOperation", "domainAppropriateness", "visualQuality"].map((key, index) => [key, Math.min(1, 0.7 + offset + index * 0.005)]));
  const benchmark = {
    schemaVersion: "nodekit.frontend-benchmark/v1",
    benchmarkId: "frontend-gym-1",
    directionSet: path.relative(root, directionOutput).replaceAll("\\", "/"),
    scores: { "direction-a": score(0), "direction-b": score(0.05), "direction-c": score(0.1) },
    pairwiseResults: [
      { left: "direction-a", right: "direction-b", winner: "direction-b", evidenceRefs: ["critic-1"] },
      { left: "direction-a", right: "direction-c", winner: "direction-c", evidenceRefs: ["critic-2"] },
      { left: "direction-b", right: "direction-c", winner: "direction-c", evidenceRefs: ["critic-3"] },
    ],
    criticIndependent: true,
    browserChecksPassed: true,
    accessibilityPassed: true,
    overflowPassed: true,
    majorFindings: [],
    freshUserEvidenceRefs: ["fresh-user-1"],
  };
  const benchmarkPath = path.join(root, "harness", "frontend", "benchmark.json");
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`);
  const result = await evaluateFrontendTournament(root, path.relative(root, benchmarkPath));
  assert.equal(result.decision.selectedCandidateId, "direction-c");
  assert.equal(result.promotionAuthorized, false);
  assert.equal(result.decisive, true);
  assert.equal(plan.deploymentAuthorized, false);
});

test("frontend repair is bounded and a canary requires exact model, screenshots, NodeProof, and human approval", async () => {
  const { root } = await fixture();
  const benchmark = {
    schemaVersion: "nodekit.frontend-benchmark/v1",
    benchmarkId: "blocked-ui",
    directionSet: "harness/frontend/design-directions/unused.json",
    scores: { a: Object.fromEntries(["primaryJobClarity", "artifactDominance", "workflowHierarchy", "agentLegibility", "reviewSafety", "mobileOperation", "domainAppropriateness", "visualQuality"].map((key) => [key, 0.5])), b: Object.fromEntries(["primaryJobClarity", "artifactDominance", "workflowHierarchy", "agentLegibility", "reviewSafety", "mobileOperation", "domainAppropriateness", "visualQuality"].map((key) => [key, 0.5])), c: Object.fromEntries(["primaryJobClarity", "artifactDominance", "workflowHierarchy", "agentLegibility", "reviewSafety", "mobileOperation", "domainAppropriateness", "visualQuality"].map((key) => [key, 0.5])) },
    pairwiseResults: [{ left: "a", right: "b", winner: "a", evidenceRefs: ["e1"] }, { left: "a", right: "c", winner: "a", evidenceRefs: ["e2"] }, { left: "b", right: "c", winner: "b", evidenceRefs: ["e3"] }],
    criticIndependent: true, browserChecksPassed: false, accessibilityPassed: true, overflowPassed: true, majorFindings: ["PRODUCT_TOPOLOGY_MISS"], freshUserEvidenceRefs: [],
  };
  const benchmarkPath = path.join(root, "harness", "frontend", "blocked.json");
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`);
  const { repair } = await createFrontendRepairPlan(root, path.relative(root, benchmarkPath));
  assert.equal(repair.maximumRounds, 2);
  assert.equal(repair.preservePriorImplementation, true);

  const canaryPath = path.join(root, "harness", "frontend", "canary.json");
  await writeFile(canaryPath, `${JSON.stringify({ candidateId: "direction-c", commitSha: "a".repeat(40), requestedRoute: "frontend", resolvedProvider: "provider", resolvedModel: "model", freshIdentity: true, renderedJourney: true, screenshotEvidenceRefs: FRONTEND_REQUIRED_VIEWS, nodeProofPassed: true, majorFindings: [], approvedBy: "human-reviewer" }, null, 2)}\n`);
  assert.equal((await verifyFrontendCanary(root, path.relative(root, canaryPath))).passed, true);
});
