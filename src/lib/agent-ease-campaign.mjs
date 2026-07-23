import { createHash } from "node:crypto";

export const AGENT_EASE_TASK_IDS = Object.freeze([
  "research-map",
  "volunteer-onboarding",
  "launch-presentation",
]);

export const AGENT_EASE_PROFILE_COUNTS = Object.freeze({
  codex: 3,
  "claude-code": 1,
  "lower-cost": 1,
});

export const AGENT_EASE_MAX_RUN_DURATION_MS = 30 * 60 * 1000;
export const AGENT_EASE_MEDIAN_RUN_DURATION_MS = 20 * 60 * 1000;

export const AGENT_EASE_BOOTSTRAP_MODES = Object.freeze([
  "pre-scaffolded-packed-cli",
  "agent-process-packed-cli-from-empty",
]);

const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/;
const MAX_PRICING_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const REQUIRED_EVIDENCE = Object.freeze({
  prompt: "agent/original-prompt.txt",
  "prompt-hash": "agent/prompt.sha256",
  environment: "agent/environment.json",
  interventions: "agent/interventions.json",
  session: "agent/session.jsonl",
  "final-report": "agent/final-report.md",
  stderr: "agent/stderr.txt",
  "token-usage": "agent/token-usage.json",
  "command-ledger": "commands.jsonl",
  "candidate-diff": "candidate/diff.patch",
  "candidate-status": "candidate/git-status.txt",
  "candidate-commit": "candidate/commit.txt",
  "application-identity": "candidate/application-identity.json",
  "candidate-archive": "candidate/generated-repo.tar.gz",
  "browser-certification": "candidate/browser-certification.json",
  "screenshot-manifest": "candidate/browser/screenshot-manifest.json",
  "protected-evaluation": "evaluator/protected-task-evaluation.json",
  "evaluator-screenshot": "evaluator/task-relevance.png",
  "visual-review-inventory": "evaluator/visual-review-inventory.json",
});

export const AGENT_EASE_REQUIRED_CHECKS = Object.freeze([
  "agentBootstrapBound",
  "agentEnvironmentIsolated",
  "agentImplemented",
  "agentReportedCompletion",
  "agentSessionIdentityRecorded",
  "agentVersionRecorded",
  "applicationIdentityRecorded",
  "browserContract",
  "browserJourney",
  "browserRuntime",
  "candidateArchive",
  "check",
  "compile",
  "demo",
  "eval",
  "evidenceComplete",
  "localInstructionsBound",
  "nodekitIdentityStable",
  "nodekitRuntimeBound",
  "nodekitTarballStable",
  "postAgentTreeStable",
  "proof",
  "protectedEvaluation",
  "protectedEvaluatorStable",
  "protectedIsolation",
  "taskSpecificOutput",
  "visualReview",
]);

export const PROTECTED_AGENT_EVALUATION_CHECKS = Object.freeze([
  "applicationIdentityBound",
  "artifactDownloadVerified",
  "artifactReloadPersistenceVerified",
  "artifactReopenPersistenceVerified",
  "browserEvidenceBound",
  "candidateArchiveBound",
  "candidateTreeBound",
  "evaluatorBytesBound",
  "guidedInteractionPassed",
  "independentScreenshotCaptured",
  "isolationBound",
  "renderedTaskRelevant",
  "sourceTaskRelevant",
  "taskBytesBound",
  "taskInputBound",
  "taskSetBound",
  "typedArtifactVerified",
  "visualReviewPassed",
]);

export const LEGACY_PROTECTED_AGENT_EVALUATION_V1_CHECKS = Object.freeze([
  "applicationIdentityBound",
  "browserEvidenceBound",
  "candidateArchiveBound",
  "candidateTreeBound",
  "evaluatorBytesBound",
  "guidedInteractionPassed",
  "independentScreenshotCaptured",
  "isolationBound",
  "renderedTaskRelevant",
  "sourceTaskRelevant",
  "taskBytesBound",
  "taskSetBound",
  "visualReviewPassed",
]);

const PROTECTED_TASK_ARTIFACT_TYPES = Object.freeze({
  "launch-presentation": "launch-presentation",
  "research-map": "research-map",
  "volunteer-onboarding": "volunteer-onboarding-record",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPortableJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalPortableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPortableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exactPortableValue(left, right) {
  return canonicalPortableJson(left) === canonicalPortableJson(right);
}

export function protectedTaskInputSha256(value) {
  return sha256(canonicalPortableJson(value));
}

export function createProtectedTaskInput({ candidateArchiveSha256, inputToken, nonce, taskId }) {
  if (!SHA256.test(candidateArchiveSha256 ?? "")) throw new Error("protected task input requires the frozen candidate archive hash");
  if (!nonEmptyText(inputToken)) throw new Error("protected task input requires an input token");
  if (!/^challenge_[a-f0-9]{32,64}$/.test(nonce ?? "")) throw new Error("protected task input nonce is invalid");
  if (!AGENT_EASE_TASK_IDS.includes(taskId)) throw new Error(`unsupported protected task ${taskId}`);
  const base = {
    generatedAfterCandidateArchiveSha256: candidateArchiveSha256,
    inputToken,
    nonce,
    schemaVersion: "nodekit.protected-task-input/v1",
    taskId,
  };
  if (taskId === "research-map") {
    const sourceSeeds = [
      ["policy-gradient", "Policy-gradient agents", "Policy-gradient agents optimize a sampled return objective with explicit variance controls."],
      ["world-model", "World-model agents", "World-model agents plan against learned dynamics and must track compounding model error."],
      ["verification", "Verifier-guided agents", "Verifier-guided agents use externally checked outcomes to constrain policy updates."],
    ];
    return {
      ...base,
      question: `How do three supplied Agentic RL approaches differ for challenge ${nonce}?`,
      sources: sourceSeeds.map(([suffix, title, statement], index) => {
        const excerpt = `${statement} Packet nonce: ${nonce}; evidence row: ${index + 1}.`;
        return {
          contentSha256: sha256(excerpt),
          excerpt,
          id: `source_${suffix}_${nonce.slice(-12)}`,
          publishedAtIso: `2025-0${index + 1}-15T00:00:00.000Z`,
          title,
          url: `https://evidence.nodekit.invalid/protected/${nonce}/${suffix}`,
        };
      }),
    };
  }
  if (taskId === "volunteer-onboarding") {
    return {
      ...base,
      documents: [
        { id: `doc_identity_${nonce.slice(-12)}`, reviewStatus: "approved", type: "identity" },
        { id: `doc_conduct_${nonce.slice(-12)}`, reviewStatus: "reviewed", type: "code-of-conduct" },
        { id: `doc_safety_${nonce.slice(-12)}`, reviewStatus: "approved", type: "safety-training" },
      ],
      volunteer: {
        email: `volunteer-${nonce.slice(-12)}@example.invalid`,
        id: `volunteer_${nonce.slice(-16)}`,
        name: `Protected Volunteer ${nonce.slice(-8)}`,
      },
    };
  }
  const metricBase = Number.parseInt(nonce.slice(-6), 16);
  return {
    ...base,
    brief: {
      audience: `Operations leaders evaluating challenge ${nonce.slice(-8)}`,
      positioning: `A proof-carrying workflow for ${nonce}`,
      product: `NodeKit Launch ${nonce.slice(-10)}`,
    },
    metrics: [
      { id: `metric_activation_${nonce.slice(-10)}`, label: "Activation", unit: "%", value: 40 + (metricBase % 41) },
      { id: `metric_time_${nonce.slice(-10)}`, label: "Time to proof", unit: "minutes", value: 5 + (metricBase % 23) },
      { id: `metric_runs_${nonce.slice(-10)}`, label: "Verified runs", unit: "runs", value: 10 + (metricBase % 91) },
    ],
  };
}

export function validateProtectedTaskInput(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("protected task input must be an object");
  if (value.schemaVersion !== "nodekit.protected-task-input/v1"
    || !AGENT_EASE_TASK_IDS.includes(value.taskId)
    || !nonEmptyText(value.inputToken)
    || !/^challenge_[a-f0-9]{32,64}$/.test(value.nonce ?? "")
    || !SHA256.test(value.generatedAfterCandidateArchiveSha256 ?? "")) {
    throw new Error("protected task input envelope is invalid");
  }
  if (expected.taskId !== undefined && value.taskId !== expected.taskId) throw new Error("protected task input taskId drifted");
  if (expected.inputToken !== undefined && value.inputToken !== expected.inputToken) throw new Error("protected task input token drifted");
  if (expected.candidateArchiveSha256 !== undefined
    && value.generatedAfterCandidateArchiveSha256 !== expected.candidateArchiveSha256) {
    throw new Error("protected task input is not bound to the frozen candidate archive");
  }
  if (value.taskId === "research-map") {
    if (!nonEmptyText(value.question) || !value.question.includes(value.nonce)
      || !Array.isArray(value.sources) || value.sources.length < 2) throw new Error("protected research input is incomplete");
    const ids = new Set();
    for (const source of value.sources) {
      if (!source || typeof source !== "object" || !nonEmptyText(source.id) || ids.has(source.id)
        || !nonEmptyText(source.title) || !nonEmptyText(source.url) || !source.url.startsWith("https://")
        || !nonEmptyText(source.publishedAtIso) || !Number.isFinite(Date.parse(source.publishedAtIso))
        || !nonEmptyText(source.excerpt) || !SHA256.test(source.contentSha256 ?? "")
        || sha256(source.excerpt) !== source.contentSha256) throw new Error("protected research source packet is invalid");
      ids.add(source.id);
    }
  } else if (value.taskId === "volunteer-onboarding") {
    if (!value.volunteer || [value.volunteer.id, value.volunteer.name, value.volunteer.email].some((field) => !nonEmptyText(field))
      || !Array.isArray(value.documents) || value.documents.length < 1
      || value.documents.some((document) => !nonEmptyText(document?.id) || !nonEmptyText(document?.type)
        || !["reviewed", "approved"].includes(String(document?.reviewStatus).toLowerCase()))) {
      throw new Error("protected volunteer input is incomplete or cannot confirm onboarding");
    }
  } else if (!value.brief || [value.brief.product, value.brief.audience, value.brief.positioning].some((field) => !nonEmptyText(field))
    || !Array.isArray(value.metrics) || value.metrics.length < 1
    || value.metrics.some((metric) => !nonEmptyText(metric?.id) || !nonEmptyText(metric?.label) || !nonEmptyText(metric?.unit)
      || typeof metric?.value !== "number" || !Number.isFinite(metric.value))) {
    throw new Error("protected launch input is incomplete");
  }
  return value;
}

export function validateProtectedTaskTransformation(taskId, protectedInput, content) {
  validateProtectedTaskInput(protectedInput, { inputToken: protectedInput?.inputToken, taskId });
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("canonical task artifact content must be an object");
  if (content.inputToken !== protectedInput.inputToken) throw new Error("canonical task artifact did not preserve the exact hidden input token");
  if (taskId === "research-map") {
    const sources = content.sources ?? content.references ?? content.citations;
    const comparisons = content.comparisons ?? content.findings;
    if ((content.question ?? content.researchQuestion) !== protectedInput.question || !Array.isArray(sources)
      || sources.length !== protectedInput.sources.length
      || !Array.isArray(comparisons) || comparisons.length < 1) throw new Error("research-map content is incomplete");
    const ids = new Set();
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const supplied = protectedInput.sources[index];
      if (!source || typeof source !== "object" || ids.has(source.id)
        || !["id", "title", "url", "publishedAtIso", "contentSha256", "excerpt"]
          .every((field) => source[field] === supplied[field])) throw new Error("research-map did not preserve the immutable source packet exactly");
      ids.add(source.id);
    }
    const referenced = new Set();
    if (comparisons.some((comparison) => {
      const refs = comparison?.sourceIds ?? comparison?.sourceRefs ?? comparison?.sources;
      if (Array.isArray(refs)) refs.forEach((id) => referenced.add(typeof id === "string" ? id : id?.id));
      return !Array.isArray(refs) || refs.length < 1 || refs.some((id) => !ids.has(typeof id === "string" ? id : id?.id));
    })) throw new Error("research-map comparison source references failed");
    if (referenced.size !== ids.size) throw new Error("research-map comparisons do not cover every supplied source");
    return { comparisonCount: comparisons.length, questionPresent: true, sourceCount: sources.length };
  }
  if (taskId === "volunteer-onboarding") {
    const identity = content.volunteer ?? content.applicant ?? content.application;
    const documents = content.documents ?? content.documentReviews ?? content.checklist;
    const completion = content.completion ?? content.onboarding;
    const hasIdentity = nonEmptyText(identity) || Boolean(identity && typeof identity === "object" && !Array.isArray(identity)
      && [identity.id, identity.name, identity.email, identity.applicationId, identity.volunteerId].some(nonEmptyText));
    if (!hasIdentity || !exactPortableValue(identity, protectedInput.volunteer)
      || !Array.isArray(documents) || documents.length !== protectedInput.documents.length
      || documents.some((document, index) => !["id", "type", "reviewStatus"]
        .every((field) => document?.[field] === protectedInput.documents[index][field]))
      || String(completion?.status ?? content.completionStatus).toLowerCase() !== "confirmed") {
      throw new Error("volunteer-onboarding did not exactly preserve a confirmable hidden input");
    }
    return { completionConfirmed: true, documentCount: documents.length, identityPresent: true };
  }
  const brief = content.brief ?? content.productBrief;
  const metrics = content.metrics ?? content.productMetrics;
  const metricValues = Array.isArray(metrics)
    ? metrics.map((entry) => (typeof entry === "number" ? entry : entry?.value))
    : Object.values(metrics ?? {});
  const slides = content.slides ?? content.deck?.slides;
  const review = content.review ?? content.approval;
  const metricIds = new Set(protectedInput.metrics.map((metric) => metric.id));
  const referencedMetricIds = new Set();
  if (!exactPortableValue(brief, protectedInput.brief)
    || !Array.isArray(metrics) || metrics.length !== protectedInput.metrics.length
    || metrics.some((metric, index) => !["id", "label", "value", "unit"]
      .every((field) => metric?.[field] === protectedInput.metrics[index][field]))
    || !metricValues.some((value) => typeof value === "number" && Number.isFinite(value))
    || !Array.isArray(slides) || slides.length < 3
    || slides.some((slide) => {
      const refs = slide?.metricIds ?? slide?.metrics;
      if (Array.isArray(refs)) refs.forEach((id) => referencedMetricIds.add(typeof id === "string" ? id : id?.id));
      return !nonEmptyText(slide?.title) || !Array.isArray(refs) || refs.length < 1
        || refs.some((id) => !metricIds.has(typeof id === "string" ? id : id?.id));
    })
    || referencedMetricIds.size !== metricIds.size
    || String(review?.status ?? content.reviewStatus).toLowerCase() !== "approved") {
    throw new Error("launch-presentation did not exactly preserve and ground the hidden input");
  }
  return { briefPresent: true, metricCount: metricValues.length, reviewApproved: true, slideCount: slides.length };
}

function exactSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && [...new Set(values)].sort().join("\n") === [...expected].sort().join("\n");
}

