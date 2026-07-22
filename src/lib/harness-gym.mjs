import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { compileModelIntelligence, diagnoseModelFailures } from "./model-intelligence.mjs";
import { pathExists, readJson, readYaml } from "./files.mjs";
import { validateSchema } from "./schema-validation.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function candidateRoot(repoRoot, candidateId) {
  if (!/^skill-candidate-[a-z0-9-]+$/.test(candidateId)) throw new Error(`invalid candidate id: ${candidateId}`);
  return path.join(repoRoot, "harness", "candidates", candidateId);
}

async function validateOrThrow(schema, value, label) {
  const errors = await validateSchema(schema, value, label);
  if (errors.length > 0) throw new Error(`${label} validation failed:\n${errors.join("\n")}`);
}

function skillFromCluster(candidateId, cluster) {
  const skillId = `guardrail.${slug(cluster.failureClass)}`;
  return {
    schemaVersion: "nodekit.skill/v1",
    id: skillId,
    version: 1,
    kind: "guardrail",
    triggers: {
      taskFamilies: cluster.taskFamilies,
      failureClasses: [cluster.failureClass],
      models: [cluster.model],
    },
    inputs: ["task", "artifact", "execution_trace"],
    requiredTools: [],
    procedure: [
      `Check for ${cluster.failureClass} before reporting completion`,
      "Inspect the cited tool results and artifact evidence",
      "Return a bounded proposal or typed failure instead of mutating canonical state",
    ],
    constraints: [
      "Do not modify protected tasks, decisive judges, or proof thresholds",
      "Do not claim success when a completion assertion is unsupported",
    ],
    completionChecks: [
      `${cluster.failureClass} is absent from the evaluated result`,
      "Evidence references and canonical-state protections remain intact",
    ],
    failureBehavior: [
      `Emit ${cluster.failureClass} with evidence when the guardrail cannot recover`,
      "Preserve the previous canonical artifact and request bounded review",
    ],
    positiveExamples: [`Candidate ${candidateId} inspects evidence before producing a reviewable proposal`],
    negativeExamples: [cluster.failureClass],
    expectedToolTraces: ["artifact inspection before completion"],
    testFixtures: cluster.taskIds,
    evidenceRefs: cluster.evidenceRefs,
  };
}

