import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { pathExists, readJson, readYaml } from "./files.mjs";
import { directionSetHashOf, evaluateFrontendRenderContract } from "./frontend-render-contract.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const FRONTEND_ROUTE_SCHEMA = "nodekit.frontend-route/v1";
export const PRODUCT_DESIGN_CONTRACT_SCHEMA = "nodekit.product-design-contract/v1";

export const FRONTEND_REQUIRED_VIEWS = Object.freeze([
  "desktop-first-arrival",
  "desktop-active-workflow",
  "desktop-proposal-review",
  "mobile-primary-artifact",
  "mobile-agent",
  "mobile-review",
]);

export const FRONTEND_EVALUATION_DIMENSIONS = Object.freeze([
  "primaryJobClarity",
  "artifactDominance",
  "workflowHierarchy",
  "agentLegibility",
  "reviewSafety",
  "mobileOperation",
  "domainAppropriateness",
  "visualQuality",
]);

export const FRONTEND_REQUIRED_STATES = Object.freeze([
  "first_arrival",
  "loading",
  "populated",
  "exception",
  "proposal",
  "conflict",
  "failed_safe",
  "completed",
  "mobile",
]);

export const FRONTEND_REQUIRED_GUARDRAILS = Object.freeze([
  "generic_kpi_dashboard",
  "accounting_schema_as_interface",
  "decorative_chat",
  "all_workflow_states_expanded",
  "hidden_data_freshness",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function validateOrThrow(schema, value, label) {
  const findings = await validateSchema(schema, value, label);
  if (findings.length > 0) throw new Error(`${label} validation failed:\n${findings.join("\n")}`);
}

function resolveInside(repoRoot, relative, label) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, String(relative));
  const relation = path.relative(root, target);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} must stay inside the repository: ${relative}`);
  }
  return target;
}

export async function initializeFrontendHarness(repoRoot) {
  const root = path.resolve(repoRoot);
  const frontendRoot = path.join(root, "harness", "frontend");
  const directories = ["product-packets", "design-directions", "anti-references", "benchmark-tasks", "receipts", "repairs"];
  for (const directory of directories) await mkdir(path.join(frontendRoot, directory), { recursive: true });
  const routePath = path.join(frontendRoot, "route.yaml");
  if (!(await pathExists(routePath))) {
    const route = {
      schemaVersion: FRONTEND_ROUTE_SCHEMA,
      role: "frontend-architect",
      status: "unprofiled",
      selection: { strategy: "evidence_ranked", preferredRoute: null, fallbacks: [], evidenceRefs: [] },
      requiredCapabilities: ["repository-scale coding", "image input", "browser tool use", "responsive implementation", "screenshot-driven repair"],
      authority: { sourceWrite: "proposal_workspace", proofGateWrite: "prohibited", productionCredentials: "prohibited", deployment: "approval_required" },
      budget: { maximumCostUsd: 8, maximumRepairRounds: 2 },
      expiry: { profiledAt: null, reprofileAfterDays: 30, invalidateOnModelRevision: true, invalidateOnToolSurfaceChange: true },
    };
    await writeFile(routePath, stringifyYaml(route), "utf8");
  }
  return { frontendRoot, routePath, requiredViews: FRONTEND_REQUIRED_VIEWS };
}

export async function compileFrontendPlan(repoRoot, contractFile, routeFile = "harness/frontend/route.yaml") {
  const root = path.resolve(repoRoot);
  const contractPath = resolveInside(root, contractFile, "product contract");
  const routePath = resolveInside(root, routeFile, "frontend route");
  const contract = await readYaml(contractPath);
  const route = await readYaml(routePath);
  await validateOrThrow("nodekit.product-design-contract.v1.schema.json", contract, "product design contract");
  await validateOrThrow("nodekit.frontend-route.v1.schema.json", route, "frontend route");
  const missingStates = FRONTEND_REQUIRED_STATES.filter((state) => !contract.requiredStates.includes(state));
  if (missingStates.length) throw new Error(`product design contract is missing required states: ${missingStates.join(", ")}`);
  const missingGuardrails = FRONTEND_REQUIRED_GUARDRAILS.filter((guardrail) => !contract.avoid.includes(guardrail));
  if (missingGuardrails.length) throw new Error(`product design contract is missing anti-pattern guardrails: ${missingGuardrails.join(", ")}`);
  if (route.selection.preferredRoute && route.selection.evidenceRefs.length === 0) {
    throw new Error("a preferred frontend route requires evidenceRefs; model reputation is not routing evidence");
  }
  if (route.status === "evidence-ranked" && !route.selection.preferredRoute) {
    throw new Error("an evidence-ranked route must identify its preferredRoute");
  }
  const protectedContract = {
    primaryUser: contract.product.targetUser,
    primaryJob: contract.product.primaryJob,
    primaryArtifact: contract.product.primaryArtifact,
    journey: contract.journey,
    protectedDecisions: contract.protectedDecisions,
  };
  const plan = {
    schemaVersion: "nodekit.frontend-plan/v1",
    planId: `frontend-plan-${hash({ contract, route }).slice(0, 12)}`,
    contractPath: path.relative(root, contractPath).replaceAll("\\", "/"),
    routePath: path.relative(root, routePath).replaceAll("\\", "/"),
    productContractHash: hash(contract),
    routeHash: hash(route),
    routeStatus: route.status,
    requestedRoute: route.selection.preferredRoute,
    resolvedRoute: null,
    protectedContract,
    requiredViews: FRONTEND_REQUIRED_VIEWS,
    directionCount: 3,
    finalVerdictAuthority: "nodeproof",
    implementationAuthority: "proposal_workspace",
    deploymentAuthorized: false,
  };
  const output = path.join(root, "harness", "frontend", "receipts", `${plan.planId}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
  return { contract, output, plan, route };
}