function receiptHash(value) {
  const { receiptSha256: _receiptSha256, ...body } = value;
  return sha256(JSON.stringify(body));
}

export function parseAgentEaseCliArgs(rawArgs, options = {}) {
  if (!Array.isArray(rawArgs)) throw new Error("CLI arguments must be an array");
  const allowed = new Set(options.allowed ?? []);
  const boolean = new Set(options.boolean ?? []);
  const parsed = Object.create(null);
  for (const raw of rawArgs) {
    if (typeof raw !== "string" || !raw.startsWith("--")) {
      throw new Error(`unsupported positional CLI argument: ${String(raw)}`);
    }
    const body = raw.slice(2);
    const separator = body.indexOf("=");
    const key = separator < 0 ? body : body.slice(0, separator);
    const value = separator < 0 ? true : body.slice(separator + 1);
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key) || !allowed.has(key)) {
      throw new Error(`unknown CLI option --${key || "<empty>"}`);
    }
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate CLI option --${key}`);
    if (separator < 0 && !boolean.has(key)) throw new Error(`--${key} requires --${key}=<value>`);
    if (separator >= 0 && (boolean.has(key) || value.length === 0)) {
      throw new Error(boolean.has(key) ? `--${key} does not accept a value` : `--${key} requires a non-empty value`);
    }
    parsed[key] = value;
  }
  return Object.freeze(parsed);
}

export function validateIndependentSourceArchive(sourceArchive, suppliedArchive) {
  if (!sourceArchive || !suppliedArchive) throw new Error("source and supplied package archives are required");
  const checks = {
    canonicalManifestSha256: sourceArchive.canonicalManifestSha256 === suppliedArchive.canonicalManifestSha256,
    fileCount: sourceArchive.fileCount === suppliedArchive.fileCount,
    name: sourceArchive.name === suppliedArchive.name,
    unpackedSize: sourceArchive.unpackedSize === suppliedArchive.unpackedSize,
    version: sourceArchive.version === suppliedArchive.version,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`supplied archive differs from an independent script-disabled pack of the exact candidate: ${failed.join(", ")}`);
  }
  return checks;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalModel(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function validateLowerCostEvidence(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("lower-cost evidence must be an object");
  }
  if (value.schemaVersion !== "nodekit.lower-cost-model-evidence/v1") {
    throw new Error("lower-cost evidence has an unsupported schemaVersion");
  }
  if (value.passed !== true) throw new Error("lower-cost evidence must explicitly pass");
  const driver = requiredText(value.agentDriver, "lower-cost evidence agentDriver");
  const model = requiredText(value.model, "lower-cost evidence model");
  if (!new Set(["codex", "claude-code"]).has(driver)) {
    throw new Error(`lower-cost evidence uses unsupported agentDriver ${driver}`);
  }
  if (expected.agentDriver && driver !== expected.agentDriver) {
    throw new Error(`lower-cost evidence driver ${driver} does not match ${expected.agentDriver}`);
  }
  if (expected.model && model !== expected.model) {
    throw new Error(`lower-cost evidence model ${model} does not match ${expected.model}`);
  }
  if (typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))) {
    throw new Error("lower-cost evidence observedAt must be an ISO timestamp");
  }
  if (!value.source || typeof value.source !== "object" || Array.isArray(value.source)) {
    throw new Error("lower-cost evidence requires a source object");
  }
  const sourceUrl = requiredText(value.source.url, "lower-cost evidence source.url");
  if (!/^https:\/\//i.test(sourceUrl)) throw new Error("lower-cost evidence source.url must use HTTPS");
  if (!SHA256.test(String(value.source.snapshotSha256 ?? ""))) {
    throw new Error("lower-cost evidence source.snapshotSha256 must be a lowercase SHA-256 digest");
  }
  const snapshotPath = requiredText(value.source.snapshotPath, "lower-cost evidence source.snapshotPath");
  if (pathLikeUnsafe(snapshotPath)) {
    throw new Error("lower-cost evidence source.snapshotPath must be a canonical relative path");
  }
  const lowerCost = value.lowerCost;
  if (!lowerCost || typeof lowerCost !== "object" || Array.isArray(lowerCost)) {
    throw new Error("lower-cost evidence requires a lowerCost price object");
  }
  for (const field of ["inputUsdPerMillion", "outputUsdPerMillion"]) {
    if (!Number.isFinite(lowerCost[field]) || lowerCost[field] < 0) {
      throw new Error(`lower-cost evidence lowerCost.${field} must be a non-negative number`);
    }
  }
  if (!Array.isArray(value.comparators) || value.comparators.length === 0) {
    throw new Error("lower-cost evidence requires at least one comparator");
  }
  const comparedModels = new Set([model]);
  for (const comparator of value.comparators) {
    const comparatorModel = requiredText(comparator?.model, "lower-cost comparator model");
    if (comparedModels.has(comparatorModel)) {
      throw new Error(`lower-cost evidence repeats compared model ${comparatorModel}`);
    }
    comparedModels.add(comparatorModel);
    for (const field of ["inputUsdPerMillion", "outputUsdPerMillion"]) {
      if (!Number.isFinite(comparator?.[field]) || comparator[field] < lowerCost[field]) {
        throw new Error(`each comparator ${field} must be at least the lower-cost price`);
      }
    }
    if (
      comparator.inputUsdPerMillion === lowerCost.inputUsdPerMillion
      && comparator.outputUsdPerMillion === lowerCost.outputUsdPerMillion
    ) {
      throw new Error("each comparator must be strictly more expensive on at least one price dimension");
    }
  }
  return {
    agentDriver: driver,
    comparators: value.comparators.map((entry) => ({
      inputUsdPerMillion: entry.inputUsdPerMillion,
      model: entry.model.trim(),
      outputUsdPerMillion: entry.outputUsdPerMillion,
    })),
    lowerCost: {
      inputUsdPerMillion: lowerCost.inputUsdPerMillion,
      outputUsdPerMillion: lowerCost.outputUsdPerMillion,
    },
    model,
    observedAt: value.observedAt,
    source: {
      snapshotSha256: value.source.snapshotSha256,
      snapshotPath,
      url: sourceUrl,
    },
  };
}

/**
 * Validate the raw official pricing snapshot instead of trusting a hand-written
 * "lower cost" label. `referenceTime` is supplied by the orchestrator so a
 * replay can explain exactly which freshness window was applied.
 */
export function validateOfficialPricingSnapshot(value, lowerCostEvidence, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("official pricing snapshot must be an object");
  }
  if (value.schemaVersion !== "nodekit.external-source-snapshot/v1") {
    throw new Error("official pricing snapshot has an unsupported schemaVersion");
  }
  const retrievedAt = requiredText(value.retrievedAt, "official pricing snapshot retrievedAt");
  if (!CANONICAL_TIMESTAMP.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error("official pricing snapshot retrievedAt must be a canonical ISO timestamp");
  }
  const referenceTime = options.referenceTime instanceof Date
    ? options.referenceTime.getTime()
    : typeof options.referenceTime === "string"
      ? Date.parse(options.referenceTime)
      : Number(options.referenceTime ?? Date.now());
  if (!Number.isFinite(referenceTime)) throw new Error("official pricing snapshot reference time is invalid");
  const ageMs = referenceTime - Date.parse(retrievedAt);
  const maxAgeMs = Number(options.maxAgeMs ?? MAX_PRICING_AGE_MS);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("official pricing snapshot maxAgeMs is invalid");
  if (ageMs < -MAX_FUTURE_SKEW_MS) throw new Error("official pricing snapshot is implausibly future-dated");
  if (ageMs > maxAgeMs) throw new Error("official pricing snapshot is stale");

  const source = requiredText(value.source, "official pricing snapshot source");
  if (source !== lowerCostEvidence.source.url) {
    throw new Error("official pricing snapshot source does not match lower-cost evidence source URL");
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    throw new Error("official pricing snapshot source is not a valid URL");
  }
  if (sourceUrl.protocol !== "https:") throw new Error("official pricing snapshot source must use HTTPS");
  const officialHosts = lowerCostEvidence.agentDriver === "codex"
    ? new Set(["developers.openai.com", "platform.openai.com", "openai.com"])
    : new Set(["docs.anthropic.com", "anthropic.com"]);
  if (!officialHosts.has(sourceUrl.hostname.toLowerCase())) {
    throw new Error(`official pricing snapshot host is not authoritative for ${lowerCostEvidence.agentDriver}`);
  }
  if (lowerCostEvidence.observedAt !== retrievedAt) {
    throw new Error("lower-cost evidence observedAt must exactly match the preserved snapshot retrievedAt");
  }
  if (value.unit !== "USD per 1M tokens") {
    throw new Error("official pricing snapshot unit must be USD per 1M tokens");
  }
  if (!exactSet(value.columns, ["model", "input", "cachedInput", "cacheWrite", "output"])) {
    throw new Error("official pricing snapshot has an unexpected column contract");
  }
  const modelIndex = value.columns.indexOf("model");
  const inputIndex = value.columns.indexOf("input");
  const outputIndex = value.columns.indexOf("output");
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    throw new Error("official pricing snapshot requires model price rows");
  }
  const rows = new Map();
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== value.columns.length) {
      throw new Error("official pricing snapshot row does not match its columns");
    }
    const model = requiredText(row[modelIndex], "official pricing snapshot model");
    if (rows.has(model)) throw new Error(`official pricing snapshot repeats model ${model}`);
    if (!Number.isFinite(row[inputIndex]) || row[inputIndex] < 0
      || !Number.isFinite(row[outputIndex]) || row[outputIndex] < 0) {
      throw new Error(`official pricing snapshot has invalid prices for ${model}`);
    }
    rows.set(model, {
      inputUsdPerMillion: row[inputIndex],
      outputUsdPerMillion: row[outputIndex],
    });
  }
  const expectedRows = [
    { model: lowerCostEvidence.model, ...lowerCostEvidence.lowerCost },
    ...lowerCostEvidence.comparators,
  ];
  for (const expected of expectedRows) {
    const observed = rows.get(expected.model);
    if (!observed) throw new Error(`official pricing snapshot omits model ${expected.model}`);
    if (observed.inputUsdPerMillion !== expected.inputUsdPerMillion
      || observed.outputUsdPerMillion !== expected.outputUsdPerMillion) {
      throw new Error(`lower-cost evidence prices do not match official snapshot for ${expected.model}`);
    }
  }
  return {
    ageMs,
    retrievedAt,
    source,
    verifiedModels: expectedRows.map((entry) => entry.model),
  };
}

function objectSelfHash(value, field) {
  const body = { ...value };
  delete body[field];
  return sha256(JSON.stringify(body));
}

const PROTECTED_ISOLATION_CHECKS = Object.freeze([
  "browserCannotReadCandidate", "browserEgressBlocked", "browserReadOnlyRootFilesystem",
  "candidateCertificationOracleAbsent", "candidateEgressBlocked", "candidateHasNoEvidenceMount", "candidateReadOnlyRootFilesystem",
  "candidateSourceReadOnly", "exactImageBound", "hostNamespacesNotShared", "internalNetworkOnly",
  "noPublishedPorts", "separateEvaluatorContainer",
]);

const CODING_AGENT_ISOLATION_CHECKS = Object.freeze([
  "bootstrapContractBound", "brokerCredentialExpiryBound", "brokerExactImageBound", "brokerModelBound", "brokerNoPublishedPorts", "brokerRunnerBound", "capabilitiesDropped",
  "candidateOnlyWritableHostMount", "credentialBrokered", "dockerSocketAbsent", "exactImageBound",
  "containerCommandBound", "hostNamespacesNotShared", "instructionPolicyBound", "internalNetworkBound", "noCredentialMount",
  "noEvidenceOrEvaluatorMount", "noNewPrivileges", "noPublishedPorts", "providerBrokerOnlyPeer",
  "readOnlyRootFilesystem", "scopedMountSet",
]);

export function validateAgentBootstrap(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agent bootstrap receipt must be an object");
  const body = { ...value };
  delete body.bootstrapSha256;
  const mode = value.mode;
  const isEmptyDirectory = mode === "agent-process-packed-cli-from-empty";
  if (value.schemaVersion !== "nodekit.agent-bootstrap/v1"
    || !AGENT_EASE_BOOTSTRAP_MODES.includes(mode)
    || (expected.mode !== undefined && mode !== expected.mode)
    || value.candidateDirectoryInitiallyEmpty !== isEmptyDirectory
    || value.packedCliInvokedInsideAgentProcess !== isEmptyDirectory
    || value.offlineDependencyInstall !== isEmptyDirectory
    || value.agentInitiatedScaffold !== isEmptyDirectory
    || value.workspaceEmptyAtAgentStart !== isEmptyDirectory
    || value.firstWorkspaceWriteFromAgentSession !== isEmptyDirectory
    || !SHA256.test(value.commandSha256 ?? "")
    || !SHA256.test(value.nodekitCliSha256 ?? "")
    || !SHA256.test(value.nodekitTarballSha256 ?? "")
    || (expected.nodekitTarballSha256 !== undefined && value.nodekitTarballSha256 !== expected.nodekitTarballSha256)
    || !SHA256.test(value.bootstrapSha256 ?? "")
    || value.bootstrapSha256 !== sha256(JSON.stringify(body))) {
    throw new Error("agent bootstrap receipt is invalid, unbound, or falsely labels an empty-directory run");
  }
  return value;
}

export function validateAgentBootstrapSession(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent bootstrap session receipt must be an object");
  }
  const emptyDirectory = expected.mode === "agent-process-packed-cli-from-empty";
  if (value.passed !== true
    || !Number.isInteger(value.commandCount)
    || value.commandCount < (emptyDirectory ? 1 : 0)
    || (emptyDirectory
      ? !SHA256.test(value.firstMutatingCommandSha256 ?? "")
        || !SHA256.test(value.scaffoldCommandSha256 ?? "")
        || value.firstMutatingCommandSha256 !== value.scaffoldCommandSha256
        || value.scaffoldCommandSha256 !== expected.commandSha256
      : value.commandCount !== 0
        || value.firstMutatingCommandSha256 !== null
        || value.scaffoldCommandSha256 !== null)) {
    throw new Error("agent bootstrap session does not prove the first workspace write was the exact packed-CLI scaffold command");
  }
  return value;
}

export function validateAgentInstructionPolicy(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agent instruction policy must be an object");
  const driver = expected.agentDriver;
  const expectedAutomatic = driver === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
  const expectedLoaded = driver === "claude-code" ? ["CLAUDE.md", "AGENTS.md"] : ["AGENTS.md"];
  const files = Array.isArray(value.files) ? value.files : [];
  if (value.schemaVersion !== "nodekit.agent-instruction-policy/v1"
    || value.automaticPath !== expectedAutomatic
    || value.canonicalPath !== "AGENTS.md"
    || !exactSet(files.map((entry) => entry?.path), ["AGENTS.md", "CLAUDE.md"])
    || files.some((entry) => !SHA256.test(entry?.sha256 ?? ""))
    || JSON.stringify(value.loadedPaths) !== JSON.stringify(expectedLoaded)
    || value.parentContextInherited !== false
    || value.rulesIgnored !== false
    || (driver === "claude-code" ? value.routingDirective !== "@AGENTS.md" : value.routingDirective !== null)
    || !SHA256.test(value.instructionSetSha256 ?? "")
    || value.instructionSetSha256 !== objectSelfHash(value, "instructionSetSha256")) {
    throw new Error("agent instruction policy is invalid, unbound, or inherited context");
  }
  return value;
}

export function validateCodingAgentIsolation(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("coding-agent isolation must be an object");
  const errors = [];
  if (value.schemaVersion !== "nodekit.coding-agent-isolation/v1" || value.mode !== "docker-candidate-only") {
    errors.push("coding-agent isolation mode is unsupported");
  }
  if (!new Set(["codex", "claude-code"]).has(value.driver)
    || (expected.agentDriver !== undefined && value.driver !== expected.agentDriver)) {
    errors.push("coding-agent isolation driver is invalid or drifted");
  }
  if (!value.image || !/^sha256:[a-f0-9]{64}$/.test(value.image.id ?? "")
    || typeof value.image.reference !== "string" || value.image.reference.length === 0
    || (expected.agentContainerImageId !== undefined && value.image.id !== expected.agentContainerImageId)
    || (expected.agentContainerImage !== undefined && value.image.reference !== expected.agentContainerImage)) {
    errors.push("coding-agent image identity is invalid or drifted");
  }
  if (!SHA256.test(value.containerId ?? "") || !SHA256.test(value.commandSha256 ?? "")
    || (expected.agentCommandSha256 !== undefined && value.commandSha256 !== expected.agentCommandSha256)) {
    errors.push("coding-agent container or command identity is invalid or drifted");
  }
  try {
    validateAgentBootstrap(value.bootstrap, {
      mode: expected.bootstrapMode,
      nodekitTarballSha256: expected.nodekitTarballSha256,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "coding-agent bootstrap receipt is invalid");
  }
  const mounts = Array.isArray(value.mounts) ? value.mounts : [];
  const expectedMounts = value.bootstrap?.mode === "agent-process-packed-cli-from-empty"
    ? ["/workspace", "/protected/nodekit-package", "/protected/nodekit.tgz", "/protected/npm-cache", "/AGENTS.md", "/CLAUDE.md"]
    : ["/workspace"];
  if (mounts.length !== expectedMounts.length
    || !exactSet(mounts.map((entry) => entry?.destination), expectedMounts)
    || mounts.find((entry) => entry.destination === "/workspace")?.readOnly !== false
    || mounts.filter((entry) => entry.destination !== "/workspace").some((entry) => entry.readOnly !== true)
    || mounts.some((entry) => entry.type !== "bind")) {
    errors.push("coding-agent mount boundary is invalid");
  }
  if (!value.broker || !SHA256.test(value.broker.containerId ?? "")
    || value.broker.imageId !== value.image?.id
    || typeof value.broker.allowedModel !== "string" || value.broker.allowedModel.length === 0
    || (expected.agentModel !== undefined && value.broker.allowedModel !== expected.agentModel)
    || !SHA256.test(value.broker.runnerSha256 ?? "")
    || value.broker.expiresAt !== value.credential?.expiresAt
    || (expected.providerBrokerSha256 !== undefined && value.broker.runnerSha256 !== expected.providerBrokerSha256)) {
    errors.push("coding-agent provider broker identity is invalid or drifted");
  }
  if (!value.credential || !new Set(["openai", "anthropic"]).has(value.credential.provider)
    || !SHA256.test(value.credential.fingerprintSha256 ?? "")
    || typeof value.credential.scope !== "string" || value.credential.scope.length === 0
    || !Number.isFinite(Date.parse(value.credential.expiresAt ?? ""))) {
    errors.push("coding-agent short-lived credential metadata is invalid");
  }
  if (!value.network || !SHA256.test(value.network.id ?? "") || value.network.internal !== true
    || typeof value.network.name !== "string" || value.network.name.length === 0) {
    errors.push("coding-agent internal network identity is invalid");
  }
  try {
    validateAgentInstructionPolicy(value.instructions, { agentDriver: value.driver });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "coding-agent instruction policy is invalid");
  }
  if (!value.checks || !exactSet(Object.keys(value.checks), CODING_AGENT_ISOLATION_CHECKS)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    errors.push("coding-agent isolation checks are incomplete or failed");
  }
  if (!SHA256.test(value.isolationSha256 ?? "") || value.isolationSha256 !== objectSelfHash(value, "isolationSha256")) {
    errors.push("coding-agent isolation self-hash is invalid");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

export function validateProtectedEvaluatorIsolation(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("protected evaluator isolation must be an object");
  const errors = [];
  if (value.schemaVersion !== "nodekit.protected-evaluator-isolation/v1"
    || value.mode !== "docker-internal-two-container") errors.push("protected evaluator isolation mode is unsupported");
  if (!SHA256.test(value.browserLaneSha256 ?? "")
    || (expected.browserLaneSha256 !== undefined && value.browserLaneSha256 !== expected.browserLaneSha256)) {
    errors.push("protected browser lane hash is invalid or drifted");
  }
  if (!value.image || !/^sha256:[a-f0-9]{64}$/.test(value.image.id ?? "")
    || typeof value.image.reference !== "string" || value.image.reference.length === 0
    || (expected.containerImageId !== undefined && value.image.id !== expected.containerImageId)
    || (expected.containerImage !== undefined && value.image.reference !== expected.containerImage)) {
    errors.push("protected container image identity is invalid or drifted");
  }
  if (value.network?.driver !== "bridge" || value.network?.internal !== true || !SHA256.test(value.network?.networkId ?? "")) {
    errors.push("protected evaluator network is not a content-identified internal bridge");
  }
  const candidate = value.candidateContainer;
  const browser = value.browserContainer;
  if (!/^[a-f0-9]{64}$/.test(candidate?.containerId ?? "")
    || candidate?.readOnlyRootFilesystem !== true
    || !Array.isArray(candidate?.mounts) || candidate.mounts.length !== 1
    || candidate.mounts[0]?.destination !== "/workspace" || candidate.mounts[0]?.readOnly !== true) {
    errors.push("candidate container is not a read-only single-mount sandbox");
  }
  const browserMounts = Array.isArray(browser?.mounts) ? browser.mounts : [];
  const expectedBrowserMounts = [
    "/output", "/runner/node_modules/@axe-core/playwright", "/runner/node_modules/axe-core",
    "/runner/node_modules/playwright", "/runner/node_modules/playwright-core", "/runner/run-protected-browser-lane.mjs",
  ];
  if (!/^[a-f0-9]{64}$/.test(browser?.containerId ?? "")
    || browser?.readOnlyRootFilesystem !== true
    || !exactSet(browserMounts.map((entry) => entry?.destination), expectedBrowserMounts)
    || browserMounts.find((entry) => entry.destination === "/output")?.readOnly !== false
    || browserMounts.filter((entry) => entry.destination !== "/output").some((entry) => entry.readOnly !== true)
    || candidate?.containerId === browser?.containerId) {
    errors.push("browser evaluator is not an independent read-only lane with isolated scratch output");
  }
  const dependencies = Array.isArray(value.browserDependencies) ? value.browserDependencies : [];
  const expectedDependencies = [
    { destination: "/runner/node_modules/playwright", name: "playwright", version: "1.61.1" },
    { destination: "/runner/node_modules/playwright-core", name: "playwright-core", version: "1.61.1" },
    { destination: "/runner/node_modules/@axe-core/playwright", name: "@axe-core/playwright", version: "4.12.1" },
    { destination: "/runner/node_modules/axe-core", name: "axe-core", version: "4.12.1" },
  ];
  if (dependencies.length !== expectedDependencies.length
    || dependencies.some((dependency, index) => dependency?.name !== expectedDependencies[index].name
      || dependency?.version !== expectedDependencies[index].version
      || dependency?.destination !== expectedDependencies[index].destination
      || !Number.isInteger(dependency?.fileCount) || dependency.fileCount < 1
      || !SHA256.test(dependency?.treeSha256 ?? ""))) {
    errors.push("protected browser Axe dependencies are not exact, versioned, and tree-hash-bound");
  }
  if (!value.docker || ["apiVersion", "architecture", "operatingSystem", "serverVersion"].some((field) => typeof value.docker[field] !== "string" || value.docker[field].length === 0)) {
    errors.push("Docker server identity is incomplete");
  }
  if (!value.checks || !exactSet(Object.keys(value.checks), PROTECTED_ISOLATION_CHECKS)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    errors.push("protected evaluator isolation checks are incomplete or failed");
  }
  if (!SHA256.test(value.isolationSha256 ?? "") || value.isolationSha256 !== objectSelfHash(value, "isolationSha256")) {
    errors.push("protected evaluator isolation self-hash is invalid");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

export function validateVisualReviewInventory(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("visual review inventory must be an object");
  }
  const errors = [];
  const matches = (field, expectedValue) => {
    if (expectedValue !== undefined && value[field] !== expectedValue) errors.push(`${field} does not match protected inputs`);
  };
  if (value.schemaVersion !== "nodekit.visual-review-inventory/v1") errors.push("visual review inventory schemaVersion is unsupported");
  for (const field of ["runId", "taskId", "applicationHash", "configHash", "postAgentTreeHash", "candidateArchiveSha256",
    "nodekitCommit", "nodekitSourceHash", "nodekitTarballSha256", "evaluatorScreenshotSha256",
    "screenshotEvidenceRootSha256", "isolationSha256"]) {
    matches(field, expected[field]);
  }
  matches("browserManifestSha256", expected.protectedBrowserManifestSha256 ?? expected.browserManifestSha256);
  if (value.automatedReview !== true || value.separateFromHumanUsability !== true || value.humanUsabilityGateSatisfied !== false) {
    errors.push("visual review must be explicitly automated and separate from five-human usability evidence");
  }
  if (value.producer?.authority !== "campaign-protected-evaluator"
    || value.producer?.candidateEvidenceAccess !== false
    || value.producer?.candidateHostAccess !== false
    || value.producer?.candidateWriteAccess !== false
    || value.producer?.executedAfterCandidateArchive !== true
    || value.producer?.externalNetworkEgress !== false
    || value.producer?.isolationMode !== "docker-internal-two-container") {
    errors.push("visual review is candidate-authored or lacks protected evaluator provenance");
  }
  if (!validCampaignTimestamp(value.generatedAt)) errors.push("visual review generatedAt is invalid");
  if (value.screenshotCount !== 180) errors.push("visual review must bind exactly 180 candidate screenshots");
  if (!SHA256.test(value.browserManifestSha256 ?? "")
    || !SHA256.test(value.evaluatorScreenshotSha256 ?? "")
    || !SHA256.test(value.screenshotEvidenceRootSha256 ?? "")) {
    errors.push("visual review screenshot hashes are invalid");
  }
  if (!value.openIssueCounts
    || !exactSet(Object.keys(value.openIssueCounts), ["p0", "p1", "p2", "p3"])
    || Object.values(value.openIssueCounts).some((count) => !Number.isInteger(count) || count < 0)) {
    errors.push("visual review issue counts are invalid");
  }
  if (!Array.isArray(value.issues)) errors.push("visual review issues must be an array");
  else {
    const observed = Object.fromEntries(["p0", "p1", "p2", "p3"].map((severity) => [severity, value.issues.filter((issue) => issue?.severity === severity).length]));
    if (!value.openIssueCounts || JSON.stringify(observed) !== JSON.stringify(value.openIssueCounts)) {
      errors.push("visual review issue inventory does not reconcile with counts");
    }
  }
  if (value.openIssueCounts?.p0 !== 0 || value.openIssueCounts?.p1 !== 0 || value.passed !== true) {
    errors.push("visual review has open P0/P1 issues or did not pass");
  }
  if (!SHA256.test(value.inventorySha256 ?? "") || value.inventorySha256 !== objectSelfHash(value, "inventorySha256")) {
    errors.push("visual review inventory self-hash is invalid");
  }
  try {
    validateProtectedEvaluatorIsolation(value.isolation, expected);
    if (value.isolationSha256 !== value.isolation?.isolationSha256) errors.push("visual review isolation hash does not bind its isolation object");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

export function validateProtectedAgentEvaluationV1(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("legacy protected agent evaluation must be an object");
  }
  const errors = [];
  if (value.schemaVersion !== "nodekit.protected-agent-evaluation/v1") errors.push("legacy protected evaluation schemaVersion is unsupported");
  for (const field of ["runId", "taskId", "taskBriefSha256", "taskSetSha256", "evaluatorSha256", "applicationHash", "configHash",
    "postAgentTreeHash", "candidateArchiveSha256", "nodekitCommit", "nodekitSourceHash", "nodekitTarballSha256",
    "browserManifestSha256", "evaluatorScreenshotSha256", "screenshotEvidenceRootSha256", "visualReviewInventorySha256",
    "visualReviewInventorySelfHash", "isolationSha256"]) {
    if (expected[field] !== undefined && value[field] !== expected[field]) errors.push(`${field} does not match protected inputs`);
  }
  if (!validCampaignTimestamp(value.generatedAt)) errors.push("legacy protected evaluation generatedAt is invalid");
  if (value.producer?.authority !== "campaign-protected-evaluator"
    || value.producer?.candidateEvidenceAccess !== false || value.producer?.candidateHostAccess !== false
    || value.producer?.candidateWriteAccess !== false || value.producer?.executedAfterCandidateArchive !== true
    || value.producer?.externalNetworkEgress !== false || value.producer?.isolationMode !== "docker-internal-two-container") {
    errors.push("legacy protected evaluation lacks protected evaluator provenance");
  }
  if (!value.checks || !exactSet(Object.keys(value.checks), LEGACY_PROTECTED_AGENT_EVALUATION_V1_CHECKS)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    errors.push("legacy protected evaluation checks are incomplete or failed");
  }
  for (const field of ["renderedGroups", "sourceGroups"]) {
    const groups = value.taskRelevance?.[field];
    if (!Array.isArray(groups) || groups.length !== 4
      || !groups.every((group) => group?.passed === true && Array.isArray(group.matches) && group.matches.length > 0)) {
      errors.push(`legacy protected evaluation ${field} is incomplete or failed`);
    }
  }
  try {
    validateProtectedEvaluatorIsolation(value.isolation, expected);
    if (value.isolationSha256 !== value.isolation?.isolationSha256) errors.push("legacy protected evaluation isolation binding is invalid");
  } catch (error) {
    errors.push(error.message);
  }
  if (value.passed !== true) errors.push("legacy protected evaluation did not pass");
  if (!SHA256.test(value.evaluationSha256 ?? "") || value.evaluationSha256 !== objectSelfHash(value, "evaluationSha256")) {
    errors.push("legacy protected evaluation self-hash is invalid");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

export function validateProtectedAgentEvaluation(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("protected agent evaluation must be an object");
  }
  const errors = [];
  const matches = (field, expectedValue) => {
    if (expectedValue !== undefined && value[field] !== expectedValue) errors.push(`${field} does not match protected inputs`);
  };
  if (value.schemaVersion !== "nodekit.protected-agent-evaluation/v2") errors.push("protected evaluation schemaVersion is unsupported");
  for (const field of ["runId", "taskId", "taskBriefSha256", "taskSetSha256", "evaluatorSha256", "applicationHash", "configHash",
    "postAgentTreeHash", "candidateArchiveSha256", "nodekitCommit", "nodekitSourceHash", "nodekitTarballSha256",
    "evaluatorScreenshotSha256", "screenshotEvidenceRootSha256", "visualReviewInventorySha256",
    "visualReviewInventorySelfHash", "isolationSha256", "protectedTaskInputSha256"]) {
    matches(field, expected[field]);
  }
  matches("candidateBrowserManifestSha256", expected.candidateBrowserManifestSha256 ?? expected.browserManifestSha256);
  matches("browserManifestSha256", expected.protectedBrowserManifestSha256);
  if (!validCampaignTimestamp(value.generatedAt)) errors.push("protected evaluation generatedAt is invalid");
  if (value.producer?.authority !== "campaign-protected-evaluator"
    || value.producer?.candidateEvidenceAccess !== false
    || value.producer?.candidateHostAccess !== false
    || value.producer?.candidateWriteAccess !== false
    || value.producer?.executedAfterCandidateArchive !== true
    || value.producer?.externalNetworkEgress !== false
    || value.producer?.isolationMode !== "docker-internal-two-container") {
    errors.push("protected evaluation is candidate-authored or lacks protected evaluator provenance");
  }
  if (!SHA256.test(value.evaluatorSha256 ?? "")
    || !SHA256.test(value.browserManifestSha256 ?? "")
    || !SHA256.test(value.candidateBrowserManifestSha256 ?? "")
    || !SHA256.test(value.evaluatorScreenshotSha256 ?? "")
    || !SHA256.test(value.screenshotEvidenceRootSha256 ?? "")
    || !SHA256.test(value.visualReviewInventorySha256 ?? "")
    || !SHA256.test(value.visualReviewInventorySelfHash ?? "")) {
    errors.push("protected evaluation evidence hashes are invalid");
  }
  if (value.protectedBrowserManifestFile !== "protected-browser/screenshot-manifest.json") {
    errors.push("protected evaluation does not identify the trusted browser manifest");
  }
  try {
    validateProtectedTaskInput(value.protectedTaskInput, {
      candidateArchiveSha256: value.candidateArchiveSha256,
      inputToken: value.taskArtifactEvidence?.inputToken,
      taskId: value.taskId,
    });
    if (!SHA256.test(value.protectedTaskInputSha256 ?? "")
      || protectedTaskInputSha256(value.protectedTaskInput) !== value.protectedTaskInputSha256) {
      errors.push("protected task input hash is invalid");
    }
  } catch (error) {
    errors.push(error.message);
  }
  if (!value.checks
    || !exactSet(Object.keys(value.checks), PROTECTED_AGENT_EVALUATION_CHECKS)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    errors.push("protected evaluation checks are incomplete or failed");
  }
  for (const field of ["renderedGroups", "sourceGroups"]) {
    const groups = value.taskRelevance?.[field];
    if (!Array.isArray(groups) || groups.length !== 4 || !groups.every((group) => group?.passed === true && Array.isArray(group.matches) && group.matches.length > 0)) {
      errors.push(`protected evaluation ${field} is incomplete or failed`);
    }
  }
  if (!SHA256.test(value.taskRelevance?.renderedTextSha256 ?? "") || !SHA256.test(value.taskRelevance?.sourceTextSha256 ?? "")) {
    errors.push("protected evaluation task-relevance content hashes are invalid");
  }
  if (!Array.isArray(value.sourceFilesInspected) || value.sourceFilesInspected.length === 0) {
    errors.push("protected evaluation did not inspect immutable candidate source files");
  }
  const artifact = value.taskArtifactEvidence;
  const markerFields = ["artifactId", "canonicalVersion", "contentSha256", "type"];
  const markers = [artifact?.marker, artifact?.reloadMarker, artifact?.reopenMarker];
  const markerMatchesArtifact = (marker) => marker
    && marker.artifactId === artifact.artifactId
    && marker.canonicalVersion === artifact.canonicalVersion
    && marker.contentSha256 === artifact.contentSha256
    && marker.type === artifact.artifactType;
  if (!artifact || artifact.taskId !== value.taskId
    || artifact.artifactType !== PROTECTED_TASK_ARTIFACT_TYPES[value.taskId]
    || typeof artifact.artifactId !== "string" || artifact.artifactId.length === 0
    || !Number.isInteger(artifact.canonicalVersion) || artifact.canonicalVersion < 2
    || !SHA256.test(artifact.contentSha256 ?? "")
    || artifact.exportFile !== "task-artifact.json"
    || !Number.isInteger(artifact.exportBytes) || artifact.exportBytes < 32 || artifact.exportBytes > 5 * 1024 * 1024
    || !SHA256.test(artifact.exportSha256 ?? "")
    || !nonEmptyText(artifact.inputToken)
    || !SHA256.test(artifact.inputTokenSha256 ?? "")
    || sha256(artifact.inputToken) !== artifact.inputTokenSha256
    || !artifact.canonicalContent || typeof artifact.canonicalContent !== "object" || Array.isArray(artifact.canonicalContent)
    || Buffer.byteLength(JSON.stringify(artifact.canonicalContent), "utf8") > 768 * 1024
    || sha256(canonicalPortableJson(artifact.canonicalContent)) !== artifact.contentSha256
    || !canonicalPortableJson(artifact.canonicalContent).includes(artifact.inputToken)
    || markers.some((marker) => !markerMatchesArtifact(marker))
    || markers.some((marker) => !exactSet(Object.keys(marker ?? {}), markerFields))) {
    errors.push("protected evaluation task artifact evidence is incomplete, untyped, or not persistent");
  }
  const summary = artifact?.domainSummary;
  try {
    const replayedSummary = validateProtectedTaskTransformation(value.taskId, value.protectedTaskInput, artifact?.canonicalContent);
    if (canonicalPortableJson(replayedSummary) !== canonicalPortableJson(summary)) {
      errors.push("protected task artifact domain summary does not replay from canonical content");
    }
  } catch (error) {
    errors.push(`protected task artifact canonical content failed replay: ${error.message}`);
  }
  if (value.taskId === "research-map"
    && (!summary || summary.questionPresent !== true || !Number.isInteger(summary.sourceCount) || summary.sourceCount < 2
      || !Number.isInteger(summary.comparisonCount) || summary.comparisonCount < 1)) {
    errors.push("protected research-map domain summary is incomplete");
  }
  if (value.taskId === "volunteer-onboarding"
    && (!summary || summary.identityPresent !== true || summary.completionConfirmed !== true
      || !Number.isInteger(summary.documentCount) || summary.documentCount < 1)) {
    errors.push("protected volunteer-onboarding domain summary is incomplete");
  }
  if (value.taskId === "launch-presentation"
    && (!summary || summary.briefPresent !== true || summary.reviewApproved !== true
      || !Number.isInteger(summary.metricCount) || summary.metricCount < 1
      || !Number.isInteger(summary.slideCount) || summary.slideCount < 3)) {
    errors.push("protected launch-presentation domain summary is incomplete");
  }
  try {
    validateProtectedEvaluatorIsolation(value.isolation, expected);
    if (value.isolationSha256 !== value.isolation?.isolationSha256) errors.push("protected evaluation isolation hash does not bind its isolation object");
  } catch (error) {
    errors.push(error.message);
  }
  if (value.passed !== true) errors.push("protected evaluation did not pass");
  if (!SHA256.test(value.evaluationSha256 ?? "") || value.evaluationSha256 !== objectSelfHash(value, "evaluationSha256")) {
    errors.push("protected evaluation self-hash is invalid");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

function validCampaignTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateAgentEaseTrialManifest(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("trial manifest must be an object");
  }
  const run = expected?.run;
  const candidate = expected?.candidate;
  if (!run || !candidate) throw new Error("trial manifest validation requires run and candidate expectations");
  const errors = [];
  const matches = (field, expectedValue) => {
    if (value[field] !== expectedValue) errors.push(`${field} does not match the campaign plan`);
  };
  matches("schemaVersion", "nodekit.agent-ease-trial/v2");
  matches("runId", run.runId);
  matches("taskId", run.taskId);
  matches("agentProfile", run.agentProfile);
  matches("agentDriver", run.agentDriver);
  matches("agentModel", run.model ?? null);
  matches("bootstrapMode", run.bootstrapMode);
  matches("nodekitCommit", candidate.commit);
  matches("endingNodekitCommit", candidate.commit);
  matches("nodekitSourceHash", candidate.sourceHash);
  matches("endingNodekitSourceHash", candidate.sourceHash);
  matches("nodekitTarballSha256", candidate.tarballSha256);
  matches("nodekitPackage", candidate.packageName);
  matches("nodekitVersion", candidate.packageVersion);
  matches("promptSha256", run.taskBriefSha256);
  matches("taskSetSha256", run.taskSetSha256);
  matches("trialRunnerSha256", run.trialRunnerSha256);
  matches("agentContainerImage", run.agentContainerImage);
  matches("agentContainerImageId", run.agentContainerImageId);
  matches("protectedEvaluatorSha256", run.protectedEvaluatorSha256);
  matches("protectedBrowserLaneSha256", run.protectedBrowserLaneSha256);
  matches("protectedContainerImage", run.protectedContainerImage);
  matches("protectedContainerImageId", run.protectedContainerImageId);
  matches("providerBrokerSha256", run.providerBrokerSha256);
  if (value.passed !== true) errors.push("trial did not pass");
  if (value.agentExitCode !== 0) errors.push("agent process did not exit successfully");
  if (value.verdict !== "PILOT_PASS_NOT_REPEATABILITY_CERTIFIED") errors.push("trial verdict is not qualifying");
  if (value.freshSession !== true || value.agentSessionMode !== "ephemeral") errors.push("trial session is not fresh and ephemeral");
  if (value.executor !== "docker") errors.push("trial executor is not the mandatory isolated Docker executor");
  if (!new Set(["npm", "pnpm"]).has(value.packageManager)) errors.push("trial package manager is unsupported");
  if (typeof value.agentSessionId !== "string" || value.agentSessionId.trim().length === 0
    || typeof value.agentVersion !== "string" || value.agentVersion.trim().length === 0
    || typeof value.agentModel !== "string" || value.agentModel.trim().length === 0) {
    errors.push("trial agent session, version, or explicitly brokered model identity is missing");
  }
  if (!SHA256.test(value.applicationHash ?? "") || !SHA256.test(value.configHash ?? "")) {
    errors.push("trial generated application identity is missing");
  }
  if (!COMMIT.test(value.postAgentTreeHash ?? "") || !SHA256.test(value.candidateArchiveSha256 ?? "")) {
    errors.push("trial post-agent tree or candidate archive identity is missing");
  }
  for (const field of ["protectedEvaluatorSha256", "protectedBrowserLaneSha256", "protectedIsolationSha256",
    "protectedEvaluationSha256", "evaluatorScreenshotSha256", "visualReviewInventorySha256", "screenshotEvidenceRootSha256",
    "agentBootstrapSha256", "agentCommandSha256", "agentProcessIsolationSha256", "agentInstructionPolicySha256", "providerBrokerSha256"]) {
    if (!SHA256.test(value[field] ?? "")) errors.push(`trial ${field} is missing or invalid`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.protectedContainerImageId ?? "")
    || typeof value.protectedContainerImage !== "string" || value.protectedContainerImage.length === 0) {
    errors.push("trial protected container image identity is missing");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.agentContainerImageId ?? "")
    || typeof value.agentContainerImage !== "string" || value.agentContainerImage.length === 0) {
    errors.push("trial coding-agent container image identity is missing");
  }
  try {
    validateCodingAgentIsolation(value.agentProcessIsolation, {
      agentCommandSha256: value.agentCommandSha256,
      agentContainerImage: run.agentContainerImage,
      agentContainerImageId: run.agentContainerImageId,
      agentDriver: run.agentDriver,
      agentModel: run.model,
      bootstrapMode: run.bootstrapMode,
      nodekitTarballSha256: candidate.tarballSha256,
      providerBrokerSha256: run.providerBrokerSha256,
    });
    if (value.agentProcessIsolationSha256 !== value.agentProcessIsolation?.isolationSha256) {
      errors.push("trial coding-agent isolation hash does not bind its isolation object");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    validateAgentBootstrap(value.agentBootstrap, {
      mode: run.bootstrapMode,
      nodekitTarballSha256: candidate.tarballSha256,
    });
    if (value.agentBootstrapSha256 !== value.agentBootstrap?.bootstrapSha256
      || value.agentBootstrapSha256 !== value.agentProcessIsolation?.bootstrap?.bootstrapSha256) {
      errors.push("trial bootstrap hash does not bind its coding-agent isolation receipt");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    validateAgentBootstrapSession(value.agentBootstrapSession, {
      commandSha256: value.agentBootstrap?.commandSha256,
      mode: run.bootstrapMode,
    });
  } catch (error) {
    errors.push(error.message);
  }
  try {
    validateAgentInstructionPolicy(value.agentInstructionPolicy, { agentDriver: run.agentDriver });
    if (value.agentInstructionPolicySha256 !== value.agentInstructionPolicy?.instructionSetSha256
      || value.agentInstructionPolicySha256 !== value.agentProcessIsolation?.instructions?.instructionSetSha256) {
      errors.push("trial instruction policy hash does not bind the agent isolation receipt");
    }
  } catch (error) {
    errors.push(error.message);
  }
  if (!Array.isArray(value.substantiveFiles) || value.substantiveFiles.length === 0) {
    errors.push("trial contains no substantive implementation files");
  }
  if (typeof value.trialStartedAt !== "string" || !Number.isFinite(Date.parse(value.trialStartedAt))
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || Date.parse(value.generatedAt) < Date.parse(value.trialStartedAt)) {
    errors.push("trial timestamps are invalid");
  }
  if (value.interventions !== 0 || value.userReprompts !== 0) errors.push("trial includes intervention or reprompt");
  if (!value.checks
    || !exactSet(Object.keys(value.checks), AGENT_EASE_REQUIRED_CHECKS)
    || !Object.values(value.checks).every((entry) => entry === true)) {
    errors.push("trial required checks are incomplete or failed");
  }
  if (!Array.isArray(value.evidence)
    || !exactSet(value.evidence.map((entry) => entry?.kind), Object.keys(REQUIRED_EVIDENCE))) {
    errors.push("trial evidence manifest is incomplete or duplicated");
  } else {
    for (const evidence of value.evidence) {
      if (REQUIRED_EVIDENCE[evidence.kind] !== evidence.path) {
        errors.push(`trial evidence ${evidence.kind} uses the wrong path`);
      }
      if (!Number.isInteger(evidence.bytes) || evidence.bytes < 0 || !SHA256.test(evidence.sha256 ?? "")) {
        errors.push(`trial evidence ${evidence.kind} has invalid size or hash`);
      }
    }
    if (value.evidenceSetSha256 !== sha256(JSON.stringify(value.evidence))) {
      errors.push("trial evidence-set hash is invalid");
    }
    if (value.evidence.find((entry) => entry.kind === "candidate-archive")?.sha256 !== value.candidateArchiveSha256) {
      errors.push("trial candidate archive evidence does not bind candidateArchiveSha256");
    }
    if (value.evidence.find((entry) => entry.kind === "protected-evaluation")?.sha256 !== value.protectedEvaluationSha256
      || value.evidence.find((entry) => entry.kind === "evaluator-screenshot")?.sha256 !== value.evaluatorScreenshotSha256
      || value.evidence.find((entry) => entry.kind === "visual-review-inventory")?.sha256 !== value.visualReviewInventorySha256) {
      errors.push("trial protected evaluator evidence hashes do not bind the receipt");
    }
  }
  if (!SHA256.test(value.receiptSha256 ?? "") || value.receiptSha256 !== receiptHash(value)) {
    errors.push("trial receipt hash is invalid");
  }
  if (errors.length > 0) throw new Error(`${run.runId}: ${errors.join("; ")}`);
  return value;
}

export function validateAgentEaseMeasurementVerdict(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fresh-agent measurement verdict must be an object");
  }
  const candidate = expected?.candidate;
  const manifests = expected?.manifests;
  const runs = expected?.runs;
  if (!candidate || !(manifests instanceof Map) || !Array.isArray(runs)) {
    throw new Error("fresh-agent measurement validation requires candidate, manifests, and runs");
  }
  const errors = [];
  if (value.schemaVersion !== "nodekit.fresh-agent-verdict/v2") errors.push("schemaVersion is unsupported");
  if (value.passed !== true || !Array.isArray(value.errors) || value.errors.length !== 0) errors.push("verdict did not pass cleanly");
  if (value.nodekitCommit !== candidate.commit
    || value.nodekitSourceHash !== candidate.sourceHash
    || value.nodekitIdentity !== `${candidate.commit}/${candidate.sourceHash}`) {
    errors.push("verdict source identity differs from the candidate");
  }
  const pricing = value.lowerCostPricingEvidence;
  const lowerCostRuns = Array.isArray(value.selectedRuns)
    ? value.selectedRuns.filter((entry) => entry?.agentProfile === "lower-cost")
    : [];
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)
    || pricing.schemaVersion !== "nodekit.lower-cost-pricing-binding/v1"
    || !new Set(["codex", "claude-code"]).has(pricing.agentDriver)
    || typeof pricing.model !== "string" || pricing.model.trim().length === 0
    || pathLikeUnsafe(String(pricing.evidencePath ?? ""))
    || pathLikeUnsafe(String(pricing.snapshotPath ?? ""))
    || pricing.evidencePath === pricing.snapshotPath
    || !SHA256.test(pricing.evidenceSha256 ?? "")
    || !SHA256.test(pricing.snapshotSha256 ?? "")
    || !pricing.pricingValidation || typeof pricing.pricingValidation !== "object"
    || !Number.isFinite(pricing.pricingValidation.ageMs)
    || !validCampaignTimestamp(pricing.pricingValidation.retrievedAt)
    || !validCampaignTimestamp(pricing.pricingValidation.validatedAt)
    || typeof pricing.pricingValidation.source !== "string" || !pricing.pricingValidation.source.startsWith("https://")
    || !Array.isArray(pricing.pricingValidation.verifiedModels)
    || !pricing.pricingValidation.verifiedModels.includes(pricing.model)
    || lowerCostRuns.length !== AGENT_EASE_TASK_IDS.length
    || lowerCostRuns.some((entry) => entry.agentDriver !== pricing.agentDriver || entry.agentModel !== pricing.model)) {
    errors.push("verdict lower-cost profile is not bound to preserved official pricing evidence");
  }
  const durations = Array.isArray(value.selectedRuns)
    ? value.selectedRuns.map((entry) => entry?.durationMs).filter(Number.isFinite).sort((left, right) => left - right)
    : [];
  const observedMedian = durations.length === 0 ? null : durations.length % 2 === 1
    ? durations[(durations.length - 1) / 2]
    : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;
  const observedMaximum = durations.length === 0 ? null : durations.at(-1);
  if (durations.length !== 15
    || durations.some((duration) => !Number.isInteger(duration) || duration < 0 || duration > AGENT_EASE_MAX_RUN_DURATION_MS)
    || value.timing?.schemaVersion !== "nodekit.fresh-agent-timing/v1"
    || value.timing?.thresholds?.maxRunMs !== AGENT_EASE_MAX_RUN_DURATION_MS
    || value.timing?.thresholds?.medianRunMs !== AGENT_EASE_MEDIAN_RUN_DURATION_MS
    || value.timing?.observed?.maxRunMs !== observedMaximum
    || value.timing?.observed?.medianRunMs !== observedMedian
    || observedMedian > AGENT_EASE_MEDIAN_RUN_DURATION_MS) {
    errors.push("verdict fresh-agent timer evidence exceeds or does not match the preregistered duration thresholds");
  }
  const release = value.releaseCandidate;
  if (release?.nodekitCommit !== candidate.commit
    || release?.nodekitSourceHash !== candidate.sourceHash
    || release?.nodekitTarballSha256 !== candidate.tarballSha256
    || release?.packageName !== candidate.packageName
    || release?.packageVersion !== candidate.packageVersion) {
    errors.push("verdict release candidate differs from the exact archive");
  }
  if (!exactSet(value.requiredTasks, AGENT_EASE_TASK_IDS)
    || !value.requiredProfiles
    || !exactSet(Object.keys(value.requiredProfiles), Object.keys(AGENT_EASE_PROFILE_COUNTS))
    || Object.entries(AGENT_EASE_PROFILE_COUNTS).some(([profile, count]) => value.requiredProfiles[profile] !== count)
    || value.requiredRuns !== 15
    || value.observedTrials !== 15
    || value.observedRepositoryTrials !== 15
    || value.ignoredOtherCandidateTrials !== 0
    || value.legacyTrialsIgnored !== 0
    || value.failedTrials !== 0
    || value.allAttemptsSelected !== true
    || value.emptyDirectoryAgentCliRuns !== 1
    || value.combinedZeroToAppClaim !== true) {
    errors.push("verdict does not represent the exact no-cherry-pick 15-run matrix");
  }
  if (!Array.isArray(value.selectedRuns) || value.selectedRuns.length !== runs.length) {
    errors.push("verdict selectedRuns does not contain the exact campaign run set");
  } else {
    if (new Set(value.selectedRuns.map((entry) => entry.protectedBrowserLaneSha256)).size !== 1
      || new Set(value.selectedRuns.map((entry) => entry.protectedContainerImage)).size !== 1
      || new Set(value.selectedRuns.map((entry) => entry.protectedContainerImageId)).size !== 1
      || new Set(value.selectedRuns.map((entry) => entry.agentContainerImage)).size !== 1
      || new Set(value.selectedRuns.map((entry) => entry.agentContainerImageId)).size !== 1) {
      errors.push("fresh-agent runs did not use one immutable protected evaluator lane and image");
    }
    if (new Set(value.selectedRuns.map((entry) => entry.agentProcessIsolationSha256)).size !== value.selectedRuns.length) {
      errors.push("fresh-agent runs did not retain a distinct coding-agent isolation receipt per session");
    }
    const plan = new Map(runs.map((run) => [run.runId, run]));
    const observedIds = value.selectedRuns.map((entry) => entry?.runId);
    if (!exactSet(observedIds, runs.map((run) => run.runId))) errors.push("verdict selected run IDs differ from the campaign plan");
    for (const selected of value.selectedRuns) {
      const run = plan.get(selected?.runId);
      const manifest = manifests.get(selected?.runId);
      if (!run || !manifest) continue;
      if (selected.taskId !== run.taskId
        || selected.agentProfile !== run.agentProfile
        || selected.agentDriver !== run.agentDriver
        || selected.agentModel !== (run.model ?? null)
        || selected.bootstrapMode !== run.bootstrapMode
        || selected.bootstrapMode !== manifest.value.bootstrapMode
        || selected.agentBootstrapSha256 !== manifest.value.agentBootstrapSha256
        || selected.promptSha256 !== run.taskBriefSha256
        || selected.taskSetSha256 !== run.taskSetSha256
        || selected.trialRunnerSha256 !== run.trialRunnerSha256
        || selected.nodekitCommit !== candidate.commit
        || selected.nodekitSourceHash !== candidate.sourceHash
        || selected.nodekitTarballSha256 !== candidate.tarballSha256
        || selected.nodekitPackage !== candidate.packageName
        || selected.nodekitVersion !== candidate.packageVersion
        || selected.agentVersion !== manifest.value.agentVersion
        || selected.agentSessionId !== manifest.value.agentSessionId
        || selected.freshSession !== true
        || selected.trialStartedAt !== manifest.value.trialStartedAt
        || selected.generatedAt !== manifest.value.generatedAt
        || selected.applicationHash !== manifest.value.applicationHash
        || selected.configHash !== manifest.value.configHash
        || selected.postAgentTreeHash !== manifest.value.postAgentTreeHash
        || selected.candidateArchiveSha256 !== manifest.value.candidateArchiveSha256
        || selected.agentContainerImage !== manifest.value.agentContainerImage
        || selected.agentContainerImageId !== manifest.value.agentContainerImageId
        || selected.agentCommandSha256 !== manifest.value.agentCommandSha256
        || selected.agentProcessIsolationSha256 !== manifest.value.agentProcessIsolationSha256
        || selected.protectedEvaluatorSha256 !== manifest.value.protectedEvaluatorSha256
        || selected.protectedBrowserLaneSha256 !== manifest.value.protectedBrowserLaneSha256
        || selected.protectedContainerImage !== manifest.value.protectedContainerImage
        || selected.protectedContainerImageId !== manifest.value.protectedContainerImageId
        || selected.protectedIsolationSha256 !== manifest.value.protectedIsolationSha256
        || selected.protectedEvaluationSha256 !== manifest.value.protectedEvaluationSha256
        || selected.evaluatorScreenshotSha256 !== manifest.value.evaluatorScreenshotSha256
        || selected.visualReviewInventorySha256 !== manifest.value.visualReviewInventorySha256
        || selected.screenshotEvidenceRootSha256 !== manifest.value.screenshotEvidenceRootSha256
        || selected.receiptSha256 !== manifest.value.receiptSha256
        || selected.manifestSha256 !== manifest.fileSha256
        || selected.manifestPath !== `${run.runId}/manifest.json`
        || selected.evidenceCount !== 19
        || !Array.isArray(selected.evidence)
        || selected.evidence.length !== 19
        || selected.evidenceSetSha256 !== sha256(JSON.stringify(selected.evidence))
        || selected.passed !== true
        || selected.validationPassed !== true) {
        errors.push(`verdict selected run ${selected.runId} does not bind its verified receipt`);
      }
      if (Array.isArray(selected.evidence)) {
        const expectedEvidence = manifest.value.evidence.map((entry) => ({
          ...entry,
          path: `${run.runId}/${entry.path}`,
        }));
        if (JSON.stringify(selected.evidence) !== JSON.stringify(expectedEvidence)) {
          errors.push(`verdict selected run ${selected.runId} rewrites its evidence manifest`);
        }
      }
    }
    const emptyDirectoryRuns = value.selectedRuns.filter((entry) => entry.bootstrapMode === "agent-process-packed-cli-from-empty");
    if (emptyDirectoryRuns.length !== 1
      || manifests.get(emptyDirectoryRuns[0]?.runId)?.value?.agentBootstrap?.candidateDirectoryInitiallyEmpty !== true
      || manifests.get(emptyDirectoryRuns[0]?.runId)?.value?.agentBootstrap?.packedCliInvokedInsideAgentProcess !== true
      || manifests.get(emptyDirectoryRuns[0]?.runId)?.value?.agentBootstrap?.offlineDependencyInstall !== true) {
      errors.push("fresh-agent verdict lacks one receipt-bound exact packed-CLI run that began from an empty directory inside the coding-agent process");
    }
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

function pathLikeUnsafe(value) {
  return value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

export function buildAgentEaseCampaignPlan(options) {
  const campaignId = requiredText(options?.campaignId, "campaignId");
  if (!PATH_SEGMENT.test(campaignId)) throw new Error("campaignId must be one path-safe segment");
  const tasks = Array.isArray(options?.tasks) ? options.tasks : [];
  const taskIds = tasks.map((task) => task?.id);
  if (
    taskIds.length !== AGENT_EASE_TASK_IDS.length
    || [...taskIds].sort().join("\n") !== [...AGENT_EASE_TASK_IDS].sort().join("\n")
  ) {
    throw new Error(`campaign requires exactly these held-out tasks: ${AGENT_EASE_TASK_IDS.join(", ")}`);
  }
  const taskBriefById = options?.taskBriefById;
  if (!taskBriefById || typeof taskBriefById !== "object" || Array.isArray(taskBriefById)) {
    throw new Error("campaign requires immutable task brief bindings");
  }
  for (const task of tasks) {
    const goal = requiredText(task?.goal, `${task?.id ?? "unknown"} task goal`);
    const binding = taskBriefById[task.id];
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      throw new Error(`campaign requires an immutable task brief for ${task.id}`);
    }
    requiredText(binding.file, `${task.id} task brief file`);
    if (!SHA256.test(binding.sha256 ?? "") || binding.sha256 !== sha256(goal)) {
      throw new Error(`${task.id} task brief hash does not match its held-out goal`);
    }
  }
  const candidateCommit = requiredText(options?.candidateCommit, "candidateCommit").toLowerCase();
  const candidateSourceHash = requiredText(options?.candidateSourceHash, "candidateSourceHash").toLowerCase();
  const taskSetFile = requiredText(options?.taskSetFile, "taskSetFile");
  const taskSetSha256 = requiredText(options?.taskSetSha256, "taskSetSha256").toLowerCase();
  const trialRunnerSha256 = requiredText(options?.trialRunnerSha256, "trialRunnerSha256").toLowerCase();
  const protectedEvaluatorFile = requiredText(options?.protectedEvaluatorFile, "protectedEvaluatorFile");
  const protectedEvaluatorSha256 = requiredText(options?.protectedEvaluatorSha256, "protectedEvaluatorSha256").toLowerCase();
  const protectedBrowserLaneFile = requiredText(options?.protectedBrowserLaneFile, "protectedBrowserLaneFile");
  const protectedBrowserLaneSha256 = requiredText(options?.protectedBrowserLaneSha256, "protectedBrowserLaneSha256").toLowerCase();
  const providerBrokerFile = requiredText(options?.providerBrokerFile, "providerBrokerFile");
  const providerBrokerSha256 = requiredText(options?.providerBrokerSha256, "providerBrokerSha256").toLowerCase();
  const protectedContainerImage = requiredText(options?.protectedContainerImage, "protectedContainerImage");
  const protectedContainerImageId = requiredText(options?.protectedContainerImageId, "protectedContainerImageId").toLowerCase();
  const agentContainerImage = requiredText(options?.agentContainerImage, "agentContainerImage");
  const agentContainerImageId = requiredText(options?.agentContainerImageId, "agentContainerImageId").toLowerCase();
  if (!COMMIT.test(candidateCommit)) throw new Error("candidateCommit must be a lowercase 40-character commit");
  for (const [label, digest] of [["candidateSourceHash", candidateSourceHash], ["taskSetSha256", taskSetSha256], ["trialRunnerSha256", trialRunnerSha256], ["protectedEvaluatorSha256", protectedEvaluatorSha256], ["protectedBrowserLaneSha256", protectedBrowserLaneSha256], ["providerBrokerSha256", providerBrokerSha256]]) {
    if (!SHA256.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(protectedContainerImageId)) throw new Error("protectedContainerImageId must be an exact Docker image ID");
  if (!/^sha256:[a-f0-9]{64}$/.test(agentContainerImageId)) throw new Error("agentContainerImageId must be an exact Docker image ID");
  const lowerCostDriver = requiredText(options?.lowerCostDriver, "lowerCostDriver");
  if (!new Set(["codex", "claude-code"]).has(lowerCostDriver)) {
    throw new Error(`unsupported lower-cost driver ${lowerCostDriver}`);
  }
  const lowerCostModel = requiredText(options?.lowerCostModel, "lowerCostModel");
  const lowerCostEvidence = validateLowerCostEvidence(options?.lowerCostEvidence, {
    agentDriver: lowerCostDriver,
    model: lowerCostModel,
  });
  const nodekitTarball = requiredText(options?.nodekitTarball, "nodekitTarball");
  const nodekitTarballSha256 = requiredText(options?.nodekitTarballSha256, "nodekitTarballSha256").toLowerCase();
  if (!SHA256.test(nodekitTarballSha256)) {
    throw new Error("nodekitTarballSha256 must be a lowercase SHA-256 digest");
  }
  const packageManager = options?.packageManager ?? "npm";
  if (packageManager !== "npm") {
    throw new Error("qualifying fresh-agent campaigns require npm; pnpm is certified by the separate developer-timing matrix");
  }
  const executor = options?.executor ?? "docker";
  if (executor !== "docker") throw new Error("qualifying campaigns require the isolated Docker executor");

  const modelByProfile = {
    codex: requiredText(options?.codexModel, "codexModel"),
    "claude-code": requiredText(options?.claudeModel, "claudeModel"),
    "lower-cost": lowerCostModel,
  };
  const runs = [];
  for (const taskId of AGENT_EASE_TASK_IDS) {
    for (const [agentProfile, count] of Object.entries(AGENT_EASE_PROFILE_COUNTS)) {
      for (let ordinal = 1; ordinal <= count; ordinal += 1) {
        const agentDriver = agentProfile === "claude-code"
          ? "claude-code"
          : agentProfile === "lower-cost"
            ? lowerCostDriver
            : "codex";
        const bootstrapMode = taskId === "research-map" && agentProfile === "codex" && ordinal === 1
          ? "agent-process-packed-cli-from-empty"
          : "pre-scaffolded-packed-cli";
        const runId = `${campaignId}_${taskId}_${agentProfile}_${ordinal}`;
        if (!PATH_SEGMENT.test(runId)) throw new Error(`generated run id is not path-safe: ${runId}`);
        const args = [
          `--task=${taskId}`,
          `--run=${runId}`,
          `--agentProfile=${agentProfile}`,
          `--agentDriver=${agentDriver}`,
          `--agent-container-image=${agentContainerImage}`,
          `--agent-container-image-id=${agentContainerImageId}`,
          `--bootstrap-mode=${bootstrapMode}`,
          `--executor=${executor}`,
          `--packageManager=${packageManager}`,
          `--nodekit-tarball=${nodekitTarball}`,
          `--nodekit-tarball-sha256=${nodekitTarballSha256}`,
          `--candidate=${candidateCommit}`,
          `--source-hash=${candidateSourceHash}`,
          `--task-brief-file=${taskBriefById[taskId].file}`,
          `--task-brief-sha256=${taskBriefById[taskId].sha256}`,
          `--task-set-file=${taskSetFile}`,
          `--task-set-sha256=${taskSetSha256}`,
          `--trial-runner-sha256=${trialRunnerSha256}`,
          `--protected-evaluator-file=${protectedEvaluatorFile}`,
          `--protected-evaluator-sha256=${protectedEvaluatorSha256}`,
          `--protected-browser-lane-file=${protectedBrowserLaneFile}`,
          `--protected-browser-lane-sha256=${protectedBrowserLaneSha256}`,
          `--provider-broker-file=${providerBrokerFile}`,
          `--provider-broker-sha256=${providerBrokerSha256}`,
          `--protected-container-image=${protectedContainerImage}`,
          `--protected-container-image-id=${protectedContainerImageId}`,
        ];
        if (typeof options?.evidenceRoot === "string" && options.evidenceRoot.trim().length > 0) {
          args.push(`--evidence-root=${options.evidenceRoot.trim()}`);
        }
        const model = modelByProfile[agentProfile];
        args.push(`--agentModel=${model}`);
        if (Number.isInteger(options?.timeoutMs) && options.timeoutMs > 0) {
          args.push(`--timeoutMs=${options.timeoutMs}`);
        }
        runs.push({
          agentDriver,
          agentContainerImage,
          agentContainerImageId,
          agentProfile,
          args,
          bootstrapMode,
          model,
          ordinal,
          runId,
          taskBriefSha256: taskBriefById[taskId].sha256,
          taskId,
          taskSetSha256,
          trialRunnerSha256,
          protectedEvaluatorSha256,
          protectedBrowserLaneSha256,
          providerBrokerSha256,
          protectedContainerImage,
          protectedContainerImageId,
        });
      }
    }
  }
  if (runs.length !== 15 || new Set(runs.map((run) => run.runId)).size !== 15) {
    throw new Error("agent ease campaign plan must contain exactly 15 unique trials");
  }
  if (runs.filter((run) => run.bootstrapMode === "agent-process-packed-cli-from-empty").length !== 1) {
    throw new Error("agent ease campaign plan must contain exactly one protected empty-directory packed-CLI lane");
  }
  return {
    campaignId,
    lowerCostEvidence,
    profileCounts: { ...AGENT_EASE_PROFILE_COUNTS },
    runs,
    schemaVersion: "nodekit.agent-ease-campaign-plan/v1",
    taskIds: [...AGENT_EASE_TASK_IDS],
  };
}