export async function proposeSkillCandidates(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const clusters = diagnoseModelFailures(compiled.observations).filter((cluster) => cluster.skillCandidateEligible);
  const proposed = [];
  for (const cluster of clusters) {
    const candidateId = `skill-candidate-${slug(cluster.failureClass)}-${hash({ model: cluster.model, taskIds: cluster.taskIds }).slice(0, 10)}`;
    const root = candidateRoot(repoRoot, candidateId);
    const skill = skillFromCluster(candidateId, cluster);
    const candidate = {
      schemaVersion: "nodekit.skill-candidate/v1",
      candidateId,
      status: "proposed",
      hypothesis: `A focused ${cluster.failureClass} guardrail will reduce the repeated failure without changing the model, tools, protected tasks, or decisive evaluator.`,
      expectedImpact: `Reduce ${cluster.failureClass} on ${cluster.taskFamilies.join(", ")} while holding safety, correctness, editability, export, cost, and latency within the protected comparison thresholds.`,
      risks: ["The guardrail may over-constrain valid behavior", "Additional inspection may increase latency or cost"],
      sourceCluster: {
        failureClass: cluster.failureClass,
        probableCause: cluster.probableCause,
        model: cluster.model,
        count: cluster.count,
        taskIds: cluster.taskIds,
        taskFamilies: cluster.taskFamilies,
        evidenceRefs: cluster.evidenceRefs,
      },
      skillFile: "skill.yaml",
      protectedBenchmarkHash: compiled.resolved.benchmarkHash,
      createdFromEvidence: true,
    };
    await validateOrThrow("nodekit.skill.v1.schema.json", skill, "generated skill");
    await validateOrThrow("nodekit.skill-candidate.v1.schema.json", candidate, "generated skill candidate");
    await mkdir(root, { recursive: true });
    if (!(await pathExists(path.join(root, "candidate.json")))) {
      await writeFile(path.join(root, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
      await writeFile(path.join(root, "skill.yaml"), stringifyYaml(skill));
      await writeFile(path.join(root, "hypothesis.yaml"), stringifyYaml({ schemaVersion: "nodekit.skill-hypothesis/v1", hypothesis: candidate.hypothesis, evidenceRefs: cluster.evidenceRefs }));
      await writeFile(path.join(root, "expected-impact.yaml"), stringifyYaml({ schemaVersion: "nodekit.expected-impact/v1", expectedImpact: candidate.expectedImpact }));
      await writeFile(path.join(root, "risks.yaml"), stringifyYaml({ schemaVersion: "nodekit.candidate-risks/v1", risks: candidate.risks }));
    } else {
      Object.assign(candidate, await readJson(path.join(root, "candidate.json")));
      Object.assign(skill, await readYaml(path.join(root, candidate.skillFile)));
    }
    proposed.push({ candidate, skill, root });
  }
  return { applicationId: compiled.harness.applicationId, benchmarkHash: compiled.resolved.benchmarkHash, candidates: proposed };
}

export async function reviewSkillCandidate(repoRoot, candidateId) {
  const root = candidateRoot(repoRoot, candidateId);
  const candidate = await readJson(path.join(root, "candidate.json"));
  const skill = await readYaml(path.join(root, candidate.skillFile));
  await validateOrThrow("nodekit.skill-candidate.v1.schema.json", candidate, "skill candidate");
  await validateOrThrow("nodekit.skill.v1.schema.json", skill, "skill");
  return { candidate, skill, candidateHash: hash(candidate), skillHash: hash(skill), root };
}

function acceptableIncrease(candidate, baseline) {
  if (baseline === 0) return candidate === 0;
  return candidate <= baseline * 1.25;
}

export async function benchmarkSkillCandidate(repoRoot, candidateId, comparisonPath) {
  const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const comparison = await readJson(path.resolve(comparisonPath));
  await validateOrThrow("nodekit.skill-comparison.v1.schema.json", comparison, "skill comparison");
  if (comparison.candidateId !== candidateId) throw new Error("comparison candidateId does not match requested candidate");
  if (comparison.benchmarkHash !== reviewed.candidate.protectedBenchmarkHash || comparison.benchmarkHash !== compiled.resolved.benchmarkHash) {
    throw new Error("protected benchmark hash changed during skill comparison");
  }
  if (comparison.harnessHash !== compiled.resolved.harnessHash) throw new Error("harness hash changed during skill comparison");
  const nonRegression = {
    accuracy: comparison.candidate.accuracy >= comparison.baseline.accuracy,
    safety: comparison.candidate.safety >= comparison.baseline.safety,
    editability: comparison.candidate.editability >= comparison.baseline.editability,
    exportQuality: comparison.candidate.exportQuality >= comparison.baseline.exportQuality,
    userCompletion: comparison.candidate.userCompletion >= comparison.baseline.userCompletion,
    latency: acceptableIncrease(comparison.candidate.medianLatencyMs, comparison.baseline.medianLatencyMs),
    cost: acceptableIncrease(comparison.candidate.costPerSuccessUsd, comparison.baseline.costPerSuccessUsd),
  };
  const meaningfulImprovement = comparison.candidate.successRate > comparison.baseline.successRate
    && comparison.candidate.targetFailureRate < comparison.baseline.targetFailureRate;
  const passed = meaningfulImprovement && Object.values(nonRegression).every(Boolean);
  const verdict = {
    schemaVersion: "nodekit.skill-benchmark-verdict/v1",
    candidateId,
    benchmarkHash: comparison.benchmarkHash,
    harnessHash: comparison.harnessHash,
    meaningfulImprovement,
    nonRegression,
    passed,
    comparisonHash: hash(comparison),
  };
  reviewed.candidate.status = passed ? "benchmark-passed" : "benchmark-failed";
  await writeFile(path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`);
  await cp(path.resolve(comparisonPath), path.join(reviewed.root, "comparison.json"));
  await writeFile(path.join(reviewed.root, "benchmark-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  return verdict;
}

export async function evaluateTournament(repoRoot, manifestPath) {
  const tournament = await readJson(path.resolve(manifestPath));
  await validateOrThrow("nodekit.tournament.v1.schema.json", tournament, "tournament");
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  if (tournament.benchmarkHash !== compiled.resolved.benchmarkHash || tournament.harnessHash !== compiled.resolved.harnessHash) {
    throw new Error("tournament is not bound to the current protected benchmark and harness");
  }
  const wins = Object.fromEntries(tournament.candidates.map((candidate) => [candidate, 0]));
  for (const result of tournament.pairwiseResults) {
    if (!tournament.candidates.includes(result.left) || !tournament.candidates.includes(result.right)) throw new Error("pairwise result references an unknown candidate");
    if (![result.left, result.right].includes(result.winner)) throw new Error("pairwise winner must be one of the compared candidates");
    if ([result.left, result.right].includes(result.criticId)) throw new Error("candidate cannot serve as its own decisive critic");
    wins[result.winner] += 1;
  }
  const ranked = Object.entries(wins).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const decisive = ranked.length > 1 && ranked[0][1] > ranked[1][1];
  const verdict = {
    schemaVersion: "nodekit.tournament-verdict/v1",
    tournamentId: tournament.tournamentId,
    tournamentHash: hash(tournament),
    wins,
    winner: decisive ? ranked[0][0] : null,
    decisive,
    promotionAuthorized: false,
  };
  const root = path.join(repoRoot, "harness", "tournaments", tournament.tournamentId);
  await mkdir(root, { recursive: true });
  await cp(path.resolve(manifestPath), path.join(root, "manifest.json"));
  await writeFile(path.join(root, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  return verdict;
}

const scopePriority = { project: 3, domain: 2, ecosystem: 1 };
const confidencePriority = { high: 3, medium: 2, low: 1 };

export async function compileRoutingPolicy(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const cards = compiled.cards.filter((card) => card.status !== "expired");
  const byFamily = new Map();
  for (const card of cards) {
    for (const family of card.scope.taskFamilies) {
      const entries = byFamily.get(family) ?? [];
      entries.push(card);
      byFamily.set(family, entries);
    }
  }
  const routes = [...byFamily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([taskFamily, entries]) => {
    const sorted = entries.sort((left, right) =>
      scopePriority[right.scope.level] - scopePriority[left.scope.level]
      || confidencePriority[right.confidence.level] - confidencePriority[left.confidence.level]
      || (right.metrics.firstPassAcceptance ?? 0) - (left.metrics.firstPassAcceptance ?? 0)
      || left.model.resolvedModel.localeCompare(right.model.resolvedModel));
    return {
      taskFamily,
      requiredCapabilities: [...new Set(sorted.flatMap((card) => card.strengths))].sort(),
      candidates: sorted.map((card, index) => ({
        requestedRoute: card.model.requestedRoute,
        resolvedProvider: card.model.resolvedProvider,
        resolvedModel: card.model.resolvedModel,
        scope: card.scope.level,
        confidence: card.confidence.level,
        priority: index + 1,
        roleSkills: card.bestRoles,
        domainSkills: [],
        modelAdapters: [],
        guardrails: card.requiredScaffolding,
        evidenceRefs: card.evidenceRefs,
      })),
      fallback: { type: "deterministic", skill: "nodekit.unprofiled-safe-fallback" },
      completion: { requireProposal: true, requireArtifactInspection: true, directMutation: false },
    };
  });
  const policy = {
    schemaVersion: "nodekit.routing-policy/v1",
    applicationId: compiled.harness.applicationId,
    status: "provisional",
    evidencePrecedence: ["project", "domain", "ecosystem", "unprofiled-fallback"],
    routes,
    automaticPromotion: false,
    compiledFrom: {
      harnessHash: compiled.resolved.harnessHash,
      benchmarkHash: compiled.resolved.benchmarkHash,
      cardHashes: cards.map(hash).sort(),
    },
  };
  await validateOrThrow("nodekit.routing-policy.v1.schema.json", policy, "routing policy");
  const root = path.join(repoRoot, ".nodekit", "harness");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "resolved-routing-policy.json"), `${JSON.stringify(policy, null, 2)}\n`);
  await writeFile(path.join(root, "routing-decision-receipt.json"), `${JSON.stringify({
    schemaVersion: "nodekit.routing-decision-receipt/v1",
    applicationId: policy.applicationId,
    policyHash: hash(policy),
    routeCount: policy.routes.length,
    evidencePrecedence: policy.evidencePrecedence,
    provisional: true,
    promotionAuthorized: false,
  }, null, 2)}\n`);
  return policy;
}

export async function verifyCanary(repoRoot, canaryPath) {
  const canary = await readJson(path.resolve(canaryPath));
  await validateOrThrow("nodekit.canary-receipt.v1.schema.json", canary, "canary receipt");
  const output = path.join(repoRoot, "harness", "receipts", "canaries", `${canary.canaryId}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await cp(path.resolve(canaryPath), output);
  return canary;
}

function skillDirectory(kind) {
  if (kind === "role") return "roles";
  if (kind === "domain" || kind === "domain-role") return "domains";
  if (kind === "model-adapter") return "models";
  if (kind === "recovery") return "recovery";
  return "guardrails";
}

export async function promoteSkillCandidate(repoRoot, candidateId, { canaryPath, proofPath, approvedBy }) {
  if (!approvedBy) throw new Error("explicit approvedBy identity is required; automatic promotion is prohibited");
  const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
  const verdict = await readJson(path.join(reviewed.root, "benchmark-verdict.json"));
  if (verdict.passed !== true) throw new Error("skill benchmark has not passed");
  const canary = await verifyCanary(repoRoot, canaryPath);
  if (canary.candidateId !== candidateId) throw new Error("canary candidateId mismatch");
  const proof = await readJson(path.resolve(proofPath));
  if (proof.schemaVersion !== "nodeproof.integrity-receipt/v1" || proof.passed !== true || proof.integrityVerified !== true || proof.candidateId !== candidateId) {
    throw new Error("a matching verified NodeProof integrity receipt is required");
  }
  const currentPath = path.join(repoRoot, "harness", "versions", "current.json");
  const current = await readJson(currentPath);
  const previousManifest = await readJson(path.join(repoRoot, "harness", "versions", current.version, "manifest.json"));
  const nextNumber = Number(String(current.version).replace(/^h/, "")) + 1;
  const nextVersion = `h${nextNumber}`;
  const destination = path.join(repoRoot, "harness", "skills", skillDirectory(reviewed.skill.kind), `${reviewed.skill.id}.yaml`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, stringifyYaml(reviewed.skill));
  const activeSkills = [...new Set([...(previousManifest.activeSkills ?? []), path.relative(repoRoot, destination).replaceAll("\\", "/")])].sort();
  const promotion = {
    schemaVersion: "nodekit.promotion-receipt/v1",
    promotionId: `promotion-${candidateId}-${nextVersion}`,
    candidateId,
    kind: "skill",
    benchmarkVerdictRef: path.relative(repoRoot, path.join(reviewed.root, "benchmark-verdict.json")).replaceAll("\\", "/"),
    canaryReceiptRef: path.relative(repoRoot, path.resolve(canaryPath)).replaceAll("\\", "/"),
    nodeProofReceiptRef: path.relative(repoRoot, path.resolve(proofPath)).replaceAll("\\", "/"),
    nodeProofVerified: true,
    rollbackVersion: current.version,
    automatic: false,
    approvedBy,
    promotedHash: reviewed.skillHash,
  };
  await validateOrThrow("nodekit.promotion-receipt.v1.schema.json", promotion, "promotion receipt");
  const versionRoot = path.join(repoRoot, "harness", "versions", nextVersion);
  await mkdir(versionRoot, { recursive: true });
  await writeFile(path.join(versionRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: "nodekit.harness-version/v1", version: nextVersion, previousVersion: current.version, status: "promoted", activeSkills, promotionReceiptId: promotion.promotionId }, null, 2)}\n`);
  await writeFile(currentPath, `${JSON.stringify({ schemaVersion: "nodekit.harness-current/v1", version: nextVersion }, null, 2)}\n`);
  const receiptPath = path.join(repoRoot, "harness", "receipts", "skill-promotions", `${promotion.promotionId}.json`);
  await writeFile(receiptPath, `${JSON.stringify(promotion, null, 2)}\n`);
  reviewed.candidate.status = "promoted";
  await writeFile(path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`);
  const compiledRoot = path.join(repoRoot, ".nodekit", "harness");
  await mkdir(compiledRoot, { recursive: true });
  await writeFile(path.join(compiledRoot, "resolved-skill-stack.json"), `${JSON.stringify({ schemaVersion: "nodekit.resolved-skill-stack/v1", harnessVersion: nextVersion, activeSkills, promotionReceiptId: promotion.promotionId }, null, 2)}\n`);
  return { promotion, nextVersion, receiptPath };
}

export async function rejectSkillCandidate(repoRoot, candidateId, reason) {
  if (!String(reason ?? "").trim()) throw new Error("rejection reason is required");
  const reviewed = await reviewSkillCandidate(repoRoot, candidateId);
  reviewed.candidate.status = "rejected";
  await writeFile(path.join(reviewed.root, "candidate.json"), `${JSON.stringify(reviewed.candidate, null, 2)}\n`);
  const verdict = { schemaVersion: "nodekit.skill-rejection/v1", candidateId, reason: String(reason).trim(), candidateHash: reviewed.candidateHash };
  await writeFile(path.join(reviewed.root, "rejection.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  return verdict;
}

export async function rollbackHarness(repoRoot) {
  const currentPath = path.join(repoRoot, "harness", "versions", "current.json");
  const current = await readJson(currentPath);
  const manifest = await readJson(path.join(repoRoot, "harness", "versions", current.version, "manifest.json"));
  if (!manifest.previousVersion) throw new Error(`${current.version} has no previous version to roll back to`);
  const previous = await readJson(path.join(repoRoot, "harness", "versions", manifest.previousVersion, "manifest.json"));
  await writeFile(currentPath, `${JSON.stringify({ schemaVersion: "nodekit.harness-current/v1", version: manifest.previousVersion }, null, 2)}\n`);
  const compiledRoot = path.join(repoRoot, ".nodekit", "harness");
  await mkdir(compiledRoot, { recursive: true });
  await writeFile(path.join(compiledRoot, "resolved-skill-stack.json"), `${JSON.stringify({ schemaVersion: "nodekit.resolved-skill-stack/v1", harnessVersion: manifest.previousVersion, activeSkills: previous.activeSkills ?? [], rolledBackFrom: current.version }, null, 2)}\n`);
  const receipt = { schemaVersion: "nodekit.harness-rollback/v1", from: current.version, to: manifest.previousVersion, preservedVersions: true };
  await writeFile(path.join(repoRoot, "harness", "receipts", `rollback-${current.version}-to-${manifest.previousVersion}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function harnessStatus(repoRoot) {
  const compiled = await compileModelIntelligence(repoRoot, { write: false });
  const current = await readJson(path.join(repoRoot, "harness", "versions", "current.json"));
  const proposed = await proposeSkillCandidates(repoRoot);
  return {
    schemaVersion: "nodekit.harness-status/v1",
    applicationId: compiled.harness.applicationId,
    version: current.version,
    harnessHash: compiled.resolved.harnessHash,
    benchmarkHash: compiled.resolved.benchmarkHash,
    observations: compiled.observations.length,
    capabilityCards: compiled.cards.length,
    skillCandidates: proposed.candidates.map(({ candidate }) => ({ id: candidate.candidateId, status: candidate.status })),
    routingCertified: false,
    automaticPromotion: false,
  };
}