export async function createFrontendDirections(repoRoot, planFile) {
  const root = path.resolve(repoRoot);
  const planPath = resolveInside(root, planFile, "frontend plan");
  const plan = await readJson(planPath);
  if (plan.schemaVersion !== "nodekit.frontend-plan/v1") throw new Error("frontend directions require a nodekit.frontend-plan/v1 receipt");
  const directionSet = {
    schemaVersion: "nodekit.frontend-direction-set/v1",
    directionSetId: `directions-${hash(plan).slice(0, 12)}`,
    productContractHash: plan.productContractHash,
    routeHash: plan.routeHash,
    blind: true,
    requiredViews: [...FRONTEND_REQUIRED_VIEWS],
    candidates: [
      { candidateId: "direction-a", archetype: "collaborative-workspace", status: "planned", viewEvidence: {} },
      { candidateId: "direction-b", archetype: "artifact-studio", status: "planned", viewEvidence: {} },
      { candidateId: "direction-c", archetype: "domain-native", status: "planned", viewEvidence: {} },
    ],
  };
  await validateOrThrow("nodekit.frontend-direction-set.v1.schema.json", directionSet, "frontend direction set");
  const output = path.join(root, "harness", "frontend", "design-directions", `${directionSet.directionSetId}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(directionSet, null, 2)}\n`);
  return { directionSet, output };
}

function assertRenderedDirections(directionSet) {
  for (const candidate of directionSet.candidates) {
    if (!['rendered', 'evaluated'].includes(candidate.status)) throw new Error(`${candidate.candidateId} is not rendered`);
    for (const view of directionSet.requiredViews) {
      if (!candidate.viewEvidence[view]) throw new Error(`${candidate.candidateId} is missing ${view} evidence`);
    }
  }
}

export async function evaluateFrontendTournament(repoRoot, benchmarkFile) {
  const root = path.resolve(repoRoot);
  const benchmarkPath = resolveInside(root, benchmarkFile, "frontend benchmark");
  const benchmark = await readJson(benchmarkPath);
  await validateOrThrow("nodekit.frontend-benchmark.v1.schema.json", benchmark, "frontend benchmark");
  const directionPath = resolveInside(root, benchmark.directionSet, "direction set");
  const directionSet = await readJson(directionPath);
  await validateOrThrow("nodekit.frontend-direction-set.v1.schema.json", directionSet, "frontend direction set");
  assertRenderedDirections(directionSet);
  const candidateIds = directionSet.candidates.map((candidate) => candidate.candidateId);
  if (Object.keys(benchmark.scores).length !== candidateIds.length || candidateIds.some((id) => !benchmark.scores[id])) {
    throw new Error("frontend benchmark must score every direction exactly once");
  }
  for (const result of benchmark.pairwiseResults) {
    if (![result.left, result.right].includes(result.winner)) throw new Error("pairwise winner must be one of the compared candidates");
    if (!candidateIds.includes(result.left) || !candidateIds.includes(result.right)) throw new Error("pairwise result references an unknown direction");
  }
  const wins = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  for (const result of benchmark.pairwiseResults) wins[result.winner] += 1;
  const average = (id) => FRONTEND_EVALUATION_DIMENSIONS.reduce((sum, key) => sum + benchmark.scores[id][key], 0) / FRONTEND_EVALUATION_DIMENSIONS.length;
  const ranked = [...candidateIds].sort((left, right) => wins[right] - wins[left] || average(right) - average(left) || left.localeCompare(right));
  // The decisive verdict is computed from verifier evidence, not from booleans the
  // candidate asserted. Load the render and review receipts for the selected direction
  // and grade them through the Frontend Render Contract.
  const renderReceipt = await readJson(resolveInside(root, benchmark.renderReceipt, "frontend render receipt"));
  await validateOrThrow("nodekit.frontend-render-receipt.v1.schema.json", renderReceipt, "frontend render receipt");
  const reviewReceipt = await readJson(resolveInside(root, benchmark.reviewReceipt, "frontend review receipt"));
  await validateOrThrow("nodekit.frontend-review-receipt.v1.schema.json", reviewReceipt, "frontend review receipt");
  const renderContract = evaluateFrontendRenderContract({
    renderReceipt,
    reviewReceipt,
    expected: {
      candidateId: ranked[0],
      repositoryCommit: benchmark.repositoryCommit,
      directionSetHash: directionSetHashOf(directionSet),
    },
  });
  const decisive = renderContract.decisive;
  const decision = {
    schemaVersion: "nodekit.design-decision/v1",
    decisionId: `design-decision-${hash({ benchmark, ranked }).slice(0, 12)}`,
    directionSetId: directionSet.directionSetId,
    candidateIds,
    selectedCandidateId: ranked[0],
    selectionReasons: [`pairwise_wins_${wins[ranked[0]]}`, `mean_score_${average(ranked[0]).toFixed(4)}`, "artifact_and_review_contract_preserved"],
    criticReceiptIds: [...new Set(benchmark.pairwiseResults.flatMap((result) => result.evidenceRefs))],
    humanDecision: false,
    independentSelector: true,
    protectedEvaluatorUnchanged: true,
    decidedAt: new Date().toISOString(),
  };
  await validateOrThrow("nodekit.design-decision.v1.schema.json", decision, "design decision");
  const output = path.join(root, "harness", "frontend", "receipts", `${decision.decisionId}.json`);
  await writeFile(output, `${JSON.stringify({ ...decision, decisive, renderContractStatus: renderContract.status, renderContractReasons: renderContract.reasons, promotionAuthorized: false, freshUserEvidenceRefs: benchmark.freshUserEvidenceRefs }, null, 2)}\n`);
  return { benchmark, decision, decisive, renderContract, output, promotionAuthorized: false, ranked, wins };
}

export async function createFrontendRepairPlan(repoRoot, benchmarkFile) {
  const root = path.resolve(repoRoot);
  const benchmark = await readJson(resolveInside(root, benchmarkFile, "frontend benchmark"));
  await validateOrThrow("nodekit.frontend-benchmark.v1.schema.json", benchmark, "frontend benchmark");
  const route = await readYaml(path.join(root, "harness", "frontend", "route.yaml"));
  await validateOrThrow("nodekit.frontend-route.v1.schema.json", route, "frontend route");
  const repair = {
    schemaVersion: "nodekit.frontend-repair/v1",
    repairId: `frontend-repair-${hash(benchmark).slice(0, 12)}`,
    benchmarkId: benchmark.benchmarkId,
    maximumRounds: route.budget.maximumRepairRounds,
    findings: benchmark.majorFindings,
    writeScope: "proposal_workspace",
    preservePriorImplementation: true,
    proofGateMutable: false,
    completionClaimAllowed: false,
  };
  const output = path.join(root, "harness", "frontend", "repairs", `${repair.repairId}.json`);
  await writeFile(output, `${JSON.stringify(repair, null, 2)}\n`);
  return { output, repair };
}

export async function verifyFrontendCanary(repoRoot, receiptFile) {
  const root = path.resolve(repoRoot);
  const receipt = await readJson(resolveInside(root, receiptFile, "frontend canary"));
  const checks = {
    exactCandidate: typeof receipt.candidateId === "string" && receipt.candidateId.length > 0,
    exactCommit: /^[a-f0-9]{40}$/.test(receipt.commitSha ?? ""),
    requestedAndResolvedModel: Boolean(receipt.requestedRoute && receipt.resolvedProvider && receipt.resolvedModel),
    freshIdentity: receipt.freshIdentity === true,
    renderedJourney: receipt.renderedJourney === true,
    screenshotsBound: Array.isArray(receipt.screenshotEvidenceRefs) && receipt.screenshotEvidenceRefs.length >= FRONTEND_REQUIRED_VIEWS.length,
    nodeProofPassed: receipt.nodeProofPassed === true,
    majorFindingsClosed: Array.isArray(receipt.majorFindings) && receipt.majorFindings.length === 0,
    humanApproval: typeof receipt.approvedBy === "string" && receipt.approvedBy.length > 0,
  };
  return { schemaVersion: "nodekit.frontend-canary-verdict/v1", checks, passed: Object.values(checks).every(Boolean), receipt };
}
